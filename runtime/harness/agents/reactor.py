"""
reactor.py

Basic reactor abstractions for HerderAgent.

This allows the same HerderAgent object to be used in two modes:

A) Orchestrator-driven (current primary mode):
   - The Chat Orchestrator / kanban swarm decides when to call react_to_messages()
   - Good for control and coordination right now.

B) More autonomous (future / experimental):
   - The agent can run its own background reactor loop.
   - It watches for messages addressed to it and reacts using its loaded persona + skills.
   - This is the path toward "genuinely autonomous agents".

The design intentionally supports both so we don't have to choose one prematurely.
"""

from __future__ import annotations

import threading
import time
from typing import TYPE_CHECKING, Callable

if TYPE_CHECKING:
    from .herder_agent import HerderAgent


class AgentReactor:
    """
    A reactor that can be attached to a HerderAgent to give it reactive behavior.

    The reactor is given a callback or uses the agent's loaded persona + skills
    to decide what to do when it receives messages.
    """

    def __init__(self, agent: "HerderAgent", on_message: Callable | None = None):
        self.agent = agent
        self.on_message = on_message
        self._running = False
        self._thread: threading.Thread | None = None
        self._stop_event = threading.Event()

    def start(self, background: bool = False, poll_interval: float = 5.0) -> None:
        """Start the reactor. If background=True, runs in a daemon thread."""
        if self._running:
            return

        self._running = True
        self._stop_event.clear()

        if background:
            self._thread = threading.Thread(
                target=self._run_loop, args=(poll_interval,), daemon=True
            )
            self._thread.start()
            print(f"[Reactor] Started background reactor for {self.agent.name}")
        else:
            self._run_loop(poll_interval)

    def stop(self) -> None:
        """Stop the reactor loop."""
        self._stop_event.set()
        self._running = False
        if self._thread and self._thread.is_alive():
            self._thread.join(timeout=2)
        print(f"[Reactor] Stopped reactor for {self.agent.name}")

    def _run_loop(self, poll_interval: float) -> None:
        consecutive_errors = 0
        max_consecutive_errors = 10
        max_backoff = 300.0
        while not self._stop_event.is_set():
            try:
                self.step()
                consecutive_errors = 0
                # Normal cadence (interruptible).
                self._stop_event.wait(poll_interval)
            except Exception as e:
                consecutive_errors += 1
                backoff = min(poll_interval * (2 ** consecutive_errors), max_backoff)
                print(f"[Reactor] Error in reactor for {self.agent.name} "
                      f"(attempt {consecutive_errors}/{max_consecutive_errors}): {e}. "
                      f"Backing off {backoff:.0f}s")
                if consecutive_errors >= max_consecutive_errors:
                    print(f"[Reactor] Too many consecutive errors for {self.agent.name}; stopping loop.")
                    self._running = False
                    return
                # Exponential backoff (interruptible) instead of hammering on a persistent error.
                self._stop_event.wait(backoff)

    def step(self) -> None:
        """Single step of the reactor. Pull messages and react."""
        messages = self.agent.get_messages_for_me()
        if not messages:
            return

        if self.on_message:
            self.on_message(self.agent, messages)
        else:
            # Default behavior: use the agent's loaded behavior
            self.agent.react_to_messages()


def create_simple_reactor(agent: "HerderAgent") -> AgentReactor:
    """Create a basic reactor that just calls the agent's react_to_messages()."""
    return AgentReactor(agent)