"""
Vertex AI provider — a real agent brain backed by Gemma (Vertex AI MaaS),
reached through the Cloudflare AI Gateway. This is the SAME proven path PIPE's
workers use and that CEO Studio uses for persona generation: the Gateway holds
the GCP service account and refreshes OAuth itself, so the harness only needs a
Cloudflare API token — no JWT signing, no gcloud, no service-account JSON.

It is a real, hosted LLM (not a CLI like grok/claude/devin), so there is no
session to resume on the server. We keep multi-turn coherence ourselves by
storing the conversation per session in the agent's workdir and replaying it on
every `tell`, exactly like a chat history.

Env (forwarded from the Electron main process, which loads .env.local):
  CF_AI_GATEWAY_URL  — https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/google-vertex-ai
  CF_API_TOKEN       — Cloudflare API token (AI Gateway run/read)
  VERTEX_AI_MODEL    — model id (default: google/gemma-4-26b-a4b-it-maas)

stdlib only (urllib/json) so the harness stays dependency-free.
"""

from __future__ import annotations

import json
import os
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

DEFAULT_MODEL = "google/gemma-4-26b-a4b-it-maas"


def gateway_url(base: str) -> str:
    """Strip trailing slash + the `/google-vertex-ai` suffix, add the compat path."""
    root = (base or "").rstrip("/")
    if root.endswith("/google-vertex-ai"):
        root = root[: -len("/google-vertex-ai")]
    return f"{root}/compat/chat/completions"


def gateway_model(model: Optional[str]) -> str:
    """Model must be prefixed `google-vertex-ai/` for the unified endpoint."""
    m = model or DEFAULT_MODEL
    return m if m.startswith("google-vertex-ai/") else f"google-vertex-ai/{m}"


class VertexProvider(AgentProvider):
    name = "vertex"
    # Funded infra (same path as the CEO's utility model). Not gated as paid.
    paid = False

    def __init__(self) -> None:
        self.gateway = (os.environ.get("CF_AI_GATEWAY_URL") or "").strip()
        self.token = (os.environ.get("CF_API_TOKEN") or "").strip()
        self.model = (os.environ.get("VERTEX_AI_MODEL") or DEFAULT_MODEL).strip()

    # --- conversation persistence (so `tell` is a real multi-turn chat) -------
    def _store(self, workdir: Path) -> Path:
        workdir.mkdir(parents=True, exist_ok=True)
        return workdir / "vertex_sessions.json"

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

    # --- HTTP -----------------------------------------------------------------
    def _complete(self, messages: list, *, timeout: int) -> tuple[str, Optional[str]]:
        """Call Gemma via the gateway. Returns (reply_text, error_message)."""
        if not self.gateway or not self.token:
            return "", "[vertex] CF_AI_GATEWAY_URL / CF_API_TOKEN not set"
        body = json.dumps({
            "model": gateway_model(self.model),
            "messages": messages,
            "max_tokens": 1024,
            "stream": False,
        }).encode("utf-8")
        req = urllib.request.Request(
            gateway_url(self.gateway),
            data=body,
            method="POST",
            headers={
                "Content-Type": "application/json",
                "cf-aig-authorization": f"Bearer {self.token}",
                # Cloudflare's WAF rejects urllib's default UA with a 1010 ban;
                # send an explicit client UA so the gateway accepts the request.
                "User-Agent": "ceo-studio-harness/1.0",
            },
        )
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            detail = ""
            try:
                detail = e.read().decode("utf-8")[:300]
            except Exception:
                pass
            return "", f"[vertex {e.code}] {detail}"
        except urllib.error.URLError as e:
            return "", f"[vertex network error] {e.reason}"
        except Exception as e:  # noqa: BLE001 - never crash the swarm on a bad turn
            return "", f"[vertex error] {e}"
        try:
            text = (data["choices"][0]["message"]["content"] or "").strip()
        except (KeyError, IndexError, TypeError):
            return "", "[vertex] malformed response"
        if not text:
            return "", "[vertex] empty response"
        return text, None

    # --- provider contract ----------------------------------------------------
    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        if model:
            self.model = model
        sid = f"vertex-{agent}-{int(time.time())}"
        convo = [{"role": "user", "content": task}]
        reply, error = self._complete(convo, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=sid, error=True)
        convo.append({"role": "assistant", "content": reply})
        data = self._load(workdir)
        data[sid] = convo
        self._save(workdir, data)
        return ProviderResult(reply=reply, session_id=sid)

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        if model:
            self.model = model
        data = self._load(workdir)
        convo = data.get(session_id)
        if convo is None:
            # Unknown/expired session: start a fresh thread rather than failing.
            convo = []
        convo.append({"role": "user", "content": message})
        reply, error = self._complete(convo, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        convo.append({"role": "assistant", "content": reply})
        data[session_id] = convo
        self._save(workdir, data)
        return ProviderResult(reply=reply, session_id=session_id)
