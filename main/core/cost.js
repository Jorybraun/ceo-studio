"use strict";
/**
 * Cost guardrails (M0 / L0) — the non-negotiable safety layer.
 *
 * Exists because a previous swarm burned all its credits. Enforces:
 *   - hard per-session and per-day USD caps (halt on breach)
 *   - a live meter (tokens + USD)
 *   - a kill switch (halts everything immediately)
 *   - per-call accounting to the project's brain/sessions/
 *
 * This is the L0 hard requirement that must exist BEFORE any autonomy (L1+):
 * the agent must call `canProceed()` before every model call and
 * `recordUsage()` after.
 */
const fs = require("fs");
const path = require("path");
const { brainDir } = require("./paths");

function num(envName, dflt) {
  const v = Number(process.env[envName]);
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

// Defaults straight from the plan: $5/session, $20/day. Env-overridable.
const DEFAULTS = {
  maxSessionUsd: num("CEO_MAX_SESSION_USD", 5),
  maxDayUsd: num("CEO_MAX_DAY_USD", 20),
};

// Minimal, configurable price table (USD per 1M tokens). Used to estimate cost
// from token counts when a provider doesn't return USD directly.
const PRICES = {
  // model: [inputPerM, outputPerM]
  "null": [0, 0],
  "gpt-4o": [2.5, 10],
  "gpt-4.1": [2, 8],
  "claude-sonnet": [3, 15],
  "claude-opus": [15, 75],
  "default": [3, 15],
};

function estimateUsd(model, tokensIn = 0, tokensOut = 0) {
  const [pi, po] = PRICES[model] || PRICES.default;
  return (tokensIn / 1e6) * pi + (tokensOut / 1e6) * po;
}

// Voice (ElevenLabs) pricing. TTS is character-based; STT is time-based.
// These are coarse estimates (Eleven's effective $/char varies by plan) and
// are env-overridable. The point is to keep voice spend VISIBLE and CAPPED,
// not to bill exactly — a runaway voice loop must still trip the hard caps.
const VOICE_PRICES = {
  ttsUsdPer1kChars: num("CEO_TTS_USD_PER_1K", 0.15),
  sttUsdPerMinute: num("CEO_STT_USD_PER_MIN", 0.006),
};

function estimateVoiceUsd({ kind, chars = 0, seconds = 0 } = {}) {
  if (kind === "tts") return (chars / 1000) * VOICE_PRICES.ttsUsdPer1kChars;
  if (kind === "stt") return (seconds / 60) * VOICE_PRICES.sttUsdPerMinute;
  return 0;
}

function _todayKey() {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

class CostMeter {
  /**
   * @param {string} slug project slug (for per-project session ledger)
   */
  constructor(slug, opts = {}) {
    this.slug = slug;
    this.maxSessionUsd = opts.maxSessionUsd ?? DEFAULTS.maxSessionUsd;
    this.maxDayUsd = opts.maxDayUsd ?? DEFAULTS.maxDayUsd;
    this.sessionUsd = 0;
    this.sessionTokensIn = 0;
    this.sessionTokensOut = 0;
    // Voice (ElevenLabs) accounting — separate counters, same hard caps.
    this.voiceUsd = 0;
    this.ttsChars = 0;
    this.sttSeconds = 0;
    this.killed = false;
    this._sessionsDir = path.join(brainDir(slug), "sessions");
    fs.mkdirSync(this._sessionsDir, { recursive: true });
    this._dayFile = path.join(this._sessionsDir, `day-${_todayKey()}.json`);
    this.dayUsd = this._loadDayUsd();
    this._callLog = path.join(this._sessionsDir, `calls-${_todayKey()}.jsonl`);
  }

  _loadDayUsd() {
    try { return JSON.parse(fs.readFileSync(this._dayFile, "utf-8")).usd || 0; }
    catch { return 0; }
  }

  _saveDayUsd() {
    try { fs.writeFileSync(this._dayFile, JSON.stringify({ usd: this.dayUsd })); }
    catch { /* best-effort */ }
  }

  /** Must be called BEFORE a model call. Returns {ok, reason}. */
  canProceed() {
    if (this.killed) return { ok: false, reason: "kill switch engaged" };
    if (this.sessionUsd >= this.maxSessionUsd)
      return { ok: false, reason: `session cap reached ($${this.sessionUsd.toFixed(4)} / $${this.maxSessionUsd})` };
    if (this.dayUsd >= this.maxDayUsd)
      return { ok: false, reason: `daily cap reached ($${this.dayUsd.toFixed(4)} / $${this.maxDayUsd})` };
    return { ok: true, reason: "ok" };
  }

  /** Must be called AFTER a model call with usage. Returns the recorded entry. */
  recordUsage({ model = "default", tokensIn = 0, tokensOut = 0, usd, durationMs = 0 } = {}) {
    const cost = Number.isFinite(usd) ? usd : estimateUsd(model, tokensIn, tokensOut);
    this.sessionUsd += cost;
    this.dayUsd += cost;
    this.sessionTokensIn += tokensIn;
    this.sessionTokensOut += tokensOut;
    this._saveDayUsd();
    const entry = {
      ts: new Date().toISOString(), model,
      tokensIn, tokensOut, usd: cost, durationMs,
    };
    try { fs.appendFileSync(this._callLog, JSON.stringify(entry) + "\n"); } catch { /* */ }
    // Auto-halt is implicit: the next canProceed() will deny once a cap is hit.
    return entry;
  }

  /**
   * Record a voice (ElevenLabs) call. Voice $ is tracked separately AND folded
   * into the session/day totals so the same hard caps + kill switch apply —
   * a runaway TTS/STT loop must trip the guardrail just like a model loop.
   * @param {object} u { kind: 'tts'|'stt', chars?, seconds?, usd?, durationMs? }
   */
  recordVoiceUsage({ kind = "tts", chars = 0, seconds = 0, usd, durationMs = 0 } = {}) {
    const cost = Number.isFinite(usd) ? usd : estimateVoiceUsd({ kind, chars, seconds });
    this.sessionUsd += cost;
    this.dayUsd += cost;
    this.voiceUsd += cost;
    if (kind === "tts") this.ttsChars += chars;
    if (kind === "stt") this.sttSeconds += seconds;
    this._saveDayUsd();
    const entry = {
      ts: new Date().toISOString(), kind: `voice:${kind}`,
      chars, seconds, usd: cost, durationMs,
    };
    try { fs.appendFileSync(this._callLog, JSON.stringify(entry) + "\n"); } catch { /* */ }
    return entry;
  }

  kill() { this.killed = true; }
  resume() { this.killed = false; }

  status() {
    const c = this.canProceed();
    return {
      slug: this.slug,
      killed: this.killed,
      halted: !c.ok,
      reason: c.reason,
      sessionUsd: Number(this.sessionUsd.toFixed(6)),
      dayUsd: Number(this.dayUsd.toFixed(6)),
      maxSessionUsd: this.maxSessionUsd,
      maxDayUsd: this.maxDayUsd,
      sessionTokensIn: this.sessionTokensIn,
      sessionTokensOut: this.sessionTokensOut,
      voiceUsd: Number(this.voiceUsd.toFixed(6)),
      ttsChars: this.ttsChars,
      sttSeconds: Number(this.sttSeconds.toFixed(2)),
    };
  }
}

module.exports = { CostMeter, estimateUsd, estimateVoiceUsd, PRICES, VOICE_PRICES, DEFAULTS };
