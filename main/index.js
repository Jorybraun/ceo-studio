"use strict";
/**
 * CEO Studio — Electron main process (M0 / L0).
 *
 * Owns: project mounting + domain detection, the per-project Brain, the
 * CostMeter (hard caps + kill switch), the model-agnostic LLM provider, and
 * the Document Agent (M1 entry point). The renderer is a thin UI that talks to
 * this via IPC only.
 */
const { app, BrowserWindow, ipcMain, dialog, session: electronSession } = require("electron");
const path = require("path");
const fs = require("fs");

const { loadEnv } = require("./core/env");
// Load .env.local (e.g. ELEVENLABS_API_KEY) before anything reads process.env.
// Shell-exported vars always win; missing files are ignored (offline-safe).
loadEnv();

const projects = require("./core/projects");
const brain = require("./core/brain");
const { CostMeter } = require("./core/cost");
const { createProvider } = require("./core/llm");
const { DocumentAgent } = require("./core/agent");
const voice = require("./core/voice");
const convai = require("./core/convai");

// --- Session state (single active project at a time in M0) ---
const session = {
  project: null,
  domain: "All",
  cost: null,
  provider: null,
  providerNote: null,
  agent: null,
};

function openProjectSession(projectId) {
  const project = projects.getProject(projectId);
  if (!project) throw new Error(`Unknown project id: ${projectId}`);
  brain.initBrain(project.slug);
  brain.indexProjectDocs(project.slug, project.path);
  const cost = new CostMeter(project.slug);
  const { provider, note } = createProvider();
  session.project = project;
  session.domain = "All";
  session.cost = cost;
  session.provider = provider;
  session.providerNote = note;
  session.agent = new DocumentAgent({ slug: project.slug, project, provider, cost });
  return {
    project,
    providerNote: note,
    providerId: provider.id || "null",
    context: brain.loadContext(project.slug),
  };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  // Allow microphone capture (push-to-talk) for the renderer; deny everything
  // else. Voice audio never leaves the local app except via our metered IPC.
  // Guarded so headless/test boots (no real session) don't crash.
  electronSession?.defaultSession?.setPermissionRequestHandler?.((_wc, permission, cb) => {
    cb(permission === "media");
  });
  win.loadFile(path.join(__dirname, "..", "renderer", "index.html"));
  return win;
}

// --- IPC: projects ---
ipcMain.handle("projects:list", () => projects.listProjects());

ipcMain.handle("projects:add", async () => {
  const r = await dialog.showOpenDialog({ properties: ["openDirectory"] });
  if (r.canceled || !r.filePaths[0]) return null;
  return projects.addProject(r.filePaths[0]);
});

ipcMain.handle("project:open", (_e, projectId) => openProjectSession(projectId));

ipcMain.handle("domain:set", (_e, domain) => {
  session.domain = domain || "All";
  return { domain: session.domain };
});

// --- IPC: brain ---
ipcMain.handle("brain:context", () => {
  if (!session.project) return null;
  return brain.loadContext(session.project.slug);
});

// --- IPC: cost guardrail (live meter + kill switch) ---
ipcMain.handle("cost:status", () => (session.cost ? session.cost.status() : null));
ipcMain.handle("cost:kill", () => { if (session.cost) session.cost.kill(); return session.cost?.status(); });
ipcMain.handle("cost:resume", () => { if (session.cost) session.cost.resume(); return session.cost?.status(); });

// --- IPC: agent (M1 entry point; runs with NullProvider until a model is configured) ---
ipcMain.handle("agent:ask", async (_e, prompt) => {
  if (!session.agent) return { text: "Open a project first.", halted: true };
  const out = await session.agent.ask(prompt, { domain: session.domain });
  return { ...out, cost: session.cost.status() };
});

// --- IPC: voice (ElevenLabs, two-way) ---
// Cost-gated like the model: every TTS/STT call checks the CostMeter first and
// records usage after, so voice spend is visible and the hard caps + kill
// switch halt a runaway voice loop. Degrades gracefully when no key is set.
ipcMain.handle("voice:available", () => voice.status());

