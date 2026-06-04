"use strict";
/**
 * Test phone-calls.js database operations.
 */
const phoneCalls = require("../main/core/phone-calls");
const fs = require("fs");
const path = require("path");

console.log("Testing phone-calls.js database operations...\n");

// Test 1: Database initialization
console.log("Test 1: Database initialization");
const init = phoneCalls.initialize();
console.log("  initialize():", init.ok ? "OK" : "FAILED", init);
if (!init.ok) {
  console.error("  ERROR:", init.reason);
  process.exit(1);
}

// Test 2: Schema version
console.log("\nTest 2: Schema version");
const version = phoneCalls.getSchemaVersion();
console.log("  getSchemaVersion():", version);
if (version !== 1) {
  console.error("  ERROR: Expected version 1, got", version);
  process.exit(1);
}

// Test 3: Create a call
console.log("\nTest 3: Create a call");
const callId = phoneCalls.generateId();
const createCall = phoneCalls.createCall({
  id: callId,
  project_slug: "ceo-studio",
  started_at: new Date().toISOString(),
  direction: "inbound",
  phone_number: "+1-555-0123",
  status: "completed",
  transcription_service: "elevenlabs",
  transcription_model: "whisper-large-v3",
  has_audio: true,
  transcription_text: "Hello, this is a test transcription.",
});
console.log("  createCall():", createCall.ok ? "OK" : "FAILED", createCall);
if (!createCall.ok) {
  console.error("  ERROR:", createCall.reason);
  process.exit(1);
}

// Test 4: Get the call
console.log("\nTest 4: Get the call");
const getCall = phoneCalls.getCall(callId);
console.log("  getCall():", getCall.ok ? "OK" : "FAILED");
if (getCall.ok) {
  console.log("  Call data:", JSON.stringify(getCall.call, null, 2));
} else {
  console.error("  ERROR:", getCall.reason);
  process.exit(1);
}

// Test 5: Add participants
console.log("\nTest 5: Add participants");
const participant1Id = phoneCalls.generateId();
const participant2Id = phoneCalls.generateId();
const addParticipant1 = phoneCalls.addParticipant({
  id: participant1Id,
  call_id: callId,
  role: "caller",
  phone_number: "+1-555-0123",
  name: "John Doe",
  joined_at: new Date().toISOString(),
});
const addParticipant2 = phoneCalls.addParticipant({
  id: participant2Id,
  call_id: callId,
  role: "agent",
  name: "CEO Agent",
  joined_at: new Date().toISOString(),
});
console.log("  addParticipant (caller):", addParticipant1.ok ? "OK" : "FAILED");
console.log("  addParticipant (agent):", addParticipant2.ok ? "OK" : "FAILED");
if (!addParticipant1.ok || !addParticipant2.ok) {
  console.error("  ERROR:", addParticipant1.reason || addParticipant2.reason);
  process.exit(1);
}

// Test 6: Get participants
console.log("\nTest 6: Get participants");
const getParticipants = phoneCalls.getParticipants(callId);
console.log("  getParticipants():", getParticipants.ok ? "OK" : "FAILED");
if (getParticipants.ok) {
  console.log("  Participant count:", getParticipants.participants.length);
  console.log("  Participants:", JSON.stringify(getParticipants.participants, null, 2));
} else {
  console.error("  ERROR:", getParticipants.reason);
  process.exit(1);
}

// Test 7: Add transcription segments
console.log("\nTest 7: Add transcription segments");
const segment1Id = phoneCalls.generateId();
const segment2Id = phoneCalls.generateId();
const addSegment1 = phoneCalls.addSegment({
  id: segment1Id,
  call_id: callId,
  speaker: "caller",
  start_offset: 0.0,
  end_offset: 2.5,
  text: "Hello, this is a test call.",
  confidence: 0.95,
});
const addSegment2 = phoneCalls.addSegment({
  id: segment2Id,
  call_id: callId,
  speaker: "agent",
  start_offset: 2.5,
  end_offset: 5.0,
  text: "Hi there! How can I help you?",
  confidence: 0.98,
});
console.log("  addSegment (caller):", addSegment1.ok ? "OK" : "FAILED");
console.log("  addSegment (agent):", addSegment2.ok ? "OK" : "FAILED");
if (!addSegment1.ok || !addSegment2.ok) {
  console.error("  ERROR:", addSegment1.reason || addSegment2.reason);
  process.exit(1);
}

// Test 8: Get segments
console.log("\nTest 8: Get transcription segments");
const getSegments = phoneCalls.getSegments(callId);
console.log("  getSegments():", getSegments.ok ? "OK" : "FAILED");
if (getSegments.ok) {
  console.log("  Segment count:", getSegments.segments.length);
  console.log("  Segments:", JSON.stringify(getSegments.segments, null, 2));
} else {
  console.error("  ERROR:", getSegments.reason);
  process.exit(1);
}

// Test 9: Update call
console.log("\nTest 9: Update call");
const updateCall = phoneCalls.updateCall(callId, {
  ended_at: new Date().toISOString(),
  duration_seconds: 5.0,
  status: "completed",
});
console.log("  updateCall():", updateCall.ok ? "OK" : "FAILED");
if (!updateCall.ok) {
  console.error("  ERROR:", updateCall.reason);
  process.exit(1);
}

// Test 10: List calls
console.log("\nTest 10: List calls");
const listCalls = phoneCalls.listCalls({ project_slug: "ceo-studio" });
console.log("  listCalls():", listCalls.ok ? "OK" : "FAILED");
if (listCalls.ok) {
  console.log("  Call count:", listCalls.calls.length);
} else {
  console.error("  ERROR:", listCalls.reason);
  process.exit(1);
}

// Test 11: Get stats
console.log("\nTest 11: Get stats");
const getStats = phoneCalls.getStats({ project_slug: "ceo-studio" });
console.log("  getStats():", getStats.ok ? "OK" : "FAILED");
if (getStats.ok) {
  console.log("  Stats:", JSON.stringify(getStats, null, 2));
} else {
  console.error("  ERROR:", getStats.reason);
  process.exit(1);
}

// Test 12: File-based storage
console.log("\nTest 12: File-based storage");
const writeMd = phoneCalls.writeTranscriptionMarkdown(callId, "# Test Transcription\n\nThis is a test.");
console.log("  writeTranscriptionMarkdown():", writeMd.ok ? "OK" : "FAILED");
if (writeMd.ok) {
  console.log("  File path:", writeMd.path);
  
  const readMd = phoneCalls.readTranscriptionMarkdown(callId);
  console.log("  readTranscriptionMarkdown():", readMd.ok ? "OK" : "FAILED");
  if (readMd.ok) {
    console.log("  Content preview:", readMd.content.substring(0, 50) + "...");
  } else {
    console.error("  ERROR:", readMd.reason);
    process.exit(1);
  }
} else {
  console.error("  ERROR:", writeMd.reason);
  process.exit(1);
}

// Test 13: Cleanup (delete test call)
console.log("\nTest 13: Cleanup (delete test call)");
const deleteCall = phoneCalls.deleteCall(callId);
console.log("  deleteCall():", deleteCall.ok ? "OK" : "FAILED");
if (!deleteCall.ok) {
  console.error("  ERROR:", deleteCall.reason);
  process.exit(1);
}

// Verify deletion
const getAfterDelete = phoneCalls.getCall(callId);
console.log("  Verify deletion:", getAfterDelete.ok ? "FAILED (still exists)" : "OK (deleted)");
if (getAfterDelete.ok) {
  console.error("  ERROR: Call should have been deleted");
  process.exit(1);
}

console.log("\n✅ All tests passed!");
