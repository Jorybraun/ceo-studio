"""
Hermes provider — runs an agent turn through the `hermes` CLI (the same relay
CEO Studio's chat uses). Hermes owns its own brain/memory/tools and routes to
whatever model its profile/`-m` selects (codex, copilot, anthropic, xai-oauth).

Verified primitives (mirror main/core/hermes.js):
  dispatch: `hermes [-m <model>] chat -q "<task>" -Q --yolo --accept-hooks`
  resume:   add `--resume <session_id>`
  The `-Q` footer prints `session_id: <id>`, which we capture for resume.

Auth is OAuth/funded (no API key). Not gated as paid.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

_ANSI = re.compile(r"\x1b\[[0-9;]*m")
_SESSION = re.compile(r"session_id:\s*(\S+)", re.IGNORECASE)


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s or "")


def _hermes_bin() -> str:
    return os.environ.get("HERMES_BIN") or os.path.expanduser("~/.local/bin/hermes")


def parse_output(out: str) -> tuple[str, Optional[str]]:
    """Return (reply_text, session_id). Strips the trailing session_id footer."""
    text = _strip_ansi(out or "")
    m = _SESSION.search(text)
    session = m.group(1) if m else None
    text = re.sub(r"\n?session_id:\s*\S+\s*$", "", text, flags=re.IGNORECASE).strip()
    return text, session


class HermesProvider(AgentProvider):
    name = "hermes"
    paid = False  # OAuth/funded (codex et al.); not gated.

    def _run(self, prompt: str, *, model: Optional[str], resume: Optional[str],
             workdir: Path, timeout: int) -> tuple[str, Optional[str], Optional[str]]:
        cmd = [_hermes_bin()]
        if model:
            cmd += ["-m", model]
        cmd += ["chat", "-q", prompt, "-Q", "--yolo", "--accept-hooks"]
        if resume:
            cmd += ["--resume", resume]
        try:
            res = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True,
                                 timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "", f"[hermes timeout after {timeout}s]", None
        except FileNotFoundError:
            return "", "[hermes CLI not found]", None
        combined = (res.stdout or "") + "\n" + (res.stderr or "")
        if re.search(r"No session found", combined, re.IGNORECASE):
            # Signal a session miss so the adapter can retry fresh.
            return "", "[hermes: no session found]", None
        text, session = parse_output(res.stdout or "")
        if not text and res.returncode != 0:
            return "", f"[hermes rc={res.returncode}] {_strip_ansi(res.stderr or '')[:300]}", session
        return text, None, session

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        workdir.mkdir(parents=True, exist_ok=True)
        text, error, session = self._run(task, model=model, resume=None,
                                         workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session, error=True)
        sid = session or f"hermes-cwd:{workdir.name}"
        return ProviderResult(reply=text, session_id=sid)

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        real_id = session_id if (session_id and not str(session_id).startswith("hermes-cwd:")) else None
        text, error, session = self._run(message, model=model, resume=real_id,
                                         workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        return ProviderResult(reply=text, session_id=session or session_id)
