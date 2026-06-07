"use strict";
/**
 * Project standups are the lightweight cadence layer for autonomous projects.
 * They schedule a recurring A2A meeting and capture a domain-owned Agenda Item;
 * they do not dispatch paid workers or silently promote proposals into Kanban.
 */
const fs = require("fs");
const path = require("path");

const meetings = require("./meetings");
const domains = require("./domains");
const goals = require("./goals");
const briefRuns = require("./brief-runs");
const meetingSynthesis = require("./meeting-synthesis");
const notifications = require("./notifications");

function standupsDir(projectPath) {
  return path.join(projectPath || process.cwd(), "brain", "standups");
}

function policyPath(projectPath) {
  return path.join(standupsDir(projectPath), "policies.json");
}

function executionsPath(projectPath) {
  return path.join(standupsDir(projectPath), "executions.json");
}

function readJson(file, fallback) {
  try {
    if (!fs.existsSync(file)) return fallback;
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf-8");
}

function readPolicies(projectPath) {
  const data = readJson(policyPath(projectPath), { policies: [] });
  return { policies: Array.isArray(data.policies) ? data.policies : [] };
}

function savePolicies(projectPath, policies) {
  writeJson(policyPath(projectPath), { policies });
  return { ok: true, policies };
}

function readExecutions(projectPath) {
  const data = readJson(executionsPath(projectPath), { executions: [] });
  return { executions: Array.isArray(data.executions) ? data.executions : [] };
}

function saveExecutions(projectPath, executions) {
  const sorted = [...executions]
    .sort((a, b) => String(b.scheduledFor || b.startedAt || "").localeCompare(String(a.scheduledFor || a.startedAt || "")))
    .slice(0, 180);
  writeJson(executionsPath(projectPath), { executions: sorted });
  return sorted;
}

function upsertExecution(projectPath, execution) {
  const current = readExecutions(projectPath).executions;
  const previous = current.find((item) => item.id === execution.id);
  const next = {
    ...previous,
    ...execution,
    createdAt: previous?.createdAt || execution.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  saveExecutions(projectPath, current.filter((item) => item.id !== next.id).concat(next));
  return next;
}

function localDateKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function nextLocalIso(timeLocal = "09:00", now = new Date()) {
  const match = String(timeLocal || "09:00").match(/^(\d{1,2}):(\d{2})$/);
  const hour = match ? Math.min(23, Math.max(0, Number(match[1]))) : 9;
  const minute = match ? Math.min(59, Math.max(0, Number(match[2]))) : 0;
  const next = new Date(now);
  next.setHours(hour, minute, 0, 0);
  if (next.getTime() <= now.getTime()) next.setDate(next.getDate() + 1);
  return next.toISOString();
}

function timezoneName() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "local";
  } catch {
    return "local";
  }
}

function selectAgendaDomain({ projectSlug, projectPath, requestedDomain }) {
  const requested = String(requestedDomain || "").trim();
  if (requested && requested !== "All") {
    const found = domains.getDomain(projectSlug, requested, { projectPath });
    if (found) return found;
  }
  const all = domains.getAllDomains(projectSlug, { projectPath });
  const preferred = ["project-ops", "ops", "operations", "planning", "discovery", "domain-lifecycle"];
  for (const slug of preferred) {
    const found = all.find((d) => d.slug === slug);
    if (found) return found;
  }
  return all[0] || null;
}

function selectRoster(projectPath, requestedTeam, requestedMembers) {
  if (!fs.existsSync(path.join(projectPath || "", "runtime", "harness", "agents"))) {
    return { team: "", members: String(requestedMembers || "planner,pm,ba,architect,agenda-agent").trim() };
  }
  const opts = meetings.options(projectPath);
  const teams = Array.isArray(opts.teams) ? opts.teams : [];
  const teamNames = new Set(teams.map((t) => t.name));
  if (requestedTeam && teamNames.has(requestedTeam)) return { team: requestedTeam, members: "" };
  for (const team of ["product-discovery", "discovery-planning", "planning", "self-repair"]) {
    if (teamNames.has(team)) return { team, members: "" };
  }
  const members = String(requestedMembers || "planner,pm,ba,architect,agenda-agent").trim();
  return { team: "", members };
}

