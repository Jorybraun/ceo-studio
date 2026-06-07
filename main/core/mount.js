"use strict";
/**
 * Mount / unmount agents into live tmux sessions, and read/drive their
 * terminals — the cockpit side of the harness's `launch-agent`.
 *
 * "Mount" an agent = run `bin/launch-agent --name <id>`, which (per the agent's
 * registry entry) starts its provider CLI in a tmux session AND a persona-aware
 * `domain-room watch` window (its A2A participation). Because we bridged
 * registry.py to read agents.json, UI-created agents are launchable here.
 *
 * "Unmount" = kill the tmux session. "Snapshot/send" = capture-pane / send-keys
 * so the renderer can show the agent's live terminal and type into it.
 *
 * Everything runs with a PATH-augmented env (see pybin) so python3 + tmux are
 * found even in a packaged GUI.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync, spawnSync } = require("child_process");
const { resolvePython, envWithPython } = require("./pybin");

function harnessRoot(projectPath) {
  const projectHarness = projectPath ? path.join(projectPath, "runtime", "harness") : "";
  if (projectHarness && fs.existsSync(path.join(projectHarness, "agents", "registry.py"))) {
    return projectHarness;
  }
  return path.join(__dirname, "..", "..", "runtime", "harness");
}

function harnessEnv(projectPath, extra = {}) {
  const workspace = projectPath ? { HARNESS_WORKSPACE: projectPath } : {};
  return envWithPython({ ...workspace, ...extra });
}

function _tmux(args, opts = {}) {
  return execFileSync("tmux", args, { encoding: "utf8", timeout: 3000, env: envWithPython(), ...opts });
}

function alive(session) {
  if (!session) return false;
  try { _tmux(["has-session", "-t", `=${session}`], { stdio: "ignore" }); return true; }
  catch { return false; }
}

/** List the window names in a session (empty array if the session is gone). */
function _windows(session) {
  try {
    const out = _tmux(["list-windows", "-t", `=${session}`, "-F", "#{window_name}"]);
    return out.split("\n").map((s) => s.trim()).filter(Boolean);
  } catch { return []; }
}

/**
 * Resolve the window to capture/drive. The persisted `tmux_window` can be wrong
 * (e.g. registry reports "main" but a watcher_only agent's only window is named
 * "watcher"), so we validate against the live session and fall back sensibly:
 * prefer the requested window, else the agent's brain window (non-"watcher"),
 * else the first window that actually exists.
 */
function resolveWindow(session, preferred) {
  const wins = _windows(session);
  if (preferred && wins.includes(preferred)) return preferred;
  return wins.find((w) => w !== "watcher") || wins[0] || preferred || "main";
}

/**
 * Explain WHY a launch produced no session. launch-agent exits before creating
 * the tmux session on a guardrail denial (e.g. "max concurrent agents reached"),
 * a disabled/non-launchable agent, or a missing profile — but the only signal
 * was a generic "tmux session did not start". Surface the real cause from the
 * captured output so the cockpit shows something actionable.
 */
function failureReason(output) {
  const text = (output || "").trim();
  if (!text) return "tmux session did not start (see output)";
  const guardrail = text.match(/Spawn refused by cost guardrail:\s*(.+)/i);
  if (guardrail) return `spawn refused by guardrail: ${guardrail[1].trim()}`;
  const err = text.match(/^Error:\s*(.+)$/im);
  if (err) return err[1].trim();
  const lines = text.split("\n").map((s) => s.trim()).filter(Boolean);
  const last = lines[lines.length - 1];
  return last ? `tmux session did not start: ${last}` : "tmux session did not start (see output)";
}

/** The window a freshly-launched agent actually runs in, per its launch mode. */
function liveWindow(plan) {
  if (plan && plan.launch_mode === "watcher_only") return plan.watcher_window || "watcher";
  return (plan && plan.tmux_window) || "main";
}

