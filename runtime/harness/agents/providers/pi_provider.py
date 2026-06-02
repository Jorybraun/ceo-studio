"""
pi provider — runs an agent turn through the `pi` CLI non-interactively.

Verified primitives (from `pi --help`, 2026-06-01):
  dispatch: `pi --print --mode text [--model <m>] [--provider <p>]
             --session-dir <wd> "<prompt>"`
  resume:   `pi --print --mode text --continue --session-dir <wd> "<msg>"`
  `--print` is non-interactive; `--mode text` makes stdout the plain reply;
  `--session-dir` isolates each agent's session so `--continue` resumes it.

`pi` defaults to provider `google`. Model/provider may be overridden per agent.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s or "")


def _pi_bin() -> str:
    return os.environ.get("PI_BIN") or "pi"


class PiProvider(AgentProvider):
    name = "pi"
    paid = False  # uses configured provider keys; not gated.

    def _run(self, prompt: str, *, model: Optional[str], cont: bool,
             workdir: Path, timeout: int) -> tuple[str, Optional[str]]:
        workdir.mkdir(parents=True, exist_ok=True)
        cmd = [_pi_bin(), "--print", "--mode", "text", "--session-dir", str(workdir)]
        if model:
            cmd += ["--model", model]
        prov = os.environ.get("PI_PROVIDER")
        if prov:
            cmd += ["--provider", prov]
        if cont:
            cmd += ["--continue"]
        cmd += [prompt]
        try:
            res = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True,
                                 timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "", f"[pi timeout after {timeout}s]"
        except FileNotFoundError:
            return "", "[pi CLI not found on PATH]"
        text = _strip_ansi(res.stdout or "").strip()
        if not text and res.returncode != 0:
            return "", f"[pi rc={res.returncode}] {_strip_ansi(res.stderr or '')[:300]}"
        return text, None

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        text, error = self._run(task, model=model, cont=False, workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=f"pi-cwd:{workdir.name}", error=True)
        # pi keeps the session under --session-dir; a cwd marker lets tell() --continue it.
        return ProviderResult(reply=text, session_id=f"pi-cwd:{workdir.name}")

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        text, error = self._run(message, model=model, cont=True, workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        return ProviderResult(reply=text, session_id=session_id or f"pi-cwd:{workdir.name}")
