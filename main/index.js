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
const { execFileSync, execSync, spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const { loadEnv } = require("./core/env");
// Load .env.local (e.g. ELEVENLABS_API_KEY) before anything reads process.env.
// Shell-exported vars always win; missing files are ignored (offline-safe).
loadEnv();

const projects = require("./core/projects");
const brain = require("./core/brain");
const gbrain = require("./core/gbrain");
const domains = require("./core/domains");
const domainArchitect = require("./core/domain-architect");
const user = require("./core/user");
const soul = require("./core/soul");
const hermes = require("./core/hermes");
const domainBoard = require("./core/domain-board");
const briefRuns = require("./core/brief-runs");
const briefIntake = require("./core/brief-intake");
const meetingSynthesis = require("./core/meeting-synthesis");
const boardOverlay = require("./core/board-overlay");
const autonomy = require("./core/autonomy");
const autonomyLoop = require("./core/autonomy-loop");
const autonomyRunner = require("./core/autonomy-runner");
const provenance = require("./core/provenance");
const goals = require("./core/goals");
const goalReview = require("./core/goal-review");
const selfRepair = require("./core/self-repair");
const notifications = require("./core/notifications");
const orchestrationOrg = require("./core/orchestration-org");
const meetings = require("./core/meetings");
const standups = require("./core/standups");
const registry = require("./core/registry");
const models = require("./core/models");
const personas = require("./core/personas");
const skillCatalog = require("./core/skills");
const mount = require("./core/mount");
const aguiServer = require("./core/agui-server");
const sessions = require("./core/sessions");
const jobs = require("./core/jobs");
const ceoTriggers = require("./core/ceo-triggers");
const ticketPlanner = require("./core/ticket-planner");
const ptyTerminal = require("./core/pty-terminal");
const { CostMeter } = require("./core/cost");
const { createProvider, createUtilityProvider } = require("./core/llm");
const { DocumentAgent } = require("./core/agent");
const voice = require("./core/voice");
const convai = require("./core/convai");
const voiceChat = require("./core/voice-chat");

const remoteDebugPort = String(process.env.CEO_STUDIO_REMOTE_DEBUG_PORT || process.env.ELECTRON_REMOTE_DEBUG_PORT || "").trim();
if (remoteDebugPort) {
  app.commandLine.appendSwitch("remote-debugging-port", remoteDebugPort);
  app.commandLine.appendSwitch("remote-allow-origins", `http://localhost:${remoteDebugPort}`);
}

// --- Session state (single active project at a time in M0) ---
const session = {
  project: null,
  domain: "All",
  focusedTask: null,
  cost: null,
  provider: null,
  providerNote: null,
  agent: null,
};

let autonomyTimer = null;
let runnerTimer = null;
let runnerKickoff = null;

function stopAutonomyTimer() {
  if (autonomyTimer) clearInterval(autonomyTimer);
  autonomyTimer = null;
}

function stopRunnerTimer() {
  if (runnerTimer) clearInterval(runnerTimer);
  if (runnerKickoff) clearTimeout(runnerKickoff);
  runnerTimer = null;
  runnerKickoff = null;
}

function startRunnerTimer(project, policy, { kick = false } = {}) {
  stopRunnerTimer();
  if (!project || !policy || !policy.enabled) return null;
  const cycle = () => {
    try {
      autonomyRunner.runCycle({
        projectSlug: project.slug,
        projectPath: project.path,
      });
    } catch (_) { /* persisted by the runner when the cycle starts */ }
  };
  const ms = Math.max(1, policy.intervalMinutes) * 60 * 1000;
  runnerTimer = setInterval(cycle, ms);
  if (runnerTimer.unref) runnerTimer.unref();
  if (kick) {
    runnerKickoff = setTimeout(() => {
      runnerKickoff = null;
      cycle();
    }, 0);
    if (runnerKickoff.unref) runnerKickoff.unref();
  }
  return runnerTimer;
}

function runRunnerCycle(extraPolicy = {}, { force = false } = {}) {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return autonomyRunner.runCycle({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    force,
    policy: extraPolicy,
  });
}

function autonomyStatus() {
  if (!session.project) return { ok: false, reason: "open a project first", running: false };
  return {
    ok: true,
    running: !!autonomyTimer,
    policy: autonomyLoop.getPolicy(session.project.slug),
    state: autonomyLoop.getState(session.project.slug),
  };
}

// --- GBrain HTTP server ---
let gbrainProcess = null;
const GBRAIN_PORT = 8001; // Use 8001 since 8000 is taken by graph-visual

function startGBrainServer() {
  if (gbrainProcess) {
    console.log("[gbrain] server already running");
    return;
  }

  console.log("[gbrain] starting HTTP server on port", GBRAIN_PORT);
  
  // Load Google API key for embeddings (from PIPE-OS .env)
  const pipeEnvPath = path.join(process.env.HOME, "Code", "PIPE", "PIPE-OS", ".env");
  let googleApiKey = "";
  try {
    if (fs.existsSync(pipeEnvPath)) {
      const envContent = fs.readFileSync(pipeEnvPath, "utf-8");
      const match = envContent.match(/^VERTEX_API_KEY=(.+)$/m);
      if (match) {
        googleApiKey = match[1].trim().replace(/"/g, "");
        console.log("[gbrain] loaded Google API key from PIPE-OS .env");
      }
    }
  } catch (e) {
    console.warn("[gbrain] failed to load Google API key:", e.message);
  }

  const env = { ...process.env };
  if (googleApiKey) {
    env.GOOGLE_GENERATIVE_AI_API_KEY = googleApiKey;
  }
  // Unset DATABASE_URL to avoid conflicts (like serve-mcp.sh does)
  delete env.DATABASE_URL;
  // Add bun to PATH
  env.PATH = `${process.env.HOME}/.bun/bin:${env.PATH || ""}`;
  
  try {
    gbrainProcess = spawn("gbrain", [
      "serve",
      "--http",
      "--port", String(GBRAIN_PORT),
      "--bind", "0.0.0.0",
      "--public-url", `http://localhost:${GBRAIN_PORT}`
    ], {
      stdio: "ignore",
      detached: false,
      env,
      cwd: process.env.HOME
    });

    gbrainProcess.on("error", (err) => {
      console.error("[gbrain] failed to start:", err.message);
      gbrainProcess = null;
    });

    gbrainProcess.on("exit", (code, signal) => {
      console.log(`[gbrain] server exited (code: ${code}, signal: ${signal})`);
      gbrainProcess = null;
    });

    // Set environment variable for CEO Studio's GBrain bridge
    process.env.GBRAIN_URL = `http://localhost:${GBRAIN_PORT}`;
    console.log("[gbrain] GBRAIN_URL set to", process.env.GBRAIN_URL);
    console.log("[gbrain] process started with PID:", gbrainProcess.pid);
  } catch (e) {
    console.error("[gbrain] spawn error:", e.message);
    gbrainProcess = null;
  }
}

function stopGBrainServer() {
  if (gbrainProcess) {
    console.log("[gbrain] stopping server");
    gbrainProcess.kill("SIGTERM");
    gbrainProcess = null;
  }
}

function rememberProjectDomain(domainName, source = "manual") {
  if (!session.project || !domainName) return;
  const exists = (session.project.domains || []).some((d) => d.name.toLowerCase() === domainName.toLowerCase());
  if (!exists) session.project.domains = [...(session.project.domains || []), { name: domainName, source }];
  try {
    const reg = projects.loadRegistry();
    const idx = reg.projects.findIndex((p) => p.id === session.project.id);
    if (idx >= 0) {
      reg.projects[idx] = { ...reg.projects[idx], domains: session.project.domains };
      projects.saveRegistry(reg);
    }
  } catch { /* registry persistence is best-effort */ }
}

function safeProjectPath(relPath) {
  if (!session.project) return null;
  const root = path.resolve(session.project.path);
  const resolved = path.resolve(root, String(relPath || ""));
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;
  return { root, resolved };
}

function projectTree({ domain = session.domain, maxEntries = 600 } = {}) {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv", ".worktrees"]);
  const TEXTY = /\.(md|mdx|txt|json|yaml|yml|js|ts|jsx|tsx|css|html|py|sh|sql)$/i;
  const root = path.resolve(session.project.path);
  let base = root;
  let prefix = "";
  if (domain && domain !== "All") {
    const d = domains.getDomain(session.project.slug, domain);
    if (d && d.relativePath) {
      const safe = safeProjectPath(d.relativePath);
      if (safe && fs.existsSync(safe.resolved)) {
        base = safe.resolved;
        prefix = d.relativePath;
      }
    }
  }
  let count = 0;
  const walk = (dir, relBase = "") => {
    if (count >= maxEntries) return [];
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    return entries
      .filter((e) => !e.name.startsWith(".") || e.name === ".env.example")
      .sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name))
      .flatMap((e) => {
        if (count >= maxEntries) return [];
        const rel = path.join(relBase, e.name);
        const projectRel = prefix ? path.join(prefix, rel) : rel;
        if (e.isDirectory()) {
          if (SKIP.has(e.name)) return [];
          count++;
          return [{ type: "dir", name: e.name, path: projectRel, children: walk(path.join(dir, e.name), rel) }];
        }
        if (!e.isFile() || !TEXTY.test(e.name)) return [];
        count++;
        return [{ type: "file", name: e.name, path: projectRel }];
      });
  };
  return { ok: true, domain: domain || "All", root: prefix || ".", tree: walk(base), truncated: count >= maxEntries };
}

async function processTicketPackJob(jobId, project = session.project) {
  if (!project) return null;
  const job = jobs.update(project.slug, jobId, { status: "running", error: null });
  if (!job) return null;
  try {
    const board = job.input.board || hermes.currentBoard();
    const taskId = job.input.ticketId;
    const detail = hermes.getTask(board, taskId);
    if (!detail || !detail.ok) throw new Error(detail ? detail.reason : "Could not load ticket");
    const output = ticketPlanner.prepareTicketPack({
      slug: project.slug,
      project,
      ticket: detail.task,
      domain: job.domain || session.domain || "All",
      job,
    });
    output.board = board;
    output.comments = detail.comments || [];
    return jobs.update(project.slug, jobId, { status: "done", output });
  } catch (e) {
    return jobs.update(project.slug, jobId, { status: "failed", error: e.message });
  }
}