ipcMain.handle("voice:speak", async (_e, text) => {
  if (!voice.available()) return { ok: false, reason: "voice disabled (no ELEVENLABS_API_KEY)" };
  if (!session.cost) return { ok: false, reason: "open a project first" };
  const gate = session.cost.canProceed();
  if (!gate.ok) return { ok: false, halted: true, reason: gate.reason, cost: session.cost.status() };
  try {
    const r = await voice.tts(text);
    session.cost.recordVoiceUsage({ kind: "tts", chars: r.chars, durationMs: r.durationMs });
    return {
      ok: true,
      audioBase64: r.audio.toString("base64"),
      mime: r.mime,
      chars: r.chars,
      cost: session.cost.status(),
    };
  } catch (e) {
    return { ok: false, reason: e.message, cost: session.cost.status() };
  }
});

ipcMain.handle("voice:listen", async (_e, { audioBase64, mime } = {}) => {
  if (!voice.available()) return { ok: false, reason: "voice disabled (no ELEVENLABS_API_KEY)" };
  if (!session.cost) return { ok: false, reason: "open a project first" };
  const gate = session.cost.canProceed();
  if (!gate.ok) return { ok: false, halted: true, reason: gate.reason, cost: session.cost.status() };
  try {
    const buf = Buffer.from(String(audioBase64 || ""), "base64");
    const r = await voice.stt(buf, { mime });
    session.cost.recordVoiceUsage({ kind: "stt", seconds: r.seconds, durationMs: r.durationMs });
    return { ok: true, text: r.text, seconds: r.seconds, cost: session.cost.status() };
  } catch (e) {
    return { ok: false, reason: e.message, cost: session.cost.status() };
  }
});

// --- IPC: conversational AI (ElevenLabs live voice agent) ---
// The renderer opens the real-time session itself with a short-lived signed
// URL; the API key never leaves main. Kill switch blocks new sessions; the
// agent's max_duration_seconds + a renderer timer bound the spend.
ipcMain.handle("convai:status", () => convai.status());

ipcMain.handle("convai:start", async () => {
  if (!convai.available()) return { ok: false, reason: "live voice disabled (no ELEVENLABS_API_KEY)" };
  if (session.cost && session.cost.status().killed)
    return { ok: false, halted: true, reason: "kill switch engaged", cost: session.cost.status() };
  try {
    const { agentId } = await convai.ensureAgent({ projectName: session.project?.name });
    // WebRTC token (best interruption) + signed URL fallback; renderer picks.
    let token = null, signedUrl = null;
    try { token = await convai.getConversationToken(agentId); } catch { /* fall back */ }
    try { signedUrl = await convai.getSignedUrl(agentId); } catch { /* */ }
    if (!token && !signedUrl) throw new Error("could not obtain a connection token");
    const st = convai.status();
    return { ok: true, token, signedUrl, agentId, maxMinutes: st.maxMinutes };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// --- IPC: documents (so the voice agent's client tools can read/show docs) ---
ipcMain.handle("docs:list", () => {
  if (!session.project) return [];
  return brain.readIndex(session.project.slug, "artifacts")
    .map((a) => ({ path: a.title, summary: a.summary }));
});

ipcMain.handle("docs:read", (_e, relPath) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const root = path.resolve(session.project.path);
  const resolved = path.resolve(root, String(relPath || ""));
  // Guard against path traversal outside the mounted project.
  if (resolved !== root && !resolved.startsWith(root + path.sep))
    return { ok: false, reason: "path is outside the project" };
  try {
    const text = fs.readFileSync(resolved, "utf-8");
    return { ok: true, path: relPath, text: text.slice(0, 20000) };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// --- IPC: swarm request (L3 not built — record intent, respond honestly) ---
ipcMain.handle("swarm:request", (_e, objective) => {
  if (session.project) {
    brain.writeArtifact(session.project.slug, {
      type: "open_question",
      title: "Swarm orchestration request (voice)",
      summary: String(objective || "").slice(0, 300),
      source: { system: "voice-agent", path: null, actor: "user" },
    });
  }
  return {
    ok: true,
    enabled: false,
    message: "Swarm orchestration (L3) isn't enabled yet. I logged the request to the brain as an open question for when swarms are turned on.",
  };
});

// Single-instance lock: a second launch must NOT open a second window (which
// would run a second live voice agent). Focus the existing window instead.
const gotLock = app.requestSingleInstanceLock ? app.requestSingleInstanceLock() : true;
if (!gotLock) {
  app.quit();
} else {
  let mainWin = null;
  app.on("second-instance", () => {
    if (mainWin) {
      if (mainWin.isMinimized && mainWin.isMinimized()) mainWin.restore();
      mainWin.focus && mainWin.focus();
    }
  });
  app.whenReady().then(() => {
    mainWin = createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}

// Exported for tests / headless reuse.
module.exports = { openProjectSession, session };
