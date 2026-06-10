"""Provider registry. Map a provider name -> AgentProvider instance."""

from __future__ import annotations

from .base import AgentProvider, ProviderResult
from .claude_provider import ClaudeProvider
from .codex_provider import CodexProvider
from .command_provider import CommandProvider
from .devin_provider import DevinProvider
from .echo_provider import EchoProvider
from .grok_provider import GrokProvider
from .hermes_provider import HermesProvider
from .pi_provider import PiProvider
from .vertex_provider import VertexProvider

_PROVIDERS = {
    "claude": ClaudeProvider,
    "codex": CodexProvider,
    "command": CommandProvider,
    "devin": DevinProvider,
    # `echo` is offline test scaffolding (free, deterministic). It is intentionally
    # kept registered for tests/meeting smoke-runs but hidden from the cockpit UI.
    "echo": EchoProvider,
    "grok": GrokProvider,
    "hermes": HermesProvider,
    "pi": PiProvider,
    "vertex": VertexProvider,
}


def get_provider(name: str) -> AgentProvider:
    key = (name or "devin").lower()
    if key not in _PROVIDERS:
        raise ValueError(f"Unknown provider '{name}'. Known: {', '.join(sorted(_PROVIDERS))}")
    return _PROVIDERS[key]()


def known_providers() -> list[str]:
    return sorted(_PROVIDERS)


__all__ = ["AgentProvider", "ProviderResult", "get_provider", "known_providers"]
