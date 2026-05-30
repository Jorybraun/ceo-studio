"use strict";
/**
 * Tiny, zero-dependency .env loader.
 *
 * Loads key=value lines from `.env.local` (and `.env`) at the repo root into
 * process.env WITHOUT overwriting variables that are already set (so a value
 * exported by the launching shell always wins). Kept dependency-free on
 * purpose — the app must boot offline with no install step.
 *
 * Used for secrets like ELEVENLABS_API_KEY. Never logs values.
 */
const fs = require("fs");
const path = require("path");

function parseEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    if (!key) continue;
    let val = line.slice(eq + 1).trim();
    // Strip matching surrounding quotes.
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    out[key] = val;
  }
  return out;
}

/**
 * Load env files from `rootDir`. Existing process.env values are preserved.
 * Returns the list of files actually loaded (for a non-secret startup log).
 */
function loadEnv(rootDir = path.join(__dirname, "..", "..")) {
  const files = [".env.local", ".env"];
  const loaded = [];
  for (const name of files) {
    const file = path.join(rootDir, name);
    let text;
    try { text = fs.readFileSync(file, "utf-8"); } catch { continue; }
    const vars = parseEnv(text);
    for (const [k, v] of Object.entries(vars)) {
      if (process.env[k] === undefined) process.env[k] = v;
    }
    loaded.push(name);
  }
  return loaded;
}

module.exports = { loadEnv, parseEnv };
