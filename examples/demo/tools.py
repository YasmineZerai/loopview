"""Local, deterministic tools for the flagship demo.

The numbers are plausible but illustrative; the demo is about showing control
flow, not about database advice. No network access, no API besides the model.
"""

from langchain_core.tools import tool

DATABASES = ("postgresql", "sqlite", "duckdb")


def _db(name: str) -> str:
    key = name.strip().lower().replace(" ", "")
    if key in ("postgres", "pg"):
        key = "postgresql"
    if key not in DATABASES:
        raise ValueError(f"unknown database {name!r}; expected one of {', '.join(DATABASES)}")
    return key


# --- benchmarks analyst ------------------------------------------------------------

_BENCHMARKS = {
    "postgresql": {"agg_query_20gb_s": 14.2, "point_lookup_ms": 0.4, "concurrent_writers": "many"},
    "sqlite": {"agg_query_20gb_s": 61.0, "point_lookup_ms": 0.1, "concurrent_writers": "one"},
    "duckdb": {"agg_query_20gb_s": 2.1, "point_lookup_ms": 3.5, "concurrent_writers": "one"},
}


@tool
def run_benchmark(database: str) -> dict:
    """Results of a standard analytics benchmark (20 GB of events) for a database."""
    return {"database": _db(database), **_BENCHMARKS[_db(database)]}


@tool
def dataset_profile() -> dict:
    """Shape of the dashboard's data and workload."""
    return {"size_gb": 20, "daily_new_rows": 2_000_000, "users": 5,
            "queries": "group-by aggregations over months of events"}


# --- operations analyst ------------------------------------------------------------

_DOCS = {
    "postgresql": "Client-server. Needs a running service, backups via pg_dump or WAL "
                  "archiving, user management, upgrades between major versions.",
    "sqlite": "Embedded, single file. Backups are file copies. One writer at a time. "
              "No server to operate.",
    "duckdb": "Embedded, single file, columnar. Reads Parquet and CSV directly. One writer "
              "process at a time. No server to operate.",
}
_HOSTING_EUR_MONTH = {"postgresql": 45, "sqlite": 0, "duckdb": 0}


@tool
def read_docs(database: str) -> str:
    """Operations notes from the official documentation for a database."""
    return _DOCS[_db(database)]


@tool
def hosting_cost(database: str) -> dict:
    """Estimated monthly hosting cost in EUR for this workload."""
    return {"database": _db(database), "eur_per_month": _HOSTING_EUR_MONTH[_db(database)]}


# --- ecosystem analyst -------------------------------------------------------------

_REPO_STATS = {
    "postgresql": {"first_release": 1996, "contributors": "400+", "release_cadence": "yearly"},
    "sqlite": {"first_release": 2000, "contributors": "small core team",
               "release_cadence": "several per year"},
    "duckdb": {"first_release": 2019, "contributors": "400+", "release_cadence": "quarterly"},
}
_INTEGRATIONS = {
    "postgresql": ["Metabase", "Grafana", "Superset", "dbt", "every ORM"],
    "sqlite": ["Metabase", "Datasette", "most ORMs"],
    "duckdb": ["Metabase (community driver)", "Superset", "dbt", "pandas", "Polars"],
}

# The first call fails, like a flaky network call would, so the demo shows an
# error and a retry. Deterministic: always exactly one failure per process.
_repo_stats_calls = 0


@tool
def fetch_repo_stats(database: str) -> dict:
    """Project health statistics for a database (age, contributors, release cadence)."""
    global _repo_stats_calls
    _repo_stats_calls += 1
    if _repo_stats_calls == 1:
        raise TimeoutError("repository statistics service timed out, please retry")
    return {"database": _db(database), **_REPO_STATS[_db(database)]}


@tool
def dashboard_integrations(database: str) -> list[str]:
    """Dashboard and data tools that connect to a database."""
    return _INTEGRATIONS[_db(database)]


# --- writer ------------------------------------------------------------------------


@tool
def format_table(rows: list[list[str]]) -> str:
    """Format rows (the first row is the header) as a Markdown table."""
    header, *body = rows
    lines = ["| " + " | ".join(header) + " |", "|" + "---|" * len(header)]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)
