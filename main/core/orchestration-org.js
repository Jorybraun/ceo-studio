"use strict";
/**
 * Machine-readable orchestration org structure.
 *
 * The registry says which agents and teams exist. This module says which team
 * owns each Kanban lane, which workflow applies, and what default queue routing
 * should look like for briefs, bugs, tasks, and blocked work.
 */
const fs = require("fs");
const path = require("path");
const registry = require("./registry");

const DEFAULT_LANE_POLICIES = {
  triage: {
    lane: "triage",
    team: "discovery-planning",
    workflow: "discovery-planning-triage",
    defaultPersonas: ["planner", "pm", "ba", "architect"],
    queueRole: "intake",
    escalationTarget: "planner",
    guidance: "Normalize raw intake into an enforceable brief or bug before dispatch.",
  },
  bug: {
    lane: "bug",
    team: "self-repair",
    workflow: "self-repair-triage",
    defaultPersonas: ["self-repair-engineer", "architect", "planner"],
    queueRole: "defect_intake",
    escalationTarget: "self-repair-engineer",
    guidance: "Confirm reproduction, diagnose severity, and create or execute the linked repair path before dispatch.",
  },
  planning: {
    lane: "planning",
    team: "discovery-planning",
    workflow: "discovery-planning-triage",
    defaultPersonas: ["planner", "ba", "architect", "pm"],
    queueRole: "decomposition",
    escalationTarget: "planner",
    guidance: "Decompose approved briefs into linked child tasks with acceptance criteria.",
  },
  todo: {
    lane: "todo",
    team: "execution-builders",
    workflow: "handoff-to-builders",
    defaultPersonas: ["builder", "architect"],
    queueRole: "execution_queue",
    escalationTarget: "CEO",
    guidance: "Ready work waits here until assigned to an execution agent.",
  },
  ready: {
    lane: "ready",
    team: "execution-builders",
    workflow: "handoff-to-builders",
    defaultPersonas: ["builder", "architect"],
    queueRole: "dispatchable",
    escalationTarget: "CEO",
    guidance: "Dispatchable work with owner, workspace, and verification contract.",
  },
  running: {
    lane: "running",
    team: "execution-builders",
    workflow: "implementation-plus-dogfood-validation",
    defaultPersonas: ["builder", "architect"],
    queueRole: "active_execution",
    escalationTarget: "specialist",
    guidance: "Active worker execution; evidence must be posted before Done.",
  },
  blocked: {
    lane: "blocked",
    team: "review-guild",
    workflow: "review-loop",
    defaultPersonas: ["planner", "architect", "pm"],
    queueRole: "escalation",
    escalationTarget: "planner",
    guidance: "Analyze blocker, choose escalation target, and split or unblock visibly.",
  },
  scheduled: {
    lane: "scheduled",
    team: "discovery-planning",
    workflow: "scheduled-review",
    defaultPersonas: ["planner", "pm"],
    queueRole: "deferred",
    escalationTarget: "CEO",
    guidance: "Deferred work should have a reason and review date.",
  },
  review: {
    lane: "review",
    team: "review-guild",
    workflow: "review-loop",
    defaultPersonas: ["architect", "pm", "planner"],
    queueRole: "verification",
    escalationTarget: "specialist",
    guidance: "Review output against the acceptance criteria and attached evidence.",
  },
  done: {
    lane: "done",
    team: "",
    workflow: "retrospective-capture",
    defaultPersonas: [],
    queueRole: "archive",
    escalationTarget: "",
    guidance: "Verified and closed work; capture durable learning where useful.",
  },
};

const LANE_ALIASES = {
  "backlog": "triage",
  "ideas": "triage",
  "bugs": "bug",
  "defect": "bug",
  "defects": "bug",
  "issue": "bug",
  "issues": "bug",
  "spec": "planning",
  "specification": "planning",
  "ready-for-execution": "ready",
  "in-progress": "running",
  "in_progress": "running",
  "doing": "running",
  "review-blocked": "blocked",
  "review--blocked": "blocked",
  "review-/-blocked": "blocked",
  "qa": "review",
  "complete": "done",
  "completed": "done",
};

