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
 *   - vertex : Google Vertex AI generateContent (Gemma/Gemini). For small,
 *     non-agentic utility generations (e.g. drafting a persona) — NOT the CEO,
 *     which stays Hermes. Auth is a GCP bearer token (ADC/service account).
 *
 * Selection via env: CEO_MODEL_PROVIDER, CEO_MODEL, OPENAI_API_KEY /
 * ANTHROPIC_API_KEY, and for vertex: VERTEX_PROJECT, VERTEX_LOCATION,
 * VERTEX_ACCESS_TOKEN (optional; else `gcloud auth print-access-token`),
 * VERTEX_ENDPOINT_URL (optional full override for a self-deployed endpoint).
 */
const { execFileSync } = require("child_process");

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
  constructor({ model, apiKey }) { 
    super({ model: model || "gpt-4o" }); 
    this.id = "openai"; 
    this.apiKey = apiKey;
    // Model hierarchy for different task complexities
    this.models = {
      simple: "gpt-4o-mini",      // Fast, cheap for simple tasks
      standard: "gpt-4o",         // Default for most tasks
      complex: "gpt-4o",          // Complex reasoning (could use o1-preview if available)
    };
  }
  
  selectModel(complexity = "standard") {
    return this.models[complexity] || this.models.standard;
  }
  
  async complete({ system, messages, complexity = "standard" }) {
    const t0 = Date.now();
    const selectedModel = this.selectModel(complexity);
    
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: selectedModel,
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
        model: selectedModel,
        tokensIn: u.prompt_tokens || 0,
        tokensOut: u.completion_tokens || 0,
        durationMs: Date.now() - t0,
      },
    };
  }
}

class AnthropicProvider extends LLMProvider {
  constructor({ model, apiKey }) { 
    super({ model: model || "claude-sonnet" }); 
    this.id = "anthropic"; 
    this.apiKey = apiKey;
    // Model hierarchy for different task complexities
    this.models = {
      simple: "claude-haiku",      // Fast, cheap for simple tasks
      standard: "claude-sonnet",   // Default for most tasks
      complex: "claude-opus",      // Complex reasoning (most capable)
    };
  }
  
  selectModel(complexity = "standard") {
    return this.models[complexity] || this.models.standard;
  }
  
  async complete({ system, messages, complexity = "standard" }) {
    const t0 = Date.now();
    const selectedModel = this.selectModel(complexity);
    
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: selectedModel,
        max_tokens: 4096, // Higher token limit for complex tasks
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
        model: selectedModel,
        tokensIn: u.input_tokens || 0,
        tokensOut: u.output_tokens || 0,
        durationMs: Date.now() - t0,
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Vertex AI (Google) — small utility model (Gemma/Gemini), NOT the CEO.
// Pure helpers (endpoint/body/parse) are split out so they're unit-testable
// without a network or credentials.
// ---------------------------------------------------------------------------

function vertexEndpoint({ project, location, model, endpointUrl }) {
  if (endpointUrl) return endpointUrl;
  const loc = location || "us-central1";
  return `https://${loc}-aiplatform.googleapis.com/v1/projects/${project}` +
    `/locations/${loc}/publishers/google/models/${model}:generateContent`;
}

function vertexBody({ system, messages }) {
  const contents = (messages || []).map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: [{ text: String(m.content || "") }],
  }));
  const body = { contents };
  if (system) body.systemInstruction = { parts: [{ text: String(system) }] };
  return body;
}

function parseVertexResponse(data) {
  const cand = ((data && data.candidates) || [])[0];
  const parts = (cand && cand.content && cand.content.parts) || [];
  return parts.map((p) => p.text || "").join("");
}

