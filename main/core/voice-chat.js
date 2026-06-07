"use strict";
/**
 * Voice Chat - 2-way voice conversation with any agent in the pilot seat.
 *
 * Flow:
 *   1. User picks agent from pilot seat (defaults to CEO)
 *   2. User speaks (Web Speech API in renderer)
 *   3. This module routes to selected agent's provider
 *   4. Agent responds
 *   5. Piper TTS speaks the response
 *
 * Providers supported:
 *   - hermes: hermes chat -q (CEO, Planner, etc.)
 *   - devin: devin --model -p (Builder, SWE agents)
 *   - claude: claude --prompt (if claude CLI installed)
 *   - command: custom command template
 */
const { spawn, exec } = require("child_process");
const path = require("path");
const util = require("util");
const registry = require("./registry");
const hermes = require("./hermes");

const execAsync = util.promisify(exec);

// Piper TTS config
const PIPER_BIN = path.join(process.env.HOME, ".venv-piper", "bin", "piper");
const PIPER_VOICE = path.join(process.env.HOME, ".local", "share", "piper", "voices", "en_US-amy-medium.onnx");

// Current pilot seat selection
let _pilotAgentId = "ceo";
let _isSpeaking = false;

/**
 * Lookup an agent by ID from the registry.
 */
function lookupAgent(agentId) {
  const r = registry.read();
  if (!r.ok) return null;
  return r.agents.find(a => a.id === agentId) || null;
}

/**
 * Set which agent is in the pilot seat.
 */
function setPilot(agentId) {
  const agent = lookupAgent(agentId);
  if (!agent) return { ok: false, reason: `Agent not found: ${agentId}` };
  _pilotAgentId = agentId;
  return { ok: true, agentId, agent };
}

/**
 * Get current pilot seat agent.
 */
function getPilot() {
  return {
    agentId: _pilotAgentId,
    agent: lookupAgent(_pilotAgentId),
  };
}

/**
 * Check if Piper TTS is available.
 */
