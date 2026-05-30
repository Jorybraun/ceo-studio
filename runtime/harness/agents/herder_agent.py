"""
herder_agent.py

Base class for a live agent instance managed by the herder.

This is the missing abstraction that lets the Chat Orchestrator / kanban swarm
actually *invoke* and control agents defined in the registry, instead of
just manually running launch-agent or sending keys.

Design goals:
- One class instance = one logical agent from the registry.
- Can start/stop the underlying herder resources (tmux session + watcher).
- Provides a clean API for higher-level orchestration (send, steer, status).
- Stays compatible with the existing CLI tools for now (launch-agent, herder-steer).
"""

from __future__ import annotations

import json
import subprocess
import time
import uuid
from dataclasses import dataclass, asdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional

from . import registry as agent_registry
from .reactor import AgentReactor, create_simple_reactor


@dataclass
class AgentStatus:
    name: str
    is_running: bool
    persona: str | None = None
    last_seen: str | None = None
    tmux_session: str | None = None
    mission: str | None = None


@dataclass
class AgentMessage:
    """Structured message between agents / orchestrator."""
    sender: str
    recipient: str
    content: str
    msg_type: str = "message"
    timestamp: str = ""
    message_id: str = ""
    metadata: dict[str, Any] | None = None

    def __post_init__(self):
        if not self.timestamp:
            self.timestamp = datetime.now(timezone.utc).isoformat()
        if not self.message_id:
            self.message_id = str(uuid.uuid4())

    def to_room_format(self) -> str:
        """How this message appears when posted to the domain room (for visibility)."""
        payload = {
            "type": "AGENT_MESSAGE",
            "id": self.message_id,
            "from": self.sender,
            "to": self.recipient,
            "msg_type": self.msg_type,
            "content": self.content,
            "metadata": self.metadata or {},
        }
        return f"[AGENT_MSG] {json.dumps(payload, ensure_ascii=False)}"

    @classmethod
    def from_room_line(cls, line: str) -> Optional["AgentMessage"]:
        """Try to parse an AgentMessage from a room line."""
        if "[AGENT_MSG]" not in line:
            return None
        try:
            json_part = line.split("[AGENT_MSG]", 1)[1].strip()
            data = json.loads(json_part)
            return cls(
                sender=data.get("from", ""),
                recipient=data.get("to", ""),
                content=data.get("content", ""),
                msg_type=data.get("msg_type", "message"),
                timestamp=data.get("timestamp") or datetime.now(timezone.utc).isoformat(),
                message_id=data.get("id") or str(uuid.uuid4()),
                metadata=data.get("metadata"),
            )
        except Exception:
            return None


