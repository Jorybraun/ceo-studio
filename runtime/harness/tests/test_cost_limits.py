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
    from config import cost_limits
    importlib.reload(cost_limits)
    return cost_limits


def test_paid_agent_classification(cl):
    assert cl.is_paid_agent("grok-research") is True
    assert cl.is_paid_agent("grok-builder") is True
    assert cl.is_paid_agent("grok") is False          # primary shared session
    assert cl.is_paid_agent("deep-researcher") is False


def test_paid_agent_label_does_not_block_spawn(cl):
    ok, reason = cl.can_spawn("grok-research", running_count=0)
    assert ok is True
    assert reason == "ok"


def test_interactive_flag_does_not_change_paid_policy(cl):
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


def test_count_running_agents_only_counts_pipe_sessions(cl, monkeypatch):
    """Only `pipe-*` agent sessions count; scratch/infra tmux sessions must not.

    Regression: counting EVERY tmux session let unrelated shells (e.g.
    `agent-chat`, `agent-orchestration`) consume the concurrency budget, so
    mounting a real agent was falsely denied with "max concurrent agents
    reached". See main/core/mount.js.
    """
    sessions = "agent-chat\nagent-orchestration\npipe-ba\npipe-discover-pm\npipe-pm\n"

    class _Fake:
        returncode = 0
        stdout = sessions

    monkeypatch.delenv("CEO_GUARDRAIL_DISABLE_TMUX", raising=False)
    monkeypatch.setattr(cl.subprocess, "run", lambda *a, **k: _Fake())
    # 5 live tmux sessions, but only 3 are agents (pipe-*).
    assert cl.count_running_agents() == 3
    # Legacy behavior (count all) is still available via empty prefix.
    monkeypatch.setattr(cl, "AGENT_SESSION_PREFIX", "")
    assert cl.count_running_agents() == 5


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
    poll cycle. Previously this spawned unbounded paid sessions. Now the hourly
    spawn cap bounds it without blocking paid-labeled providers outright.
    """
    monkeypatch.setattr(cl, "MAX_SPAWNS_PER_HOUR", 12)
    allowed = 0
    for _ in range(50):  # 50 poll cycles with the stuck action
        ok, _ = cl.can_spawn("grok-research", running_count=0)
        if ok:
            allowed += 1
            cl.record_spawn("grok-research")
    assert allowed == 12


def test_cli_check_exit_codes(cl, tmp_path, monkeypatch):
    """The shell-facing CLI allows paid labels but denies real cap breaches."""
    import subprocess
    import sys
    from pathlib import Path

    harness_root = Path(__file__).resolve().parent.parent
    env = {
        **__import__("os").environ,
        "CEO_GUARDRAIL_DIR": str(tmp_path / "cli-guardrail"),
        "CEO_GUARDRAIL_DISABLE_TMUX": "1",
    }
    allowed_paid = subprocess.run(
        [sys.executable, str(harness_root / "config" / "cost_limits.py"), "check", "grok-research"],
        capture_output=True, text=True, env=env,
    )
    assert allowed_paid.returncode == 0

    denied = subprocess.run(
        [sys.executable, str(harness_root / "config" / "cost_limits.py"), "check", "deep-researcher"],
        capture_output=True, text=True, env={**env, "CEO_MAX_SPAWNS_PER_HOUR": "0"},
    )
    assert denied.returncode == 3

    allowed = subprocess.run(
        [sys.executable, str(harness_root / "config" / "cost_limits.py"), "check", "deep-researcher"],
        capture_output=True, text=True, env=env,
    )
    assert allowed.returncode == 0
