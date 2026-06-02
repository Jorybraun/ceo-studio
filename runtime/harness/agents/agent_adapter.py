"""
Generic agent adapter runtime.

One code path for "run an agent (any provider) as a swarm member that
communicates via the domain room". Used by `bin/agent` (CLI) and by the
orchestrator (programmatic dispatch). Provider-agnostic.

Guarantees:
  - every request + reply is posted to the domain room (the shared bus)
  - sessions persist per (room, agent) so `tell` resumes the same conversation
  - dispatch is gated by config.cost_limits (kill switch, paid-agent policy,
    per-cycle / hourly / concurrency caps) and records the spawn
"""

from __future__ import annotations

import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Optional

from . import providers as _providers
from config import cost_limits
from config import paths

HARNESS_ROOT = Path(__file__).resolve().parent.parent
DOMAIN_ROOM = HARNESS_ROOT / "bin" / "domain-room"  # engine code (HARNESS_HOME)


def _agents_base(room: str) -> Path:
    # Per-(room,agent) session state is project DATA -> resolve under the workspace.
    d = paths.room_dir(room) / "agents"
    d.mkdir(parents=True, exist_ok=True)
    return d


def _workdir(room: str, agent: str) -> Path:
    d = _agents_base(room) / agent
    d.mkdir(parents=True, exist_ok=True)
    return d


def _state_path(room: str, agent: str) -> Path:
    return _agents_base(room) / f"{agent}.json"


def _load_state(room: str, agent: str) -> dict:
    p = _state_path(room, agent)
    if p.exists():
        try:
            return json.loads(p.read_text())
        except Exception:
            return {}
    return {}


def _save_state(room: str, agent: str, state: dict) -> None:
    _state_path(room, agent).write_text(json.dumps(state, indent=2))


def post_to_room(room: str, speaker: str, message: str) -> None:
    try:
        subprocess.run([str(DOMAIN_ROOM), "post", room, speaker, message],
                       capture_output=True, timeout=15)
    except Exception as e:
        print(f"[agent-adapter] WARN: could not post to room: {e}", file=sys.stderr)


def dispatch(provider_name: str, agent: str, room: str, task: str, *,
             model: Optional[str] = None, spawns_this_cycle: int = 0,
             timeout: int = 600, interactive: bool = False) -> dict:
    """Guardrail-gated dispatch. Returns a result dict (also posts to the room).

    The provider's own `paid` flag is passed to the guardrail, so paid backends
    (e.g. Devin) are blocked for automated/non-interactive dispatch unless
    CEO_ALLOW_PAID=1 — a human at a TTY (interactive=True) may proceed.
    """
    provider = _providers.get_provider(provider_name)
    guardrail_key = f"{provider_name}:{agent}"

    allowed, reason = cost_limits.can_spawn(
        guardrail_key, spawns_this_cycle=spawns_this_cycle,
        interactive=interactive, paid=getattr(provider, "paid", False))
    if not allowed:
        post_to_room(room, "Orchestrator", f"[REFUSED by guardrail] dispatch {agent}: {reason}")
        return {"ok": False, "refused": True, "reason": reason}

    speaker_agent = f"{agent} ({provider_name}/{model or 'default'})"
    post_to_room(room, "Orchestrator", f"@{agent} TASK: {task}")
    wd = _workdir(room, agent)
    t0 = time.time()
    res = provider.dispatch(agent, task, model=model, workdir=wd, timeout=timeout)
    cost_limits.record_spawn(guardrail_key)

    _save_state(room, agent, {
        "agent": agent, "room": room, "provider": provider_name,
        "model": model, "session_id": res.session_id, "created_at": time.time(),
    })
    post_to_room(room, speaker_agent, res.reply)
    if getattr(res, "error", False):
        return {"ok": False, "reply": res.reply, "session_id": res.session_id,
                "provider": provider_name, "seconds": round(time.time() - t0, 1),
                "error": True}
    return {"ok": True, "reply": res.reply, "session_id": res.session_id,
            "provider": provider_name, "seconds": round(time.time() - t0, 1)}


