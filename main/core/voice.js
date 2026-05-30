"use strict";
/**
 * Voice — ElevenLabs client for two-way voice (DOMAIN_DESIGN "Eleven Labs SDK
 * (Phase 2)"; E2E_PLAN "Voice → after the text loop is solid").
 *
 * Two directions, both ElevenLabs:
 *   - tts(text)            → Text-to-Speech (the agent talks back)   [char-based cost]
 *   - stt(audioBuffer)     → Speech-to-Text / Scribe (you talk)      [time-based cost]
 *
 * Design rules mirrored from the rest of main/core:
 *   - main process owns ALL logic + the API key; the renderer is thin.
 *   - OFFLINE-SAFE: if ELEVENLABS_API_KEY is missing, `available()` is false and
 *     tts()/stt() throw a clear, catchable error. The app must never crash and
 *     text-only mode must keep working.
 *   - The key is read from process.env (loaded from .env.local by core/env.js).
 *     It is NEVER logged or returned to the renderer.
 *
 * Cost is metered by the caller via CostMeter.recordVoiceUsage() — this module
 * just returns the char/second counts needed to bill it.
 */

const API_BASE = "https://api.elevenlabs.io/v1";

// Defaults are env-overridable so the app stays agnostic / configurable.
function cfg(env = process.env) {
  return {
    apiKey: env.ELEVENLABS_API_KEY || "",
    // "Sarah" — a premade voice available on all plans (incl. free) via API.
    voiceId: env.ELEVENLABS_VOICE_ID || "EXAVITQu4vr4xnSDxMaL",
    ttsModel: env.ELEVENLABS_TTS_MODEL || "eleven_turbo_v2_5",
    sttModel: env.ELEVENLABS_STT_MODEL || "scribe_v1",
    outputFormat: env.ELEVENLABS_TTS_FORMAT || "mp3_44100_128",
  };
}

/** Is voice configured? (key present). Safe to call anytime; never throws. */
function available(env = process.env) {
  return !!(env.ELEVENLABS_API_KEY && String(env.ELEVENLABS_API_KEY).trim());
}

/** Non-secret status for the UI: whether voice is on + which voice/models. */
function status(env = process.env) {
  const c = cfg(env);
  return {
    available: available(env),
    voiceId: c.voiceId,
    ttsModel: c.ttsModel,
    sttModel: c.sttModel,
    note: available(env) ? null : "ELEVENLABS_API_KEY not set — voice disabled (text still works)",
  };
}

function requireKey(env) {
  const c = cfg(env);
  if (!c.apiKey) {
    const err = new Error("ElevenLabs API key not set (ELEVENLABS_API_KEY). Voice is disabled.");
    err.code = "NO_VOICE_KEY";
    throw err;
  }
  return c;
}

/**
 * Text-to-Speech. Returns { audio: Buffer, mime, chars, durationMs, model }.
 * @param {string} text
 * @param {object} opts { env?, voiceId?, model?, format? }
 */
async function tts(text, opts = {}) {
  const env = opts.env || process.env;
  const c = requireKey(env);
  const clean = String(text || "").trim();
  if (!clean) {
    const err = new Error("tts(): empty text");
    err.code = "EMPTY_TEXT";
    throw err;
  }
  const voiceId = opts.voiceId || c.voiceId;
  const model = opts.model || c.ttsModel;
  const format = opts.format || c.outputFormat;
  const t0 = Date.now();
  const res = await fetch(
    `${API_BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${encodeURIComponent(format)}`,
    {
      method: "POST",
      headers: {
        "xi-api-key": c.apiKey,
        "Content-Type": "application/json",
        Accept: "audio/mpeg",
      },
      body: JSON.stringify({ text: clean, model_id: model }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS ${res.status}: ${detail.slice(0, 300)}`);
  }
  const audio = Buffer.from(await res.arrayBuffer());
  return {
    audio,
    mime: "audio/mpeg",
    chars: clean.length,
    durationMs: Date.now() - t0,
    model,
    voiceId,
  };
}

/**
 * Speech-to-Text (Scribe). Returns { text, seconds, durationMs, model, raw }.
 * `seconds` is the source-audio duration when ElevenLabs reports it (for
 * cost), otherwise 0.
 * @param {Buffer|Uint8Array} audioBuffer
 * @param {object} opts { env?, mime?, model?, filename? }
 */
async function stt(audioBuffer, opts = {}) {
  const env = opts.env || process.env;
  const c = requireKey(env);
  if (!audioBuffer || !audioBuffer.length) {
    const err = new Error("stt(): empty audio");
    err.code = "EMPTY_AUDIO";
    throw err;
  }
  const mime = opts.mime || "audio/webm";
  const model = opts.model || c.sttModel;
  const filename = opts.filename || `speech.${(mime.split("/")[1] || "webm").split(";")[0]}`;

  const form = new FormData();
  const u8 = audioBuffer instanceof Uint8Array ? audioBuffer : new Uint8Array(audioBuffer);
  form.append("file", new Blob([u8], { type: mime }), filename);
  form.append("model_id", model);

  const t0 = Date.now();
  const res = await fetch(`${API_BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": c.apiKey },
    body: form,
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs STT ${res.status}: ${detail.slice(0, 300)}`);
  }
  const data = await res.json();
  // Derive source-audio duration for cost, when available.
  const words = Array.isArray(data.words) ? data.words : [];
  const lastEnd = words.length ? Number(words[words.length - 1].end) : 0;
  const seconds = Number.isFinite(data.audio_duration_seconds)
    ? data.audio_duration_seconds
    : (Number.isFinite(lastEnd) ? lastEnd : 0);
  return {
    text: (data.text || "").trim(),
    seconds,
    durationMs: Date.now() - t0,
    model,
    raw: data,
  };
}

module.exports = { available, status, tts, stt, cfg };
