"""loopview-sdk: connect an agent to loopview.

    import loopview_sdk
    loopview_sdk.connect()          # exporter, instrumentation, content, flush at exit

    with loopview_sdk.agent("name"):  # only for hand-written loops with no agent span
        ...

LiveStartProcessor, the start reporter connect() adds, can also be used on its own.
"""

from loopview_sdk._live import LiveStartProcessor
from loopview_sdk.connect import agent, choose_instrumentors, connect

__all__ = ["LiveStartProcessor", "agent", "choose_instrumentors", "connect"]
__version__ = "0.2.0"
