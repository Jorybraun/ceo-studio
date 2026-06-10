# Transcription Storage Architecture Research

**Task**: t_d986cbd2 - Research: Transcription storage architecture  
**Agent**: architect (Devin swe-1.6)  
**Date**: 2026-06-03  
**Status**: Complete

## Summary

Research into where and how to store phone call transcriptions in CEO Studio. Recommended approach: hybrid SQLite + file-based storage, consistent with existing CEO Studio patterns (Kanban SQLite + room chat.log files).

## Existing Storage Patterns in CEO Studio

1. **Hermes Kanban**: SQLite at `~/.hermes/kanban/boards/<slug>/kanban.db` for tasks
2. **Meetings/Rooms**: Text files at `runtime/harness/brain/rooms/<room>/chat.log` for transcripts
3. **Domains**: Markdown files in `domains/<domain-slug>/` for structured data
4. **GBrain**: Dedicated database for knowledge/memory (vector + structured)
5. **Voice**: ElevenLabs TTS/STT (main/core/voice.js) but NO transcription storage currently

## Requirements Analysis

### Query Patterns
- By date range (common)
- By phone number
- By participant
- By status (completed/failed/abandoned)
- Full-text search on transcription content

### Access Patterns
- Read-heavy (review past calls)
- Append-only (new calls added, rarely modified)
- Occasional bulk export/backup

### Scalability Considerations
- Potentially thousands of calls over time
- Need efficient pagination
- Text search across large corpus

### Backup & Retention
- Must be durable (business records)
- Configurable retention policy
- Audio files may need archival
- Transcription text kept longer than audio

## Proposed Architecture: Hybrid Storage

### SQLite Database (Structured Metadata)

**Location**: `~/.ceo-studio/<project>/brain/phone_calls.db`

**Purpose**: Fast queries, filtering, indexing

**Tables**:
- `calls` - Main call records
- `participants` - Multi-party call participants
- `transcription_segments` - Optional segmented transcription with timestamps

### File-based Storage (Full Transcriptions)

**Location**: `~/.ceo-studio/<project>/brain/phone_calls/<call_id>/`

**Files**:
- `transcription.md` - Human-readable full transcription
- `metadata.json` - Complete metadata snapshot
- `audio.webm` - Optional audio recording
- `segments.json` - Detailed timing/segmentation data

**Purpose**: Human-readable, backup, version control

## Database Schema

```sql
-- Main call records
CREATE TABLE calls (
  id TEXT PRIMARY KEY,  -- UUID
  project_slug TEXT NOT NULL,
  started_at TEXT NOT NULL,  -- ISO-8601
  ended_at TEXT,  -- ISO-8601
  duration_seconds REAL,
  direction TEXT CHECK(direction IN ('inbound', 'outbound')),
  phone_number TEXT,
  status TEXT CHECK(status IN ('completed', 'failed', 'abandoned')),
  transcription_service TEXT,  -- e.g., 'elevenlabs', 'twilio', 'openai'
  transcription_model TEXT,
  has_audio BOOLEAN DEFAULT 0,
  transcription_text TEXT,  -- Full text for FTS
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- Participants (multi-party calls)
CREATE TABLE participants (
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
CREATE TABLE transcription_segments (
  id TEXT PRIMARY KEY,
  call_id TEXT NOT NULL,
  speaker TEXT,
  start_offset REAL,  -- seconds from call start
  end_offset REAL,
  text TEXT,
  confidence REAL,
  FOREIGN KEY (call_id) REFERENCES calls(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX idx_calls_started_at ON calls(started_at);
CREATE INDEX idx_calls_phone_number ON calls(phone_number);
CREATE INDEX idx_calls_status ON calls(status);
CREATE INDEX idx_participants_call_id ON participants(call_id);
CREATE INDEX idx_segments_call_id ON transcription_segments(call_id);

-- Full-text search on transcription
CREATE VIRTUAL TABLE calls_fts USING fts5(transcription_text, content=calls, content_rowid=rowid);
```

## File Format: transcription.md

```markdown
# Phone Call Transcription

**Call ID**: `<uuid>`
**Date**: 2026-06-03T14:30:00Z
**Duration**: 5m 23s
**Direction**: inbound
**Phone Number**: +1-555-0123
**Participants**: Caller (unknown), CEO Agent

## Full Transcription

[00:00] Caller: Hello, I'm calling about...
[00:05] CEO Agent: Hi there! How can I help you today?
...
```

## Integration Points

1. **Cost Metering**: Transcription costs tracked via `CostMeter` (like voice.js)
2. **Brain Integration**: Call metadata indexed in `brain/index/artifacts.jsonl`
3. **GBrain Optional**: Ingest transcriptions for semantic search at L3+
4. **Domain Awareness**: Calls tagged with domain if applicable

## Advantages

- **Fast queries**: SQLite with indexes for date/phone/status lookups
- **Human-readable**: Markdown files for manual review
- **Backup-friendly**: Files can be version-controlled or archived
- **Scalable**: SQLite handles 10K+ calls easily; FTS for text search
- **Consistent**: Matches existing CEO Studio patterns (Kanban + rooms)

## Retention Policy

- Configurable retention period (default: 90 days)
- Old audio files auto-deleted after retention
- Transcription text kept longer (configurable)
- Soft-delete in SQLite (mark as archived)

## Alternatives Considered

### Pure File-based (like meetings)
- **Pros**: Simple, human-readable, version-control friendly
- **Cons**: Slow queries across many calls, no efficient indexing
- **Verdict**: Not suitable for phone call scale

### Pure Database (like Kanban)
- **Pros**: Fast queries, efficient indexing
- **Cons**: Not human-readable, harder to backup/inspect
- **Verdict**: Good for metadata, but need files for full transcription

### GBrain-only
- **Pros**: Semantic search, unified memory
- **Cons**: Overkill for structured queries, L3+ feature
- **Verdict**: Optional enhancement, not primary storage

## Decision

**Recommended**: Hybrid SQLite + file-based storage

This model balances query performance, human readability, and scalability while staying consistent with CEO Studio's existing architecture patterns.

## Related Tasks

- t_608ba284: Research: Phone call service provider options
- t_ced6e9f2: Research: Transcription service options

## Next Steps

1. Review and approve this architecture
2. Coordinate with transcription service research (t_ced6e9f2)
3. Implement storage layer when phone call feature is built

## Documentation

- Full architecture documented in GBrain: `ceo-studio-transcription-storage-architecture`
- Kanban comments on task t_d986cbd2 document research progress
