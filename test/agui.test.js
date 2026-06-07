"use strict";
// AGUI server smoke test: stub Hermes, hit the real HTTP/SSE endpoint with the
// official client, and assert the AG-UI event sequence (prose stream + UI state).
const assert = require("assert");
const http = require("http");
const hermes = require("../main/core/hermes");
const agui = require("../main/core/agui-server");

// Stub the streaming relay so no real model call happens. Simulate a CEO reply
// that streams prose and includes a fenced ```agui UI block + the -Q footer.
hermes.askStream = async (_message, { onDelta } = {}) => {
  const reply =
    "Here's the architecture.\n\n" +
    "```agui\n" +
    JSON.stringify({
      title: "System Architecture",
      components: [
        { type: "heading", text: "Overview", level: 2 },
        { type: "mermaid", diagram: "graph TD; UI-->Server; Server-->Hermes" },
        { type: "callout", variant: "info", text: "Streaming over SSE." },
      ],
    }) +
    "\n```\n\nLet me know what to change.\n";
  // Stream it in chunks like the CLI would, plus the session footer.
  for (const chunk of reply.match(/.{1,40}/gs) || [reply]) onDelta && onDelta(chunk);
  onDelta && onDelta("\nsession_id: test-123");
  return { ok: true, reply, session: "test-123" };
};

function post(url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request(
      { hostname: u.hostname, port: u.port, path: u.pathname, method: "POST",
        headers: { "Content-Type": "application/json", Accept: "text/event-stream" } },
      (res) => {
        let buf = "";
        res.on("data", (d) => (buf += d));
        res.on("end", () => resolve(buf));
      }
    );
    req.on("error", reject);
    req.end(JSON.stringify(body));
  });
}

function parseSSE(raw) {
  return raw
    .split("\n\n")
    .map((b) => b.replace(/^data: /, "").trim())
    .filter(Boolean)
    .map((s) => JSON.parse(s));
}

(async function run() {
  const { ok, port } = await agui.start();
  assert.ok(ok && port, "server should start on a port");

  const raw = await post(`http://127.0.0.1:${port}/agui`, {
    threadId: "t1", runId: "r1",
    messages: [{ id: "m1", role: "user", content: "show me the architecture" }],
  });
  const events = parseSSE(raw);
  const types = events.map((e) => e.type);

  assert.ok(types.includes("RUN_STARTED"), "RUN_STARTED present");
  assert.ok(types.includes("TEXT_MESSAGE_START"), "TEXT_MESSAGE_START present");
  assert.ok(types.includes("TEXT_MESSAGE_CONTENT"), "TEXT_MESSAGE_CONTENT present");
  assert.ok(types.includes("TEXT_MESSAGE_END"), "TEXT_MESSAGE_END present");
  assert.ok(types.includes("STATE_SNAPSHOT"), "STATE_SNAPSHOT present");
  assert.ok(types.includes("RUN_FINISHED"), "RUN_FINISHED present");
  assert.strictEqual(types[0], "RUN_STARTED", "first event is RUN_STARTED");
  assert.strictEqual(types[types.length - 1], "RUN_FINISHED", "last event is RUN_FINISHED");

  // Prose must NOT leak the ```agui block or the session footer.
  const prose = events.filter((e) => e.type === "TEXT_MESSAGE_CONTENT").map((e) => e.delta).join("");
  assert.ok(/architecture/i.test(prose), "prose contains the spoken text");
  assert.ok(!/```agui/.test(prose), "prose excludes the agui fence");
  assert.ok(!/session_id/.test(prose), "prose excludes the session footer");

  // The UI snapshot must carry the parsed component tree.
  const snap = events.find((e) => e.type === "STATE_SNAPSHOT");
  assert.ok(snap.snapshot && snap.snapshot.ui, "snapshot has ui");
  assert.strictEqual(snap.snapshot.ui.title, "System Architecture");
  assert.strictEqual(snap.snapshot.ui.components.length, 3);
  assert.strictEqual(snap.snapshot.ui.components[0].type, "heading");
  assert.strictEqual(snap.snapshot.ui.components[0].props.level, 2);

  const inline = agui._extractUi('Text before.\n```agui {"components":[{"type":"text","content":"Rendered"}]}\n```\nText after.');
  assert.ok(!/```agui/.test(inline.prose), "inline agui fence is stripped from prose");
  assert.ok(inline.ui && inline.ui.components.length === 1, "inline agui fence parses ui");

  agui.stop();
  console.log(`AGUI test passed — ${events.length} events:`, types.join(" → "));
})().catch((e) => { console.error("AGUI test FAILED:", e.message); agui.stop(); process.exit(1); });
