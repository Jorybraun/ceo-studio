"""
Per-project persona resolver.

Personas are plain markdown files that describe a role's mission + operating
style. They live with the project (a project `personas/` dir) so each project
owns its team. We also fall back to the harness's own `personas/` library.

Resolution order (first match wins by id):
  1. $CEO_PERSONAS_DIR (colon-separated list of dirs)
  2. <workspace>/personas        (the active project's data dir)
  3. <HARNESS_HOME>/personas      (the shipped harness library)

This is the single seam the A2A adapter + meeting orchestrator use to turn a
persona id (e.g. "architect") into the text injected ahead of an agent's task.
stdlib-only by design.
"""

from __future__ import annotations

import os
from pathlib import Path

from config import paths


def _candidate_dirs() -> list[Path]:
    dirs: list[Path] = []
    env = os.environ.get("CEO_PERSONAS_DIR", "")
    for chunk in env.split(os.pathsep):
        if chunk.strip():
            dirs.append(Path(chunk).expanduser())
    dirs.append(paths.workspace() / "personas")
    dirs.append(paths.workspace() / "runtime" / "harness" / "personas")
    dirs.append(paths.HARNESS_HOME / "personas")
    # de-dup, preserve order
    seen, out = set(), []
    for d in dirs:
        rd = d.resolve()
        if rd not in seen:
            seen.add(rd)
            out.append(d)
    return out


def _walk_md(root: Path):
    if not root.exists():
        return
    for p in root.rglob("*.md"):
        if p.is_file():
            yield p


def list_personas() -> list[dict]:
    """All discoverable personas as {id, name, path, source}. First id wins."""
    found: dict[str, dict] = {}
    for d in _candidate_dirs():
        for p in _walk_md(d):
            pid = p.stem
            if pid.lower() in {"readme", "index"}:
                continue
            key = pid.lower()
            if key not in found:
                found[key] = {
                    "id": pid,
                    "name": pid.replace("-", " ").replace("_", " ").title(),
                    "path": str(p),
                    "source": str(d),
                }
    return sorted(found.values(), key=lambda x: x["id"].lower())


def resolve(persona_id: str | None) -> dict | None:
    """Return {id, name, path, text} for a persona id, or None if not found."""
    if not persona_id:
        return None
    target = persona_id.strip().lower()
    for d in _candidate_dirs():
        for p in _walk_md(d):
            if p.stem.lower() == target:
                try:
                    text = p.read_text(encoding="utf-8")
                except Exception:
                    text = ""
                return {"id": p.stem, "name": p.stem.replace("-", " ").title(),
                        "path": str(p), "text": text}
    return None


def persona_preamble(persona_id: str | None) -> str:
    """The text to prepend to an agent's task so it acts in-persona. Empty if none."""
    pr = resolve(persona_id)
    if not pr or not pr.get("text"):
        return ""
    return (f"You are operating as the **{pr['name']}** persona. "
            f"Stay in this role for your entire reply.\n\n"
            f"--- PERSONA BRIEF ---\n{pr['text'].strip()}\n--- END PERSONA BRIEF ---\n")


if __name__ == "__main__":
    import json
    import sys
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
    if len(sys.argv) > 1 and sys.argv[1] == "resolve":
        print(json.dumps(resolve(sys.argv[2] if len(sys.argv) > 2 else ""), indent=2))
    else:
        print(json.dumps(list_personas(), indent=2))
