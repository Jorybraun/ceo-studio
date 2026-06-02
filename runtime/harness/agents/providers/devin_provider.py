"""
Devin CLI provider.

Runs real Devin sessions non-interactively and resumes them by session id.
Validated primitives:
  dispatch: `devin --model <m> -p -- "<task>"`        -> reply (stdout)
  tell:     `devin -p -r <session_id> -- "<message>"` -> reply (stdout)
  session ids: `devin ls --format json` (per-agent workdir isolates them)
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

DEFAULT_MODEL = os.environ.get("DEVIN_MODEL", "swe-1.6-fast")


class DevinProvider(AgentProvider):
    name = "devin"
    paid = True  # Devin sessions consume credits; guardrail-aware callers should record spawns

    def _run(self, prompt: str, *, model: Optional[str], resume: Optional[str],
             workdir: Path, timeout: int) -> str:
        cmd = ["devin"]
        if model:
            cmd += ["--model", model]
        if resume:
            cmd += ["-r", resume]
        cmd += ["-p", "--", prompt]
        env = {**os.environ, "DEVIN_PERMISSION_MODE": os.environ.get("DEVIN_PERMISSION_MODE", "auto")}
        res = subprocess.run(cmd, cwd=str(workdir), capture_output=True, text=True,
                             timeout=timeout, env=env, stdin=subprocess.DEVNULL)
        out = (res.stdout or "").strip()
        if res.returncode != 0 and not out:
            return f"[devin error rc={res.returncode}] {(res.stderr or '').strip()[:500]}"
        return out

    def _newest_session_id(self, workdir: Path) -> Optional[str]:
        try:
            out = subprocess.run(["devin", "ls", "--format", "json"], cwd=str(workdir),
                                 capture_output=True, text=True, timeout=30)
            sessions = json.loads(out.stdout or "[]")
            if not sessions:
                return None
            sessions.sort(key=lambda s: s.get("last_activity_at", 0), reverse=True)
            return sessions[0].get("id")
        except Exception:
            return None

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        reply = self._run(task, model=model or DEFAULT_MODEL, resume=None,
                          workdir=workdir, timeout=timeout)
        return ProviderResult(reply=reply, session_id=self._newest_session_id(workdir))

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        reply = self._run(message, model=model, resume=session_id, workdir=workdir, timeout=timeout)
        new_sid = self._newest_session_id(workdir) or session_id
        return ProviderResult(reply=reply, session_id=new_sid)
