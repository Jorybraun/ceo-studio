"""
Regression tests for Codex provider command construction.

No API cost: subprocess.run is monkeypatched, so this never invokes the real
Codex CLI. It pins the important CLI contract:

- fresh dispatch may use `codex exec ... -C <workdir> ... <prompt>`
- resume must use `codex exec resume [OPTIONS] <session> <prompt>`
- resume must not pass `-C`, because the resume subcommand does not accept it
"""

import sys
import tempfile
from pathlib import Path

HARNESS_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(HARNESS_ROOT))

from agents.providers import codex_provider  # noqa: E402
from agents.providers.codex_provider import CodexProvider  # noqa: E402

passed = 0


def ok(name, cond):
    global passed
    if not cond:
        print("FAIL", name)
        sys.exit(1)
    print("PASS", name)
    passed += 1


class FakeCompleted:
    returncode = 0
    stdout = '{"type":"session","session_id":"12345678-1234-1234-1234-123456789abc"}\n'
    stderr = ""


calls = []
real_run = codex_provider.subprocess.run


def fake_run(cmd, **kwargs):
    calls.append(cmd)
    if "-o" in cmd:
        Path(cmd[cmd.index("-o") + 1]).write_text("ok", encoding="utf-8")
    return FakeCompleted()


try:
    codex_provider.subprocess.run = fake_run
    provider = CodexProvider()
    workdir = Path(tempfile.mkdtemp(prefix="codex-provider-test-"))

    provider.dispatch("codex-test", "hello", model="gpt-test", workdir=workdir, timeout=5)
    dispatch_cmd = calls[-1]
    ok("dispatch uses top-level exec", dispatch_cmd[:2] == ["codex", "exec"])
    ok("dispatch passes -C before prompt", "-C" in dispatch_cmd and str(workdir) in dispatch_cmd)
    ok("dispatch model is an exec option", "-m" in dispatch_cmd and "gpt-test" in dispatch_cmd)

    provider.tell(
        "codex-test",
        "resume hello",
        session_id="12345678-1234-1234-1234-123456789abc",
        model="gpt-test",
        workdir=workdir,
        timeout=5,
    )
    resume_cmd = calls[-1]
    ok("resume uses subcommand", resume_cmd[:3] == ["codex", "exec", "resume"])
    ok("resume does not pass -C", "-C" not in resume_cmd and "--cd" not in resume_cmd)
    ok("resume model comes before session id", resume_cmd.index("-m") < resume_cmd.index("12345678-1234-1234-1234-123456789abc"))
    ok("resume prompt is final arg", resume_cmd[-1] == "resume hello")

    provider.tell(
        "codex-test",
        "last hello",
        session_id="codex-cwd:codex-test",
        model=None,
        workdir=workdir,
        timeout=5,
    )
    last_cmd = calls[-1]
    ok("resume --last is used for cwd fallback sessions", last_cmd[:3] == ["codex", "exec", "resume"] and "--last" in last_cmd)
    ok("resume --last does not pass -C", "-C" not in last_cmd and "--cd" not in last_cmd)

    print(f"\n{passed} Codex provider command checks passed.")
finally:
    codex_provider.subprocess.run = real_run
