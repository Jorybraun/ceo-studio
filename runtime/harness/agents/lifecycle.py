"""
Agent lifecycle state machine.

Harvested (and made real) from the retired TypeScript `agent-orchestration`
spike's `AgentLifecycleManager`. The spike had the right *idea* but its auto
timers only flipped a flag and never actually tore the agent down
("// For now, just mark as sleeping"). This version wires the idle/sleep timers
to real teardown callbacks so an idle agent genuinely goes to sleep and a
long-sleeping agent genuinely stops.

Design:
  - Keyed by a free-form ``agent_id`` string, so it already supports multiple
    live instances of the same persona later (e.g. ``architect-1``,
    ``architect-2``) with zero changes here.
  - The state machine owns *only* state + timing. The actual work of waking,
    sleeping, and stopping an agent is injected as callbacks at register time,
    so this module stays free of tmux / provider specifics and is trivially
    testable. `HerderAgent.start()` / `.stop()` are the obvious callbacks to
    pass when wiring this into the live harness.

States::

    DORMANT --wake--> STARTING --ok--> ACTIVE <--> IDLE --idle_timeout--> SLEEP
       ^                                  |                                 |
       |                                  +--------- stop --------> STOPPED |
       +---------------------------------- wake ------------------- SLEEP <-+
                                                       (sleep_timeout) --> STOPPED
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional


class AgentState(str, Enum):
    DORMANT = "dormant"      # registered, never started
    STARTING = "starting"    # waking up
    ACTIVE = "active"        # running, processing
    IDLE = "idle"            # running, no current work (sleep countdown armed)
    SLEEPING = "sleeping"    # transitioning to sleep
    SLEEP = "sleep"          # asleep, minimal resources (stop countdown armed)
    STOPPING = "stopping"    # shutting down
    STOPPED = "stopped"      # terminated


# A callback that performs the real side effect (start/sleep/stop). May be a
# no-op for pure state tracking. Exceptions propagate to the caller of the
# triggering method; auto-timer failures are swallowed (logged) so a background
# timer can never crash the process.
SideEffect = Callable[[], None]


def _noop() -> None:
    return None


@dataclass
class LifecycleConfig:
    """Timeouts in seconds. Set a timeout to ``None`` (or <= 0) to disable it."""
    idle_timeout: float = 5 * 60        # IDLE -> SLEEP
    sleep_timeout: float = 30 * 60      # SLEEP -> STOPPED


@dataclass
class _Entry:
    state: AgentState = AgentState.DORMANT
    last_activity: float = field(default_factory=time.monotonic)
    wake_fn: SideEffect = _noop
    sleep_fn: SideEffect = _noop
    stop_fn: SideEffect = _noop
    idle_timer: Optional[threading.Timer] = None
    sleep_timer: Optional[threading.Timer] = None


class AgentLifecycleManager:
    """Thread-safe lifecycle state machine for a set of agent ids."""

    def __init__(self, config: Optional[LifecycleConfig] = None,
                 on_log: Optional[Callable[[str], None]] = None):
        self._cfg = config or LifecycleConfig()
        self._lock = threading.RLock()
        self._agents: dict[str, _Entry] = {}
        self._log = on_log or (lambda msg: None)

    # -- registration --------------------------------------------------------

    def register(self, agent_id: str, *, wake_fn: SideEffect = _noop,
                 sleep_fn: SideEffect = _noop, stop_fn: SideEffect = _noop) -> None:
        """Register an agent in DORMANT state with its real side-effect callbacks."""
        with self._lock:
            self._agents[agent_id] = _Entry(
                wake_fn=wake_fn, sleep_fn=sleep_fn, stop_fn=stop_fn)
        self._log(f"registered {agent_id} (dormant)")

    def unregister(self, agent_id: str) -> None:
        with self._lock:
            entry = self._agents.pop(agent_id, None)
            if entry:
                self._clear_timers(entry)

    # -- explicit transitions ------------------------------------------------

    def wake_up(self, agent_id: str) -> None:
        """DORMANT/SLEEP/STOPPED -> ACTIVE. Runs ``wake_fn``; arms the idle timer."""
        entry = self._require(agent_id)
        with self._lock:
            if entry.state in (AgentState.ACTIVE, AgentState.STARTING):
                return
            entry.state = AgentState.STARTING
        try:
            entry.wake_fn()
        except Exception:
            with self._lock:
                entry.state = AgentState.STOPPED
            raise
        with self._lock:
            entry.state = AgentState.ACTIVE
            entry.last_activity = time.monotonic()
            self._arm_idle_timer(agent_id, entry)
        self._log(f"{agent_id} -> active")

    def mark_active(self, agent_id: str) -> None:
        """Agent started processing; refresh activity + reset the sleep countdown."""
        entry = self._require(agent_id)
        with self._lock:
            entry.state = AgentState.ACTIVE
            entry.last_activity = time.monotonic()
            self._clear_timers(entry)

    def mark_idle(self, agent_id: str) -> None:
        """Agent finished work; arm the idle->sleep countdown."""
        entry = self._require(agent_id)
        with self._lock:
            entry.state = AgentState.IDLE
            entry.last_activity = time.monotonic()
            self._arm_idle_timer(agent_id, entry)
        self._log(f"{agent_id} -> idle")

    def go_to_sleep(self, agent_id: str) -> None:
        """-> SLEEP. Runs ``sleep_fn``; arms the sleep->stop countdown."""
        entry = self._require(agent_id)
        with self._lock:
            if entry.state in (AgentState.SLEEP, AgentState.DORMANT, AgentState.STOPPED):
                return
            entry.state = AgentState.SLEEPING
            self._clear_timers(entry)
        try:
            entry.sleep_fn()
        except Exception:
            with self._lock:
                entry.state = AgentState.ACTIVE
            raise
        with self._lock:
            entry.state = AgentState.SLEEP
            self._arm_sleep_timer(agent_id, entry)
        self._log(f"{agent_id} -> sleep")

    def stop(self, agent_id: str) -> None:
        """-> STOPPED. Runs ``stop_fn`` and clears all timers."""
        entry = self._require(agent_id)
        with self._lock:
            if entry.state in (AgentState.STOPPED, AgentState.DORMANT):
                entry.state = AgentState.STOPPED
                self._clear_timers(entry)
                return
            entry.state = AgentState.STOPPING
            self._clear_timers(entry)
        try:
            entry.stop_fn()
        except Exception:
            with self._lock:
                entry.state = AgentState.ACTIVE
            raise
        with self._lock:
            entry.state = AgentState.STOPPED
        self._log(f"{agent_id} -> stopped")

    # -- queries -------------------------------------------------------------

    def state(self, agent_id: str) -> AgentState:
        with self._lock:
            entry = self._agents.get(agent_id)
            return entry.state if entry else AgentState.DORMANT

    def agents_by_state(self, state: AgentState) -> list[str]:
        with self._lock:
            return [aid for aid, e in self._agents.items() if e.state == state]

    def stats(self) -> dict:
        with self._lock:
            by_state: dict[str, int] = {s.value: 0 for s in AgentState}
            for e in self._agents.values():
                by_state[e.state.value] += 1
            return {
                "total": len(self._agents),
                "by_state": by_state,
                "config": {"idle_timeout": self._cfg.idle_timeout,
                           "sleep_timeout": self._cfg.sleep_timeout},
            }

    def shutdown(self) -> None:
        """Cancel every pending timer (e.g. on process exit)."""
        with self._lock:
            for entry in self._agents.values():
                self._clear_timers(entry)

    # -- timers (the real fix vs the TS stub) --------------------------------

    def _arm_idle_timer(self, agent_id: str, entry: _Entry) -> None:
        self._clear_timers(entry)
        t = self._cfg.idle_timeout
        if not t or t <= 0:
            return
        entry.idle_timer = threading.Timer(t, self._on_idle_timeout, args=(agent_id,))
        entry.idle_timer.daemon = True
        entry.idle_timer.start()

    def _arm_sleep_timer(self, agent_id: str, entry: _Entry) -> None:
        t = self._cfg.sleep_timeout
        if not t or t <= 0:
            return
        entry.sleep_timer = threading.Timer(t, self._on_sleep_timeout, args=(agent_id,))
        entry.sleep_timer.daemon = True
        entry.sleep_timer.start()

    def _clear_timers(self, entry: _Entry) -> None:
        for attr in ("idle_timer", "sleep_timer"):
            timer = getattr(entry, attr)
            if timer is not None:
                timer.cancel()
                setattr(entry, attr, None)

    def _on_idle_timeout(self, agent_id: str) -> None:
        # Only sleep if still idle (activity since arming cancels this path).
        with self._lock:
            entry = self._agents.get(agent_id)
            if not entry or entry.state != AgentState.IDLE:
                return
        try:
            self.go_to_sleep(agent_id)
        except Exception as exc:  # never let a background timer crash us
            self._log(f"auto-sleep failed for {agent_id}: {exc}")

    def _on_sleep_timeout(self, agent_id: str) -> None:
        with self._lock:
            entry = self._agents.get(agent_id)
            if not entry or entry.state != AgentState.SLEEP:
                return
        try:
            self.stop(agent_id)
        except Exception as exc:
            self._log(f"auto-stop failed for {agent_id}: {exc}")

    # -- internal ------------------------------------------------------------

    def _require(self, agent_id: str) -> _Entry:
        with self._lock:
            entry = self._agents.get(agent_id)
        if entry is None:
            raise KeyError(f"agent not registered: {agent_id}")
        return entry
