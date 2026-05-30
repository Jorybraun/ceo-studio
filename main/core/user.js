"use strict";
/**
 * User Memory & Personalization System
 *
 * Makes agents remember you, your preferences, and how you like to work.
 * Adds fun personalization and learns from interactions over time.
 */
const fs = require("fs");
const path = require("path");
const { studioHome } = require("./paths");

function userDir() {
  const dir = path.join(studioHome(), "user");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function userMemoryPath() {
  return path.join(userDir(), "memory.json");
}

/**
 * Get or create user memory.
 */
function getUserMemory() {
  const memoryPath = userMemoryPath();
  try {
    const data = fs.readFileSync(memoryPath, "utf-8");
    return JSON.parse(data);
  } catch {
    // Create default user memory
    const defaultMemory = {
      profile: {
        name: "Friend", // Default until they tell us their name
        preferredName: null,
        communicationStyle: "direct", // direct, casual, formal
        workStyle: "focused", // focused, collaborative, independent
        timeZone: null,
        preferredTime: null,
      },
      memories: [], // Things we learn about you
      preferences: {
        humor: "moderate", // none, moderate, high
        detailLevel: "balanced", // concise, balanced, detailed
        proactivity: "moderate", // reactive, moderate, proactive
        feedback: "constructive", // gentle, constructive, direct
      },
      funFacts: [], // Fun things we remember
      interactionCount: 0,
      firstInteraction: new Date().toISOString(),
      lastInteraction: new Date().toISOString(),
    };
    saveUserMemory(defaultMemory);
    return defaultMemory;
  }
}

/**
 * Save user memory.
 */
function saveUserMemory(memory) {
  const memoryPath = userMemoryPath();
  memory.lastInteraction = new Date().toISOString();
  fs.writeFileSync(memoryPath, JSON.stringify(memory, null, 2));
  return memory;
}

/**
 * Update user profile.
 */
function updateProfile(updates) {
  const memory = getUserMemory();
  Object.assign(memory.profile, updates);
  return saveUserMemory(memory);
}

/**
 * Add a memory about the user.
 */
function addMemory(memory, category = "general") {
  const userMemory = getUserMemory();
  userMemory.memories.push({
    memory,
    category,
    timestamp: new Date().toISOString(),
    interactionCount: userMemory.interactionCount,
  });
  // Keep only last 100 memories
  if (userMemory.memories.length > 100) {
    userMemory.memories = userMemory.memories.slice(-100);
  }
  return saveUserMemory(userMemory);
}

/**
 * Add a fun fact about the user.
 */
function addFunFact(fact) {
  const userMemory = getUserMemory();
  userMemory.funFacts.push({
    fact,
    timestamp: new Date().toISOString(),
  });
  // Keep only last 20 fun facts
  if (userMemory.funFacts.length > 20) {
    userMemory.funFacts = userMemory.funFacts.slice(-20);
  }
  return saveUserMemory(userMemory);
}

/**
 * Update preferences.
 */
function updatePreferences(updates) {
  const memory = getUserMemory();
  Object.assign(memory.preferences, updates);
  return saveUserMemory(memory);
}

/**
 * Record an interaction.
 */
function recordInteraction(type = "general") {
  const memory = getUserMemory();
  memory.interactionCount++;
  memory.lastInteraction = new Date().toISOString();
  return saveUserMemory(memory);
}

/**
 * Get user context for agents.
 */
function getUserContext() {
  const memory = getUserMemory();
  let context = `User profile:\n`;
  
  if (memory.profile.name && memory.profile.name !== "Friend") {
    context += `- Name: ${memory.profile.name}\n`;
  }
  
  context += `- Communication style: ${memory.profile.communicationStyle}\n`;
  context += `- Work style: ${memory.profile.workStyle}\n`;
  context += `- Interactions: ${memory.interactionCount}\n`;
  
  if (memory.memories.length > 0) {
    const recentMemories = memory.memories.slice(-5);
    context += `\nRecent things I've learned about you:\n`;
    recentMemories.forEach(m => {
      context += `- ${m.memory}\n`;
    });
  }
  
  if (memory.funFacts.length > 0) {
    const recentFacts = memory.funFacts.slice(-3);
    context += `\nFun facts I remember:\n`;
    recentFacts.forEach(f => {
      context += `- ${f.fact}\n`;
    });
  }
  
  return context;
}

/**
 * Get personalized greeting.
 */
function getPersonalizedGreeting() {
  const memory = getUserMemory();
  const name = memory.profile.preferredName || memory.profile.name;
  
  const greetings = [
    `Hey ${name}!`,
    `Good to see you, ${name}!`,
    `Welcome back, ${name}!`,
    `${name}, ready when you are!`,
  ];
  
  if (memory.interactionCount > 10) {
    greetings.push(`${name}, we've worked together ${memory.interactionCount} times now!`);
  }
  
  if (memory.funFacts.length > 0) {
    const randomFact = memory.funFacts[Math.floor(Math.random() * memory.funFacts.length)];
    greetings.push(`Hey ${name}! Remember ${randomFact.fact}?`);
  }
  
  return greetings[Math.floor(Math.random() * greetings.length)];
}

module.exports = {
  userDir,
  getUserMemory,
  saveUserMemory,
  updateProfile,
  addMemory,
  addFunFact,
  updatePreferences,
  recordInteraction,
  getUserContext,
  getPersonalizedGreeting
};