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
const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const { loadEnv } = require("./core/env");
// Load .env.local (e.g. ELEVENLABS_API_KEY) before anything reads process.env.
// Shell-exported vars always win; missing files are ignored (offline-safe).
loadEnv();

const projects = require("./core/projects");
const brain = require("./core/brain");
const domains = require("./core/domains");
const user = require("./core/user");
const soul = require("./core/soul");
const hermes = require("./core/hermes");
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
  
  // Ingest domains from project structure
  try {
    const ingested = domains.ingestDomainsFromProject(project.slug, project.path);
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
    const definition = domains.defineDomain(session.project.slug, domainDef);
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
    const ingested = domains.ingestDomainsFromProject(session.project.slug, session.project.path);
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
ipcMain.handle("hermes:ensure_up", () => hermes.ensureUp());
ipcMain.handle("hermes:boards", () => ({ ok: true, boards: hermes.listBoards(), current: hermes.currentBoard() }));
ipcMain.handle("hermes:board", (_e, slug) => hermes.getBoard(slug));
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
ipcMain.handle("hermes:set_model", (_e, provider, model) => hermes.setModel({ provider, model }));
ipcMain.handle("hermes:gateway_start", () => hermes.gatewayStart());
ipcMain.handle("hermes:gateway_stop", () => hermes.gatewayStop());

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
  console.log("[agent:ask] Called with prompt:", prompt);
  // Honor the local kill switch / cost guardrail before reaching the CEO.
  if (session.cost && !session.cost.canProceed().ok) {
    return { text: "⛔ Halted by cost guardrail.", halted: true, cost: session.cost.status() };
  }
  console.log("[agent:ask] Calling hermes.ask...");
  const r = await hermes.ask(prompt);
  console.log("[agent:ask] hermes.ask returned:", r);
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
  app.whenReady().then(() => {
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
}

// Exported for tests / headless reuse.
module.exports = { openProjectSession, session };
