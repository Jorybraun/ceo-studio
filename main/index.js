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
const user = require("./core/user");
const soul = require("./core/soul");
const hermes = require("./core/hermes");
const meetings = require("./core/meetings");
const aguiServer = require("./core/agui-server");
const jobs = require("./core/jobs");
const ticketPlanner = require("./core/ticket-planner");
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
    const responsibilities = Array.isArray(domainDef.responsibilities)
      ? domainDef.responsibilities
      : String(domainDef.responsibilities || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    const coreAgents = Array.isArray(domainDef.coreAgents)
      ? domainDef.coreAgents
      : String(domainDef.coreAgents || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    if (domainDef.createScaffold) {
      relativePath = relativePath || path.join("domains", cleanName.toLowerCase().replace(/\s+/g, "-"));
      const safe = safeProjectPath(relativePath);
      if (!safe) return { ok: false, reason: "Domain path is outside the project" };
      fs.mkdirSync(safe.resolved, { recursive: true });
      const agentsPath = path.join(safe.resolved, "AGENTS.md");
      if (!fs.existsSync(agentsPath)) {
        fs.writeFileSync(agentsPath,
          `# ${cleanName}\n\n` +
          `**Purpose**: ${domainDef.purpose || ""}\n\n` +
          `**Overarching Goal**: ${domainDef.overarchingGoal || domainDef.currentState || ""}\n\n` +
          `## Responsibilities\n\n` +
          `${responsibilities.map((r) => `- ${r}`).join("\n") || "- TBD"}\n\n` +
          `## Team Agents\n\n` +
          `${coreAgents.map((a) => `- ${a}`).join("\n") || "- TBD"}\n`,
          "utf-8");
      }
    }
    const definition = domains.defineDomain(session.project.slug, {
      ...domainDef,
      name: cleanName,
      responsibilities,
      coreAgents,
      relativePath,
      sourcePath: relativePath ? path.join(session.project.path, relativePath) : domainDef.sourcePath,
      sourceType: domainDef.sourceType || (relativePath ? "manual-scaffold" : "manual"),
    });
    rememberProjectDomain(definition.name, definition.sourceType);
    return { ok: true, definition };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:get", (_e, domainName) => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const domain = domains.getDomain(session.project.slug, domainName);
    return { ok: true, domain };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
});

