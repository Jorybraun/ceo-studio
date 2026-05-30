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
  defineDomain: (domainDef) => ipcRenderer.invoke("domain:define", domainDef),
  getDomain: (domainName) => ipcRenderer.invoke("domain:get", domainName),
  getAllDomains: () => ipcRenderer.invoke("domain:get_all"),
  addDomainInsight: (domainName, insight) => ipcRenderer.invoke("domain:add_insight", domainName, insight),
  getDomainDescription: (domainName) => ipcRenderer.invoke("domain:get_description", domainName),
  ingestDomains: () => ipcRenderer.invoke("domain:ingest"),
  getDomainPath: (domainName) => ipcRenderer.invoke("domain:get_path", domainName),
  brainContext: () => ipcRenderer.invoke("brain:context"),
  getBrainContext: (domain) => ipcRenderer.invoke("brain:get_context", domain),
  searchBrain: (query, domain) => ipcRenderer.invoke("brain:search", query, domain),
  addToBrain: (title, content, artifactType) => ipcRenderer.invoke("brain:add", title, content, artifactType),
  getUserMemory: () => ipcRenderer.invoke("user:get_memory"),
  updateUserProfile: (updates) => ipcRenderer.invoke("user:update_profile", updates),
  addUserMemory: (memory, category) => ipcRenderer.invoke("user:add_memory", memory, category),
  addUserFunFact: (fact) => ipcRenderer.invoke("user:add_fun_fact", fact),
  getUserContext: () => ipcRenderer.invoke("user:get_context"),
  getUserGreeting: () => ipcRenderer.invoke("user:get_greeting"),
  recordInteraction: (type) => ipcRenderer.invoke("user:record_interaction", type),
  getSoul: () => ipcRenderer.invoke("soul:get"),
  updateSoulSection: (section, content) => ipcRenderer.invoke("soul:update_section", section, content),
  addSoulMilestone: (milestone) => ipcRenderer.invoke("soul:add_milestone", milestone),
  addSoulMemory: (memory) => ipcRenderer.invoke("soul:add_memory", memory),
  reflectOnSoul: (reflection) => ipcRenderer.invoke("soul:reflect", reflection),
  getSoulSummary: () => ipcRenderer.invoke("soul:get_summary"),
  // Hermes CEO bridge (live kanban board, swarm, room feed, and relay)
  ceoStatus: () => ipcRenderer.invoke("hermes:status"),
  ceoEnsureUp: () => ipcRenderer.invoke("hermes:ensure_up"),
  ceoBoards: () => ipcRenderer.invoke("hermes:boards"),
  ceoBoard: (slug) => ipcRenderer.invoke("hermes:board", slug),
  ceoStats: (slug) => ipcRenderer.invoke("hermes:stats", slug),
  ceoSwarm: (slug) => ipcRenderer.invoke("hermes:swarm", slug),
  ceoRoom: (slug, limit) => ipcRenderer.invoke("hermes:room", slug, limit),
  askCeo: (message) => ipcRenderer.invoke("hermes:ask", message),
  ceoConfig: () => ipcRenderer.invoke("hermes:config"),
  ceoSetModel: (provider, model) => ipcRenderer.invoke("hermes:set_model", provider, model),
  ceoGatewayStart: () => ipcRenderer.invoke("hermes:gateway_start"),
  ceoGatewayStop: () => ipcRenderer.invoke("hermes:gateway_stop"),
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
  // Self-awareness tools — let agents read their own code for analysis/repair
  readMyCode: (path) => ipcRenderer.invoke("self:read_code", path),
  listMyCode: () => ipcRenderer.invoke("self:list_code"),
  modifyMyCode: (path, oldText, newText) => ipcRenderer.invoke("self:modify_code", path, oldText, newText),
  testMyChanges: () => ipcRenderer.invoke("self:test_changes"),
  repairAgent: (task) => ipcRenderer.invoke("repair:delegate", task),
});
