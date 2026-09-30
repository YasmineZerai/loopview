"""The FastAPI application.

One process serves everything on one port:
- the browser UI (static files built from ui/),
- a small JSON API under /api,
- later, the OTLP receiver at /v1/traces (M1) and the live event stream (M5).
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

from loopview import __version__

# The UI build (vite) writes its output here. It is generated, not committed.
STATIC_DIR = Path(__file__).parent / "static"

# Shown when someone runs the server from a source checkout without building the UI.
_MISSING_UI_PAGE = """<!doctype html>
<html><body style="font-family:sans-serif;background:#0a0a0b;color:#e5e5e5;padding:40px">
<h1>loopview is running</h1>
<p>The UI has not been built. Run <code>npm run build</code> in <code>ui/</code>.</p>
</body></html>"""


def create_app(static_dir: Path = STATIC_DIR) -> FastAPI:
    app = FastAPI(title="loopview", version=__version__)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok", "version": __version__}

    if (static_dir / "index.html").exists():
        # html=True makes "/" serve index.html. Mounted last so /api and /v1 win.
        app.mount("/", StaticFiles(directory=static_dir, html=True), name="ui")
    else:

        @app.get("/", response_class=HTMLResponse)
        def missing_ui() -> str:
            return _MISSING_UI_PAGE

    return app