function policyId(domainName) {
  return `standup-${domains.domainSlug(domainName || "project")}`;
}

function standupTitle(projectName, domainName) {
  const scope = domainName && domainName !== "All" ? domainName : projectName || "Project";
  return `Daily standup - ${scope}`;
}

function standupAgenda({ projectName, domainName, board }) {
  const scope = domainName && domainName !== "All" ? domainName : projectName || "this project";
  return [
    `Run the morning standup for ${scope}.`,
    "",
    "Agenda:",
    "1. Review active goals, board state, and work completed since the last standup.",
    "2. Identify blocked or stale work and decide whether it needs planner, specialist, CEO, or human escalation.",
    "3. Propose today's concrete next actions as Agenda Items with owner, priority, and verification expectations.",
    "4. Call out any decision that needs the human; do not bury it in transcript text.",
    "",
    `Board of record: ${board || "project board"}.`,
    "Policy: proposal-only. Do not dispatch paid workers or promote work to Kanban unless explicitly approved by the human/autonomy policy.",
  ].join("\n");
}

function standupCriteria() {
  return "A concise standup summary, blocker list, human-decision requests, and proposal-only Agenda Items for today's work.";
}

function agendaItemBody({ projectName, domainName, board, timeLocal, timezone, meetingId }) {
  return [
    "Daily autonomous standup cadence.",
    "",
    `- Project: ${projectName || "Project"}`,
    `- Domain scope: ${domainName || "All"}`,
    `- Board: ${board || "project board"}`,
    `- Time: ${timeLocal || "09:00"} ${timezone || "local"}`,
    `- Scheduled meeting id: ${meetingId}`,
    "",
    "Expected standup output:",
    "- Completed work summary",
    "- Blockers requiring escalation",
    "- Proposed Agenda Items for today",
    "- Human decisions requested, if any",
    "",
    "Guardrail: this is an agenda proposal, not automatic permission to spend or dispatch workers.",
  ].join("\n");
}

