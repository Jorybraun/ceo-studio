"use strict";
/**
 * Voice — two-way voice with automatic provider selection:
 *
 *   LOCAL mode  (default, free, no API key):
 *     - TTS: macOS `say` command  (built-in, zero cost)
 *     - STT: Web Speech API in the renderer (browser-native, zero cost)
 *     - LLM: Ollama gemma3:4b via localhost:11434  (local, zero cost)
 *
 *   CLOUD mode  (ElevenLabs, requires ELEVENLABS_API_KEY):
 *     - TTS: ElevenLabs text-to-speech  (char-based cost)
 *     - STT: ElevenLabs Scribe          (time-based cost)
 *
 * Priority: LOCAL is tried first. If Ollama is not running and no ElevenLabs
 * key is set, voice degrades gracefully — text still works, no crash.
 *
 * Design rules (same as the rest of main/core):
 *   - main process owns ALL logic; renderer is thin.
 *   - OFFLINE-SAFE: missing key + no Ollama → available() false, no crash.
 *   - API keys are NEVER logged or returned to the renderer.
 *   - Cost is metered by the caller via CostMeter.recordVoiceUsage().
 */

const { execFile, execFileSync } = require("child_process");
const { promisify } = require("util");
const execFileAsync = promisify(execFile);

const OLLAMA_BASE = "http://localhost:11434";
const LOCAL_MODEL = "gemma3:4b";
const ELEVENLABS_BASE = "https://api.elevenlabs.io/v1";

// ─── Config ──────────────────────────────────────────────────────────────────

function cfg(env = process.env) {
  return {
    // Cloud (ElevenLabs)
    apiKey: env.ELEVENLABS_API_KEY || "",
    voiceId: env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    ttsModel: env.ELEVENLABS_TTS_MODEL || "eleven_turbo_v2_5",
    sttModel: env.ELEVENLABS_STT_MODEL || "scribe_v1",
    outputFormat: env.ELEVENLABS_TTS_FORMAT || "mp3_44100_128",
    // Local (Ollama)
    ollamaBase: env.OLLAMA_BASE || OLLAMA_BASE,
    localModel: env.LOCAL_VOICE_MODEL || LOCAL_MODEL,
    sayVoice: env.SAY_VOICE || "Samantha",
  };
}

// ─── Availability ─────────────────────────────────────────────────────────────

/** Is ElevenLabs cloud voice configured AND not explicitly bypassed? */
function available(env = process.env) {
  if (env.LOCAL_VOICE === "true" || env.FORCE_LOCAL_VOICE === "true") return false;
  return !!(env.ELEVENLABS_API_KEY && String(env.ELEVENLABS_API_KEY).trim());
}

/** Is local Ollama voice available? (sync probe — cached for 30s) */
let _localCache = { ok: false, ts: 0 };
async function localAvailable(env = process.env) {
  const now = Date.now();
  if (now - _localCache.ts < 30_000) return _localCache.ok;
  try {
    const base = env.OLLAMA_BASE || OLLAMA_BASE;
    const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) { _localCache = { ok: false, ts: now }; return false; }
    const data = await res.json();
    const model = env.LOCAL_VOICE_MODEL || LOCAL_MODEL;
    const has = (data.models || []).some((m) => m.name === model || m.name.startsWith(model.split(":")[0]));
    _localCache = { ok: has, ts: now };
    return has;
  } catch {
    _localCache = { ok: false, ts: now };
    return false;
  }
}

/**
 * Sync status (used by tests + the IPC voice:available handler for quick checks).
 * Reports cloud availability only — does NOT probe Ollama (that's async).
 * Use statusAsync() for the full picture including local mode.
 */
function status(env = process.env) {
  const cloud = available(env);
  const c = cfg(env);
  // Report as available:false when no key — local availability is checked async
  return {
    available: cloud,
    mode: cloud ? "cloud" : "none",
    voiceId: cloud ? c.voiceId : "macOS-say",
    ttsModel: cloud ? c.ttsModel : `say:${c.sayVoice}`,
    sttModel: cloud ? c.sttModel : "WebSpeechAPI",
    localModel: c.localModel,
    note: !cloud ? "ELEVENLABS_API_KEY not set — checking local Ollama voice" : null,
  };
}

/** Async full status — also probes Ollama for local mode availability. */
async function statusAsync(env = process.env) {
  const cloud = available(env);
  const local = await localAvailable(env).catch(() => false);
  const c = cfg(env);
  return {
    available: cloud || local,
    mode: cloud ? "cloud" : local ? "local" : "none",
    voiceId: cloud ? c.voiceId : "macOS-say",
    ttsModel: cloud ? c.ttsModel : `say:${c.sayVoice}`,
    sttModel: cloud ? c.sttModel : "WebSpeechAPI",
    localModel: c.localModel,
    note: (!cloud && !local)
      ? "No voice available — start Ollama (`ollama serve`) or set ELEVENLABS_API_KEY"
      : null,
  };
}

// ─── Cloud path (ElevenLabs) ──────────────────────────────────────────────────

function requireKey(env) {
  const c = cfg(env);
  if (!c.apiKey) {
    const err = new Error("ElevenLabs API key not set (ELEVENLABS_API_KEY). Voice is disabled.");
    err.code = "NO_VOICE_KEY";
    throw err;
  }
  return c;
}

