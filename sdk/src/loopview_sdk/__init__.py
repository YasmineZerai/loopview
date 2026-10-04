"""loopview-sdk: connect an agent to loopview.

    import loopview_sdk
    loopview_sdk.connect()          # exporter, instrumentation, content, flush at exit

    with loopview_sdk.agent("name"):  # only for hand-written loops with no agent span
        ...

    @loopview_sdk.tool                # optional: exact timing and errors for your tools
    def get_weather(city): ...

LiveStartProcessor, the start reporter connect() adds, can also be used on its own.
"""

from loopview_sdk._live import LiveStartProcessor
from loopview_sdk.connect import agent, rank_instrumentors, connect, tool

__all__ = ["LiveStartProcessor", "agent", "rank_instrumentors", "connect", "tool"]
__version__ = "0.2.0"
