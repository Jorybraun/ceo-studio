"""
Universal A2A server runtime.

Wraps ANY harness provider (devin, echo, grok, ...) as a real Agent2Agent
(A2A) HTTP server with a discoverable Agent Card. This is the "house any
agent" adapter the user asked for: the agent's brain is just a provider CLI
behind the standard A2A protocol, so an orchestrator (or any A2A client) can
talk to it the same way regardless of vendor.

Design:
  - The A2A layer is the TRANSPORT. The actual turn is run by the existing,
    validated `agent_adapter` (dispatch on the first turn, tell to resume),
    which already (a) enforces the cost guardrail for paid providers and
    (b) mirrors every request + reply into the human-visible domain room.
  - Persona text (per-project) is injected ahead of the first task so the
    agent answers in-role.

Requires `a2a-sdk` (install into the harness venv). Imports are local to the
functions that need them so importing this module never hard-fails when the
SDK isn't present.
"""

from __future__ import annotations

import socket
import threading
import time
import uuid
from typing import Optional

from . import agent_adapter
from . import personas as personas_mod


# ---------------------------------------------------------------------------
# Agent Card (A2A discovery document) built from a registry-style spec
# ---------------------------------------------------------------------------

def build_agent_card(agent_id: str, *, provider: str, url: str,
                     persona: Optional[str] = None,
                     capabilities: Optional[list[str]] = None,
                     description: Optional[str] = None):
    from a2a.types import (AgentCard, AgentCapabilities, AgentInterface,
                           AgentSkill)
    caps = capabilities or []
    desc = description or f"{agent_id} ({provider}) swarm member"
    if persona:
        desc += f", persona={persona}"
    skills = [AgentSkill(id=(c or "skill").replace(" ", "-").lower(),
                         name=c, description=c, tags=[provider])
              for c in (caps or ["respond"])]
    return AgentCard(
        name=agent_id,
        description=desc,
        version="0.1.0",
        default_input_modes=["text/plain"],
        default_output_modes=["text/plain"],
        capabilities=AgentCapabilities(streaming=True),
        supported_interfaces=[AgentInterface(protocol_binding="JSONRPC", url=url)],
        skills=skills,
    )


# ---------------------------------------------------------------------------
# Executor: bridge an inbound A2A message to a real provider turn
# ---------------------------------------------------------------------------

def _make_executor(agent_id: str, provider: str, room: str,
                   persona: Optional[str], model: Optional[str], timeout: int):
    from a2a.server.agent_execution import AgentExecutor, RequestContext
    from a2a.server.events import EventQueue
    from a2a.types import Message, Part, Role

    preamble = personas_mod.persona_preamble(persona)

    class _ProviderExecutor(AgentExecutor):
        async def execute(self, context: RequestContext, event_queue: EventQueue) -> None:
            text = context.get_user_input() or ""
            state = agent_adapter._load_state(room, agent_id)
            has_session = bool(state.get("session_id"))
            # First contact -> dispatch (with persona). Thereafter -> resume.
            if has_session:
                res = agent_adapter.tell(agent_id, room, text, timeout=timeout)
            else:
                task = f"{preamble}\n{text}" if preamble else text
                res = agent_adapter.dispatch(provider, agent_id, room, task,
                                             model=model, timeout=timeout,
                                             interactive=False)
            reply = res.get("reply") or res.get("reason") or "(no reply)"
            await event_queue.enqueue_event(Message(
                message_id=str(uuid.uuid4()),
                role=Role.ROLE_AGENT,
                parts=[Part(text=str(reply))],
            ))

        async def cancel(self, context: RequestContext, event_queue: EventQueue) -> None:
            return None

    return _ProviderExecutor()


def build_app(agent_id: str, *, provider: str, room: str, url: str,
              persona: Optional[str] = None, model: Optional[str] = None,
              capabilities: Optional[list[str]] = None, timeout: int = 600):
    from starlette.applications import Starlette
    from a2a.server.request_handlers import DefaultRequestHandler
    from a2a.server.routes import create_agent_card_routes, create_jsonrpc_routes
    from a2a.server.tasks import InMemoryTaskStore

    card = build_agent_card(agent_id, provider=provider, url=url,
                            persona=persona, capabilities=capabilities)
    handler = DefaultRequestHandler(
        agent_executor=_make_executor(agent_id, provider, room, persona, model, timeout),
        task_store=InMemoryTaskStore(), agent_card=card)
    routes = create_agent_card_routes(card) + create_jsonrpc_routes(handler, rpc_url="/")
    return Starlette(routes=routes), card


# ---------------------------------------------------------------------------
# Serving helpers
# ---------------------------------------------------------------------------

def free_port() -> int:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


def serve(agent_id: str, *, provider: str, room: str, persona: Optional[str] = None,
          model: Optional[str] = None, host: str = "127.0.0.1", port: Optional[int] = None,
          capabilities: Optional[list[str]] = None, timeout: int = 600, block: bool = True):
    """Run an A2A server for one agent. Blocks (foreground) by default."""
    import uvicorn
    port = port or free_port()
    url = f"http://{host}:{port}"
    app, card = build_app(agent_id, provider=provider, room=room, url=url,
                          persona=persona, model=model, capabilities=capabilities,
                          timeout=timeout)
    config = uvicorn.Config(app, host=host, port=port, log_level="error")
    server = uvicorn.Server(config)
    if block:
        print(f"[a2a] serving {agent_id} ({provider}) at {url}  card={url}/.well-known/agent-card.json")
        server.run()
        return None
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    return {"server": server, "thread": th, "url": url, "port": port, "card": card}


def wait_healthy(url: str, attempts: int = 50, delay: float = 0.2) -> bool:
    import httpx
    for _ in range(attempts):
        try:
            r = httpx.get(url + "/.well-known/agent-card.json", timeout=1.0)
            if r.status_code == 200:
                return True
        except Exception:
            pass
        time.sleep(delay)
    return False
