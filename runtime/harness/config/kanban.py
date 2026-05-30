"""
harness/config/kanban.py

Structured config objects for Kanban stage → team + workflow mappings.

This is the canonical *machine* form of what lives (in human-friendly form)
in context/<domain>-team/mgmt/stage-map.md.

Tools like harem-delegate --stage, the Kanban Finisher orchestrator,
and future automation should load from here rather than scraping Markdown.

The rich Markdown files remain the source of truth for humans and for
the LLM brains (kanban-finisher persona etc.). This module is the
reliable object form for code.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional


@dataclass(frozen=True)
class StageMapping:
    """What team + workflow + default personas to use for one Kanban column."""
    team: str
    workflow: str
    default_personas: List[str] = field(default_factory=list)
    notes: str = ""


@dataclass(frozen=True)
class DomainKanbanConfig:
    """All stage mappings for one domain's Kanban."""
    domain: str
    stages: Dict[str, StageMapping] = field(default_factory=dict)
    description: str = ""

    def get_stage(self, stage_name: str) -> Optional[StageMapping]:
        """Case-insensitive lookup for a stage."""
        key = stage_name.strip().lower()
        for k, v in self.stages.items():
            if k.lower() == key:
                return v
        return None

    @property
    def known_stages(self) -> List[str]:
        return list(self.stages.keys())


# ---------------------------------------------------------------------------
# Current domain configurations (structured objects)
#
# These are the real config objects. The Markdown stage-map.md files are
# the human/brain view and should be kept in sync manually for now.
# Later we can add YAML loading or a generator.
# ---------------------------------------------------------------------------

DISCOVERY_KANBAN = DomainKanbanConfig(
    domain="discovery",
    description="Discovery domain Kanban stage mappings (planning-heavy intake domain)",
    stages={
        "Triage": StageMapping(
            team="discovery-planning",
            workflow="discovery-planning-triage",
            default_personas=[
                "orchestrator",
                "ba",
                "architect",
                "pm",
                "qa-planning",
                "SENIOR_DESIGNER_UX",
            ],
            notes="Full planning asset package required before moving to Ready. See Board Rules in kanban.md.",
        ),
        "Ready for Execution": StageMapping(
            team="discovery-execution",
            workflow="handoff-to-builders",
            default_personas=[],
            notes="Placeholder — expand when first cards reach this column.",
        ),
        "In Progress": StageMapping(
            team="execution-builders",
            workflow="implementation-plus-dogfood-validation",
            default_personas=["grok-builder"],
            notes="Non-trivial work must go through mandatory browser dogfood validation.",
        ),
        "Review / Blocked": StageMapping(
            team="review-guild",
            workflow="review-loop",
            default_personas=[],
            notes="Used for cards that need re-planning or cross-team review.",
        ),
        "Done": StageMapping(
            team="",
            workflow="retrospective-capture",
            default_personas=[],
            notes="Archival / retrospective. No active team required.",
        ),
    },
)


# Registry of known domains (easy to extend)
_KNOWN_DOMAINS: Dict[str, DomainKanbanConfig] = {
    "discovery": DISCOVERY_KANBAN,
}


def get_domain_kanban_config(domain: str) -> DomainKanbanConfig:
    """Return the structured Kanban config for a domain.

    Raises KeyError for unknown domains (so callers fail visibly).
    """
    key = domain.strip().lower()
    if key not in _KNOWN_DOMAINS:
        raise KeyError(
            f"No Kanban config for domain '{domain}'. "
            f"Known domains: {', '.join(_KNOWN_DOMAINS.keys())}"
        )
    return _KNOWN_DOMAINS[key]


def get_stage_mapping(domain: str, stage: str) -> StageMapping:
    """Convenience: get the exact StageMapping for a domain + stage name."""
    cfg = get_domain_kanban_config(domain)
    mapping = cfg.get_stage(stage)
    if mapping is None:
        raise KeyError(
            f"Stage '{stage}' not defined for domain '{domain}'. "
            f"Known stages: {cfg.known_stages}"
        )
    return mapping


def list_known_domains() -> List[str]:
    return list(_KNOWN_DOMAINS.keys())


# Future extension points (documented here so intent is clear):
#
# - Add YAML loading:
#     if (yaml_path := HARNESS_ROOT / "context" / f"{domain}-team" / "mgmt" / "stage-map.yaml").exists():
#         return _load_from_yaml(yaml_path)
#
# - Add a small generator that can emit the human stage-map.md from this config.
#
# - Support per-card overrides loaded from Kanban notes or a small overrides file.
