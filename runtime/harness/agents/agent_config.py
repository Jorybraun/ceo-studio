"""
Declarative agent registry config.

The "add any agent I want" seam. Agents (and teams) are declared in a plain
JSON file so wiring a new swarm/meeting member is **config, not code**:

  {
    "agents": [
      {"id": "ba",        "provider": "echo",  "persona": "ba"},
      {"id": "architect", "provider": "grok",  "persona": "architect", "model": "grok-build",
       "capabilities": ["adr", "data-model"]},
      {"id": "researcher","provider": "devin", "persona": "DEEP_RESEARCHER"}
    ],
    "teams": { "discovery-planning": ["ba", "architect", "pm"] }
  }

Each agent maps a stable id -> {provider, persona, model, capabilities}. A
provider is any registered harness provider (devin/echo/grok/...), so the same
config can mix vendors freely. Teams are named lists of agent ids.

Resolution order (first id/team wins), so a project can override the shipped
defaults:
  1. $CEO_AGENTS_CONFIG (explicit file path)
  2. <workspace>/agents.json   (the active project's data dir)
  3. <HARNESS_HOME>/agents/agents.json  (shipped defaults)

stdlib-only (JSON) by design — no extra dependency.
"""

from __future__ import annotations

import json
import os
from pathlib import Path

from config import paths


def _config_paths() -> list[Path]:
    out: list[Path] = []
    env = os.environ.get("CEO_AGENTS_CONFIG", "").strip()
    if env:
        out.append(Path(env).expanduser())
    out.append(paths.workspace() / "agents.json")
    out.append(paths.HARNESS_HOME / "agents" / "agents.json")
    seen, uniq = set(), []
    for p in out:
        rp = str(p.resolve())
        if rp not in seen:
            seen.add(rp)
            uniq.append(p)
    return uniq


def load_config() -> dict:
    """Merged config: {'agents': {id: spec}, 'teams': {name: [ids]}, 'sources': [...]}.
    First definition of an id/team wins (project overrides shipped defaults)."""
    agents: dict[str, dict] = {}
    teams: dict[str, list] = {}
    sources: list[str] = []
    for p in _config_paths():
        if not p.exists():
            continue
        try:
            data = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        sources.append(str(p))
        for spec in data.get("agents", []) or []:
            aid = str(spec.get("id") or "").strip()
            if aid and aid not in agents:
                agents[aid] = {
                    "id": aid,
                    "name": spec.get("name"),
                    "provider": spec.get("provider", "echo"),
                    "persona": spec.get("persona"),
                    "model": spec.get("model"),
                    "room": spec.get("room"),
                    "tmux_session": spec.get("tmux_session"),
                    "tmux_window": spec.get("tmux_window"),
                    "capabilities": spec.get("capabilities", []) or [],
                    "description": spec.get("description", ""),
                    # Generic command provider: CLI template + cost hint.
                    "command": spec.get("command"),
                    "paid": spec.get("paid"),
                    "memory_key": spec.get("memory_key"),
                }
        for name, ids in (data.get("teams", {}) or {}).items():
            if name not in teams and isinstance(ids, list):
                teams[name] = [str(i) for i in ids]
    return {"agents": agents, "teams": teams, "sources": sources}


def get_agent(agent_id: str) -> dict | None:
    return load_config()["agents"].get(str(agent_id or "").strip())


def get_team(team_name: str) -> list[str]:
    return load_config()["teams"].get(str(team_name or "").strip(), [])


def list_agents() -> list[dict]:
    return list(load_config()["agents"].values())


def list_teams() -> dict:
    return load_config()["teams"]


if __name__ == "__main__":
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    print(json.dumps(load_config(), indent=2))
