"""
harness/config

Structured configuration objects for the Harem / Kanban system.

These are the machine-readable "config objects" used by orchestrators,
harem-delegate, and other tools that need reliable data instead of
parsing Markdown at runtime.
"""

from .kanban import (
    StageMapping,
    DomainKanbanConfig,
    get_domain_kanban_config,
    get_stage_mapping,
    list_known_domains,
)
