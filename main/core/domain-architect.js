"use strict";
/**
 * Domain Architect workflow.
 *
 * This is the app-owned creation agent state machine. It is deliberately
 * conservative: interview first, write only after explicit confirmation.
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brainDir, slugify } = require("./paths");

const FIELDS = [
  {
    key: "name",
    label: "Name",
    question: "What would you like to call this domain?",
  },
  {
    key: "purpose",
    label: "Purpose / ownership",
    question: "What does this domain own or control? What is it responsible for?",
  },
  {
    key: "overarchingGoal",
    label: "Long-term goal",
    question: "What is the long-term outcome or success state this domain should help achieve?",
  },
  {
    key: "boundaries",
    label: "Boundaries",
    question: "What should not be part of this domain? Are there obvious overlaps with existing domains?",
    list: true,
  },
  {
    key: "features",
    label: "Initial features",
    question: "What are the main things this domain needs to be able to do?",
    list: true,
  },
  {
    key: "relationships",
    label: "Relationships",
    question: "What other domains, systems, teams, or boards does this depend on or connect to?",
    list: true,
  },
  {
    key: "coreAgents",
    label: "Core agents",
    question: "Which agents or personas should be part of this domain team, if any?",
    list: true,
  },
];

function sessionsDir(projectSlug) {
  const dir = path.join(brainDir(projectSlug), "domain-architect-sessions");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function sessionPath(projectSlug, id) {
  return path.join(sessionsDir(projectSlug), `${id}.json`);
}

function listify(value) {
  if (Array.isArray(value)) return value.map((v) => String(v || "").trim()).filter(Boolean);
  return String(value == null ? "" : value)
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function text(value) {
  return String(value == null ? "" : value).trim();
}

function cleanDraft(seed = {}) {
  const name = text(seed.name);
  return {
    name,
    purpose: text(seed.purpose),
    overarchingGoal: text(seed.overarchingGoal || seed.goal),
    boundaries: listify(seed.boundaries || seed.responsibilities),
    features: listify(seed.features || seed.initialFeatures || seed.activeEpics),
    relationships: listify(seed.relationships || seed.interfaces),
    coreAgents: listify(seed.coreAgents),
    ownerPersona: text(seed.ownerPersona || "domain-architect"),
    kanbanBoard: text(seed.kanbanBoard),
    relativePath: text(seed.relativePath || (name ? path.join("domains", slugify(name)) : "")),
  };
}

function missingFields(draft = {}) {
  return FIELDS
    .filter((field) => {
      const value = draft[field.key];
      return field.list ? !listify(value).length : !text(value);
    })
    .map((field) => field.key);
}

function nextField(draft = {}) {
  const missing = new Set(missingFields(draft));
  return FIELDS.find((field) => missing.has(field.key)) || null;
}

function outline(session) {
  const draft = session.draft || {};
  return FIELDS.map((field) => {
    const value = draft[field.key];
    const populated = field.list ? listify(value).length > 0 : !!text(value);
    return {
      key: field.key,
      label: field.label,
      complete: populated,
      value: field.list ? listify(value) : text(value),
    };
  });
}

function save(projectSlug, session) {
  fs.writeFileSync(sessionPath(projectSlug, session.id), JSON.stringify(session, null, 2), "utf-8");
  return hydrate(session);
}

function hydrate(session) {
  const field = nextField(session.draft);
  return {
    ...session,
    missing: missingFields(session.draft),
    currentQuestion: field ? field.question : "Review the definition. If this captures it, confirm creation.",
    currentField: field ? field.key : null,
    outline: outline(session),
    readyToConfirm: !field,
  };
}

function get(projectSlug, id) {
  try {
    return hydrate(JSON.parse(fs.readFileSync(sessionPath(projectSlug, id), "utf-8")));
  } catch {
    return null;
  }
}

function start(projectSlug, seed = {}) {
  const now = new Date().toISOString();
  const draft = cleanDraft(seed);
  const id = `domain-architect-${now.replace(/[^0-9]/g, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  return save(projectSlug, {
    id,
    status: "interviewing",
    createdAt: now,
    updatedAt: now,
    draft,
    transcript: [],
    capturedEntities: [],
  });
}

function inferEntities(answer) {
  const value = text(answer);
  const out = [];
  const patterns = [
    [/subdomain|sub-domain/i, "subdomain-candidate"],
    [/meeting|follow.?up|session/i, "meeting-agenda-candidate"],
    [/feature|capabilit/i, "feature-candidate"],
    [/requirement|constraint/i, "requirement-candidate"],
    [/agent|persona/i, "agent-persona-candidate"],
  ];
  for (const [pattern, type] of patterns) {
    if (pattern.test(value)) out.push({ type, text: value.slice(0, 240), capturedAt: new Date().toISOString() });
  }
  return out;
}

function answer(projectSlug, id, answerText, fieldKey = null) {
  const session = get(projectSlug, id);
  if (!session) return { ok: false, reason: "Domain Architect session not found" };
  const field = FIELDS.find((f) => f.key === (fieldKey || session.currentField));
  if (!field) return { ok: false, reason: "No active field to answer" };
  const value = text(answerText);
  if (!value) return { ok: false, reason: "answer required" };
  const nextDraft = { ...session.draft };
  nextDraft[field.key] = field.list ? listify(value) : value;
  if (field.key === "name" && !nextDraft.relativePath) nextDraft.relativePath = path.join("domains", slugify(value));
  const now = new Date().toISOString();
  const updated = {
    ...session,
    status: "interviewing",
    updatedAt: now,
    draft: nextDraft,
    transcript: [
      ...(session.transcript || []),
      { at: now, field: field.key, question: field.question, answer: value },
    ],
    capturedEntities: [
      ...(session.capturedEntities || []),
      ...inferEntities(value),
    ],
  };
  return { ok: true, session: save(projectSlug, updated) };
}

function updateDraft(projectSlug, id, patch = {}) {
  const session = get(projectSlug, id);
  if (!session) return { ok: false, reason: "Domain Architect session not found" };
  const draft = cleanDraft({ ...session.draft, ...patch });
  const updated = { ...session, draft, updatedAt: new Date().toISOString() };
  return { ok: true, session: save(projectSlug, updated) };
}

function confirmationPackage(projectSlug, id) {
  const session = get(projectSlug, id);
  if (!session) return { ok: false, reason: "Domain Architect session not found" };
  return {
    ok: true,
    session,
    domainPackage: {
      ...session.draft,
      responsibilities: session.draft.boundaries,
      activeEpics: session.draft.features,
      sourceType: "domain-architect-interview",
      createScaffold: true,
      createHandoff: true,
      userConfirmed: true,
      agendaItems: (session.capturedEntities || []).map((entity) => ({
        type: entity.type.includes("meeting") ? "meeting" : entity.type.includes("subdomain") ? "scoping decision" : "feature",
        title: `Follow up on ${entity.type.replace(/-/g, " ")}`,
        source: session.id,
        body: entity.text,
      })),
    },
  };
}

module.exports = {
  FIELDS,
  start,
  get,
  answer,
  updateDraft,
  confirmationPackage,
  missingFields,
  outline,
};
