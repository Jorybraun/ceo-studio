"use strict";
/**
 * Deterministic post-meeting synthesis for Brief Runs.
 *
 * The meeting engine already writes a durable requirements.md. This module
 * turns that output into reviewable proposals only; it never changes Kanban,
 * domain artifacts, or Brief Run decisions by itself.
 */
const crypto = require("crypto");

const PROPOSAL_TYPES = ["decision", "agenda", "blocker", "evidence", "completion"];

function text(value) {
  return String(value == null ? "" : value).trim();
}

function hash(value, length = 12) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex").slice(0, length);
}

function cleanLine(value) {
  return text(value)
    .replace(/^[-*+]\s+(?:\[[ xX-]\]\s*)?/, "")
    .replace(/^\d+[.)]\s+/, "")
    .replace(/^>\s*/, "")
    .trim();
}

function parseSections(markdown) {
  const source = String(markdown || "");
  const headings = [];
  const re = /^(#{1,4})\s+(.+)$/gm;
  let match;
  while ((match = re.exec(source)) !== null) {
    headings.push({
      title: cleanLine(match[2]),
      bodyStart: re.lastIndex,
      start: match.index,
    });
  }
  if (!headings.length) return [{ title: "Meeting synthesis", body: source }];
  return headings.map((heading, index) => ({
    title: heading.title,
    body: source.slice(
      heading.bodyStart,
      index + 1 < headings.length ? headings[index + 1].start : source.length,
    ).trim(),
  }));
}

function proposalType(heading, line) {
  const haystack = `${heading} ${line}`.toLowerCase();
  if (/\b(decision|decided|decision record|approved direction)\b/.test(haystack)) return "decision";
  if (/\b(blocker|blocked|blocking|needs escalation|human decision needed)\b/.test(haystack)) return "blocker";
  if (/\b(evidence|proof|validation result|verified|test result)\b/.test(haystack)) return "evidence";
  if (/\b(completed work|completion|delivered|finished|done)\b/.test(haystack)) return "completion";
  if (/\b(requirements?|open questions?|next actions?|action items?|follow[- ]?ups?|agenda|proposals?|risks?)\b/.test(haystack)) return "agenda";
  return null;
}

function proposalTitle(type, line) {
  const cleaned = cleanLine(line)
    .replace(/^(decision|decided|blocker|blocked|evidence|proof|completed|completion|done|agenda|next actions?|action items?|follow[- ]?ups?|requirements?|open questions?)\s*:\s*/i, "")
    .trim();
  const fallback = {
    decision: "Meeting decision",
    agenda: "Meeting follow-up",
    blocker: "Meeting blocker",
    evidence: "Meeting evidence",
    completion: "Completed work",
  }[type];
  return (cleaned || fallback).slice(0, 120);
}

function bodyLines(sectionBody) {
  const lines = String(sectionBody || "").split(/\r?\n/);
  const rows = [];
  for (const raw of lines) {
    const trimmed = text(raw);
    if (!trimmed || /^#{1,6}\s+/.test(trimmed) || /^\*\*good outcome:\*\*/i.test(trimmed)) continue;
    const structured = /^[-*+]\s+|^\d+[.)]\s+|^(decision|decided|blocker|blocked|evidence|proof|completed|completion|done|agenda|next actions?|action items?|follow[- ]?ups?|requirements?|open questions?)\s*:/i.test(trimmed);
    if (structured) rows.push(cleanLine(trimmed));
  }
  if (rows.length) return rows;
  const fallback = text(sectionBody).replace(/\s+/g, " ");
  return fallback ? [fallback.slice(0, 600)] : [];
}

function proposal({ type, body, meeting, sourceHash }) {
  const normalizedBody = cleanLine(body);
  const sourceId = text(meeting.id || meeting.room || "meeting");
  const id = `meeting-proposal:${type}:${hash(`${sourceId}\n${normalizedBody.toLowerCase()}`)}`;
  return {
    id,
    type,
    title: proposalTitle(type, normalizedBody),
    body: normalizedBody,
    status: "pending",
    humanAttention: true,
    source: {
      system: "meeting-synthesis",
      meetingId: text(meeting.id),
      room: text(meeting.room),
      requirementsPath: text(meeting.requirementsPath),
      sourceHash,
    },
    createdAt: new Date().toISOString(),
  };
}

function build({ meeting = {}, requirements } = {}) {
  const source = text(requirements);
  if (!source) return { ok: false, reason: "meeting requirements are empty" };
  const sourceHash = hash(source, 24);
  const proposals = [];
  const seen = new Set();
  const add = (type, body) => {
    if (!PROPOSAL_TYPES.includes(type) || !text(body)) return;
    if (/^(?:no|none|not applicable)\s+(?:new\s+)?(?:decisions?|blockers?|evidence|follow[- ]?ups?|actions?|completed work)\b/i.test(cleanLine(body))) return;
    const item = proposal({ type, body, meeting, sourceHash });
    const key = `${item.type}:${item.body.toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    proposals.push(item);
  };

  for (const section of parseSections(source)) {
    for (const line of bodyLines(section.body)) {
      const type = proposalType(section.title, line);
      if (type) add(type, line);
    }
  }

  add(
    "evidence",
    `Meeting ${meeting.title || meeting.room || meeting.id || "room"} produced a durable requirements synthesis${meeting.requirementsPath ? ` at ${meeting.requirementsPath}` : ""}.`,
  );
  if (!proposals.some((item) => item.type !== "evidence")) {
    add("agenda", `Review and triage the meeting synthesis for ${meeting.title || meeting.room || meeting.id || "this Brief Run"}.`);
  }

  const meetingKey = text(meeting.id || meeting.room || "meeting");
  return {
    ok: true,
    synthesis: {
      id: `meeting-synthesis:${hash(meetingKey)}`,
      meetingId: text(meeting.id),
      room: text(meeting.room),
      title: text(meeting.title || meeting.agenda || meeting.room || "Meeting synthesis"),
      sourceHash,
      requirementsPath: text(meeting.requirementsPath),
      status: "pending_review",
      proposals: proposals.slice(0, 24),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  PROPOSAL_TYPES,
  build,
  parseSections,
  proposalType,
};
