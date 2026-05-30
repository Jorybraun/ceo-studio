"use strict";
/**
 * Preload: exposes a minimal, safe IPC surface to the renderer.
 * The renderer never touches Node/Electron directly (contextIsolation on).
 */
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("ceo", {
  listProjects: () => ipcRenderer.invoke("projects:list"),
  addProject: () => ipcRenderer.invoke("projects:add"),
  openProject: (id) => ipcRenderer.invoke("project:open", id),
  setDomain: (d) => ipcRenderer.invoke("domain:set", d),
  brainContext: () => ipcRenderer.invoke("brain:context"),
  costStatus: () => ipcRenderer.invoke("cost:status"),
  costKill: () => ipcRenderer.invoke("cost:kill"),
  costResume: () => ipcRenderer.invoke("cost:resume"),
  ask: (prompt) => ipcRenderer.invoke("agent:ask", prompt),
  // Voice (ElevenLabs, two-way). Renderer stays thin: it only captures mic
  // audio and plays returned audio; all API logic + the key live in main.
  voiceAvailable: () => ipcRenderer.invoke("voice:available"),
  voiceSpeak: (text) => ipcRenderer.invoke("voice:speak", text),
  voiceListen: (audioBase64, mime) => ipcRenderer.invoke("voice:listen", { audioBase64, mime }),
  // Live voice agent (ElevenLabs Conversational AI). Main returns a signed URL;
  // the renderer opens the real-time session with the SDK. Key stays in main.
  convaiStatus: () => ipcRenderer.invoke("convai:status"),
  convaiStart: () => ipcRenderer.invoke("convai:start"),
  // Documents + swarm — used by the live agent's client tools (renderer side).
  docsList: () => ipcRenderer.invoke("docs:list"),
  docsRead: (path) => ipcRenderer.invoke("docs:read", path),
  swarmRequest: (objective) => ipcRenderer.invoke("swarm:request", objective),
});
