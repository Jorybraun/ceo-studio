"use strict";
/**
 * Document Agent — M1 entry point (skeleton).
 *
 * M0 wires the full loop end-to-end with the NullProvider so the UI is
 * verifiable offline. M1 turns this "real" by:
 *   - setting CEO_MODEL_PROVIDER + API key (the provider becomes a real model)
 *   - implementing contradiction scanning + autonomous doc edits as git commits
 *
 * CRITICAL: every model call is gated by the CostMeter. This is the L0 hard
 * requirement (no autonomy without an enforced cost cap).
 */
const brain = require("./brain");

class DocumentAgent {
  /**
   * @param {object} deps { slug, project, provider, cost }
   */
  constructor({ slug, project, provider, cost }) {
    this.slug = slug;
    this.project = project;
    this.provider = provider;
    this.cost = cost;
  }

  systemPrompt(domain) {
    const ctx = brain.loadContext(this.slug);
    return [
      `You are the Project CEO's Document Agent for project "${this.project?.name || this.slug}".`,
      domain && domain !== "All" ? `Current domain: ${domain}.` : `Scope: all domains.`,
      `You keep documentation coherent: find contradictions/drift across docs, code, and plans.`,
      `Indexed artifacts: ${ctx.counts.artifacts}. Known contradictions: ${ctx.counts.contradictions}.`,
      `--- current strategy ---`,
      ctx.strategy.slice(0, 2000),
    ].join("\n");
  }

  /**
   * Handle a user request. Cost-gated end-to-end. Records the exchange to the
   * brain (record-first). Returns { text, usage, halted, reason }.
   */
  async ask(prompt, { domain = "All" } = {}) {
    const gate = this.cost.canProceed();
    if (!gate.ok) {
      return { text: `⛔ Halted by cost guardrail: ${gate.reason}`, halted: true, reason: gate.reason };
    }

    const system = this.systemPrompt(domain);
    let result;
    try {
      result = await this.provider.complete({
        system,
        messages: [{ role: "user", content: prompt }],
      });
    } catch (e) {
      return { text: `Provider error: ${e.message}`, error: true };
    }

    const entry = this.cost.recordUsage(result.usage || {});

    // Record-first: store the exchange as an artifact in the brain.
    brain.writeArtifact(this.slug, {
      type: "chat",
      title: prompt.slice(0, 80),
      domain,
      summary: (result.text || "").slice(0, 200),
      source: { system: "document-agent", path: null, actor: "user" },
    });

    return { text: result.text, usage: entry, halted: false };
  }
}

module.exports = { DocumentAgent };
