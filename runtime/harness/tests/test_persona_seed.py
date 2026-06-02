"""
Tests for persona-aware mounted sessions + the unified CEO registry agent.

No API cost. Verifies:
  1. personas.persona_preamble / agent_context_markdown render the persona brief.
  2. personas.seed_agent_context writes always-on context (AGENTS.md/CLAUDE.md)
     into the agent's per-(room,agent) workdir so a mounted interactive CLI
     (devin/claude) is in-character from the first message.
  3. The registry resolves the conversational `ceo` agent as a launchable
     hermes_profile session with an EMPTY profile (= default Hermes / OAuth,
     no API key) and command `hermes`.
  4. launch-agent (with a fake tmux) seeds the persona and cd's the external
     CLI into the seeded workdir, and launches the CEO as default Hermes.

Run: python3 tests/test_persona_seed.py
(pytest-style functions are also provided so a future pytest run can collect it.)
"""
from __future__ import annotations

import os
import subprocess
import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

passed = 0


def ok(name: str, cond: bool) -> None:
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


def test_persona_preamble_and_context_markdown() -> None:
    from agents import personas

    pre = personas.persona_preamble("docs-steward")
    assert "Docs Steward" in pre
    assert "PERSONA BRIEF" in pre

    body = personas.agent_context_markdown("docs-steward")
    assert "Docs Steward" in body
    assert "in character" in body.lower()

    # Unknown persona -> no brief, so no context to write.
    assert personas.persona_preamble("definitely-not-a-persona") == ""
    assert personas.agent_context_markdown("definitely-not-a-persona") == ""


def test_seed_agent_context_writes_always_on_files(tmp_workspace: Path) -> None:
    os.environ["HARNESS_WORKSPACE"] = str(tmp_workspace)
    # Reload paths so workspace() picks up the env (paths reads env at call time).
    from agents import personas

    wd = Path(personas.seed_agent_context("discovery", "docs-steward", "docs-steward"))
    assert wd.exists()
    expected = tmp_workspace / "brain" / "rooms" / "discovery" / "agents" / "docs-steward"
    assert wd.resolve() == expected.resolve()
    agents_md = (wd / "AGENTS.md").read_text(encoding="utf-8")
    claude_md = (wd / "CLAUDE.md").read_text(encoding="utf-8")
    assert "Docs Steward" in agents_md and "Docs Steward" in claude_md

    # No persona -> workdir is created but no context files are written.
    wd2 = Path(personas.seed_agent_context("discovery", "ceo", ""))
    assert wd2.exists()
    assert not (wd2 / "AGENTS.md").exists()


def test_registry_resolves_ceo_as_default_hermes_profile() -> None:
    from agents import registry

    plan = registry.get_launch_plan("ceo")
    assert plan["id"] == "ceo"
    assert plan["provider"] == "hermes"
    assert plan["launch_mode"] == "hermes_profile"
    # Empty profile = the DEFAULT Hermes profile (OAuth/funded, no API key).
    assert plan["profile"] == ""
    assert plan["command"] == "hermes"
    assert plan["launchable"] is True
    assert plan["canonical_room"] == "discovery"


def _run_launch_agent(name: str, tmp_path: Path) -> tuple[subprocess.CompletedProcess[str], str]:
    """Run bin/launch-agent against a fake tmux so we can assert the commands
    it would send without spawning real sessions. Returns (proc, tmux_log)."""
    fake_bin = tmp_path / "bin"
    fake_bin.mkdir(exist_ok=True)
    tmux_log = tmp_path / "tmux.log"
    fake_tmux = fake_bin / "tmux"
    fake_tmux.write_text(
        "#!/usr/bin/env bash\n"
        "printf '%s\\n' \"$*\" >> \"$TMUX_LOG\"\n"
        "case \"$1\" in\n"
        "  has-session) exit 1 ;;\n"
        "  list-windows) exit 0 ;;\n"
        "  *) exit 0 ;;\n"
        "esac\n"
    )
    fake_tmux.chmod(0o755)
    ws = tmp_path / "ws"
    ws.mkdir(exist_ok=True)
    env = os.environ.copy()
    env.update({
        "PATH": f"{fake_bin}:{env.get('PATH', '')}",
        "TMUX_LOG": str(tmux_log),
        "HOME": str(tmp_path / "home"),
        "PYTHONPATH": str(HARNESS_ROOT),
        "HARNESS_WORKSPACE": str(ws),
        # Keep the guardrail from blocking the test spawn.
        "CEO_GUARDRAIL_DIR": str(tmp_path / "guardrail"),
    })
    (tmp_path / "home").mkdir(exist_ok=True)
    proc = subprocess.run(
        ["./bin/launch-agent", "--name", name],
        cwd=HARNESS_ROOT, env=env, text=True, capture_output=True, timeout=30,
    )
    log = tmux_log.read_text() if tmux_log.exists() else ""
    return proc, log


def test_launch_agent_external_seeds_persona_and_cds_into_workdir(tmp_path: Path) -> None:
    proc, log = _run_launch_agent("docs-steward", tmp_path)
    assert proc.returncode == 0, proc.stderr + proc.stdout
    assert "Seeded persona 'docs-steward' context" in proc.stdout
    # The external CLI must be launched in the seeded per-agent workdir so it
    # loads the persona AGENTS.md as always-on context.
    assert "brain/rooms/discovery/agents/docs-steward && devin --model swe-1.6" in log
    # And the seed files actually exist.
    wd = tmp_path / "ws" / "brain" / "rooms" / "discovery" / "agents" / "docs-steward"
    assert (wd / "AGENTS.md").exists() and (wd / "CLAUDE.md").exists()


def test_launch_agent_ceo_launches_default_hermes(tmp_path: Path) -> None:
    proc, log = _run_launch_agent("ceo", tmp_path)
    assert proc.returncode == 0, proc.stderr + proc.stdout
    assert "Launch mode: hermes_profile" in proc.stdout
    assert "default Hermes (conversational CEO)" in proc.stdout
    # Default Hermes = no `--profile` flag (the OAuth CEO), launched in HARNESS_ROOT.
    assert "send-keys -t =pipe-ceo:main" in log
    assert "&& hermes C-m" in log or "&& hermes\n" in log or "hermes C-m" in log
    assert "--profile" not in log.split("pipe-ceo:main")[-1].split("\n")[0]


if __name__ == "__main__":
    with tempfile.TemporaryDirectory(prefix="persona-seed-") as d1:
        test_persona_preamble_and_context_markdown()
        ok("persona preamble + context markdown render the brief", True)

        test_seed_agent_context_writes_always_on_files(Path(d1) / "ws")
        ok("seed_agent_context writes AGENTS.md + CLAUDE.md into the workdir", True)

    # registry resolution uses the shipped HARNESS_HOME agents.json (has ceo).
    os.environ.pop("HARNESS_WORKSPACE", None)
    test_registry_resolves_ceo_as_default_hermes_profile()
    ok("registry resolves ceo as launchable default-Hermes profile (no key)", True)

    with tempfile.TemporaryDirectory(prefix="persona-launch-") as d2:
        test_launch_agent_external_seeds_persona_and_cds_into_workdir(Path(d2))
        ok("launch-agent seeds persona + cd's external CLI into the workdir", True)

    with tempfile.TemporaryDirectory(prefix="persona-launch-ceo-") as d3:
        test_launch_agent_ceo_launches_default_hermes(Path(d3))
        ok("launch-agent launches the CEO as default Hermes (no --profile)", True)

    print(f"\n{passed} persona/CEO checks passed.")
