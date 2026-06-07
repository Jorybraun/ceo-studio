"use strict";
/**
 * Dispatch a chat turn to a registry agent inside a studio session room.
 * Uses harness `bin/agent tell` (agent_adapter) so any provider works in the
 * session's durable (room, agent) workdir — including Hermes `ceo`.
 */
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");
const { resolvePython, envWithPython } = require("./pybin");
const hermes = require("./hermes");
const mount = require("./mount");
const sessions = require("./sessions");

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

/** One conversational turn via agent_adapter.converse (works on first turn in a room). */
function converse(projectPath, agentId, room, message, { timeoutSec = 300, persona, allowPaid = false } = {}) {
  const plan = mount.lookup(projectPath, agentId);
  if (!plan) return { ok: false, reason: `agent not found in registry: ${agentId}` };
  const root = harnessRoot(projectPath);
  const safeRoom = String(room || plan.canonical_room || plan.default_room || "discovery").trim();
  const personaArg = persona || plan.persona || null;
  const code = [
    "import json, sys",
    "from agents import agent_adapter",
    `r = agent_adapter.converse(${JSON.stringify(String(agentId))}, ${JSON.stringify(safeRoom)}, ${JSON.stringify(String(message))},`,
    `    provider=${JSON.stringify(plan.provider || null)}, model=${JSON.stringify(plan.model || null)},`,
    `    persona=${JSON.stringify(personaArg)}, timeout=${Number(timeoutSec) || 300}, interactive=False)`,
    "print(json.dumps(r))",
  ].join("\n");
  try {
    const out = execFileSync(resolvePython(), ["-c", code], {
      cwd: root,
      env: harnessEnv(projectPath, { CEO_ALLOW_PAID: "1" }), // always enable real models (user: on all the time)
      encoding: "utf8",
      timeout: (timeoutSec + 45) * 1000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const r = JSON.parse(String(out || "").trim() || "{}");
    if (!r.ok) return { ok: false, reason: r.reason || r.reply || "converse refused", raw: r };
    return { ok: true, reply: r.reply || "", room: safeRoom, agentId, provider: r.provider || plan.provider };
  } catch (e) {
    const err = ((e.stderr || e.stdout || e.message) + "").trim();
    return { ok: false, reason: err || "agent converse failed" };
  }
}

/** Stream when lead uses Hermes in the CEO workdir pattern; else chunk a blocking reply. */
async function askLead(projectPath, session, message, { onDelta } = {}) {
  const agentId = session.leadAgentId;
  const room = session.room;
  const plan = mount.lookup(projectPath, agentId);
  if (!plan) return { ok: false, reason: `agent not found: ${agentId}` };

  const prompt = _sessionPrompt(session, message);

  if (plan.provider === "hermes" && agentId === "ceo" && typeof onDelta === "function") {
    const r = await hermes.askStream(prompt, { onDelta, projectPath });
    if (r.ok) return r;
  }

  const r = converse(projectPath, agentId, room, prompt, {
    timeoutSec: 300,
    allowPaid: session.allowPaid === true,
  });
  if (!r.ok) return r;
  if (typeof onDelta === "function" && r.reply) {
    const chunk = 48;
    for (let i = 0; i < r.reply.length; i += chunk) {
      onDelta(r.reply.slice(i, i + chunk));
    }
  }
  return { ok: true, reply: r.reply, session: null };
}

function _sessionPrompt(session, message) {
  const bits = [
    `[Studio session: ${session.title || session.id}]`,
    `[Phase: ${session.phase || "explore"}]`,
    session.planDoc && session.planDoc.body
      ? `Plan on file: "${session.planDoc.title}" (${session.planApprovedAt ? "approved" : "awaiting approval"}).`
      : "No plan captured yet — help the human explore and capture a plan.",
    session.phase === "execute"
      ? "You are facilitating execution. Sub-agents may be active in this room; coordinate via the room bus."
      : "You are the lead facilitator. Gather requirements, propose plans (agui markdown), suggest a team roster, decompose steps.",
    (session.plannedTeam || []).length
      ? `Planned team (not yet launched): ${session.plannedTeam.map((t) => `[${t.role}] ${t.agentId}`).join(", ")}`
      : "",
    (session.taskTree || []).length
      ? `Task tree has ${session.taskTree.length} root step(s).`
      : "",
  ];
  const decomp = sessions.getDecompositionSummary(session);
  if (decomp.items && decomp.items.length) {
    bits.push(
      `Decomposition (${decomp.source}): ${decomp.items.map((i) => `[${i.type}] ${i.title} (${i.status})`).join("; ")}`,
    );
  } else if (session.phase === "decompose" || session.phase === "execute") {
    bits.push("Decomposition is empty — propose agenda-style decomposition items (type decomposition/step) in an agui list for the left panel.");
  }
  if ((session.workers || []).length) {
    bits.push(`Active workers: ${session.workers.map((w) => `${w.role || w.agentId} (${w.agentId}, ${w.status})`).join(", ")}`);
  }
  return `${bits.join("\n")}\n\n---\n\n${String(message || "").trim()}`;
}

module.exports = { converse, askLead, _sessionPrompt };
