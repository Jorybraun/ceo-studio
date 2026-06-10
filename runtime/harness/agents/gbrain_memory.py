"""
GBrain memory adapter for live rooms (thin CLI bridge).

Mirrors the cockpit's Node bridge (`main/core/gbrain.js`): shells out to the
local `gbrain` CLI for `capture` (ingest) and `query` (semantic recall) with the
same env preparation, so memory behaves consistently across the system. This is
the first concrete piece of the `integrations/gbrain` adapter contract, scoped
to room conversations.

Memory model (per the user's choice + BRAIN_AND_GBRAIN_ROADMAP "Record first"):
  - The raw room `chat.log` stays first-class (gbrain is never the only copy).
  - Provider sessions still carry tight in-conversation continuity.
  - gbrain ADDS durable, shared, cross-room/long-term recall: every turn is
    captured, and each agent gets relevant prior context injected before it
    answers.

Hard rule: NEVER block or break the conversation.
  - If gbrain is missing/misconfigured/unhealthy, `available()` is False and
    every call is a silent no-op (verified path: this machine's gbrain DB is
    currently down, so the room just runs without memory).
  - `capture()` is fire-and-forget (background thread) so turns stay responsive.
  - `recall()` is synchronous but short-timeout; returns "" on any problem.
"""

from __future__ import annotations

import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Optional


def _prepare_env(base: Optional[dict] = None) -> dict:
    """Mirror main/core/gbrain.js prepareEnv so the CLI resolves + can embed."""
    env = dict(base if base is not None else os.environ)
    home = env.get("HOME", "")
    if home:
        env["PATH"] = f"{home}/.bun/bin:" + env.get("PATH", "")
    env.pop("DATABASE_URL", None)  # avoid clobbering gbrain's own DB config
    if not env.get("GOOGLE_GENERATIVE_AI_API_KEY") and home:
        pipe_env = Path(home) / "Code" / "PIPE" / "PIPE-OS" / ".env"
        try:
            if pipe_env.exists():
                m = re.search(r"^VERTEX_API_KEY=(.+)$", pipe_env.read_text(), re.M)
                if m:
                    env["GOOGLE_GENERATIVE_AI_API_KEY"] = m.group(1).strip().strip('"')
        except Exception:
            pass
    return env


class GBrainMemory:
    """Room-scoped capture + recall over the local gbrain CLI. Degrades silently."""

    def __init__(self, *, bin_: Optional[str] = None, enabled: bool = True,
                 limit: int = 5, detail: str = "medium", ceiling: int = 4000):
        self.bin = bin_ or os.environ.get("GBRAIN_BIN", "gbrain")
        self.enabled = enabled
        self.limit = limit
        self.detail = detail
        # Context ceiling: hard cap (in characters) on how much recalled brain
        # content is injected per turn. Prevents the shared brain from ballooning
        # an agent's context window. 0 disables the cap.
        self.ceiling = max(0, int(ceiling))
        self.env = _prepare_env()
        self._available: Optional[bool] = None

    def available(self) -> bool:
        if not self.enabled:
            return False
        if self._available is None:
            self._available = self._probe()
        return self._available

    def _probe(self) -> bool:
        try:
            r = subprocess.run([self.bin, "stats"], capture_output=True, text=True,
                               timeout=12, env=self.env, stdin=subprocess.DEVNULL)
            return r.returncode == 0
        except Exception:
            return False

    def recall(self, query_text: str, *, limit: Optional[int] = None) -> str:
        """Semantic lookup of prior context. Returns '' if unavailable/empty."""
        if not self.available() or not (query_text or "").strip():
            return ""
        args = [self.bin, "query", query_text[:2000],
                "--limit", str(limit or self.limit), "--detail", self.detail]
        try:
            r = subprocess.run(args, capture_output=True, text=True, timeout=40,
                               env=self.env, stdin=subprocess.DEVNULL)
            return _cap(r.stdout.strip(), self.ceiling) if r.returncode == 0 else ""
        except Exception:
            return ""

    def capture(self, *, room: str, speaker: str, body: str) -> None:
        """Fire-and-forget ingest of one room message (non-blocking)."""
        if not self.available() or not (body or "").strip():
            return
        threading.Thread(target=self._capture_sync, args=(room, speaker, body),
                         daemon=True).start()

    def _capture_sync(self, room: str, speaker: str, body: str) -> None:
        day = time.strftime("%Y-%m-%d")
        base = re.sub(r"[^a-z0-9]+", "-", f"{room}-{speaker}".lower()).strip("-")[:64] or "room-msg"
        slug = f"ceo-studio/rooms/{day}/{base}-{int(time.time() * 1000)}"
        doc = (f"# Room {room} — {speaker}\n\n"
               f"Room: {room}\nSpeaker: {speaker}\n\n{body}\n")
        try:
            subprocess.run([self.bin, "capture", "--stdin", "--slug", slug,
                           "--type", "room-message", "--json"],
                          input=doc, capture_output=True, text=True,
                          timeout=30, env=self.env)
        except Exception:
            pass


def _cap(text: str, ceiling: int) -> str:
    """Trim recalled brain content to a character ceiling on a line boundary.

    Keeps the head (most-relevant first per gbrain ranking) and appends a clear
    truncation marker so the agent knows context was clipped. `ceiling <= 0`
    disables the cap.
    """
    if ceiling <= 0 or len(text) <= ceiling:
        return text
    head = text[:ceiling]
    nl = head.rfind("\n")
    if nl > ceiling // 2:  # prefer a clean line break when one is reasonably close
        head = head[:nl]
    return head.rstrip() + "\n[…brain context truncated at ceiling…]"


def with_memory(prompt: str, memory_block: str) -> str:
    """Prepend recalled context to a prompt (no-op when there's nothing to add)."""
    if not (memory_block or "").strip():
        return prompt
    return ("Relevant long-term memory from the team's shared brain (gbrain) — "
            "may be partial or irrelevant; use only what helps:\n"
            f"{memory_block}\n\n----------\n\n{prompt}")