function slug(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(/[^a-z0-9./-]+/g, "")
    .replace(/\/+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLane(status) {
  const key = slug(status || "triage");
  return LANE_ALIASES[key] || (DEFAULT_LANE_POLICIES[key] ? key : "triage");
}

function harnessAgentsJson(projectPath) {
  return registry.writePath(projectPath || null);
}

function configPaths(projectPath) {
  const out = [];
  const env = String(process.env.CEO_AGENTS_CONFIG || "").trim();
  if (env) out.push(env);
  if (projectPath) out.push(path.join(projectPath, "agents.json"));
  out.push(harnessAgentsJson(projectPath));
  const seen = new Set();
  return out.filter((p) => {
    const r = path.resolve(p);
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });
}

function mergePolicy(base, patch = {}) {
  return {
    ...base,
    ...(patch || {}),
    lane: normalizeLane(patch.lane || base.lane),
    defaultPersonas: Array.isArray(patch.defaultPersonas)
      ? patch.defaultPersonas.map(String).filter(Boolean)
      : base.defaultPersonas,
  };
}

function readConfiguredPolicies(projectPath, domain = "All") {
  const policies = {};
  for (const file of configPaths(projectPath)) {
    let data = null;
    try {
      if (fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      data = null;
    }
    const org = data && data.orchestration;
    if (!org || typeof org !== "object") continue;
    const domainKey = String(domain || "All").toLowerCase();
    const domainConfig = (org.domains && (org.domains[domain] || org.domains[domainKey])) || {};
    const lanes = { ...(org.lanes || {}), ...(domainConfig.lanes || {}) };
    for (const [laneName, patch] of Object.entries(lanes)) {
      policies[normalizeLane(laneName)] = patch;
    }
  }
  return policies;
}

function lanePolicies(projectPath, domain = "All") {
  const configured = readConfiguredPolicies(projectPath, domain);
  const out = {};
  for (const [lane, policy] of Object.entries(DEFAULT_LANE_POLICIES)) {
    out[lane] = mergePolicy(policy, configured[lane]);
  }
  for (const [lane, policy] of Object.entries(configured)) {
    if (!out[lane]) out[lane] = mergePolicy({ lane, defaultPersonas: [] }, policy);
  }
  return out;
}

function defaultLaneForKind(kind) {
  const k = slug(kind);
  if (k === "bug" || k === "defect" || k === "issue") return "bug";
  if (k === "brief") return "triage";
  if (k === "child-task" || k === "task") return "todo";
  if (k === "asset") return "review";
  return "triage";
}

function teamMap(reg) {
  return new Map(((reg && reg.teams) || []).map((t) => [t.name, t.members || []]));
}

function agentMap(reg) {
  return new Map(((reg && reg.agents) || []).map((a) => [a.id, a]));
}

function route(projectPath, { domain = "All", status, kind = "task" } = {}) {
  const lane = normalizeLane(status || defaultLaneForKind(kind));
  const policies = lanePolicies(projectPath, domain);
  const policy = policies[lane] || policies.triage;
  const reg = registry.read(projectPath);
  const teams = teamMap(reg);
  const agents = agentMap(reg);
  const memberIds = policy.team ? (teams.get(policy.team) || []) : [];
  const members = memberIds.map((id) => agents.get(id)).filter(Boolean);
  const missingAgents = memberIds.filter((id) => !agents.has(id));
  return {
    ok: true,
    domain,
    lane,
    kind,
    team: policy.team || "",
    workflow: policy.workflow || "",
    defaultPersonas: policy.defaultPersonas || [],
    queueRole: policy.queueRole || "",
    escalationTarget: policy.escalationTarget || "",
    guidance: policy.guidance || "",
    members: members.map((a) => ({
      id: a.id,
      name: a.name || a.id,
      provider: a.provider || "echo",
      persona: a.persona || null,
      enabled: a.enabled !== false,
    })),
    assignee: (members.find((a) => a.enabled !== false) || members[0] || {}).id || "",
    missingTeam: !!policy.team && !teams.has(policy.team),
    missingAgents,
  };
}

function summary(projectPath, { domain = "All" } = {}) {
  const reg = registry.read(projectPath);
  const teams = teamMap(reg);
  const agents = agentMap(reg);
  const policies = lanePolicies(projectPath, domain);
  const lanes = Object.values(policies).map((policy) => {
    const memberIds = policy.team ? (teams.get(policy.team) || []) : [];
    return {
      ...policy,
      missingTeam: !!policy.team && !teams.has(policy.team),
      members: memberIds,
      missingAgents: memberIds.filter((id) => !agents.has(id)),
    };
  });
  return {
    ok: true,
    domain,
    lanes,
    teams: [...teams.entries()].map(([name, members]) => ({ name, members })),
    agents: [...agents.values()].map((a) => ({ id: a.id, name: a.name || a.id, persona: a.persona || null, provider: a.provider || "echo" })),
    issues: lanes.flatMap((lane) => {
      const out = [];
      if (lane.missingTeam) out.push(`Lane ${lane.lane} references missing team ${lane.team}`);
      for (const id of lane.missingAgents || []) out.push(`Lane ${lane.lane} team ${lane.team} references missing agent ${id}`);
      return out;
    }),
  };
}

function routingMarkdown(routeInfo = {}) {
  return [
    "## Orchestration Routing",
    `- Lane: ${routeInfo.lane || "triage"}`,
    `- Queue Role: ${routeInfo.queueRole || "intake"}`,
    `- Team: ${routeInfo.team || "Unassigned"}`,
    `- Workflow: ${routeInfo.workflow || "Unassigned"}`,
    `- Default Personas: ${(routeInfo.defaultPersonas || []).join(", ") || "Unassigned"}`,
    `- Suggested Assignee: ${routeInfo.assignee || "Unassigned"}`,
    `- Escalation Target: ${routeInfo.escalationTarget || "CEO"}`,
    `- Guidance: ${routeInfo.guidance || "Follow the task body and board comments."}`,
  ].join("\n");
}

module.exports = {
  DEFAULT_LANE_POLICIES,
  normalizeLane,
  defaultLaneForKind,
  lanePolicies,
  route,
  summary,
  routingMarkdown,
};
