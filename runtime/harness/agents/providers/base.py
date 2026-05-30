"""
Agent provider interface.

A *provider* is a generic backend that can run an agent turn and hold a
resumable session. Devin CLI is one provider; others (Grok CLI, Claude, a
cloud API, a local model) implement the same contract. The harness adapter
(`bin/agent`) and the orchestrator only know this interface — never a specific
vendor — so swapping/adding agent backends is config, not code.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class ProviderResult:
    reply: str
    session_id: Optional[str] = None
    error: bool = False


class AgentProvider:
    """Base class for all agent providers."""

    #: short stable name, e.g. "devin", "echo"
    name: str = "base"

    #: whether this provider consumes paid API credits (informs guardrails)
    paid: bool = False

    def dispatch(self, agent: str, task: str, *, model: Optional[str],
                 workdir: Path, timeout: int = 600) -> ProviderResult:
        """Start a fresh session for `agent` on `task`. Returns reply + session id."""
        raise NotImplementedError

    def tell(self, agent: str, message: str, *, session_id: str, model: Optional[str],
             workdir: Path, timeout: int = 600) -> ProviderResult:
        """Continue an existing session (resume). Returns reply (+ possibly new id)."""
        raise NotImplementedError
