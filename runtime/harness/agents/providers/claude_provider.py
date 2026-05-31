"""
Claude (Claude Code CLI) provider.

Runs real Claude Code sessions headlessly and resumes them by session id,
mirroring the Devin/Grok provider contract so Claude is a first-class,
swappable swarm/meeting member.

Verified primitives (from `claude --help`, 2026-05-31):
  dispatch: `claude -p --output-format json --permission-mode bypassPermissions
             [--model <m>] "<task>"`
  resume:   `claude -p --output-format json --resume <session_id> "<msg>"`
            (`-c/--continue` resumes the most recent session in the cwd; each
             agent gets its own workdir, so this isolates conversations)
  headless json: a single `{"type":"result",...}` object with `result` (the
  reply text), `session_id`, and `is_error`/`api_error_status` on failure.

NOTE (honesty): the JSON shape below is the REAL object emitted by
`claude -p --output-format json` (captured live 2026-05-31 — the run returned a
401 because Claude auth wasn't configured in that environment, which is exactly
the error path this parser handles). The success round-trip must be confirmed
with an authenticated Claude run; the parser falls back to raw stdout so a
reply is never silently lost.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

DEFAULT_MODEL = os.environ.get("CLAUDE_MODEL", "")  # empty = CLI default
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s or "")


def parse_result(out: str) -> tuple[str, Optional[str], Optional[str]]:
    """Parse `claude --output-format json` stdout.

    Returns (reply_text, error_message, session_id). Defensive across the
    single-result object and stream-json lines: captures the `result` text and
    `session_id`, surfaces `is_error`/`api_error_status`, and falls back to raw
    (de-ANSI'd) stdout when no structured result was found.
    """
    text: str = ""
    error: Optional[str] = None
    session: Optional[str] = None
    saw_json = False

    for raw_line in (out or "").splitlines():
        line = _strip_ansi(raw_line).strip()
        if not line or not line.startswith("{"):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        if not isinstance(obj, dict):
            continue
        saw_json = True
        sid = obj.get("session_id")
        if isinstance(sid, str) and sid:
            session = sid
        # The terminal result object carries the reply + error status.
        if obj.get("type") == "result":
            result_text = obj.get("result") if isinstance(obj.get("result"), str) else ""
            is_err = bool(obj.get("is_error")) or (
                obj.get("subtype") not in (None, "success")
            )
            if is_err:
                status = obj.get("api_error_status")
                error = result_text or (
                    f"claude error (status {status})" if status else "claude error"
                )
            else:
                text = result_text
        else:
            # stream-json assistant chunks: collect any text blocks.
            content = obj.get("content") or (obj.get("message") or {}).get("content")
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict) and isinstance(block.get("text"), str):
                        text += block["text"]

    if not text and not error and not saw_json:
        text = _strip_ansi(out).strip()
    return text.strip(), error, session


class ClaudeProvider(AgentProvider):
    name = "claude"
    paid = True  # Claude consumes Anthropic credits/subscription; gate via guardrails.

    def _run(self, prompt: str, *, model: Optional[str], resume: Optional[str],
             workdir: Path, timeout: int) -> tuple[str, Optional[str], Optional[str]]:
        cmd = ["claude", "-p", "--output-format", "json",
               "--permission-mode", "bypassPermissions"]
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["--resume", resume]
        cmd += [prompt]
        try:
            res = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True,
                                 timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "", f"[claude timeout after {timeout}s]", None
        except FileNotFoundError:
            return "", "[claude CLI not found on PATH]", None
        text, error, session = parse_result(res.stdout or "")
        if error:
            return "", error, session
        if not text and res.returncode != 0:
            return "", f"[claude rc={res.returncode}] {_strip_ansi(res.stderr or '')[:400]}", session
        return text, None, session

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        text, error, session = self._run(task, model=model or DEFAULT_MODEL or None,
                                         resume=None, workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session, error=True)
        # Use the real session id when Claude reported one; else a cwd marker so
        # the adapter knows a session exists and `tell` can resume.
        sid = session or f"claude-cwd:{workdir.name}"
        return ProviderResult(reply=text, session_id=sid)

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        real_id = session_id if (session_id and not str(session_id).startswith("claude-cwd:")) else None
        text, error, session = self._run(message, model=model, resume=real_id,
                                         workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        return ProviderResult(reply=text, session_id=session or session_id)
