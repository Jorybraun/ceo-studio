#!/usr/bin/env python3
"""
Dogfood every configured harness agent through the real provider adapter.

Default mode is spend-safe: paid providers are reported as skipped unless
`--allow-paid` is passed. Each tested agent gets:

1. a fresh dispatch turn,
2. a resume/tell turn,
3. a durable room transcript,
4. a markdown + JSON report under dogfood-output/agent-roster/.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HARNESS_ROOT = ROOT / "runtime" / "harness"
sys.path.insert(0, str(HARNESS_ROOT))


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def slug(value: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "-" for ch in value)
    while "--" in out:
        out = out.replace("--", "-")
    return out.strip("-") or "agent"


def parse_args() -> argparse.Namespace:
    ap = argparse.ArgumentParser(description="Dogfood the CEO Studio harness agent roster.")
    ap.add_argument("--allow-paid", action="store_true", help="Run paid providers too (devin/grok/claude/command).")
    ap.add_argument("--agent", action="append", default=[], help="Only test this agent id. Repeatable.")
    ap.add_argument("--provider", action="append", default=[], help="Only test this provider. Repeatable.")
    ap.add_argument("--timeout", type=int, default=int(os.environ.get("AGENT_DOGFOOD_TIMEOUT", "120")))
    ap.add_argument("--room", default="", help="Room name for the test transcript.")
    ap.add_argument("--output-dir", default=str(ROOT / "dogfood-output" / "agent-roster"))
    ap.add_argument("--keep-room", action="store_true", help="Do not delete an existing room with the same name before running.")
    ap.add_argument("--no-resume", action="store_true", help="Only run dispatch, not tell/resume.")
    return ap.parse_args()


def provider_paid(provider_name: str) -> bool:
    from agents import providers

    try:
        return bool(getattr(providers.get_provider(provider_name), "paid", False))
    except Exception:
        return True


def main() -> int:
    args = parse_args()
    if args.allow_paid:
        os.environ["CEO_ALLOW_PAID"] = "1"
        os.environ.setdefault("CEO_MAX_SPAWNS_PER_HOUR", "100")
    os.environ.setdefault("CEO_GUARDRAIL_DISABLE_TMUX", "1")
    os.environ.setdefault("HARNESS_WORKSPACE", str(HARNESS_ROOT))

    from agents import agent_adapter, agent_config, providers
    from config import paths

    all_agents = agent_config.list_agents()
    selected_agents = set(args.agent or [])
    selected_providers = {p.lower() for p in (args.provider or [])}
    agents = []
    for spec in all_agents:
        if selected_agents and spec["id"] not in selected_agents:
            continue
        if selected_providers and str(spec.get("provider", "")).lower() not in selected_providers:
            continue
        agents.append(spec)

    run_id = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    room = slug(args.room or f"agent-roster-dogfood-{run_id}")
    room_dir = paths.room_dir(room)
    if room_dir.exists() and not args.keep_room:
        shutil.rmtree(room_dir, ignore_errors=True)

    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)

    results = []
    started = iso_now()
    for spec in agents:
        aid = spec["id"]
        provider_name = spec.get("provider") or "echo"
        model = spec.get("model")
        paid = provider_paid(provider_name)
        row = {
            "agent": aid,
            "name": spec.get("name") or aid,
            "provider": provider_name,
            "model": model,
            "persona": spec.get("persona"),
            "paid": paid,
            "status": "pending",
            "dispatch": None,
            "resume": None,
            "seconds": 0,
        }
        t0 = time.time()
        try:
            providers.get_provider(provider_name)
        except Exception as exc:
            row["status"] = "failed"
            row["dispatch"] = {"ok": False, "reason": f"unknown provider: {exc}"}
            row["seconds"] = round(time.time() - t0, 1)
            results.append(row)
            continue

        if paid and not args.allow_paid:
            row["status"] = "skipped"
            row["dispatch"] = {"ok": False, "reason": "paid provider skipped; rerun with --allow-paid"}
            row["seconds"] = round(time.time() - t0, 1)
            results.append(row)
            continue

        prompt = (
            "Dogfood health check. Reply with exactly one concise sentence that "
            f"starts with AGENT_OK and names your agent id: {aid}."
        )
        try:
            dispatch = agent_adapter.dispatch(
                provider_name,
                aid,
                room,
                prompt,
                model=model,
                timeout=args.timeout,
                interactive=False,
            )
        except Exception as exc:
            dispatch = {"ok": False, "reason": str(exc)}
        row["dispatch"] = dispatch

        if dispatch.get("ok") and not args.no_resume:
            try:
                resume = agent_adapter.tell(
                    aid,
                    room,
                    f"Resume health check for {aid}. Reply with AGENT_RESUME_OK in one short sentence.",
                    timeout=args.timeout,
                )
            except Exception as exc:
                resume = {"ok": False, "reason": str(exc)}
            row["resume"] = resume
        elif args.no_resume:
            row["resume"] = {"ok": True, "skipped": True, "reason": "--no-resume"}
        else:
            row["resume"] = {"ok": False, "skipped": True, "reason": "dispatch failed"}

        row["status"] = "passed" if row["dispatch"].get("ok") and row["resume"].get("ok") else "failed"
        row["seconds"] = round(time.time() - t0, 1)
        results.append(row)

    finished = iso_now()
    summary = {
        "run_id": run_id,
        "started_at": started,
        "finished_at": finished,
        "room": room,
        "allow_paid": args.allow_paid,
        "total": len(results),
        "passed": len([r for r in results if r["status"] == "passed"]),
        "failed": len([r for r in results if r["status"] == "failed"]),
        "skipped": len([r for r in results if r["status"] == "skipped"]),
        "results": results,
        "room_log": str(paths.room_log(room)),
    }

    json_path = output_dir / f"report-{run_id}.json"
    md_path = output_dir / f"report-{run_id}.md"
    latest_path = output_dir / "report.md"
    json_path.write_text(json.dumps(summary, indent=2), encoding="utf-8")
    md = render_markdown(summary)
    md_path.write_text(md, encoding="utf-8")
    latest_path.write_text(md, encoding="utf-8")

    print(md)
    print(f"\nJSON: {json_path}")
    print(f"Latest: {latest_path}")
    return 1 if summary["failed"] else 0


def short(value) -> str:
    if value is None:
        return ""
    if isinstance(value, dict):
        text = value.get("reply") or value.get("reason") or json.dumps(value, sort_keys=True)
    else:
        text = str(value)
    text = " ".join(str(text).split())
    return text[:240]


def render_markdown(summary: dict) -> str:
    lines = [
        "# Agent Roster Dogfood Report",
        "",
        f"Date: {summary['finished_at']}",
        f"Room: `{summary['room']}`",
        f"Room log: `{summary['room_log']}`",
        f"Allow paid: `{str(summary['allow_paid']).lower()}`",
        "",
        "## Summary",
        "",
        f"- Total: {summary['total']}",
        f"- Passed: {summary['passed']}",
        f"- Failed: {summary['failed']}",
        f"- Skipped: {summary['skipped']}",
        "",
        "## Results",
        "",
        "| Agent | Provider | Model | Status | Dispatch | Resume |",
        "|---|---|---|---|---|---|",
    ]
    for r in summary["results"]:
        lines.append(
            "| {agent} | {provider} | {model} | {status} | {dispatch} | {resume} |".format(
                agent=r["agent"],
                provider=r["provider"],
                model=r.get("model") or "",
                status=r["status"],
                dispatch=short(r.get("dispatch")).replace("|", "/"),
                resume=short(r.get("resume")).replace("|", "/"),
            )
        )
    lines += [
        "",
        "## How To Reproduce",
        "",
        "```bash",
        "python3 scripts/dogfood-agent-roster.py",
        "python3 scripts/dogfood-agent-roster.py --allow-paid",
        "python3 scripts/dogfood-agent-roster.py --agent codex-factory-strategist",
        "```",
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
