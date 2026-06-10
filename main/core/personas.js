"use strict";
/**
 * Personas — first-class, listable/editable/generatable role definitions.
 *
 * A **persona** is a markdown file describing a role (mission, behaviors,
 * artifacts, interaction rules). Agents reference a persona by id; meetings
 * load the persona brief into the agent's prompt. Until now personas could
 * only be picked from a dropdown — there was no way to SEE, EDIT, or CREATE
 * them. This module is the backend for a real Personas view.
 *
 * Storage (all under the harness persona tree, which is just markdown in the
 * repo — the human owns it, so everything here is editable):
 *   <harness>/personas/<category>/<id>.md      — shared/project-wide personas
 *   <harness>/personas/domains/<domain>/<id>.md — personas for ONE domain
 *
 * Scoping: list(projectPath, domain) returns the personas relevant to the
 * current domain = every shared persona PLUS the ones authored for this
 * domain, while hiding personas that belong to a *different* domain. So you
 * get a clean "personas for this project/domain" list.
 *
 * stdlib-only (fs/path). AI generation lives in the IPC layer (it needs the
 * Hermes relay); this module only builds the prompt + persists the result, so
 * it stays dependency-free and testable.
 */
const path = require("path");
const fs = require("fs");

function harnessPersonasRoot(projectPath) {
  return path.join(projectPath || process.cwd(), "runtime", "harness", "personas");
}

function appPersonasRoot() {
  return path.join(__dirname, "..", "..", "runtime", "harness", "personas");
}

function slug(s) {
  return String(s || "").trim().toLowerCase()
    .replace(/[\s_]+/g, "-").replace(/[^a-z0-9.-]/g, "").replace(/^-+|-+$/g, "");
}

/** Title = first `# heading`; summary = first non-empty body line / section. */
function parseMeta(content) {
  const lines = String(content || "").split(/\r?\n/);
  let title = "";
  const body = [];
  for (const line of lines) {
    const h1 = line.match(/^#\s+(.*)/);
    if (h1 && !title) { title = h1[1].trim(); continue; }
    if (/^#{1,6}\s/.test(line)) continue;      // skip sub-headings for summary
    if (line.trim()) body.push(line.trim());
    if (body.length >= 2) break;
  }
  return { title, summary: body.join(" ").slice(0, 240) };
}

function _readPersonaFile(file, { scope, domain, category }) {
  let content = "";
  try { content = fs.readFileSync(file, "utf8"); } catch { /* unreadable */ }
  const id = path.basename(file, ".md");
  const meta = parseMeta(content);
  return {
    id,
    name: meta.title || id.replace(/[-_]+/g, " ").replace(/\b\w/g, (m) => m.toUpperCase()),
    summary: meta.summary,
    scope,                    // "domain" | "shared"
    domain: domain || null,
    category: category || "",
    path: file,
    editable: true,
  };
}

/** Walk a dir for *.md (recursively), skipping READMEs/index. */
function _walkMd(dir) {
  const out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(..._walkMd(p));
    else if (e.isFile() && e.name.endsWith(".md")) {
      const id = path.basename(e.name, ".md").toLowerCase();
      if (["readme", "index"].includes(id)) continue;
      out.push(p);
    }
  }
  return out;
}

function domainsRoot(projectPath) {
  return path.join(harnessPersonasRoot(projectPath), "domains");
}
function domainDir(projectPath, domain) {
  return path.join(domainsRoot(projectPath), slug(domain));
}

/**
 * Personas for the current project + domain.
 * - shared personas (anything NOT under personas/domains/*)
 * - personas authored for THIS domain (personas/domains/<domain>/*)
 * - personas for OTHER domains are hidden.
 */
function list(projectPath, domain) {
  const root = harnessPersonasRoot(projectPath);
  const dRoot = domainsRoot(projectPath);
  const curDomainSlug = domain && domain !== "All" ? slug(domain) : null;
  const found = new Map(); // id -> persona (domain-specific wins over shared)

  const addRoot = (personaRoot, origin) => {
    for (const file of _walkMd(personaRoot)) {
      const rel = path.relative(personaRoot, file);
      const parts = rel.split(path.sep);
      const inDomains = parts[0] === "domains";
      if (inDomains) {
        const fileDomain = parts[1];
        // Only this domain's personas (skip other domains entirely).
        if (!curDomainSlug || fileDomain !== curDomainSlug) continue;
        const p = _readPersonaFile(file, { scope: "domain", domain: fileDomain, category: "domain" });
        p.origin = origin;
        found.set(p.id, p); // domain-specific takes precedence
      } else {
        const p = _readPersonaFile(file, { scope: "shared", domain: null, category: parts[0] || "" });
        p.origin = origin;
        if (!found.has(p.id)) found.set(p.id, p);
      }
    }
  };
  addRoot(root, "project");
  addRoot(appPersonasRoot(), "app");
  void dRoot;
  return [...found.values()].sort((a, b) => {
    if (a.scope !== b.scope) return a.scope === "domain" ? -1 : 1; // domain first
    return a.id.localeCompare(b.id);
  });
}

/** Find the on-disk file for an id within the project/domain visibility. */
function _findFile(projectPath, domain, id) {
  const want = slug(id);
  return list(projectPath, domain).find((p) => p.id === want) || null;
}

function read(projectPath, domain, id) {
  const hit = _findFile(projectPath, domain, id);
  if (!hit) return { ok: false, reason: `persona not found: ${id}` };
  let content = "";
  try { content = fs.readFileSync(hit.path, "utf8"); } catch (e) { return { ok: false, reason: e.message }; }
  return { ok: true, id: hit.id, name: hit.name, scope: hit.scope, domain: hit.domain, path: hit.path, content };
}

/** Where a NEW persona for this domain should be written. */
function _writePath(projectPath, domain, id) {
  const cleanId = slug(id);
  const dir = domain && domain !== "All"
    ? domainDir(projectPath, domain)
    : path.join(harnessPersonasRoot(projectPath), "general");
  return { dir, file: path.join(dir, `${cleanId}.md`), id: cleanId };
}

/**
 * Save persona content. If the persona already exists (in view), overwrite it
 * in place; otherwise create it scoped to the current domain (or general).
 */
function save(projectPath, domain, id, content) {
  const cleanId = slug(id);
  if (!cleanId) return { ok: false, reason: "persona id/name required" };
  if (!String(content || "").trim()) return { ok: false, reason: "persona content is empty" };
  const root = path.resolve(harnessPersonasRoot(projectPath));

  const existing = _findFile(projectPath, domain, cleanId);
  const target = existing ? existing.path : _writePath(projectPath, domain, cleanId).file;
  if (!path.resolve(target).startsWith(root + path.sep)) {
    return { ok: false, reason: "invalid persona path" };
  }
  try {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, String(content).trim() + "\n", "utf8");
  } catch (e) {
    return { ok: false, reason: e.message };
  }
  const scope = existing ? existing.scope : (domain && domain !== "All" ? "domain" : "shared");
  const meta = parseMeta(content);
  return { ok: true, persona: { id: cleanId, name: meta.title || cleanId, scope, domain: domain || null, path: target } };
}

