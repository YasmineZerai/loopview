"""How does an agent get on with a real MCP server's tools? Runs a list of tasks with
a Pydantic AI agent connected to one public MCP server, sends every run to
loopview, then prints the Tools tab's summary.

Default server: the official GitHub MCP server (remote, streamable HTTP), in
read-only mode (`X-MCP-Readonly: true`), so nothing can be written even if the
model tries. It needs a GitHub token in GITHUB_PERSONAL_ACCESS_TOKEN (.env); a
fine-grained token with read access to public repositories is enough.

Each task is its own run (trace). All runs of one study share a conversation id,
so loopview groups them into one session ("This session" in the Tools tab).

Run (from examples/):
    # one command: starts loopview in-process, saves the runs, keeps the UI open at the end
    uv run python mcp_tools_study.py --persist mcp_tools_study.jsonl
    # or send to a loopview that is already running
    uv run python mcp_tools_study.py
Options: --server URL, --token-env NAME, --tasks FILE, --limit N, --model NAME
"""

import argparse
import asyncio
import os
import socket
import threading
import time
import uuid
from pathlib import Path
from typing import Any

import httpx
from opentelemetry import trace
from pydantic_ai import Agent
from pydantic_ai.exceptions import AgentRunError
from pydantic_ai.mcp import MCPToolset
from pydantic_ai.models.instrumented import InstrumentationSettings
from pydantic_ai.usage import UsageLimits

from shared import model_name, setup_tracing

HERE = Path(__file__).resolve().parent
DEFAULT_SERVER = "https://api.githubcopilot.com/mcp/"
DEFAULT_TASKS = HERE / "mcp_tools_study_tasks.txt"
INSTRUCTIONS = (
    "You answer questions about public GitHub repositories using the tools you have. "
    "Only read: never create, edit or comment on anything. Keep answers short."
)
# Bounds the cost of one task: a confused model can't loop forever.
LIMITS = UsageLimits(request_limit=15)


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--server", default=os.environ.get("MCP_SERVER_URL", DEFAULT_SERVER),
                   help="MCP server URL (streamable HTTP). Default: MCP_SERVER_URL or GitHub's.")
    p.add_argument("--token-env", default="GITHUB_PERSONAL_ACCESS_TOKEN",
                   help="environment variable holding the server's bearer token ('' for none)")
    p.add_argument("--tasks", type=Path, default=DEFAULT_TASKS)
    p.add_argument("--limit", type=int, default=None, help="run only the first N tasks")
    p.add_argument("--model", default=None, help="model name (default: ANTHROPIC_MODEL)")
    p.add_argument("--persist", type=Path, default=None,
                   help="start loopview here, saving the runs to this file, and keep it open")
    p.add_argument("--loopview", default="http://127.0.0.1:4318",
                   help="a running loopview, when --persist isn't given")
    return p.parse_args()


def load_tasks(path: Path) -> list[str]:
    lines = (line.strip() for line in path.read_text(encoding="utf-8").splitlines())
    return [line for line in lines if line and not line.startswith("#")]


def toolset(server: str, token_env: str) -> MCPToolset:
    headers = {"X-MCP-Readonly": "true"}  # GitHub's server: read-only tools only
    if token_env:
        token = os.environ.get(token_env)
        if not token:
            raise SystemExit(f"Set {token_env} in .env (see .env.example), or pass --token-env ''.")
        headers["Authorization"] = f"Bearer {token}"
    # A tool error goes back to the model as a retry prompt, so it can recover:
    # that recovery is what the Tools tab measures.
    return MCPToolset(server, headers=headers, tool_error_behavior="retry", max_retries=3)


async def run_tasks(agent: Agent, tasks: list[str], study_id: str, tracer: trace.Tracer) -> list[str]:
    trace_ids = []
    # No `async with agent` around the loop: each run connects to the MCP server
    # itself, so the connection's spans belong to a task's run, not to a run of
    # their own outside the study's session.
    for i, task in enumerate(tasks, 1):
        with tracer.start_as_current_span(
            "invoke_workflow mcp_tools_study",
            attributes={
                "gen_ai.operation.name": "invoke_workflow",
                "gen_ai.workflow.name": f"task {i:02d}",
                "gen_ai.conversation.id": study_id,
            },
        ) as span:
            trace_ids.append(format(span.get_span_context().trace_id, "032x"))
            print(f"\n[{i}/{len(tasks)}] {task}")
            try:
                result = await agent.run(task, usage_limits=LIMITS)
                print("  ->", " ".join(str(result.output).split())[:300])
            except AgentRunError as exc:  # too many retries, usage limit: part of the data
                span.set_status(trace.Status(trace.StatusCode.ERROR, str(exc)))
                print(f"  !! {type(exc).__name__}: {exc}")
    return trace_ids


