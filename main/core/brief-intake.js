"use strict";
/**
 * Brief Intake — the conversational front door for creating a structured brief.
 *
 * The founder describes work in plain language (typed in the CEO chat box, or
 * spoken). This module asks the Hermes CEO to distill that description into the
 * canonical 7-field brief, robustly parses the structured draft out of the
 * reply, and reports which required fields are still missing so the UI can ask
 * natural follow-up questions.
 *
 * It deliberately does NOT create the task. The renderer reviews the draft with
 * the human and then calls the single enforced creation path
 * (`domain_board:create_brief` -> domainBoard.createBrief). That keeps creation
 * deterministic and gated while making intake genuinely conversational — the
 * same `createBrief` + sectional-decomposer pipeline the voice agent uses,
 * finally reachable by typing.
 */
const hermes = require("./hermes");

// Mirror domain-board.missingBriefFields / brief-runs.REQUIRED_FIELDS exactly so
// the conversational gate and the creation gate never disagree.
const REQUIRED_FIELDS = [
  "title",
  "goal",
  "domain",
  "currentRenderedState",
  "problemMismatch",
  "acceptanceCriteria",
  "nextAction",
];
const STRING_FIELDS = [
  "title", "goal", "domain", "currentRenderedState", "problemMismatch",
  "nextAction", "owner", "persona", "reference", "goalId",
];
const LIST_FIELDS = ["acceptanceCriteria", "constraints"];

function text(v) {
  return String(v == null ? "" : v).trim();
}

function list(v) {
  if (Array.isArray(v)) return v.map(text).filter(Boolean);
  return text(v).split(/\r?\n|,/).map(text).filter(Boolean);
}

/** Required brief fields still empty in a draft (same rule as createBrief). */
function missingFields(draft = {}) {
  const missing = [];
  for (const field of REQUIRED_FIELDS) {
    if (field === "acceptanceCriteria") {
      if (!list(draft.acceptanceCriteria).length) missing.push(field);
    } else if (!text(draft[field])) {
      missing.push(field);
    }
  }
  return missing;
}

/** Keep only the known fields we understand, normalized to string/list shape. */
function normalizeDraft(obj = {}) {
  const draft = {};
  for (const field of STRING_FIELDS) if (obj[field] != null) draft[field] = text(obj[field]);
  for (const field of LIST_FIELDS) if (obj[field] != null) draft[field] = list(obj[field]);
  return draft;
}

/** Drop empty values so a merge never clobbers a real value with "". */
function stripEmpty(obj = {}) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (Array.isArray(v)) { if (v.length) out[k] = v; }
    else if (text(v)) out[k] = v;
  }
  return out;
}

/** Parse the first balanced JSON object out of an arbitrary string. */
function firstJsonObject(s) {
  const raw = String(s || "");
  const candidates = [];
  // Prefer fenced ```json ... ``` (or bare ``` ... ```) blocks.
  for (const m of raw.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)) candidates.push(m[1]);
  // Fallback: from the first "{" to the last "}".
  const first = raw.indexOf("{");
  const last = raw.lastIndexOf("}");
  if (first >= 0 && last > first) candidates.push(raw.slice(first, last + 1));
  for (const candidate of candidates) {
    const parsed = tryParseObject(candidate);
    if (parsed) return parsed;
  }
  return null;
}

