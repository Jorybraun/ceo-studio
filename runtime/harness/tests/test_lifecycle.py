"""
Tests for the agent lifecycle state machine (agents/lifecycle.py).

Covers explicit transitions, callback invocation, and the real auto-sleep /
auto-stop timer teardown that the original TypeScript spike left stubbed.
NO API COST (pure state machine + injected callbacks).

Run: python3 tests/test_lifecycle.py
"""

import sys
import time
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

from agents.lifecycle import AgentLifecycleManager, AgentState, LifecycleConfig  # noqa: E402

passed = 0


def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


def test_explicit_transitions_and_callbacks():
    calls = []
    mgr = AgentLifecycleManager()
    mgr.register(
        "architect",
        wake_fn=lambda: calls.append("wake"),
        sleep_fn=lambda: calls.append("sleep"),
        stop_fn=lambda: calls.append("stop"),
    )
    ok("starts dormant", mgr.state("architect") == AgentState.DORMANT)

    mgr.wake_up("architect")
    ok("wake -> active", mgr.state("architect") == AgentState.ACTIVE)
    ok("wake_fn ran", calls == ["wake"])

    mgr.mark_idle("architect")
    ok("mark_idle -> idle", mgr.state("architect") == AgentState.IDLE)

    mgr.go_to_sleep("architect")
    ok("sleep -> sleep", mgr.state("architect") == AgentState.SLEEP)
    ok("sleep_fn ran", calls == ["wake", "sleep"])

    mgr.wake_up("architect")
    ok("re-wake from sleep -> active", mgr.state("architect") == AgentState.ACTIVE)

    mgr.stop("architect")
    ok("stop -> stopped", mgr.state("architect") == AgentState.STOPPED)
    ok("stop_fn ran", calls == ["wake", "sleep", "wake", "stop"])
    mgr.shutdown()


def test_idempotent_wake():
    mgr = AgentLifecycleManager()
    n = []
    mgr.register("ba", wake_fn=lambda: n.append(1))
    mgr.wake_up("ba")
    mgr.wake_up("ba")  # already active -> no-op, wake_fn must not run twice
    ok("wake is idempotent while active", n == [1])
    mgr.shutdown()


def test_auto_sleep_then_auto_stop_timers():
    """The real fix vs the TS stub: idle timer actually sleeps, sleep timer stops."""
    events = []
    cfg = LifecycleConfig(idle_timeout=0.15, sleep_timeout=0.15)
    mgr = AgentLifecycleManager(config=cfg)
    mgr.register(
        "pm",
        sleep_fn=lambda: events.append("slept"),
        stop_fn=lambda: events.append("stopped"),
    )
    mgr.wake_up("pm")
    mgr.mark_idle("pm")  # arms idle->sleep countdown (0.15s)

    time.sleep(0.35)  # allow idle->sleep, then sleep->stop to both fire
    ok("auto-slept via timer", "slept" in events)
    ok("auto-stopped via timer", "stopped" in events)
    ok("ended in STOPPED", mgr.state("pm") == AgentState.STOPPED)
    mgr.shutdown()


def test_activity_cancels_pending_sleep():
    cfg = LifecycleConfig(idle_timeout=0.2, sleep_timeout=10)
    mgr = AgentLifecycleManager(config=cfg)
    slept = []
    mgr.register("architect", sleep_fn=lambda: slept.append(1))
    mgr.wake_up("architect")
    mgr.mark_idle("architect")          # arm sleep countdown
    time.sleep(0.05)
    mgr.mark_active("architect")        # new activity should cancel it
    time.sleep(0.3)
    ok("activity cancelled auto-sleep", slept == [])
    ok("still active", mgr.state("architect") == AgentState.ACTIVE)
    mgr.shutdown()


def test_stats_and_unknown_agent():
    mgr = AgentLifecycleManager()
    mgr.register("a")
    mgr.register("b")
    mgr.wake_up("a")
    stats = mgr.stats()
    ok("stats total", stats["total"] == 2)
    ok("stats counts active", stats["by_state"]["active"] == 1)
    ok("stats counts dormant", stats["by_state"]["dormant"] == 1)
    ok("unknown agent reads dormant", mgr.state("ghost") == AgentState.DORMANT)

    raised = False
    try:
        mgr.wake_up("ghost")
    except KeyError:
        raised = True
    ok("waking unregistered agent raises", raised)
    mgr.shutdown()


if __name__ == "__main__":
    test_explicit_transitions_and_callbacks()
    test_idempotent_wake()
    test_auto_sleep_then_auto_stop_timers()
    test_activity_cancels_pending_sleep()
    test_stats_and_unknown_agent()
    print(f"\nAll {passed} lifecycle assertions passed.")
