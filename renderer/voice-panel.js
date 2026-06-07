"use strict";
/**
 * Voice Panel - 2-way voice conversation with the pilot seat agent.
 *
 * Features:
 *   - Web Speech API for STT (free, built into Chromium)
 *   - Hold-to-speak mic button
 *   - Real-time transcription
 *   - Pilot seat agent selector
 *   - Conversation transcript
 *   - Interrupt button
 */

// Web Speech API recognition instance
let recognition = null;
let isListening = false;
let transcript = "";
let conversation = [];
let currentPilot = { agentId: "ceo", agent: null };

/**
 * Initialize the voice panel.
 */
function initVoicePanel() {
  // Check Web Speech API availability
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    console.warn("[voice] Web Speech API not available");
    return;
  }

  // Create recognition instance
  recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = true;
  recognition.lang = "en-US";

  recognition.onstart = () => {
    isListening = true;
    transcript = "";
    updateMicButton(true);
    addToTranscript("...", "user-interim");
  };

  recognition.onresult = (event) => {
    let finalTranscript = "";
    let interimTranscript = "";

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i];
      if (result.isFinal) {
        finalTranscript += result[0].transcript;
      } else {
        interimTranscript += result[0].transcript;
      }
    }

    if (finalTranscript) {
      transcript = finalTranscript;
      updateLastTranscript(finalTranscript, "user");
    } else if (interimTranscript) {
      updateLastTranscript(interimTranscript, "user-interim");
    }
  };

  recognition.onerror = (event) => {
    console.error("[voice] Speech recognition error:", event.error);
    isListening = false;
    updateMicButton(false);
    addToTranscript(`Error: ${event.error}`, "error");
  };

  recognition.onend = () => {
    isListening = false;
    updateMicButton(false);

    // Send transcript to agent if we have one
    if (transcript.trim()) {
      sendToAgent(transcript.trim());
    }
  };

  // Load current pilot
  loadPilot();

  // Render the UI
  renderVoicePanel();
}

/**
 * Load current pilot seat agent from main process.
 */
async function loadPilot() {
  try {
    const result = await window.ceo.voiceChatPilot();
    if (result && result.ok !== false) {
      currentPilot = result;
      updatePilotDisplay();
    }
  } catch (e) {
    console.error("[voice] Failed to load pilot:", e);
  }
}

/**
 * Set pilot seat agent.
 */
async function setPilot(agentId) {
  try {
    const result = await window.ceo.voiceChatSetPilot(agentId);
    if (result.ok) {
      currentPilot = { agentId, agent: result.agent };
      updatePilotDisplay();
      addToTranscript(`Switched to ${result.agent?.name || agentId}`, "system");
    }
  } catch (e) {
    console.error("[voice] Failed to set pilot:", e);
  }
}

/**
 * Start listening (hold mic button).
 */
function startListening() {
  if (!recognition || isListening) return;
  try {
    recognition.start();
  } catch (e) {
    console.error("[voice] Failed to start recognition:", e);
  }
}

/**
 * Stop listening (release mic button).
 */
function stopListening() {
  if (!recognition || !isListening) return;
  try {
    recognition.stop();
  } catch (e) {
    console.error("[voice] Failed to stop recognition:", e);
  }
}

/**
 * Send transcript to agent and get response.
 */
async function sendToAgent(text) {
  addToTranscript(text, "user-final");
  addToTranscript("...", "agent-interim");

  try {
    const result = await window.ceo.voiceChat(text);

    // Remove interim marker
    removeLastInterim();

    if (result.ok) {
      addToTranscript(result.text, "agent", result.agentName);
      // Response is spoken automatically by Piper in main process
    } else {
      addToTranscript(`Error: ${result.reason}`, "error");
    }
  } catch (e) {
    removeLastInterim();
    addToTranscript(`Error: ${e.message}`, "error");
  }
}

/**
 * Interrupt current speech.
 */
async function interruptSpeech() {
  try {
    await window.ceo.voiceChatInterrupt();
    addToTranscript("(interrupted)", "system");
  } catch (e) {
    console.error("[voice] Failed to interrupt:", e);
  }
}

/**
 * Render the voice panel UI.
 */