function openProjectSession(projectId) {
  const project = projects.getProject(projectId);
  if (!project) throw new Error(`Unknown project id: ${projectId}`);
  stopRunnerTimer();
  brain.initBrain(project.slug);
  brain.indexProjectDocs(project.slug, project.path);
  
  // Ingest domains from project structure
  try {
    const availableBoards = hermes.listBoards().map(b => b.slug);
    const ingested = domains.ingestDomainsFromProject(project.slug, project.path, availableBoards);
    console.log(`Ingested ${ingested.length} domains from project structure`);
    ingested.forEach(d => {
      console.log(`  - ${d.name}: ${d.hasContext ? 'has context' : 'no context'} (${d.source})`);
    });
  } catch (e) {
    console.log("Domain ingestion failed:", e.message);
  }
  
  // Brain provisioning (lightweight): ensure every Devin agent in this repo can
  // reach the shared project brain by wiring the gbrain MCP server into
  // .devin/config.json (idempotent), then check brain reachability and log it.
  // We do NOT manage the gbrain DB/container here — that stays explicit.
  let gbrainWiring = null;
  try {
    gbrainWiring = gbrain.ensureProjectWiring(project.path);
    if (gbrainWiring.created) console.log("[gbrain] wired gbrain MCP into .devin/config.json");
  } catch (e) {
    console.warn("[gbrain] ensureProjectWiring failed:", e.message);
  }
  // Fire-and-forget health probe so the brain's reachability is visible at open
  // without blocking project load (the renderer can also call gbrain:status).
  Promise.resolve(gbrain.status())
    .then((s) => console.log(`[gbrain] brain ${s && s.available ? "reachable" : "UNAVAILABLE"}${s && s.reason ? ` (${s.reason})` : ""}`))
    .catch(() => { /* never block project open on a brain probe */ });

  const cost = new CostMeter(project.slug);
  const { provider, note } = createProvider();
  session.project = project;
  sessions.bindProject(project.slug, project.path);
  session.domain = "All";
  session.cost = cost;
  session.provider = provider;
  session.providerNote = note;
  session.agent = new DocumentAgent({ slug: project.slug, project, provider, cost });
  const runnerPolicy = autonomyRunner.getPolicy(project.slug);
  if (runnerPolicy.enabled) startRunnerTimer(project, runnerPolicy, { kick: true });
  return {
    project,
    providerNote: note,
    providerId: provider.id || "null",
    context: brain.loadContext(project.slug),
    gbrain: gbrainWiring,
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

ipcMain.handle("domain:set", async (_e, domain) => {
  session.domain = domain || "All";
  // Update the voice agent's domain context if it's available
  try {
    const store = convai._readStore();
    if (store && store.agentId) {
      await convai.updateAgentDomain(store.agentId, { currentDomain: session.domain });
    }
  } catch (err) {
    // Don't fail domain switching if voice agent update fails
    console.log("Voice agent domain update failed:", err.message);
  }
  return { domain: session.domain };
});

ipcMain.handle("domain:define", (_e, domainDef) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const cleanName = String(domainDef.name || "").trim();
    if (!cleanName) return { ok: false, reason: "Domain name required" };
    if (/[\\/]/.test(cleanName)) return { ok: false, reason: "Domain name cannot contain path separators" };
    let relativePath = domainDef.relativePath ? String(domainDef.relativePath).trim() : null;
    if (relativePath && !safeProjectPath(relativePath)) return { ok: false, reason: "Domain path is outside the project" };
    const responsibilities = Array.isArray(domainDef.responsibilities || domainDef.boundaries)
      ? (domainDef.responsibilities || domainDef.boundaries)
      : String(domainDef.responsibilities || domainDef.boundaries || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const features = Array.isArray(domainDef.features || domainDef.initialFeatures || domainDef.activeEpics)
      ? (domainDef.features || domainDef.initialFeatures || domainDef.activeEpics)
      : String(domainDef.features || domainDef.initialFeatures || domainDef.activeEpics || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const coreAgents = Array.isArray(domainDef.coreAgents)
      ? domainDef.coreAgents
      : String(domainDef.coreAgents || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (domainDef.createScaffold) relativePath = relativePath || path.join("domains", domains.domainSlug(cleanName));
    const definition = domains.defineDomain(session.project.slug, {
      ...domainDef,
      name: cleanName,
      boundaries: responsibilities,
      responsibilities,
      features,
      coreAgents,
      relativePath,
      sourcePath: relativePath ? path.join(session.project.path, relativePath) : domainDef.sourcePath,
      sourceType: domainDef.sourceType || (relativePath ? "manual-scaffold" : "manual"),
      userConfirmed: domainDef.userConfirmed !== false,
    }, {
      projectPath: session.project.path,
      createScaffold: domainDef.createScaffold !== false,
      createHandoff: domainDef.createHandoff !== false,
    });
    rememberProjectDomain(definition.name, definition.sourceType);
    return { ok: true, definition };
  } catch (e) {
    return { ok: false, reason: e.message, missing: e.missing || null };
  }
});

ipcMain.handle("domain:get", (_e, domainName) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const domain = domains.getDomain(session.project.slug, domainName, { projectPath: session.project.path });
    return { ok: true, domain };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:get_all", () => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const allDomains = domains.getAllDomains(session.project.slug, { projectPath: session.project.path });
    return { ok: true, domains: allDomains };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:add_insight", (_e, domainName, insight) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    domains.addInsight(session.project.slug, domainName, insight);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:get_description", (_e, domainName) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const description = domains.getDomainDescription(session.project.slug, domainName);
    return { ok: true, description };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:ingest", () => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const availableBoards = hermes.listBoards().map(b => b.slug);
    const ingested = domains.ingestDomainsFromProject(session.project.slug, session.project.path, availableBoards);
    return { ok: true, ingested };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:get_path", (_e, domainName) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const domain = domains.getDomain(session.project.slug, domainName, { projectPath: session.project.path });
    if (!domain) return { ok: false, reason: "Domain not found" };

    // sourcePath is already the full path from detection
    const fullPath = domain.sourcePath || null;
    const relativePath = domain.relativePath || null;

    return { 
      ok: true, 
      domain: domainName,
      sourceType: domain.sourceType,
      relativePath: relativePath,
      fullPath: fullPath,
      projectPath: session.project.path
    };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:create_handoff", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domains.createHandoffRecord({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    domain: info.domain || session.domain,
    title: info.title,
    status: info.status || "pending",
    userConfirmation: !!info.userConfirmation,
    sourceLinks: info.sourceLinks || [],
    capturedEntities: info.capturedEntities || [],
    suggestedAgendaItems: info.suggestedAgendaItems || [],
    body: info.body || "",
  });
});

ipcMain.handle("domain:list_handoffs", (_e, domainName) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domains.listHandoffs({ projectPath: session.project.path, domain: domainName || session.domain });
});

ipcMain.handle("domain:create_agenda_item", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domains.createAgendaItem({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    domain: info.domain || session.domain,
    item: info.item || info,
  });
});

ipcMain.handle("domain:propose_agenda_from_handoff", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domains.proposeAgendaFromHandoff({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    domain: info.domain || session.domain,
    handoffId: info.handoffId,
  });
});

ipcMain.handle("domain:save_meeting_artifact", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domains.saveMeetingArtifact({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    domain: info.domain || session.domain,
    room: info.room,
    agenda: info.agenda,
    participants: info.participants,
    expectedOutcome: info.expectedOutcome,
    requirements: info.requirements,
    sourceHandoff: info.sourceHandoff,
    sourceContext: info.sourceContext,
  });
});

ipcMain.handle("domain_architect:start", (_e, seed = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    return { ok: true, session: domainArchitect.start(session.project.slug, seed || {}) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain_architect:get", (_e, id) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  const architectSession = domainArchitect.get(session.project.slug, id);
  return architectSession ? { ok: true, session: architectSession } : { ok: false, reason: "Domain Architect session not found" };
});

ipcMain.handle("domain_architect:answer", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domainArchitect.answer(session.project.slug, info.id, info.answer, info.field);
});

ipcMain.handle("domain_architect:focus", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domainArchitect.focus(session.project.slug, info.id, info.field);
});

ipcMain.handle("domain_architect:deep_dive", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domainArchitect.deepDive(session.project.slug, info.id, info);
});

ipcMain.handle("domain_architect:update", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  return domainArchitect.updateDraft(session.project.slug, info.id, info.patch || {});
});

ipcMain.handle("domain_architect:confirm", (_e, id) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const pkg = domainArchitect.confirmationPackage(session.project.slug, id);
    if (!pkg.ok) return pkg;
    const missing = domains.validateDomainDefinition(pkg.domainPackage);
    if (missing.length) return { ok: false, reason: `Missing required domain fields: ${missing.join(", ")}`, missing, session: pkg.session };
    const definition = domains.defineDomain(session.project.slug, pkg.domainPackage, {
      projectPath: session.project.path,
      createScaffold: true,
      createHandoff: true,
    });
    rememberProjectDomain(definition.name, definition.sourceType);
    domainArchitect.updateDraft(session.project.slug, id, { status: "confirmed" });
    return { ok: true, definition, session: pkg.session };
  } catch (e) {
    return { ok: false, reason: e.message, missing: e.missing || null };
  }
});

