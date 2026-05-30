"use strict";
/**
 * LLMProvider — the thin, model-agnostic seam (E2E_PLAN §8).
 *
 * The model/provider is CONFIG, not code. The rest of the app only knows
 * `provider.complete({ system, messages })` -> { text, usage }.
 * This keeps the plan valid whether the CEO model is Claude, GPT, or other.
 *
 * Providers:
 *   - null  : offline echo, zero cost (default; lets M0 run with no API key)
 *   - openai / anthropic : real calls via fetch (Node 20+ global fetch)
 *
 * Selection via env: CEO_MODEL_PROVIDER, CEO_MODEL, OPENAI_API_KEY / ANTHROPIC_API_KEY.
 */

class LLMProvider {
  constructor({ model } = {}) { this.model = model || "null"; }
  // eslint-disable-next-line no-unused-vars
  async complete({ system, messages }) {
    throw new Error("complete() not implemented");
  }
}

class NullProvider extends LLMProvider {
  constructor() { super({ model: "null" }); this.id = "null"; }
  async complete({ system, messages }) {
    const last = (messages || []).slice(-1)[0];
    const prompt = last ? last.content : "";
    const text =
      "[offline NullProvider] No model configured (set CEO_MODEL_PROVIDER + API key). " +
      "Echoing your request so the UI loop is verifiable:\n\n> " +
      String(prompt).slice(0, 400);
    return { text, usage: { model: "null", tokensIn: 0, tokensOut: 0, usd: 0 } };
  }
}

class OpenAIProvider extends LLMProvider {
  constructor({ model, apiKey }) { super({ model: model || "gpt-4o" }); this.id = "openai"; this.apiKey = apiKey; }
  async complete({ system, messages }) {
    const t0 = Date.now();
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          ...(system ? [{ role: "system", content: system }] : []),
          ...(messages || []),
        ],
      }),
    });
    if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = data.choices?.[0]?.message?.content || "";
    const u = data.usage || {};
    return {
      text,
      usage: {
        model: this.model,
        tokensIn: u.prompt_tokens || 0,
        tokensOut: u.completion_tokens || 0,
        durationMs: Date.now() - t0,
      },
    };
  }
}

class AnthropicProvider extends LLMProvider {
  constructor({ model, apiKey }) { super({ model: model || "claude-sonnet" }); this.id = "anthropic"; this.apiKey = apiKey; }
  async complete({ system, messages }) {
    const t0 = Date.now();
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: 2048,
        system: system || undefined,
        messages: (messages || []).map((m) => ({ role: m.role, content: m.content })),
      }),
    });
    if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const text = (data.content || []).map((c) => c.text || "").join("");
    const u = data.usage || {};
    return {
      text,
      usage: {
        model: this.model,
        tokensIn: u.input_tokens || 0,
        tokensOut: u.output_tokens || 0,
        durationMs: Date.now() - t0,
      },
    };
  }
}

/** Build the configured provider; fall back to NullProvider (with a note) if unconfigured. */
function createProvider(env = process.env) {
  const kind = (env.CEO_MODEL_PROVIDER || "null").toLowerCase();
  if (kind === "openai") {
    if (!env.OPENAI_API_KEY) return { provider: new NullProvider(), note: "OPENAI_API_KEY missing — using NullProvider" };
    return { provider: new OpenAIProvider({ model: env.CEO_MODEL, apiKey: env.OPENAI_API_KEY }), note: null };
  }
  if (kind === "anthropic") {
    if (!env.ANTHROPIC_API_KEY) return { provider: new NullProvider(), note: "ANTHROPIC_API_KEY missing — using NullProvider" };
    return { provider: new AnthropicProvider({ model: env.CEO_MODEL, apiKey: env.ANTHROPIC_API_KEY }), note: null };
  }
  return { provider: new NullProvider(), note: "No CEO_MODEL_PROVIDER set — using NullProvider (offline)" };
}

module.exports = { LLMProvider, NullProvider, OpenAIProvider, AnthropicProvider, createProvider };