function tryParseObject(candidate) {
  const t = String(candidate || "").trim();
  if (!t) return null;
  try {
    const direct = JSON.parse(t);
    if (direct && typeof direct === "object") return direct;
  } catch { /* scan for a balanced object below */ }
  const start = t.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === "\"") inStr = false;
    } else if (ch === "\"") {
      inStr = true;
    } else if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        try { return JSON.parse(t.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

/**
 * Pull a normalized brief draft out of an LLM reply. Tolerates fenced blocks,
 * bare objects embedded in prose, and a `{ "brief": {...} }` wrapper. Returns
 * a normalized draft (known keys only) or null when nothing parseable is found.
 */
function parseBriefDraft(reply) {
  let obj = firstJsonObject(reply);
  if (!obj || typeof obj !== "object") return null;
  if (obj.brief && typeof obj.brief === "object" && obj.title == null) obj = obj.brief;
  const draft = normalizeDraft(obj);
  return Object.keys(draft).length ? draft : null;
}

/** The strict extraction prompt sent to the Hermes CEO. */
function buildPrompt(description, known = {}, domainHint = "") {
  const knownClean = stripEmpty(known);
  const knownLines = Object.entries(knownClean)
    .map(([k, v]) => `- ${k}: ${Array.isArray(v) ? v.join("; ") : v}`)
    .join("\n");
  return [
    "You are CEO Studio's brief intake. Convert the founder's description into ONE canonical brief.",
    "Respond with ONLY a JSON object (no prose, no markdown fences) using these keys:",
    "{",
    "  \"title\": string,",
    "  \"goal\": string (the single most important outcome),",
    "  \"domain\": string,",
    "  \"currentRenderedState\": string (what is visibly true right now),",
    "  \"problemMismatch\": string (the gap between intended and current state),",
    "  \"acceptanceCriteria\": string[] (concrete, testable),",
    "  \"nextAction\": string (the immediate next step),",
    "  \"constraints\": string[],",
    "  \"owner\": string,",
    "  \"persona\": string,",
    "  \"reference\": string",
    "}",
    "Infer sensible values from the description. Leave a field as \"\" (or [] for arrays) ONLY when there is genuinely no basis to infer it. Never invent acceptance criteria that contradict the description.",
    domainHint ? `Active domain (use this unless the description clearly implies another): ${domainHint}` : "",
    knownLines ? `Already-confirmed fields (preserve unless the description overrides them):\n${knownLines}` : "",
    "",
    "Founder description:",
    text(description),
  ].filter(Boolean).join("\n");
}

/**
 * Ask the Hermes CEO to draft a brief from a free-form description (plus any
 * already-known fields). Returns:
 *   { ok:true, draft, missing, requiredFields, raw }
 *   { ok:false, reason, draft, missing, requiredFields }   (CEO unavailable)
 *
 * `ask` is injectable for tests; defaults to the live Hermes relay.
 */
async function draftBrief({ description, known = {}, domainHint = "" } = {}, deps = {}) {
  const desc = text(description);
  const knownClean = stripEmpty(known);
  if (!desc && !Object.keys(knownClean).length) {
    return { ok: false, reason: "Describe the brief first.", draft: {}, missing: [...REQUIRED_FIELDS], requiredFields: REQUIRED_FIELDS };
  }
  const ask = deps.ask || hermes.ask;
  let reply = "";
  try {
    const res = await ask(buildPrompt(desc, knownClean, domainHint), { timeoutMs: deps.timeoutMs || 120000 });
    if (res && typeof res === "object") {
      if (res.ok === false) {
        return { ok: false, reason: res.reason || "CEO unavailable", draft: knownClean, missing: missingFields(knownClean), requiredFields: REQUIRED_FIELDS };
      }
      reply = res.reply != null ? String(res.reply) : "";
    } else {
      reply = String(res || "");
    }
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e), draft: knownClean, missing: missingFields(knownClean), requiredFields: REQUIRED_FIELDS };
  }
  const parsed = parseBriefDraft(reply) || {};
  // Parsed values fill the draft; explicitly-confirmed known values win.
  const draft = { ...parsed, ...knownClean };
  if (domainHint && !text(draft.domain)) draft.domain = text(domainHint);
  return { ok: true, draft, missing: missingFields(draft), requiredFields: REQUIRED_FIELDS, raw: reply };
}

module.exports = {
  REQUIRED_FIELDS,
  draftBrief,
  parseBriefDraft,
  missingFields,
  normalizeDraft,
  buildPrompt,
  firstJsonObject,
};