function renderVoicePanel() {
  const container = document.getElementById("voice-panel-container");
  if (!container) return;

  container.innerHTML = `
    <div id="voice-panel" class="voice-panel">
      <div class="voice-header">
        <div class="pilot-selector">
          <label>Pilot:</label>
          <select id="pilot-select" onchange="voicePanel.setPilot(this.value)">
            <option value="ceo">CEO</option>
            <option value="ba">BA</option>
            <option value="architect">Architect</option>
            <option value="pm">PM</option>
            <option value="builder">Builder</option>
          </select>
          <span id="pilot-status" class="pilot-status"></span>
        </div>
        <button id="interrupt-btn" class="interrupt-btn" onclick="voicePanel.interrupt()">⏹ Stop</button>
      </div>

      <div id="transcript-container" class="transcript-container">
        <div class="transcript-welcome">
          Hold the microphone button and speak to the pilot agent.
        </div>
      </div>

      <div class="voice-controls">
        <button id="mic-btn" class="mic-btn" aria-label="Hold to speak">
          <span class="mic-icon" aria-hidden="true">🎤</span>
          <span class="mic-label">Hold to speak</span>
        </button>
      </div>

      <div class="voice-hints">
        <small>Web Speech API (local) • Piper TTS (local)</small>
      </div>
    </div>
  `;

  // Wire mic button with pointer capture so pressing and holding never loses
  // the button even if the cursor drifts off it during layout changes.
  const micBtn = document.getElementById("mic-btn");
  if (micBtn) {
    micBtn.addEventListener("pointerdown", (e) => {
      e.preventDefault();
      micBtn.setPointerCapture(e.pointerId);
      startListening();
    });
    micBtn.addEventListener("pointerup", (e) => {
      e.preventDefault();
      micBtn.releasePointerCapture(e.pointerId);
      stopListening();
    });
    micBtn.addEventListener("pointercancel", (e) => {
      micBtn.releasePointerCapture(e.pointerId);
      stopListening();
    });
    // Prevent context menu on long-press (mobile)
    micBtn.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // Apply current pilot to selector
  const select = document.getElementById("pilot-select");
  if (select && currentPilot.agentId) {
    select.value = currentPilot.agentId;
  }
}

/**
 * Add message to transcript display.
 */
function addToTranscript(text, type, agentName = null) {
  const container = document.getElementById("transcript-container");
  if (!container) return;

  // Remove welcome message on first real message
  const welcome = container.querySelector(".transcript-welcome");
  if (welcome) welcome.remove();

  const div = document.createElement("div");
  div.className = `transcript-line ${type}`;
  div.dataset.type = type;

  let prefix = "";
  if (type === "user" || type === "user-final") prefix = "You: ";
  else if (type === "agent" || type === "agent-interim") {
    prefix = agentName ? `${agentName}: ` : "Agent: ";
  }

  div.innerHTML = `<span class="prefix">${prefix}</span><span class="text">${escapeHtml(text)}</span>`;
  container.appendChild(div);
  container.scrollTop = container.scrollHeight;
}

/**
 * Update last transcript line (for interim results).
 */
function updateLastTranscript(text, type) {
  const container = document.getElementById("transcript-container");
  if (!container) return;

  const lines = container.querySelectorAll(".transcript-line");
  const last = lines[lines.length - 1];

  if (last && last.dataset.type === type) {
    last.querySelector(".text").textContent = text;
  } else {
    addToTranscript(text, type);
  }
}

/**
 * Remove last interim marker.
 */
function removeLastInterim() {
  const container = document.getElementById("transcript-container");
  if (!container) return;

  const lines = container.querySelectorAll(".transcript-line");
  const last = lines[lines.length - 1];
  if (last && last.dataset.type === "agent-interim") {
    last.remove();
  }
}

/**
 * Update mic button state — CSS only, no text/layout changes.
 */
function updateMicButton(listening) {
  const btn = document.getElementById("mic-btn");
  if (!btn) return;
  btn.classList.toggle("listening", listening);
  btn.setAttribute("aria-pressed", listening ? "true" : "false");
}

/**
 * Update pilot display.
 */
function updatePilotDisplay() {
  const status = document.getElementById("pilot-status");
  if (!status) return;

  const agent = currentPilot.agent;
  if (agent) {
    const caps = agent.capabilities?.slice(0, 2).join(", ") || "";
    status.textContent = `${agent.provider}${caps ? ` • ${caps}` : ""}`;
    status.title = agent.capabilities?.join(", ") || "";
  } else {
    status.textContent = currentPilot.agentId;
  }

  // Update selector if needed
  const select = document.getElementById("pilot-select");
  if (select && select.value !== currentPilot.agentId) {
    select.value = currentPilot.agentId;
  }
}

/**
 * Escape HTML for safe display.
 */
function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

// Export for global access
window.voicePanel = {
  init: initVoicePanel,
  startListening,
  stopListening,
  setPilot,
  interrupt: interruptSpeech,
  getPilot: () => currentPilot,
};

// Auto-init if container exists when DOM ready
document.addEventListener("DOMContentLoaded", () => {
  if (document.getElementById("voice-panel-container")) {
    initVoicePanel();
  }
});
