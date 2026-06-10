"""
Tests for the A2A meeting engine (a2a_runtime + meeting + personas).

NO API COST / NO SUBSCRIPTION: uses the free, deterministic `echo` provider and
real local A2A HTTP servers on loopback ephemeral ports. This proves the entire
machinery — Agent Card discovery, the JSON-RPC message round-trip, persona
injection, relevance gating, room mirroring, and requirements synthesis —
without any paid provider, key, or external network.

It also asserts the paid (`devin`) path stays guardrail-gated for automated
callers, so QA never accidentally spends credits.

Run: python3 tests/test_a2a_meeting.py   (auto re-execs into runtime/harness/.venv)
"""

import asyncio
import os
import shutil
import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))


def _ensure_a2a_venv():
    """Re-exec under the harness venv if a2a-sdk isn't importable here."""
    try:
        import a2a  # noqa: F401
        return
    except Exception:
        pass
    if os.environ.get("_A2A_TEST_REEXEC") == "1":
        print("SKIP: a2a-sdk not installed. Create the venv:\n"
              f"  python3 -m venv {HARNESS_ROOT}/.venv && "
              f"{HARNESS_ROOT}/.venv/bin/pip install -r {HARNESS_ROOT}/requirements-a2a.txt")
        sys.exit(0)  # SKIP, not FAIL — environment-dependent
    venv_py = HARNESS_ROOT / ".venv" / "bin" / "python"
    if venv_py.exists():
        os.environ["_A2A_TEST_REEXEC"] = "1"
        os.execv(str(venv_py), [str(venv_py), str(Path(__file__).resolve()), *sys.argv[1:]])
    print(f"SKIP: no venv at {venv_py}; install a2a-sdk to run A2A tests.")
    sys.exit(0)


_ensure_a2a_venv()

# Isolate guardrail ledger; ensure paid agents are NOT enabled (default-safe).
os.environ["CEO_GUARDRAIL_DIR"] = tempfile.mkdtemp(prefix="a2a-guardrail-")
os.environ["CEO_GUARDRAIL_DISABLE_TMUX"] = "1"
os.environ.pop("CEO_ALLOW_PAID", None)

import httpx  # noqa: E402
from agents import a2a_runtime, meeting as meeting_mod  # noqa: E402
from config import paths  # noqa: E402

ROOM = "__a2atest__"
ROOM_DIR = paths.room_dir(ROOM)

passed = 0
def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


async def _client_send(url, text):
    from a2a.client import ClientFactory, ClientConfig
    from a2a.types import Message, Part, Role, SendMessageRequest
    async with httpx.AsyncClient(timeout=20) as hc:
        client = await ClientFactory(ClientConfig(httpx_client=hc, streaming=True)).create_from_url(url)
        req = SendMessageRequest(message=Message(message_id="t1", role=Role.ROLE_USER,
                                                 parts=[Part(text=text)]))
        out = []
        async for resp in client.send_message(req):
            if resp.HasField("message"):
                out.append("".join(p.text for p in resp.message.parts if p.text))
        await client.close()
        return "\n".join(out)


try:
    # 1. A2A server (echo) exposes a discoverable Agent Card over real HTTP.
    handle = a2a_runtime.serve("tester", provider="echo", room=ROOM, block=False)
    ok("a2a server became healthy", a2a_runtime.wait_healthy(handle["url"]))
    card = httpx.get(handle["url"] + "/.well-known/agent-card.json", timeout=5).json()
    ok("agent card served with agent name", card.get("name") == "tester")

    # 2. Real JSON-RPC message round-trip returns the echo provider's reply.
    reply = asyncio.run(_client_send(handle["url"], "hello over a2a"))
    ok("a2a message round-trip returns provider reply", "[echo:tester]" in reply)
    handle["server"].should_exit = True

    # 3. Full meeting with two echo members + personas -> requirements + room log.
    members = meeting_mod.parse_members("ba:echo:ba,arch:echo:architect")
    ok("member spec parsed (provider+persona)",
       len(members) == 2 and members[1].provider == "echo" and members[1].persona == "architect")
    result = asyncio.run(meeting_mod.run_meeting(
        room=ROOM, agenda="Define requirements for a test feature.",
        members=members, criteria="Concrete and brief."))
    ok("meeting ok", result.get("ok"))
    ok("both members contributed", set(result["contributed"]) == {"ba", "arch"})
    ok("requirements.md written", Path(result["requirements_path"]).exists()
       and Path(result["requirements_path"]).read_text().strip())
    log = (ROOM_DIR / "chat.log").read_text()
    ok("room shows meeting start", "MEETING START" in log)
    ok("room shows synthesis", "MEETING SYNTHESIS" in log)
    ok("persona brief was injected into member task", "PERSONA BRIEF" in log)

    # 4. Paid provider stays guardrail-gated for automated callers (no spend).
    from agents import agent_adapter
    r = agent_adapter.dispatch("devin", "should_refuse", ROOM, "noop", interactive=False)
    ok("paid devin dispatch refused without CEO_ALLOW_PAID", r.get("refused") is True)

    print(f"\n{passed} A2A meeting checks passed (zero API cost).")
finally:
    shutil.rmtree(ROOM_DIR, ignore_errors=True)