# --- loopview: in-process when persisting, otherwise an existing server ------------------


def start_loopview(persist: Path) -> tuple[str, Any]:
    import uvicorn

    from loopview.app import create_app
    from loopview.store.capture import CaptureWriter, load_capture
    from loopview.store.memory import TraceStore

    store = TraceStore()
    if persist.exists():  # same as `loopview --persist`: keep earlier runs
        load_capture(store, persist)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    server = uvicorn.Server(uvicorn.Config(
        create_app(store=store, capture=CaptureWriter(persist)),
        host="127.0.0.1", port=port, log_level="warning",
    ))
    threading.Thread(target=server.run, daemon=True).start()
    while not server.started:
        time.sleep(0.05)
    return f"http://127.0.0.1:{port}", server


def check_loopview(base: str) -> None:
    try:
        httpx.get(f"{base}/api/health", timeout=3).raise_for_status()
    except httpx.HTTPError:
        raise SystemExit(
            f"No loopview at {base}. Start one (`cd server && uv run loopview --persist "
            "mcp_tools_study.jsonl`) or pass --persist FILE to run one in-process."
        ) from None


def plural(n: int, word: str) -> str:
    return f"{n:,} {word}{'' if n == 1 else 's'}"


def print_summary(report: dict[str, Any]) -> None:
    s = report["summary"]
    print("\n=== Tools tab summary ===")
    line = (f"{plural(s['runs'], 'run')}, {plural(s['tool_calls'], 'tool call')}, "
            f"{plural(s['errors'], 'error')}.")
    failing = sum(1 for t in report["tools"] if t["errors"])
    if failing > 2:
        line += f" 2 tools caused {s['share_of_errors_from_top_2_tools']:.0%} of errors."
    elif failing:
        line += f" {plural(failing, 'tool')} caused every error."
    if not report["tool_list_recorded"]:
        line += " Tool list not recorded."
    elif s["never_called_count"] == 0:
        line += " Every offered tool was used."
    else:
        line += (f" {plural(s['never_called_count'], 'tool')} never used (about "
                 f"{s['never_called_tokens_per_run_estimate']:,} tokens per run, estimated).")
    print(line)
    print(f"\n{'tool':32} {'calls':>5} {'errors':>6} {'rate':>5}  after an error")
    for t in report["tools"][:15]:
        a = t["after_error"]
        after = (f"retry {a['blind_retry']}, fixed {a['fixed']} ({a['fixed_succeeded']} ok), "
                 f"switched {a['switched']}, gave up {a['gave_up']}") if t["errors"] else ""
        print(f"{t['name'][:32]:32} {t['calls']:>5} {t['errors']:>6} {t['error_rate']:>5.0%}  {after}")
        for e in t["top_errors"][:1]:
            print(f"{'':32}   e.g. {e['message_group'][:90]}")
    if report["never_called"]:
        names = ", ".join(t["name"] for t in report["never_called"][:12])
        more = len(report["never_called"]) - 12
        print(f"\nnever called: {names}{f' and {more} more' if more > 0 else ''}")


def main() -> None:
    args = parse_args()
    tasks = load_tasks(args.tasks)[: args.limit]
    server = None
    if args.persist:
        base, server = start_loopview(args.persist.resolve())
    else:
        base = args.loopview.rstrip("/")
        check_loopview(base)
    os.environ["OTEL_EXPORTER_OTLP_TRACES_ENDPOINT"] = f"{base}/v1/traces"

    provider = setup_tracing("mcp-tools-study")
    Agent.instrument_all(InstrumentationSettings(tracer_provider=provider))
    agent = Agent(
        f"anthropic:{args.model or model_name()}",
        name="github_reader",
        instructions=INSTRUCTIONS,
        toolsets=[toolset(args.server, args.token_env)],
        retries=3,
    )
    study_id = f"mcp-tools-study-{uuid.uuid4()}"
    print(f"{len(tasks)} tasks against {args.server}, traces to {base}")
    # The tracer comes from our provider, not the global one: with --persist, the
    # in-process server can install a global provider first.
    tracer = provider.get_tracer("loopview.examples.mcp_tools_study")
    trace_ids = asyncio.run(run_tasks(agent, tasks, study_id, tracer))
    provider.force_flush()
    time.sleep(1)  # let the receiver store the last batch

    report = httpx.get(f"{base}/api/tools", params={"runs": ",".join(trace_ids)}, timeout=30)
    print_summary(report.json())
    print(f"\nOpen {base} and press o for the Tools tab (pick 'This session' for this study).")
    provider.shutdown()
    if server is not None:
        print(f"Runs saved to {args.persist}. Ctrl+C to stop.")
        try:
            while True:
                time.sleep(1)
        except KeyboardInterrupt:
            server.should_exit = True


if __name__ == "__main__":
    main()
