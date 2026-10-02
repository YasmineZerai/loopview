"""The live hub: keeps normalized runs up to date and pushes changes to browsers.

Flow:
    receiver -> store.add_spans -> hub.mark(trace ids)
    every 100 ms: for each marked run, normalize it, work out which steps changed
    since the last push, and send one event to every connected browser.

Batching every 100 ms bounds the work when an exporter sends many small requests,
and makes one event per run per tick. Events are idempotent upserts, so a browser
can fetch a full snapshot and subscribe in any order without losing anything.

Transport is Server-Sent Events (see DECISIONS.md D7): one HTTP response that
stays open, each event a `data: {json}` line.
"""

import asyncio
import contextlib
import time
from collections.abc import AsyncIterator, Iterable

from loopview.cost.pricing import Pricing
from loopview.normalize.normalizer import normalize_run
from loopview.normalize.schema import NormalizedRun, RunInfo
from loopview.store.memory import TraceStore

FLUSH_INTERVAL_S = 0.1
# Runs still marked running are re-checked this often, so a run whose process
# died flips to finished without any new data arriving.
STALE_CHECK_INTERVAL_S = 2.0
HEARTBEAT_INTERVAL_S = 15.0
MAX_QUEUED_EVENTS = 1000


class LiveHub:
    def __init__(self, store: TraceStore, pricing: Pricing | None = None) -> None:
        self.store = store
        self.pricing = pricing  # None: the bundled prices
        self._dirty: set[str] = set()
        self._cache: dict[str, NormalizedRun] = {}
        # Per run, the JSON of each step as last pushed, to send only what changed.
        self._pushed: dict[str, dict[str, str]] = {}
        # Each browser's queue of SSE messages; None tells the stream to end.
        self._subscribers: set[asyncio.Queue[str | None]] = set()
        self._closing = False

    # --- called by the receiver and the API --------------------------------------------

    def mark(self, trace_ids: Iterable[str]) -> None:
        self._dirty.update(trace_ids)

    def get(self, trace_id: str) -> NormalizedRun | None:
        if trace_id in self._dirty or trace_id not in self._cache:
            run = self.store.get_run(trace_id)
            if run is None:
                return None
            self._cache[trace_id] = normalize_run(run, pricing=self.pricing)
        return self._cache[trace_id]

    def run_infos(self) -> list[RunInfo]:
        infos = []
        for run in self.store.runs():
            normalized = self.get(run.trace_id)
            if normalized is not None:
                infos.append(normalized.run)
        return infos

    # --- subscribers ------------------------------------------------------------------

    async def events(self) -> AsyncIterator[str]:
        """Yield SSE-formatted events for one browser until it disconnects or the
        server shuts down."""
        queue: asyncio.Queue[str | None] = asyncio.Queue(MAX_QUEUED_EVENTS)
        self._subscribers.add(queue)
        try:
            yield ": connected\n\n"
            while not self._closing:
                try:
                    message = await asyncio.wait_for(queue.get(), HEARTBEAT_INTERVAL_S)
                except TimeoutError:
                    yield ": heartbeat\n\n"  # keeps proxies from closing the connection
                    continue
                if message is None:
                    return
                yield message
        finally:
            self._subscribers.discard(queue)

    def close(self) -> None:
        """End every open stream. Called when the server starts shutting down:
        a stream never ends on its own, and the server waits for open
        connections before it stops, so without this Ctrl+C would hang."""
        self._closing = True
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(None)
            except asyncio.QueueFull:
                self._subscribers.discard(queue)

    def _publish(self, payload: str) -> None:
        for queue in list(self._subscribers):
            try:
                queue.put_nowait(f"data: {payload}\n\n")
            except asyncio.QueueFull:
                # A browser that stopped reading: drop it; it reconnects and refetches.
                self._subscribers.discard(queue)

    # --- the background loop ------------------------------------------------------------

    async def run_forever(self) -> None:
        last_stale_check = time.monotonic()
        while True:
            await asyncio.sleep(FLUSH_INTERVAL_S)
            if time.monotonic() - last_stale_check > STALE_CHECK_INTERVAL_S:
                last_stale_check = time.monotonic()
                self.mark(t for t, n in self._cache.items() if n.run.status == "running")
            self.flush()

    def flush(self) -> None:
        dirty, self._dirty = self._dirty, set()
        for trace_id in dirty:
            run = self.store.get_run(trace_id)
            if run is None:  # evicted from the ring buffer
                self._cache.pop(trace_id, None)
                self._pushed.pop(trace_id, None)
                continue
            normalized = normalize_run(run, pricing=self.pricing)
            self._cache[trace_id] = normalized
            pushed = self._pushed.setdefault(trace_id, {})
            changed = []
            for step in normalized.steps:
                as_json = step.model_dump_json()
                if pushed.get(step.id) != as_json:
                    pushed[step.id] = as_json
                    changed.append(as_json)
            transitions = ",".join(t.model_dump_json() for t in normalized.transitions)
            self._publish(
                f'{{"type":"run.update","run":{normalized.run.model_dump_json()},'
                f'"steps":[{",".join(changed)}],"transitions":[{transitions}]}}'
            )
        # Forget caches of runs the store evicted without them being marked.
        for trace_id in [t for t in self._cache if self.store.get_run(t) is None]:
            self._cache.pop(trace_id, None)
            self._pushed.pop(trace_id, None)


@contextlib.asynccontextmanager
async def running(hub: LiveHub) -> AsyncIterator[None]:
    task = asyncio.create_task(hub.run_forever())
    try:
        yield
    finally:
        task.cancel()
        with contextlib.suppress(asyncio.CancelledError):
            await task
