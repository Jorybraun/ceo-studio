"use strict";
/**
 * Headless boot test for main/index.js: stubs the `electron` module so we can
 * load the real main process (registering IPC handlers) without a display,
 * then drive the handlers end-to-end (add project -> open -> ask -> kill).
 */
const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const Module = require("module");

const HOME = fs.mkdtempSync(path.join(os.tmpdir(), "ceo-studio-boot-"));
process.env.CEO_STUDIO_HOME = HOME;
// Set to empty (not delete) so .env.local loader won't override them
process.env.CEO_MODEL_PROVIDER = "";
process.env.OPENAI_API_KEY = "";
process.env.ANTHROPIC_API_KEY = "";
// Keep voice offline + deterministic for the headless boot test. Set empty
// (not delete) so index.js's .env.local loader won't repopulate it.
process.env.ELEVENLABS_API_KEY = "";

// --- stub electron ---
const handlers = {};
const sampleProject = fs.mkdtempSync(path.join(os.tmpdir(), "boot-proj-"));
fs.mkdirSync(path.join(sampleProject, "discovery"));
fs.writeFileSync(path.join(sampleProject, "README.md"), "# Boot\nstrategy text");

const electronStub = {
  app: { whenReady: () => Promise.resolve(), on: () => {}, quit: () => {} },
  BrowserWindow: class { constructor() {} loadFile() {} on() {} static getAllWindows() { return [1]; } },
  ipcMain: { handle: (ch, fn) => { handlers[ch] = fn; } },
  dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [sampleProject] }) },
  session: { defaultSession: { setPermissionRequestHandler: () => {} } },
};

const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "electron") return electronStub;
  return origLoad.call(this, request, parent, isMain);
};

require("../main/index.js"); // registers handlers via the stub

let passed = 0;
const ok = (n, c) => { if (!c) { console.error("FAIL", n); process.exitCode = 1; } else { console.log("PASS", n); passed++; } };

(async () => {
  const expected = ["projects:list", "projects:add", "project:open", "domain:set",
    "domain:define", "domain:get_all",
    "brain:context", "cost:status", "cost:kill", "cost:resume", "agent:ask",
    "gbrain:status", "gbrain:query", "gbrain:ingest",
    "voice:available", "voice:speak", "voice:listen",
    "convai:status", "convai:start",
    "docs:list", "docs:tree", "docs:read",
    "jobs:create_ticket_pack", "jobs:get", "jobs:list", "jobs:apply_ticket_comment",
    "swarm:request"];
  ok("all IPC handlers registered", expected.every((c) => typeof handlers[c] === "function"));

  const added = await handlers["projects:add"]();
  ok("projects:add mounts the dir", !!added && !!added.id);

  const opened = await handlers["project:open"](null, added.id);
  ok("project:open returns context + provider", !!opened.context && !!opened.providerId);
  ok("offline provider note present", /NullProvider|API_KEY missing/i.test(opened.providerNote || ""));

  const status0 = await handlers["cost:status"]();
  ok("cost:status live after open", status0 && status0.maxSessionUsd > 0);

  const gbStatus = await handlers["gbrain:status"]();
  ok("gbrain:status reports unavailable when unconfigured", gbStatus && gbStatus.available === false);

  const reply = await handlers["agent:ask"](null, "what is the strategy?");
  ok("agent:ask returns text + cost", typeof reply.text === "string" && !!reply.cost);

  // Voice degrades gracefully offline (no key in test env) — never crashes.
  const vStatus = await handlers["voice:available"]();
  ok("voice:available reports unavailable offline", vStatus && vStatus.available === false);
  const vSpeak = await handlers["voice:speak"](null, "hi");
  ok("voice:speak refuses gracefully without key", vSpeak && vSpeak.ok === false);
  const vListen = await handlers["voice:listen"](null, { audioBase64: "", mime: "audio/webm" });
  ok("voice:listen refuses gracefully without key", vListen && vListen.ok === false);

  // Live voice (Conversational AI) also degrades gracefully offline.
  const cStatus = await handlers["convai:status"]();
  ok("convai:status reports unavailable offline", cStatus && cStatus.available === false);
  const cStart = await handlers["convai:start"]();
  ok("convai:start refuses gracefully without key", cStart && cStart.ok === false);

  // Document tools (back the voice agent's client tools) work on the open project.
  const docs = await handlers["docs:list"]();
  ok("docs:list returns indexed docs", Array.isArray(docs) && docs.length >= 1);
  const tree = await handlers["docs:tree"](null, "All");
  ok("docs:tree returns a file tree", tree && tree.ok === true && Array.isArray(tree.tree));
  const readOk = await handlers["docs:read"](null, "README.md");
  ok("docs:read reads a project file", readOk && readOk.ok === true && /strategy/i.test(readOk.text));
  const escape = await handlers["docs:read"](null, "../../../etc/hosts");
  ok("docs:read blocks path traversal", escape && escape.ok === false);
  const domain = await handlers["domain:define"](null, {
    name: "Ops",
    purpose: "Operational planning",
    createScaffold: true,
    relativePath: "domains/ops",
  });
  ok("domain:define creates a scaffolded domain", domain && domain.ok === true && fs.existsSync(path.join(sampleProject, "domains", "ops", "AGENTS.md")));
  const swarm = await handlers["swarm:request"](null, "research the market");
  ok("swarm:request responds honestly (not enabled)", swarm && swarm.ok === true && swarm.enabled === false);

  await handlers["cost:kill"]();
  const killedReply = await handlers["agent:ask"](null, "again");
  ok("agent halts after kill switch", killedReply.halted === true);

  Module._load = origLoad;
  console.log(`\n${passed} boot checks passed.`);
})();