function _b64url(input) {
  return Buffer.from(input).toString("base64")
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function _loadServiceAccount(env) {
  const p = (env.GOOGLE_APPLICATION_CREDENTIALS || "").trim();
  if (!p) return null;
  try { return JSON.parse(require("fs").readFileSync(p, "utf8")); } catch { return null; }
}

const _tokenCache = new Map(); // client_email -> { token, exp }

/** Mint a GCP access token from a service-account key via signed JWT (RS256). */
async function _mintTokenFromSA(sa) {
  const now = Math.floor(Date.now() / 1000);
  const cached = _tokenCache.get(sa.client_email);
  if (cached && cached.exp - 60 > now) return cached.token;
  const crypto = require("crypto");
  const tokenUri = sa.token_uri || "https://oauth2.googleapis.com/token";
  const header = _b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = _b64url(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/cloud-platform",
    aud: tokenUri, iat: now, exp: now + 3600,
  }));
  const signer = crypto.createSign("RSA-SHA256");
  signer.update(`${header}.${claims}`);
  const assertion = `${header}.${claims}.${_b64url(signer.sign(sa.private_key))}`;
  const res = await fetch(tokenUri, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion,
    }),
  });
  if (!res.ok) throw new Error(`Vertex token mint ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  _tokenCache.set(sa.client_email, { token: data.access_token, exp: now + (data.expires_in || 3600) });
  return data.access_token;
}

/** Resolve a bearer token: explicit env > service account > gcloud ADC. */
async function _vertexToken(env) {
  if (env.VERTEX_ACCESS_TOKEN) return env.VERTEX_ACCESS_TOKEN.trim();
  const sa = _loadServiceAccount(env);
  if (sa && sa.private_key) return _mintTokenFromSA(sa);
  try {
    return execFileSync("gcloud", ["auth", "print-access-token"], { encoding: "utf8", timeout: 8000 }).trim();
  } catch {
    throw new Error("Vertex auth: set VERTEX_ACCESS_TOKEN, or GOOGLE_APPLICATION_CREDENTIALS (service-account json), or authenticate gcloud");
  }
}

class VertexProvider extends LLMProvider {
  constructor({ model, project, location, endpointUrl, env } = {}) {
    super({ model: model || "gemini-2.5-flash" });
    this.id = "vertex";
    this.project = project;
    this.location = location || "us-central1";
    this.endpointUrl = endpointUrl || null;
    this.env = env || process.env;
  }
  async complete({ system, messages }) {
    const t0 = Date.now();
    const token = await _vertexToken(this.env);
    const url = vertexEndpoint({ project: this.project, location: this.location, model: this.model, endpointUrl: this.endpointUrl });
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify(vertexBody({ system, messages })),
    });
    if (!res.ok) throw new Error(`Vertex ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    return { text: parseVertexResponse(data), usage: { model: this.model, durationMs: Date.now() - t0 } };
  }
}

// ---------------------------------------------------------------------------
// Vertex via Cloudflare AI Gateway — the PROVEN path (matches PIPE workers).
// The Gateway stores the GCP service account and refreshes OAuth itself, so the
// app only needs a Cloudflare API token (cf-aig-authorization). We hit the
// unified OpenAI-compatible endpoint (/compat/chat/completions) with the model
// prefixed `google-vertex-ai/...`. No JWT signing, no gcloud, no SA json.
//   CF_AI_GATEWAY_URL = https://gateway.ai.cloudflare.com/v1/<acct>/<gw>/google-vertex-ai
//   CF_API_TOKEN      = Cloudflare API token (AI Gateway run/read)
//   VERTEX_AI_MODEL   = google/gemma-4-26b-a4b-it-maas (default)
// ---------------------------------------------------------------------------

const DEFAULT_GATEWAY_MODEL = "google/gemma-4-26b-a4b-it-maas";

/** Strip trailing slash + the `/google-vertex-ai` suffix, then add /compat path. */
function gatewayUrl(base) {
  const root = String(base || "").replace(/\/$/, "").replace(/\/google-vertex-ai$/, "");
  return `${root}/compat/chat/completions`;
}

/** Model must be prefixed `google-vertex-ai/` for the unified endpoint. */
function gatewayModel(model) {
  const m = model || DEFAULT_GATEWAY_MODEL;
  return m.startsWith("google-vertex-ai/") ? m : `google-vertex-ai/${m}`;
}