function normalizePolicy(existing, info) {
  const now = new Date().toISOString();
  const domainName = String(info.domain || info.currentDomain || existing?.domain || "All").trim() || "All";
  const id = String(info.id || existing?.id || policyId(domainName));
  return {
    id,
    enabled: info.enabled !== false,
    projectName: String(info.projectName || existing?.projectName || "Project"),
    domain: domainName,
    agendaDomain: String(info.agendaDomain || existing?.agendaDomain || ""),
    board: String(info.board || existing?.board || "ceo-studio"),
    timeLocal: String(info.timeLocal || existing?.timeLocal || "09:00"),
    timezone: String(info.timezone || existing?.timezone || timezoneName()),
    recurrence: "daily",
    team: String(info.team || existing?.team || ""),
    members: String(info.members || existing?.members || ""),
    meetingId: String(info.meetingId || existing?.meetingId || id),
    lastAgendaDate: existing?.lastAgendaDate || "",
    lastAgendaItemId: existing?.lastAgendaItemId || "",
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
}

function configure({ projectSlug, projectPath, projectName, currentDomain, ...info } = {}) {
  if (!projectSlug || !projectPath) return { ok: false, reason: "projectSlug and projectPath required" };
  const data = readPolicies(projectPath);
  const domainName = String(info.domain || currentDomain || "All").trim() || "All";
  const id = String(info.id || policyId(domainName));
  const existing = data.policies.find((p) => p.id === id);
  const agendaDomain = selectAgendaDomain({ projectSlug, projectPath, requestedDomain: domainName });
  const roster = selectRoster(projectPath, info.team || existing?.team, info.members || existing?.members);
  const policy = normalizePolicy(existing, {
    ...info,
    id,
    projectName: projectName || info.projectName,
    domain: domainName,
    currentDomain,
    agendaDomain: agendaDomain ? agendaDomain.slug : "",
    team: roster.team,
    members: roster.members,
  });

  const scheduledFor = nextLocalIso(policy.timeLocal);
  const scheduled = meetings.scheduleMeeting({
    projectPath,
    meeting: {
      id: policy.meetingId,
      title: standupTitle(policy.projectName, policy.domain),
      domain: agendaDomain ? agendaDomain.slug : policy.domain,
      scheduledFor,
      recurrence: "daily",
      agenda: standupAgenda({ projectName: policy.projectName, domainName: policy.domain, board: policy.board }),
      criteria: standupCriteria(),
      team: policy.team,
      members: policy.members,
      allowPaid: false,
      room: `standup-${domains.domainSlug(policy.projectName || policy.domain || "project")}`,
      roomPrefix: `standup-${domains.domainSlug(policy.projectName || policy.domain || "project")}`,
    },
  });
  if (!scheduled.ok) return scheduled;

  let agendaResult = { ok: false, reason: "No domain available for agenda item" };
  const today = localDateKey();
  if (agendaDomain && policy.lastAgendaDate !== today) {
    agendaResult = domains.createAgendaItem({
      projectSlug,
      projectPath,
      domain: agendaDomain.slug,
      item: {
        id: `${policy.id}-${today}`,
        title: `${standupTitle(policy.projectName, policy.domain)} agenda`,
        type: "meeting",
        status: "proposed",
        priority: "high",
        source: `standup-policy:${policy.id}`,
        humanAttention: true,
        participants: policy.team ? [policy.team] : policy.members.split(",").map((m) => m.trim()).filter(Boolean),
        expectedOutcome: standupCriteria(),
        body: agendaItemBody({
          projectName: policy.projectName,
          domainName: policy.domain,
          board: policy.board,
          timeLocal: policy.timeLocal,
          timezone: policy.timezone,
          meetingId: policy.meetingId,
        }),
      },
    });
    if (agendaResult.ok) {
      policy.lastAgendaDate = today;
      policy.lastAgendaItemId = agendaResult.agendaItem.id;
    }
  }

  const nextPolicies = data.policies.filter((p) => p.id !== policy.id).concat(policy);
  savePolicies(projectPath, nextPolicies);
  return {
    ok: true,
    policy,
    meeting: scheduled.meeting,
    agendaDomain: agendaDomain ? { slug: agendaDomain.slug, name: agendaDomain.name } : null,
    agenda: agendaResult,
  };
}

function status({ projectPath } = {}) {
  if (!projectPath) return { ok: false, reason: "projectPath required" };
  const policies = readPolicies(projectPath).policies;
  const scheduled = meetings.listScheduled(projectPath).meetings;
  const executions = readExecutions(projectPath).executions;
  const now = Date.now();
  const enabledMeetingIds = new Set(policies.filter((policy) => policy.enabled).map((policy) => policy.meetingId));
  const due = scheduled.filter((meeting) =>
    enabledMeetingIds.has(meeting.id)
    && meeting.status === "scheduled"
    && Number.isFinite(new Date(meeting.scheduledFor).getTime())
    && new Date(meeting.scheduledFor).getTime() <= now);
  return {
    ok: true,
    policies,
    scheduled,
    executions,
    due: due.length,
    pendingReview: executions.filter((execution) => execution.status === "review_pending").length,
  };
}

function occurrenceId(meeting) {
  return `${meeting.id}:${meeting.scheduledFor}`;
}

function goalsForPolicy(projectSlug, policy, now = new Date(), goalsApi = goals) {
  if (!projectSlug) return [];
  const today = localDateKey(now);
  return goalsApi.all(projectSlug, {
    layer: "daily",
    status: "active",
    domain: policy.domain || "All",
  }).filter((goal) =>
    (!goal.horizonStart || goal.horizonStart <= today)
    && (!goal.horizonEnd || goal.horizonEnd >= today));
}

function briefRefsForGoals(projectSlug, goalList, briefRunsApi = briefRuns) {
  const refs = [];
  const seen = new Set();
  for (const goal of goalList) {
    for (const link of goal.links || []) {
      const board = String(link.board || "").trim();
      const taskId = String(link.workId || "").trim();
      if (!board || !taskId || !["brief", "task"].includes(link.workKind)) continue;
      const key = `${board}:${taskId}`;
      if (seen.has(key) || !briefRunsApi.read(projectSlug, board, taskId)) continue;
      seen.add(key);
      refs.push({ board, taskId, runId: key, goalId: goal.id });
    }
  }
  return refs;
}

function goalContext(goalList) {
  if (!goalList.length) return "\n\nDaily goal context:\n- No active daily goals are recorded for this scope.";
  return [
    "",
    "",
    "Daily goal context:",
    ...goalList.map((goal) => {
      const criteria = (goal.successCriteria || []).slice(0, 3).join("; ");
      return `- ${goal.id}: ${goal.title}${goal.outcome ? ` — ${goal.outcome}` : ""}${criteria ? ` (success: ${criteria})` : ""}`;
    }),
    "",
    "Use these goals to prioritize discussion. Propose changes only; do not create or dispatch work.",
  ].join("\n");
}

function linkExecutionToBriefs(projectSlug, execution, briefRunsApi = briefRuns) {
  for (const ref of execution.briefRefs || []) {
    briefRunsApi.update(projectSlug, ref.board, ref.taskId, {
      meeting: {
        id: execution.id,
        scheduleId: execution.meetingId,
        title: execution.title,
        room: execution.room,
        status: execution.status === "review_pending" ? "done" : "running",
        scheduledFor: execution.scheduledFor,
        policyId: execution.policyId,
      },
      eventType: "standup_occurrence_linked",
      actor: "autonomy-runner",
      summary: `${execution.title} (${execution.room})`,
    });
  }
}

function runDue({
  projectSlug,
  projectPath,
  now = new Date(),
  dryRun = false,
  limit = 2,
  services = {},
} = {}) {
  if (!projectPath) return { ok: false, reason: "projectPath required" };
  const meetingApi = services.meetings || meetings;
  const goalsApi = services.goals || goals;
  const briefRunsApi = services.briefRuns || briefRuns;
  const policies = readPolicies(projectPath).policies.filter((policy) => policy.enabled);
  const policyByMeeting = new Map(policies.map((policy) => [policy.meetingId, policy]));
  const activeIds = new Set(policyByMeeting.keys());
  const executions = readExecutions(projectPath).executions;
  const claimed = new Set(executions
    .filter((execution) => ["starting", "started", "review_pending", "completed"].includes(execution.status))
    .map((execution) => execution.id));
  const due = meetingApi.listScheduled(projectPath).meetings.filter((m) => {
    const t = new Date(m.scheduledFor).getTime();
    return activeIds.has(m.id)
      && m.status === "scheduled"
      && !Number.isNaN(t)
      && t <= now.getTime()
      && !claimed.has(occurrenceId(m));
  }).slice(0, Math.max(1, Number(limit) || 2));
  const candidates = due.map((meeting) => ({
    id: occurrenceId(meeting),
    meetingId: meeting.id,
    title: meeting.title,
    scheduledFor: meeting.scheduledFor,
    policyId: policyByMeeting.get(meeting.id)?.id || "",
  }));
  if (dryRun) return { ok: true, dryRun: true, due: due.length, candidates, started: [] };

  const started = [];
  for (const meeting of due) {
    const policy = policyByMeeting.get(meeting.id);
    const goalList = goalsForPolicy(projectSlug, policy, now, goalsApi);
    const briefRefs = briefRefsForGoals(projectSlug, goalList, briefRunsApi);
    const id = occurrenceId(meeting);
    const base = upsertExecution(projectPath, {
      id,
      policyId: policy.id,
      meetingId: meeting.id,
      title: meeting.title,
      domain: policy.domain,
      board: policy.board,
      scheduledFor: meeting.scheduledFor,
      status: "starting",
      allowPaid: false,
      goalIds: goalList.map((goal) => goal.id),
      goals: goalList.map((goal) => ({
        id: goal.id,
        title: goal.title,
        outcome: goal.outcome,
        successCriteria: goal.successCriteria || [],
      })),
      briefRefs,
      startedBy: "autonomy-runner",
    });
    let result;
    try {
      result = meetingApi.startScheduled({
        projectPath,
        id: meeting.id,
        agendaAppend: goalContext(goalList),
      });
    } catch (error) {
      result = { ok: false, uncertain: true, reason: String(error && error.message || error) };
    }
    const execution = upsertExecution(projectPath, {
      ...base,
      status: result && result.ok ? "started" : (result && result.uncertain ? "uncertain" : "failed"),
      room: result && result.room || "",
      startedAt: result && result.ok ? new Date().toISOString() : "",
      failure: result && !result.ok ? result.reason : "",
    });
    if (result && result.ok) {
      for (const goal of goalList) {
        goalsApi.linkWork(projectSlug, {
          goalId: goal.id,
          workKind: "meeting",
          workId: execution.id,
          board: policy.board,
          title: execution.title,
          relationship: "reviewed_in",
          source: { system: "standup-runner", actor: "autonomy-runner" },
        });
      }
      linkExecutionToBriefs(projectSlug, execution, briefRunsApi);
    }
    started.push({ ...result, execution });
  }
  return { ok: started.every((item) => item && item.ok), dryRun: false, due: due.length, candidates, started };
}

function reconcile({ projectSlug, projectPath, dryRun = false, services = {} } = {}) {
  if (!projectPath) return { ok: false, reason: "projectPath required" };
  const meetingApi = services.meetings || meetings;
  const briefRunsApi = services.briefRuns || briefRuns;
  const synthesisApi = services.meetingSynthesis || meetingSynthesis;
  const executions = readExecutions(projectPath).executions;
  const active = executions.filter((execution) => execution.status === "started" && execution.room);
  const completed = [];
  const reviewed = [];
  for (const execution of active) {
    const roomState = meetingApi.room({ projectPath, room: execution.room });
    if (!roomState || !roomState.ok || !roomState.requirements) continue;
    const requirementsPath = path.relative(
      projectPath,
      path.join(meetingApi.roomDir(projectPath, execution.room), "requirements.md"),
    );
    const built = synthesisApi.build({
      meeting: {
        id: execution.id,
        room: execution.room,
        title: execution.title,
        requirementsPath,
      },
      requirements: roomState.requirements,
    });
    if (!built.ok) continue;
    if (dryRun) {
      completed.push({ executionId: execution.id, room: execution.room, synthesis: built.synthesis, dryRun: true });
      continue;
    }
    const next = upsertExecution(projectPath, {
      ...execution,
      status: "review_pending",
      completedAt: new Date().toISOString(),
      requirementsPath,
      synthesis: built.synthesis,
    });
    const linked = [];
    for (const ref of next.briefRefs || []) {
      const saved = briefRunsApi.upsertMeetingSynthesis(projectSlug, ref.board, ref.taskId, built.synthesis);
      briefRunsApi.update(projectSlug, ref.board, ref.taskId, {
        meeting: {
          id: next.id,
          scheduleId: next.meetingId,
          title: next.title,
          room: next.room,
          status: "done",
          scheduledFor: next.scheduledFor,
          requirementsPath,
          policyId: next.policyId,
        },
        eventType: "standup_synthesis_ready",
        actor: "autonomy-runner",
        summary: `${next.title}: ${(built.synthesis.proposals || []).length} proposal(s) require review`,
      });
      linked.push({ ...ref, ok: !!(saved && saved.ok) });
    }
    completed.push({ executionId: next.id, room: next.room, synthesis: built.synthesis, linked });
  }

  for (const execution of executions.filter((item) =>
    item.status === "review_pending" && (item.briefRefs || []).length)) {
    const linked = (execution.briefRefs || []).map((ref) => {
      const run = briefRunsApi.read(projectSlug, ref.board, ref.taskId);
      const synthesis = (run?.meetingSyntheses || []).find((item) => item.id === execution.synthesis?.id);
      return {
        ...ref,
        found: !!synthesis,
        pending: (synthesis?.proposals || []).filter((proposal) => proposal.status === "pending").length,
        synthesis,
      };
    });
    if (!linked.length || linked.some((item) => !item.found)) continue;
    const pending = linked.reduce((total, item) => total + item.pending, 0);
    if (dryRun) {
      reviewed.push({ executionId: execution.id, pending, dryRun: true });
      continue;
    }
    const representative = linked[0].synthesis;
    const next = upsertExecution(projectPath, {
      ...execution,
      status: pending ? "review_pending" : "completed",
      reviewedAt: pending ? execution.reviewedAt || "" : new Date().toISOString(),
      synthesis: representative || execution.synthesis,
      linkedReview: linked.map(({ board, taskId, runId, goalId, pending: count }) => ({
        board,
        taskId,
        runId,
        goalId,
        pending: count,
      })),
    });
    reviewed.push({ executionId: next.id, pending, status: next.status });
  }
  return {
    ok: true,
    dryRun: !!dryRun,
    checked: active.length,
    completed,
    reviewed,
  };
}

function reviewProposal({
  projectSlug,
  projectPath,
  executionId,
  proposalId,
  action,
  humanApproved = false,
  reviewedBy = "human",
  services = {},
} = {}) {
  if (!projectSlug || !projectPath) return { ok: false, reason: "projectSlug and projectPath required" };
  const domainApi = services.domains || domains;
  const notificationApi = services.notifications || notifications;
  const executions = readExecutions(projectPath).executions;
  const execution = executions.find((item) => item.id === executionId);
  const proposal = (execution?.synthesis?.proposals || []).find((item) => item.id === proposalId);
  if (!execution || !proposal) return { ok: false, reason: "standup proposal not found" };
  if (proposal.status !== "pending") return { ok: true, unchanged: true, execution, proposal };
  if (action !== "approve" && action !== "reject") return { ok: false, reason: "action must be approve or reject" };
  if (action === "approve" && humanApproved !== true) return { ok: false, reason: "explicit human approval required" };

  let materialized = { ok: true, kind: proposal.type, local: true };
  if (action === "approve" && proposal.type === "agenda") {
    const policy = readPolicies(projectPath).policies.find((item) => item.id === execution.policyId);
    const target = selectAgendaDomain({
      projectSlug,
      projectPath,
      requestedDomain: policy?.agendaDomain || execution.domain,
    });
    if (!target) return { ok: false, reason: "No domain is available for the approved Agenda Item" };
    materialized = domainApi.createAgendaItem({
      projectSlug,
      projectPath,
      domain: target.slug,
      item: {
        id: proposal.id.replace(/[^a-zA-Z0-9._-]+/g, "-"),
        title: proposal.title,
        body: proposal.body,
        type: "meeting",
        status: "approved",
        priority: "high",
        source: `standup-execution:${execution.id}`,
        humanAttention: false,
        expectedOutcome: proposal.body,
      },
    });
    if (!materialized.ok) return materialized;
    materialized = { ...materialized, kind: "agenda" };
  } else if (action === "approve" && proposal.type === "blocker") {
    materialized = notificationApi.create(projectSlug, {
      type: "human_escalation",
      severity: "high",
      title: proposal.title || "Standup blocker",
      body: proposal.body,
      actionLabel: "Open standup",
      board: execution.board,
      reason: `Raised by ${execution.title}`,
      decisionId: proposal.id,
      dedupeKey: `standup-blocker:${execution.id}:${proposal.id}`,
      metadata: {
        room: execution.room,
        executionId: execution.id,
        policyId: execution.policyId,
      },
    });
    if (!materialized.ok) return materialized;
    materialized = { ...materialized, kind: "blocker" };
  }

  const now = new Date().toISOString();
  const proposals = execution.synthesis.proposals.map((item) => item.id === proposal.id
    ? {
      ...item,
      status: action === "reject" ? "rejected" : "materialized",
      reviewedAt: now,
      reviewedBy,
      result: action === "reject" ? { ok: true, action: "rejected" } : { ok: true, kind: proposal.type },
    }
    : item);
  const pending = proposals.filter((item) => item.status === "pending").length;
  const next = upsertExecution(projectPath, {
    ...execution,
    status: pending ? "review_pending" : "completed",
    reviewedAt: pending ? execution.reviewedAt || "" : now,
    synthesis: {
      ...execution.synthesis,
      status: pending ? "pending_review" : "reviewed",
      proposals,
      updatedAt: now,
    },
  });
  return {
    ok: true,
    action,
    materialized: action === "approve" ? materialized : null,
    execution: next,
    proposal: proposals.find((item) => item.id === proposal.id),
  };
}

module.exports = {
  configure,
  status,
  runDue,
  reconcile,
  reviewProposal,
  nextLocalIso,
  localDateKey,
  selectAgendaDomain,
  readExecutions,
  executionsPath,
};
