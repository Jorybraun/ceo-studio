"""
harness/config/paths.py

Single source of truth for the **two roots** the runtime cares about:

  - HARNESS_HOME      : where the engine *code* lives (this repo / install).
  - HARNESS_WORKSPACE : where a project's *data* lives (its `.harem/` dir).

The whole point of the extraction: code is installed once and shared, while
every project keeps its own state in `.harem/`. Tools must resolve **code**
relative to HARNESS_HOME and **data** relative to the workspace.

Backward compatibility (so nothing breaks before P2):
  - If `HARNESS_WORKSPACE` is NOT set, data resolves to the **legacy in-place
    locations** under HARNESS_HOME (exactly where they live today).
  - If `HARNESS_WORKSPACE` IS set (e.g. `<project>/.harem`), data resolves to
    the clean workspace layout defined in templates/workspace/.

stdlib-only by design (matches the rest of harness/config).
"""

from __future__ import annotations

import os
from pathlib import Path

HARNESS_HOME = Path(__file__).resolve().parent.parent


def _ws() -> Path | None:
    """The configured workspace, or None for legacy in-place mode."""
    w = os.environ.get("HARNESS_WORKSPACE")
    return Path(w).expanduser().resolve() if w else None


def workspace() -> Path:
    """Data root. Defaults to HARNESS_HOME (legacy) when no workspace is set."""
    return _ws() or HARNESS_HOME


# --- comms / rooms --------------------------------------------------------

def rooms_dir() -> Path:
    return workspace() / "brain" / "rooms"


def room_dir(room: str) -> Path:
    return rooms_dir() / room


def room_log(room: str) -> Path:
    return room_dir(room) / "chat.log"


# --- orchestrator state / logs / guardrail --------------------------------

def sessions_dir() -> Path:
    ws = _ws()
    return (ws / "sessions") if ws else (HARNESS_HOME / "agent-tmux" / "sessions")


def orchestrator_state_dir() -> Path:
    ws = _ws()
    if ws:
        return ws / "sessions" / "orchestrator-state"
    return HARNESS_HOME / "agent-tmux" / "sessions" / "kanban-finisher-state"


def logs_dir() -> Path:
    ws = _ws()
    return (ws / "sessions" / "logs") if ws else (HARNESS_HOME / "agent-tmux" / "logs")


def guardrail_dir() -> Path:
    """Where the spawn ledger + STOP sentinel live. CEO_GUARDRAIL_DIR overrides."""
    override = os.environ.get("CEO_GUARDRAIL_DIR")
    if override:
        return Path(override)
    ws = _ws()
    if ws:
        return ws / "sessions" / "cost-guardrail"
    return HARNESS_HOME / "agent-tmux" / "sessions" / "cost-guardrail"


# --- kanban / stage map ---------------------------------------------------

def kanban_path(domain: str = "all") -> Path:
    ws = _ws()
    if ws:
        return ws / "kanban" / f"{domain}.md"
    # legacy: per-domain team folder
    return HARNESS_HOME / "context" / f"{domain}-team" / "mgmt" / "kanban.md"


def stage_map_path(domain: str = "all") -> Path:
    ws = _ws()
    if ws:
        return ws / "mgmt" / "stage-map.md"
    return HARNESS_HOME / "context" / f"{domain}-team" / "mgmt" / "stage-map.md"
