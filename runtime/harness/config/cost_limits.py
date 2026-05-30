"""
harness/config/cost_limits.py

Enforced cost / concurrency guardrails for agent spawning.

Background: a previous overnight run burned all API credits because the
orchestrator re-executed the same `[ACTION] DELEGATE` line every poll cycle
with no deduplication and no spending cap, each time spawning a *separate
paid* Grok session. The only protection was an interactive "type yes" prompt,
which is silently skipped when an agent is spawned via subprocess.

This module is the single, importable, *enforced* source of truth for the
guardrails. Every spawn path (harem-orchestrator, harem-delegate, launch-agent,
herder-chat) must consult `can_spawn()` before launching an agent and call
`record_spawn()` afterwards.

stdlib-only by design (matches the rest of harness/config).
"""

from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Optional, Tuple

HARNESS_ROOT = Path(__file__).resolve().parent.parent

# Path resolution lives in config/paths.py. Dual-mode import so this works both
# when imported (config.cost_limits) and when run as a script from within config/.
try:
    from . import paths
except ImportError:  # pragma: no cover - script execution path
    import paths  # type: ignore


# ---------------------------------------------------------------------------
# Configurable limits (env-overridable; safe defaults)
# ---------------------------------------------------------------------------

def _int_env(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except (TypeError, ValueError):
        return default


# Max agents allowed to be running concurrently (tmux sessions).
MAX_CONCURRENT_AGENTS = _int_env("CEO_MAX_CONCURRENT_AGENTS", 5)

# Max NEW agents a single orchestrator cycle may spawn.
MAX_SPAWNS_PER_CYCLE = _int_env("CEO_MAX_SPAWNS_PER_CYCLE", 2)

# Max NEW agents spawned within a rolling 1-hour window (across all callers).
MAX_SPAWNS_PER_HOUR = _int_env("CEO_MAX_SPAWNS_PER_HOUR", 12)

# Paid agents (separate API-consuming sessions) are DISABLED by default for
# automated/non-interactive spawning. Set CEO_ALLOW_PAID=1 to permit them.
PAID_AGENTS_ENABLED = os.environ.get("CEO_ALLOW_PAID", "0") == "1"

# Agent ids that start with one of these prefixes are treated as paid/separate
# API sessions (the #1 credit-burn risk). The bare "grok" primary session is
# explicitly allowed (it is the shared main session, not a separate consumer).
PAID_AGENT_PREFIXES = ("grok-",)
PAID_AGENT_ALLOWLIST = {"grok"}


def _guardrail_dir() -> Path:
    # Honors CEO_GUARDRAIL_DIR override and HARNESS_WORKSPACE; falls back to the
    # legacy in-place location when neither is set (see config/paths.py).
    base = paths.guardrail_dir()
    base.mkdir(parents=True, exist_ok=True)
    return base


LEDGER_FILE = "spawn_ledger.json"
STOP_SENTINEL = "STOP"  # presence of this file = global kill switch


# ---------------------------------------------------------------------------
# Paid-agent classification
# ---------------------------------------------------------------------------

def is_paid_agent(agent_name: str) -> bool:
    """True if launching this agent creates a separate paid API session."""
    if not agent_name:
        return False
    name = agent_name.strip()
    if name in PAID_AGENT_ALLOWLIST:
        return False
    return any(name.startswith(p) for p in PAID_AGENT_PREFIXES)


# ---------------------------------------------------------------------------
# Spawn ledger (rolling window accounting, persisted)
# ---------------------------------------------------------------------------

def _ledger_path() -> Path:
    return _guardrail_dir() / LEDGER_FILE


def _load_ledger() -> list:
    p = _ledger_path()
    if not p.exists():
        return []
    try:
        data = json.loads(p.read_text())
        return data if isinstance(data, list) else []
    except Exception:
        return []


def _save_ledger(entries: list) -> None:
    try:
        _ledger_path().write_text(json.dumps(entries, indent=2))
    except Exception:
        pass


def _prune(entries: list, window_seconds: int = 3600) -> list:
    cutoff = time.time() - window_seconds
    return [e for e in entries if float(e.get("ts", 0)) >= cutoff]


def recent_spawn_count(window_seconds: int = 3600) -> int:
    return len(_prune(_load_ledger(), window_seconds))


def record_spawn(agent_name: str) -> None:
    """Record that an agent was actually spawned (call AFTER a successful spawn)."""
    entries = _prune(_load_ledger())
    entries.append({"agent": agent_name, "ts": time.time()})
    _save_ledger(entries)


# ---------------------------------------------------------------------------
# Concurrency (running tmux sessions)
# ---------------------------------------------------------------------------

def count_running_agents() -> int:
    """Best-effort count of live agent tmux sessions. Returns 0 if tmux absent."""
    if os.environ.get("CEO_GUARDRAIL_DISABLE_TMUX") == "1":
        return 0
    try:
        out = subprocess.run(
            ["tmux", "list-sessions", "-F", "#{session_name}"],
            capture_output=True, text=True, timeout=5,
        )
        if out.returncode != 0:
            return 0
        return len([ln for ln in out.stdout.splitlines() if ln.strip()])
    except Exception:
        return 0


# ---------------------------------------------------------------------------
# Kill switch
# ---------------------------------------------------------------------------

def stop_requested() -> bool:
    """Global kill switch: create the STOP sentinel to halt all spawning/loops."""
    return (_guardrail_dir() / STOP_SENTINEL).exists()


def request_stop() -> Path:
    p = _guardrail_dir() / STOP_SENTINEL
    p.write_text(f"stop requested at {time.time()}\n")
    return p


def clear_stop() -> None:
    (_guardrail_dir() / STOP_SENTINEL).unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# The gate
# ---------------------------------------------------------------------------

def can_spawn(
    agent_name: str,
    *,
    spawns_this_cycle: int = 0,
    running_count: Optional[int] = None,
    interactive: bool = False,
    paid: Optional[bool] = None,
) -> Tuple[bool, str]:
    """
    Decide whether `agent_name` may be spawned right now.

    Returns (allowed, reason). `reason` is a short human-readable explanation
    that callers should log. This is the single enforcement point — every
    spawn path must call it.

    - interactive=True means a human is at a TTY and may be prompted to
      override the paid-agent gate; non-interactive callers must rely on
      CEO_ALLOW_PAID.
    - paid: explicit paid classification (e.g. from a provider that knows it
      consumes credits). If None, falls back to name-prefix detection.
    """
    if stop_requested():
        return False, "STOP sentinel present (global kill switch active)"

    is_paid = is_paid_agent(agent_name) if paid is None else bool(paid)
    if is_paid and not PAID_AGENTS_ENABLED and not interactive:
        return False, (
            f"'{agent_name}' is a paid/separate API session and is disabled for "
            f"automated spawning (set CEO_ALLOW_PAID=1 to permit). This is the #1 "
            f"credit-burn vector."
        )

    if spawns_this_cycle >= MAX_SPAWNS_PER_CYCLE:
        return False, f"per-cycle spawn cap reached ({MAX_SPAWNS_PER_CYCLE})"

    if recent_spawn_count() >= MAX_SPAWNS_PER_HOUR:
        return False, f"hourly spawn cap reached ({MAX_SPAWNS_PER_HOUR}/hour)"

    rc = running_count if running_count is not None else count_running_agents()
    if rc >= MAX_CONCURRENT_AGENTS:
        return False, f"max concurrent agents reached ({rc}/{MAX_CONCURRENT_AGENTS})"

    return True, "ok"


# ---------------------------------------------------------------------------
# CLI: lets shell scripts (launch-agent) consult the same enforced gate.
#   python3 config/cost_limits.py check <agent-name> [--interactive]
#   exit 0 = allowed, exit 3 = denied (reason on stderr)
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser(description="Cost/concurrency guardrail")
    sub = ap.add_subparsers(dest="cmd", required=True)

    c = sub.add_parser("check", help="Check whether an agent may be spawned")
    c.add_argument("agent")
    c.add_argument("--interactive", action="store_true")
    c.add_argument("--record", action="store_true", help="Record a spawn if allowed")

    sub.add_parser("status", help="Print current guardrail status")
    sub.add_parser("stop", help="Engage global kill switch (create STOP sentinel)")
    sub.add_parser("resume", help="Clear global kill switch")

    args = ap.parse_args()

    if args.cmd == "check":
        ok, reason = can_spawn(args.agent, interactive=args.interactive)
        if ok:
            if args.record:
                record_spawn(args.agent)
            print("ALLOWED")
            raise SystemExit(0)
        print(f"DENIED: {reason}", file=__import__("sys").stderr)
        raise SystemExit(3)

    if args.cmd == "status":
        print(json.dumps({
            "max_concurrent_agents": MAX_CONCURRENT_AGENTS,
            "max_spawns_per_cycle": MAX_SPAWNS_PER_CYCLE,
            "max_spawns_per_hour": MAX_SPAWNS_PER_HOUR,
            "paid_agents_enabled": PAID_AGENTS_ENABLED,
            "running_agents": count_running_agents(),
            "spawns_last_hour": recent_spawn_count(),
            "stop_requested": stop_requested(),
        }, indent=2))
        raise SystemExit(0)

    if args.cmd == "stop":
        p = request_stop()
        print(f"Kill switch engaged: {p}")
        raise SystemExit(0)

    if args.cmd == "resume":
        clear_stop()
        print("Kill switch cleared.")
        raise SystemExit(0)
