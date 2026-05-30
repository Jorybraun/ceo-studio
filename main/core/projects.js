"use strict";
/**
 * Project mounting + domain detection + registry (M0 / L0).
 *
 * CEO Studio is agnostic: it mounts ANY project folder, discovers its domains,
 * and keeps a small registry. No project paths are hardcoded.
 */
const fs = require("fs");
const path = require("path");
const { projectsRegistryPath, slugify } = require("./paths");

// Folder names that commonly indicate a "domain" (unit of strategic ownership).
// Mirrors the harness domain model (PLANNING-FLOW-AND-DOMAINS.md) loosely.
const DOMAIN_HINTS = [
  "discovery", "matching", "engineering", "culture", "compliance",
  "recruiter-cockpit", "candidate-ingestion", "repo-graph", "challenge-system",
  "architecture", "documentation", "planning", "design", "research",
];

function loadRegistry() {
  const p = projectsRegistryPath();
  if (!fs.existsSync(p)) return { projects: [] };
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf-8"));
    return data && Array.isArray(data.projects) ? data : { projects: [] };
  } catch {
    return { projects: [] };
  }
}

function saveRegistry(reg) {
  fs.writeFileSync(projectsRegistryPath(), JSON.stringify(reg, null, 2));
}

/**
 * Detect domains by inspecting the project's folder structure.
 * Always returns an "all" domain. Best-effort, cheap, deterministic.
 */
function detectDomains(projectPath) {
  const found = new Map(); // name -> {name, source}
  const add = (name, source) => {
    const key = name.toLowerCase();
    if (!found.has(key)) found.set(key, { name, source });
  };

  const tryDirEntries = (dir, source) => {
    try {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (!e.isDirectory()) continue;
        const n = e.name.toLowerCase();
        if (DOMAIN_HINTS.includes(n)) add(e.name, source);
      }
    } catch { /* ignore */ }
  };

  // Top-level dirs
  tryDirEntries(projectPath, "top-level");
  // harness-style: context/<domain>-team
  const ctx = path.join(projectPath, "harness", "context");
  try {
    for (const e of fs.readdirSync(ctx, { withFileTypes: true })) {
      if (e.isDirectory() && e.name.endsWith("-team")) {
        add(e.name.replace(/-team$/, ""), "harness/context");
      }
    }
  } catch { /* ignore */ }
  // harness/personas/domains/<domain>
  tryDirEntries(path.join(projectPath, "harness", "personas", "domains"), "harness/personas");

  const domains = [{ name: "All", source: "default" }, ...found.values()];
  return domains;
}

function addProject(projectPath) {
  const abs = path.resolve(projectPath);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    throw new Error(`Not a directory: ${abs}`);
  }
  const reg = loadRegistry();
  const existing = reg.projects.find((p) => path.resolve(p.path) === abs);
  if (existing) return existing;

  const name = path.basename(abs);
  const project = {
    id: slugify(name) + "-" + Date.now().toString(36),
    slug: slugify(name),
    name,
    path: abs,
    domains: detectDomains(abs),
    addedAt: new Date().toISOString(),
  };
  reg.projects.push(project);
  saveRegistry(reg);
  return project;
}

function listProjects() {
  return loadRegistry().projects;
}

function getProject(id) {
  return loadRegistry().projects.find((p) => p.id === id) || null;
}

module.exports = {
  DOMAIN_HINTS,
  detectDomains,
  addProject,
  listProjects,
  getProject,
  loadRegistry,
  saveRegistry,
};
