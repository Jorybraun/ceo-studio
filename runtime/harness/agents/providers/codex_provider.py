"""
Codex provider — runs an agent turn through the `codex` CLI non-interactively.

Verified primitives (from `codex exec --help`, 2026-06-01):
  dispatch: `codex exec --skip-git-repo-check --json [-m <model>] -C <wd>
             -o <last_message_file> "<prompt>"`
  resume:   `codex exec resume <session_id> ... "<msg>"`  (or `--last`)
  `--json` streams JSONL events (we mine the session/thread id from them);
  `-o/--output-last-message` writes the final reply to a file (clean reply).

Auth is OAuth/funded (codex login). Not gated as paid.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s or "")


def _codex_bin() -> str:
    return os.environ.get("CODEX_BIN") or "codex"


def parse_session(jsonl: str) -> Optional[str]:
    """Mine a session/thread id out of `codex exec --json` JSONL events."""
    for raw in (jsonl or "").splitlines():
        line = raw.strip()
        if not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        # Look at the event itself and a nested payload for common id keys.
        for scope in (obj, obj.get("msg") if isinstance(obj.get("msg"), dict) else {},
                      obj.get("session") if isinstance(obj.get("session"), dict) else {}):
            for k in ("session_id", "thread_id", "conversation_id", "id"):
                v = scope.get(k) if isinstance(scope, dict) else None
                if isinstance(v, str) and re.search(r"[0-9a-f-]{8,}", v):
                    return v
    return None


class CodexProvider(AgentProvider):
    name = "codex"
    paid = False  # OAuth/funded (codex login); not gated.

    def _run(self, prompt: str, *, model: Optional[str], resume: Optional[str],
             use_last: bool, workdir: Path, timeout: int) -> tuple[str, Optional[str], Optional[str]]:
        workdir.mkdir(parents=True, exist_ok=True)
        last_file = Path(tempfile.mkstemp(prefix="codex-last-", suffix=".txt")[1])
        cmd = [_codex_bin(), "exec"]
        if resume:
            cmd += ["resume", resume]
        elif use_last:
            cmd += ["resume", "--last"]
        cmd += ["--skip-git-repo-check", "--json", "-C", str(workdir),
                "-o", str(last_file)]
        if model:
            cmd += ["-m", model]
        cmd += [prompt]
        try:
            res = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True,
                                 timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "", f"[codex timeout after {timeout}s]", None
        except FileNotFoundError:
            return "", "[codex CLI not found on PATH]", None
        finally:
            pass
        session = parse_session(res.stdout or "")
        reply = ""
        try:
            reply = last_file.read_text().strip()
        except Exception:
            reply = ""
        finally:
            try:
                last_file.unlink()
            except Exception:
                pass
        if not reply:
            # Fall back to raw stdout if the last-message file was empty.
            reply = _strip_ansi(res.stdout or "").strip()
        if not reply and res.returncode != 0:
            return "", f"[codex rc={res.returncode}] {_strip_ansi(res.stderr or '')[:300]}", session
        return reply, None, session

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        text, error, session = self._run(task, model=model, resume=None, use_last=False,
                                         workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session, error=True)
        sid = session or f"codex-cwd:{workdir.name}"
        return ProviderResult(reply=text, session_id=sid)

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        real_id = session_id if (session_id and not str(session_id).startswith("codex-cwd:")) else None
        text, error, session = self._run(message, model=model, resume=real_id,
                                         use_last=(real_id is None), workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        return ProviderResult(reply=text, session_id=session or session_id)
