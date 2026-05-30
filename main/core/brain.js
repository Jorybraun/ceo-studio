"use strict";
/**
 * The Brain — per-project context & memory (M0 / L0).
 *
 * Implements the artifact contract from the harness BRAIN_AND_GBRAIN_ROADMAP
 * (mirrored in CEO Studio E2E_PLAN §1). Principle: record first, synthesize
 * later. The JSONL indexes make context-gathering deterministic and cheap
 * (which also keeps token cost down at L1+).
 */
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { brainDir } = require("./paths");

const INDEX_FILES = [
  "artifacts", "decisions", "open_questions",
  "contradictions", "entities", "dream_cycles",
];

function layout(slug) {
  const root = brainDir(slug);
  const index = path.join(root, "index");
  const conversations = path.join(root, "conversations");
  const sessions = path.join(root, "sessions");
  return { root, index, conversations, sessions };
}

function initBrain(slug) {
  const L = layout(slug);
  for (const d of [L.index, L.conversations, L.sessions]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const name of INDEX_FILES) {
    const f = path.join(L.index, `${name}.jsonl`);
    if (!fs.existsSync(f)) fs.writeFileSync(f, "");
  }
  const strategy = path.join(L.root, "current_strategy.md");
  if (!fs.existsSync(strategy)) {
    fs.writeFileSync(strategy,
      `# Current Strategy (${slug})\n\n` +
      `_Synthesized view of "what is true now". Populated by the CEO Manager (L2)._\n`);
  }
  const judgment = path.join(L.root, "founder_judgment.md");
  if (!fs.existsSync(judgment)) {
    fs.writeFileSync(judgment, `# Founder Judgment (${slug})\n\n_Patterns in what the human accepts/rejects. Populated at L2._\n`);
  }
  return L;
}

function _id(seed) {
  return crypto.createHash("sha1").update(seed + ":" + Date.now() + ":" + Math.random())
    .digest("hex").slice(0, 16);
}

/**
 * Append an artifact to an index following the contract. `type` selects the
 * index file (artifact->artifacts, decision->decisions, contradiction->contradictions, ...).
 */
function writeArtifact(slug, artifact) {
  const L = initBrain(slug);
  const typeToIndex = {
    artifact: "artifacts", chat: "artifacts", agent_output: "artifacts",
    proposal: "artifacts", decision: "decisions", open_question: "open_questions",
    contradiction: "contradictions", entity: "entities", dream_cycle: "dream_cycles",
  };
  const idxName = typeToIndex[artifact.type] || "artifacts";
  const record = {
    id: artifact.id || _id(artifact.title || artifact.type || "artifact"),
    type: artifact.type || "artifact",
    title: artifact.title || "(untitled)",
    created_at: artifact.created_at || new Date().toISOString(),
    source: artifact.source || { system: "manual", path: null, actor: null },
    project: slug,
    domain: artifact.domain || null,
    summary: artifact.summary || "",
    provenance: artifact.provenance || { raw_refs: [], related_artifacts: [] },
    status: artifact.status || "active",
  };
  fs.appendFileSync(path.join(L.index, `${idxName}.jsonl`), JSON.stringify(record) + "\n");
  return record;
}

function readIndex(slug, name) {
  const L = layout(slug);
  const f = path.join(L.index, `${name}.jsonl`);
  if (!fs.existsSync(f)) return [];
  return fs.readFileSync(f, "utf-8").split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

/**
 * Index a project's markdown docs into artifacts.jsonl so the agent has cheap,
 * deterministic context (no full-repo scan at query time). Skips heavy dirs.
 */
function indexProjectDocs(slug, projectPath, { maxFiles = 2000 } = {}) {
  initBrain(slug);
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "__pycache__", ".venv", "venv"]);
  const docs = [];
  const walk = (dir) => {
    if (docs.length >= maxFiles) return;
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (docs.length >= maxFiles) break;
      if (e.name.startsWith(".") && e.name !== ".") continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP.has(e.name)) continue;
        walk(full);
      } else if (e.isFile() && e.name.toLowerCase().endsWith(".md")) {
        docs.push(full);
      }
    }
  };
  walk(projectPath);

  // Reset artifacts index for a clean re-scan, then write.
  const L = layout(slug);
  fs.writeFileSync(path.join(L.index, "artifacts.jsonl"), "");
  let count = 0;
  for (const f of docs) {
    let summary = "";
    try {
      const text = fs.readFileSync(f, "utf-8");
      const heading = text.split("\n").find((l) => l.trim().startsWith("#"));
      summary = (heading || text.split("\n").find((l) => l.trim()) || "").slice(0, 200);
    } catch { /* ignore */ }
    writeArtifact(slug, {
      type: "artifact",
      title: path.relative(projectPath, f),
      summary,
      source: { system: "filescan", path: path.relative(projectPath, f), actor: null },
    });
    count++;
  }
  return { indexed: count };
}

/** Cheap, deterministic context load for an agent session. */
function loadContext(slug) {
  const L = initBrain(slug);
  let strategy = "";
  try { strategy = fs.readFileSync(path.join(L.root, "current_strategy.md"), "utf-8"); } catch { /* */ }
  return {
    strategy,
    counts: {
      artifacts: readIndex(slug, "artifacts").length,
      decisions: readIndex(slug, "decisions").length,
      open_questions: readIndex(slug, "open_questions").length,
      contradictions: readIndex(slug, "contradictions").length,
    },
  };
}

module.exports = {
  INDEX_FILES, layout, initBrain, writeArtifact, readIndex,
  indexProjectDocs, loadContext,
};
