"""
Persistent A2A room loop — turns a domain room into a *living* channel.

A `meeting` is one-shot: ask each member once, synthesize, exit. A `room` is
ongoing. This daemon watches the room's `chat.log` (the human-visible bus) for
new HUMAN messages and routes them to member agents over the same provider +
session substrate the A2A servers use (`agent_adapter.converse`, which is what
`a2a_runtime`'s executor calls under the hood). So replies are real agent turns
with conversational continuity, mirrored back into the room.

Routing:
  - `@<agent>` mention  -> that member answers directly.
  - whole-team message  -> every member is offered it and replies only if it
                           concerns their role, else `PASS` (dropped, no noise).
  - single-member room  -> always treated as addressed (a DM always answers).
  - an agent reply that `@<teammate>` mentions another member triggers a bounded
    round of agent-to-agent follow-up, so the room hosts real A2A back-and-forth
    without runaway loops (`max_followups` caps the depth).

Only HUMAN-authored lines (speaker You/CEO/Human) trigger routing; agent and
Facilitator lines never re-trigger the watcher, so the loop can't feed itself.
"""

from __future__ import annotations

import re
import sys
import time
from typing import Optional

from . import agent_adapter
from .gbrain_memory import GBrainMemory, with_memory
from config import paths

PASS_TOKEN = "PASS"
# Speakers whose messages drive the room. Anything else (agent ids, Facilitator,
# Orchestrator, system) is transcript-only and never triggers a new round.
HUMAN_SPEAKERS = {"you", "ceo", "human"}

_TS = re.compile(r"^\[(\d{4}-\d{2}-\d{2}T[^\]]+)\]\s+([^:\n]+):\s?(.*)$")
_MENTION = re.compile(r"@([A-Za-z0-9._-]+)")


def _chat_log(room: str):
    return paths.room_dir(room) / "chat.log"


def _parse_entries(text: str) -> list[dict]:
    entries: list[dict] = []
    cur: Optional[dict] = None
    for line in text.splitlines():
        m = _TS.match(line)
        if m:
            if cur:
                entries.append(cur)
            cur = {"ts": m.group(1), "speaker": m.group(2).strip(), "body": m.group(3)}
        elif cur:
            cur["body"] += "\n" + line
    if cur:
        entries.append(cur)
    for e in entries:
        e["body"] = e["body"].strip()
    return entries


def _read_entries(room: str) -> list[dict]:
    p = _chat_log(room)
    if not p.exists():
        return []
    try:
        return _parse_entries(p.read_text(encoding="utf-8"))
    except Exception:
        return []


def _mentions_in(text: str, by_id: dict) -> list[str]:
    seen, out = set(), []
    for mid in _MENTION.findall(text or ""):
        if mid in by_id and mid not in seen:
            seen.add(mid)
            out.append(mid)
    return out


def _route_prompt(member, body: str, addressed: bool, criteria: str) -> str:
    role = member.persona or member.id
    if addressed:
        return (f"You are '{member.id}' (role: {role}) in a live team room. "
                f"You were addressed:\n\n{body}\n\n"
                f"Reply concisely and concretely as yourself — high-signal, no filler.")
    crit = f"\nWhat a good outcome looks like:\n{criteria}\n" if criteria else ""
    return (f"New message in the team room:\n\n{body}\n{crit}\n"
            f"You are '{member.id}' (role: {role}). If this concerns your role, reply "
            f"concisely and concretely (high-signal, no filler). "
            f"If it does NOT concern your role, reply with exactly: {PASS_TOKEN}")


def _followup_prompt(from_id: str, to_member, said: str) -> str:
    role = to_member.persona or to_member.id
    return (f"In the team room, @{from_id} said to you (@{to_member.id}):\n\n{said}\n\n"
            f"You are '{to_member.id}' (role: {role}). Respond concisely if this concerns "
            f"you, otherwise reply with exactly: {PASS_TOKEN}")


def _is_pass(reply: str) -> bool:
    return (not reply) or reply.strip().upper().startswith(PASS_TOKEN)


