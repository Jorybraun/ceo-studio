from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_cmd(args: list[str], tmp_path: Path, *, has_session: bool = False) -> subprocess.CompletedProcess[str]:
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    tmux_log = tmp_path / "tmux.log"
    fake_tmux = fake_bin / "tmux"
    fake_tmux.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"$TMUX_LOG\"\n"
        "case \"$1\" in\n"
        "  has-session) [[ \"${FAKE_TMUX_HAS_SESSION:-0}\" == \"1\" ]] && exit 0 || exit 1 ;;\n"
        "  list-sessions) exit 0 ;;\n"
        "  *) exit 0 ;;\n"
        "esac\n"
    )
    fake_tmux.chmod(0o755)
    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{fake_bin}:{env.get('PATH', '')}",
            "TMUX_LOG": str(tmux_log),
            "FAKE_TMUX_HAS_SESSION": "1" if has_session else "0",
            "HOME": str(tmp_path / "home"),
            "PYTHONPATH": str(ROOT),
        }
    )
    (tmp_path / "home").mkdir(exist_ok=True)
    return subprocess.run(args, cwd=ROOT, env=env, text=True, capture_output=True, timeout=20)


def tmux_log(tmp_path: Path) -> str:
    path = tmp_path / "tmux.log"
    return path.read_text() if path.exists() else ""


def test_registry_launch_plan_exposes_canonical_metadata() -> None:
    sys.path.insert(0, str(ROOT))
    from agents import registry

    plan = registry.get_launch_plan("kanban-orchestrator")

    expected_keys = {
        "id",
        "display_name",
        "canonical_room",
        "persona",
        "launch_mode",
        "tmux_session",
        "tmux_window",
        "profile",
        "command",
        "capabilities",
        "health_policy",
    }
    assert expected_keys.issubset(plan)
    assert plan["id"] == "kanban-orchestrator"
    assert plan["display_name"] == "Kanban Orchestrator"
    assert plan["canonical_room"] == "discovery"
    assert plan["launch_mode"] == "hermes_profile"
    assert plan["profile"] == "kanban-orchestrator"
    assert plan["tmux_session"] == "pipe-kanban-orchestrator"
    assert plan["tmux_window"] == "main"
    assert "strategic_orchestration" in plan["capabilities"]
    assert plan["health_policy"]["kind"] == "room_presence"


def test_registry_resolves_aliases_and_unknowns_visibly() -> None:
    sys.path.insert(0, str(ROOT))
    from agents import registry

    assert registry.resolve_agent_id("Chat Orchestrator") == "swarm-facilitator"
    assert registry.resolve_agent_id("swarm-facilitator") == "swarm-facilitator"
    assert registry.resolve_agent_id("definitely-not-real") is None


def test_launch_agent_uses_registry_hermes_profile_mode(tmp_path: Path) -> None:
    result = run_cmd(["./bin/launch-agent", "--name", "kanban-orchestrator"], tmp_path)

    assert result.returncode == 0, result.stderr + result.stdout
    assert "Launch mode: hermes_profile" in result.stdout
    assert "Profile: kanban-orchestrator" in result.stdout
    log = tmux_log(tmp_path)
    assert "new-session -d -s pipe-kanban-orchestrator -n main" in log
    assert "send-keys -t pipe-kanban-orchestrator:main" in log
    assert "hermes --profile kanban-orchestrator" in log
    assert "new-window -t pipe-kanban-orchestrator -n watcher" in log
    assert "domain-room watch discovery \"Kanban Orchestrator\" --persona ceo-orchestrator" in log


def test_launch_agent_uses_registry_external_mode_and_display_name(tmp_path: Path) -> None:
    result = run_cmd(["./bin/launch-agent", "--name", "swarm-facilitator"], tmp_path)

    assert result.returncode == 0, result.stderr + result.stdout
    assert "Launch mode: external" in result.stdout
    assert "Display name: Swarm Facilitator" in result.stdout
    log = tmux_log(tmp_path)
    assert "new-session -d -s pipe-swarm-facilitator -n main" in log
    assert "new-window -t pipe-swarm-facilitator -n watcher" in log
    assert "domain-room watch discovery \"Swarm Facilitator\" --persona swarm-facilitator" in log


def test_launch_agent_rejects_unknown_and_non_launchable_agents(tmp_path: Path) -> None:
    unknown = run_cmd(["./bin/launch-agent", "--name", "definitely-not-real"], tmp_path)
    assert unknown.returncode != 0
    assert "Unknown agent 'definitely-not-real'" in (unknown.stderr + unknown.stdout)

    watcher_only = run_cmd(["./bin/launch-agent", "--name", "discovery-room-watcher"], tmp_path)
    assert watcher_only.returncode == 0, watcher_only.stderr + watcher_only.stdout
    assert "Launch mode: watcher_only" in watcher_only.stdout
    assert "watcher-only; no agent brain was started" in watcher_only.stdout

    disabled = run_cmd(["./bin/launch-agent", "--name", "legacy-dashboard"], tmp_path)
    assert disabled.returncode != 0
    assert "disabled" in (disabled.stderr + disabled.stdout).lower()


def test_herder_steer_uses_registry_session_window_and_rejects_bad_targets(tmp_path: Path) -> None:
    ok = run_cmd(["./bin/herder-steer", "kanban-orchestrator", "focus on registry", "--type-only"], tmp_path, has_session=True)

    assert ok.returncode == 0, ok.stderr + ok.stdout
    assert "pipe-kanban-orchestrator:main" in tmux_log(tmp_path)
    assert "Typed into input of agent 'kanban-orchestrator'" in ok.stdout

    unknown = run_cmd(["./bin/herder-steer", "definitely-not-real", "hello"], tmp_path, has_session=True)
    assert unknown.returncode != 0
    assert "Unknown agent 'definitely-not-real'" in (unknown.stderr + unknown.stdout)

    watcher = run_cmd(["./bin/herder-steer", "discovery-room-watcher", "hello"], tmp_path, has_session=True)
    assert watcher.returncode != 0
    assert "watcher-only" in (watcher.stderr + watcher.stdout).lower()


def test_herder_chat_noninteractive_resolution_uses_registry_before_steering(tmp_path: Path) -> None:
    result = run_cmd(
        ["./bin/herder-chat", "--domain", "discovery", "--check-steer", "@kanban-orchestrator review the registry path"],
        tmp_path,
        has_session=True,
    )

    assert result.returncode == 0, result.stderr + result.stdout
    data = json.loads(result.stdout)
    assert data["ok"] is True
    assert data["agent_id"] == "kanban-orchestrator"
    assert data["display_name"] == "Kanban Orchestrator"
    assert data["tmux_session"] == "pipe-kanban-orchestrator"
    assert data["tmux_window"] == "main"
    assert data["profile"] == "kanban-orchestrator"
    assert data["launch_mode"] == "hermes_profile"
    assert data["steering_message"] == "review the registry path"
