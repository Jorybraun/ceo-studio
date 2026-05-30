"""
planning_session.py

A higher-level construct for focused, multi-agent collaboration.

This is what you can use when you want:
- A dedicated room (or context) for a planning session.
- Specific agents from the registry to participate.
- Structured communication between them (using the mailing system).
- The Swarm Facilitator / Chat Orchestrator to moderate or observe.

Example:

    session = PlanningSession(
        name="microapp-graph-planning",
        participants=["swarm-facilitator", "grok-builder"],  # Prefer main grok over spawning grok-research
        room="planning-microapp-graph-2026-05-28"
    )
    session.start()
    session.run_discussion("Define the core graph schema requirements", rounds=3)
"""

from __future__ import annotations

import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from .herder_agent import HerderAgent, AgentMessage
from . import registry as agent_registry


@dataclass
class SessionParticipant:
    agent: HerderAgent
    role_in_session: str | None = None   # e.g. "lead researcher", "implementer"


class PlanningSession:
    """
    A focused collaboration space for a set of agents.

    Creates (or reuses) a room, launches the requested registry agents into it,
    sets up the mailing system for structured conversation, and provides
    orchestration helpers for running a "planning session".
    """

    def __init__(
        self,
        name: str,
        participants: list[str],           # registry ids
        room: str | None = None,
        facilitator: str = "swarm-facilitator",
    ):
        self.name = name
        self.room = room or f"session-{name}"
        self.facilitator_name = facilitator

        # Resolve participants from registry
        self.participants: dict[str, SessionParticipant] = {}
        for pid in participants:
            agent_def = agent_registry.get_agent(pid)
            if not agent_def:
                raise ValueError(f"Agent '{pid}' not found in registry")
            agent = HerderAgent(agent_def, room=self.room)
            self.participants[pid] = SessionParticipant(agent=agent)

        # The facilitator (usually the Chat Orchestrator)
        fac_def = agent_registry.get_agent(facilitator)
        self.facilitator = HerderAgent(fac_def, room=self.room) if fac_def else None

    # ------------------------------------------------------------------
    # Lifecycle
    # ------------------------------------------------------------------

    def start(self) -> None:
        """Create the room if needed and launch all participants + facilitator."""
        print(f"[PlanningSession] Starting '{self.name}' in room '{self.room}'")

        # Ensure room exists
        self._ensure_room()

        # Start facilitator first
        if self.facilitator:
            self.facilitator.start(wait_for_presence=True)
            print(f"  - Facilitator '{self.facilitator_name}' started")

        # Start participants
        for pid, p in self.participants.items():
            p.agent.start(wait_for_presence=True)
            print(f"  - Participant '{pid}' started in room '{self.room}'")

        print("[PlanningSession] All agents are live in the room.")

    def stop(self) -> None:
        """Stop all participants (and optionally the facilitator)."""
        print(f"[PlanningSession] Stopping session '{self.name}'")
        for pid, p in self.participants.items():
            p.agent.stop()
            print(f"  - Stopped {pid}")

        if self.facilitator:
            # Usually don't kill the main facilitator, but allow it
            # self.facilitator.stop()
            pass

    # ------------------------------------------------------------------
    # Communication helpers for the session
    # ------------------------------------------------------------------

    def post_as_facilitator(self, message: str) -> None:
        """Post a message from the facilitator into the session room."""
        if self.facilitator:
            self.facilitator.send_via_room(message, speaker="Swarm Facilitator")
        else:
            # Fallback to raw post
            cmd = [
                str(Path(__file__).parent.parent / "bin" / "domain-room"),
                "post",
                self.room,
                "Swarm Facilitator",
                message,
            ]
            subprocess.run(cmd, capture_output=True)

    def send_structured(self, from_agent: str, to_agent: str, content: str, msg_type: str = "task") -> bool:
        """Send a structured AgentMessage between two participants in this session."""
        sender = self.participants.get(from_agent) or self.facilitator
        if not sender:
            raise ValueError(f"Sender '{from_agent}' not part of this session")

        return sender.agent.send_message(
            recipient=to_agent,
            content=content,
            msg_type=msg_type,
            metadata={"session": self.name, "room": self.room}
        )

    def get_session_messages_for(self, agent_name: str) -> list[AgentMessage]:
        """Get messages addressed to a specific participant in this session."""
        agent = self.participants.get(agent_name)
        if agent:
            return agent.agent.get_messages_for_me()
        if agent_name == self.facilitator_name and self.facilitator:
            return self.facilitator.get_messages_for_me()
        return []

    # ------------------------------------------------------------------
    # High-level session orchestration
    # ------------------------------------------------------------------

    def run_discussion(self, topic: str, rounds: int = 3, main_room: str | None = None) -> dict:
        """
        Run a structured multi-agent think tank / Refinement session.

        Maintains a running "shared_brief" that accumulates key findings across rounds
        so agents have cumulative memory instead of stateless reactions.

        Returns a dict with:
          - transcript
          - shared_brief (the synthesized running context)
          - proposals (rough extraction of concrete items at the end)
        """
        print(f"\n=== Planning Session (Think Tank / Refinement): {self.name} ===")
        print(f"Topic: {topic}\n")

        transcript: list[str] = []
        self.shared_brief: list[str] = [f"Original topic: {topic}"]

        self.post_as_facilitator(
            f"**Refinement / Think Tank Session Started**\n\n"
            f"**Topic:** {topic}\n\n"
            f"**Participants:** {', '.join(self.participants.keys())}\n\n"
            "Running shared brief will be maintained across rounds.\n"
            "Focus on: evidence, risks, contradictions, concrete proposals, sizing, and what must be true for the next phase."
        )
        transcript.append(f"SESSION START: {topic}")

        for round_num in range(1, rounds + 1):
            print(f"\n--- Round {round_num}/{rounds} ---")

            # Inject the current shared brief + previous round highlights
            brief_text = "\n".join(self.shared_brief[-8:])  # last 8 bullets for context
            round_prompt = (
                f"**Round {round_num} / {rounds}**\n\n"
                f"**Current shared brief (accumulated so far):**\n{brief_text}\n\n"
                "Add new evidence, risks, open questions, contradictions, or concrete proposals.\n"
                "If you have a proposal, make it specific (what, why, rough size, first slice)."
            )
            self.post_as_facilitator(round_prompt)

            for pid, p in self.participants.items():
                if not p.agent.is_running():
                    print(f"  [skip] {pid} not running")
                    continue

                print(f"  Triggering reaction from {pid}...")
                try:
                    p.agent.load_persona()
                    for skill in ["herder-swarm-control", "herder-messaging", "pipe-os-management"]:
                        try:
                            p.agent.load_skill(skill)
                        except Exception:
                            pass
                    p.agent.react_to_messages()
                    transcript.append(f"[{pid}] contributed in round {round_num}")
                except Exception as e:
                    print(f"    Error with {pid}: {e}")

            # After the round, have the facilitator (orchestrator) synthesize new brief items
            # (In practice the human or top-level orchestrator will do richer synthesis;
            # here we at least record the round and prompt for updates)
            self.shared_brief.append(f"[After round {round_num}] Key points from participants should be reviewed and added to brief.")
            time.sleep(2.0)

        # Final synthesis + rough proposal extraction
        final_summary = (
            f"**Refinement Session Complete — {self.name}**\n\n"
            f"**Topic:** {topic}\n"
            f"**Rounds run:** {rounds}\n"
            f"**Participants:** {', '.join(self.participants.keys())}\n\n"
            f"**Running shared brief (last items):**\n" + "\n".join(self.shared_brief[-12:]) + "\n\n"
            f"Full discussion is in session room: {self.room}\n"
            "Next: Convert highest-value items into Triage cards or Ready work with acceptance criteria."
        )
        self.post_as_facilitator(final_summary)
        transcript.append("SESSION END")

        # Very rough proposal extraction (looks for lines that look like proposals in the brief)
        proposals = [line for line in self.shared_brief if any(kw in line.lower() for kw in ["propose", "should", "recommend", "first slice", "spike", "card", "triage"])]

        # Post a crisp handoff summary to the main domain room
        if main_room:
            try:
                handoff = (
                    f"[Refinement Complete] {self.name}\n"
                    f"Topic: {topic}\n"
                    f"See dedicated session room `{self.room}` for the full multi-agent debate + accumulated brief.\n"
                    f"Rough proposals surfaced: {len(proposals)} (review in session log).\n"
                    "Please turn the strongest outputs into formal Kanban items."
                )
                post_cmd = [
                    str(Path(__file__).parent.parent / "bin" / "domain-room"),
                    "post", main_room, "Swarm Facilitator", handoff
                ]
                subprocess.run(post_cmd, capture_output=True)
            except Exception as e:
                print(f"Could not post handoff to main room: {e}")

        return {
            "transcript": transcript,
            "shared_brief": self.shared_brief,
            "proposals": proposals,
            "session_room": self.room,
        }

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    def _ensure_room(self) -> None:
        """Create the room if it doesn't exist."""
        create_cmd = [
            str(Path(__file__).parent.parent / "bin" / "domain-room"),
            "create",
            self.room,
        ]
        subprocess.run(create_cmd, capture_output=True)  # idempotent enough for now


