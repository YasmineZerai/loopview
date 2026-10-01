"""Write the normalized form of every fixture as JSON, for the UI tests.

Usage (from server/):  uv run python -m loopview.devtools.dump_normalized ../ui/src/test-data
"""

import sys
from pathlib import Path

from loopview.normalize.normalizer import normalize_run
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore

FIXTURES = Path(__file__).resolve().parents[4] / "fixtures"


def main() -> None:
    out = Path(sys.argv[1])
    for fixture in sorted(FIXTURES.glob("*.otlp.jsonl")):
        store = TraceStore()
        load_capture(store, fixture)
        [run] = store.runs()
        normalized = normalize_run(run, now_ns=run.last_received_ns)
        name = fixture.name.removesuffix(".otlp.jsonl")
        (out / f"{name}.json").write_text(normalized.model_dump_json(), encoding="utf-8")
        print(f"wrote {name}.json ({len(normalized.steps)} steps)")


if __name__ == "__main__":
    main()
