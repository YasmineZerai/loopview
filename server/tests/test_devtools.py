"""The tools that build the hosted demo's data: extracting one run from a recording,
the Tools report snapshot of a recording too big to ship, and the demo build itself."""

import json
import sys
from pathlib import Path

import pytest

from loopview.devtools import dump_normalized
from loopview.devtools.extract_run import extract
from loopview.devtools.tools_snapshot import keep_links
from loopview.normalize.normalizer import normalize_run
from loopview.store.capture import load_capture
from loopview.store.memory import Run, TraceStore
from loopview.tools.report import tools_report
from tests.test_normalize_fixtures import FIXTURES


def runs_of(capture: Path) -> list[Run]:
    store = TraceStore()
    load_capture(store, capture)
    return sorted(store.runs(), key=lambda r: r.first_received_ns)


def test_an_extracted_run_normalizes_exactly_like_the_original(tmp_path: Path) -> None:
    # The study's requests carry its 21 runs; take one from the middle.
    original = runs_of(FIXTURES / "mcp_tools_study.otlp.jsonl")[10]
    out = tmp_path / "one.otlp.jsonl"
    assert extract(FIXTURES / "mcp_tools_study.otlp.jsonl", original.trace_id, out) > 0
    [copy] = runs_of(out)
    assert copy.trace_id == original.trace_id
    before = normalize_run(original, now_ns=original.last_received_ns)
    after = normalize_run(copy, now_ns=copy.last_received_ns)
    assert after.model_dump_json() == before.model_dump_json()


def test_redaction_replaces_a_string_everywhere(tmp_path: Path) -> None:
    original = runs_of(FIXTURES / "failing_tools_pydantic.otlp.jsonl")[0]
    out = tmp_path / "redacted.otlp.jsonl"
    extract(
        FIXTURES / "failing_tools_pydantic.otlp.jsonl",
        original.trace_id,
        out,
        {"SKU-0099": "SKU-X"},
    )
    [copy] = runs_of(out)
    text = json.dumps([s.model_dump(mode="json") for s in copy.spans.values()])
    assert "SKU-0099" not in text and "SKU-X" in text


def test_a_snapshot_links_only_into_the_runs_the_demo_has() -> None:
    runs = [
        normalize_run(r, now_ns=r.last_received_ns)
        for r in runs_of(FIXTURES / "mcp_tools_study.otlp.jsonl")
    ]
    kept = runs[5].run.id
    report = keep_links(tools_report(runs), {kept})
    refs = [r for t in report["tools"] for r in t["step_refs"]]
    assert refs and all(r["run_id"] == kept for r in refs)
    examples = [e for t in report["tools"] for e in t["top_errors"]]
    assert all(e["step_ref"] is None or e["step_ref"]["run_id"] == kept for e in examples)
    assert all(e["example_message"] for e in examples)  # the message stays without its link


def test_the_demo_snapshot_matches_its_listed_run() -> None:
    """Every link in the demo's Tools tab must open a run the demo lists."""
    snapshot = json.loads(dump_normalized.DEMO_TOOLS_SNAPSHOT.read_text(encoding="utf-8"))
    [team] = runs_of(FIXTURES / "issuescout_team.otlp.jsonl")
    assert snapshot["summary"]["runs"] == 78
    refs = [r for t in snapshot["tools"] for r in t["step_refs"]]
    refs += [e["step_ref"] for t in snapshot["tools"] for e in t["top_errors"] if e["step_ref"]]
    assert refs and all(r["run_id"] == team.trace_id for r in refs)


def test_the_bug_triage_team_is_a_supervisor_three_parallel_investigators_and_a_writer() -> None:
    [run] = runs_of(FIXTURES / "issuescout_team.otlp.jsonl")
    n = normalize_run(run, now_ns=run.last_received_ns)
    agents = {s.name: s for s in n.steps if s.kind == "agent" and not s.synthetic}
    assert set(agents) == {"supervisor", "historian", "code_detective", "docs_checker", "writer"}
    assert n.run.name == "triage langchain-ai/langgraph#8550" and n.run.status == "ok"
    investigators = [agents[a] for a in ("historian", "code_detective", "docs_checker")]
    assert max(a.start_ns for a in investigators) < min(a.end_ns or 0 for a in investigators)
    assert agents["supervisor"].end_ns <= min(a.start_ns for a in investigators)
    assert agents["writer"].start_ns >= max(a.end_ns or 0 for a in investigators)
    failed = [s.name for s in n.steps if s.kind == "tool_call" and s.status == "error"]
    assert sorted(failed) == ["get_file_contents", "search_commits"]


def test_the_demo_build_lists_its_runs_and_ships_the_snapshot(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(sys, "argv", ["dump_normalized", str(tmp_path), "--index"])
    dump_normalized.main()
    index = json.loads((tmp_path / "index.json").read_text(encoding="utf-8"))
    assert [e["file"].removesuffix(".json") for e in index] == list(dump_normalized.DEMO_RUNS)
    assert all(e["listed"] for e in index)
    tools = json.loads((tmp_path / "tools.json").read_text(encoding="utf-8"))
    assert tools["about"] == dump_normalized.DEMO_TOOLS_ABOUT
    assert tools["summary"]["runs"] == 78
