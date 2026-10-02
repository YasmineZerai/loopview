"""The FastAPI application.

One process serves everything on one port:
- the OTLP/HTTP trace receiver at POST /v1/traces,
- the JSON API and the live event stream under /api,
- the browser UI (static files built from ui/).

The UI only ever receives the normalized schema (normalize/schema.py), never
raw spans; /api/runs/{id}/spans exists for debugging.
"""

import json
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from loopview import __version__
from loopview.cost.pricing import Pricing
from loopview.ingest.otlp import (
    JSON,
    MAX_BODY_BYTES,
    BodyTooLarge,
    OtlpDecodeError,
    UnsupportedContentType,
    decode_body,
    decompress,
    encode_success_response,
    spans_to_otlp_json,
)
from loopview.ingest.raw import RawSpan
from loopview.live import LiveHub, running
from loopview.normalize.schema import NormalizedRun, RunInfo
from loopview.store.capture import CapturedRequest, CaptureWriter, from_line, load_capture, to_line
from loopview.store.memory import SessionSummary, TraceStore

# The UI build (vite) writes its output here. It is generated, not committed.
STATIC_DIR = Path(__file__).parent / "static"
# The flagship demo run, recorded from examples/demo (a copy of fixtures/flagship.otlp.jsonl).
DEMO_RECORDING = Path(__file__).parent / "demo_data" / "flagship.otlp.jsonl"

# Shown when someone runs the server from a source checkout without building the UI.
_MISSING_UI_PAGE = """<!doctype html>
<html><body style="font-family:sans-serif;background:#0a0a0b;color:#e5e5e5;padding:40px">
<h1>loopview is running</h1>
<p>The UI has not been built. Run <code>npm run build</code> in <code>ui/</code>.</p>
</body></html>"""


