"use strict";
/**
 * Resolve a usable `python3` for the harness helpers + agent launches.
 *
 * Why this exists: macOS GUI apps launched from Finder/Dock (a packaged
 * `.app`) inherit a bare PATH (`/usr/bin:/bin:/usr/sbin:/sbin`) and do NOT see
 * Homebrew's python3 (`/opt/homebrew/bin`). Anything that shells out to
 * `python3` then silently fails — which is what made the agent registry show
 * "0 agents" and would make meetings / the A2A watcher no-op once packaged.
 *
 * We resolve an absolute python3 once and reuse it. `envWithPython()` also
 * returns an env whose PATH includes python's dir, so child scripts that
 * themselves call `python3` / `tmux` keep working.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");

let _cached = null;

const CANDIDATES = [
  process.env.CEO_PYTHON,
  process.env.PYTHON,
  "/opt/homebrew/bin/python3",
  "/usr/local/bin/python3",
  "/usr/bin/python3",
  "/opt/local/bin/python3",
];

function _works(bin) {
  if (!bin) return false;
  try {
    execFileSync(bin, ["--version"], { stdio: "ignore", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/** Absolute path to a working python3, or "python3" as a last resort. */
function resolvePython() {
  if (_cached) return _cached;
  for (const c of CANDIDATES) {
    if (c && fs.existsSync(c) && _works(c)) { _cached = c; return _cached; }
  }
  // Try the shell's `which` (works when the app was started from a terminal).
  for (const finder of ["/usr/bin/which", "/bin/which"]) {
    try {
      const found = execFileSync(finder, ["python3"], { encoding: "utf8", timeout: 2000 }).trim();
      if (found && _works(found)) { _cached = found; return _cached; }
    } catch { /* keep trying */ }
  }
  _cached = "python3"; // last resort; may fail in a packaged GUI
  return _cached;
}

/** A PATH-augmented env so child scripts can find python3 (and common bins). */
function envWithPython(extra = {}) {
  const py = resolvePython();
  const dir = py.includes(path.sep) ? path.dirname(py) : "/opt/homebrew/bin";
  const extras = [dir, "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin"];
  const cur = (process.env.PATH || "").split(path.delimiter);
  const merged = [...new Set([...extras, ...cur])].join(path.delimiter);
  return { ...process.env, PATH: merged, ...extra };
}

module.exports = { resolvePython, envWithPython };