ipcMain.handle("domain:get_all", () => {
  if (!session.project) return { ok: false, reason: "No project open" };
  try {
    const allDomains = domains.getAllDomains(session.project.slug);
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
    const domain = domains.getDomain(session.project.slug, domainName);
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
  let filteredBoards = allBoards;
  
  // If a specific domain is selected (not "All"), filter boards
  if (domainName && domainName !== "All" && session.project) {
    const allDomains = domains.getAllDomains(session.project.slug);
    const selectedDomain = allDomains.find(d => d.name === domainName);
    
    if (selectedDomain && selectedDomain.kanbanBoard) {
      // Domain has a specific board - show that + main project board
      const domainBoard = allBoards.find(b => b.slug === selectedDomain.kanbanBoard);
      const mainBoard = allBoards.find(b => b.slug === session.project.slug) ||
        (session.project.slug === "ceo-studio" ? allBoards.find(b => b.slug === "ceo-studio") : null);
      
      filteredBoards = [];
      if (domainBoard) filteredBoards.push(domainBoard);
      if (mainBoard && (!domainBoard || mainBoard.slug !== domainBoard.slug)) {
        filteredBoards.push(mainBoard);
      }
    } else {
      // A selected domain without an explicit board should not accidentally
      // bind to the first unrelated board. Fall back to the project/global
      // board only; the user can map a domain board later.
      const mainBoard = allBoards.find(b => b.slug === session.project.slug) ||
        (session.project.slug === "ceo-studio" ? allBoards.find(b => b.slug === "ceo-studio") : null);
      filteredBoards = mainBoard ? [mainBoard] : [];
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

ipcMain.handle("skills:list", () => {
  const skills = [
    {
      id: "herder-swarm-control",
      name: "Herder Swarm Control",
      description: "Control and coordinate agent swarms via herder",
      category: "coordination",
    },
    {
      id: "herder-messaging",
      name: "Herder Messaging",
      description: "Structured messaging between agents",
      category: "communication",
    },
    {
      id: "herder-session-management",
      name: "Herder Session Management",
      description: "Manage agent sessions and lifecycle",
      category: "coordination",
    },
    {
      id: "kanban-management",
      name: "Kanban Management",
      description: "Manage kanban boards and tasks",
      category: "coordination",
    },
    {
      id: "codebase-navigation",
      name: "Codebase Navigation",
      description: "Navigate and understand codebase structure",
      category: "analysis",
    },
    {
      id: "architecture-analysis",
      name: "Architecture Analysis",
      description: "Analyze system architecture and patterns",
      category: "analysis",
    },
    {
      id: "implementation",
      name: "Implementation",
      description: "Write and implement code",
      category: "development",
    },
    {
      id: "planning",
      name: "Planning",
      description: "Create detailed plans and specifications",
      category: "planning",
    },
    {
      id: "code_review",
      name: "Code Review",
      description: "Review and analyze code quality",
      category: "development",
    },
    {
      id: "file-operations",
      name: "File Operations",
      description: "Read, write, and edit files",
      category: "development",
    },
    {
      id: "command-execution",
      name: "Command Execution",
      description: "Execute shell commands",
      category: "development",
    },
    {
      id: "git-operations",
      name: "Git Operations",
      description: "Git version control operations",
      category: "development",
    },
  ];
  
  return { ok: true, skills };
});
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
  return hermes.ask(message);
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
ipcMain.handle("hermes:focus_task", (_e, taskInfo) => hermes.focusTask(taskInfo));
ipcMain.handle("hermes:add_task", (_e, taskInfo) => hermes.addTask(taskInfo));
ipcMain.handle("hermes:assign_task", (_e, taskInfo) => hermes.assignTask(taskInfo));
ipcMain.handle("hermes:task_action", (_e, actionInfo) => hermes.taskAction(actionInfo));
ipcMain.handle("hermes:dispatch", (_e, dispatchInfo) => hermes.dispatch(dispatchInfo));
ipcMain.handle("hermes:task_log", (_e, logInfo) => hermes.taskLog(logInfo));
ipcMain.handle("hermes:assignees", (_e, board) => hermes.assignees({ board }));
ipcMain.handle("hermes:comment_task", (_e, commentInfo) => hermes.addComment(commentInfo));
// AGUI: the local AG-UI server URL the renderer's HttpAgent connects to.
ipcMain.handle("agui:url", () => aguiServer.url());

// --- Meetings (A2A meeting engine in the harness) ---
ipcMain.handle("meetings:options", () => meetings.options(session.project && session.project.path));
ipcMain.handle("meetings:start", (_e, info = {}) =>
  meetings.start({ ...info, projectPath: session.project && session.project.path }));
ipcMain.handle("meetings:room", (_e, room) =>
  meetings.room({ room, projectPath: session.project && session.project.path }));

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
// brain the voice path uses. (The old DocumentAgent/OpenAI provider path is kept
// only for the autonomous doc-edit feature, not the conversational CEO.)
ipcMain.handle("agent:ask", async (_e, prompt) => {
  // Honor the local kill switch / cost guardrail before reaching the CEO.
  if (session.cost && !session.cost.canProceed().ok) {
    return { text: "⛔ Halted by cost guardrail.", halted: true, cost: session.cost.status() };
  }
  const r = await hermes.ask(prompt);
  const cost = session.cost ? session.cost.status() : null;
  if (!r.ok) return { text: r.reason || "CEO unavailable.", error: true, cost };
  return { text: r.reply, cost, halted: false };
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
  // Dictation (speech → text into the chat box) must work even before a project
  // is opened. Only cost-gate + meter the STT when a project/cost meter exists.
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
    mainWin = createWindow();
    // The cockpit is up, so the CEO should be too: ensure the Hermes gateway
    // (which also runs the Kanban dispatcher → the swarm) is running.
    try { hermes.ensureUp(); } catch { /* best-effort; never block UI */ }
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
  });
}

// Exported for tests / headless reuse.
module.exports = { openProjectSession, session };