async function piperAvailable() {
  try {
    await execAsync(`test -f "${PIPER_BIN}" && test -f "${PIPER_VOICE}"`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Speak text using Piper TTS (streaming to speakers).
 */
async function speak(text) {
  if (!text || !text.trim()) return { ok: false, reason: "No text to speak" };
  if (_isSpeaking) {
    // Could queue or interrupt; for now, just return busy
    return { ok: false, reason: "Already speaking", busy: true };
  }

  const available = await piperAvailable();
  if (!available) {
    // Fallback to macOS say
    return speakWithSay(text);
  }

  _isSpeaking = true;
  try {
    // Piper generates audio, pipe to afplay for immediate playback
    const command = `echo ${JSON.stringify(text)} | "${PIPER_BIN}" --model "${PIPER_VOICE}" --output_file - | afplay -`;
    await execAsync(command, { timeout: 30000 });
    return { ok: true, text, durationMs: null };
  } catch (e) {
    // Fallback to say on error
    return speakWithSay(text);
  } finally {
    _isSpeaking = false;
  }
}

/**
 * Fallback TTS using macOS say command.
 */
async function speakWithSay(text) {
  try {
    const voice = "Samantha"; // Good default voice
    await execAsync(`say -v "${voice}" ${JSON.stringify(text)}`, { timeout: 30000 });
    return { ok: true, text, fallback: "say" };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Route conversation to the selected agent based on its provider.
 */
async function chat(text, opts = {}) {
  if (!text || !text.trim()) return { ok: false, reason: "No input text" };

  const agentId = opts.agentId || _pilotAgentId;
  const agent = lookupAgent(agentId);
  if (!agent) return { ok: false, reason: `Agent not found: ${agentId}` };

  // Build context-aware prompt
  const context = await buildContext(agent);
  const fullPrompt = context ? `${context}\n\nUser: ${text}` : text;

  // Route based on provider
  let response;
  switch (agent.provider) {
    case "hermes":
      response = await chatWithHermes(fullPrompt, agent);
      break;
    case "devin":
      response = await chatWithDevin(fullPrompt, agent);
      break;
    case "claude":
      response = await chatWithClaude(fullPrompt, agent);
      break;
    case "command":
      response = await chatWithCommand(fullPrompt, agent);
      break;
    default:
      // Fallback to hermes if no specific handler
      response = await chatWithHermes(fullPrompt, agent);
  }

  if (!response.ok) return response;

  // Auto-speak the response (unless muted)
  if (!opts.mute) {
    await speak(response.text);
  }

  return {
    ok: true,
    agentId,
    agentName: agent.name,
    text: response.text,
    spoken: !opts.mute,
  };
}

/**
 * Build context for the agent (project state, kanban, recent tasks).
 */
async function buildContext(agent) {
  const parts = [];
  parts.push(`You are ${agent.name}, an AI ${agent.capabilities?.join(", ") || "assistant"}.`);
  parts.push(`Your persona: ${agent.persona || "professional, helpful"}.`);

  // Add kanban context if available
  try {
    const board = hermes.getBoard();
    if (board && board.ok) {
      const ready = Object.values(board.columns || {}).flat().filter(t => t.status === "ready").length;
      const running = Object.values(board.columns || {}).flat().filter(t => t.status === "running").length;
      parts.push(`Current project board: ${ready} ready tasks, ${running} running.`);
    }
  } catch {
    // Ignore if board unavailable
  }

  return parts.join("\n");
}

/**
 * Chat via Hermes CLI.
 */
async function chatWithHermes(prompt, agent) {
  try {
    // Use hermes chat -q with optional profile
    const args = ["chat", "-q", prompt, "-Q", "--accept-hooks"];
    if (agent.profile) {
      args.push("-p", agent.profile);
    }

    const result = await execAsync(`hermes ${args.map(a => JSON.stringify(a)).join(" ")}`, {
      timeout: 120000,
      encoding: "utf8",
    });

    return { ok: true, text: result.stdout?.trim() || "No response" };
  } catch (e) {
    return { ok: false, reason: `Hermes chat failed: ${e.message}` };
  }
}

/**
 * Chat via Devin CLI.
 */
async function chatWithDevin(prompt, agent) {
  try {
    const model = agent.model || "swe-1.6";
    const result = await execAsync(`devin --model ${model} -p -- ${JSON.stringify(prompt)}`, {
      timeout: 180000,
      encoding: "utf8",
    });

    return { ok: true, text: result.stdout?.trim() || "No response" };
  } catch (e) {
    return { ok: false, reason: `Devin chat failed: ${e.message}` };
  }
}

/**
 * Chat via Claude CLI.
 */
async function chatWithClaude(prompt, agent) {
  try {
    // Assumes claude CLI is installed
    const result = await execAsync(`claude --prompt ${JSON.stringify(prompt)}`, {
      timeout: 120000,
      encoding: "utf8",
    });
    return { ok: true, text: result.stdout?.trim() || "No response" };
  } catch (e) {
    return { ok: false, reason: `Claude chat failed: ${e.message}` };
  }
}

/**
 * Chat via custom command template.
 */
async function chatWithCommand(prompt, agent) {
  if (!agent.command) {
    return { ok: false, reason: "Command provider missing command template" };
  }
  try {
    const command = agent.command.replace(/\{\{prompt\}\}/g, prompt);
    const result = await execAsync(command, {
      timeout: 120000,
      encoding: "utf8",
    });
    return { ok: true, text: result.stdout?.trim() || "No response" };
  } catch (e) {
    return { ok: false, reason: `Command execution failed: ${e.message}` };
  }
}

/**
 * Interrupt current speech.
 */
function interrupt() {
  try {
    exec("killall afplay say 2>/dev/null");
    _isSpeaking = false;
    return { ok: true };
  } catch {
    return { ok: false };
  }
}

/**
 * Get voice chat status.
 */
function status() {
  return {
    pilotAgentId: _pilotAgentId,
    pilot: lookupAgent(_pilotAgentId),
    isSpeaking: _isSpeaking,
    piperAvailable: piperAvailable(),
  };
}

module.exports = {
  setPilot,
  getPilot,
  chat,
  speak,
  interrupt,
  status,
  piperAvailable,
};