def create_app(
    store: TraceStore | None = None,
    capture: CaptureWriter | None = None,
    static_dir: Path = STATIC_DIR,
    pricing: Pricing | None = None,
) -> FastAPI:
    store = store if store is not None else TraceStore()
    hub = LiveHub(store, pricing)
    hub.mark(run.trace_id for run in store.runs())  # runs loaded from --persist

    @asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        async with running(hub):
            yield

    app = FastAPI(title="loopview", version=__version__, lifespan=lifespan)
    app.state.store = store
    app.state.hub = hub

    # --- OTLP receiver ----------------------------------------------------------

    @app.post("/v1/traces")
    async def receive_traces(request: Request) -> Response:
        # `async def` keeps every store update on the event loop, one at a time.
        content_type = request.headers.get("content-type", "")
        declared_length = int(request.headers.get("content-length") or 0)
        if declared_length > MAX_BODY_BYTES:
            raise HTTPException(413, "request body too large")
        try:
            body = decompress(await request.body(), request.headers.get("content-encoding"))
            spans = decode_body(body, content_type)
        except UnsupportedContentType as exc:
            raise HTTPException(415, str(exc)) from exc
        except BodyTooLarge as exc:
            raise HTTPException(413, str(exc)) from exc
        except OtlpDecodeError as exc:
            # 400 tells the exporter not to retry.
            raise HTTPException(400, str(exc)) from exc

        received_at_ns = time.time_ns()
        hub.mark(store.add_spans(spans, received_at_ns=received_at_ns))
        if capture is not None:
            capture.write(CapturedRequest(received_at_ns, content_type, body))

        payload, media_type = encode_success_response(content_type)
        return Response(content=payload, media_type=media_type)

    @app.post("/v1/loopview/span-starts")
    async def receive_span_starts(request: Request) -> Response:
        """Start reports from loopview-sdk: OTLP-encoded spans that have just
        started (no end time). Standard exporters only send ended spans, so this
        is what lets a step show as running the moment it begins."""
        content_type = request.headers.get("content-type", "")
        try:
            body = decompress(await request.body(), request.headers.get("content-encoding"))
            spans = decode_body(body, content_type)
        except UnsupportedContentType as exc:
            raise HTTPException(415, str(exc)) from exc
        except OtlpDecodeError as exc:
            raise HTTPException(400, str(exc)) from exc
        hub.mark(store.add_started_spans(spans))
        payload, media_type = encode_success_response(content_type)
        return Response(content=payload, media_type=media_type)

    # --- normalized runs and live events ------------------------------------------

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    @app.get("/api/runs")
    def list_runs() -> list[RunInfo]:
        return hub.run_infos()

    @app.get("/api/runs/{trace_id}")
    def get_run(trace_id: str) -> NormalizedRun:
        normalized = hub.get(trace_id)
        if normalized is None:
            raise HTTPException(404, "run not found")
        return normalized

    @app.get("/api/sessions")
    def list_sessions() -> list[SessionSummary]:
        return store.sessions()

    @app.get("/api/events")
    async def events() -> StreamingResponse:
        return StreamingResponse(
            hub.events(),
            media_type="text/event-stream",
            headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
        )

    # --- import, export, demo -----------------------------------------------------

    @app.get("/api/runs/{trace_id}/export")
    def export_run(trace_id: str) -> Response:
        """The run as a capture file: one OTLP/JSON request per original arrival
        batch, so importing it replays the same timing."""
        run = store.get_run(trace_id)
        if run is None:
            raise HTTPException(404, "run not found")
        batches: dict[int, list[RawSpan]] = {}
        for span_id, span in run.spans.items():
            batches.setdefault(run.received_ns[span_id], []).append(span)
        lines = [
            to_line(CapturedRequest(received, JSON, json.dumps(spans_to_otlp_json(spans)).encode()))
            for received, spans in sorted(batches.items())
        ]
        return Response(
            content="\n".join(lines) + "\n",
            media_type="application/x-ndjson",
            headers={"Content-Disposition": f'attachment; filename="run-{trace_id[:8]}.jsonl"'},
        )

    @app.post("/api/import")
    async def import_runs(request: Request) -> dict[str, list[str]]:
        changed: list[str] = []
        try:
            for line in (await request.body()).decode("utf-8").splitlines():
                if not line.strip():
                    continue
                captured = from_line(line)
                spans = decode_body(captured.body, captured.content_type)
                changed += store.add_spans(spans, received_at_ns=captured.received_at_ns)
        except (ValueError, KeyError, TypeError) as exc:
            raise HTTPException(400, f"not a loopview JSONL file: {exc}") from exc
        hub.mark(changed)
        return {"trace_ids": sorted(set(changed))}

    @app.post("/api/demo")
    def load_demo() -> dict[str, list[str]]:
        return {"trace_ids": load_demo_into(store, hub)}

    @app.get("/api/runs/{trace_id}/spans")
    def run_spans(trace_id: str) -> list[RawSpan]:
        """Raw spans of one run, for debugging only. The UI never uses this."""
        run = store.get_run(trace_id)
        if run is None:
            raise HTTPException(404, "run not found")
        return sorted(run.spans.values(), key=lambda s: s.start_time_unix_nano)

    # --- UI ---------------------------------------------------------------------

    if (static_dir / "index.html").exists():
        # html=True makes "/" serve index.html. Mounted last so /api and /v1 win.
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    else:

        @app.get("/", response_class=HTMLResponse)
        def missing_ui() -> str:
            return _MISSING_UI_PAGE

    return app


def load_demo_into(store: TraceStore, hub: LiveHub | None = None) -> list[str]:
    """Load the bundled demo recording. Loading it twice is harmless: spans are
    keyed by id, so the same run is simply updated."""
    demo = TraceStore()
    load_capture(demo, DEMO_RECORDING)
    trace_ids = [run.trace_id for run in demo.runs()]
    load_capture(store, DEMO_RECORDING)
    if hub is not None:
        hub.mark(trace_ids)
    return trace_ids
