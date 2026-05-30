"use strict";
/**
 * Document Agent — M1 entry point with enhanced intelligence.
 *
 * M0 wires the full loop end-to-end with the NullProvider so the UI is
 * verifiable offline. M1 turns this "real" by:
 *   - setting CEO_MODEL_PROVIDER + API key (the provider becomes a real model)
 *   - implementing contradiction scanning + autonomous doc edits as git commits
 *
 * ENHANCEMENTS: Better context loading, conversation memory, chain-of-thought reasoning.
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
    this.conversationHistory = []; // Short-term memory for current session
    this.maxHistory = 5; // Keep last 5 exchanges for context
  }

  systemPrompt(domain, { useReasoning = false } = {}) {
    const ctx = brain.loadContext(this.slug, { domain, maxArtifacts: 8 });
    
    // Build enhanced context from brain data
    let contextSections = [
      `You are the Project CEO's Document Agent for project "${this.project?.name || this.slug}".`,
      domain && domain !== "All" ? `Current domain: ${domain}.` : `Scope: all domains.`,
      `You keep documentation coherent: find contradictions/drift across docs, code, and plans.`,
    ];
    
    // Add recent context for intelligence
    if (ctx.recentDecisions.length > 0) {
      contextSections.push(`\n--- RECENT DECISIONS ---`);
      ctx.recentDecisions.slice(0, 3).forEach(d => {
        contextSections.push(`- ${d.title}: ${d.summary}`);
      });
    }
    
    if (ctx.recentContradictions.length > 0) {
      contextSections.push(`\n--- KNOWN CONTRADICTIONS ---`);
      ctx.recentContradictions.forEach(c => {
        contextSections.push(`- ${c.title}: ${c.summary}`);
      });
    }
    
    if (ctx.relevantArtifacts.length > 0) {
      contextSections.push(`\n--- RELEVANT ARTIFACTS ---`);
      ctx.relevantArtifacts.slice(0, 5).forEach(a => {
        contextSections.push(`- ${a.title}: ${a.summary}`);
      });
    }
    
    contextSections.push(`\n--- CURRENT STRATEGY ---`);
    contextSections.push(ctx.strategy.slice(0, 1500));
    
    // Add reasoning instructions for complex tasks
    if (useReasoning) {
      contextSections.push(`\n--- REASONING MODE ---`);
      contextSections.push(`For complex requests, think step-by-step before answering. Consider: 1) What information do I need? 2) What tools should I use? 3) What are the potential issues? 4) What is the best approach?`);
    }
    
    return contextSections.join("\n");
  }

  /**
   * Handle a user request with enhanced intelligence.
   * Cost-gated end-to-end. Records the exchange to the brain (record-first).
   * Returns { text, usage, halted, reasoning, reason }.
   */
  async ask(prompt, { domain = "All", useReasoning = false } = {}) {
    const gate = this.cost.canProceed();
    if (!gate.ok) {
      return { text: `⛔ Halted by cost guardrail: ${gate.reason}`, halted: true, reason: gate.reason };
    }

    // Detect if this is a complex task that needs reasoning
    const complexityIndicators = ['analyze', 'design', 'architecture', 'implement', 'fix', 'debug', 'optimize', 'plan'];
    const isComplex = complexityIndicators.some(indicator => 
      prompt.toLowerCase().includes(indicator)
    ) || prompt.length > 200;
    
    const isSimple = prompt.length < 50 && !isComplex; // Short, simple queries
    
    const shouldUseReasoning = useReasoning || isComplex;
    const system = this.systemPrompt(domain, { useReasoning: shouldUseReasoning });
    
    // Determine model complexity based on task
    let modelComplexity = "standard";
    if (isSimple) modelComplexity = "simple";
    else if (isComplex) modelComplexity = "complex";
    
    // Build messages with conversation history for context
    const messages = [];
    
    // Add recent conversation history for better context
    if (this.conversationHistory.length > 0) {
      this.conversationHistory.forEach(exchange => {
        messages.push({ role: "user", content: exchange.user });
        messages.push({ role: "assistant", content: exchange.assistant });
      });
    }
    
    // Add current prompt
    messages.push({ role: "user", content: prompt });
    
    // Add reasoning instruction for complex tasks
    if (shouldUseReasoning) {
      messages[messages.length - 1].content += 
        "\n\nPlease think through this step-by-step before providing your final answer.";
    }
    
    let result;
    try {
      result = await this.provider.complete({
        system,
        messages,
        complexity: modelComplexity,
      });
    } catch (e) {
      return { text: `Provider error: ${e.message}`, error: true };
    }

    const entry = this.cost.recordUsage(result.usage || {});

    // Update conversation history
    this.conversationHistory.push({
      user: prompt,
      assistant: result.text || "",
      timestamp: new Date().toISOString()
    });
    
    // Keep history bounded
    if (this.conversationHistory.length > this.maxHistory) {
      this.conversationHistory = this.conversationHistory.slice(-this.maxHistory);
    }

    // Record-first: store the exchange as an artifact in the brain.
    brain.writeArtifact(this.slug, {
      type: "chat",
      title: prompt.slice(0, 80),
      domain,
      summary: (result.text || "").slice(0, 200),
      source: { system: "document-agent", path: null, actor: "user" },
    });

    return { 
      text: result.text, 
      usage: entry, 
      halted: false,
      reasoning: shouldUseReasoning
    };
  }
}

module.exports = { DocumentAgent };