/** Create a new persona from a starter template (manual authoring path). */
function create(projectPath, domain, { name, content } = {}) {
  const cleanId = slug(name);
  if (!cleanId) return { ok: false, reason: "persona name required" };
  if (_findFile(projectPath, domain, cleanId)) return { ok: false, reason: `persona already exists: ${cleanId}` };
  const body = content && String(content).trim() ? content : template(name, domain);
  return save(projectPath, domain, cleanId, body);
}

function remove(projectPath, domain, id) {
  const hit = _findFile(projectPath, domain, id);
  if (!hit) return { ok: false, reason: `persona not found: ${id}` };
  const root = path.resolve(harnessPersonasRoot(projectPath));
  if (!path.resolve(hit.path).startsWith(root + path.sep)) return { ok: false, reason: "invalid persona path" };
  try { fs.unlinkSync(hit.path); } catch (e) { return { ok: false, reason: e.message }; }
  return { ok: true, id: hit.id };
}

/** Blank-ish starter template (used only when not AI-generating). */
function template(name, domain) {
  const scope = domain && domain !== "All" ? ` — ${domain} domain` : "";
  return [
    `# ${name || "New Persona"}${scope}`,
    "",
    "## Core Responsibility",
    "Describe what this role owns and why it exists.",
    "",
    "## Key Behaviors",
    "- ",
    "",
    "## Artifacts They Own",
    "- ",
    "",
    "## Interaction Rules",
    "- ",
  ].join("\n");
}

/**
 * Prompt for AI generation. Pure string builder so it's unit-testable; the IPC
 * layer feeds this to the Hermes CEO and saves the reply.
 */
function buildGeneratePrompt(name, brief, domain) {
  const scopeLine = domain && domain !== "All"
    ? `This persona is for the "${domain}" domain of the project.`
    : "This persona is project-wide.";
  return [
    `Write a concise but complete agent PERSONA as a Markdown document.`,
    scopeLine,
    ``,
    `Role name: ${name}`,
    `Brief from the human: ${brief || "(none — infer a sensible role from the name)"}`,
    ``,
    `Output ONLY the markdown (no preamble, no code fences). Use exactly these`,
    `sections as level-2 headings, with a single level-1 title at the top:`,
    `# <Role Name>`,
    `## Core Responsibility`,
    `## Key Behaviors`,
    `## Artifacts They Own`,
    `## Interaction Rules`,
    domain && domain !== "All" ? `## Special Power in This Domain (${domain})` : ``,
    ``,
    `Be specific and high-signal. Write in second/third person about the role,`,
    `not about yourself.`,
  ].filter((l) => l !== null && l !== undefined).join("\n");
}

/** Strip accidental code fences / preamble from an AI reply. */
function cleanGenerated(text) {
  let t = String(text || "").trim();
  t = t.replace(/^```(?:markdown|md)?\s*\n?/i, "").replace(/\n?```\s*$/i, "");
  const h1 = t.indexOf("# ");
  if (h1 > 0) t = t.slice(h1); // drop any preamble before the title
  return t.trim();
}

module.exports = {
  list, read, save, create, remove, template,
  buildGeneratePrompt, cleanGenerated, parseMeta,
  harnessPersonasRoot, appPersonasRoot, slug,
};
