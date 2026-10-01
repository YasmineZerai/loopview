"""The adapter registry. The first adapter whose `matches` is true wins, so the
generic fallback must stay last."""

from loopview.ingest.raw import RawSpan
from loopview.normalize.adapters.base import Adapter
from loopview.normalize.adapters.gen_ai import GenAiAdapter
from loopview.normalize.adapters.generic import GenericAdapter
from loopview.normalize.adapters.openinference import OpenInferenceAdapter

ADAPTERS: list[Adapter] = [OpenInferenceAdapter(), GenAiAdapter(), GenericAdapter()]


def adapter_for(span: RawSpan) -> Adapter:
    return next(a for a in ADAPTERS if a.matches(span))
