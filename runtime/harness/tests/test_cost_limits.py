"""
Regression tests for the cost/concurrency guardrail (config/cost_limits.py).

These exist because a previous overnight run burned all API credits: the
orchestrator re-executed the same DELEGATE action every cycle, each time
spawning a separate paid Grok session, with no enforced cap. The guardrail
below is the single enforcement point; these tests pin its behavior.
"""

import importlib

import pytest


@pytest.fixture
def cl(tmp_path, monkeypatch):
    """Fresh, isolated guardrail module per test (tmp ledger dir, no tmux)."""
    monkeypatch.setenv("CEO_GUARDRAIL_DIR", str(tmp_path / "guardrail"))
    monkeypatch.setenv("CEO_GUARDRAIL_DISABLE_TMUX", "1")
    monkeypatch.delenv("CEO_ALLOW_PAID", raising=False)
    from config import cost_limits
    importlib.reload(cost_limits)
    return cost_limits


def test_paid_agent_classification(cl):
    assert cl.is_paid_agent("grok-research") is True
    assert cl.is_paid_agent("grok-builder") is True
    assert cl.is_paid_agent("grok") is False          # primary shared session
    assert cl.is_paid_agent("deep-researcher") is False


def test_paid_agent_denied_for_automated_spawn(cl):
    ok, reason = cl.can_spawn("grok-research", running_count=0)
    assert ok is False
    assert "paid" in reason.lower()


def test_paid_agent_allowed_when_enabled(cl, monkeypatch):
    monkeypatch.setattr(cl, "PAID_AGENTS_ENABLED", True)
    ok, _ = cl.can_spawn("grok-research", running_count=0)
    assert ok is True


def test_paid_agent_allowed_when_interactive(cl):
    ok, _ = cl.can_spawn("grok-research", running_count=0, interactive=True)
    assert ok is True


def test_normal_agent_allowed(cl):
    ok, reason = cl.can_spawn("deep-researcher", running_count=0)
    assert ok is True
    assert reason == "ok"


def test_per_cycle_cap(cl, monkeypatch):
    monkeypatch.setattr(cl, "MAX_SPAWNS_PER_CYCLE", 2)
    assert cl.can_spawn("agent-a", spawns_this_cycle=0, running_count=0)[0] is True
    assert cl.can_spawn("agent-a", spawns_this_cycle=1, running_count=0)[0] is True
    ok, reason = cl.can_spawn("agent-a", spawns_this_cycle=2, running_count=0)
    assert ok is False
    assert "per-cycle" in reason


def test_concurrency_cap(cl, monkeypatch):
    monkeypatch.setattr(cl, "MAX_CONCURRENT_AGENTS", 3)
    assert cl.can_spawn("agent-a", running_count=2)[0] is True
    ok, reason = cl.can_spawn("agent-a", running_count=3)
    assert ok is False
    assert "concurrent" in reason


def test_hourly_cap_via_ledger(cl, monkeypatch):
    monkeypatch.setattr(cl, "MAX_SPAWNS_PER_HOUR", 3)
    for _ in range(3):
        cl.record_spawn("deep-researcher")
    assert cl.recent_spawn_count() == 3
    ok, reason = cl.can_spawn("deep-researcher", running_count=0)
    assert ok is False
    assert "hourly" in reason


def test_kill_switch_blocks_everything(cl):
    cl.request_stop()
    ok, reason = cl.can_spawn("deep-researcher", running_count=0)
    assert ok is False
    assert "STOP" in reason
    cl.clear_stop()
    assert cl.can_spawn("deep-researcher", running_count=0)[0] is True


def test_credit_burn_scenario_is_bounded(cl, monkeypatch):
    """
    Simulate the original incident: the SAME paid delegation attempted on every
    poll cycle. Previously this spawned unbounded paid sessions. Now every such
    attempt must be refused under default (automated) config.
    """
    refused = 0
    for _ in range(50):  # 50 poll cycles with the stuck action
        ok, _ = cl.can_spawn("grok-research", running_count=0)
        if not ok:
            refused += 1
    assert refused == 50  # zero paid spawns allowed


def test_cli_check_exit_codes(cl, tmp_path, monkeypatch):
    """The shell-facing CLI must exit non-zero (deny) for paid agents."""
    import subprocess
    import sys
    from pathlib import Path

    harness_root = Path(__file__).resolve().parent.parent
    env = {
        **__import__("os").environ,
        "CEO_GUARDRAIL_DIR": str(tmp_path / "cli-guardrail"),
        "CEO_GUARDRAIL_DISABLE_TMUX": "1",
    }
    env.pop("CEO_ALLOW_PAID", None)

    denied = subprocess.run(
        [sys.executable, str(harness_root / "config" / "cost_limits.py"), "check", "grok-research"],
        capture_output=True, text=True, env=env,
    )
    assert denied.returncode == 3

    allowed = subprocess.run(
        [sys.executable, str(harness_root / "config" / "cost_limits.py"), "check", "deep-researcher"],
        capture_output=True, text=True, env=env,
    )
    assert allowed.returncode == 0
