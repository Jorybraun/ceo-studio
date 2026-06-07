"use strict";
/**
 * Extract plan/decomposition payloads from AGUI blocks and persist on studio sessions.
 */
const sessions = require("./sessions");

function _parseListLine(line) {
  if (line && typeof line === "object" && line.title) {
    return {
      title: String(line.title).trim(),
      type: String(line.type || "decomposition").trim(),
      status: String(line.status || "proposed").trim(),
      actionItems: Array.isArray(line.actionItems) ? line.actionItems.map(String) : [],
      children: Array.isArray(line.children) ? line.children : [],
    };
  }
  const s = String(line || "").trim();
  if (!s) return null;
  const parts = s.split(/\s*[|—–]\s*|\s+-\s+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 3) {
    return {
      title: parts[0],
      type: parts[1] || "decomposition",
      status: parts[2] || "proposed",
      actionItems: parts.slice(3),
    };
  }
  if (parts.length === 2) {
    return { title: parts[0], type: "decomposition", status: parts[1], actionItems: [] };
  }
  return { title: s, type: "decomposition", status: "proposed", actionItems: [] };
}

function _itemsFromTable(props) {
  const headers = (props.headers || []).map((h) => String(h).toLowerCase());
  const rows = Array.isArray(props.rows) ? props.rows : [];
  if (!rows.length) return [];
  const titleIdx = headers.findIndex((h) => /title|item|step|work/.test(h));
  const typeIdx = headers.findIndex((h) => /type/.test(h));
  const statusIdx = headers.findIndex((h) => /status/.test(h));
  return rows
    .map((row) => {
      const cells = Array.isArray(row) ? row : [row];
      const title = String(cells[titleIdx >= 0 ? titleIdx : 0] || "").trim();
      if (!title) return null;
      return {
        title,
        type: typeIdx >= 0 ? String(cells[typeIdx] || "decomposition").trim() : "decomposition",
        status: statusIdx >= 0 ? String(cells[statusIdx] || "proposed").trim() : "proposed",
        actionItems: [],
      };
    })
    .filter(Boolean);
}

function _itemsFromList(props) {
  const raw = Array.isArray(props.items) ? props.items : [];
  return raw
    .map((it) => {
      if (it && typeof it === "object" && it.title) {
        return {
          title: String(it.title).trim(),
          type: String(it.type || "decomposition").trim(),
          status: String(it.status || "proposed").trim(),
          actionItems: Array.isArray(it.actionItems) ? it.actionItems.map(String) : [],
          children: Array.isArray(it.children) ? it.children : [],
        };
      }
      return _parseListLine(it);
    })
    .filter(Boolean);
}

/** Pull decomposition items from normalized AGUI ui + optional raw agui JSON. */
function extractDecompositionFromAgui(ui, raw) {
  if (raw && raw.decomposition && typeof raw.decomposition === "object") {
    const d = raw.decomposition;
    const items = Array.isArray(d.items) ? d.items : [];
    if (items.length || d.body) {
      return {
        title: d.title || raw.title || "Session decomposition",
        overview: d.overview || "",
        body: d.body || "",
        items,
        source: "agui-json",
      };
    }
  }
  if (!ui || !Array.isArray(ui.components)) return null;
  const items = [];
  let overview = "";
  let body = "";
  let sawDecompHeading = false;

  for (const c of ui.components) {
    const type = c.type;
    const props = c.props || {};
    if (type === "heading" && /decompos|workstream|steps|breakdown/i.test(String(props.text || ""))) {
      sawDecompHeading = true;
    }
    if (type === "markdown") {
      const content = String(props.content || "");
      if (/decompos|workstream|## steps/i.test(content)) body += `${content}\n\n`;
      if (/^overview:/im.test(content)) overview = content.replace(/^overview:\s*/im, "").split("\n")[0].trim();
    }
    if (type === "list") items.push(..._itemsFromList(props));
    if (type === "table") items.push(..._itemsFromTable(props));
    if (type === "card" && /decompos|step/i.test(String(props.title || ""))) {
      const title = String(props.title || "").trim();
      if (title) items.push({ title, type: "decomposition", status: "proposed", actionItems: [] });
    }
  }

  const title = ui.title || "";
  const titleHints = /decompos|breakdown|workstream|steps/i.test(title);
  if (!items.length && !body) return null;
  if (!sawDecompHeading && !titleHints && items.length < 2) return null;

  return {
    title: title || "Session decomposition",
    overview,
    body: body.trim(),
    items,
    source: "agui-components",
  };
}

function extractPlanFromAgui(ui, raw) {
  if (raw && raw.plan && typeof raw.plan === "object" && raw.plan.body) {
    return {
      title: raw.plan.title || "Plan",
      overview: raw.plan.overview || "",
      body: String(raw.plan.body),
      source: "agui-json",
    };
  }
  if (!ui || !Array.isArray(ui.components)) return null;
  let body = "";
  let title = /plan/i.test(ui.title || "") ? ui.title : "Plan";
  let overview = "";
  for (const c of ui.components) {
    const props = c.props || {};
    if (c.type === "markdown" && /##\s*(goal|plan|step)/i.test(String(props.content || ""))) {
      body += String(props.content);
    }
    if (c.type === "card" && /plan/i.test(String(props.title || ""))) {
      title = props.title || title;
      body += String(props.body || "");
    }
  }
  if (!body.trim()) return null;
  return { title, overview, body: body.trim(), source: "agui-components" };
}

/**
 * Persist plan/decomposition extracted from a lead-agent reply when in an active session.
 * Returns { plan, decomposition } with ok flags.
 */
function captureFromAgentReply(slug, sessionId, { ui, raw, phase } = {}) {
  const g = sessions.get(slug, sessionId);
  if (!g.ok) return { ok: false, reason: g.reason };
  const session = g.session;
  const ph = phase || session.phase;
  const out = { ok: true, plan: null, decomposition: null };

  const planPayload = extractPlanFromAgui(ui, raw);
  if (planPayload && planPayload.body && (!session.planDoc || !session.planDoc.body) && ["explore", "assets", "plan"].includes(ph)) {
    const pr = sessions.setPlan(slug, sessionId, planPayload);
    out.plan = pr;
  }

  const decompPayload = extractDecompositionFromAgui(ui, raw);
  const shouldCaptureDecomp =
    decompPayload
    && (decompPayload.items.length || decompPayload.body)
    && (
      ["decompose", "approve", "execute"].includes(ph)
      || (raw && raw.decomposition)
      || decompPayload.items.length >= 2
    );
  if (shouldCaptureDecomp) {
    const dr = sessions.setDecomposition(slug, sessionId, {
      ...decompPayload,
      source: decompPayload.source || "lead-agent",
    });
    out.decomposition = dr;
  }

  return out;
}

module.exports = {
  extractDecompositionFromAgui,
  extractPlanFromAgui,
  captureFromAgentReply,
};