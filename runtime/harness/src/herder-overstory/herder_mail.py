#!/usr/bin/env python3
"""
Herder Mail — Structured agent-to-agent messaging for the PIPE-OS herder.

This is a pragmatic adaptation of Overstory's excellent mail bus concept,
built on top of the existing domain room (chat.log) infrastructure.

Design goals:
- Typed protocol messages (not just raw text in the room)
- Correlation IDs / threading for request-response patterns
- Easy broadcasting to roles or groups ("@builders", "@orchestrator")
- Backwards compatible with plain domain-room posts
- Simple enough for the current watcher + external agents (Grok, etc.)

Message format (appended to chat.log):
[TS] FromAgent: [HERDER_MAIL] {"type": "...", "to": "...", "subject": "...", "body": "...", "payload": {...}, "thread_id": "..."}

This keeps everything visible in the normal room (great for humans + Hermes),
while giving agents structured data they can parse reliably.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional


@dataclass
class MailMessage:
    timestamp: str
    from_agent: str
    to: str  # Can be agent name, role (@builders), or "broadcast"
    subject: str
    body: str
    type: str = "text"  # "text", "dispatch", "status_update", "escalation", "worker_done", etc.
    payload: Optional[Dict[str, Any]] = None
    thread_id: Optional[str] = None
    raw_line: str = ""


class HerderMail:
    def __init__(self, room: str, agent_name: str, harness_root: Optional[Path] = None):
        self.room = room
        self.agent_name = agent_name
        if harness_root is None:
            harness_root = Path(__file__).parent.parent.parent  # rough guess
        self.chat_log = harness_root / "brain" / "rooms" / room / "chat.log"
        self._last_offset = 0

    def _now(self) -> str:
        return datetime.now(timezone.utc).isoformat()

    def send(
        self,
        to: str,
        subject: str,
        body: str,
        type: str = "text",
        payload: Optional[Dict[str, Any]] = None,
        thread_id: Optional[str] = None,
    ) -> str:
        """
        Send a structured message into the domain room.

        This is still a normal post, so it appears in `domain-room who`, the web UI,
        and the rich chat — humans and the orchestrator can see everything.
        """
        msg = {
            "type": type,
            "to": to,
            "subject": subject,
            "body": body,
            "payload": payload or {},
            "thread_id": thread_id,
        }

        line = f"[{self._now()}] {self.agent_name}: [HERDER_MAIL] {json.dumps(msg, ensure_ascii=False)}"

        with open(self.chat_log, "a", encoding="utf-8") as f:
            f.write(line + "\n")

        return line

    def check(self, only_unread: bool = True) -> List[MailMessage]:
        """
        Return new messages addressed to this agent (or broadcast / role groups).

        Very simple polling implementation for now. A real version would track
        read state per agent.
        """
        if not self.chat_log.exists():
            return []

        messages: List[MailMessage] = []
        with open(self.chat_log, "r", encoding="utf-8", errors="replace") as f:
            f.seek(self._last_offset)
            for line in f:
                line = line.rstrip("\n")
                if "[HERDER_MAIL]" not in line:
                    continue

                try:
                    # Very rough parser — good enough for early experimentation
                    # Format: [TS] From: [HERDER_MAIL] {json}
                    prefix, json_part = line.split("[HERDER_MAIL]", 1)
                    from_part = prefix.split("] ", 1)[1].rstrip(":")
                    data = json.loads(json_part.strip())

                    msg = MailMessage(
                        timestamp=data.get("timestamp") or line.split("]")[0].lstrip("["),
                        from_agent=from_part,
                        to=data.get("to", ""),
                        subject=data.get("subject", ""),
                        body=data.get("body", ""),
                        type=data.get("type", "text"),
                        payload=data.get("payload"),
                        thread_id=data.get("thread_id"),
                        raw_line=line,
                    )

                    # Simple relevance filter
                    if self._is_relevant(msg):
                        messages.append(msg)
                except Exception:
                    continue

            self._last_offset = f.tell()

        return messages

    def _is_relevant(self, msg: MailMessage) -> bool:
        """Basic relevance: addressed to me, broadcast, or my role/group."""
        if msg.from_agent == self.agent_name:
            return False

        to = msg.to.lower()
        me = self.agent_name.lower()

        if to == me:
            return True
        if to in ("broadcast", "@all", "*"):
            return True
        if to.startswith("@") and me in to:  # crude role matching
            return True
        return False

    def send_protocol(
        self,
        to: str,
        type: str,
        payload: Dict[str, Any],
        subject: Optional[str] = None,
        body: str = "",
        thread_id: Optional[str] = None,
    ) -> str:
        """Convenience for the typed protocol messages Overstory-style."""
        return self.send(
            to=to,
            subject=subject or type,
            body=body,
            type=type,
            payload=payload,
            thread_id=thread_id,
        )


# Example usage inside a watcher reactor
if __name__ == "__main__":
    mail = HerderMail(room="discovery", agent_name="ExampleBuilder")
    print("Checking for mail...")
    for m in mail.check():
        print(f"From {m.from_agent}: {m.subject} ({m.type})")
        if m.payload:
            print("  payload:", m.payload)
