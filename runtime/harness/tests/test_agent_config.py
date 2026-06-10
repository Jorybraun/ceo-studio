"""
Tests for the declarative agent registry config (agents.json) + meeting
member/team resolution. NO API COST (pure config + parsing).

Run: python3 tests/test_agent_config.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

# Point the loader at an isolated temp config so the test is hermetic.
_tmp = tempfile.mkdtemp(prefix="agentcfg-")
_cfg = Path(_tmp) / "agents.json"
_cfg.write_text(json.dumps({
    "agents": [
        {"id": "ba", "provider": "echo", "persona": "ba", "capabilities": ["requirements"]},
        {"id": "architect", "provider": "grok", "persona": "architect", "model": "grok-build"},
    ],
    "teams": {"planning": ["ba", "architect"]},
}), encoding="utf-8")
os.environ["CEO_AGENTS_CONFIG"] = str(_cfg)

from agents import agent_config  # noqa: E402
from agents import meeting as meeting_mod  # noqa: E402

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1

cfg = agent_config.load_config()
# The loader MERGES sources (env file + workspace + shipped defaults), with the
# env file first so it overrides. So our temp agents/team must be present, and
# our architect (grok) must win over the shipped architect (echo).
ok("temp agents present in merged config", {"ba", "architect"} <= set(cfg["agents"]))
ok("temp team present in merged config", cfg["teams"].get("planning") == ["ba", "architect"])

a = agent_config.get_agent("architect")
ok("override precedence: env config wins (provider+model+persona)",
   a["provider"] == "grok" and a["model"] == "grok-build" and a["persona"] == "architect")

# bare id resolves from config
m = meeting_mod.parse_members("architect")[0]
ok("bare id resolves provider from config", m.provider == "grok" and m.persona == "architect")

# inline overrides config
m2 = meeting_mod.parse_members("architect:echo")[0]
ok("inline provider overrides config", m2.provider == "echo" and m2.persona == "architect")

# unknown id falls back to echo
m3 = meeting_mod.parse_members("nobody")[0]
ok("unknown id falls back to echo", m3.provider == "echo" and m3.persona is None)

# team expansion
team = meeting_mod.members_for_team("planning")
ok("team expands to resolved members",
   [x.id for x in team] == ["ba", "architect"] and team[1].provider == "grok")

print(f"\n{passed} agent-config checks passed (zero API cost).")
