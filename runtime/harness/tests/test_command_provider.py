"""
Tests for the generic CommandProvider (the "use anything" seam).

NO API COST: uses the real `echo` binary as the backend command, so the
dispatch/tell round-trip runs a real subprocess for $0. Also unit-tests the
placeholder renderer and the misconfiguration error paths.

Run: python3 tests/test_command_provider.py
"""

import json
import os
import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

from agents.providers.command_provider import CommandProvider, render  # noqa: E402

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


# 1. render(): tokenizes and substitutes per token; a spaced prompt stays one arg.
argv = render("echo {prompt}", prompt="hello there", model="", workdir="/tmp",
              agent="x", session_id="")
ok("render keeps spaced prompt as one token", argv == ["echo", "hello there"])

argv2 = render("run --model {model} --cwd {workdir} {prompt}", prompt="hi",
               model="m1", workdir="/w", agent="a", session_id="")
ok("render substitutes model+workdir", argv2 == ["run", "--model", "m1", "--cwd", "/w", "hi"])

# 2. Real round-trip with `echo` as the backend, driven via agents.json config.
with tempfile.TemporaryDirectory() as tmp:
    cfg_path = Path(tmp) / "agents.json"
    cfg_path.write_text(json.dumps({
        "agents": [{"id": "echoer", "provider": "command",
                    "command": "echo {prompt}", "paid": False}]
    }))
    os.environ["CEO_AGENTS_CONFIG"] = str(cfg_path)
    try:
        prov = CommandProvider()
        workdir = Path(tmp) / "wd"
        workdir.mkdir()
        res = prov.dispatch("echoer", "ping-task", model=None, workdir=workdir, timeout=30)
        ok("dispatch returns echoed reply", res.reply == "ping-task" and not res.error)
        ok("dispatch reflects paid=false from config", prov.paid is False)
        ok("dispatch returns a cwd session marker", str(res.session_id).startswith("command-cwd:"))

        res2 = prov.tell("echoer", "second-msg", session_id=res.session_id, model=None,
                         workdir=workdir, timeout=30)
        ok("tell re-runs command", res2.reply == "second-msg" and not res2.error)

        # 3. Misconfiguration: agent with no command -> clean error, no crash.
        cfg_path.write_text(json.dumps({
            "agents": [{"id": "broken", "provider": "command"}]
        }))
        res3 = prov.dispatch("broken", "x", model=None, workdir=workdir, timeout=30)
        ok("missing command -> error result", res3.error and "no `command`" in res3.reply)
    finally:
        os.environ.pop("CEO_AGENTS_CONFIG", None)

print(f"\n{passed} command-provider checks passed (zero API cost; real echo subprocess).")
