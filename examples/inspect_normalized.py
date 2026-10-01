"""Print a fixture after normalization: visible steps as a tree, then transitions.

Usage (from examples/):  uv run python inspect_normalized.py flagship
"""

import sys
from pathlib import Path

from loopview.normalize.normalizer import normalize_run
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def main() -> None:
    store = TraceStore()
    load_capture(store, FIXTURES / f"{sys.argv[1]}.otlp.jsonl")
    for run in store.runs():
        n = normalize_run(run)
        print(f"run {n.run.name}  status={n.run.status}  steps={n.run.step_count}  "
              f"session={n.run.session_id}")
        visible = [s for s in n.steps if not s.hidden]
        by_id = {s.id: s for s in n.steps}
        children: dict[str | None, list] = {}
        for s in visible:
            children.setdefault(s.parent_id, []).append(s)

        def show(step, depth):  # type: ignore[no-untyped-def]
            flag = " ERROR " + (step.error or "") if step.status == "error" else ""
            print(f"{'  ' * depth}{step.kind:10} {step.name}  [{step.type_label}]{flag}")
            for child in children.get(step.id, []):
                show(child, depth + 1)

        for root in children.get(None, []):
            show(root, 0)
        print("transitions:")
        for t in n.transitions:
            print(f"  {t.kind:9} {by_id[t.source].key}  ->  {by_id[t.target].key}")


if __name__ == "__main__":
    main()
