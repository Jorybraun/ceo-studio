"""
Tests for the generic provider-backed agent adapter + guardrail integration.
No API cost: uses the `echo` provider and verifies the shared cap/kill-switch
guardrails without invoking paid provider CLIs.

Run: python3 tests/test_agent_adapter.py
"""
import os
import shutil
import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

# Isolate guardrail ledger.
os.environ["CEO_GUARDRAIL_DIR"] = tempfile.mkdtemp(prefix="adv-guardrail-")
os.environ["CEO_GUARDRAIL_DISABLE_TMUX"] = "1"

from agents import agent_adapter   # noqa: E402
from config import cost_limits     # noqa: E402

ROOM = "__adaptertest__"
ROOM_DIR = HARNESS_ROOT / "brain" / "rooms" / ROOM

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name); sys.exit(1)
    print("PASS", name); passed += 1

try:
    # 1. echo dispatch (free) works + posts to room + persists session
    r = agent_adapter.dispatch("echo", "tester", ROOM, "do a thing")
    ok("echo dispatch ok", r["ok"] and r["reply"] and r["session_id"])
    ok("room chat.log created with task+reply",
       (ROOM_DIR / "chat.log").exists() and
       (ROOM_DIR / "chat.log").read_text().count("\n") >= 2)

    # 2. two-way tell resumes the session
    r2 = agent_adapter.tell("tester", ROOM, "remember?")
    ok("echo tell ok + continuity", r2["ok"] and "turn=2" in r2["reply"])

    # 3. paid classification alone does not block; shared caps do the safety work.
    allowed, reason = cost_limits.can_spawn("devin:devin-x", paid=True, running_count=0)
    ok("paid classification alone does not block agent use", allowed and reason == "ok")

    # 4. per-hour spawn cap enforced through the adapter (echo)
    cost_limits.MAX_SPAWNS_PER_HOUR = 3  # already used 1 (echo dispatch above)
    allowed_count = 0
    for i in range(5):
        rr = agent_adapter.dispatch("echo", f"capworker{i}", ROOM, "x")
        if rr["ok"]:
            allowed_count += 1
    ok("hourly spawn cap stops runaway dispatch", allowed_count <= 2)

    # 5. kill switch halts dispatch entirely
    cost_limits.request_stop()
    r5 = agent_adapter.dispatch("echo", "afterkill", ROOM, "x")
    ok("kill switch blocks dispatch", (not r5["ok"]))
    cost_limits.clear_stop()

    print(f"\n{passed} adapter checks passed.")
finally:
    shutil.rmtree(ROOM_DIR, ignore_errors=True)
