"use strict";
/**
 * node-pty 1.1.0 ships Darwin prebuild spawn-helper files that can arrive
 * without executable bits in this environment. Without this, pty.spawn fails
 * with "posix_spawnp failed" even for /bin/bash.
 */
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
for (const rel of [
  path.join("darwin-arm64", "spawn-helper"),
  path.join("darwin-x64", "spawn-helper"),
]) {
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) continue;
  try {
    fs.chmodSync(file, 0o755);
    console.log(`[node-pty] executable: ${rel}`);
  } catch (e) {
    console.warn(`[node-pty] could not chmod ${rel}: ${e.message}`);
  }
}
