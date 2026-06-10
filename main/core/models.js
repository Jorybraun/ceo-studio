"use strict";
/**
 * Model catalog — the captured, selectable models for each brain provider.
 *
 * The catalog itself is produced by `runtime/harness/models/capture_models.py`,
 * which reads each provider's real source of truth (the codex/grok caches, the
 * hermes provider cache, `pi --list-models`, the configured Vertex/Gemma model)
 * and writes `runtime/harness/models/catalog.json`. This module just READS that
 * file so the cockpit can offer a model dropdown per provider. No Python
 * shell-out on the read path (macOS GUI apps don't inherit the shell PATH).
 *
 * Resolution mirrors the registry: prefer the open project's harness, fall back
 * to the shipped harness in the app dir.
 */
const path = require("path");
const fs = require("fs");

function catalogPaths(projectPath) {
  const rel = path.join("runtime", "harness", "models", "catalog.json");
  const out = [];
  if (projectPath) out.push(path.join(projectPath, rel));
  out.push(path.join(process.cwd(), rel));
  const seen = new Set();
  return out.filter((p) => {
    const r = path.resolve(p);
    if (seen.has(r)) return false;
    seen.add(r);
    return true;
  });
}

/** Read the catalog. Returns { ok, capturedAt, providers } — providers maps
 *  providerName -> [{ id, label, context?, source?, thinking?, images? }]. */
function catalog(projectPath) {
  for (const p of catalogPaths(projectPath)) {
    if (!fs.existsSync(p)) continue;
    try {
      const data = JSON.parse(fs.readFileSync(p, "utf8"));
      return {
        ok: true,
        capturedAt: data.captured_at || null,
        providers: data.providers || {},
        path: p,
      };
    } catch (e) {
      return { ok: false, reason: `catalog parse error: ${e.message}`, providers: {} };
    }
  }
  return { ok: false, reason: "no model catalog captured yet (run capture_models.py)", providers: {} };
}

/** Models for one provider (or [] if unknown / none). */
function modelsFor(projectPath, provider) {
  const c = catalog(projectPath);
  return (c.providers && c.providers[provider]) || [];
}

module.exports = { catalog, modelsFor, catalogPaths };
