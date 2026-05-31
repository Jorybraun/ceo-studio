"""
Meeting / standup orchestrator (A2A-native).

A "meeting" is a room with an agenda and a set of invited member agents. The
facilitator (this orchestrator, an A2A *client*) stands each member up as a
real A2A *server* (via a2a_runtime), then drives an agenda-first, relevance-
gated round so members "enter the room and get down to business":

  1. Post the agenda to the domain room (the human-visible bus).
  2. Ask each member, over A2A, to contribute IF the agenda is relevant to
     their role (else reply PASS). Every exchange is mirrored to the room by
     the underlying agent_adapter.
  3. Synthesize the contributions into a concrete set of requirements and
     write them to the room + `requirements.md`.

Free `echo` provider = zero-cost dry run of the whole loop. Real providers
(devin/grok) = real brains. Nothing here is mocked: replies come from real
provider turns over a real A2A HTTP transport.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import uuid
from dataclasses import dataclass, field
from typing import Optional

from . import a2a_runtime
from . import agent_adapter
from . import agent_config
from . import personas as personas_mod
from config import paths


@dataclass
class Member:
    id: str
    provider: str = "echo"
    persona: Optional[str] = None
    model: Optional[str] = None
    capabilities: list[str] = field(default_factory=list)


PASS_TOKEN = "PASS"


def _relevance_prompt(agenda: str, criteria: str, member: Member) -> str:
    role = member.persona or member.id
    crit = f"\nWhat a good outcome looks like:\n{criteria}\n" if criteria else ""
    return (
        f"You are joining a working meeting as '{member.id}'"
        f"{f' (role: {role})' if role else ''}.\n\n"
        f"AGENDA:\n{agenda}\n{crit}\n"
        f"If this agenda is relevant to your role, contribute CONCRETE input: "
        f"specific requirements, risks, open questions, or proposals. Be brief and "
        f"high-signal (3-6 bullet points). "
        f"If it is NOT relevant to your role, reply with exactly: {PASS_TOKEN}"
    )


async def _ask(client, text: str) -> str:
    """Send one A2A message; return the agent's aggregated text reply."""
    from a2a.types import Message, Part, Role, SendMessageRequest
    req = SendMessageRequest(message=Message(
        message_id=str(uuid.uuid4()), role=Role.ROLE_USER,
        parts=[Part(text=text)]))
    out = []
    async for resp in client.send_message(req):
        if resp.HasField("message"):
            out.append("".join(p.text for p in resp.message.parts if p.text))
        elif resp.HasField("artifact_update"):
            art = resp.artifact_update.artifact
            out.append("".join(p.text for p in art.parts if p.text))
    return "\n".join(t for t in out if t).strip()


@contextlib.asynccontextmanager
async def _member_clients(members: list[Member], room: str, timeout: int):
    """Start each member as an A2A server and yield {member_id: client}."""
    import httpx
    from a2a.client import ClientFactory, ClientConfig

    servers, clients = [], {}
    hc = httpx.AsyncClient(timeout=timeout + 30)
    try:
        for m in members:
            handle = a2a_runtime.serve(
                m.id, provider=m.provider, room=room, persona=m.persona,
                model=m.model, capabilities=m.capabilities, timeout=timeout, block=False)
            servers.append(handle)
            if not a2a_runtime.wait_healthy(handle["url"]):
                raise RuntimeError(f"member '{m.id}' A2A server failed health check at {handle['url']}")
            factory = ClientFactory(ClientConfig(httpx_client=hc, streaming=True))
            clients[m.id] = await factory.create_from_url(handle["url"])
        yield clients
    finally:
        for c in clients.values():
            with contextlib.suppress(Exception):
                await c.close()
        with contextlib.suppress(Exception):
            await hc.aclose()
        for s in servers:
            with contextlib.suppress(Exception):
                s["server"].should_exit = True


