"""
Generic command provider — the "use anything" seam.

Any CLI that takes a prompt and prints a reply can be an agent backend with
zero new code: declare it in agents.json with `"provider": "command"` and a
`"command"` template, e.g.

  {"id": "claude-raw", "provider": "command",
   "command": "claude -p --output-format text {prompt}"}
  {"id": "ollama", "provider": "command",
   "command": "ollama run llama3 {prompt}", "paid": false}

The template is tokenized (shell-style) and these placeholders are substituted
per token (so a prompt with spaces stays a single argument):
  {prompt}   the task / message text
  {model}    the agent's model (or empty)
  {workdir}  the agent's isolated working directory
  {agent}    the agent id
  {session_id}  the resume id on `tell` (empty on first dispatch)

This provider is intentionally stateless: it returns a cwd marker as the
session id and re-runs the command for `tell`. Backends that need real
multi-turn resume should ship a dedicated provider (see claude/grok/devin).
"""

from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path
from typing import Optional

from .base import AgentProvider, ProviderResult

_ANSI = re.compile(r"\x1b\[[0-9;]*m")


def _strip_ansi(s: str) -> str:
    return _ANSI.sub("", s or "")


def _agent_spec(agent: str) -> dict:
    """Best-effort lookup of the agent's declarative spec (for `command`/`paid`)."""
    try:
        from agents import agent_config  # type: ignore
    except Exception:
        try:
            import agent_config  # type: ignore
        except Exception:
            return {}
    try:
        return agent_config.get_agent(agent) or {}
    except Exception:
        return {}


def render(template: str, *, prompt: str, model: str, workdir: str,
           agent: str, session_id: str) -> list[str]:
    """Tokenize `template` and substitute placeholders per token."""
    subs = {
        "{prompt}": prompt,
        "{model}": model or "",
        "{workdir}": workdir,
        "{agent}": agent,
        "{session_id}": session_id or "",
    }
    out: list[str] = []
    for tok in shlex.split(template):
        for key, val in subs.items():
            tok = tok.replace(key, val)
        out.append(tok)
    return out


class CommandProvider(AgentProvider):
    name = "command"
    paid = True  # unknown backend: count conservatively unless spec says otherwise.

    def _run(self, agent: str, prompt: str, *, model: Optional[str],
             session_id: Optional[str], workdir: Path, timeout: int) -> tuple[str, Optional[str]]:
        spec = _agent_spec(agent)
        template = str(spec.get("command") or "").strip()
        if not template:
            return "", (f"[command provider] agent '{agent}' has no `command` "
                        f"template in its config")
        if "{prompt}" not in template:
            return "", "[command provider] `command` must include the {prompt} placeholder"
        argv = render(template, prompt=prompt, model=model or "", workdir=str(workdir),
                      agent=agent, session_id=session_id or "")
        try:
            res = subprocess.run(argv, cwd=str(workdir), capture_output=True, text=True,
                                 timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return "", f"[command timeout after {timeout}s]"
        except FileNotFoundError:
            return "", f"[command not found: {argv[0]}]"
        text = _strip_ansi(res.stdout or "").strip()
        if not text and res.returncode != 0:
            return "", f"[command rc={res.returncode}] {_strip_ansi(res.stderr or '')[:400]}"
        return text, None

    def dispatch(self, agent, task, *, model, workdir, timeout=600) -> ProviderResult:
        # Reflect the configured `paid` flag so guardrails gate correctly.
        spec = _agent_spec(agent)
        self.paid = bool(spec.get("paid", True))
        text, error = self._run(agent, task, model=model, session_id=None,
                                workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=None, error=True)
        return ProviderResult(reply=text, session_id=f"command-cwd:{workdir.name}")

    def tell(self, agent, message, *, session_id, model, workdir, timeout=600) -> ProviderResult:
        text, error = self._run(agent, message, model=model, session_id=session_id,
                                workdir=workdir, timeout=timeout)
        if error:
            return ProviderResult(reply=error, session_id=session_id, error=True)
        return ProviderResult(reply=text, session_id=session_id or f"command-cwd:{workdir.name}")
