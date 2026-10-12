"""The Tools tab's report over a recording too big to ship, saved as a snapshot.

The hosted demo is built in CI from the files in the repository. A pilot of a real
app (78 runs, 144 MB) can't be one of them, but its Tools report can: it is small,
and it holds counts, error messages and example arguments, not conversations.

Links from the report to calls ("show this call in the graph") only work for runs
the demo has. Links into any other run are removed: a call's step_refs keep only
the kept runs, and an error's example loses its link (its message and arguments
stay).

Usage (from server/):
    uv run python -m loopview.devtools.tools_snapshot CAPTURE OUT [KEPT_RUN_FIXTURE...]
The trace ids of the kept runs are read from the fixtures given.
"""

import json
import sys
from pathlib import Path
from typing import Any

from loopview.normalize.normalizer import normalize_run
from loopview.store.capture import load_capture
from loopview.store.memory import TraceStore
from loopview.tools.report import tools_report


def trace_ids(capture: Path) -> set[str]:
    store = TraceStore()
    load_capture(store, capture)
    return {run.trace_id for run in store.runs()}


def keep_links(report: dict[str, Any], kept: set[str]) -> dict[str, Any]:
    """The report with links only into the kept runs."""
    for tool in report["tools"]:
        tool["step_refs"] = [r for r in tool["step_refs"] if r["run_id"] in kept]
        for error in tool["top_errors"]:
            if error["step_ref"]["run_id"] not in kept:
                error["step_ref"] = None
    return report


def snapshot(capture: Path, kept: set[str]) -> dict[str, Any]:
    store = TraceStore(max_runs=10_000)
    load_capture(store, capture)
    runs = [normalize_run(run, now_ns=run.last_received_ns) for run in store.runs()]
    return keep_links(tools_report(runs), kept)


def main() -> None:
    if len(sys.argv) < 3:
        sys.exit(__doc__)
    capture, out = Path(sys.argv[1]), Path(sys.argv[2])
    kept = set().union(*(trace_ids(Path(f)) for f in sys.argv[3:]))
    report = snapshot(capture, kept)
    out.write_text(json.dumps(report, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    s = report["summary"]
    print(f"wrote {out}: {s['runs']} runs, {s['tool_calls']} tool calls, {len(kept)} linked run(s)")


if __name__ == "__main__":
    main()
