"""
Grok (Grok Build CLI) provider.

Runs real Grok sessions headlessly and resumes them, mirroring the Devin
provider's contract so Grok is a first-class, swappable swarm/meeting member.

Verified primitives (from `grok --help`, 2026-05-31):
  dispatch: `grok --cwd <wd> -p "<task>" --output-format json --always-approve [-m <model>]`
  resume:   `grok --cwd <wd> -c  -p "<msg>"  --output-format json --always-approve`
            (`-c/--continue` resumes the most recent session for that cwd; each
             agent gets its own workdir, so this isolates conversations)
  headless json: emits typed JSON events, e.g. {"type":"error","message":...}.

NOTE (honesty): the headless ERROR shape is verified against a real run; the
SUCCESS event shape is parsed defensively and must be confirmed with a live
credited run (Grok was credit-blocked at build time). The parser falls back to
raw stdout so a reply is never silently lost.
"""

from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

DEFAULT_MODEL = os.environ.get("GROK_MODEL", "grok-build")
_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s or "")


def parse_stream(out: str) -> tuple[str, Optional[str], Optional[str]]:
    """Parse grok --output-format json stdout.

    Returns (reply_text, error_message, session_id). Defensive across event
    shapes: collects assistant text, surfaces error events, and captures a
    session id under common keys. Falls back to raw (de-ANSI'd) stdout text
    when no structured text was found.
    """
    text_parts: list[str] = []
    error: Optional[str] = None
    session: Optional[str] = None
    saw_json = False

    for raw_line in (out or "").splitlines():
        line = _strip_ansi(raw_line).strip()
        if not line or not (line.startswith("{") or line.startswith("[")):
            continue
        try:
            obj = json.loads(line)
        except Exception:
            continue
        saw_json = True
        if not isinstance(obj, dict):
            continue
        for k in ("session_id", "sessionId", "session", "id"):
            v = obj.get(k)
            if isinstance(v, str) and v:
                session = v
        etype = obj.get("type")
        if etype == "error":
            error = obj.get("message") or obj.get("error") or "grok error"
            continue
        # Assistant/result text can live under several keys or as content blocks.
        content = obj.get("content")
        if isinstance(content, list):
            for block in content:
                if isinstance(block, dict) and isinstance(block.get("text"), str):
                    text_parts.append(block["text"])
        for k in ("text", "response", "message", "delta", "output"):
            v = obj.get(k)
            if isinstance(v, str) and v.strip():
                text_parts.append(v)
                break

    text = "\n".join(t for t in text_parts if t).strip()
    if not text and not error and not saw_json:
        # plain output-format or unstructured: use raw stdout
        text = _strip_ansi(out).strip()
    return text, error, session


class GrokProvider(AgentProvider):
    name = "grok"
    paid = True  # Grok consumes xAI credits; guardrail-aware callers should gate.

    def _run(self, prompt: str, *, model: Optional[str], resume_recent: bool,
             session_id: Optional[str], workdir: Path, timeout: int) -> tuple[str, Optional[str]]:
        cmd = ["grok", "--cwd", str(workdir), "-p", prompt,
               "--output-format", "json", "--always-approve"]
        if model:
            cmd += ["-m", model]
        if session_id:
            cmd += ["-r", session_id]
        elif resume_recent:
            cmd += ["-c"]
        try:
            res = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True,
                                 timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "", f"[grok timeout after {timeout}s]"
        except FileNotFoundError:
            return "", "[grok CLI not found on PATH]"
        text, error, session = parse_stream(res.stdout or "")
        if error:
            return "", error
        if not text and res.returncode != 0:
            return "", f"[grok rc={res.returncode}] {_strip_ansi(res.stderr or '')[:400]}"
        # stash discovered session id on the instance for dispatch to return
        self._last_session = session
        return text, None

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        self._last_session = None
        text, error = self._run(task, model=model or DEFAULT_MODEL, resume_recent=False,
                                session_id=None, workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=None, error=True)
        # Use the real session id if grok reported one; else a cwd marker so the
        # adapter knows a session exists and `tell` can resume via -c.
        sid = getattr(self, "_last_session", None) or f"grok-cwd:{workdir.name}"
        return ProviderResult(reply=text, session_id=sid)

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        self._last_session = None
        # Resume by real id when we have one; otherwise continue the cwd's most recent.
        real_id = session_id if (session_id and not str(session_id).startswith("grok-cwd:")) else None
        text, error = self._run(message, model=model, resume_recent=(real_id is None),
                                session_id=real_id, workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        new_sid = getattr(self, "_last_session", None) or session_id
        return ProviderResult(reply=text, session_id=new_sid)