class VertexGatewayProvider extends LLMProvider {
  constructor({ model, gateway, apiToken } = {}) {
    super({ model: model || DEFAULT_GATEWAY_MODEL });
    this.id = "vertex-gateway";
    this.gateway = gateway;
    this.apiToken = apiToken;
  }
  async complete({ system, messages, maxTokens }) {
    const t0 = Date.now();
    const msgs = [
      ...(system ? [{ role: "system", content: String(system) }] : []),
      ...(messages || []).map((m) => ({ role: m.role, content: String(m.content || "") })),
    ];
    const res = await fetch(gatewayUrl(this.gateway), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "cf-aig-authorization": `Bearer ${this.apiToken}`,
      },
      body: JSON.stringify({
        model: gatewayModel(this.model),
        messages: msgs,
        max_tokens: maxTokens || 1024,
        stream: false,
      }),
    });
    if (!res.ok) throw new Error(`Vertex(gateway) ${res.status}: ${(await res.text()).slice(0, 300)}`);
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || "").trim();
    if (!text) throw new Error("Vertex(gateway) returned empty response");
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
  if (kind === "vertex") {
    const sa = _loadServiceAccount(env);
    const project = env.VERTEX_PROJECT || (sa && sa.project_id);
    if (!project && !env.VERTEX_ENDPOINT_URL) {
      return { provider: new NullProvider(), note: "VERTEX_PROJECT / GOOGLE_APPLICATION_CREDENTIALS missing — using NullProvider" };
    }
    return {
      provider: new VertexProvider({
        model: env.CEO_MODEL, project, location: env.VERTEX_LOCATION,
        endpointUrl: env.VERTEX_ENDPOINT_URL, env,
      }),
      note: null,
    };
  }
  return { provider: new NullProvider(), note: "No CEO_MODEL_PROVIDER set — using NullProvider (offline)" };
}

/**
 * A small, non-agentic *utility* model for one-shot generations (drafting a
 * persona, summarizing, etc.) — deliberately SEPARATE from the conversational
 * CEO (Hermes) and from CEO_MODEL_PROVIDER (which stays null by design). Uses
 * Vertex with the project/location already configured for the app, and a chat
 * model (default gemini-2.5-flash, verified) distinct from the embedding model.
 * Falls back to NullProvider (with a note) when Vertex isn't configured.
 */
function createUtilityProvider(env = process.env) {
  // PREFERRED: Cloudflare AI Gateway -> Vertex AI (Gemma MaaS). This is the exact
  // path PIPE's workers use and the only one verified to work end-to-end. Needs
  // just a Cloudflare API token — no service-account JSON, no gcloud, no JWT.
  const gw = (env.CF_AI_GATEWAY_URL || "").trim();
  const tok = (env.CF_API_TOKEN || "").trim();
  if (gw && tok) {
    return {
      provider: new VertexGatewayProvider({
        model: env.VERTEX_AI_MODEL || DEFAULT_GATEWAY_MODEL,
        gateway: gw, apiToken: tok,
      }),
      note: null,
    };
  }

  // FALLBACK: direct Vertex (service-account / gcloud). Fragile; kept for parity.
  const sa = _loadServiceAccount(env);
  const project = env.GOOGLE_CLOUD_PROJECT || env.VERTEX_PROJECT || (sa && sa.project_id);
  const haveAuth = !!(env.VERTEX_ACCESS_TOKEN || (sa && sa.private_key));
  if (!project || (!haveAuth && !env.VERTEX_ENDPOINT_URL)) {
    return { provider: new NullProvider(), note: "Utility model unconfigured (set CF_AI_GATEWAY_URL + CF_API_TOKEN, or GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS) — using NullProvider" };
  }
  return {
    provider: new VertexProvider({
      model: env.CEO_UTILITY_MODEL || "gemini-2.5-flash",
      project, location: env.VERTEX_LOCATION,
      endpointUrl: env.VERTEX_ENDPOINT_URL, env,
    }),
    note: null,
  };
}

module.exports = {
  LLMProvider, NullProvider, OpenAIProvider, AnthropicProvider, VertexProvider,
  VertexGatewayProvider,
  createProvider, createUtilityProvider,
  vertexEndpoint, vertexBody, parseVertexResponse,
  gatewayUrl, gatewayModel,
};