def _turn(room: str, member, prompt: str, timeout: int, mem=None) -> str:
    """Run one agent turn; post the reply (unless PASS). Return the reply text
    (empty if PASS/refused) so the caller can chain agent-to-agent follow-ups.
    The reply is also captured into gbrain (fire-and-forget) when memory is on."""
    res = agent_adapter.converse(
        member.id, room, prompt, provider=member.provider, model=member.model,
        persona=member.persona, timeout=timeout, post=False)
    if not res.get("ok"):
        return ""
    reply = (res.get("reply") or "").strip()
    if _is_pass(reply):
        return ""
    agent_adapter.post_to_room(room, member.id, reply)
    if mem is not None:
        mem.capture(room=room, speaker=member.id, body=reply)
    return reply


def _handle_message(room: str, by_id: dict, body: str, criteria: str,
                    followups: int, timeout: int, mem=None) -> None:
    mentioned = _mentions_in(body, by_id)
    addressed = bool(mentioned) or len(by_id) == 1
    targets = mentioned if mentioned else list(by_id.keys())
    # Recall once per incoming message and share the context across members.
    memctx = mem.recall(body) if mem is not None else ""
    for mid in targets:
        member = by_id[mid]
        prompt = with_memory(_route_prompt(member, body, addressed, criteria), memctx)
        reply = _turn(room, member, prompt, timeout, mem)
        if reply and followups > 0:
            _chain(room, by_id, mid, reply, followups - 1, timeout, mem)


def _chain(room: str, by_id: dict, from_id: str, reply: str,
           budget: int, timeout: int, mem=None) -> None:
    """Bounded agent-to-agent: route @teammate mentions in an agent reply."""
    memctx = mem.recall(reply) if mem is not None else ""
    for mid in _mentions_in(reply, by_id):
        if mid == from_id:
            continue
        member = by_id[mid]
        prompt = with_memory(_followup_prompt(from_id, member, reply), memctx)
        nxt = _turn(room, member, prompt, timeout, mem)
        if nxt and budget > 0:
            _chain(room, by_id, mid, nxt, budget - 1, timeout, mem)


def run_room_loop(*, room: str, members: list, criteria: str = "", poll: float = 2.0,
                  max_followups: int = 1, idle_exit: int = 0, timeout: int = 600,
                  gbrain: bool = True, gbrain_limit: int = 5,
                  gbrain_ceiling: int = 4000) -> dict:
    """Block, watching `room` for new human messages and answering them as the
    invited members. `idle_exit` (seconds) auto-stops the daemon after a quiet
    spell; 0 means run until killed. When `gbrain` is on (and the gbrain CLI is
    healthy) every turn is captured and relevant context is recalled per turn;
    if gbrain is unavailable the room runs unchanged with no memory."""
    if not members:
        return {"ok": False, "reason": "no members invited"}
    by_id = {m.id: m for m in members}
    mem = GBrainMemory(enabled=gbrain, limit=gbrain_limit, ceiling=gbrain_ceiling)
    mem_on = mem.available()

    # Only react to messages that arrive *after* we start, so restarting the
    # loop doesn't re-answer the whole backlog.
    cursor = len(_read_entries(room))
    agent_adapter.post_to_room(
        room, "Facilitator",
        f"Live room is ON ({', '.join(by_id)}). Type to talk — address @<agent> "
        f"for one, or post to the whole team. Agents reply only when it concerns them."
        + (" Shared memory (gbrain) is active." if mem_on else ""))
    last_activity = time.time()

    try:
        while True:
            time.sleep(poll)
            entries = _read_entries(room)
            if len(entries) <= cursor:
                if idle_exit and (time.time() - last_activity) > idle_exit:
                    break
                continue
            new = entries[cursor:]
            cursor = len(entries)
            for e in new:
                if e["speaker"].strip().lower() not in HUMAN_SPEAKERS:
                    continue  # agent / facilitator lines never re-trigger routing
                if not e["body"].strip():
                    continue
                last_activity = time.time()
                if mem_on:  # record the human turn too (record first)
                    mem.capture(room=room, speaker=e["speaker"].strip(), body=e["body"])
                try:
                    _handle_message(room, by_id, e["body"], criteria, max_followups,
                                    timeout, mem if mem_on else None)
                except Exception as exc:  # one bad turn shouldn't kill the room
                    print(f"[room-loop] WARN: handling message failed: {exc}", file=sys.stderr)
    except KeyboardInterrupt:
        pass
    agent_adapter.post_to_room(room, "Facilitator", "Live room is OFF.")
    return {"ok": True, "room": room, "members": list(by_id.keys()), "memory": mem_on}
