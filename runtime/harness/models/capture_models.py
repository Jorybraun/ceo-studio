#!/usr/bin/env python3
"""
Capture the live, available models for every brain provider into a single
catalog (models/catalog.json) the cockpit can read.

This goes through each provider's real source of truth — NOT a hardcoded guess:
  vertex  -> the configured Gemma MaaS model(s) on the Cloudflare AI Gateway
  codex   -> ~/.codex/models_cache.json           (codex CLI's own cache)
  hermes  -> ~/.hermes/provider_models_cache.json  (union of routed providers)
  grok    -> ~/.grok/models_cache.json + hermes xai-oauth entries
  claude  -> hermes 'anthropic' entries            (claude CLI accepts these)
  pi      -> `pi --list-models`                    (live CLI listing)
  devin   -> curated Devin CLI model list (Devin does not expose a non-costly
             model-list command yet)
  command -> none (arbitrary CLI; model is part of the command template)

Re-run any time to refresh:  python3 models/capture_models.py
"""

from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from pathlib import Path

HOME = Path(os.path.expanduser("~"))
OUT = Path(__file__).resolve().parent / "catalog.json"


def _load_json(p: Path) -> dict | list | None:
    try:
        return json.loads(p.read_text())
    except Exception:
        return None


def _entry(mid, label=None, context=None, source=None, thinking=None, images=None):
    e = {"id": mid, "label": label or mid}
    if context is not None:
        e["context"] = context
    if source:
        e["source"] = source
    if thinking is not None:
        e["thinking"] = thinking
    if images is not None:
        e["images"] = images
    return e


def capture_codex() -> list:
    d = _load_json(HOME / ".codex" / "models_cache.json") or {}
    out = []
    for m in d.get("models", []):
        if not isinstance(m, dict):
            continue
        out.append(_entry(
            m.get("slug"),
            label=m.get("display_name") or m.get("slug"),
            context=m.get("context_window"),
        ))
    return [e for e in out if e["id"]]


def capture_hermes() -> list:
    """Union of every provider hermes can route to, tagged by sub-provider."""
    d = _load_json(HOME / ".hermes" / "provider_models_cache.json") or {}
    out = []
    for prov, blob in d.items():
        for m in (blob or {}).get("models", []):
            mid = m.get("id") or m.get("slug") or m.get("name") if isinstance(m, dict) else m
            if mid:
                out.append(_entry(mid, source=prov))
    return out


def capture_grok() -> list:
    out = {}
    # Grok's own cache (rich, but usually just the active model).
    d = _load_json(HOME / ".grok" / "models_cache.json") or {}
    for mid, blob in (d.get("models") or {}).items():
        info = (blob or {}).get("info", {})
        out[mid] = _entry(mid, label=info.get("name") or mid,
                          context=info.get("context_window"))
    # Hermes' xai-oauth list fills in the rest.
    hz = _load_json(HOME / ".hermes" / "provider_models_cache.json") or {}
    for m in (hz.get("xai-oauth") or {}).get("models", []):
        mid = m.get("id") or m.get("slug") if isinstance(m, dict) else m
        if mid and mid not in out:
            out[mid] = _entry(mid)
    return list(out.values())


def capture_claude() -> list:
    """Claude CLI accepts anthropic model ids (and aliases sonnet/opus/haiku)."""
    hz = _load_json(HOME / ".hermes" / "provider_models_cache.json") or {}
    out = [_entry("opus", label="opus (alias → latest)"),
           _entry("sonnet", label="sonnet (alias → latest)"),
           _entry("haiku", label="haiku (alias → latest)")]
    seen = {e["id"] for e in out}
    for m in (hz.get("anthropic") or {}).get("models", []):
        mid = m.get("id") or m.get("slug") if isinstance(m, dict) else m
        if mid and mid not in seen:
            out.append(_entry(mid, source="anthropic"))
            seen.add(mid)
    return out


