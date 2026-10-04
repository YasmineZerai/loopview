"""Write the normalized form of every fixture as JSON.

Used for the UI tests, and for the hosted demo (a static build of the UI that
reads recorded runs from files instead of a server). Also writes tools.json, the
Tools tab's report over all of them.

Most fixtures hold one run and become `<name>.json`. A fixture with several runs
(the MCP tools study) becomes `<name>-01.json`, `<name>-02.json`... but only for
the demo (--index): the UI tests don't use them, and they are several MB. Its
runs are always part of tools.json.

With --index, index.json lists every run file with its RunInfo, so the demo can
show the run list without downloading every run.

Usage (from server/):
    uv run python -m loopview.devtools.dump_normalized ../ui/src/test-data
    uv run python -m loopview.devtools.dump_normalized ../ui/pages-public/demo --index
"""

import json
import sys
from pathlib import Path

from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import NormalizedRun
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore
from loopview.tools.report import tools_report

FIXTURES = Path(__file__).resolve().parents[4] / "fixtures"
# The order the hosted demo lists runs in: the flagship first, unknown ones last.
DEMO_ORDER = [
    "flagship",
    "multi_agent_pydantic",
    "langgraph_router",
    "react_anthropic",
    "mcp_tools_study",
]


def main() -> None:
    out = Path(sys.argv[1])
    demo = "--index" in sys.argv
    out.mkdir(parents=True, exist_ok=True)
    all_runs: list[NormalizedRun] = []
    index: list[tuple[int, str, NormalizedRun]] = []  # (demo position, file, run)
    for fixture in sorted(FIXTURES.glob("*.otlp.jsonl")):
        name = fixture.name.removesuffix(".otlp.jsonl")
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
        position = DEMO_ORDER.index(name) if name in DEMO_ORDER else len(DEMO_ORDER)
        for i, normalized in enumerate(runs, 1):
            file = f"{name}.json" if len(runs) == 1 else f"{name}-{i:02d}.json"
            (out / file).write_text(normalized.model_dump_json(), encoding="utf-8")
            index.append((position, file, normalized))
        print(f"wrote {name} ({len(runs)} run{'s' if len(runs) > 1 else ''})")
    (out / "tools.json").write_text(json.dumps(tools_report(all_runs)), encoding="utf-8")
    print("wrote tools.json")
    if demo:
        index.sort(key=lambda entry: entry[0])  # stable: a fixture's runs keep their order
        entries = [{"file": file, "run": n.run.model_dump(mode="json")} for _, file, n in index]
        (out / "index.json").write_text(json.dumps(entries), encoding="utf-8")
        print("wrote index.json")


if __name__ == "__main__":
    main()
