from loopview.store.memory import TraceStore
from tests.helpers import make_span

T1, T2, T3 = "a" * 32, "b" * 32, "c" * 32


def test_groups_spans_into_runs_by_trace_id() -> None:
    store = TraceStore()
    changed = store.add_spans(
        [make_span(T1, "01"), make_span(T2, "02"), make_span(T1, "03", parent_span_id="01")]
    )
    assert changed == [T1, T2]
    assert set(store.get_run(T1).spans) == {"01", "03"}  # type: ignore[union-attr]
    assert set(store.get_run(T2).spans) == {"02"}  # type: ignore[union-attr]


def test_run_grows_across_batches_and_ignores_resent_spans() -> None:
    store = TraceStore()
    store.add_spans([make_span(T1, "02", parent_span_id="01", name="child")], received_at_ns=10)
    store.add_spans([make_span(T1, "02", parent_span_id="01", name="child")], received_at_ns=20)
    store.add_spans([make_span(T1, "01", name="root")], received_at_ns=30)

    run = store.get_run(T1)
    assert run is not None
    assert len(run.spans) == 2
    assert run.received_ns == {"02": 10, "01": 30}  # first arrival is kept
    assert (run.first_received_ns, run.last_received_ns) == (10, 30)


def test_root_is_unknown_until_it_arrives() -> None:
    # Exporters send spans when they end; the root ends last.
    store = TraceStore()
    store.add_spans([make_span(T1, "02", parent_span_id="01", name="tool", start=5)])
    run = store.get_run(T1)
    assert run is not None and run.root is None

    store.add_spans([make_span(T1, "01", name="agent", start=0)])
    assert run.root is not None and run.root.name == "agent"


def test_sessions_from_either_convention() -> None:
    store = TraceStore()
    store.add_spans([make_span(T1, "01", gen_ai__conversation__id="conv-1")], received_at_ns=1)
    store.add_spans([make_span(T2, "02", session__id="conv-1")], received_at_ns=2)
    store.add_spans([make_span(T3, "03")], received_at_ns=3)

    [session] = store.sessions()
    assert session.session_id == "conv-1"
    assert session.trace_ids == [T1, T2]
    assert store.get_run(T3).session_id is None  # type: ignore[union-attr]


def test_session_id_found_on_any_span_of_the_run() -> None:
    store = TraceStore()
    store.add_spans([make_span(T1, "02", parent_span_id="01")])
    store.add_spans([make_span(T1, "01", session__id="s")])
    assert store.get_run(T1).session_id == "s"  # type: ignore[union-attr]


def test_evicts_least_recently_updated_run() -> None:
    store = TraceStore(max_runs=2)
    store.add_spans([make_span(T1, "01")], received_at_ns=1)
    store.add_spans([make_span(T2, "02")], received_at_ns=2)
    store.add_spans([make_span(T1, "03")], received_at_ns=3)  # T1 is still live
    store.add_spans([make_span(T3, "04")], received_at_ns=4)

    assert store.get_run(T2) is None
    assert [r.trace_id for r in store.runs()] == [T3, T1]  # newest first


def test_session_prefers_the_outermost_span() -> None:
    store = TraceStore()
    # The nested agent's span arrives first, with its own conversation id.
    store.add_spans([make_span(T1, "02", parent_span_id="01", gen_ai__conversation__id="inner")])
    assert store.get_run(T1).session_id == "inner"  # type: ignore[union-attr]
    store.add_spans([make_span(T1, "01", gen_ai__conversation__id="outer")])
    assert store.get_run(T1).session_id == "outer"  # type: ignore[union-attr]
