"""Provider registry. Map a provider name -> AgentProvider instance."""

from __future__ import annotations

from .base import AgentProvider, ProviderResult
from .devin_provider import DevinProvider
from .echo_provider import EchoProvider

_PROVIDERS = {
    "devin": DevinProvider,
    "echo": EchoProvider,
}


def get_provider(name: str) -> AgentProvider:
    key = (name or "devin").lower()
    if key not in _PROVIDERS:
        raise ValueError(f"Unknown provider '{name}'. Known: {', '.join(sorted(_PROVIDERS))}")
    return _PROVIDERS[key]()


def known_providers() -> list[str]:
    return sorted(_PROVIDERS)


__all__ = ["AgentProvider", "ProviderResult", "get_provider", "known_providers"]