def tell(agent: str, room: str, message: str, *, timeout: int = 600) -> dict:
    """Continue a previously-dispatched agent's session. Posts the exchange to the room."""
    state = _load_state(room, agent)
    sid = state.get("session_id")
    provider_name = state.get("provider", "devin")
    if not sid:
        return {"ok": False, "reason": f"no session for '{agent}' in room '{room}' (dispatch first)"}

    provider = _providers.get_provider(provider_name)
    speaker_agent = f"{agent} ({provider_name}/{state.get('model') or 'default'})"
    post_to_room(room, "Orchestrator", f"@{agent}: {message}")
    wd = _workdir(room, agent)
    res = provider.tell(agent, message, session_id=sid, model=state.get("model"),
                        workdir=wd, timeout=timeout)
    state["session_id"] = res.session_id or sid
    _save_state(room, agent, state)
    post_to_room(room, speaker_agent, res.reply)
    if getattr(res, "error", False):
        return {"ok": False, "reply": res.reply, "session_id": state["session_id"],
                "provider": provider_name, "error": True}
    return {"ok": True, "reply": res.reply, "session_id": state["session_id"], "provider": provider_name}


def converse(agent: str, room: str, message: str, *, provider: Optional[str] = None,
             model: Optional[str] = None, persona: Optional[str] = None,
             timeout: int = 600, post: bool = True,
             interactive: bool = False) -> dict:
    """One conversational turn with an agent *as a room participant*.

    Same brain + same session substrate as dispatch()/tell() (and therefore the
    A2A server executor in a2a_runtime), but tuned for a live chat room:
      - resumes the agent's existing (room, agent) session if there is one,
        else starts a fresh one (prepending the persona preamble on first turn);
      - does NOT emit an `Orchestrator @agent TASK:` line — the human's message
        already lives in the room. The agent's reply is posted as the agent's
        own voice, and only when `post` is True (so callers can drop a `PASS`).
    Guardrail-gated exactly like dispatch(). Returns
    {ok, reply, session_id, provider} or {ok:False, reason}.
    """
    state = _load_state(room, agent)
    sid = state.get("session_id")
    provider_name = state.get("provider") or provider or "echo"
    prov = _providers.get_provider(provider_name)

    allowed, reason = cost_limits.can_spawn(
        f"{provider_name}:{agent}", interactive=interactive,
        paid=getattr(prov, "paid", False))
    if not allowed:
        return {"ok": False, "refused": True, "reason": reason}

    wd = _workdir(room, agent)
    if sid:
        res = prov.tell(agent, message, session_id=sid,
                        model=state.get("model") or model, workdir=wd, timeout=timeout)
    else:
        task = message
        if persona:
            from . import personas as personas_mod
            preamble = personas_mod.persona_preamble(persona)
            if preamble:
                task = f"{preamble}\n{message}"
        res = prov.dispatch(agent, task, model=model, workdir=wd, timeout=timeout)
    cost_limits.record_spawn(f"{provider_name}:{agent}")

    new_sid = res.session_id or sid
    _save_state(room, agent, {
        "agent": agent, "room": room, "provider": provider_name,
        "model": state.get("model") or model, "session_id": new_sid,
        "created_at": state.get("created_at") or time.time(),
    })
    reply = (res.reply or "").strip()
    if post and reply:
        post_to_room(room, agent, reply)
    if getattr(res, "error", False):
        return {"ok": False, "reply": reply, "session_id": new_sid,
                "provider": provider_name, "error": True}
    return {"ok": True, "reply": reply, "session_id": new_sid, "provider": provider_name}


def list_agents(room: str) -> list[dict]:
    base = _agents_base(room)
    out = []
    for f in sorted(base.glob("*.json")):
        try:
            out.append(json.loads(f.read_text()))
        except Exception:
            continue
    return out
