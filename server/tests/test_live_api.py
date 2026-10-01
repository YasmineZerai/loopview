"""Live hub, normalized API, import/export and the demo, through HTTP."""

import json
from pathlib import Path

from fastapi.testclient import TestClient

from loopview.app import DEMO_RECORDING, create_app
from loopview.live import LiveHub
from loopview.store.capture import read_capture
from loopview.store.memory import TraceStore
from tests.helpers import make_span

FIXTURES = Path(__file__).resolve().parents[2] / "fixtures"
T = "a" * 32


def test_bundled_demo_is_the_flagship_fixture() -> None:
    assert DEMO_RECORDING.read_bytes() == (FIXTURES / "flagship.otlp.jsonl").read_bytes()


def test_end_to_end_fixture_replayed_into_the_receiver() -> None:
    """Replay a real capture request by request through POST /v1/traces and check
    the normalized result served to the UI."""
    client = TestClient(create_app(store=TraceStore()))
    for request in read_capture(FIXTURES / "langgraph_router.otlp.jsonl"):
        response = client.post(
            "/v1/traces", content=request.body, headers={"content-type": request.content_type}
        )
        assert response.status_code == 200

    [info] = client.get("/api/runs").json()
    run = client.get(f"/api/runs/{info['id']}").json()
    visible = [s for s in run["steps"] if not s["hidden"]]
    assert {s["name"] for s in visible if s["kind"] == "node"} == {
        "classify",
        "agent",
        "tools",
        "review",
    }
    assert sum(t["kind"] == "loop" for t in run["transitions"]) == 3
    # The UI never gets raw span fields.
    assert "attributes" not in json.dumps(run["run"])


def test_hub_pushes_only_changed_steps() -> None:
    store = TraceStore()
    hub = LiveHub(store)
    events: list[dict] = []
    hub._publish = lambda payload: events.append(json.loads(payload))  # type: ignore[method-assign]

    hub.mark(store.add_spans([make_span(T, "02", parent_span_id="01", name="x", start=0, end=5)]))
    hub.flush()
    first = events[-1]
    assert first["type"] == "run.update" and first["run"]["status"] == "running"
    assert {s["id"] for s in first["steps"]} == {"01", "02"}  # 01 is inferred, running

    hub.mark(store.add_spans([make_span(T, "01", name="root", start=0, end=10)]))
    hub.flush()
    second = events[-1]
    root = next(s for s in second["steps"] if s["id"] == "01")
    assert root["inferred"] is False and root["name"] == "root"
    assert second["run"]["status"] == "ok"

    hub.mark([T])  # nothing new arrived
    hub.flush()
    assert events[-1]["steps"] == []  # so no step is sent again


def test_export_then_import_gives_the_same_run() -> None:
    source = TestClient(create_app(store=TraceStore()))
    [trace_id] = source.post("/api/demo").json()["trace_ids"]
    original = source.get(f"/api/runs/{trace_id}").json()
    exported = source.get(f"/api/runs/{trace_id}/export")
    assert exported.headers["content-type"].startswith("application/x-ndjson")

    target = TestClient(create_app(store=TraceStore()))
    assert target.post("/api/import", content=exported.content).json() == {"trace_ids": [trace_id]}
    imported = target.get(f"/api/runs/{trace_id}").json()
    assert imported["steps"] == original["steps"]
    assert imported["transitions"] == original["transitions"]


def test_import_rejects_garbage() -> None:
    client = TestClient(create_app(store=TraceStore()))
    assert client.post("/api/import", content=b"not json\n").status_code == 400


def test_demo_loads_once_even_if_requested_twice() -> None:
    client = TestClient(create_app(store=TraceStore()))
    first = client.post("/api/demo").json()["trace_ids"]
    second = client.post("/api/demo").json()["trace_ids"]
    assert first == second and len(client.get("/api/runs").json()) == 1


def test_unknown_normalized_run_is_404() -> None:
    client = TestClient(create_app(store=TraceStore()))
    assert client.get("/api/runs/" + "0" * 32).status_code == 404


def test_span_start_reports_show_running_steps_with_real_names() -> None:
    """loopview-sdk sends spans as they start; they appear running at once, and the
    ended span (from the normal exporter) replaces the start report."""
    client = TestClient(create_app(store=TraceStore()))
    start = {
        "resourceSpans": [
            {
                "resource": {"attributes": []},
                "scopeSpans": [
                    {
                        "scope": {"name": "s"},
                        "spans": [
                            {
                                "traceId": T,
                                "spanId": "00000000000000a1",
                                "name": "invoke_agent planner",
                                "kind": 1,
                                "startTimeUnixNano": "1000",
                                "attributes": [
                                    {
                                        "key": "gen_ai.operation.name",
                                        "value": {"stringValue": "invoke_agent"},
                                    },
                                    {
                                        "key": "gen_ai.agent.name",
                                        "value": {"stringValue": "planner"},
                                    },
                                ],
                            }
                        ],
                    }
                ],
            }
        ]
    }
    assert client.post("/v1/loopview/span-starts", json=start).status_code == 200

    run = client.get(f"/api/runs/{T}").json()
    [step] = run["steps"]
    assert (step["name"], step["kind"], step["status"], step["inferred"]) == (
        "planner",
        "agent",
        "running",
        False,
    )
    assert run["run"]["status"] == "running"

    ended = json.loads(json.dumps(start))
    ended["resourceSpans"][0]["scopeSpans"][0]["spans"][0]["endTimeUnixNano"] = "5000"
    client.post("/v1/traces", json=ended)
    [step] = client.get(f"/api/runs/{T}").json()["steps"]
    assert (step["status"], step["end_ns"]) == ("ok", 5000)


def test_unclassified_starts_show_only_directly_under_a_container() -> None:
    """With OpenInference, attributes arrive at the end: a started span is a bare
    name. Graph steps (children of the root) show as running; plumbing inside a
    step stays hidden until it ends."""
    from loopview.normalize.normalizer import normalize_run

    store = TraceStore()
    store.add_started_spans(
        [
            make_span(T, "01", name="graph", start=0, end=0),
            make_span(T, "02", parent_span_id="01", name="planner", start=1, end=0),
            make_span(T, "03", parent_span_id="02", name="ChatModel", start=2, end=0),
        ],
        received_at_ns=10,
    )
    steps = {s.name: s for s in normalize_run(store.get_run(T), now_ns=10).steps}  # type: ignore[arg-type]
    assert steps["planner"].kind == "node" and not steps["planner"].hidden
    assert steps["planner"].status == "running" and not steps["planner"].inferred
    assert steps["graph"].kind == "agent"  # contains a running step, so it's a group
    assert steps["ChatModel"].hidden


def test_close_ends_open_streams() -> None:
    """Shutdown must end the browser's event stream, or the server hangs on Ctrl+C."""
    import asyncio

    async def scenario() -> list[str]:
        hub = LiveHub(TraceStore())
        received: list[str] = []

        async def consume() -> None:
            async for message in hub.events():
                received.append(message)

        task = asyncio.create_task(consume())
        await asyncio.sleep(0.05)
        hub.close()
        await asyncio.wait_for(task, timeout=2)  # ends instead of waiting forever
        return received

    assert asyncio.run(scenario()) == [": connected\n\n"]
