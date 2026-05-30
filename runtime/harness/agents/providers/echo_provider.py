"""
Echo provider — a free, deterministic, offline provider.

It needs no API and costs nothing, so it's used to exercise the adapter and
orchestrator end-to-end (dispatch + resumable two-way `tell`) without spending
credits. It "remembers" the conversation per session on disk so resume works
across separate CLI invocations.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult


class EchoProvider(AgentProvider):
    name = "echo"
    paid = False

    def _store(self, workdir: Path) -> Path:
        workdir.mkdir(parents=True, exist_ok=True)
        return workdir / "echo_sessions.json"

    def _load(self, workdir: Path) -> dict:
        p = self._store(workdir)
        if p.exists():
            try:
                return json.loads(p.read_text())
            except Exception:
                return {}
        return {}

    def _save(self, workdir: Path, data: dict) -> None:
        self._store(workdir).write_text(json.dumps(data, indent=2))

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        sid = f"echo-{agent}-{int(time.time())}"
        data = self._load(workdir)
        data[sid] = [{"role": "user", "content": task}]
        self._save(workdir, data)
        reply = f"[echo:{agent}] received task ({len(task)} chars). turn=1."
        data[sid].append({"role": "agent", "content": reply})
        self._save(workdir, data)
        return ProviderResult(reply=reply, session_id=sid)

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        data = self._load(workdir)
        convo = data.get(session_id)
        if convo is None:
            return ProviderResult(reply=f"[echo:{agent}] unknown session {session_id}", error=True)
        convo.append({"role": "user", "content": message})
        turn = sum(1 for m in convo if m["role"] == "agent") + 1
        reply = (f"[echo:{agent}] turn={turn}. I remember {len(convo)} prior messages; "
                 f"you just said: {message[:80]}")
        convo.append({"role": "agent", "content": reply})
        self._save(workdir, data)
        return ProviderResult(reply=reply, session_id=session_id)