def capture_pi() -> list:
    try:
        # pi writes the model table to stderr; merge it into stdout to capture.
        res = subprocess.run(["pi", "--list-models"], stdout=subprocess.PIPE,
                             stderr=subprocess.STDOUT, text=True, timeout=90,
                             stdin=subprocess.DEVNULL)
    except Exception as e:  # noqa: BLE001
        return [{"id": "_error", "label": f"pi --list-models failed: {e}"}]
    out = []
    for line in (res.stdout or "").splitlines():
        parts = line.split()
        # header row + blanks
        if len(parts) < 2 or parts[0] in ("provider", ""):
            continue
        prov, model = parts[0], parts[1]
        ctx = parts[2] if len(parts) > 2 else None
        thinking = (parts[4] == "yes") if len(parts) > 4 else None
        images = (parts[5] == "yes") if len(parts) > 5 else None
        out.append(_entry(model, label=f"{prov}/{model}", context=ctx,
                         source=prov, thinking=thinking, images=images))
    return out


def capture_vertex() -> list:
    """Gemma MaaS through the Cloudflare AI Gateway (the configured model)."""
    model = (os.environ.get("VERTEX_AI_MODEL") or "google/gemma-4-26b-a4b-it-maas").strip()
    return [_entry(model, label=f"Gemma (Vertex MaaS) · {model}", source="cloudflare-ai-gateway")]


def capture_devin() -> list:
    """Curated Devin CLI model options.

    `devin --help` documents `--model <MODEL>`, but the CLI does not currently
    expose a cheap machine-readable model listing. Keep this list in sync with
    the Devin model picker and use ids in the same lowercase hyphenated style as
    the CLI examples (`claude-opus-4.6`, `codex`).
    """
    return [
        {**_entry("adaptive-promo", "Adaptive PROMO", source="devin"), "promo": True},
        _entry("claude-haiku-4.5", "Claude Haiku 4.5", source="devin"),
        {
            **_entry("claude-sonnet-4.6", "Claude Sonnet 4.6", source="devin"),
            "cost": {"input_per_mtok": 3, "output_per_mtok": 15},
        },
        _entry("deepseek-v4-pro", "DeepSeek V4 Pro", source="devin"),
        _entry("gemini-3.5-flash", "Gemini 3.5 Flash", source="devin"),
        _entry("glm-5.1", "GLM-5.1", source="devin"),
        _entry("gpt-5.5", "GPT-5.5", source="devin"),
        {**_entry("kimi-k2.6-promo", "Kimi K2.6 PROMO", source="devin"), "promo": True},
        _entry("swe-1.6-fast", "SWE-1.6 Fast", source="devin"),
        _entry("claude-opus-4.7", "Claude Opus 4.7", source="devin"),
        {**_entry("claude-sonnet-4.5-promo", "Claude Sonnet 4.5 PROMO", source="devin"), "promo": True},
        _entry("gemini-3.1-pro", "Gemini 3.1 Pro", source="devin"),
        _entry("gpt-5.4", "GPT-5.4", source="devin"),
        _entry("gpt-5.4-mini", "GPT-5.4 Mini", source="devin"),
        {**_entry("swe-1.5-promo", "SWE-1.5 PROMO", source="devin"), "promo": True},
        _entry("claude-opus-4.6", "Claude Opus 4.6", source="devin"),
        _entry("gemini-3-flash", "Gemini 3 Flash", source="devin"),
        _entry("gpt-5.3-codex", "GPT-5.3-Codex", source="devin"),
        _entry("claude-opus-4.5", "Claude Opus 4.5", source="devin"),
        _entry("gpt-5.2", "GPT-5.2", source="devin"),
    ]


def main() -> None:
    catalog = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "providers": {
            "vertex": capture_vertex(),
            "codex": capture_codex(),
            "hermes": capture_hermes(),
            "grok": capture_grok(),
            "claude": capture_claude(),
            "pi": capture_pi(),
            "devin": capture_devin(),
            "command": [],   # arbitrary CLI; model lives in the command template
        },
    }
    OUT.write_text(json.dumps(catalog, indent=2) + "\n")
    print(f"captured -> {OUT}")
    for prov, models in catalog["providers"].items():
        print(f"  {prov:8s} {len(models)} model(s)")


if __name__ == "__main__":
    main()
