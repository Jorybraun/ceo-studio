"""
harness/agents/registry.py

Central, machine-readable agent registry for the herder.

This is the source of truth that launch-agent, domain-room-watch,
herder-chat, herder-steer, and herder-dashboard should consult.

It replaces ad-hoc --persona flags and manual knowledge of which
agent runs which persona in which room.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shlex
import sys
from copy import deepcopy
from pathlib import Path
from typing import Any

# Make the harness root importable so `from agents import agent_config` works
# regardless of how this module is invoked (as a script via launch-agent, or
# imported). agent_config in turn does `from config import paths`.
_HARNESS_ROOT = Path(__file__).resolve().parent.parent
if str(_HARNESS_ROOT) not in sys.path:
    sys.path.insert(0, str(_HARNESS_ROOT))

# ---------------------------------------------------------------------------
# Models / Runtimes
# ---------------------------------------------------------------------------

MODELS = {
    "gpt-5.5": {
        "provider": "openai-compatible",
        "role": "Hermes / default controller",
    },
    "grok": {
        "provider": "xai",
        "role": "Grok Build CLI (external agent)",
    },
}

VALID_LAUNCH_MODES = {"hermes_profile", "external", "watcher_only", "disabled"}

DEFAULT_HEALTH_POLICY = {
    "kind": "room_presence",
    "stale_after_seconds": 180,
    "heartbeat_required": True,
}

# ---------------------------------------------------------------------------
# Agents (the important part for the Chat Orchestrator / herder work)
# ---------------------------------------------------------------------------

AGENTS: dict[str, dict[str, Any]] = {
    "grok-builder": {
        "id": "grok-builder",
        "display_name": "Grok Builder",
        "role": "general builder / implementer",
        "persona": "architect",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-grok-builder",
        "tmux_window": "main",
        "watcher_window": "watcher",
        "launch_mode": "external",
        "profile": "",
        "command": "",
        "capabilities": ["implementation", "planning", "code_review", "room_participation"],
        "health_policy": {**DEFAULT_HEALTH_POLICY, "presence_speaker": "Grok Builder"},
        "mission": "Execute implementation tasks for the current domain work. Post status and artifacts to the room.",
        "aliases": ["grok builder"],
        # NOTE: Separate external Grok API consumer (different session from main "grok").
        "api_cost": "high (separate Grok API session)",
    },
    "grok-research": {
        "id": "grok-research",
        "display_name": "Grok Research",
        "role": "research specialist",
        "persona": "DEEP_RESEARCHER",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-grok-research",
        "tmux_window": "main",
        "watcher_window": "watcher",
        "launch_mode": "external",
        "profile": "",
        "command": "",
        "capabilities": ["research", "evidence_gathering", "synthesis", "room_participation"],
        "health_policy": {**DEFAULT_HEALTH_POLICY, "presence_speaker": "Grok Research"},
        "mission": "Deep research, evidence gathering, and synthesis for domain briefs.",
        "aliases": ["grok research"],
        # NOTE: This is a separate external Grok API consumer.
        # It makes its own billable calls, independent from the main grok session.
        #
        # STRONGLY DISCOURAGED for normal use.
        # The main 'grok' session (pipe-grok) is better for research in almost all cases.
        # This agent exists mainly for rare cases where you need a fully isolated research process.
        # It has historically given lower quality output while still burning credits.
        "api_cost": "AVOID - very high cost, historically poor value",
    },
    "swarm-facilitator": {
        "id": "swarm-facilitator",
        "type": "facilitator",
        "display_name": "Swarm Facilitator",
        "role": "Chat Orchestrator / Swarm Facilitator",
        "role_title_in_room": "Chat Orchestrator",
        "room_speaker": "Swarm Facilitator",
        "persona": "swarm-facilitator",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-swarm-facilitator",
        "tmux_window": "main",
        "watcher_window": "watcher",
        "launch_mode": "external",
        "profile": "",
        "command": "",
        "capabilities": ["room_facilitation", "agent_activation", "steering", "coordination"],
        "health_policy": {**DEFAULT_HEALTH_POLICY, "presence_speaker": "Swarm Facilitator"},
        "mission": "Room-level Chat Orchestrator. Its brain can be local/external (Grok, Claude, etc.). Uses the same herder-swarm-control + herder-messaging skills as other orchestrators so the role behaves the same no matter which brain is attached.",
        "aliases": ["chat-orchestrator", "chat orchestrator", "facilitator"],
    },
    # Entry for this AI ("grok") as a first-class participant in the Harem.
    # The "brain" (the actual thinking engine) lives in this chat / external model.
    # The agent itself is the herder identity (name, session, skills, presence).
    # Orchestration behavior comes from loaded skills (herder-swarm-control + herder-messaging),
    # independent of which brain is powering it (Hermes, Grok, Claude, etc.).
    "grok": {
        "id": "grok",
        "display_name": "Grok",
        "room_speaker": "Grok",
        "persona": "",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-grok",
        "tmux_window": "main",
        "watcher_window": "watcher",
        "launch_mode": "external",
        "profile": "",
        "command": "",
        "capabilities": ["messaging", "steering"],
        "health_policy": {**DEFAULT_HEALTH_POLICY, "presence_speaker": "Grok"},
        "mission": "Grok AI (main session). Primary brain for research, planning, building, and orchestration. Strongly preferred over spawning separate grok-* agents.",
        "skills": ["herder-messaging"],
        "aliases": ["grok ai"],
        # This is the PRIMARY / recommended Grok session (pipe-grok).
        # It is designed to handle the vast majority of work directly.
        # Avoid creating extra grok-research, grok-builder, etc. sessions unless you have
        # a very specific need for an isolated process. Each additional one burns credits separately.
        "api_cost": "PRIMARY session - use this one for almost everything",
    },
    "kanban-orchestrator": {
        "id": "kanban-orchestrator",
        "display_name": "Kanban Orchestrator",
        "role": "Top-level CEO / strategic orchestrator",
        "persona": "ceo-orchestrator",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-kanban-orchestrator",
        "tmux_window": "main",
        "watcher_window": "watcher",
        "launch_mode": "hermes_profile",
        "profile": "kanban-orchestrator",
        "command": "hermes --profile kanban-orchestrator",
        "capabilities": ["strategic_orchestration", "kanban_decomposition", "prioritization", "room_participation"],
        "health_policy": {**DEFAULT_HEALTH_POLICY, "presence_speaker": "Kanban Orchestrator"},
        "mission": "Top-level strategic orchestrator. Its brain is the 'kanban-orchestrator' Hermes profile. The orchestration skills (herder-swarm-control + herder-messaging) are the same as local orchestrators so behavior is consistent regardless of brain.",
        "aliases": ["ceo", "ceo-orchestrator", "kanban orchestrator"],
    },
    # Explicit non-steerable entries make watcher-only and disabled states visible
    # to lifecycle tools instead of letting unknown names become fake sessions.
    "discovery-room-watcher": {
        "id": "discovery-room-watcher",
        "display_name": "Discovery Room Watcher",
        "role": "Non-brain room presence watcher for discovery",
        "persona": "swarm-facilitator",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-discovery-room-watcher",
        "tmux_window": "watcher",
        "watcher_window": "watcher",
        "launch_mode": "watcher_only",
        "profile": "",
        "command": "",
        "capabilities": ["room_presence", "heartbeat"],
        "health_policy": {**DEFAULT_HEALTH_POLICY, "presence_speaker": "Discovery Room Watcher"},
        "mission": "Maintain visible room presence and heartbeat only; not a steerable agent brain.",
        "aliases": ["room-watcher", "discovery watcher"],
    },
    "legacy-dashboard": {
        "id": "legacy-dashboard",
        "display_name": "Legacy Dashboard",
        "role": "Disabled legacy dashboard adapter",
        "persona": "",
        "canonical_room": "discovery",
        "default_room": "discovery",
        "tmux_session": "pipe-legacy-dashboard",
        "tmux_window": "main",
        "watcher_window": "watcher",
        "launch_mode": "disabled",
        "enabled": False,
        "disabled_reason": "Legacy dashboard is disabled; use herder-chat/domain-room instead.",
        "profile": "",
        "command": "",
        "capabilities": [],
        "health_policy": {"kind": "disabled"},
        "mission": "Disabled legacy entry retained so lifecycle tools fail visibly.",
        "aliases": ["agent-dashboard"],
    },
}


# ---------------------------------------------------------------------------
# Declarative agents (agents.json) — the cockpit's writable source of truth.
# We merge these in so an agent created in the UI is a first-class citizen for
# launch-agent / herder / domain-room, without hand-editing this file.
# ---------------------------------------------------------------------------

# provider -> (launch_mode, command run in the tmux main window)
_PROVIDER_LAUNCH = {
    "grok": ("external", "grok"),
    "devin": ("external", "devin"),
    "echo": ("watcher_only", ""),
}


def _declarative_agents() -> dict[str, dict[str, Any]]:
    """Agents declared in agents.json, mapped into registry entry shape."""
    try:
        from agents import agent_config
    except Exception:
        try:
            import agent_config  # when imported from within the agents/ dir
        except Exception:
            return {}
    try:
        cfg = agent_config.load_config()
    except Exception:
        return {}

    out: dict[str, dict[str, Any]] = {}
    for aid, spec in (cfg.get("agents") or {}).items():
        provider = str(spec.get("provider") or "echo")
        mode, command = _PROVIDER_LAUNCH.get(provider, ("external", ""))
        room = str(spec.get("room") or "discovery")
        out[aid] = {
            "id": aid,
            "display_name": spec.get("name") or aid,
            "role": spec.get("description") or f"{provider} agent",
            "persona": spec.get("persona") or "",
            "canonical_room": room,
            "default_room": room,
            "tmux_session": spec.get("tmux_session") or f"pipe-{aid}",
            "tmux_window": spec.get("tmux_window") or "main",
            "watcher_window": "watcher",
            "launch_mode": mode,
            "profile": "",
            "command": command,
            "capabilities": list(spec.get("capabilities") or []),
            "mission": spec.get("description") or "",
            "provider": provider,
            "source": "agents.json",
        }
    return out


def _all_agents() -> dict[str, dict[str, Any]]:
    """Built-in AGENTS merged with declarative agents.json entries.

    Built-ins win on id conflicts so existing system agents keep their exact
    behavior; new UI-created agents are added on top.
    """
    merged = _declarative_agents()
    merged.update(AGENTS)
    return merged


def _slug(value: str) -> str:
    value = value.strip().lstrip("@").lower()
    value = re.sub(r"[\s_]+", "-", value)
    value = re.sub(r"[^a-z0-9.-]+", "", value)
    value = re.sub(r"-+", "-", value)
    return value.strip("-")


def _normalise_agent(key: str, data: dict[str, Any]) -> dict[str, Any]:
    agent = deepcopy(data)
    agent_id = str(agent.get("id") or key)
    launch_mode = str(agent.get("launch_mode") or "external")
    display_name = str(
        agent.get("display_name")
        or agent.get("role_title_in_room")
        or agent.get("room_speaker")
        or agent_id
    )
    canonical_room = str(agent.get("canonical_room") or agent.get("default_room") or "discovery")
    tmux_session = str(agent.get("tmux_session") or f"pipe-{agent_id}")
    tmux_window = str(agent.get("tmux_window") or "main")
    watcher_window = str(agent.get("watcher_window") or "watcher")
    profile = str(agent.get("profile") or (agent_id if launch_mode == "hermes_profile" else ""))
    command = str(agent.get("command") or "")
    capabilities = list(agent.get("capabilities") or [])
    health_policy = dict(agent.get("health_policy") or DEFAULT_HEALTH_POLICY)
    enabled = bool(agent.get("enabled", launch_mode != "disabled"))
    room_speaker = str(agent.get("room_speaker") or display_name)

    agent.update(
        {
            "id": agent_id,
            "display_name": display_name,
            "canonical_room": canonical_room,
            "default_room": canonical_room,
            "persona": str(agent.get("persona") or ""),
            "launch_mode": launch_mode,
            "tmux_session": tmux_session,
            "tmux_window": tmux_window,
            "watcher_window": watcher_window,
            "profile": profile,
            "command": command,
            "capabilities": capabilities,
            "health_policy": health_policy,
            "enabled": enabled,
            "room_speaker": room_speaker,
        }
    )
    return agent


def _aliases_for(key: str, agent: dict[str, Any]) -> set[str]:
    aliases = {
        key,
        agent.get("id", ""),
        agent.get("display_name", ""),
        agent.get("role_title_in_room", ""),
        agent.get("room_speaker", ""),
    }
    aliases.update(str(alias) for alias in agent.get("aliases", []) if alias)
    return {alias for alias in aliases if alias}


def resolve_agent_id(name: str) -> str | None:
    """Resolve an agent id from a canonical id, display name, room title, or alias."""
    query = _slug(name)
    if not query:
        return None

    for key, data in _all_agents().items():
        agent = _normalise_agent(key, data)
        if query in {_slug(alias) for alias in _aliases_for(key, agent)}:
            return agent["id"]
    return None


def get_agent(name: str) -> dict[str, Any] | None:
    """Return the normalised registry entry for an agent, or None."""
    agent_id = resolve_agent_id(name)
    if not agent_id:
        return None
    for key, data in _all_agents().items():
        agent = _normalise_agent(key, data)
        if agent["id"] == agent_id:
            return agent
    return None


def get_persona_for_agent(name: str) -> str | None:
    """Convenience: which persona should this agent run with?"""
    agent = get_agent(name)
    return agent["persona"] if agent else None


def get_default_room(name: str) -> str:
    """Which domain room does this agent normally coordinate in?"""
    agent = get_agent(name)
    return agent["canonical_room"] if agent else "discovery"


def list_agents() -> list[str]:
    return [_normalise_agent(key, value)["id"] for key, value in _all_agents().items()]


def agents_for_room(room: str) -> dict[str, dict[str, Any]]:
    return {
        _normalise_agent(k, v)["id"]: _normalise_agent(k, v)
        for k, v in _all_agents().items()
        if _normalise_agent(k, v).get("canonical_room") == room
    }


def get_launch_plan(name: str, domain_override: str | None = None) -> dict[str, Any]:
    """Return a normalized, machine-readable launch/steering plan.

    Raises KeyError for unknown agents so callers fail visibly instead of guessing
    a pipe-<name> tmux session.
    """
    agent = get_agent(name)
    if not agent:
        raise KeyError(f"Unknown agent '{name}'")

    if domain_override:
        agent["requested_room"] = domain_override
        agent["canonical_room"] = domain_override
        agent["default_room"] = domain_override

    mode = agent["launch_mode"]
    mode_valid = mode in VALID_LAUNCH_MODES
    enabled = bool(agent.get("enabled", True)) and mode != "disabled"
    disabled_reason = str(agent.get("disabled_reason") or "")

    launchable = mode_valid and enabled
    launch_status_reason = ""
    if not mode_valid:
        launchable = False
        launch_status_reason = f"unsupported launch_mode '{mode}'"
    elif not enabled:
        launch_status_reason = disabled_reason or f"agent '{agent['id']}' is disabled"

    steerable = launchable and mode != "watcher_only"
    if mode == "watcher_only":
        launch_status_reason = "watcher-only; no agent brain was started"

    agent.update(
        {
            "launchable": launchable,
            "steerable": steerable,
            "agent_brain_started": launchable and mode in {"hermes_profile", "external"},
            "launch_status_reason": launch_status_reason,
            "known_agents": list_agents(),
        }
    )
    return agent


def _shell_value(value: Any) -> str:
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True)
    return "" if value is None else str(value)


def _print_shell(plan: dict[str, Any]) -> None:
    field_map = {
        "id": "AGENT_ID",
        "display_name": "DISPLAY_NAME",
        "canonical_room": "CANONICAL_ROOM",
        "persona": "PERSONA",
        "launch_mode": "LAUNCH_MODE",
        "tmux_session": "TMUX_SESSION",
        "tmux_window": "TMUX_WINDOW",
        "watcher_window": "WATCHER_WINDOW",
        "profile": "PROFILE",
        "command": "COMMAND",
        "capabilities": "CAPABILITIES_JSON",
        "health_policy": "HEALTH_POLICY_JSON",
        "room_speaker": "ROOM_SPEAKER",
        "enabled": "ENABLED",
        "launchable": "LAUNCHABLE",
        "steerable": "STEERABLE",
        "agent_brain_started": "AGENT_BRAIN_STARTED",
        "launch_status_reason": "LAUNCH_STATUS_REASON",
        "mission": "MISSION",
    }
    for field, env_name in field_map.items():
        print(f"{env_name}={shlex.quote(_shell_value(plan.get(field)))}")


def _known_agents_text() -> str:
    return ", ".join(list_agents())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Machine-readable herder agent registry")
    sub = parser.add_subparsers(dest="command", required=True)

    lookup = sub.add_parser("lookup", help="Resolve one agent and print launch metadata")
    lookup.add_argument("name")
    lookup.add_argument("--domain", help="Explicit room override for this launch")
    lookup.add_argument("--format", choices=["json", "shell"], default="json")

    list_cmd = sub.add_parser("list", help="List registered agents")
    list_cmd.add_argument("--format", choices=["json", "text"], default="text")

    args = parser.parse_args(argv)

    if args.command == "list":
        agents = [get_launch_plan(name) for name in list_agents()]
        if args.format == "json":
            print(json.dumps(agents, indent=2, sort_keys=True))
        else:
            for agent in agents:
                print(
                    f"{agent['id']}\t{agent['display_name']}\t{agent['launch_mode']}\t"
                    f"{agent['tmux_session']}:{agent['tmux_window']}"
                )
        return 0

    if args.command == "lookup":
        try:
            plan = get_launch_plan(args.name, domain_override=args.domain)
        except KeyError:
            print(f"Error: Unknown agent '{args.name}'. Known agents: {_known_agents_text()}", file=sys.stderr)
            return 2

        if args.format == "shell":
            _print_shell(plan)
        else:
            print(json.dumps(plan, indent=2, sort_keys=True))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
