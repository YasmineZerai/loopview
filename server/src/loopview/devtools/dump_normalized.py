"""Write the normalized form of every fixture as JSON.

Used for the UI tests, and for the hosted demo (a static build of the UI that
reads recorded runs from files instead of a server).

Usage (from server/):
    uv run python -m loopview.devtools.dump_normalized ../ui/src/test-data
    uv run python -m loopview.devtools.dump_normalized ../ui/pages-public/demo --index
"""

import json
import sys
from pathlib import Path

from loopview.normalize.normalizer import normalize_run
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore

FIXTURES = Path(__file__).resolve().parents[4] / "fixtures"
# The order the hosted demo lists runs in: the flagship first.
DEMO_ORDER = ["flagship", "multi_agent_pydantic", "langgraph_router", "react_anthropic"]


def main() -> None:
    out = Path(sys.argv[1])
    out.mkdir(parents=True, exist_ok=True)
    written = []
    for fixture in sorted(FIXTURES.glob("*.otlp.jsonl")):
        store = TraceStore()
        load_capture(store, fixture)
        [run] = store.runs()
        normalized = normalize_run(run, now_ns=run.last_received_ns)
        name = fixture.name.removesuffix(".otlp.jsonl")
        (out / f"{name}.json").write_text(normalized.model_dump_json(), encoding="utf-8")
        written.append(name)
        print(f"wrote {name}.json ({len(normalized.steps)} steps)")
    if "--index" in sys.argv:
        ordered = sorted(written, key=lambda n: DEMO_ORDER.index(n) if n in DEMO_ORDER else 99)
        index = [{"file": f"{name}.json"} for name in ordered]
        (out / "index.json").write_text(json.dumps(index), encoding="utf-8")
        print("wrote index.json")


if __name__ == "__main__":
    main()