// --- IPC: user memory & personalization ---
ipcMain.handle("user:get_memory", () => {
  try {
    const memory = user.getUserMemory();
    return { ok: true, memory };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("user:update_profile", (_e, updates) => {
  try {
    const memory = user.updateProfile(updates);
    return { ok: true, memory };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("user:add_memory", (_e, memory, category) => {
  try {
    const updated = user.addMemory(memory, category);
    return { ok: true, memory: updated };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("user:add_fun_fact", (_e, fact) => {
  try {
    const updated = user.addFunFact(fact);
    return { ok: true, memory: updated };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("user:get_context", () => {
  try {
    const context = user.getUserContext();
    return { ok: true, context };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("user:get_greeting", () => {
  try {
    const greeting = user.getPersonalizedGreeting();
    return { ok: true, greeting };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("user:record_interaction", (_e, type) => {
  try {
    const memory = user.recordInteraction(type);
    return { ok: true, memory };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// --- IPC: agent soul ---
ipcMain.handle("soul:get", () => {
  try {
    const soulContent = soul.getSoul();
    return { ok: true, soul: soulContent };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("soul:update_section", (_e, section, content) => {
  try {
    const updated = soul.updateSoulSection(section, content);
    return { ok: true, soul: updated };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("soul:add_milestone", (_e, milestone) => {
  try {
    const updated = soul.addMilestone(milestone);
    return { ok: true, soul: updated };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("soul:add_memory", (_e, memory) => {
  try {
    const updated = soul.addSoulMemory(memory);
    return { ok: true, soul: updated };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("soul:reflect", (_e, reflection) => {
  try {
    const updated = soul.updateSelfReflection(reflection);
    return { ok: true, soul: updated };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("soul:get_summary", () => {
  try {
    const summary = soul.getSoulSummary();
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// --- IPC: Hermes CEO bridge (kanban board, swarm, room, relay) ---
ipcMain.handle("hermes:status", () => hermes.ceoStatus());
ipcMain.handle("hermes:ensure_up", async () => {
  // The AGUI bridge is the CEO's face — bring it up alongside the CEO.
  try { await aguiServer.start(); } catch (e) { console.warn("[agui] start failed:", e && e.message); }
  return hermes.ensureUp();
});
ipcMain.handle("hermes:boards", () => ({ ok: true, boards: hermes.listBoards(), current: hermes.currentBoard() }));
ipcMain.handle("hermes:boards_for_domain", (_e, domainName) => {
  const allBoards = hermes.listBoards();
  const projectBoard = session.project
    ? allBoards.find(b => b.slug === session.project.slug) ||
      (session.project.slug === "ceo-studio" ? allBoards.find(b => b.slug === "ceo-studio") : null)
    : null;
  let filteredBoards = allBoards;

  if (!domainName || domainName === "All") {
    filteredBoards = projectBoard
      ? [projectBoard, ...allBoards.filter(b => b.slug !== projectBoard.slug)]
      : allBoards;
  }
  
  // If a specific domain is selected (not "All"), filter boards
  if (domainName && domainName !== "All" && session.project) {
    const allDomains = domains.getAllDomains(session.project.slug);
    const selectedDomain = allDomains.find(d => d.name === domainName);
    
    if (selectedDomain && selectedDomain.kanbanBoard) {
      // Domain has a specific board - show that + main project board
      const domainBoard = allBoards.find(b => b.slug === selectedDomain.kanbanBoard);
      
      filteredBoards = [];
      if (domainBoard) filteredBoards.push(domainBoard);
      if (projectBoard && (!domainBoard || projectBoard.slug !== domainBoard.slug)) {
        filteredBoards.push(projectBoard);
      }
    } else {
      // A selected domain without an explicit board should not accidentally
      // bind to the first unrelated board. Fall back to the project/global
      // board only; the user can map a domain board later.
      filteredBoards = projectBoard ? [projectBoard] : [];
    }
  }
  
  return { 
    ok: true, 
    boards: filteredBoards, 
    current: hermes.currentBoard(),
    domain: domainName 
  };
});

// --- Agent Registry ---
function harnessRegistryPath() {
  return path.join(session.project?.path || process.cwd(), "runtime", "harness", "agents", "registry.py");
}

function tmuxAlive(sessionName) {
  if (!sessionName) return false;
  try {
    execFileSync("tmux", ["has-session", "-t", `=${sessionName}`], { stdio: "ignore", timeout: 1500 });
    return true;
  } catch {
    return false;
  }
}

function loadHarnessRegistryAgents() {
  const harnessPath = harnessRegistryPath();
  if (!fs.existsSync(harnessPath)) return [];
  try {
    const raw = execFileSync("python3", [harnessPath, "list", "--format", "json"], {
      encoding: "utf8",
      timeout: 5000,
      cwd: path.dirname(harnessPath),
    });
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    console.warn("[agents] failed to parse harness registry:", e.message);
    return [];
  }
}

function listHarnessPersonas() {
  const root = path.dirname(path.dirname(harnessRegistryPath()));
  const dirs = [
    path.join(root, "agents", "personas"),
    path.join(root, "personas"),
  ];
  const found = new Map();
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.isFile() && entry.name.endsWith(".md")) {
        const id = path.basename(entry.name, ".md");
        if (!found.has(id)) {
          found.set(id, {
            id,
            name: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
            path: p,
            category: path.basename(path.dirname(p)),
          });
        }
      }
    }
  };
  for (const dir of dirs) walk(dir);
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function setHarnessAgentPersona(agentId, personaId) {
  const id = String(agentId || "");
  const persona = String(personaId || "");
  if (!id) return { ok: false, reason: "agent id required" };
  if (!persona) return { ok: false, reason: "persona required" };
  const registryPath = harnessRegistryPath();
  if (!fs.existsSync(registryPath)) return { ok: false, reason: "harness registry not found" };
  const personas = new Set(listHarnessPersonas().map((p) => p.id));
  if (!personas.has(persona)) return { ok: false, reason: `persona not found: ${persona}` };
  const before = fs.readFileSync(registryPath, "utf8");
  const blockRe = new RegExp(`("${id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:\\s*\\{[\\s\\S]*?\\n    \\})`);
  const match = before.match(blockRe);
  if (!match) return { ok: false, reason: `agent not found in registry: ${id}` };
  const nextBlock = match[1].includes('"persona":')
    ? match[1].replace(/"persona":\s*"[^"]*"/, `"persona": "${persona}"`)
    : match[1].replace(/\n    "canonical_room":/, `\n        "persona": "${persona}",\n        "canonical_room":`);
  fs.writeFileSync(registryPath, before.replace(match[1], nextBlock), "utf8");
  return { ok: true, agentId: id, persona };
}

function createHarnessPersona({ id, name, brief } = {}) {
  const cleanId = String(id || name || "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9.-]/g, "");
  if (!cleanId) return { ok: false, reason: "persona name required" };
  const root = path.dirname(path.dirname(harnessRegistryPath()));
  const dir = path.join(root, "personas", "general");
  const personaPath = path.join(dir, `${cleanId}.md`);
  if (!personaPath.startsWith(root + path.sep)) return { ok: false, reason: "invalid persona path" };
  if (fs.existsSync(personaPath)) return { ok: false, reason: `persona already exists: ${cleanId}` };
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(personaPath, [
    `# ${name || cleanId}`,
    "",
    "## Mission",
    "",
    brief || "Define what this persona is responsible for.",
    "",
    "## Operating Style",
    "",
    "- Produce clear plans, tradeoffs, and acceptance criteria.",
    "- Surface uncertainty instead of pretending.",
    "- Keep work visible in the relevant domain room.",
  ].join("\n"), "utf8");
  return { ok: true, persona: { id: cleanId, name: name || cleanId, path: personaPath, category: "general" } };
}

function knownTerminalAgent(agentId) {
  const id = String(agentId || "");
  const agent = loadHarnessRegistryAgents().find((a) => a.id === id);
  if (!agent || !agent.tmux_session) return null;
  const windowName = agent.tmux_window || "main";
  return {
    id: agent.id,
    display_name: agent.display_name || agent.id,
    tmux_session: agent.tmux_session,
    tmux_window: windowName,
    target: `${agent.tmux_session}:${windowName}`,
  };
}

ipcMain.handle("agents:list", () => {
  const agents = [];
  
  // 1. Hermes CEO (always present)
  const hermesStatus = hermes.ceoStatus();
  agents.push({
    id: "hermes-ceo",
    display_name: "Hermes CEO",
    role: "Project CEO / Orchestrator",
    type: "hermes",
    status: hermesStatus.up ? "online" : "offline",
    capabilities: ["orchestration", "planning", "delegation", "kanban_management"],
    mission: "Strategic CEO agent that manages the project via Hermes Kanban",
    room: "main",
    launch_mode: "hermes_profile",
    provider: hermesStatus.profile || "default",
    enabled: true,
    api_cost: "Funded (codex)",
    personas: ["ceo-orchestrator"],
    skills: ["herder-swarm-control", "herder-messaging"],
  });
  
  // 2. Devin subagent profiles
  agents.push({
    id: "devin-explore",
    display_name: "Devin Explorer",
    role: "Codebase exploration & research",
    type: "devin",
    status: "available",
    capabilities: ["codebase_exploration", "research", "read_only"],
    mission: "Read-only subagent for exploring codebases and understanding architecture",
    launch_mode: "subagent",
    profile: "subagent_explore",
    enabled: true,
    api_cost: "Uses same model as main session",
    personas: ["researcher"],
    skills: ["codebase-navigation", "architecture-analysis"],
  });
  
  agents.push({
    id: "devin-general",
    display_name: "Devin General",
    role: "General purpose agent",
    type: "devin",
    status: "available",
    capabilities: ["read", "write", "edit", "command_execution"],
    mission: "General-purpose subagent with full tool access for autonomous tasks",
    launch_mode: "subagent",
    profile: "subagent_general",
    enabled: true,
    api_cost: "Uses same model as main session",
    personas: ["generalist"],
    skills: ["file-operations", "command-execution", "git-operations"],
  });
  
  // 3. Try to load harness agents if available
  try {
    for (const a of loadHarnessRegistryAgents()) {
      const running = tmuxAlive(a.tmux_session);
      agents.push({
        id: a.id,
        display_name: a.display_name || a.id,
        role: a.role || a.role_title_in_room || "Harness agent",
        type: a.launch_mode === "hermes_profile" ? "hermes-profile" : (a.type || "harness"),
        status: running ? "online" : (a.launch_mode === "disabled" || !a.enabled ? "offline" : "external"),
        capabilities: a.capabilities || [],
        mission: a.mission || "",
        launch_mode: a.launch_mode || "external",
        profile: a.profile || "",
        room: a.canonical_room || a.default_room || "",
        enabled: a.enabled !== false,
        api_cost: a.api_cost || "",
        personas: [a.persona].filter(Boolean),
        skills: a.skills || [],
        terminal: {
          available: !!a.tmux_session,
          alive: running,
          session: a.tmux_session || "",
          window: a.tmux_window || "main",
        },
      });
    }
  } catch (e) {
    // Harness not available, skip
  }
  
  return { ok: true, agents };
});

ipcMain.handle("agents:terminal_snapshot", (_e, agentId) => {
  const agent = knownTerminalAgent(agentId);
  if (!agent) return { ok: false, reason: "agent has no known tmux terminal" };
  if (!tmuxAlive(agent.tmux_session)) return { ok: false, reason: `tmux session not running: ${agent.tmux_session}`, agent };
  try {
    const output = execFileSync("tmux", ["capture-pane", "-p", "-S", "-240", "-t", agent.target], {
      encoding: "utf8",
      timeout: 2000,
    });
    return { ok: true, agent, output };
  } catch (e) {
    return { ok: false, reason: e.message, agent };
  }
});

ipcMain.handle("agents:terminal_send", (_e, { agentId, text } = {}) => {
  const agent = knownTerminalAgent(agentId);
  const value = String(text || "");
  if (!agent) return { ok: false, reason: "agent has no known tmux terminal" };
  if (!value.trim()) return { ok: false, reason: "text required" };
  if (!tmuxAlive(agent.tmux_session)) return { ok: false, reason: `tmux session not running: ${agent.tmux_session}`, agent };
  try {
    execFileSync("tmux", ["send-keys", "-t", agent.target, "-l", value], { stdio: "ignore", timeout: 2000 });
    execFileSync("tmux", ["send-keys", "-t", agent.target, "Enter"], { stdio: "ignore", timeout: 2000 });
    return { ok: true, agent };
  } catch (e) {
    return { ok: false, reason: e.message, agent };
  }
});

ipcMain.handle("agents:set_persona", (_e, { agentId, personaId } = {}) => setHarnessAgentPersona(agentId, personaId));
ipcMain.handle("personas:create", (_e, persona = {}) => createHarnessPersona(persona));

// --- Editable file-based personas (markdown), scoped to project + domain ---
// Backed by main/core/personas.js. Generation uses the Gemma utility model
// (Cloudflare AI Gateway -> Vertex), NOT the conversational CEO (Hermes).
ipcMain.handle("personas:files_list", () => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return { ok: true, personas: personas.list(session.project.path, session.domain) };
});
ipcMain.handle("personas:read", (_e, id) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return personas.read(session.project.path, session.domain, id);
});
ipcMain.handle("personas:save", (_e, { id, content } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return personas.save(session.project.path, session.domain, id, content);
});
ipcMain.handle("personas:delete", (_e, id) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return personas.remove(session.project.path, session.domain, id);
});
ipcMain.handle("personas:generate", async (_e, { name, brief, save = false } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  if (!String(name || "").trim()) return { ok: false, reason: "persona name required" };
  const { provider, note } = createUtilityProvider();
  if (provider.id === "null") {
    return { ok: false, reason: note || "no generation model configured (set CF_AI_GATEWAY_URL + CF_API_TOKEN)" };
  }
  const prompt = personas.buildGeneratePrompt(name, brief, session.domain);
  try {
    const { text, usage } = await provider.complete({
      system: "You write crisp, high-signal agent persona briefs in Markdown.",
      messages: [{ role: "user", content: prompt }],
      maxTokens: 1200,
    });
    const content = personas.cleanGenerated(text);
    if (!content) return { ok: false, reason: "model returned empty content" };
    let saved = null;
    if (save) {
      const res = personas.save(session.project.path, session.domain, name, content);
      if (!res.ok) return res;
      saved = res.persona;
    }
    return { ok: true, name, content, saved, model: usage && usage.model };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// --- Personas & Skills ---
ipcMain.handle("personas:list", () => {
  const builtin = [
    {
      id: "ceo-orchestrator",
      name: "CEO Orchestrator",
      description: "Top-level strategic orchestrator for project management",
      responsibilities: ["Strategic planning", "Task decomposition", "Resource allocation"],
      typical_agents: ["hermes-ceo", "kanban-orchestrator"],
    },
    {
      id: "swarm-facilitator",
      name: "Swarm Facilitator",
      description: "Coordinates swarm of specialist agents in domain rooms",
      responsibilities: ["Agent coordination", "Communication hub", "Swarm visibility"],
      typical_agents: ["swarm-facilitator"],
    },
    {
      id: "architect",
      name: "Systems Architect",
      description: "Owns technical decisions, data models, and system boundaries",
      responsibilities: ["Technical specifications", "ADR writing", "Interface contracts"],
      typical_agents: ["grok-builder"],
    },
    {
      id: "researcher",
      name: "Deep Researcher",
      description: "Specializes in research, evidence gathering, and synthesis",
      responsibilities: ["Research briefs", "Evidence mapping", "Uncertainty analysis"],
      typical_agents: ["devin-explore", "grok-research"],
    },
    {
      id: "builder",
      name: "Builder",
      description: "General implementer and executor of technical tasks",
      responsibilities: ["Implementation", "Code review", "Testing"],
      typical_agents: ["grok-builder", "devin-general"],
    },
    {
      id: "planner",
      name: "Planner",
      description: "Creates detailed plans and specifications",
      responsibilities: ["Task planning", "Specification writing", "Breakdown"],
      typical_agents: ["kanban-orchestrator"],
    },
    {
      id: "generalist",
      name: "Generalist",
      description: "Flexible agent capable of various tasks",
      responsibilities: ["General tasks", "Ad-hoc work", "Support"],
      typical_agents: ["devin-general"],
    },
  ];
  
  const merged = new Map(builtin.map((p) => [p.id, p]));
  for (const p of listHarnessPersonas()) {
    merged.set(p.id, {
      ...p,
      description: `Harness persona file (${p.category})`,
      responsibilities: [],
      typical_agents: [],
      source: "harness",
    });
  }
  return { ok: true, personas: [...merged.values()] };
});

ipcMain.handle("skills:list", () => ({ ok: true, skills: skillCatalog.list((session.project && session.project.path) || null) }));
ipcMain.handle("skills:route", (_e, info = {}) => skillCatalog.route((session.project && session.project.path) || null, info || {}));
ipcMain.handle("hermes:board", (_e, slug) => hermes.getBoard(slug));
ipcMain.handle("hermes:task_detail", (_e, slug, id) => hermes.getTask(slug, id));
ipcMain.handle("hermes:stats", (_e, slug) => hermes.getStats(slug));
ipcMain.handle("hermes:swarm", (_e, slug) => hermes.getSwarm(slug));
ipcMain.handle("hermes:room", (_e, slug, limit) => hermes.getRoom(slug, limit));
ipcMain.handle("hermes:ask", async (_e, message) => {
  // Gate on the global kill switch so a runaway voice loop can't hammer the CEO.
  if (session.cost && !session.cost.canProceed().ok) {
    return { ok: false, reason: "Halted by cost guardrail" };
  }
  const contextBits = [];
  if (session.project) contextBits.push(`Project: ${session.project.name || session.project.slug || "unknown"}`);
  if (session.domain) contextBits.push(`Domain: ${session.domain}`);
  if (session.focusedTask && session.focusedTask.taskId) {
    contextBits.push(`Focused task: ${session.focusedTask.taskTitle || session.focusedTask.taskId} (ID: ${session.focusedTask.taskId}, status: ${session.focusedTask.taskStatus || "unknown"}, board: ${session.focusedTask.board || "unknown"})`);
  }
  const msg = contextBits.length ? `[Context: ${contextBits.join(" | ")}]

${message}` : message;
  return hermes.ask(msg);
});
// Config panel: read config + authed providers/models, switch model, gateway control
ipcMain.handle("hermes:config", () => hermes.getConfig());
ipcMain.handle("hermes:set_model", (_e, provider, model, profileId) => hermes.setModel({ provider, model, profileId }));
ipcMain.handle("hermes:set_personality", (_e, personality, profileId) => hermes.setPersonality({ personality, profileId }));
ipcMain.handle("hermes:set_profile", (_e, profileId) => hermes.setProfile(profileId));
ipcMain.handle("hermes:gateway_start", async () => {
  // Starting the CEO should also bring up its AGUI face (idempotent).
  try { await aguiServer.start(); } catch (e) { console.warn("[agui] start failed:", e && e.message); }
  return hermes.gatewayStart();
});
ipcMain.handle("hermes:gateway_stop", () => hermes.gatewayStop());
ipcMain.handle("hermes:focus_task", (_e, taskInfo) => {
  session.focusedTask = taskInfo || null;
  return hermes.focusTask(taskInfo);
});
ipcMain.handle("hermes:add_task", (_e, taskInfo) => hermes.addTask(taskInfo));
ipcMain.handle("hermes:assign_task", (_e, taskInfo) => hermes.assignTask(taskInfo));
ipcMain.handle("hermes:task_action", (_e, actionInfo) => hermes.taskAction(actionInfo));
ipcMain.handle("hermes:dispatch", (_e, dispatchInfo) => hermes.dispatch(dispatchInfo));
ipcMain.handle("hermes:task_log", (_e, logInfo) => hermes.taskLog(logInfo));
ipcMain.handle("hermes:assignees", (_e, board) => hermes.assignees({ board }));
ipcMain.handle("hermes:comment_task", (_e, commentInfo) => hermes.addComment(commentInfo));
function boardForDomain(explicitBoard, domainName) {
  if (explicitBoard) return explicitBoard;
  if (!session.project || !domainName || domainName === "All") return null;
  const domain = domains.getDomain(session.project.slug, domainName, { projectPath: session.project.path });
  return domain && domain.kanbanBoard ? domain.kanbanBoard : null;
}
ipcMain.handle("domain_board:create_brief", (_e, brief = {}) =>
  domainBoard.createBrief({
    ...brief,
    domain: brief.domain || session.domain || "All",
    board: boardForDomain(brief.board, brief.domain || session.domain || "All"),
    projectPath: session.project && session.project.path,
    source: brief.source || "CEO Studio voice/planner intake",
  }, { projectSlug: session.project && session.project.slug }));
ipcMain.handle("domain_board:create_bug", (_e, bug = {}) =>
  domainBoard.createBug({
    ...bug,
    domain: bug.domain || session.domain || "All",
    board: boardForDomain(bug.board, bug.domain || session.domain || "All"),
    projectPath: session.project && session.project.path,
    source: bug.source || "CEO Studio voice/planner intake",
  }, { projectSlug: session.project && session.project.slug }));
ipcMain.handle("domain_board:create_child_task", (_e, task = {}) =>
  domainBoard.createChildTask({
    ...task,
    domain: task.domain || session.domain || "All",
    board: boardForDomain(task.board, task.domain || session.domain || "All"),
    projectPath: session.project && session.project.path,
    requestedBy: task.requestedBy || "voice/planner",
  }, { projectSlug: session.project && session.project.slug }));
ipcMain.handle("domain_board:record_asset", (_e, asset = {}) =>
  domainBoard.recordAsset({
    ...asset,
    requestedBy: asset.requestedBy || "voice/planner",
  }, { projectSlug: session.project && session.project.slug }));
ipcMain.handle("domain_board:decompose_brief", (_e, info = {}) =>
  domainBoard.decomposeBrief(info, { projectSlug: session.project && session.project.slug }));

// Conversational brief intake: distill a free-form description into a canonical
// brief draft (Hermes-backed) + report missing required fields. Creation stays
// gated behind domain_board:create_brief; this only drafts for human review.
ipcMain.handle("brief_intake:draft", (_e, info = {}) =>
  briefIntake.draftBrief({
    description: info.description,
    known: info.known || {},
    domainHint: info.domainHint || session.domain || "All",
  }));

// New sectional decomposer (proposal + apply) – see brief-sectional-decomposer.md in Domain Lifecycle
ipcMain.handle("domain_board:propose_brief_decomposition", (_e, info = {}) =>
  domainBoard.proposeSectionalBreakdown({
    ...info,
    projectPath: session.project && session.project.path,
    projectSlug: session.project && session.project.slug,
  }));

ipcMain.handle("domain_board:apply_brief_decomposition", (_e, proposal = {}) =>
  domainBoard.applySectionalDecomposition(proposal, { projectSlug: session.project && session.project.slug }));

function briefRunWorkspace(board, taskId) {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const boardSlug = String(board || "").trim();
  const id = String(taskId || "").trim();
  if (!boardSlug || !id) return { ok: false, reason: "board and taskId required" };
  const detail = hermes.getTask(boardSlug, id);
  const task = detail && detail.ok ? detail.task : null;
  let run = briefRuns.read(session.project.slug, boardSlug, id)
    || (task ? briefRuns.ensureFromTask(session.project.slug, boardSlug, task) : null);
  if (!run) {
    return {
      ok: true,
      applicable: false,
      reason: task ? "task is not a brief" : ((detail && detail.reason) || "task not found"),
      task: task || null,
    };
  }
  const linkedSessions = sessions.forBrief(session.project.slug, boardSlug, id);
  const registryAgents = registry.read(session.project.path).agents || [];
  const registryById = new Map(registryAgents.map((agent) => [agent.id, agent]));
  const activeAgentMap = new Map();
  const addActiveAgent = ({ agentId, role, status, sessionId, tmuxSession } = {}) => {
    const aid = String(agentId || "").trim();
    if (!aid) return;
    const registered = registryById.get(aid) || {};
    const terminalSession = tmuxSession || registered.tmux_session || "";
    const terminalWindow = registered.tmux_window || "main";
    const existing = activeAgentMap.get(aid) || {};
    activeAgentMap.set(aid, {
      ...existing,
      agentId: aid,
      name: registered.name || registered.display_name || aid,
      role: role || existing.role || "agent",
      status: status || existing.status || "unknown",
      sessionId: sessionId || existing.sessionId || null,
      provider: registered.provider || existing.provider || "",
      model: registered.model || existing.model || "",
      terminal: {
        available: !!terminalSession,
        alive: !!terminalSession && mount.alive(terminalSession),
        session: terminalSession,
        window: terminalWindow,
      },
    });
  };
  for (const studioSession of linkedSessions) {
    if (studioSession.leadAgentId) {
      addActiveAgent({
        agentId: studioSession.leadAgentId,
        role: "lead",
        status: studioSession.phase === "done" ? "done" : "active",
        sessionId: studioSession.id,
      });
    }
    for (const worker of studioSession.workers || []) {
      addActiveAgent({
        agentId: worker.agentId,
        role: worker.role || "worker",
        status: worker.status || "unknown",
        tmuxSession: worker.tmuxSession || null,
        sessionId: studioSession.id,
      });
    }
  }
  const activeAgents = [...activeAgentMap.values()];
  const meetingMatchesRun = (meeting) => meeting && meeting.briefRef
    && meeting.briefRef.board === boardSlug
    && meeting.briefRef.taskId === id;
  const meetingMap = new Map();
  for (const meeting of run.meetings || []) {
    if (meeting && meeting.id) meetingMap.set(meeting.id, meeting);
  }
  for (const scheduled of meetings.listScheduled(session.project.path).meetings || []) {
    if (meetingMatchesRun(scheduled)) {
      meetingMap.set(scheduled.id, { ...(meetingMap.get(scheduled.id) || {}), ...scheduled });
    }
  }
  let linkedMeetings = [...meetingMap.values()].map((meeting) => {
    const roomState = meeting.room
      ? meetings.room({ projectPath: session.project.path, room: meeting.room })
      : null;
    const status = roomState && roomState.started
      ? (roomState.running ? "running" : "done")
      : (meeting.status || "scheduled");
    return {
      ...meeting,
      status,
      transcript: roomState && roomState.ok ? (roomState.feed || []).slice(-8) : [],
      requirements: roomState && roomState.ok ? roomState.requirements : null,
      requirementsPath: meeting.room && roomState && roomState.requirements
        ? path.relative(session.project.path, path.join(meetings.roomDir(session.project.path, meeting.room), "requirements.md")).replace(/\\/g, "/")
        : "",
      running: !!(roomState && roomState.running),
    };
  }).sort((a, b) => String(b.startedAt || b.scheduledFor || b.createdAt || "").localeCompare(String(a.startedAt || a.scheduledFor || a.createdAt || "")));

  for (const meeting of linkedMeetings) {
    if (!meeting.requirements) continue;
    const built = meetingSynthesis.build({ meeting, requirements: meeting.requirements });
    if (built.ok) briefRuns.upsertMeetingSynthesis(session.project.slug, boardSlug, id, built.synthesis);
  }
  run = briefRuns.read(session.project.slug, boardSlug, id) || run;
  const meetingSyntheses = run.meetingSyntheses || [];
  const synthesisByMeeting = new Map(meetingSyntheses.map((item) => [item.meetingId, item]));
  linkedMeetings = linkedMeetings.map((meeting) => {
    const synthesis = synthesisByMeeting.get(meeting.id);
    return {
      ...meeting,
      synthesisId: synthesis?.id || null,
      synthesisStatus: synthesis?.status || null,
      pendingProposalCount: (synthesis?.proposals || []).filter((item) => item.status === "pending").length,
    };
  });

  const completedWork = [...(run.completionSummaries || [])];
  for (const studioSession of linkedSessions.filter((item) => item.phase === "done")) {
    const lastAssistant = [...(studioSession.transcript || [])].reverse()
      .find((entry) => entry && entry.role === "assistant" && String(entry.content || entry.body || "").trim());
    completedWork.push({
      id: `session:${studioSession.id}`,
      title: studioSession.title,
      body: studioSession.planDoc?.overview
        || String(lastAssistant?.content || lastAssistant?.body || "").trim().slice(0, 600)
        || "Studio session completed.",
      source: "studio-session",
      sessionId: studioSession.id,
      createdAt: studioSession.updatedAt || studioSession.createdAt,
    });
  }
  for (const child of (run.childTasks || []).slice(-30)) {
    const childBoard = child.board || boardSlug;
    const detailResult = child.id ? hermes.getTask(childBoard, child.id) : null;
    const childTask = detailResult && detailResult.ok ? detailResult.task : child;
    if (childTask && ["done", "completed"].includes(String(childTask.status || "").toLowerCase())) {
      completedWork.push({
        id: `task:${child.id}`,
        title: childTask.title || child.title || child.id,
        body: childTask.body || "Hermes child task completed.",
        source: "hermes-task",
        taskId: child.id,
        board: childBoard,
        createdAt: childTask.completed_at || childTask.updatedAt || child.createdAt,
      });
    }
  }
  const completedById = new Map();
  for (const item of completedWork) {
    if (item && item.id) completedById.set(item.id, item);
  }
  return {
    ok: true,
    applicable: true,
    run,
    sessions: linkedSessions,
    activeAgents,
    meetings: linkedMeetings,
    meetingSyntheses,
    agendaItems: run.agendaItems || [],
    assets: run.assets || [],
    completedWork: [...completedById.values()],
    task: task || null,
  };
}

ipcMain.handle("brief_runs:get", (_e, { board, taskId } = {}) =>
  briefRunWorkspace(board, taskId));
ipcMain.handle("brief_runs:update", (_e, { board, taskId, patch } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const result = briefRuns.update(session.project.slug, board, taskId, patch || {});
  return result.ok ? briefRunWorkspace(board, taskId) : result;
});

function synthesizeBriefRunMeeting(board, taskId, meetingId) {
  const workspace = briefRunWorkspace(board, taskId);
  if (!workspace.ok || !workspace.applicable) return workspace;
  const meeting = (workspace.meetings || []).find((item) => item.id === meetingId);
  if (!meeting) return { ok: false, reason: "linked meeting not found" };
  if (!meeting.requirements) return { ok: false, reason: "meeting has not produced requirements yet" };
  const built = meetingSynthesis.build({ meeting, requirements: meeting.requirements });
  if (!built.ok) return built;
  const saved = briefRuns.upsertMeetingSynthesis(session.project.slug, board, taskId, built.synthesis);
  return saved.ok
    ? { ok: true, changed: saved.changed, synthesis: saved.synthesis, workspace: briefRunWorkspace(board, taskId) }
    : saved;
}

ipcMain.handle("brief_runs:meeting_synthesize", (_e, { board, taskId, meetingId } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return synthesizeBriefRunMeeting(board, taskId, meetingId);
});

function proposalSourcePath(proposal) {
  return String(proposal?.source?.requirementsPath || "").trim();
}

function materializeMeetingProposal({ board, taskId, synthesis, proposal, reviewedBy }) {
  const run = briefRuns.read(session.project.slug, board, taskId);
  if (!run) return { ok: false, reason: "brief run not found" };
  const sourcePath = proposalSourcePath(proposal);
  const common = {
    id: proposal.id,
    title: proposal.title,
    body: proposal.body,
    source: "meeting-synthesis",
    meetingId: synthesis.meetingId,
    room: synthesis.room,
    sourcePath,
  };
  let result;
  if (proposal.type === "decision") {
    result = briefRuns.update(session.project.slug, board, taskId, {
      decision: common,
      eventType: "meeting_decision_approved",
      actor: reviewedBy,
      summary: proposal.title,
    });
  } else if (proposal.type === "evidence") {
    result = briefRuns.update(session.project.slug, board, taskId, {
      evidenceItem: common,
      eventType: "meeting_evidence_approved",
      actor: reviewedBy,
      summary: proposal.title,
    });
    if (result.ok && sourcePath) {
      provenance.recordAsset(session.project.slug, {
        parentKind: "brief",
        parentId: taskId,
        assetKind: "meeting_requirements",
        assetId: `${synthesis.id}:requirements`,
        title: synthesis.title,
        path: sourcePath,
        summary: proposal.body,
        source: { system: "meeting-synthesis", actor: reviewedBy },
      });
    }
  } else if (proposal.type === "completion") {
    result = briefRuns.update(session.project.slug, board, taskId, {
      completionSummary: common,
      eventType: "meeting_completion_approved",
      actor: reviewedBy,
      summary: proposal.title,
    });
  } else if (proposal.type === "agenda") {
    const domainResult = domains.createAgendaItem({
      projectSlug: session.project.slug,
      projectPath: session.project.path,
      domain: run.domain,
      item: {
        id: proposal.id,
        title: proposal.title,
        type: "meeting",
        status: "approved",
        source: synthesis.id,
        parentRef: taskId,
        humanAttention: false,
        expectedOutcome: proposal.body,
        outputArtifact: sourcePath,
        body: proposal.body,
        provenance: [`kanban:${board}/${taskId}`, sourcePath].filter(Boolean),
      },
    });
    if (!domainResult.ok) return domainResult;
    result = briefRuns.update(session.project.slug, board, taskId, {
      agendaItem: { ...domainResult.agendaItem, body: proposal.body },
      eventType: "meeting_agenda_approved",
      actor: reviewedBy,
      summary: proposal.title,
    });
  } else if (proposal.type === "blocker") {
    const comment = hermes.addComment({
      board,
      taskId,
      author: "CEO Studio Meeting Review",
      body: [
        "## Approved Meeting Blocker",
        "",
        proposal.body,
        "",
        `Source meeting: ${synthesis.room || synthesis.meetingId}`,
        sourcePath ? `Evidence: ${sourcePath}` : "",
        `Approved by: ${reviewedBy}`,
      ].filter(Boolean).join("\n"),
    });
    if (!comment.ok) return comment;
    const blocked = hermes.taskAction({
      board,
      taskId,
      action: "block",
      reason: `Approved meeting blocker: ${proposal.title}`,
    });
    boardOverlay.writeTask(session.project.slug, board, taskId, {
      blocker: {
        type: "meeting_synthesis",
        reason: proposal.body,
        sourceMeetingId: synthesis.meetingId,
        sourceRoom: synthesis.room,
        evidencePath: sourcePath,
        approvedBy: reviewedBy,
        approvedAt: new Date().toISOString(),
      },
    });
    result = briefRuns.update(session.project.slug, board, taskId, {
      status: "blocked",
      eventType: "meeting_blocker_approved",
      actor: reviewedBy,
      summary: proposal.title,
    });
  } else {
    return { ok: false, reason: `unsupported meeting proposal type: ${proposal.type}` };
  }
  if (!result || !result.ok) return result || { ok: false, reason: "proposal materialization failed" };
  provenance.append(session.project.slug, {
    type: "meeting_proposal_materialized",
    source: { system: "meeting-synthesis", actor: reviewedBy },
    parent: provenance.ref("brief", taskId, { board }),
    child: provenance.ref(proposal.type, proposal.id, { title: proposal.title }),
    metadata: {
      synthesisId: synthesis.id,
      meetingId: synthesis.meetingId,
      room: synthesis.room,
      requirementsPath: sourcePath,
    },
  });
  return { ok: true, kind: proposal.type, result };
}

ipcMain.handle("brief_runs:meeting_proposal_action", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const board = String(info.board || "").trim();
  const taskId = String(info.taskId || "").trim();
  const synthesisId = String(info.synthesisId || "").trim();
  const proposalId = String(info.proposalId || "").trim();
  const action = String(info.action || "").trim();
  const reviewedBy = String(info.approvedBy || "human").trim();
  const run = briefRuns.read(session.project.slug, board, taskId);
  const synthesis = (run?.meetingSyntheses || []).find((item) => item.id === synthesisId);
  const proposal = (synthesis?.proposals || []).find((item) => item.id === proposalId);
  if (!synthesis || !proposal) return { ok: false, reason: "meeting proposal not found" };
  if (proposal.status !== "pending") {
    return { ok: true, unchanged: true, proposal, workspace: briefRunWorkspace(board, taskId) };
  }
  if (action === "reject") {
    const rejected = briefRuns.updateMeetingProposal(
      session.project.slug,
      board,
      taskId,
      synthesisId,
      proposalId,
      { status: "rejected", reviewedBy, result: { ok: true, action: "rejected" } },
    );
    return rejected.ok ? { ok: true, proposal: rejected.proposal, workspace: briefRunWorkspace(board, taskId) } : rejected;
  }
  if (action !== "approve") return { ok: false, reason: "action must be approve or reject" };
  if (info.humanApproved !== true) return { ok: false, reason: "explicit human approval required" };
  const materialized = materializeMeetingProposal({ board, taskId, synthesis, proposal, reviewedBy });
  if (!materialized.ok) return materialized;
  const approved = briefRuns.updateMeetingProposal(
    session.project.slug,
    board,
    taskId,
    synthesisId,
    proposalId,
    {
      status: "materialized",
      reviewedBy,
      result: { ok: true, kind: materialized.kind },
    },
  );
  return approved.ok
    ? { ok: true, proposal: approved.proposal, materialized, workspace: briefRunWorkspace(board, taskId) }
    : approved;
});

function briefRunMeetingPayload(board, taskId, info = {}) {
  const workspace = briefRunWorkspace(board, taskId);
  if (!workspace.ok || !workspace.applicable) return { workspace, payload: null };
  const run = workspace.run;
  const title = String(info.title || `${run.title} working room`).trim();
  const agenda = String(info.agenda || `Review progress, risks, decisions, and next actions for Brief Run ${run.id}.`).trim();
  const assetLines = (workspace.assets || []).slice(-12)
    .map((asset) => `- ${asset.title || asset.path || asset.id}${asset.path ? ` (${asset.path})` : ""}`);
  const context = [
    "## Brief Run Context",
    `- Run: ${run.id}`,
    `- Goal: ${run.brief?.goal || ""}`,
    `- Current state: ${run.brief?.currentRenderedState || ""}`,
    `- Next action: ${run.brief?.nextAction || ""}`,
    assetLines.length ? "### Context Assets" : "",
    ...assetLines,
  ].filter(Boolean).join("\n");
  const members = String(info.members || workspace.activeAgents.map((agent) => agent.agentId).filter(Boolean).join(",") || "ceo").trim();
  return {
    workspace,
    payload: {
      title,
      domain: run.domain || "All",
      agenda: `${agenda}\n\n${context}`,
      criteria: String(info.criteria || "A decision record, proposed Agenda Items, blockers, and named next actions.").trim(),
      team: String(info.team || "").trim(),
      members,
      allowPaid: info.allowPaid === true,
      sourceContext: workspace.assets || [],
      briefRef: { board, taskId, runId: run.id },
    },
  };
}

ipcMain.handle("brief_runs:meeting_start", (_e, { board, taskId, info } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const prepared = briefRunMeetingPayload(board, taskId, info || {});
  if (!prepared.payload) return prepared.workspace;
  const room = String(info?.room || `brief-${taskId}-${Date.now()}`).trim();
  const started = meetings.start({ ...prepared.payload, room, projectPath: session.project.path });
  if (!started || !started.ok) return started;
  const meeting = {
    ...prepared.payload,
    id: `room:${started.room}`,
    room: started.room,
    status: "running",
    startedAt: new Date().toISOString(),
  };
  briefRuns.update(session.project.slug, board, taskId, {
    meeting,
    eventType: "brief_meeting_started",
    actor: "CEO Studio",
    summary: meeting.title,
  });
  return { ...started, meeting, workspace: briefRunWorkspace(board, taskId) };
});

ipcMain.handle("brief_runs:meeting_schedule", (_e, { board, taskId, info } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const prepared = briefRunMeetingPayload(board, taskId, info || {});
  if (!prepared.payload) return prepared.workspace;
  const scheduled = meetings.scheduleMeeting({
    projectPath: session.project.path,
    meeting: {
      ...prepared.payload,
      scheduledFor: info?.scheduledFor,
      recurrence: info?.recurrence || "none",
    },
  });
  if (!scheduled || !scheduled.ok) return scheduled;
  briefRuns.update(session.project.slug, board, taskId, {
    meeting: scheduled.meeting,
    eventType: "brief_meeting_scheduled",
    actor: "CEO Studio",
    summary: scheduled.meeting.title,
  });
  return { ...scheduled, workspace: briefRunWorkspace(board, taskId) };
});

ipcMain.handle("brief_runs:meeting_start_scheduled", (_e, { board, taskId, meetingId } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const started = meetings.startScheduled({ projectPath: session.project.path, id: meetingId });
  if (!started || !started.ok) return started;
  const meeting = {
    ...(started.meeting || {}),
    id: `${meetingId}:${started.room}`,
    scheduleId: meetingId,
    room: started.room,
    status: "running",
  };
  briefRuns.update(session.project.slug, board, taskId, {
    meeting,
    eventType: "brief_scheduled_meeting_started",
    actor: "CEO Studio",
    summary: meeting.title || meetingId,
  });
  return { ...started, meeting, workspace: briefRunWorkspace(board, taskId) };
});
ipcMain.handle("provenance:graph", (_e, parentId) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return provenance.graph(session.project.slug, parentId);
});
ipcMain.handle("orchestration:summary", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return orchestrationOrg.summary(session.project.path, { domain: info.domain || session.domain || "All" });
});
ipcMain.handle("orchestration:route", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return orchestrationOrg.route(session.project.path, {
    domain: info.domain || session.domain || "All",
    status: info.status,
    kind: info.kind,
  });
});
ipcMain.handle("goals:list", (_e, filters = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return goals.summary(session.project.slug, filters || {});
});
ipcMain.handle("goals:upsert", (_e, goal = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return goals.upsert(session.project.slug, goal || {});
});
ipcMain.handle("goals:link_work", (_e, link = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return goals.linkWork(session.project.slug, link || {});
});
ipcMain.handle("goals:review", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const domainName = info.domain || session.domain || "All";
  return goalReview.run({
    projectSlug: session.project.slug,
    board: boardForDomain(info.board, domainName) || info.board,
    layer: info.layer,
    domain: domainName,
    dryRun: !!info.dryRun,
  });
});
ipcMain.handle("autonomy:analyze_blocked", (_e, info = {}) => {
  const domainName = info.domain || session.domain || "All";
  return autonomy.analyzeBlocked({
    board: boardForDomain(info.board, domainName) || info.board,
    projectSlug: session.project && session.project.slug,
    projectPath: session.project && session.project.path,
    domain: domainName,
    dryRun: !!info.dryRun,
    limit: info.limit,
  });
});
ipcMain.handle("autonomy:status", () => autonomyStatus());
ipcMain.handle("autonomy:configure", (_e, patch = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const result = autonomyLoop.setPolicy(session.project.slug, patch || {});
  if (autonomyTimer) {
    stopAutonomyTimer();
    const ms = Math.max(1, result.policy.intervalMinutes) * 60 * 1000;
    autonomyTimer = setInterval(() => {
      const domainName = session.domain || "All";
      autonomyLoop.runCycle({
        projectSlug: session.project.slug,
        projectPath: session.project.path,
        board: boardForDomain(null, domainName) || hermes.currentBoard(),
        domain: domainName,
      });
    }, ms);
    if (autonomyTimer.unref) autonomyTimer.unref();
  }
  return { ...result, running: !!autonomyTimer };
});
ipcMain.handle("autonomy:run_cycle", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const domainName = info.domain || session.domain || "All";
  return autonomyLoop.runCycle({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    board: boardForDomain(info.board, domainName) || info.board || hermes.currentBoard(),
    domain: domainName,
    force: !!info.force,
  });
});
ipcMain.handle("autonomy:start", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const configured = autonomyLoop.setPolicy(session.project.slug, { ...(info.policy || {}), enabled: true });
  stopAutonomyTimer();
  const ms = Math.max(1, configured.policy.intervalMinutes) * 60 * 1000;
  autonomyTimer = setInterval(() => {
    const domainName = session.domain || "All";
    autonomyLoop.runCycle({
      projectSlug: session.project.slug,
      projectPath: session.project.path,
      board: boardForDomain(info.board, domainName) || info.board || hermes.currentBoard(),
      domain: domainName,
    });
  }, ms);
  if (autonomyTimer.unref) autonomyTimer.unref();
  return { ok: true, running: true, policy: configured.policy };
});
ipcMain.handle("autonomy:stop", () => {
  stopAutonomyTimer();
  if (session.project) autonomyLoop.setPolicy(session.project.slug, { enabled: false });
  return { ok: true, running: false };
});

// --- Autonomy Runner: the self-driving swarm loop (plan -> assign -> Devin
// execute -> review/test gate). Drives all boards from inside the app. ---
ipcMain.handle("runner:status", () => {
  if (!session.project) return { ok: false, reason: "open a project first", running: false };
  return { ...autonomyRunner.status(session.project.slug), running: !!runnerTimer };
});
// Oversight inventory: every task's true disposition (delivered / open-pr /
// in-review / needs-human / stranded / DIVERGED / live). Read-only; spawns
// nothing. This is the visibility surface that stops work from being silently
// abandoned.
ipcMain.handle("runner:report", () => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return autonomyRunner.report({ projectSlug: session.project.slug, projectPath: session.project.path });
});
ipcMain.handle("runner:configure", (_e, patch = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const configured = autonomyRunner.setPolicy(session.project.slug, patch || {});
  if (runnerTimer) {
    if (configured.policy.enabled) startRunnerTimer(session.project, configured.policy);
    else stopRunnerTimer();
  }
  return { ...configured, running: !!runnerTimer };
});
ipcMain.handle("runner:run_once", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return runRunnerCycle(autonomyRunner.policyFromRequest(info), { force: true });
});
ipcMain.handle("runner:start", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const configured = autonomyRunner.setPolicy(session.project.slug, { ...(info.policy || {}), enabled: true });
  // Kick a first cycle immediately so the swarm starts without waiting an interval.
  const first = runRunnerCycle({}, { force: true });
  startRunnerTimer(session.project, configured.policy);
  return { ok: true, running: true, policy: configured.policy, firstCycle: first };
});
ipcMain.handle("runner:stop", () => {
  stopRunnerTimer();
  if (session.project) autonomyRunner.setPolicy(session.project.slug, { enabled: false });
  return { ok: true, running: false };
});
ipcMain.handle("notifications:list", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first", notifications: [], unread: 0 };
  return notifications.list(session.project.slug, info || {});
});
ipcMain.handle("notifications:ack", (_e, id) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return notifications.acknowledge(session.project.slug, id);
});
ipcMain.handle("self_repair:report_bug", (_e, bug = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const domainName = bug.domain || session.domain || "Engineering";
  return selfRepair.reportSystemBug({
    ...bug,
    domain: domainName,
    board: boardForDomain(bug.board, domainName) || bug.board,
    requestedBy: bug.requestedBy || "voice/planner",
  }, { projectSlug: session.project.slug, projectPath: session.project.path });
});
ipcMain.handle("self_repair:consult", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const domainName = info.domain || session.domain || "Engineering";
  const request = String(info.request || info.observedBehavior || info.title || "Diagnose and repair the reported issue.").trim();
  const source = String(info.source || "voice-agent self-repair request").trim();
  const result = selfRepair.reportSystemBug({
    ...info,
    domain: domainName,
    board: boardForDomain(info.board, domainName) || info.board,
    source,
    observedBehavior: info.observedBehavior || request,
    expectedBehavior: info.expectedBehavior || "The self-repair engineer should diagnose the issue or improvement, implement a verified fix when appropriate, log evidence, and commit the work.",
    severity: info.severity || "medium",
    createRepairTask: info.createRepairTask !== false,
    requestedBy: info.requestedBy || "voice-agent/self-repair-consult",
  }, { projectSlug: session.project.slug, projectPath: session.project.path });
  if (!result || !result.ok) return result;
  const bugId = result.bug && result.bug.task && result.bug.task.taskId;
  const repairTaskId = result.repairTask && result.repairTask.task && result.repairTask.task.taskId;
  const target = "self-repair-engineer";
  const plan = mount.lookup(_projPath(), target);
  const room = (plan && (plan.canonical_room || plan.default_room)) || "self-repair";
  const sessionName = (plan && plan.tmux_session) || `pipe-${target}`;
  let mountResult = null;
  if (info.autoMount !== false && !mount.alive(sessionName)) {
    mountResult = mount.mount(_projPath(), target);
  }
  const message = selfRepair.buildConsultMessage({
    request,
    source,
    bugId,
    repairTaskId,
    bugTitle: info.title || (result.bug && result.bug.task && result.bug.task.title),
    severity: info.severity || "medium",
    evidence: info.evidence || info.output || info.evidencePath,
  });
  const post = mount.post(_projPath(), room, "Voice Agent", message);
  return { ...result, room, post, mount: mountResult, message, target };
});
// AGUI: the local AG-UI server URL the renderer's HttpAgent connects to.
ipcMain.handle("agui:url", () => aguiServer.url());

// --- Studio sessions (build / deep-dive containers) ---
function _studioSlug() {
  return session.project && session.project.slug;
}
function _studioPath() {
  return session.project && session.project.path;
}
ipcMain.handle("sessions:list", () => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.list(slug);
});
ipcMain.handle("sessions:get", (_e, id) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.get(slug, id);
});
ipcMain.handle("sessions:create", (_e, info = {}) => {
  const slug = _studioSlug();
  const projectPath = _studioPath();
  if (!slug) return { ok: false, reason: "open a project first" };
  const requestedLead = String(info.leadAgentId || "").trim();
  const registeredAgents = registry.read(projectPath).agents || [];
  const leadAgentId = registeredAgents.some((agent) => agent.id === requestedLead) ? requestedLead : "ceo";
  const r = sessions.create(slug, { ...info, leadAgentId });
  if (r.ok && projectPath) {
    if (r.session.briefRef) {
      briefRuns.update(slug, r.session.briefRef.board, r.session.briefRef.taskId, {
        sessionId: r.session.id,
        eventType: "studio_session_created",
        actor: "CEO Studio",
        summary: r.session.title,
      });
    }
    meetings.post({
      projectPath,
      room: r.session.room,
      speaker: "Facilitator",
      body: `Studio session "${r.session.title}" created${r.session.briefRef ? ` for Brief Run ${r.session.briefRef.runId}` : ""}. Lead: ${r.session.leadAgentId}. Phase: explore. Live room loop is manual.`,
    });
  }
  return r;
});
ipcMain.handle("sessions:update", (_e, { id, patch } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  const before = sessions.get(slug, id);
  const result = sessions.update(slug, id, patch || {});
  if (result.ok && result.session.briefRef && result.session.phase === "done" && before.session?.phase !== "done") {
    const lastAssistant = [...(result.session.transcript || [])].reverse()
      .find((entry) => entry && entry.role === "assistant" && String(entry.content || entry.body || "").trim());
    briefRuns.update(slug, result.session.briefRef.board, result.session.briefRef.taskId, {
      completionSummary: {
        id: `session:${result.session.id}`,
        title: result.session.title,
        body: result.session.planDoc?.overview
          || String(lastAssistant?.content || lastAssistant?.body || "").trim().slice(0, 600)
          || "Studio session completed.",
        source: "studio-session",
        sessionId: result.session.id,
      },
      eventType: "studio_session_completed",
      actor: result.session.leadAgentId || "CEO Studio",
      summary: result.session.title,
    });
  }
  return result;
});
ipcMain.handle("sessions:set_active", (_e, id) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  if (id) {
    const g = sessions.get(slug, id);
    if (!g.ok) return g;
    sessions.setActive(id);
    return { ok: true, session: g.session, activeId: id };
  }
  sessions.setActive(null);
  return { ok: true, activeId: null };
});
ipcMain.handle("sessions:active", () => {
  const slug = _studioSlug();
  if (!slug) return { ok: true, activeId: null, session: null };
  const id = sessions.getActiveId();
  if (!id) return { ok: true, activeId: null, session: null };
  const g = sessions.get(slug, id);
  return g.ok ? { ok: true, activeId: id, session: g.session } : { ok: true, activeId: null, session: null };
});
ipcMain.handle("sessions:spawn_worker", (_e, { sessionId, agentId, role } = {}) => {
  const slug = _studioSlug();
  const projectPath = _studioPath();
  if (!slug || !projectPath) return { ok: false, reason: "open a project first" };
  const sid = sessionId || sessions.getActiveId();
  if (!sid) return { ok: false, reason: "no active session" };
  return sessions.spawnWorker(slug, projectPath, sid, { agentId, role });
});
ipcMain.handle("sessions:room", (_e, room) =>
  meetings.room({ room, projectPath: _studioPath() }));
ipcMain.handle("sessions:post", (_e, { room, speaker, body } = {}) =>
  meetings.post({ room, speaker, body, projectPath: _studioPath() }));
ipcMain.handle("sessions:start_room", (_e, { sessionId, allowPaid } = {}) => {
  const slug = _studioSlug();
  const projectPath = _studioPath();
  if (!slug || !projectPath) return { ok: false, reason: "open a project first" };
  const sid = sessionId || sessions.getActiveId();
  if (!sid) return { ok: false, reason: "no active session" };
  return sessions.startRoomLoop(slug, projectPath, sid, { allowPaid: allowPaid === true });
});
ipcMain.handle("sessions:stop_room", (_e, { sessionId } = {}) => {
  const slug = _studioSlug();
  const projectPath = _studioPath();
  if (!slug) return { ok: false, reason: "open a project first" };
  const sid = sessionId || sessions.getActiveId();
  if (!sid) return { ok: false, reason: "no active session" };
  return sessions.stopRoomLoop(slug, projectPath, sid);
});
ipcMain.handle("sessions:room_status", (_e, { sessionId } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  const sid = sessionId || sessions.getActiveId();
  if (!sid) return { ok: false, reason: "no active session" };
  return sessions.roomLoopStatus(slug, sid);
});
ipcMain.handle("sessions:set_plan", (_e, { id, planDoc } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.setPlan(slug, id || sessions.getActiveId(), planDoc);
});
ipcMain.handle("sessions:approve_plan", (_e, id) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.approvePlan(slug, id || sessions.getActiveId());
});
ipcMain.handle("sessions:reject_plan", (_e, { id, reason } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.rejectPlan(slug, id || sessions.getActiveId(), { reason });
});
ipcMain.handle("sessions:set_planned_team", (_e, { id, team } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.setPlannedTeam(slug, id || sessions.getActiveId(), team);
});
ipcMain.handle("sessions:set_task_tree", (_e, { id, taskTree } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.setTaskTree(slug, id || sessions.getActiveId(), taskTree);
});
ipcMain.handle("sessions:set_decomposition", (_e, { id, decompositionDoc } = {}) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  return sessions.setDecomposition(slug, id || sessions.getActiveId(), decompositionDoc);
});
ipcMain.handle("sessions:decomposition", (_e, id) => {
  const slug = _studioSlug();
  if (!slug) return { ok: false, reason: "open a project first" };
  const sid = id || sessions.getActiveId();
  if (!sid) return { ok: false, reason: "no session" };
  const g = sessions.get(slug, sid);
  return g.ok ? { ok: true, decomposition: g.decomposition } : g;
});
ipcMain.handle("sessions:launch_team", (_e, { sessionId } = {}) => {
  const slug = _studioSlug();
  const projectPath = _studioPath();
  if (!slug || !projectPath) return { ok: false, reason: "open a project first" };
  const sid = sessionId || sessions.getActiveId();
  if (!sid) return { ok: false, reason: "no active session" };
  return sessions.launchTeam(slug, projectPath, sid);
});

// --- Agent registry (single source of truth: agents.json, read/written in Node) ---
const _projPath = () => (session.project && session.project.path) || null;
ipcMain.handle("registry:list", () => registry.read(_projPath()));
ipcMain.handle("registry:personas", () => ({ ok: true, personas: registry.listPersonas(_projPath()) }));
ipcMain.handle("registry:providers", () => ({ ok: true, providers: registry.listProviders() }));
ipcMain.handle("registry:models", () => models.catalog(_projPath()));
ipcMain.handle("registry:create_agent", (_e, spec = {}) => registry.createAgent(_projPath(), spec));
ipcMain.handle("registry:update_agent", (_e, { id, updates } = {}) => registry.updateAgent(_projPath(), id, updates || {}));
ipcMain.handle("registry:delete_agent", (_e, id) => registry.deleteAgent(_projPath(), id));
ipcMain.handle("registry:save_team", (_e, { name, members } = {}) => registry.saveTeam(_projPath(), name, members || []));
ipcMain.handle("registry:delete_team", (_e, name) => registry.deleteTeam(_projPath(), name));

// Mount/unmount an agent into a live tmux session (provider CLI + A2A watcher).
ipcMain.handle("registry:mount", (_e, info = {}) => {
  const id = typeof info === "string" ? info : info.id;
  const r = mount.mount(_projPath(), id, { allowPaid: !!(info && info.allowPaid) });
  if (r && r.ok) registry.updateAgent(_projPath(), id, { tmux_session: r.session, tmux_window: r.window });
  return r;
});
ipcMain.handle("registry:unmount", (_e, id) => {
  const r = mount.unmount(_projPath(), id);
  if (r && r.ok) registry.updateAgent(_projPath(), id, { tmux_session: null });
  return r;
});
ipcMain.handle("registry:alive", (_e, id) => {
  const a = registry.read(_projPath()).agents.find((x) => x.id === id);
  const session = (a && a.tmux_session) || `pipe-${id}`;
  return { ok: true, session, alive: mount.alive(session) };
});
ipcMain.handle("registry:terminal", (_e, id) => {
  const a = registry.read(_projPath()).agents.find((x) => x.id === id);
  const session = (a && a.tmux_session) || `pipe-${id}`;
  return mount.snapshot(session, (a && a.tmux_window) || "main");
});
ipcMain.handle("registry:terminal_send", (_e, { id, text, window } = {}) => {
  const a = registry.read(_projPath()).agents.find((x) => x.id === id);
  const session = (a && a.tmux_session) || `pipe-${id}`;
  return mount.send(session, window || (a && a.tmux_window) || "main", text);
});
ipcMain.handle("terminal:open", (event, { agentId, cols, rows } = {}) => {
  const id = String(agentId || "").trim();
  if (!id) return { ok: false, reason: "agentId required" };
  const a = registry.read(_projPath()).agents.find((x) => x.id === id);
  const sessionName = (a && a.tmux_session) || `pipe-${id}`;
  const snap = mount.snapshot(sessionName, (a && a.tmux_window) || "main", 1);
  if (!snap || !snap.ok) return { ok: false, reason: snap ? snap.reason : "terminal unavailable" };
  return ptyTerminal.open({
    webContents: event.sender,
    agentId: id,
    session: sessionName,
    window: snap.window || (a && a.tmux_window) || "main",
    cwd: _projPath(),
    cols,
    rows,
  });
});
ipcMain.handle("terminal:input", (_event, { terminalId, data } = {}) => ptyTerminal.input(terminalId, data));
ipcMain.handle("terminal:resize", (_event, { terminalId, cols, rows } = {}) => ptyTerminal.resize(terminalId, cols, rows));
ipcMain.handle("terminal:close", (_event, terminalId) => ptyTerminal.close(terminalId));
// Talk to an agent the RIGHT way: post into its A2A room as a speaker. Its
// watcher sees it; a brained agent (or a meeting) produces the reply. Reaches
// the agent regardless of which tmux window it runs in.
ipcMain.handle("registry:message", (_e, { id, message, speaker } = {}) => {
  const plan = mount.lookup(_projPath(), id);
  const room = (plan && (plan.canonical_room || plan.default_room)) || session.domain || "discovery";
  return mount.post(_projPath(), room, speaker || "CEO", message);
});

// --- Meetings (A2A meeting engine in the harness) ---
ipcMain.handle("meetings:options", () => meetings.options(session.project && session.project.path));
ipcMain.handle("meetings:start", (_e, info = {}) =>
  meetings.start({ ...info, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:room", (_e, room) =>
  meetings.room({ room, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:post", (_e, { room, speaker, body } = {}) =>
  meetings.post({ room, speaker, body, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:schedule", (_e, meeting = {}) =>
  meetings.scheduleMeeting({ meeting, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:schedule_update", (_e, { id, patch } = {}) =>
  meetings.updateScheduled({ id, patch, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:schedule_delete", (_e, id) =>
  meetings.deleteScheduled({ id, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:schedule_start", (_e, id) =>
  meetings.startScheduled({ id, projectPath: session.project && session.project.path }));
ipcMain.handle("standups:status", () => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return standups.status({ projectPath: session.project.path });
});
ipcMain.handle("standups:configure", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return standups.configure({
    ...info,
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    projectName: session.project.name || path.basename(session.project.path),
    currentDomain: session.domain || "All",
  });
});
ipcMain.handle("standups:run_due", () => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const reconciled = standups.reconcile({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
  });
  const due = standups.runDue({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
  });
  return { ...due, reconciled };
});
ipcMain.handle("standups:proposal_action", (_e, info = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return standups.reviewProposal({
    projectSlug: session.project.slug,
    projectPath: session.project.path,
    executionId: String(info.executionId || "").trim(),
    proposalId: String(info.proposalId || "").trim(),
    action: String(info.action || "").trim(),
    humanApproved: info.humanApproved === true,
    reviewedBy: String(info.reviewedBy || "human").trim(),
  });
});
// Live room loop: a persistent A2A conversation in a room (agents reply to posts).
ipcMain.handle("meetings:room_loop_start", (_e, info = {}) =>
  meetings.startRoomLoop({ ...info, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:room_loop_stop", (_e, room) => meetings.stopRoomLoop({ room }));
ipcMain.handle("meetings:room_loop_status", (_e, room) => meetings.roomLoopStatus({ room }));

// --- IPC: local agent job queue ---
ipcMain.handle("jobs:create_ticket_pack", async (_e, { board, ticketId, domain, instructions } = {}) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  if (!ticketId) return { ok: false, reason: "ticketId required" };
  const job = jobs.create(session.project.slug, {
    type: "ticket_context_pack",
    domain: domain || session.domain || "All",
    requestedBy: "voice",
    input: { board: board || hermes.currentBoard(), ticketId, instructions: instructions || "" },
  });
  const project = session.project;
  setImmediate(() => { processTicketPackJob(job.id, project).catch(() => {}); });
  return { ok: true, job };
});

ipcMain.handle("jobs:get", (_e, id) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const job = jobs.get(session.project.slug, id);
  return job ? { ok: true, job } : { ok: false, reason: "job not found" };
});

ipcMain.handle("jobs:list", () => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  return { ok: true, jobs: jobs.list(session.project.slug) };
});

ipcMain.handle("jobs:apply_ticket_comment", (_e, id) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const job = jobs.get(session.project.slug, id);
  if (!job) return { ok: false, reason: "job not found" };
  if (job.status !== "done" || !job.output || !job.output.comment) return { ok: false, reason: "job has no completed comment output" };
  const r = hermes.addComment({
    board: job.output.board || job.input.board,
    taskId: job.input.ticketId,
    body: job.output.comment,
    author: "CEO Studio Voice",
  });
  if (!r.ok) return r;
  jobs.update(session.project.slug, id, { output: { ...job.output, commentAppliedAt: new Date().toISOString() } });
  return { ok: true };
});

// --- IPC: brain ---
ipcMain.handle("brain:context", () => {
  if (!session.project) return null;
  return brain.loadContext(session.project.slug);
});

ipcMain.handle("brain:get_context", (_e, domain) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const context = brain.loadContext(session.project.slug, { domain });
    return { ok: true, context };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("brain:search", async (_e, query, domain) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  if (!query) return { ok: false, reason: "Query required" };
  
  try {
    const allArtifacts = brain.readIndex(session.project.slug, "artifacts");
    let filteredArtifacts = allArtifacts;
    
    if (domain && domain !== "All") {
      filteredArtifacts = allArtifacts.filter(a => 
        !a.domain || a.domain === "All" || a.domain.toLowerCase() === domain.toLowerCase()
      );
    }
    
    // Use semantic search if available
    const results = await brain.semanticSearchArtifacts(
      session.project.slug, 
      query, 
      filteredArtifacts, 
      10
    );
    
    return { ok: true, results };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("brain:add", (_e, title, content, artifactType = "general") => {
  if (!session.project) return { ok: false, reason: "No project open" };
  if (!title || !content) return { ok: false, reason: "Title and content required" };
  
  try {
    const artifact = brain.writeArtifact(session.project.slug, {
      type: artifactType === "decision" ? "decision" : 
             artifactType === "insight" ? "agent_output" :
             artifactType === "issue" ? "contradiction" : "artifact",
      title,
      summary: content.slice(0, 500),
      source: { system: "voice-agent", path: null, actor: "user" },
      domain: session.domain || null,
    });
    
    return { ok: true, id: artifact.id };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

// --- IPC: GBrain bridge ---
ipcMain.handle("gbrain:status", () => gbrain.status());

ipcMain.handle("gbrain:query", async (_e, query, opts = {}) => {
  const project = session.project ? { slug: session.project.slug, name: session.project.name, path: session.project.path } : null;
  return gbrain.query({
    query,
    project,
    domain: opts.domain || session.domain || "All",
    filters: opts.filters || {},
  });
});

ipcMain.handle("gbrain:ingest", async (_e, artifact = {}) => {
  const project = session.project ? { slug: session.project.slug, name: session.project.name, path: session.project.path } : null;
  return gbrain.ingest({
    title: artifact.title,
    content: artifact.content,
    project,
    domain: artifact.domain || session.domain || "All",
    metadata: artifact.metadata || {},
  });
});

// --- IPC: cost guardrail (live meter + kill switch) ---
ipcMain.handle("cost:status", () => (session.cost ? session.cost.status() : null));
ipcMain.handle("cost:kill", () => { if (session.cost) session.cost.kill(); return session.cost?.status(); });
ipcMain.handle("cost:resume", () => { if (session.cost) session.cost.resume(); return session.cost?.status(); });

// --- IPC: agent chat ---
// The CEO IS the Hermes agent (codex, OAuth-funded). There is NO API key and
// none is required: route the chat through the Hermes relay, the same funded
// brain the voice path uses. The chat is unified with the MOUNTED CEO agent
// (`ceo` in the registry): askCeo() runs in the CEO agent's workdir and resumes
// the durable session id shared with its mounted terminal + the harness adapter,
// so the chat box, the viewable terminal, and `bin/agent` dispatch are one CEO
// session. (The old DocumentAgent/OpenAI provider path is kept only for the
// autonomous doc-edit feature, not the conversational CEO.)
ipcMain.handle("agent:ask", async (_e, prompt) => {
  // Honor the local kill switch / cost guardrail before reaching the CEO.
  if (session.cost && !session.cost.canProceed().ok) {
    return { text: "⛔ Halted by cost guardrail.", halted: true, cost: session.cost.status() };
  }
  const contextBits = [];
  if (session.project) contextBits.push(`Project: ${session.project.name || session.project.slug || "unknown"}`);
  if (session.domain) contextBits.push(`Domain: ${session.domain}`);
  if (session.focusedTask && session.focusedTask.taskId) {
    contextBits.push(`Focused task: ${session.focusedTask.taskTitle || session.focusedTask.taskId} (ID: ${session.focusedTask.taskId}, status: ${session.focusedTask.taskStatus || "unknown"}, board: ${session.focusedTask.board || "unknown"})`);
  }
  const msg = contextBits.length ? `[Context: ${contextBits.join(" | ")}]

${prompt}` : prompt;
  const r = await hermes.askCeo(msg, { projectPath: _projPath() });
  const cost = session.cost ? session.cost.status() : null;
  if (!r.ok) return { text: r.reason || "CEO unavailable.", error: true, cost };
  return { text: r.reply, cost, halted: false };
});

// --- IPC: voice (ElevenLabs, two-way) ---
// Cost-gated like the model: every TTS/STT call checks the CostMeter first and
// records usage after, so voice spend is visible and the hard caps + kill
// switch halt a runaway voice loop. Degrades gracefully when no key is set.
ipcMain.handle("voice:available", () => voice.statusAsync());

ipcMain.handle("voice:speak", async (_e, text) => {
  const isLocal = await voice.localAvailable();
  const isCloud = voice.available();
  if (!isCloud && !isLocal) return { ok: false, reason: "voice disabled — start Ollama or set ELEVENLABS_API_KEY" };
  if (!session.cost) return { ok: false, reason: "open a project first" };
  const gate = session.cost.canProceed();
  if (!gate.ok) return { ok: false, halted: true, reason: gate.reason, cost: session.cost.status() };
  try {
    const r = await voice.tts(text);
    session.cost.recordVoiceUsage({ kind: "tts", chars: r.chars, durationMs: r.durationMs });
    // Local mode: say plays directly — no audio buffer to return to renderer
    if (r.mode === "local") {
      return { ok: true, mode: "local", chars: r.chars, cost: session.cost.status() };
    }
    return {
      ok: true,
      mode: "cloud",
      audioBase64: r.audio.toString("base64"),
      mime: r.mime,
      chars: r.chars,
      cost: session.cost.status(),
    };
  } catch (e) {
    return { ok: false, reason: e.message, cost: session.cost.status() };
  }
});

// voice:ask — local Ollama LLM ask (used by the renderer voice loop)
ipcMain.handle("voice:ask", async (_e, { prompt, messages } = {}) => {
  const isLocal = await voice.localAvailable();
  if (!isLocal) return { ok: false, reason: "local voice not available — is Ollama running with gemma3:4b?" };
  if (session.cost) {
    const gate = session.cost.canProceed();
    if (!gate.ok) return { ok: false, halted: true, reason: gate.reason, cost: session.cost.status() };
  }
  try {
    const r = await voice.localAsk(prompt || "", { messages });
    return { ok: true, text: r.text, durationMs: r.durationMs, model: r.model };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("voice:listen", async (_e, { audioBase64, mime } = {}) => {
  // Local mode: STT is handled in the renderer via Web Speech API.
  // This handler is only used in cloud mode (ElevenLabs STT).
  if (!voice.available()) return { ok: false, reason: "cloud STT disabled (no ELEVENLABS_API_KEY) — use local Web Speech mode" };
  if (session.cost) {
    const gate = session.cost.canProceed();
    if (!gate.ok) return { ok: false, halted: true, reason: gate.reason, cost: session.cost.status() };
  }
  try {
    const buf = Buffer.from(String(audioBase64 || ""), "base64");
    const r = await voice.stt(buf, { mime });
    if (session.cost) session.cost.recordVoiceUsage({ kind: "stt", seconds: r.seconds, durationMs: r.durationMs });
    return { ok: true, text: r.text, seconds: r.seconds, cost: session.cost ? session.cost.status() : null };
  } catch (e) {
    return { ok: false, reason: e.message, cost: session.cost ? session.cost.status() : null };
  }
});

// --- IPC: Pilot Seat Voice Chat (multi-agent, Piper TTS) ---
// Voice conversation with whichever agent is in the pilot seat.
// STT: Web Speech API (renderer) -> chat: agent provider -> TTS: Piper/say

ipcMain.handle("voicechat:pilot", () => voiceChat.getPilot());
ipcMain.handle("voicechat:setPilot", (_e, agentId) => voiceChat.setPilot(agentId));
ipcMain.handle("voicechat:status", () => voiceChat.status());

ipcMain.handle("voicechat:chat", async (_e, { text, mute = false } = {}) => {
  if (!text || !text.trim()) return { ok: false, reason: "no input" };
  try {
    const r = await voiceChat.chat(text, { mute });
    return r;
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("voicechat:speak", async (_e, text) => {
  if (!text || !text.trim()) return { ok: false, reason: "no text" };
  try {
    const r = await voiceChat.speak(text);
    return r;
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("voicechat:interrupt", () => voiceChat.interrupt());

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
    const { agentId } = await convai.ensureAgent({ 
      projectName: session.project?.name, 
      currentDomain: session.domain 
    });
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

ipcMain.handle("docs:tree", (_e, domain) => projectTree({ domain }));

ipcMain.handle("docs:read", (_e, relPath) => {
  if (!session.project) return { ok: false, reason: "open a project first" };
  const safe = safeProjectPath(relPath);
  if (!safe) return { ok: false, reason: "path is outside the project" };
  const { root, resolved } = safe;
  // Guard against path traversal outside the mounted project.
  if (resolved !== root && !resolved.startsWith(root + path.sep))
    return { ok: false, reason: "path is outside the project" };
  try {
    const text = fs.readFileSync(resolved, "utf-8");
    return { ok: true, path: relPath, text: text.slice(0, 20000) };
  } catch (e) { return { ok: false, reason: e.message }; }
});

// --- IPC: self-awareness tools (let agents read their own code) ---
ipcMain.handle("self:read_code", (_e, relPath) => {
  // Allow agents to read their own CEO Studio source code for self-analysis
  const ceoStudioRoot = path.resolve(__dirname, "..");
  const resolved = path.resolve(ceoStudioRoot, String(relPath || ""));
  // Guard against path traversal outside CEO Studio
  if (resolved !== ceoStudioRoot && !resolved.startsWith(ceoStudioRoot + path.sep))
    return { ok: false, reason: "path is outside CEO Studio" };
  try {
    const text = fs.readFileSync(resolved, "utf-8");
    return { ok: true, path: relPath, text: text.slice(0, 20000) };
  } catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("self:list_code", () => {
  // List CEO Studio source files for self-awareness
  const ceoStudioRoot = path.resolve(__dirname, "..");
  const files = [];
  const walk = (dir, prefix = "") => {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const e of entries) {
        if (e.name.startsWith(".") && e.name !== ".") continue;
        const full = path.join(dir, e.name);
        const relPath = path.join(prefix, e.name);
        if (e.isDirectory()) {
          // Skip node_modules and common non-source dirs
          if (!["node_modules", ".git", "dist", "build"].includes(e.name)) {
            walk(full, relPath);
          }
        } else if (e.isFile()) {
          // Include source files
          if (/\.(js|ts|jsx|tsx|md|json)$/.test(e.name)) {
            files.push(relPath);
          }
        }
      }
    } catch { /* ignore */ }
  };
  walk(ceoStudioRoot);
  return { ok: true, files };
});

ipcMain.handle("self:modify_code", async (_e, relPath, oldText, newText) => {
  // Allow agents to modify their own CEO Studio source code with git commits
  const ceoStudioRoot = path.resolve(__dirname, "..");
  const resolved = path.resolve(ceoStudioRoot, String(relPath || ""));
  // Guard against path traversal outside CEO Studio
  if (resolved !== ceoStudioRoot && !resolved.startsWith(ceoStudioRoot + path.sep))
    return { ok: false, reason: "path is outside CEO Studio" };
  
  try {
    let text = fs.readFileSync(resolved, "utf-8");
    if (!text.includes(oldText)) {
      return { ok: false, reason: "old_text not found in file - exact match required" };
    }
    
    // Perform the replacement
    text = text.replace(oldText, newText);
    fs.writeFileSync(resolved, text, "utf-8");
    
    // Create a git commit for the change
    try {
      const commitMessage = `self: repair ${relPath}`;
      execSync(`git add "${resolved}"`, { cwd: ceoStudioRoot, stdio: "pipe" });
      execSync(`git commit -m "${commitMessage}"`, { cwd: ceoStudioRoot, stdio: "pipe" });
      const commitHash = execSync("git rev-parse --short HEAD", { cwd: ceoStudioRoot, encoding: "utf-8" }).trim();
      return { ok: true, path: relPath, commit: commitHash };
    } catch (gitErr) {
      // File was modified but git commit failed - still return success but note the git issue
      return { ok: true, path: relPath, commit: "modified but git commit failed" };
    }
  } catch (e) { return { ok: false, reason: e.message }; }
});

ipcMain.handle("self:test_changes", async (_e) => {
  // Run the test suite to verify code changes
  const ceoStudioRoot = path.resolve(__dirname, "..");
  try {
    const testOutput = execSync("npm test", { cwd: ceoStudioRoot, encoding: "utf-8", stdio: "pipe" });
    // Parse test results (basic parsing)
    const lines = testOutput.split('\n');
    let passed = 0, failed = 0, total = 0;
    
    // Look for test result patterns
    for (const line of lines) {
      const passingMatch = line.match(/passing:\s*(\d+)/i);
      const failingMatch = line.match(/failing:\s*(\d+)/i);
      if (passingMatch) passed = parseInt(passingMatch[1]);
      if (failingMatch) failed = parseInt(failingMatch[1]);
    }
    
    total = passed + failed;
    return { ok: true, passed, failed, total, output: testOutput.slice(0, 2000) };
  } catch (e) {
    // Tests failed or had errors
    const errorOutput = e.stdout ? e.stdout.toString() : e.message;
    return { ok: false, reason: "Tests failed or errored", output: errorOutput.slice(0, 2000) };
  }
});

// --- IPC: repair agent (Devin CLI delegation for complex coding tasks) ---
ipcMain.handle("repair:delegate", async (_e, task) => {
  // Delegate complex coding tasks to Devin CLI specialist repair agent
  if (!task || typeof task !== "string") {
    return { ok: false, reason: "Invalid task description" };
  }
  
  // Check cost guardrails before spawning Devin
  if (session.cost && !session.cost.canProceed().ok) {
    return { ok: false, halted: true, reason: "Cost guardrail - repair agent halted", cost: session.cost.status() };
  }
  
  const ceoStudioRoot = path.resolve(__dirname, "..");
  const { spawn } = require("child_process");
  
  return new Promise((resolve) => {
    let output = "";
    let errorOutput = "";
    let resolved = false;
    
    // Timeout for Devin operations (5 minutes max)
    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve({ 
          ok: false, 
          reason: "Devin CLI timeout after 5 minutes", 
          partialOutput: output.slice(0, 1000) 
        });
      }
    }, 5 * 60 * 1000);
    
    try {
      // Spawn Devin CLI with the repair task
      // Assuming Devin CLI is available as 'devin' command
      const devin = spawn("devin", [task], {
        cwd: ceoStudioRoot,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, CEO_STUDIO_REPAIR_MODE: "1" }
      });
      
      devin.stdout.on("data", (data) => {
        output += data.toString();
      });
      
      devin.stderr.on("data", (data) => {
        errorOutput += data.toString();
      });
      
      devin.on("close", (code) => {
        clearTimeout(timeout);
        if (resolved) return;
        resolved = true;
        
        // Record cost for the Devin operation
        if (session.cost) {
          session.cost.recordUsage({ 
            model: "devin-cli", 
            tokensIn: 0, 
            tokensOut: 0, 
            usd: 0.50, // Estimated cost per Devin call
            durationMs: 0 
          });
        }
        
        if (code === 0) {
          // Check if git changes were made
          try {
            const gitStatus = execSync("git status --short", { cwd: ceoStudioRoot, encoding: "utf-8" });
            const changes = gitStatus.trim().split('\n').filter(Boolean).length;
            resolve({
              ok: true,
              summary: "Devin CLI completed successfully",
              changes: changes > 0 ? `${changes} file(s) modified` : "no changes needed",
              output: output.slice(0, 2000),
              cost: session.cost ? session.cost.status() : null
            });
          } catch (gitErr) {
            resolve({
              ok: true,
              summary: "Devin CLI completed",
              changes: "unknown",
              output: output.slice(0, 2000),
              cost: session.cost ? session.cost.status() : null
            });
          }
        } else {
          resolve({
            ok: false,
            reason: `Devin CLI exited with code ${code}`,
            output: output.slice(0, 2000),
            error: errorOutput.slice(0, 1000),
            cost: session.cost ? session.cost.status() : null
          });
        }
      });
      
      devin.on("error", (err) => {
        clearTimeout(timeout);
        if (resolved) return;
        resolved = true;
        resolve({
          ok: false,
          reason: `Failed to spawn Devin CLI: ${err.message}. Make sure Devin CLI is installed.`,
          cost: session.cost ? session.cost.status() : null
        });
      });
      
    } catch (err) {
      clearTimeout(timeout);
      if (resolved) return;
      resolved = true;
      resolve({
        ok: false,
        reason: `Repair agent error: ${err.message}`,
        cost: session.cost ? session.cost.status() : null
      });
    }
  });
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
  app.whenReady().then(async () => {
    // GBrain is accessed via the local CLI bridge. Do not start
    // `gbrain serve --http` here: that is an MCP server, not a REST API.
    // Start the AGUI server (wraps Hermes → AG-UI event stream) before the
    // window loads so the renderer can connect on init.
    try { await aguiServer.start(); } catch (e) { console.warn("[agui] start failed:", e && e.message); }

    // Start watching for CEO trigger requests (file-based IPC)
    try {
      ceoTriggers.startWatching((trigger) => {
        if (trigger.type === "terminal-open" && trigger.agentId) {
          console.log("[ceo-triggers] Opening terminal for agent:", trigger.agentId);
          // Open terminal via existing IPC mechanism
          if (mainWin && mainWin.webContents) {
            mainWin.webContents.send("terminal:open-request", { agentId: trigger.agentId });
          }
        }
      });
      console.log("[ceo-triggers] Watching for CEO trigger requests");
    } catch (e) {
      console.warn("[ceo-triggers] Failed to start watching:", e && e.message);
    }

    mainWin = createWindow();
    // The cockpit is up, so the CEO should be too: ensure the Hermes gateway
    // (which also runs the Kanban dispatcher → the swarm) is running.
    try {
      const ceo = hermes.ensureUp();
      if (!ceo || !ceo.up) console.warn("[hermes] CEO gateway startup did not report online:", ceo && (ceo.reason || ceo.serviceReason || ceo.gatewayState));
    } catch (e) {
      console.warn("[hermes] CEO gateway startup failed:", e && e.message);
    }
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWin = createWindow();
    });
  });
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  
  app.on("before-quit", () => {
    // Clean up GBrain server when quitting
    stopGBrainServer();
    // Detach any temporary UI terminal clients. This does not kill agent tmux sessions.
    try { ptyTerminal.closeAll(); } catch { /* ignore */ }
    // Stop any live A2A room-loop daemons.
    try { meetings.stopAllRoomLoops(); } catch { /* ignore */ }
  });
}

// Exported for tests / headless reuse.
module.exports = { openProjectSession, session };
