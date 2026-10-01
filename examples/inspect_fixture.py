"""Print a captured fixture as a span tree, to see what a framework really emits.

Usage (from examples/):  uv run python inspect_fixture.py react_anthropic [--attrs]
"""

import sys
from pathlib import Path

from loopview.ingest.raw import RawSpan
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore

FIXTURES = Path(__file__).resolve().parent.parent / "fixtures"


def short(value: object, limit: int = 90) -> str:
    text = str(value).replace("\n", " ")
    return text if len(text) <= limit else text[: limit - 3] + "..."


def main() -> None:
    name, show_attrs = sys.argv[1], "--attrs" in sys.argv
    store = TraceStore()
    requests = load_capture(store, FIXTURES / f"{name}.otlp.jsonl")
    print(f"{requests} requests")
    for run in store.runs():
        spans = list(run.spans.values())
        children: dict[str | None, list[RawSpan]] = {}
        for span in spans:
            parent = span.parent_span_id if span.parent_span_id in run.spans else None
            children.setdefault(parent, []).append(span)
        t0 = min(s.start_time_unix_nano for s in spans)
        print(f"\ntrace {run.trace_id}  spans={len(spans)}  session={run.session_id}")

        def show(span: RawSpan, depth: int) -> None:
            start = (span.start_time_unix_nano - t0) / 1e6
            dur = (span.end_time_unix_nano - span.start_time_unix_nano) / 1e6
            status = " ERROR" if span.status_code == "error" else ""
            print(f"{'  ' * depth}- {span.name}  [{start:.0f}ms +{dur:.0f}ms]{status}")
            if show_attrs:
                for key, value in span.attributes.items():
                    print(f"{'  ' * depth}    {key} = {short(value)}")
            for child in sorted(children.get(span.span_id, []),
                                key=lambda s: s.start_time_unix_nano):
                show(child, depth + 1)

        for root in sorted(children.get(None, []), key=lambda s: s.start_time_unix_nano):
            show(root, 0)


if __name__ == "__main__":
    main()
