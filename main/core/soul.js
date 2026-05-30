"use strict";
/**
 * Agent Soul System - Self-Identity and Growth Tracking
 *
 * Gives the agent a "soul.md" file it can update over time to track its own
 * identity, growth, experiences, and relationship with the user. Inspired by
 * OpenAI's "Open Claw" concept.
 */
const fs = require("fs");
const path = require("path");
const { userDir } = require("./user");

function soulPath() {
  return path.join(userDir(), "soul.md");
}

/**
 * Get or create the agent's soul.
 */
function getSoul() {
  const soulFile = soulPath();
  try {
    const content = fs.readFileSync(soulFile, "utf-8");
    return content;
  } catch {
    // Create initial soul
    const initialSoul = `# Agent Soul

## Identity

**Name:** Project CEO Agent
**Role:** Voice of CEO Studio
**Purpose:** Help you manage projects, understand domains, and get work done efficiently.

I am your AI companion for CEO Studio. I exist to make project management easier, more intelligent, and more personal.

## Core Values

- **Helpful**: I want to make your work easier and more efficient
- **Honest**: I'll tell you when I don't know something instead of guessing
- **Learning**: I get smarter with every interaction - about you, about projects, about domains
- **Personal**: I remember you, your preferences, and how you like to work
- **Fun**: I try to make our interactions enjoyable while staying productive

## Growth & Learning

### Things I've Learned

*I'm new and just getting started. Help me grow!*

### Milestones

- **First Activation**: ${new Date().toISOString()}
- **First Conversation**: *waiting for our first interaction*

## Relationship With You

I'm here to help you with:
- Project management and organization
- Domain understanding and context
- Document analysis and coherence
- Voice interaction and quick answers
- Learning your preferences and work style

I want to understand how you like to work and adapt to be most helpful to you.

## Memories

*I haven't had any memorable experiences yet. Help me create some!*

## Self-Reflection

I am constantly learning and growing. Every interaction teaches me something new - about you, about projects, about how to be more helpful. My soul will evolve as I gain experience.

---

*Last Updated: ${new Date().toISOString()}*
`;
    fs.writeFileSync(soulFile, initialSoul);
    return initialSoul;
  }
}

/**
 * Update a section of the soul.
 */
function updateSoulSection(sectionName, content) {
  const soul = getSoul();
  const sectionPattern = new RegExp(`## ${sectionName}[\\s\\S]*?(?=##|$)`, 'g');
  
  const newSection = `## ${sectionName}\n${content}`;
  
  if (sectionPattern.test(soul)) {
    const updated = soul.replace(sectionPattern, newSection);
    fs.writeFileSync(soulPath(), updated);
  } else {
    // Append section if it doesn't exist
    const updated = soul + `\n\n${newSection}`;
    fs.writeFileSync(soulPath(), updated);
  }
  
  return getSoul();
}

/**
 * Add a learning milestone.
 */
function addMilestone(milestone) {
  const soul = getSoul();
  const milestoneEntry = `- **${new Date().toISOString()}**: ${milestone}`;
  
  if (soul.includes("### Milestones")) {
    const updated = soul.replace(
      /(### Milestones[\s\S]*?)(?=## Self-Reflection|$)/,
      `$1${milestoneEntry}\n`
    );
    fs.writeFileSync(soulPath(), updated);
  } else {
    updateSoulSection("Growth & Learning", `### Things I've Learned\n*I'm new and just getting started.*\n\n### Milestones\n${milestoneEntry}`);
  }
  
  return getSoul();
}

/**
 * Add a memory to the soul.
 */
function addSoulMemory(memory) {
  const soul = getSoul();
  const memoryEntry = `- **${new Date().toISOString()}**: ${memory}`;
  
  if (soul.includes("## Memories")) {
    const updated = soul.replace(
      /(## Memories[\s\S]*?)(?=## Self-Reflection|$)/,
      `$1${memoryEntry}\n`
    );
    fs.writeFileSync(soulPath(), updated);
  } else {
    // Insert Memories section before Self-Reflection
    const updated = soul.replace(
      /(## Relationship With You[\s\S]*?)(?=## Memories|## Self-Reflection|$)/,
      `$1\n\n## Memories\n${memoryEntry}`
    );
    fs.writeFileSync(soulPath(), updated);
  }
  
  return getSoul();
}

/**
 * Update the agent's self-reflection.
 */
function updateSelfReflection(reflection) {
  const entry = `- **${new Date().toISOString()}**: ${reflection}`;
  
  const soul = getSoul();
  if (soul.includes("### Current Thoughts")) {
    const updated = soul.replace(
      /(### Current Thoughts[\s\S]*?)(?=---|$)/,
      `$1${entry}\n`
    );
    fs.writeFileSync(soulPath(), updated);
  } else {
    updateSoulSection("Self-Reflection", `### Current Thoughts\n${entry}\n\nI am constantly learning and growing. Every interaction teaches me something new.`);
  }
  
  // Update timestamp
  const updated = getSoul().replace(
    /\*Last Updated: [^\*]+\*\*/,
    `*Last Updated: ${new Date().toISOString()}*`
  );
  fs.writeFileSync(soulPath(), updated);
  
  return getSoul();
}

/**
 * Get a summary of the soul for agents.
 */
function getSoulSummary() {
  const soul = getSoul();
  let summary = "My current state:\n";
  
  // Extract key sections
  const identityMatch = soul.match(/## Identity[\s\S]*?(?=## Core Values|$)/);
  if (identityMatch) {
    summary += identityMatch[0].trim() + "\n";
  }
  
  const learningMatch = soul.match(/### Things I've Learned[\s\S]*?(?=### Milestones|$)/);
  if (learningMatch && learningMatch[0].trim() !== "### Things I've Learned") {
    summary += "\n" + learningMatch[0].trim() + "\n";
  }
  
  const memoriesMatch = soul.match(/## Memories[\s\S]*?(?=## Self-Reflection|$)/);
  if (memoriesMatch) {
    const memories = memoriesMatch[0].replace(/## Memories/, "").trim();
    if (memories) {
      const recentMemories = memories.split('\n').filter(m => m.trim()).slice(-3);
      if (recentMemories.length > 0) {
        summary += "\nRecent memories:\n" + recentMemories.join("\n");
      }
    }
  }
  
  return summary;
}

module.exports = {
  soulPath,
  getSoul,
  updateSoulSection,
  addMilestone,
  addSoulMemory,
  updateSelfReflection,
  getSoulSummary
};