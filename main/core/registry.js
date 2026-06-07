"use strict";
/**
 * Agent registry — the single source of truth for *agents* and *teams*.
 *
 * An **agent** is one coherent thing: a name + a persona (role) + a brain
 * (provider/model) + capabilities, plus optional runtime bindings (a per-agent
 * memory key and a tmux session it can be mounted into).
 *
 * A **team** is a named, ordered list of agent ids.
 *
 * This is the Node counterpart to the harness's `agents/agent_config.py`. We
 * read/write the same plain-JSON `agents.json` directly (no Python shell-out),
 * which (a) removes the dependency on python3 being on the GUI's PATH — macOS
 * GUI apps don't inherit your shell PATH, which is why the UI showed "0 agents"
 * — and (b) lets the cockpit *write* the registry (create/edit agents + teams).
 *
 * Resolution order for READS (first definition of an id/team wins, so a project
 * overrides shipped defaults):
 *   1. $CEO_AGENTS_CONFIG (explicit file)
 *   2. <project>/agents.json            (the open project's workspace)
 *   3. <harness>/agents/agents.json     (shipped defaults — also the write target)
 *
 * WRITES go to the project's agents.json when a project is open, otherwise to
 * the shipped harness agents.json.
 *
 * Editing or deleting an agent that lives only in a lower-precedence (shipped/
 * default) source is copy-on-write: updateAgent() materializes a project-level
 * override, and deleteAgent() writes a disabled tombstone (the cockpit directory
 * hides enabled:false agents) rather than failing with "agent not found". This
 * is why the cockpit can edit shipped agents (e.g. `pm`) it merely inherits.
 */
const path = require("path");
const fs = require("fs");

function harnessRoot(projectPath) {
  return path.join(projectPath || process.cwd(), "runtime", "harness");
}
function appHarnessRoot() {
  return path.join(__dirname, "..", "..", "runtime", "harness");
}
function harnessAgentsJson(projectPath) {
  return path.join(harnessRoot(projectPath), "agents", "agents.json");
}
function appHarnessAgentsJson() {
  return path.join(appHarnessRoot(), "agents", "agents.json");
}

/** Read paths in precedence order (first id wins). */
function readPaths(projectPath) {
  const out = [];
  const env = (process.env.CEO_AGENTS_CONFIG || "").trim();
  if (env) out.push(env);
  if (projectPath) out.push(path.join(projectPath, "agents.json"));
  out.push(harnessAgentsJson(projectPath));
  out.push(appHarnessAgentsJson());
  // de-dup, preserve order
  const seen = new Set();
  return out.filter((p) => {
    const r = path.resolve(p);
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });
}

/** The file we write to: project agents.json if a project is open, else harness default. */
function writePath(projectPath) {
  if (projectPath) return path.join(projectPath, "agents.json");
  return harnessAgentsJson(projectPath);
}

function slugify(s) {
  return String(s || "").trim().toLowerCase().replace(/[\s_]+/g, "-").replace(/[^a-z0-9.-]/g, "").replace(/^-+|-+$/g, "");
}

function normalizeAgent(spec) {
  const id = slugify(spec.id || spec.name);
  return {
    id,
    name: spec.name || spec.id || id,
    provider: spec.provider || "vertex",
    model: spec.model || null,
    // CLI template for the generic "command" provider (use-anything seam).
    command: spec.command ? String(spec.command).trim() : null,
    // The spawnable Hermes profile that executes this agent's Kanban work.
    // Registry agents are the conceptual roles; the kanban dispatcher spawns a
    // Hermes profile (pipe, devin, kanban-orchestrator, self-repair-engineer…).
    // When unset, the autonomy runner derives one from `provider`.
    dispatch_profile: spec.dispatch_profile ? String(spec.dispatch_profile).trim() : null,
    persona: spec.persona || null,
    room: spec.room || null,
    capabilities: Array.isArray(spec.capabilities) ? spec.capabilities
      : String(spec.capabilities || "").split(/[,\n]/).map((s) => s.trim()).filter(Boolean),
    description: spec.description || "",
    memory_key: spec.memory_key || null,
    tmux_session: spec.tmux_session || null,
    tmux_window: spec.tmux_window || "main",
    // Explicit launch override + Hermes profile. These drive launch-agent's
    // mode (e.g. the conversational CEO is launch_mode "hermes_profile" with an
    // empty profile = the default Hermes/OAuth session). Carried through so a
    // mount-time update (which rewrites the agent) never strips them. Empty
    // string is meaningful for `profile` (= default Hermes), so use ?? not ||.
    launch_mode: spec.launch_mode || null,
    profile: spec.profile == null ? null : String(spec.profile),
    enabled: spec.enabled !== false,
  };
}