/** Ask the harness registry for an agent's launch plan (tmux session, room, launchability). */
function lookup(projectPath, id) {
  const root = harnessRoot(projectPath);
  try {
    const out = execFileSync(
      resolvePython(),
      [path.join(root, "agents", "registry.py"), "lookup", String(id), "--format", "json"],
      { encoding: "utf8", timeout: 5000, cwd: root, env: harnessEnv(projectPath) },
    );
    return JSON.parse(out);
  } catch {
    return null;
  }
}

function mount(projectPath, id, opts = {}) {
  const plan = lookup(projectPath, id);
  if (!plan) return { ok: false, reason: `agent not found in registry: ${id}` };
  if (plan.launchable === false) return { ok: false, reason: plan.launch_status_reason || "agent is not launchable" };
  const root = harnessRoot(projectPath);
  const bin = path.join(root, "bin", "launch-agent");
  const extraEnv = { CEO_ALLOW_PAID: "1" }; // always enable real models (user: on all the time)
  const r = spawnSync(bin, ["--name", String(id)], {
    cwd: root,
    env: harnessEnv(projectPath, extraEnv),
    encoding: "utf8",
    timeout: 20000,
    input: "no\n", // never hang on an interactive guardrail prompt
  });
  const output = ((r.stdout || "") + (r.stderr || "")).trim();
  const session = plan.tmux_session || `pipe-${id}`;
  const ok = alive(session);
  // Use the window the agent ACTUALLY launched in, validated against the live
  // session (launch mode decides the name: watcher_only -> "watcher").
  const window = ok ? resolveWindow(session, liveWindow(plan)) : liveWindow(plan);
  return {
    ok,
    session,
    window,
    room: plan.canonical_room || plan.default_room || "discovery",
    speaker: plan.room_speaker || id,
    output,
    reason: ok ? undefined : failureReason(output),
  };
}

function unmount(projectPath, id) {
  const plan = lookup(projectPath, id);
  const session = (plan && plan.tmux_session) || `pipe-${id}`;
  if (!alive(session)) return { ok: true, session, already: true };
  try { _tmux(["kill-session", "-t", `=${session}`], { stdio: "ignore" }); return { ok: true, session }; }
  catch (e) { return { ok: false, reason: e.message }; }
}

function snapshot(session, window = "main", lines = 300) {
  if (!alive(session)) return { ok: false, reason: `session not running: ${session}` };
  const win = resolveWindow(session, window);
  try {
    const output = _tmux(["capture-pane", "-p", "-S", `-${lines}`, "-t", `=${session}:${win}`]);
    return { ok: true, output, window: win };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

function send(session, window, text) {
  if (!alive(session)) return { ok: false, reason: `session not running: ${session}` };
  const value = String(text || "");
  const target = `=${session}:${resolveWindow(session, window)}`;
  try {
    _tmux(["send-keys", "-t", target, "-l", value], { stdio: "ignore" });
    _tmux(["send-keys", "-t", target, "Enter"], { stdio: "ignore" });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Post a message into an agent's A2A room as a named speaker. This is the REAL
 * way to talk to a room-based agent (watcher_only / echo): its `domain-room
 * watch` loop sees the message and replies in the room. Sending tmux keystrokes
 * to a watcher window does nothing useful, which is why "talking" felt broken.
 */
function post(projectPath, room, speaker, message) {
  if (!room) return { ok: false, reason: "room required" };
  if (!String(message || "").trim()) return { ok: false, reason: "message required" };
  const root = harnessRoot(projectPath);
  const bin = path.join(root, "bin", "domain-room");
  try {
    execFileSync(bin, ["post", String(room), String(speaker || "CEO"), String(message)], {
      cwd: root, env: harnessEnv(projectPath), encoding: "utf8", timeout: 8000,
    });
    return { ok: true, room, speaker: speaker || "CEO" };
  } catch (e) {
    return { ok: false, reason: ((e.stderr || e.message || "post failed") + "").trim() };
  }
}

module.exports = { mount, unmount, snapshot, send, post, alive, lookup };
