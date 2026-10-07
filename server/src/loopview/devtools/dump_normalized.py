"""Write the normalized form of every fixture as JSON.

Used for the UI tests, and for the hosted demo (a static build of the UI that
reads recorded runs from files instead of a server). Also writes tools.json, the
Tools tab's report.

Most fixtures hold one run and become `<name>.json`. A fixture with several runs
(the MCP tools study) becomes `<name>-01.json`, `<name>-02.json`... but only for
the demo (--index): the UI tests don't use them, and they are several MB.

With --index (the demo), only the fixtures in DEMO_RUNS and DEMO_TOOLS_ONLY are
written. index.json lists each run file with its RunInfo, so the demo can show
the run list without downloading every run. DEMO_RUNS are the curated examples
shown in the run list, each with a short description of the agent and its task;
DEMO_TOOLS_ONLY runs are not listed but feed the Tools tab, whose links can still
open them. Without --index, tools.json covers every fixture.

Usage (from server/):
    uv run python -m loopview.devtools.dump_normalized ../ui/src/test-data
    uv run python -m loopview.devtools.dump_normalized ../ui/pages-public/demo --index
"""

import json
import sys
from pathlib import Path
from typing import Any

from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import NormalizedRun
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore
from loopview.tools.report import tools_report

REPO = Path(__file__).resolve().parents[4]
FIXTURES = REPO / "fixtures"
MCP_STUDY_TASKS = REPO / "examples" / "mcp_tools_study_tasks.txt"

# The examples the hosted demo lists, in order, with what the demo says about each.
# `prompt` is the task the agent was given, as written in the example's source.
DEMO_RUNS: dict[str, dict[str, Any]] = {
    "flagship": {
        "title": "Database comparison team",
        "framework": "LangGraph",
        "source": "examples/demo/flagship.py",
        "summary": (
            "A supervisor splits the question into three briefs. Three analyst agents research "
            "benchmarks, operations and ecosystem in parallel, each with its own tools. Their "
            "notes are merged, a critic sends the draft back once, and a writer produces the "
            "answer."
        ),
        "prompt": (
            "Compare PostgreSQL, SQLite and DuckDB for a small internal analytics dashboard: "
            "5 users, about 20 GB of event data, loaded once a day. Recommend one."
        ),
        "look_for": [
            "the fan-out to three analysts running at the same time",
            "fetch_repo_stats failing on its first call, then the retry",
            "the critic's loop back to synthesize, then the handoff to the writer",
            "the Cost tab: a 4,300-token handbook read from the prompt cache",
        ],
    },
    "multi_agent_pydantic": {
        "title": "Laptop advice, multi-agent",
        "framework": "Pydantic AI",
        "source": "examples/multi_agent_pydantic.py",
        "summary": (
            "A coordinator agent delegates to two researchers (specs and reviews) that run in "
            "parallel behind one tool call, then hands its notes to a writer agent."
        ),
        "prompt": (
            "A student needs a laptop for programming and light video editing, budget 1300 EUR. "
            "Compare the Aster Pro 14 and the Kestrel Air 15 and recommend one."
        ),
        "look_for": [
            "agents nested inside a tool call (delegation)",
            "the two researchers overlapping in time",
            "the handoff from the coordinator to the writer",
        ],
    },
    "langgraph_router": {
        "title": "Date question router",
        "framework": "LangGraph",
        "source": "examples/langgraph_router.py",
        "summary": (
            "A classifier routes the question to a tool-using agent. The agent loops with its date "
            "tools, then a strict reviewer asks for one revision and sends it back."
        ),
        "prompt": (
            "How many days are there from 2026-09-30 until the next February 29th, "
            "and what day of the week will that February 29th be?"
        ),
        "look_for": [
            "the conditional route out of classify",
            "the agent and tools loop",
            "the reviewer's loop back to an earlier node",
        ],
    },
    "failing_tools_pydantic": {
        "title": "Shop assistant, failing tools",
        "framework": "Pydantic AI + MCP",
        "source": "examples/failing_tools_pydantic.py",
        "summary": (
            "A support agent with an order tool and an inventory MCP server. The question is "
            "worded so both tools fail first: the agent has to read the errors and recover."
        ),
        "prompt": (
            "What is the status of order 1234, and how many units of SKU-0099 (the blue mug) "
            "are in stock?"
        ),
        "look_for": [
            "red tool calls: a ModelRetry and an MCP isError result",
            "what the model does next: fixes its arguments, or switches tool",
            "the Tools tab, where these recoveries are counted",
        ],
    },
    "react_anthropic": {
        "title": "Trip budget, hand-rolled loop",
        "framework": "Anthropic SDK",
        "source": "examples/react_anthropic.py",
        "summary": (
            "A plain ReAct loop written by hand on the Anthropic SDK, traced with the "
            "OpenTelemetry GenAI conventions. Extended thinking is on, so the model's reasoning "
            "is recorded."
        ),
        "prompt": (
            "I'm planning 3 nights in Lisbon and 2 nights in Porto. Look up the average "
            "hotel price per night in each city, then tell me the total in EUR and in USD."
        ),
        "look_for": [
            "the model's thinking, shown inside each model call",
            "several tool calls asked for in one model turn",
        ],
    },
}
# Not listed (20 short tasks against GitHub's MCP server), but the Tools tab is built on them.
DEMO_TOOLS_ONLY = ["mcp_tools_study"]