/** Merged registry: { ok, agents:[...], teams:{name:[ids]}, sources:[...], writePath }. */
function read(projectPath) {
  const agents = {};
  const teams = {};
  const sources = [];
  for (const p of readPaths(projectPath)) {
    let data;
    try {
      if (!fs.existsSync(p)) continue;
      data = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch {
      continue;
    }
    sources.push(p);
    for (const spec of data.agents || []) {
      const a = normalizeAgent(spec);
      if (a.id && !agents[a.id]) agents[a.id] = a;
    }
    for (const [name, ids] of Object.entries(data.teams || {})) {
      if (!(name in teams) && Array.isArray(ids)) teams[name] = ids.map(String);
    }
  }
  return {
    ok: true,
    agents: Object.values(agents),
    teams: Object.entries(teams).map(([name, members]) => ({ name, members })),
    sources,
    writePath: writePath(projectPath),
  };
}

/**
 * Agent ids that resolve from a source *other than* the write target — i.e.
 * agents inherited from a shipped/default registry the cockpit can't edit in
 * place. Used so edits/deletes of shipped agents become project-level overrides
 * instead of failing with "agent not found".
 */
function _inheritedAgentIds(projectPath) {
  const wp = path.resolve(writePath(projectPath));
  const ids = new Set();
  for (const p of readPaths(projectPath)) {
    if (path.resolve(p) === wp) continue; // the write target is editable in place
    let data;
    try {
      if (!fs.existsSync(p)) continue;
      data = JSON.parse(fs.readFileSync(p, "utf8"));
    } catch { continue; }
    for (const spec of data.agents || []) {
      const a = slugify(spec.id || spec.name);
      if (a) ids.add(a);
    }
  }
  return ids;
}

/** Load the raw write-target file (agents array + teams object), creating a shell if missing. */
function _loadWritable(projectPath) {
  const p = writePath(projectPath);
  let data = { agents: [], teams: {} };
  try {
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
      data = { _comment: parsed._comment, agents: parsed.agents || [], teams: parsed.teams || {} };
    }
  } catch { /* start fresh */ }
  if (!Array.isArray(data.agents)) data.agents = [];
  if (!data.teams || typeof data.teams !== "object") data.teams = {};
  return { path: p, data };
}

function _save(p, data) {
  const out = {};
  if (data._comment) out._comment = data._comment;
  out.agents = data.agents;
  out.teams = data.teams;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(out, null, 2) + "\n", "utf8");
}

/** Persist an agent spec to the write target's `agents` array (stores only set fields). */
function _persistAgent(arr, agent) {
  const slim = { id: agent.id, name: agent.name, provider: agent.provider };
  if (agent.model) slim.model = agent.model;
  if (agent.command) slim.command = agent.command;
  if (agent.dispatch_profile) slim.dispatch_profile = agent.dispatch_profile;
  if (agent.persona) slim.persona = agent.persona;
  if (agent.capabilities && agent.capabilities.length) slim.capabilities = agent.capabilities;
  if (agent.description) slim.description = agent.description;
  if (agent.memory_key) slim.memory_key = agent.memory_key;
  if (agent.tmux_session) slim.tmux_session = agent.tmux_session;
  if (agent.tmux_window && agent.tmux_window !== "main") slim.tmux_window = agent.tmux_window;
  if (agent.room) slim.room = agent.room;
  // Persist an explicit launch mode + Hermes profile so they survive rewrites.
  // An empty-string profile is meaningful (default Hermes / CEO), so only the
  // launch_mode gate matters — when launch_mode is set we record the profile too.
  if (agent.launch_mode) {
    slim.launch_mode = agent.launch_mode;
    if (agent.profile != null) slim.profile = agent.profile;
  }
  if (agent.enabled === false) slim.enabled = false;
  const i = arr.findIndex((a) => slugify(a.id || a.name) === agent.id);
  if (i >= 0) arr[i] = slim; else arr.push(slim);
}

function createAgent(projectPath, spec = {}) {
  const agent = normalizeAgent(spec);
  if (!agent.id) return { ok: false, reason: "agent needs a name" };
  // default a stable per-agent memory key if none supplied
  if (!agent.memory_key) agent.memory_key = `agent:${agent.id}`;
  const { path: p, data } = _loadWritable(projectPath);
  if (data.agents.some((a) => slugify(a.id || a.name) === agent.id)) {
    return { ok: false, reason: `agent already exists: ${agent.id}` };
  }
  _persistAgent(data.agents, agent);
  _save(p, data);
  return { ok: true, agent };
}

function updateAgent(projectPath, id, updates = {}) {
  const aid = slugify(id);
  if (!aid) return { ok: false, reason: "agent id required" };
  const { path: p, data } = _loadWritable(projectPath);
  let existing = data.agents.find((a) => slugify(a.id || a.name) === aid);
  if (!existing) {
    // Copy-on-write: the agent may be inherited from a shipped/default registry
    // that is not the write target (e.g. runtime/harness/agents.json). Edits to
    // such an agent should materialize a project-level override instead of
    // failing with "agent not found" (the cockpit lists shipped agents).
    existing = read(projectPath).agents.find((a) => slugify(a.id || a.name) === aid);
    if (!existing) return { ok: false, reason: `agent not found: ${aid}` };
  }
  // keep the id stable even if the name changes
  const merged = normalizeAgent({ ...existing, ...updates, id: aid });
  merged.id = aid;
  _persistAgent(data.agents, merged);
  _save(p, data);
  return { ok: true, agent: merged };
}

