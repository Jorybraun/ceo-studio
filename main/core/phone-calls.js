"use strict";
/**
 * Phone calls database — SQLite storage for phone call metadata and transcriptions.
 *
 * Design rules (mirror hermes.js):
 *   - Main process owns ALL logic; the renderer is thin and talks via IPC.
 *   - Uses sqlite3 CLI for all database operations (no better-sqlite3 dependency).
 *   - Database location: ~/.ceo-studio/<project>/brain/phone_calls.db
 *   - Degrades gracefully: if sqlite3 is missing, functions return {ok:false, reason}.
 *
 * Schema from transcription-storage-research.md:
 *   - calls: Main call records
 *   - participants: Multi-party call participants
 *   - transcription_segments: Optional segmented transcription with timestamps
 *
 * Hybrid storage: SQLite for metadata + file-based for full transcriptions.
 */
const os = require("os");
const path = require("path");
const fs = require("fs");
const { execFileSync } = require("child_process");

// CEO Studio brain directory
function brainDir() {
  return process.env.CEO_STUDIO_BRAIN || path.join(os.homedir(), ".ceo-studio", "ceo-studio", "brain");
}

// Phone calls database path
function dbPath() {
  return path.join(brainDir(), "phone_calls.db");
}

// Phone calls file storage directory (for audio, markdown transcriptions, etc.)
function storageDir(callId) {
  const base = path.join(brainDir(), "phone_calls");
  return callId ? path.join(base, callId) : base;
}

// Schema version for migrations
const SCHEMA_VERSION = 1;

/**
 * Initialize the database with schema and indexes.
 * Creates the database file if it doesn't exist, runs migrations if needed.
 */
function initialize() {
  const db = dbPath();
  const dir = path.dirname(db);
  
  // Ensure brain directory exists
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (e) {
    return { ok: false, reason: `Failed to create brain directory: ${e.message}` };
  }
  
  // Check if database exists
  const exists = fs.existsSync(db);
  
  try {
    if (!exists) {
      // Create fresh database with schema
      const schema = getSchema();
      execFileSync("sqlite3", [db, schema], {
        encoding: "utf-8",
        timeout: 10000,
        maxBuffer: 8 * 1024 * 1024,
      });
      return { ok: true, created: true, version: SCHEMA_VERSION };
    } else {
      // Run migrations if needed
      return migrate();
    }
  } catch (e) {
    return { ok: false, reason: `Database initialization failed: ${e.message}` };
  }
}

/**
 * Get the current schema version from the database.
 */