def tools_only_about(name: str, run: NormalizedRun) -> dict[str, Any] | None:
    """What the demo says about an unlisted run that a Tools tab link opened."""
    if name != "mcp_tools_study" or not run.run.name.startswith("task "):
        return None  # the study's first run only opens the MCP connection
    lines = MCP_STUDY_TASKS.read_text(encoding="utf-8").splitlines()
    tasks = [line for line in lines if line.strip() and not line.startswith("#")]
    number = int(run.run.name.removeprefix("task "))
    return {
        "title": f"GitHub MCP study, task {number}",
        "framework": "Pydantic AI + GitHub MCP",
        "source": "examples/mcp_tools_study.py",
        "summary": (
            "One of 20 read-only questions a Pydantic AI agent answered with the tools of GitHub's "
            "official MCP server. Together, these runs feed the Tools tab."
        ),
        "prompt": tasks[number - 1],
        "look_for": [
            "which of the server's many tools the model picks",
            "how big the tool results are, in the Cost tab",
        ],
    }


def main() -> None:
    out = Path(sys.argv[1])
    demo = "--index" in sys.argv
    out.mkdir(parents=True, exist_ok=True)
    all_runs: list[NormalizedRun] = []
    index: list[tuple[int, str, NormalizedRun, str]] = []  # (demo position, file, run, fixture)
    for fixture in sorted(FIXTURES.glob("*.otlp.jsonl")):
        name = fixture.name.removesuffix(".otlp.jsonl")
        if demo and name not in DEMO_RUNS and name not in DEMO_TOOLS_ONLY:
            continue
        store = TraceStore()
        load_capture(store, fixture)
        runs = [
            normalize_run(run, now_ns=run.last_received_ns)
            for run in sorted(store.runs(), key=lambda r: r.first_received_ns)
        ]
        all_runs += runs
        if len(runs) > 1 and not demo:
            print(f"skipped {name} ({len(runs)} runs: written for the demo only)")
            continue
        position = list(DEMO_RUNS).index(name) if name in DEMO_RUNS else len(DEMO_RUNS)
        for i, normalized in enumerate(runs, 1):
            file = f"{name}.json" if len(runs) == 1 else f"{name}-{i:02d}.json"
            (out / file).write_text(normalized.model_dump_json(), encoding="utf-8")
            index.append((position, file, normalized, name))
        print(f"wrote {name} ({len(runs)} run{'s' if len(runs) > 1 else ''})")
    (out / "tools.json").write_text(json.dumps(tools_report(all_runs)), encoding="utf-8")
    print("wrote tools.json")
    if demo:
        missing = [
            name for name in [*DEMO_RUNS, *DEMO_TOOLS_ONLY] if not any(e[3] == name for e in index)
        ]
        if missing:
            sys.exit(f"no fixture for {', '.join(missing)}")
        index.sort(key=lambda entry: entry[0])  # stable: a fixture's runs keep their order
        entries = [
            {
                "file": file,
                "run": n.run.model_dump(mode="json"),
                "listed": name in DEMO_RUNS,
                "about": DEMO_RUNS.get(name) or tools_only_about(name, n),
            }
            for _, file, n, name in index
        ]
        (out / "index.json").write_text(json.dumps(entries), encoding="utf-8")
        print("wrote index.json")


if __name__ == "__main__":
    main()