function deleteAgent(projectPath, id) {
  const aid = slugify(id);
  const { path: p, data } = _loadWritable(projectPath);
  const before = data.agents.length;
  data.agents = data.agents.filter((a) => slugify(a.id || a.name) !== aid);
  const hadOverride = data.agents.length !== before;
  const inherited = _inheritedAgentIds(projectPath).has(aid);
  if (!hadOverride && !inherited) return { ok: false, reason: `agent not found: ${aid}` };
  if (inherited) {
    // The agent is defined in a shipped/default registry we can't edit in place.
    // Dropping a project override isn't enough — it would just reappear from the
    // default. Write a disabled tombstone override instead; the cockpit hides
    // enabled:false agents, so it disappears. Removing the override re-enables it.
    const base = read(projectPath).agents.find((a) => slugify(a.id || a.name) === aid) || { id: aid, name: aid };
    _persistAgent(data.agents, normalizeAgent({ ...base, id: aid, enabled: false }));
  }
  // also drop from any team defined in the write target
  for (const name of Object.keys(data.teams)) {
    data.teams[name] = (data.teams[name] || []).filter((m) => slugify(m) !== aid);
  }
  _save(p, data);
  return { ok: true, id: aid, disabled: inherited };
}

/** Create or replace a team's member list. */
function saveTeam(projectPath, name, memberIds = []) {
  const teamName = String(name || "").trim();
  if (!teamName) return { ok: false, reason: "team name required" };
  const { path: p, data } = _loadWritable(projectPath);
  data.teams[teamName] = (memberIds || []).map((m) => slugify(m)).filter(Boolean);
  _save(p, data);
  return { ok: true, name: teamName, members: data.teams[teamName] };
}

function deleteTeam(projectPath, name) {
  const teamName = String(name || "").trim();
  const { path: p, data } = _loadWritable(projectPath);
  if (!(teamName in data.teams)) return { ok: false, reason: `team not found: ${teamName}` };
  delete data.teams[teamName];
  _save(p, data);
  return { ok: true, name: teamName };
}

/** Discoverable personas as [{id, name, source}]. Mirrors personas.py resolution. */
function listPersonas(projectPath) {
  const dirs = [];
  const env = (process.env.CEO_PERSONAS_DIR || "").trim();
  for (const chunk of env.split(path.delimiter)) if (chunk.trim()) dirs.push(chunk.trim());
  if (projectPath) dirs.push(path.join(projectPath, "personas"));
  const root = harnessRoot(projectPath);
  dirs.push(path.join(root, "personas"));
  dirs.push(path.join(root, "agents", "personas"));
  const appRoot = appHarnessRoot();
  dirs.push(path.join(appRoot, "personas"));
  dirs.push(path.join(appRoot, "agents", "personas"));

  const found = new Map();
  const walk = (dir) => {
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const fp = path.join(dir, e.name);
      if (e.isDirectory()) walk(fp);
      else if (e.isFile() && e.name.endsWith(".md")) {
        const id = path.basename(e.name, ".md");
        if (["readme", "index"].includes(id.toLowerCase())) continue;
        if (!found.has(id.toLowerCase())) {
          found.set(id.toLowerCase(), {
            id,
            name: id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
            source: dir,
          });
        }
      }
    }
  };
  for (const d of dirs) walk(d);
  return [...found.values()].sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()));
}

/**
 * Providers the cockpit can assign as an agent's brain. Mirrors the harness
 * provider registry (runtime/harness/agents/providers/__init__.py). Kept as a
 * plain JS list on purpose: macOS GUI apps don't inherit the shell PATH, so we
 * don't shell out to python just to enumerate providers. `command` is the
 * generic "use anything" provider — any CLI via an agent's `command` template.
 *
 * `vertex` = Gemma (Vertex AI MaaS) via the Cloudflare AI Gateway — a real,
 * funded, hosted brain (the default). `codex`/`hermes`/`pi` shell out to their
 * respective CLIs. `echo` is deliberately NOT listed: it is offline test
 * scaffolding, not a usable agent brain. Keep this in sync with the Python
 * registry (runtime/harness/agents/providers/__init__.py).
 */
const PROVIDERS = ["vertex", "codex", "hermes", "grok", "claude", "pi", "devin", "command"];
function listProviders() {
  return [...PROVIDERS];
}

module.exports = {
  read, createAgent, updateAgent, deleteAgent,
  saveTeam, deleteTeam, listPersonas, listProviders,
  writePath, harnessRoot, appHarnessRoot,
};