function getSchemaVersion() {
  const db = dbPath();
  if (!fs.existsSync(db)) return 0;
  
  try {
    const out = execFileSync("sqlite3", ["-json", db, "PRAGMA user_version;"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    const rows = JSON.parse(out.trim() || "[]");
    return rows[0]?.user_version || 0;
  } catch {
    return 0;
  }
}

/**
 * Run migrations to bring the database to the current schema version.
 */
function migrate() {
  const db = dbPath();
  const currentVersion = getSchemaVersion();
  
  if (currentVersion === SCHEMA_VERSION) {
    return { ok: true, version: SCHEMA_VERSION, migrated: false };
  }
  
  if (currentVersion > SCHEMA_VERSION) {
    return { ok: false, reason: `Database schema version ${currentVersion} is newer than code version ${SCHEMA_VERSION}` };
  }
  
  try {
    // Apply migrations sequentially
    for (let v = currentVersion + 1; v <= SCHEMA_VERSION; v++) {
      const migration = getMigration(v);
      if (migration) {
        execFileSync("sqlite3", [db, migration], {
          encoding: "utf-8",
          timeout: 10000,
          maxBuffer: 8 * 1024 * 1024,
        });
      }
    }
    
    // Update schema version
    execFileSync("sqlite3", [db, `PRAGMA user_version = ${SCHEMA_VERSION};`], {
      encoding: "utf-8",
      timeout: 5000,
    });
    
    return { ok: true, version: SCHEMA_VERSION, migrated: true, fromVersion: currentVersion };
  } catch (e) {
    return { ok: false, reason: `Migration failed: ${e.message}` };
  }
}

/**
 * Get the full database schema SQL.
 */
function getSchema() {
  return `
-- Schema version
PRAGMA user_version = ${SCHEMA_VERSION};

-- Main call records
CREATE TABLE IF NOT EXISTS calls (
  id TEXT PRIMARY KEY,
  project_slug TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_seconds REAL,
  direction TEXT CHECK(direction IN ('inbound', 'outbound')),
  phone_number TEXT,
  status TEXT CHECK(status IN ('completed', 'failed', 'abandoned')),
  transcription_service TEXT,
  transcription_model TEXT,
  has_audio BOOLEAN DEFAULT 0,
  transcription_text TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Participants (multi-party calls)
CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  role TEXT CHECK(role IN ('caller', 'callee', 'agent', 'system')),
  phone_number TEXT,
  name TEXT,
  joined_at TEXT,
  left_at TEXT,
  FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
);

-- Optional: Segmented transcription (timestamps per utterance)
CREATE TABLE IF NOT EXISTS transcription_segments (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  speaker TEXT,
  start_offset REAL,
  end_offset REAL,
  text TEXT,
  confidence REAL,
  FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_calls_started_at ON calls(started_at);
CREATE INDEX IF NOT EXISTS idx_calls_phone_number ON calls(phone_number);
CREATE INDEX IF NOT EXISTS idx_calls_status ON calls(status);
CREATE INDEX IF NOT EXISTS idx_participants_call_id ON participants(call_id);
CREATE INDEX IF NOT EXISTS idx_segments_call_id ON transcription_segments(call_id);

-- Full-text search on transcription
CREATE VIRTUAL TABLE IF NOT EXISTS calls_fts USING fts5(transcription_text, content=calls, content_rowid=rowid);
`;
}

/**
 * Get migration SQL for a specific version.
 */
function getMigration(version) {
  // Future migrations can be added here
  // For now, schema v1 is the initial schema
  return null;
}

/**
 * Run a read-only query against the database.
 */
function _query(sql) {
  const db = dbPath();
  if (!fs.existsSync(db)) return [];
  
  try {
    const out = execFileSync("sqlite3", ["-json", db, sql], {
      encoding: "utf-8",
      timeout: 5000,
      maxBuffer: 8 * 1024 * 1024,
    });
    const trimmed = (out || "").trim();
    return trimmed ? JSON.parse(trimmed) : [];
  } catch {
    return [];
  }
}

/**
 * Run a write query against the database.
 */
function _execute(sql) {
  const db = dbPath();
  if (!fs.existsSync(db)) {
    const init = initialize();
    if (!init.ok) return { ok: false, reason: init.reason };
  }
  
  try {
    execFileSync("sqlite3", [db, sql], {
      encoding: "utf-8",
      timeout: 10000,
      maxBuffer: 8 * 1024 * 1024,
    });
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Escape a string for SQL.
 */
function _escape(value) {
  if (value == null) return "NULL";
  return `'${String(value).replace(/'/g, "''")}'`;
}

/**
 * Generate a UUID v4.
 */
function generateId() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ---------------------------------------------------------------------------
// CRUD operations for calls
// ---------------------------------------------------------------------------

/**
 * Create a new call record.
 */
function createCall(data) {
  const id = data.id || generateId();
  const {
    project_slug,
    started_at,
    ended_at = null,
    duration_seconds = null,
    direction = null,
    phone_number = null,
    status = "in_progress",
    transcription_service = null,
    transcription_model = null,
    has_audio = 0,
    transcription_text = null,
  } = data;
  
  if (!project_slug || !started_at) {
    return { ok: false, reason: "project_slug and started_at are required" };
  }
  
  const sql = `
    INSERT INTO calls (
      id, project_slug, started_at, ended_at, duration_seconds,
      direction, phone_number, status, transcription_service,
      transcription_model, has_audio, transcription_text
    ) VALUES (
      ${_escape(id)}, ${_escape(project_slug)}, ${_escape(started_at)},
      ${_escape(ended_at)}, ${_escape(duration_seconds)}, ${_escape(direction)},
      ${_escape(phone_number)}, ${_escape(status)}, ${_escape(transcription_service)},
      ${_escape(transcription_model)}, ${has_audio ? 1 : 0}, ${_escape(transcription_text)}
    );
  `;
  
  const result = _execute(sql);
  if (!result.ok) return result;
  
  return { ok: true, id };
}

/**
 * Get a call by ID.
 */
function getCall(id) {
  const rows = _query(`SELECT * FROM calls WHERE id = ${_escape(id)} LIMIT 1;`);
  if (!rows.length) return { ok: false, reason: "Call not found" };
  return { ok: true, call: rows[0] };
}

/**
 * Update a call record.
 */
function updateCall(id, data) {
  const updates = [];
  const allowed = [
    "ended_at", "duration_seconds", "direction", "phone_number",
    "status", "transcription_service", "transcription_model",
    "has_audio", "transcription_text"
  ];
  
  for (const key of allowed) {
    if (key in data) {
      updates.push(`${key} = ${key === "has_audio" ? (data[key] ? 1 : 0) : _escape(data[key])}`);
    }
  }
  
  if (updates.length === 0) {
    return { ok: false, reason: "No valid fields to update" };
  }
  
  updates.push("updated_at = CURRENT_TIMESTAMP");
  
  const sql = `UPDATE calls SET ${updates.join(", ")} WHERE id = ${_escape(id)};`;
  return _execute(sql);
}

/**
 * Delete a call record (cascades to participants and segments).
 */
function deleteCall(id) {
  const sql = `DELETE FROM calls WHERE id = ${_escape(id)};`;
  return _execute(sql);
}

/**
 * List calls with optional filters.
 */
function listCalls(filters = {}) {
  let sql = "SELECT * FROM calls WHERE 1=1";
  const params = [];
  
  if (filters.project_slug) {
    sql += ` AND project_slug = ${_escape(filters.project_slug)}`;
  }
  if (filters.phone_number) {
    sql += ` AND phone_number = ${_escape(filters.phone_number)}`;
  }
  if (filters.status) {
    sql += ` AND status = ${_escape(filters.status)}`;
  }
  if (filters.direction) {
    sql += ` AND direction = ${_escape(filters.direction)}`;
  }
  if (filters.after_date) {
    sql += ` AND started_at >= ${_escape(filters.after_date)}`;
  }
  if (filters.before_date) {
    sql += ` AND started_at <= ${_escape(filters.before_date)}`;
  }
  
  sql += " ORDER BY started_at DESC";
  
  if (filters.limit) {
    sql += ` LIMIT ${Number(filters.limit)}`;
  }
  
  const rows = _query(sql);
  return { ok: true, calls: rows };
}

/**
 * Full-text search on call transcriptions.
 */
function searchCalls(query, limit = 20) {
  const sql = `
    SELECT c.* FROM calls c
    INNER JOIN calls_fts fts ON c.rowid = fts.rowid
    WHERE calls_fts MATCH ${_escape(query)}
    ORDER BY started_at DESC
    LIMIT ${Number(limit)};
  `;
  const rows = _query(sql);
  return { ok: true, calls: rows };
}

// ---------------------------------------------------------------------------
// CRUD operations for participants
// ---------------------------------------------------------------------------

/**
 * Add a participant to a call.
 */
function addParticipant(data) {
  const id = data.id || generateId();
  const {
    call_id,
    role,
    phone_number = null,
    name = null,
    joined_at = null,
    left_at = null,
  } = data;
  
  if (!call_id || !role) {
    return { ok: false, reason: "call_id and role are required" };
  }
  
  const sql = `
    INSERT INTO participants (
      id, call_id, role, phone_number, name, joined_at, left_at
    ) VALUES (
      ${_escape(id)}, ${_escape(call_id)}, ${_escape(role)},
      ${_escape(phone_number)}, ${_escape(name)}, ${_escape(joined_at)}, ${_escape(left_at)}
    );
  `;
  
  const result = _execute(sql);
  if (!result.ok) return result;
  
  return { ok: true, id };
}

/**
 * Get participants for a call.
 */
function getParticipants(callId) {
  const rows = _query(`SELECT * FROM participants WHERE call_id = ${_escape(callId)} ORDER BY joined_at;`);
  return { ok: true, participants: rows };
}

/**
 * Update a participant.
 */
function updateParticipant(id, data) {
  const updates = [];
  const allowed = ["role", "phone_number", "name", "joined_at", "left_at"];
  
  for (const key of allowed) {
    if (key in data) {
      updates.push(`${key} = ${_escape(data[key])}`);
    }
  }
  
  if (updates.length === 0) {
    return { ok: false, reason: "No valid fields to update" };
  }
  
  const sql = `UPDATE participants SET ${updates.join(", ")} WHERE id = ${_escape(id)};`;
  return _execute(sql);
}

/**
 * Remove a participant from a call.
 */
function removeParticipant(id) {
  const sql = `DELETE FROM participants WHERE id = ${_escape(id)};`;
  return _execute(sql);
}

// ---------------------------------------------------------------------------
// CRUD operations for transcription segments
// ---------------------------------------------------------------------------

/**
 * Add a transcription segment to a call.
 */
function addSegment(data) {
  const id = data.id || generateId();
  const {
    call_id,
    speaker = null,
    start_offset,
    end_offset,
    text,
    confidence = null,
  } = data;
  
  if (!call_id || start_offset == null || end_offset == null || !text) {
    return { ok: false, reason: "call_id, start_offset, end_offset, and text are required" };
  }
  
  const sql = `
    INSERT INTO transcription_segments (
      id, call_id, speaker, start_offset, end_offset, text, confidence
    ) VALUES (
      ${_escape(id)}, ${_escape(call_id)}, ${_escape(speaker)},
      ${_escape(start_offset)}, ${_escape(end_offset)}, ${_escape(text)}, ${_escape(confidence)}
    );
  `;
  
  const result = _execute(sql);
  if (!result.ok) return result;
  
  return { ok: true, id };
}

/**
 * Get transcription segments for a call.
 */
function getSegments(callId) {
  const rows = _query(`SELECT * FROM transcription_segments WHERE call_id = ${_escape(callId)} ORDER BY start_offset;`);
  return { ok: true, segments: rows };
}

/**
 * Update a transcription segment.
 */
function updateSegment(id, data) {
  const updates = [];
  const allowed = ["speaker", "start_offset", "end_offset", "text", "confidence"];
  
  for (const key of allowed) {
    if (key in data) {
      updates.push(`${key} = ${_escape(data[key])}`);
    }
  }
  
  if (updates.length === 0) {
    return { ok: false, reason: "No valid fields to update" };
  }
  
  const sql = `UPDATE transcription_segments SET ${updates.join(", ")} WHERE id = ${_escape(id)};`;
  return _execute(sql);
}

/**
 * Remove a transcription segment.
 */
function removeSegment(id) {
  const sql = `DELETE FROM transcription_segments WHERE id = ${_escape(id)};`;
  return _execute(sql);
}

/**
 * Clear all segments for a call (useful when re-transcribing).
 */
function clearSegments(callId) {
  const sql = `DELETE FROM transcription_segments WHERE call_id = ${_escape(callId)};`;
  return _execute(sql);
}

// ---------------------------------------------------------------------------
// File-based storage helpers
// ---------------------------------------------------------------------------

/**
 * Ensure the storage directory for a call exists.
 */
function ensureStorageDir(callId) {
  const dir = storageDir(callId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    return { ok: true, path: dir };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Write the full transcription as markdown.
 */
function writeTranscriptionMarkdown(callId, content) {
  const dirResult = ensureStorageDir(callId);
  if (!dirResult.ok) return dirResult;
  
  const filePath = path.join(dirResult.path, "transcription.md");
  try {
    fs.writeFileSync(filePath, content, "utf-8");
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Read the full transcription markdown.
 */
function readTranscriptionMarkdown(callId) {
  const filePath = path.join(storageDir(callId), "transcription.md");
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: "Transcription file not found" };
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return { ok: true, content };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Write metadata JSON snapshot.
 */
function writeMetadataJson(callId, metadata) {
  const dirResult = ensureStorageDir(callId);
  if (!dirResult.ok) return dirResult;
  
  const filePath = path.join(dirResult.path, "metadata.json");
  try {
    fs.writeFileSync(filePath, JSON.stringify(metadata, null, 2), "utf-8");
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

/**
 * Read metadata JSON snapshot.
 */
function readMetadataJson(callId) {
  const filePath = path.join(storageDir(callId), "metadata.json");
  if (!fs.existsSync(filePath)) {
    return { ok: false, reason: "Metadata file not found" };
  }
  
  try {
    const content = fs.readFileSync(filePath, "utf-8");
    return { ok: true, metadata: JSON.parse(content) };
  } catch (e) {
    return { ok: false, reason: e.message };
  }
}

// ---------------------------------------------------------------------------
// Statistics and aggregation
// ---------------------------------------------------------------------------

/**
 * Get call statistics.
 */
function getStats(filters = {}) {
  let where = "1=1";
  if (filters.project_slug) {
    where += ` AND project_slug = ${_escape(filters.project_slug)}`;
  }
  
  const total = _query(`SELECT COUNT(*) as n FROM calls WHERE ${where};`)[0]?.n || 0;
  const byStatus = _query(`
    SELECT status, COUNT(*) as n
    FROM calls
    WHERE ${where}
    GROUP BY status;
  `);
  const byDirection = _query(`
    SELECT direction, COUNT(*) as n
    FROM calls
    WHERE ${where}
    GROUP BY direction;
  `);
  
  return {
    ok: true,
    total,
    byStatus,
    byDirection,
  };
}

module.exports = {
  // Paths
  brainDir,
  dbPath,
  storageDir,
  
  // Database lifecycle
  initialize,
  migrate,
  getSchemaVersion,
  
  // Calls CRUD
  createCall,
  getCall,
  updateCall,
  deleteCall,
  listCalls,
  searchCalls,
  
  // Participants CRUD
  addParticipant,
  getParticipants,
  updateParticipant,
  removeParticipant,
  
  // Transcription segments CRUD
  addSegment,
  getSegments,
  updateSegment,
  removeSegment,
  clearSegments,
  
  // File-based storage
  ensureStorageDir,
  writeTranscriptionMarkdown,
  readTranscriptionMarkdown,
  writeMetadataJson,
  readMetadataJson,
  
  // Statistics
  getStats,
  
  // Utilities
  generateId,
};