class HerderAgent:
    """
    Represents a single agent from the registry as a controllable, live instance.

    This class gives the Chat Orchestrator / kanban swarm a clean object to
    start, stop, and talk *to* agents.

    Receiving messages / reacting intelligently is still the hard part.
    Right now the main ways an agent "receives" interesting input are:
    - Direct injection via .send() / herder-steer (you push text into their prompt)
    - The higher-level orchestrator calling .feed_to_brain() or .process_recent_room_activity()
    - A human manually pasting relevant room excerpts + instructions

    This class supports two modes of operation (you said you want both):

    Mode A — Orchestrator-driven (better control right now):
        The Chat Orchestrator / kanban swarm explicitly calls methods like
        react_to_messages(), send_message(), etc. The agent is still somewhat
        "manually driven" from above.

    Mode B — More autonomous (path toward real independence):
        You attach or start a reactor (`start_reactor(background=True)`).
        The agent can then run its own loop, watch for messages addressed to it,
        and react using its loaded persona + skills with less constant supervision.

    You can start in Mode A and gradually give agents more autonomy by starting
    their reactors.

    Example (orchestrator-driven):
        builder = HerderAgent.from_registry("grok-builder")
        builder.start()
        builder.load_persona()
        builder.load_skill("herder-swarm-control")
        builder.react_to_messages()

    Example (more autonomous):
        builder.start_reactor(background=True)
        # The agent now reacts on its own in the background
    """

    def __init__(self, agent_def: dict[str, Any], room: str = "discovery"):
        self.defn = agent_def
        self.name: str = agent_def["id"]
        self.persona: str = agent_def.get("persona", "")
        self.default_room: str = agent_def.get("default_room", room)
        self.tmux_session: str = agent_def.get("tmux_session", f"pipe-{self.name}")
        self.launch_mode: str = agent_def.get("launch_mode", "external")
        self.mission: str = agent_def.get("mission", "")

        self.room_dir = Path(__file__).parent.parent / "brain" / "rooms" / self.default_room
        self.presence_dir = self.room_dir / "presence"

        # Loaded behavior
        self._loaded_persona: str | None = None
        self._loaded_persona_name: str | None = None
        self._loaded_skills: dict[str, str] = {}

        # Reactor (for autonomous mode)
        self.reactor: AgentReactor | None = None

    @classmethod
    def from_registry(cls, name: str, room: str = "discovery") -> "HerderAgent":
        """Convenience constructor using the central registry."""
        agent_def = agent_registry.get_agent(name)
        if not agent_def:
            raise ValueError(f"Agent '{name}' not found in registry")
        return cls(agent_def, room=room)

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self, wait_for_presence: bool = True, timeout: int = 30) -> bool:
        """
        Ensure this agent is running.

        Uses the existing launch-agent mechanism (which respects the registry).
        Returns True if the agent is running after this call.
        """
        if self.is_running():
            return True

        print(f"[HerderAgent] Starting {self.name} (persona={self.persona})...")

        launch_cmd = [
            str(Path(__file__).parent.parent / "bin" / "launch-agent"),
            "--name", self.name,
        ]
        # launch-agent now auto-resolves persona from registry in most cases

        result = subprocess.run(launch_cmd, capture_output=True, text=True, timeout=60)
        if result.returncode != 0:
            print(f"[HerderAgent] Failed to start {self.name}: {result.stderr or result.stdout}")
            return False

        if wait_for_presence:
            return self._wait_for_presence(timeout=timeout)

        return True

    def activate_for_orchestration(self, room: str | None = None, initial_message: str | None = None) -> bool:
        """
        Orchestrator-friendly activation.

        - Starts the agent via the registry (creates the full herder tmux session pipe-<name>).
        - Posts clear navigation instructions into the room so the human (or other agents)
          can easily switch to the agent's dedicated herder session.
        - Optionally sends an initial message/steer after launch.

        This is what the AI Swarm Facilitator ("grok") should call when it decides
        an agent needs to exist because it wants to message or coordinate with it.
        """
        target_room = room or self.default_room

        if not self.start(wait_for_presence=True):
            # Still try to post navigation even on partial failure
            self._post_navigation_help(target_room)
            return False

        self._post_navigation_help(target_room)

        if initial_message:
            # Send structured + visible post + direct steer if possible
            self.send_message(self.name, initial_message, msg_type="orchestration")
            try:
                from . import registry as agent_registry
                plan = agent_registry.get_launch_plan(self.name)
                disp = plan.get("display_name", self.name)
            except Exception:
                disp = self.name
            self.send_via_room(f"[Orchestrator] Initial message sent to {disp}: {initial_message[:120]}...", speaker="Grok")

        return True

    def _post_navigation_help(self, room: str):
        """Post clear instructions so humans can navigate to this agent's herder tmux session."""
        try:
            from . import registry as agent_registry
            plan = agent_registry.get_launch_plan(self.name)
            session = plan.get("tmux_session", self.tmux_session)
            display = plan.get("display_name", self.name)
        except Exception:
            session = self.tmux_session
            display = self.name

        nav_msg = (
            f"=== Herder session for {display} is now live ===\n"
            f"tmux session: {session}\n\n"
            f"To navigate / jump into this agent's herder session:\n"
            f"  tmux switch-client -t {session}\n"
            f"  (or from outside: tmux attach -t {session})\n\n"
            f"Inside the session you will usually have a 'main' window for the agent brain "
            f"and a 'watcher' window for room visibility. The orchestrator can steer it directly."
        )

        # Post visibly in the room
        post_cmd = [
            str(Path(__file__).parent.parent / "bin" / "domain-room"),
            "post",
            room,
            "Grok",
            nav_msg,
        ]
        try:
            subprocess.run(post_cmd, capture_output=True, timeout=10)
        except Exception:
            pass

        print(f"[HerderAgent] Posted navigation help for {self.name} into room {room}")

    def stop(self, kill_session: bool = True) -> None:
        """Stop the agent (currently by killing the tmux session)."""
        if not self.is_running():
            return

        if kill_session:
            subprocess.run(["tmux", "kill-session", "-t", self.tmux_session],
                           capture_output=True)
            print(f"[HerderAgent] Stopped {self.name} (killed {self.tmux_session})")

    def is_running(self) -> bool:
        """Check if the tmux session for this agent exists."""
        result = subprocess.run(
            ["tmux", "has-session", "-t", self.tmux_session],
            capture_output=True
        )
        return result.returncode == 0

    # ------------------------------------------------------------------
    # Behavior / Skill loading (the "how should I respond" part)
    # ------------------------------------------------------------------

    def load_persona(self, persona_name: str | None = None) -> str:
        """
        Load the persona definition for this agent.
        Primary source is now the big user-managed harness/personas/ folder
        (supports subfolders for domains, categories, etc.).
        """
        name = persona_name or self.persona
        if not name:
            raise ValueError(f"No persona defined for agent {self.name}")

        search_roots = [
            Path(__file__).parent.parent / "personas",
            Path(__file__).parent.parent / "skills" / "planning-team",
            Path(__file__).parent.parent / "agents" / "personas",
        ]

        variants = [name, name.lower(), name.replace(" ", "_"), name.replace(" ", "-")]

        for root in search_roots:
            if not root.exists():
                continue
            for variant in variants:
                for path in root.rglob(f"*{variant}*.md"):
                    if path.is_file():
                        self._loaded_persona = path.read_text()
                        self._loaded_persona_name = name
                        return self._loaded_persona

        # Fallback
        self._loaded_persona = f"You are acting as the {name} persona."
        self._loaded_persona_name = name
        return self._loaded_persona

    def load_skill(self, skill_name: str) -> str:
        """
        Load a skill definition (e.g. 'herder-swarm-control').
        Returns the skill content.
        """
        skill_path = Path(__file__).parent.parent / "skills" / skill_name / "SKILL.md"
        if skill_path.exists():
            content = skill_path.read_text()
            self._loaded_skills[skill_name] = content
            return content

        # Try without the subfolder convention
        alt = Path(__file__).parent.parent / "skills" / f"{skill_name}.md"
        if alt.exists():
            content = alt.read_text()
            self._loaded_skills[skill_name] = content
            return content

        raise FileNotFoundError(f"Skill '{skill_name}' not found")

    def _wait_for_presence(self, timeout: int = 30) -> bool:
        """Wait until this agent has written a presence file."""
        persona_file = self.presence_dir / f"{self.name}.persona"
        deadline = time.time() + timeout

        while time.time() < deadline:
            if persona_file.exists():
                return True
            time.sleep(0.5)

        print(f"[HerderAgent] Warning: {self.name} did not register presence in time")
        return False

    # ------------------------------------------------------------------
    # Communication / Steering
    # ------------------------------------------------------------------

    def send(self, message: str, submit: bool = True) -> bool:
        """
        Send a message into this agent's tmux session (the 'fire in the input' path).

        If the session isn't running, it will attempt to start it first.
        """
        if not self.is_running():
            if not self.start():
                return False

        steer_cmd = [
            str(Path(__file__).parent.parent / "bin" / "herder-steer"),
            self.name,
            message,
        ]
        if submit:
            steer_cmd.append("--submit")
        else:
            steer_cmd.append("--type-only")

        result = subprocess.run(steer_cmd, capture_output=True, text=True)
        return result.returncode == 0

    def send_via_room(self, message: str, speaker: str | None = None) -> None:
        """
        Post a message to the domain room as this agent.
        Useful for the Chat Orchestrator to speak on behalf of the swarm.
        """
        speaker = speaker or self.name
        post_cmd = [
            str(Path(__file__).parent.parent / "bin" / "domain-room"),
            "post",
            self.default_room,
            speaker,
            message,
        ]
        subprocess.run(post_cmd, capture_output=True)

    # ------------------------------------------------------------------
    # Receiving side (the part that was missing)
    # ------------------------------------------------------------------

    def get_recent_messages(self, limit: int = 20) -> list[str]:
        """Return the most recent raw lines from the domain room chat.log.

        DEPRECATED / DANGEROUS for long-running use:
        This does a full file read on every call. With chat logs at 600k+ lines this
        causes severe memory pressure and repeated work. Use get_new_messages() instead.
        """
        chat_log = self.room_dir / "chat.log"
        if not chat_log.exists():
            return []
        try:
            # Guard against pathological logs
            if chat_log.stat().st_size > 50 * 1024 * 1024:  # 50MB
                print(f"[HerderAgent] WARNING: {chat_log} is >50MB. Forcing use of get_new_messages() path.")
                return self.get_new_messages(limit=limit)
            lines = chat_log.read_text(encoding="utf-8", errors="replace").splitlines()
            return [line for line in lines if line.strip() and not line.strip().startswith("#")][-limit:]
        except Exception:
            return []

    def get_new_messages(self, limit: int = 100) -> list[str]:
        """Return only *new* lines since the last call (memory efficient).

        This is the recommended method for long-running orchestrators and responders.
        It tracks a file offset internally so it doesn't re-read the whole chat.log every time.
        """
        chat_log = self.room_dir / "chat.log"
        if not hasattr(self, "_chat_offset"):
            self._chat_offset = 0

        if not chat_log.exists():
            return []

        try:
            with open(chat_log, "r", encoding="utf-8", errors="replace") as f:
                f.seek(self._chat_offset)
                new_lines = f.readlines()
                self._chat_offset = f.tell()

            cleaned = [line.rstrip("\n") for line in new_lines
                       if line.strip() and not line.strip().startswith("#")]
            return cleaned[-limit:] if limit else cleaned
        except Exception:
            return []

    def get_messages_since(self, timestamp: str | None = None, limit: int = 50) -> list[str]:
        """
        Return recent messages after a certain point (very rough for now).
        In a real system this would be timestamp-aware or use a proper feed.
        """
        # For v1 we just return the last N and let the caller filter
        return self.get_recent_messages(limit=limit)

    def feed_to_brain(self, context: str, instructions: str | None = None) -> None:
        """
        Best-effort: try to inject interesting context + instructions into this agent's
        current prompt (the 'main' pane of its tmux session).

        This is the crude but currently working way to make an agent "receive" something interesting.
        A real reactor would do this more intelligently (and possibly without tmux).
        """
        full_text = context
        if instructions:
            full_text += f"\n\n{instructions}"

        # Reuse the existing steering mechanism
        self.send(full_text, submit=True)

    def build_prompt(self, incoming_messages: list[AgentMessage] | None = None) -> str:
        """
        Build a prompt for this agent's brain using the loaded persona + skills
        + any incoming messages.
        This is what the Chat Orchestrator or a reactor would feed to the LLM.
        """
        parts = []

        if self._loaded_persona:
            parts.append(f"--- YOUR PERSONA ---\n{self._loaded_persona}")

        for skill_name, content in self._loaded_skills.items():
            parts.append(f"--- SKILL: {skill_name} ---\n{content}")

        if self.mission:
            parts.append(f"--- YOUR MISSION ---\n{self.mission}")

        if incoming_messages:
            parts.append("--- NEW MESSAGES FOR YOU ---")
            for m in incoming_messages:
                parts.append(f"From {m.sender} ({m.msg_type}):\n{m.content}\n")

        parts.append(
            "Respond appropriately. If you need to coordinate with other agents, "
            "use the room or structured messages. Stay in character."
        )

        return "\n\n".join(parts)

    def react_to_messages(self) -> None:
        """
        The core reactivity method.

        It looks for two things:
        1. Structured messages sent to it via the mailing system (`get_messages_for_me()`).
        2. Raw mentions of itself in the room chat (e.g. "@swarm-facilitator ...").

        It then builds a prompt using the loaded persona + skills and feeds it to the brain.

        This is what makes an agent "know it should respond" when it is addressed or relevant activity happens.
        """
        messages = self.get_messages_for_me()

        # Also look for raw @mentions in the room (very useful for natural conversation)
        # Use efficient new-only reading for long-running agents
        recent_raw = self.get_new_messages(limit=50)
        my_mentions = []
        my_names = {self.name.lower(), self._loaded_persona_name.lower() if self._loaded_persona_name else ""}
        for line in recent_raw:
            lower = line.lower()
            if any(f"@{n}" in lower or f" {n}:" in lower for n in my_names if n):
                my_mentions.append(line)

        if not messages and not my_mentions:
            return

        context_parts = []
        if messages:
            context_parts.append("Structured messages addressed to you:")
            for m in messages:
                context_parts.append(f"From {m.sender} [{m.msg_type}]: {m.content}")

        if my_mentions:
            context_parts.append("\nRecent messages in the room that mention you:")
            context_parts.extend(my_mentions)

        context = "\n".join(context_parts)

        instructions = (
            f"You are {self.name}."
            + (f" ({self._loaded_persona_name})" if self._loaded_persona_name else "")
            + "\n\n"
            + "You have the following loaded behavior/skills:\n"
            + "\n".join(self._loaded_skills.values())
            + "\n\n"
            + "Decide if you need to respond or take action based on the messages above. "
            + "Respond in character using the room or structured messages to other agents."
        )

        self.feed_to_brain(context, instructions)

    # ------------------------------------------------------------------
    # Reactor support (dual-mode: controlled vs more autonomous)
    # ------------------------------------------------------------------

    def attach_reactor(self, reactor: AgentReactor | None = None) -> AgentReactor:
        """Attach (or create) a reactor to this agent."""
        if reactor is None:
            reactor = create_simple_reactor(self)
        self.reactor = reactor
        return reactor

    def start_reactor(self, background: bool = False, poll_interval: float = 5.0) -> AgentReactor:
        """
        Start a reactor for this agent.

        - background=False (default): Run the reactor in the current thread (blocking).
          Good when the Chat Orchestrator wants to drive it explicitly.

        - background=True: Run in a daemon thread. This moves the agent toward
          more independent operation (path B).
        """
        if self.reactor is None:
            self.attach_reactor()

        self.reactor.start(background=background, poll_interval=poll_interval)
        return self.reactor

    def stop_reactor(self) -> None:
        if self.reactor:
            self.reactor.stop()

    def serve(self, background: bool = False, auto_load_skill: str | None = "herder-swarm-control") -> None:
        """
        Convenience: Start the agent and its reactor so it becomes an active,
        responsive participant.

        This is the closest thing we have today to "start an agent that will
        pay attention and respond on its own using its persona + skill".

        If `auto_load_skill` is given, it will try to load it automatically.
        """
        self.start()

        if not self._loaded_persona:
            try:
                self.load_persona()
            except Exception:
                pass

        if auto_load_skill and not self._loaded_skills:
            try:
                self.load_skill(auto_load_skill)
            except Exception:
                pass

        self.start_reactor(background=background)

    # ------------------------------------------------------------------
    # Managed Communication (Mailing system between agent instances)
    # ------------------------------------------------------------------

    def send_message(self, recipient: str, content: str, msg_type: str = "message", metadata: dict | None = None) -> bool:
        """
        Send a structured message to another agent (or the orchestrator).

        This posts a visible [AGENT_MSG] record to the domain room (for auditability)
        and also tries to directly steer the recipient if they are running (using keys).

        This is the managed communication channel between HerderAgent instances.
        """
        msg = AgentMessage(
            sender=self.name,
            recipient=recipient,
            content=content,
            msg_type=msg_type,
            metadata=metadata,
        )

        # 1. Post to the room for visibility (the herder way)
        try:
            post_cmd = [
                str(Path(__file__).parent.parent / "bin" / "domain-room"),
                "post",
                self.default_room,
                self.name,
                msg.to_room_format(),
            ]
            subprocess.run(post_cmd, capture_output=True, timeout=10)
        except Exception:
            pass

        # 2. Also try to fire it directly into the recipient's tmux pane if possible
        #    (so they "receive" it in their context even if they're not actively polling the room)
        try:
            from .herder_agent import HerderAgent as _HA  # avoid circular issues
            recipient_agent = _HA.from_registry(recipient, room=self.default_room)
            if recipient_agent.is_running():
                direct_text = f"[Message from {self.name} ({msg_type})]\n{content}"
                recipient_agent.send(direct_text, submit=True)
        except Exception:
            # Recipient might not be running or not in registry — that's okay, the room post is the durable record
            pass

        return True

    def get_messages_for_me(self, limit: int = 30, use_new_only: bool = True) -> list[AgentMessage]:
        """
        Scan the room for messages addressed to this agent.

        Strongly prefers the offset-based get_new_messages() to avoid OOM on large logs.
        The use_new_only=False path is kept only for debugging / one-off use.
        """
        messages: list[AgentMessage] = []

        if use_new_only:
            lines = self.get_new_messages(limit=limit)
        else:
            lines = self.get_recent_messages(limit=limit)

        for line in lines:
            msg = AgentMessage.from_room_line(line)
            if msg and msg.recipient.lower() == self.name.lower():
                messages.append(msg)
        return messages

    def reply_to(self, message: AgentMessage, content: str, msg_type: str = "reply") -> bool:
        """Convenience to reply to a received message."""
        return self.send_message(message.sender, content, msg_type=msg_type)

    # ------------------------------------------------------------------
    # Observability
    # ------------------------------------------------------------------

    def status(self) -> AgentStatus:
        """Return current status information about this agent."""
        last_seen = None
        last_file = self.presence_dir / f"{self.name}.last_seen"
        if last_file.exists():
            try:
                last_seen = last_file.read_text().strip()
            except Exception:
                pass

        return AgentStatus(
            name=self.name,
            is_running=self.is_running(),
            persona=self.persona,
            last_seen=last_seen,
            tmux_session=self.tmux_session,
            mission=self.mission,
        )

    def __repr__(self) -> str:
        running = "running" if self.is_running() else "stopped"
        return f"<HerderAgent name={self.name} persona={self.persona} {running}>"


# Convenience factory for the Swarm Facilitator / Chat Orchestrator itself
def get_swarm_facilitator(room: str = "discovery") -> HerderAgent:
    return HerderAgent.from_registry("swarm-facilitator", room=room)


# ---------------------------------------------------------------------------
# Example usage from the Chat Orchestrator / kanban swarm
# ---------------------------------------------------------------------------
#
# from agents import registry
#
# # The simplest way to get a responsive agent right now:
#
# agent = registry.get_agent_instance("grok-builder")
# agent.serve(background=True)     # start + load persona + load default skill + start reactor
#
# # Now when the agent receives messages (via the mailing system or @mentions in the room),
# # it will automatically construct a prompt using its persona + skill and respond.
#
# # You (the orchestrator) can still drive it explicitly with .send_message() or .react_to_messages()
# # whenever you want tighter control.