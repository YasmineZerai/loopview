"""In-memory store of recent traces: a bounded ring buffer of runs.

- A run is one trace: every span sharing a trace id.
- A session is several runs sharing a conversation or session id attribute.
- The store keeps at most `max_runs` runs. When it is full, the run that was
  updated least recently is dropped, so a run that is still receiving spans is
  never evicted in favour of an idle one.

No locking: the store is only touched from the asyncio event loop (the receiver
endpoint is `async def`), so calls never overlap.
"""

import time
from collections import OrderedDict
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field

from pydantic import BaseModel

from loopview.ingest.raw import RawSpan

# Attributes that tie runs into a session, in priority order:
# OTel GenAI (gen_ai.conversation.id) and OpenInference (session.id).
SESSION_ID_ATTRIBUTES = ("gen_ai.conversation.id", "session.id")

DEFAULT_MAX_RUNS = 200


@dataclass
class Run:
    trace_id: str
    first_received_ns: int
    last_received_ns: int
    spans: dict[str, RawSpan] = field(default_factory=dict)  # by span id
    # When each span arrived at the server. Arrival order and timing are what the
    # liveness inference (M4) uses as a heartbeat.
    received_ns: dict[str, int] = field(default_factory=dict)
    # Spans reported as started (by loopview-sdk) that have not ended yet. Only
    # in-progress spans are kept here; the ended span replaces its start report.
    started: dict[str, RawSpan] = field(default_factory=dict)

    def add(self, span: RawSpan, received_at_ns: int) -> None:
        # A re-sent span (exporter retry) replaces the old copy but keeps its first
        # arrival time.
        self.received_ns.setdefault(span.span_id, received_at_ns)
        self.spans[span.span_id] = span
        self.started.pop(span.span_id, None)
        self.last_received_ns = max(self.last_received_ns, received_at_ns)

    def add_started(self, span: RawSpan, received_at_ns: int) -> None:
        if span.span_id not in self.spans:  # the end can overtake the start report
            self.started[span.span_id] = span
        self.last_received_ns = max(self.last_received_ns, received_at_ns)

    @property
    def session_id(self) -> str | None:
        """The session id of the shallowest span that has one.

        Shallowest, because nested agents can carry their own conversation ids and
        the outermost one describes the run. Computed on demand, since spans arrive
        in any order (children usually first)."""
        best: tuple[int, str] | None = None
        for span in self.spans.values():
            session = _session_id(span)
            if session is None:
                continue
            depth, parent = 0, span.parent_span_id
            while parent in self.spans:
                depth, parent = depth + 1, self.spans[parent].parent_span_id
            if best is None or depth < best[0]:
                best = (depth, session)
        return best[1] if best else None

    @property
    def root(self) -> RawSpan | None:
        """The span with no parent, or None if it hasn't arrived yet.

        Spans are exported when they end, and a root ends last, so a run that is
        still going usually has no root yet.
        """
        for span in self.spans.values():
            if span.parent_span_id is None:
                return span
        return None


class SessionSummary(BaseModel):
    session_id: str
    trace_ids: list[str]  # oldest run first


class TraceStore:
    def __init__(
        self, max_runs: int = DEFAULT_MAX_RUNS, clock: Callable[[], int] = time.time_ns
    ) -> None:
        self.max_runs = max_runs
        self._clock = clock
        # Ordered from least to most recently updated, so eviction is popitem(last=False).
        self._runs: OrderedDict[str, Run] = OrderedDict()

    def add_spans(self, spans: Iterable[RawSpan], received_at_ns: int | None = None) -> list[str]:
        """Store spans from one export request. Returns the trace ids that changed."""
        now = self._clock() if received_at_ns is None else received_at_ns
        changed: list[str] = []
        for span in spans:
            run = self._runs.get(span.trace_id)
            if run is None:
                run = Run(span.trace_id, first_received_ns=now, last_received_ns=now)
                self._runs[span.trace_id] = run
            run.add(span, now)
            self._runs.move_to_end(span.trace_id)
            if span.trace_id not in changed:
                changed.append(span.trace_id)
        while len(self._runs) > self.max_runs:
            self._runs.popitem(last=False)
        return changed

    def add_started_spans(
        self, spans: Iterable[RawSpan], received_at_ns: int | None = None
    ) -> list[str]:
        """Store start reports from loopview-sdk. Returns the trace ids that changed."""
        now = self._clock() if received_at_ns is None else received_at_ns
        changed: list[str] = []
        for span in spans:
            run = self._runs.get(span.trace_id)
            if run is None:
                run = Run(span.trace_id, first_received_ns=now, last_received_ns=now)
                self._runs[span.trace_id] = run
            run.add_started(span, now)
            self._runs.move_to_end(span.trace_id)
            if span.trace_id not in changed:
                changed.append(span.trace_id)
        while len(self._runs) > self.max_runs:
            self._runs.popitem(last=False)
        return changed

    def get_run(self, trace_id: str) -> Run | None:
        return self._runs.get(trace_id)

    def runs(self) -> list[Run]:
        """All runs, most recently started first."""
        return sorted(self._runs.values(), key=lambda r: r.first_received_ns, reverse=True)

    def sessions(self) -> list[SessionSummary]:
        """Sessions, derived on demand. With a few hundred runs this is cheap and
        avoids keeping a second index in sync with eviction."""
        by_session: dict[str, list[Run]] = {}
        for run in self._runs.values():
            if run.session_id is not None:
                by_session.setdefault(run.session_id, []).append(run)
        return [
            SessionSummary(
                session_id=session_id,
                trace_ids=[r.trace_id for r in sorted(runs, key=lambda r: r.first_received_ns)],
            )
            for session_id, runs in by_session.items()
        ]


def _session_id(span: RawSpan) -> str | None:
    for key in SESSION_ID_ATTRIBUTES:
        value = span.attributes.get(key)
        if value:
            return str(value)
    return None