# Convenience factory
def create_planning_session(
    name: str,
    participants: list[str],
    room: str | None = None,
) -> PlanningSession:
    """Quick way to spin up a focused planning / Refinement think tank session."""
    return PlanningSession(name=name, participants=participants, room=room)


# Recommended default teams for Refinement / Think Tank work
#
# WARNING: Agents prefixed with "grok-" (grok-research, grok-builder, etc.)
# each run their own separate Grok API session. They are expensive and
# consume credits independently from the main orchestrator (you in pipe-grok).
#
# For research-heavy work, prefer routing through the current strong Grok
# (the main orchestrator) rather than spinning up grok-research.
# The dedicated grok-research agent has historically produced low-value output
# while still burning tokens.

REFINEMENT_TEAMS = {
    # Safer default: use the main orchestrator + builder. Avoid auto-spawning
    # separate high-cost research agents unless explicitly needed.
    "discovery-core": ["swarm-facilitator", "grok-builder"],

    # Only include dedicated researchers if you explicitly want the separate (expensive) session.
    "planning-heavy": ["swarm-facilitator", "grok-builder", "ba", "architect"],
    "research-swarm": ["swarm-facilitator", "grok-builder"],   # Changed from grok-research
}

def run_refinement_think_tank(
    name: str,
    topic: str,
    participants: list[str] | None = None,
    team: str | None = None,
    rounds: int = 4,
    main_room: str = "discovery",
) -> dict:
    """
    One-shot helper for running a proper Refinement / multi-agent think tank.

    IMPORTANT (credit safety):
    - Avoid including "grok-research" or other grok-* agents unless you have
      a specific reason. They run separate Grok API sessions and burn credits
      independently.
    - For most research/planning work, the current main Grok (you in pipe-grok)
      is higher quality and does not spawn extra billable sessions.

    Use explicit participants or a team from REFINEMENT_TEAMS.
    """
    if participants is None:
        if team and team in REFINEMENT_TEAMS:
            participants = REFINEMENT_TEAMS[team]
        else:
            participants = REFINEMENT_TEAMS["discovery-core"]

    # Extra safety: if someone explicitly passes grok-research, warn loudly
    if any("grok-research" in p for p in participants):
        print("!!! WARNING: You are about to activate grok-research.")
        print("!!! This is a separate high-cost Grok API agent.")
        print("!!! It has historically given low-value output while consuming credits.")
        print("!!! Consider doing the research directly in the main Grok instead.")

    session = create_planning_session(name=name, participants=participants, room=f"refinement-{name}")
    session.start()
    result = session.run_discussion(topic=topic, rounds=rounds, main_room=main_room)
    try:
        session.stop()
    except Exception:
        pass
    return result