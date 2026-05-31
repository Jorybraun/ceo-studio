"use strict";
/**
 * AGUI server — the bridge that makes the (text-only) Hermes CEO speak the
 * AG-UI protocol (https://docs.ag-ui.com).
 *
 * Hermes returns plain text over a CLI. AG-UI is an event-based protocol. This
 * module is the middleware/adapter between them: a tiny local HTTP server that
 * the renderer's official `@ag-ui/client` HttpAgent connects to. For each run it
 * emits a real, spec-shaped Server-Sent-Events stream:
 *
 *   RUN_STARTED
 *     TEXT_MESSAGE_START → TEXT_MESSAGE_CONTENT* → TEXT_MESSAGE_END   (the prose)
 *     STATE_SNAPSHOT                                                  (the UI tree)
 *   RUN_FINISHED   (or RUN_ERROR)
 *
 * The CEO drives the left panel by emitting a fenced ```agui {json}``` block in
 * its reply. We parse that block out of the prose, validate it, and ship it as
 * AG-UI shared state ({ ui: <component tree> }) which the renderer mounts via a
 * component registry. Everything else in the reply streams as assistant text.
 *
 * Event field names match @ag-ui/core's zod schemas exactly so the client's
 * verifyEvents() accepts the stream.
 */
const http = require("http");
const crypto = require("crypto");
const { EventType } = require("@ag-ui/core");
const hermes = require("./hermes");

// --- The component registry contract (must mirror renderer/agui/registry.js) ---
// Kept here as a compact spec so we can teach the CEO how to render UI.
const UI_SPEC = `You can render rich UI in the user's left panel by including ONE fenced code block tagged \`agui\` somewhere in your reply. Everything outside the block is shown as normal chat prose. The block must be valid JSON of shape:
{ "title": "optional panel title", "components": [ <component>, ... ] }
Each <component> is { "type": "<name>", ...props }. Available components:
- {"type":"markdown","content":"# md text"}
- {"type":"heading","text":"...","level":1-4}
- {"type":"text","content":"paragraph"}
- {"type":"code","language":"js","content":"..."}
- {"type":"mermaid","diagram":"graph TD; A-->B"}   (flowcharts, sequence, etc.)
- {"type":"card","title":"...","body":"markdown"}
- {"type":"list","ordered":false,"items":["a","b"]}
- {"type":"table","headers":["A","B"],"rows":[["1","2"]]}
- {"type":"callout","variant":"info|success|warn|error","text":"..."}
- {"type":"image","url":"https://...","alt":"..."}
- {"type":"divider"}
Only include the block when a visual would genuinely help (architecture, diagrams, documents, code, plans, comparisons). Keep prose concise when you also render UI.`;

let _server = null;
let _port = 0;

