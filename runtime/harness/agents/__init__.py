"""
harness.agents

Public interface for the agent system.

The key new abstraction is `HerderAgent`, which lets the Chat Orchestrator
and kanban swarm treat agents defined in the registry as first-class,
controllable objects.
"""

from .herder_agent import HerderAgent, AgentStatus, AgentMessage, get_swarm_facilitator
from .planning_session import PlanningSession, create_planning_session, run_refinement_think_tank, REFINEMENT_TEAMS
from . import registry

__all__ = [
    "HerderAgent",
    "AgentStatus",
    "AgentMessage",
    "PlanningSession",
    "create_planning_session",
    "run_refinement_think_tank",
    "REFINEMENT_TEAMS",
    "get_swarm_facilitator",
    "registry",
]