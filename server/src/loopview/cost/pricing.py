"""Model prices, from a small JSON file the user can edit.

JSON rather than YAML: Python and browsers read it with no extra dependency.
JSON has no comments, so the file explains itself in an "_about" list, and each
price carries its source and the date it was checked.
"""

import json
import re
from functools import cache
from pathlib import Path

from pydantic import BaseModel

DEFAULT_PRICES = Path(__file__).parent / "pricing.json"


class ModelPrice(BaseModel):
    """USD per million tokens."""

    input: float
    output: float
    cache_read: float
    cache_write: float
    tool_prompt_tokens: int | None = None
    source: str
    checked: str


class Pricing(BaseModel):
    models: dict[str, ModelPrice]

    def for_model(self, model: str | None) -> tuple[str, ModelPrice] | None:
        """The longest key the model ID equals or starts with (then a dash), so a
        dated ID like claude-haiku-4-5-20251001 matches claude-haiku-4-5, and
        claude-sonnet-5-5 doesn't fall back to claude-sonnet-5."""
        if not model:
            return None
        for name in _model_names(model.lower()):
            matches = [k for k in self.models if name == k or name.startswith(k + "-")]
            if matches:
                key = max(matches, key=len)
                return key, self.models[key]
        return None


# Routers and clouds prefix the provider's model ID: LiteLLM "anthropic/...",
# Bedrock "us.anthropic.claude-...-v1:0", Vertex "claude-...@20251001".
_PROVIDER_PREFIX = re.compile(r"^(?:[a-z]{2,4}\.)?(?:anthropic|openai|meta|mistral)\.")


def _model_names(model: str) -> list[str]:
    """The ID as given, then without a router's or cloud's prefix."""
    bare = model.rsplit("/", 1)[-1].replace("@", "-")
    bare = _PROVIDER_PREFIX.sub("", bare)
    return [model] if bare == model else [model, bare]


def load_pricing(path: Path) -> Pricing:
    data = json.loads(path.read_text(encoding="utf-8"))
    return Pricing(models=data["models"])


@cache
def default_pricing() -> Pricing:
    return load_pricing(DEFAULT_PRICES)


def merged_pricing(override: Path | None) -> Pricing:
    """The bundled prices, with the user's file replacing or adding models."""
    base = default_pricing()
    if override is None:
        return base
    return Pricing(models={**base.models, **load_pricing(override).models})
