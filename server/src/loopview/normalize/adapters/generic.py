"""Fallback adapter: any span no other adapter recognised.

It becomes an `unknown` step that keeps its raw attributes, so nothing is ever
dropped. Whether it is drawn is decided in the normalizer (unknown spans inside a
model or tool call, such as HTTP client spans, are implementation detail).
"""

from loopview.ingest.raw import RawSpan
from loopview.normalize.adapters.base import Classification, ParentHint


class GenericAdapter:
    name = "generic"

    def matches(self, span: RawSpan) -> bool:
        return True

    def classify(self, span: RawSpan) -> Classification:
        # MCP clients (mcp-python-sdk, fastmcp) trace their session housekeeping:
        # initialize, server/discover, tools/list. It is connection plumbing, not
        # a step of the agent's flow. Tool calls are the agent's framework's to show.
        method = span.attributes.get("mcp.method.name")
        hidden = method is not None and method != "tools/call"
        return Classification(
            "unknown", span.name, span.kind, hidden=hidden, attributes=dict(span.attributes)
        )

    def infer_parent(self, span: RawSpan) -> ParentHint | None:
        return None