/** Write one AG-UI event to the SSE response. */
function _send(res, event) {
  event.timestamp = event.timestamp || Date.now();
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

/**
 * Pull a fenced ```agui ... ``` block out of the full reply. Returns
 * { prose, ui } where `ui` is the parsed object (or null) and `prose` is the
 * reply with the block removed.
 */
function _extractUi(reply) {
  const text = String(reply || "");
  const m = text.match(/```agui\s*\n([\s\S]*?)\n```/i);
  if (!m) return { prose: text.trim(), ui: null };
  const prose = (text.slice(0, m.index) + text.slice(m.index + m[0].length)).trim();
  let ui = null;
  try {
    const parsed = JSON.parse(m[1]);
    ui = _normalizeUi(parsed);
  } catch { /* malformed block → ignore, keep prose */ }
  return { prose, ui };
}

/** Normalize/validate a UI spec into { title, components:[{type,props}] }. */
function _normalizeUi(parsed) {
  if (!parsed || typeof parsed !== "object") return null;
  const rawList = Array.isArray(parsed) ? parsed : (parsed.components || []);
  if (!Array.isArray(rawList)) return null;
  const components = rawList
    .filter((c) => c && typeof c === "object" && typeof c.type === "string")
    .map((c) => {
      const { type, ...props } = c;
      return { type, props };
    });
  return { title: parsed.title || "", components };
}

/**
 * Live fence-aware splitter for the streaming path. Feed raw stdout chunks; it
 * forwards prose deltas (outside any ```agui block) to onProse, while quietly
 * buffering the block contents and the trailing `session_id:` footer.
 */
function _makeStreamSplitter(onProse) {
  let carry = "";       // incomplete trailing line
  let inAgui = false;
  const handleLine = (line) => {
    const trimmed = line.trim();
    if (!inAgui && /^```agui\s*$/i.test(trimmed)) { inAgui = true; return; }
    if (inAgui && /^```\s*$/.test(trimmed)) { inAgui = false; return; }
    if (inAgui) return;                          // block body is rendered separately
    if (/^session_id:\s*\S+$/i.test(trimmed)) return; // -Q footer
    onProse(line);
  };
  return {
    feed(chunk) {
      carry += chunk;
      let idx;
      while ((idx = carry.indexOf("\n")) >= 0) {
        handleLine(carry.slice(0, idx + 1));
        carry = carry.slice(idx + 1);
      }
    },
    end() { if (carry) { handleLine(carry); carry = ""; } },
  };
}

/** Handle a single AG-UI run: POST body is a RunAgentInput. */
async function _handleRun(body, res) {
  const threadId = body.threadId || crypto.randomUUID();
  const runId = body.runId || crypto.randomUUID();
  const messageId = crypto.randomUUID();

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  _send(res, { type: EventType.RUN_STARTED, threadId, runId });

  // Latest user message drives the turn.
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const lastUser = [...messages].reverse().find((m) => m && m.role === "user");
  const userText = lastUser ? String(lastUser.content || "") : "";

  if (!userText.trim()) {
    _send(res, { type: EventType.RUN_FINISHED, threadId, runId });
    return res.end();
  }

  // Teach the CEO how to render UI (compact, every turn — sessions can reset).
  const prompt = `${UI_SPEC}\n\n---\n\n${userText}`;

  _send(res, { type: EventType.TEXT_MESSAGE_START, messageId, role: "assistant" });
  const splitter = _makeStreamSplitter((delta) => {
    _send(res, { type: EventType.TEXT_MESSAGE_CONTENT, messageId, delta });
  });

  let result;
  try {
    result = await hermes.askStream(prompt, { onDelta: (d) => splitter.feed(d) });
    splitter.end();
  } catch (e) {
    splitter.end();
    _send(res, { type: EventType.TEXT_MESSAGE_END, messageId });
    _send(res, { type: EventType.RUN_ERROR, message: String(e && e.message || e) });
    return res.end();
  }

  _send(res, { type: EventType.TEXT_MESSAGE_END, messageId });

  if (!result || !result.ok) {
    _send(res, { type: EventType.RUN_ERROR, message: (result && result.reason) || "CEO unavailable" });
    return res.end();
  }

  // Parse the UI block from the full reply and ship it as shared state.
  const { ui } = _extractUi(result.reply);
  if (ui && ui.components.length) {
    _send(res, { type: EventType.STATE_SNAPSHOT, snapshot: { ui } });
  }

  _send(res, { type: EventType.RUN_FINISHED, threadId, runId });
  res.end();
}

function _onRequest(req, res) {
  // CORS preflight (renderer origin is file://).
  if (req.method === "OPTIONS") {
    res.writeHead(204, {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Accept",
    });
    return res.end();
  }
  if (req.method !== "POST" || !req.url.startsWith("/agui")) {
    res.writeHead(404, { "Access-Control-Allow-Origin": "*" });
    return res.end();
  }
  let raw = "";
  req.on("data", (c) => { raw += c; if (raw.length > 4 * 1024 * 1024) req.destroy(); });
  req.on("end", () => {
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { body = {}; }
    _handleRun(body, res).catch((e) => {
      try {
        _send(res, { type: EventType.RUN_ERROR, message: String(e && e.message || e) });
        res.end();
      } catch { /* connection already gone */ }
    });
  });
}

/** Start the AGUI server on an ephemeral localhost port. Idempotent. */
function start() {
  if (_server) return Promise.resolve({ ok: true, port: _port });
  return new Promise((resolve) => {
    _server = http.createServer(_onRequest);
    _server.on("error", (e) => resolve({ ok: false, reason: e.message }));
    _server.listen(0, "127.0.0.1", () => {
      _port = _server.address().port;
      console.log(`[agui] server listening on http://127.0.0.1:${_port}/agui`);
      resolve({ ok: true, port: _port });
    });
  });
}

function url() { return _port ? `http://127.0.0.1:${_port}/agui` : null; }
function stop() { if (_server) { _server.close(); _server = null; _port = 0; } }

module.exports = { start, stop, url, _extractUi, _normalizeUi, UI_SPEC };