async function _cloudTts(text, opts = {}) {
  const env = opts.env || process.env;
  const c = requireKey(env);
  const clean = String(text || "").trim();
  if (!clean) { const e = new Error("tts(): empty text"); e.code = "EMPTY_TEXT"; throw e; }
  const voiceId = opts.voiceId || c.voiceId;
  const model = opts.model || c.ttsModel;
  const format = opts.format || c.outputFormat;
  const t0 = Date.now();
  const res = await fetch(
    `${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`,
    {
      method: "POST",
      headers: { "xi-api-key": c.apiKey, "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text: clean, model_id: model }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${detail.slice(0, 300)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return { audio, mime: "audio/mpeg", chars: clean.length, durationMs: Date.now() - t0, model, voiceId };
}

async function _cloudStt(audioBuffer, opts = {}) {
  const env = opts.env || process.env;
  const c = requireKey(env);
  if (!audioBuffer || !audioBuffer.length) {
    const e = new Error("stt(): empty audio"); e.code = "EMPTY_AUDIO"; throw e;
  }
  const mime = opts.mime || "audio/webm";
  const model = opts.model || c.sttModel;
  const filename = opts.filename || `speech.${(mime.split("/")[1] || "webm").split(";")[0]}`;
  const form = new FormData();
  const u8 = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
  form.append("file", new Blob([u8], { type: mime }), filename);
  form.append("model_id", model);
  const t0 = Date.now();
  const res = await fetch(`${ELEVENLABS_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": c.apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STT ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const words = Array.isArray(data.words) ? data.words : [];
  const lastEnd = words.length ? Number(words[words.length - 1].end) : 0;
  const seconds = Number.isFinite(data.audio_duration_seconds)
    ? data.audio_duration_seconds
    : (Number.isFinite(lastEnd) ? lastEnd : 0);
  return { text: (data.text || "").trim(), seconds, durationMs: Date.now() - t0, model, raw: data };
}

// ─── Local path (macOS say + Ollama) ─────────────────────────────────────────

/**
 * Local TTS via macOS `say`.
 * Returns { ok: true, chars, durationMs, mode: "local" } — no audio buffer
 * (say plays directly through the system speaker; no bytes to return).
 */
async function localTts(text, opts = {}) {
  const env = opts.env || process.env;
  const c = cfg(env);
  const clean = String(text || "").trim();
  if (!clean) { const e = new Error("tts(): empty text"); e.code = "EMPTY_TEXT"; throw e; }
  const voice = opts.sayVoice || c.sayVoice;
  const t0 = Date.now();
  // -r 175 = natural reading rate; say blocks until audio finishes
  await execFileAsync("say", ["-v", voice, "-r", "175", clean]);
  return { ok: true, chars: clean.length, durationMs: Date.now() - t0, mode: "local", voice };
}

/**
 * Ask the local Ollama model. Used by the voice agent loop.
 * Returns { text, durationMs, model }.
 */
async function localAsk(prompt, opts = {}) {
  const env = opts.env || process.env;
  const c = cfg(env);
  const model = opts.model || c.localModel;
  const base = opts.ollamaBase || c.ollamaBase;
  const messages = opts.messages || [{ role: "user", content: prompt }];
  const t0 = Date.now();
  const res = await fetch(`${base}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, messages, stream: false }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Ollama ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = data.message?.content || data.response || "";
  return { text: text.trim(), durationMs: Date.now() - t0, model };
}

// ─── Unified public API ───────────────────────────────────────────────────────

/**
 * tts(text, opts) — speaks text aloud.
 *
 * Cloud mode (ElevenLabs key present): returns { audio: Buffer, mime, chars, durationMs, model }
 * Local mode (Ollama running):         returns { ok: true, chars, durationMs, mode: "local" }
 *                                      (audio plays via `say` directly — no buffer)
 * Neither available: throws { code: "NO_VOICE_KEY" }
 */
async function tts(text, opts = {}) {
  const env = opts.env || process.env;
  if (available(env)) return _cloudTts(text, opts);
  const isLocal = await localAvailable(env);
  if (isLocal) return localTts(text, opts);
  const err = new Error("ElevenLabs API key not set (ELEVENLABS_API_KEY). Voice is disabled.");
  err.code = "NO_VOICE_KEY";
  throw err;
}

/**
 * stt(audioBuffer, opts) — transcribe audio to text.
 *
 * Cloud mode: ElevenLabs Scribe.
 * Local mode: STT is handled in the renderer via Web Speech API.
 *             If called from main with an audio buffer in local mode,
 *             we have no local STT backend — throws NO_VOICE_KEY so the
 *             caller knows to use the renderer-side Web Speech path.
 */
async function stt(audioBuffer, opts = {}) {
  const env = opts.env || process.env;
  if (available(env)) return _cloudStt(audioBuffer, opts);
  // In local mode STT lives in the renderer (Web Speech API) — not here.
  const err = new Error("ElevenLabs API key not set (ELEVENLABS_API_KEY). Voice is disabled.");
  err.code = "NO_VOICE_KEY";
  throw err;
}

module.exports = { available, localAvailable, status, statusAsync, tts, stt, localTts, localAsk, cfg };
