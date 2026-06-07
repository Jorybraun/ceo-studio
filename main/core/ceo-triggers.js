"use strict";
/**
 * CEO Trigger System - File-based triggers for CEO to request UI actions.
 *
 * Since the CEO (Hermes agent) doesn't have direct IPC access to CEO Studio,
 * it writes trigger requests to a file that CEO Studio's main process watches.
 * When a trigger is detected, the corresponding UI action is executed.
 */

const fs = require("fs");
const path = require("path");
const os = require("os");

const TRIGGER_DIR = path.join(os.tmpdir(), "ceo-studio-triggers");
const TRIGGER_FILE = path.join(TRIGGER_DIR, "terminal-open.json");

// Ensure trigger directory exists
try {
  fs.mkdirSync(TRIGGER_DIR, { recursive: true });
} catch (e) {
  // Directory might already exist
}

/**
 * Write a terminal open trigger request.
 * Called by the CEO via the ceo-studio-terminal command.
 */
function writeTerminalOpenTrigger(agentId) {
  const trigger = {
    type: "terminal-open",
    agentId: String(agentId),
    timestamp: Date.now(),
  };
  try {
    fs.writeFileSync(TRIGGER_FILE, JSON.stringify(trigger, null, 2));
    return { ok: true, trigger };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Read and clear the trigger file.
 * Called by CEO Studio main process when polling for triggers.
 */
function readTrigger() {
  try {
    if (!fs.existsSync(TRIGGER_FILE)) {
      return null;
    }
    const content = fs.readFileSync(TRIGGER_FILE, "utf8");
    const trigger = JSON.parse(content);
    // Clear the trigger after reading
    fs.unlinkSync(TRIGGER_FILE);
    return trigger;
  } catch (e) {
    // If file is corrupted or unreadable, try to clear it
    try {
      fs.unlinkSync(TRIGGER_FILE);
    } catch {}
    return null;
  }
}

/**
 * Start watching for triggers in the main process.
 * This should be called when CEO Studio starts.
 */
let watcher = null;
let triggerCallback = null;

function startWatching(callback) {
  if (watcher) {
    stopWatching();
  }
  
  triggerCallback = callback;
  
  // Poll every 500ms for trigger files
  // (File watching can be flaky across platforms, polling is more reliable)
  watcher = setInterval(() => {
    const trigger = readTrigger();
    if (trigger && triggerCallback) {
      try {
        triggerCallback(trigger);
      } catch (e) {
        console.error("Error processing CEO trigger:", e);
      }
    }
  }, 500);
  
  return { ok: true };
}

function stopWatching() {
  if (watcher) {
    clearInterval(watcher);
    watcher = null;
  }
  triggerCallback = null;
  return { ok: true };
}

module.exports = {
  writeTerminalOpenTrigger,
  readTrigger,
  startWatching,
  stopWatching,
  TRIGGER_DIR,
  TRIGGER_FILE,
};