def _synthesize(agenda: str, criteria: str, contributions: dict[str, str],
                room: str, orchestrator: Optional[str], timeout: int) -> str:
    """Turn member contributions into a requirements doc. If an orchestrator
    provider is given, it does the synthesis (a real turn); otherwise compile
    deterministically. Either way the result is real, not fabricated."""
    transcript = "\n\n".join(f"### {who}\n{txt}" for who, txt in contributions.items() if txt)
    if orchestrator:
        task = (
            "You are the meeting facilitator. Synthesize the following member "
            "contributions into a concise, de-duplicated set of REQUIREMENTS "
            "(numbered), each with a one-line acceptance criterion. Then list any "
            "open questions.\n\n"
            f"AGENDA:\n{agenda}\n\nGOOD OUTCOME:\n{criteria}\n\n"
            f"CONTRIBUTIONS:\n{transcript}")
        res = agent_adapter.dispatch(orchestrator, "facilitator", room, task,
                                     timeout=timeout, interactive=False)
        return res.get("reply") or res.get("reason") or transcript
    # Deterministic compile (no model): preserve every contribution verbatim.
    lines = [f"# Requirements draft — {agenda.splitlines()[0][:80] if agenda else 'meeting'}", ""]
    if criteria:
        lines += ["**Good outcome:** " + criteria.replace("\n", " "), ""]
    lines.append("## Contributions")
    for who, txt in contributions.items():
        if txt:
            lines += [f"### {who}", txt, ""]
    return "\n".join(lines)


async def run_meeting(*, room: str, agenda: str, members: list[Member],
                      criteria: str = "", orchestrator: Optional[str] = None,
                      timeout: int = 600) -> dict:
    if not members:
        return {"ok": False, "reason": "no members invited"}

    agent_adapter.post_to_room(room, "Facilitator",
                               f"MEETING START. Agenda:\n{agenda}"
                               + (f"\n\nGood outcome:\n{criteria}" if criteria else ""))

    contributions: dict[str, str] = {}
    passes: list[str] = []
    async with _member_clients(members, room, timeout) as clients:
        for m in members:
            prompt = _relevance_prompt(agenda, criteria, m)
            reply = await _ask(clients[m.id], prompt)
            if reply.strip().upper().startswith(PASS_TOKEN):
                passes.append(m.id)
            else:
                contributions[m.id] = reply

    requirements = _synthesize(agenda, criteria, contributions, room, orchestrator, timeout)
    agent_adapter.post_to_room(room, "Facilitator",
                               f"MEETING SYNTHESIS — requirements:\n{requirements}")

    # Persist the requirements doc alongside the room.
    out_path = paths.room_dir(room) / "requirements.md"
    try:
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_text(requirements, encoding="utf-8")
    except Exception:
        pass

    return {
        "ok": True,
        "room": room,
        "members": [m.id for m in members],
        "contributed": list(contributions.keys()),
        "passed": passes,
        "requirements": requirements,
        "requirements_path": str(out_path),
    }


def _member_from_token(token: str) -> Member:
    """Resolve one member token.

    - "id:provider:persona" -> explicit inline spec (provider/persona optional).
    - bare "id"             -> look it up in the declarative agent config; if
                               found, use its provider/persona/model/caps. If
                               not found, fall back to echo with no persona.
    Inline fields always override config.
    """
    parts = token.split(":")
    mid = parts[0].strip()
    inline_provider = parts[1].strip() if len(parts) > 1 and parts[1].strip() else None
    inline_persona = parts[2].strip() if len(parts) > 2 and parts[2].strip() else None

    cfg = agent_config.get_agent(mid) or {}
    provider = inline_provider or cfg.get("provider") or "echo"
    persona = inline_persona or cfg.get("persona")
    return Member(id=mid, provider=provider, persona=persona,
                  model=cfg.get("model"), capabilities=cfg.get("capabilities", []) or [])


def parse_members(spec: str) -> list[Member]:
    """Parse a comma-separated member spec into Members, resolving bare ids via
    the declarative agent config (agents.json)."""
    members: list[Member] = []
    for chunk in (spec or "").split(","):
        chunk = chunk.strip()
        if chunk:
            members.append(_member_from_token(chunk))
    return members


def members_for_team(team_name: str) -> list[Member]:
    """Expand a named team (from agents.json) into resolved Members."""
    return [_member_from_token(mid) for mid in agent_config.get_team(team_name)]
