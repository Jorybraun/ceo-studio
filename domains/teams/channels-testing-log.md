# Channels Feature Testing Log

> **HISTORICAL** — This log captures the channel system when it was a
> non-functional UI shell. The channel system has since been rebuilt into live
> A2A rooms and now lives in its own domain. The authoritative, current
> documentation and testing criteria are:
> - Domain: `domains/channels/` (`definition.md`, `index.md`, `AGENTS.md`)
> - Testing criteria: `domains/channels/testing-criteria.md`
> - Feature spec: `domains/channels/docs/features/live-a2a-channels.md`
>
> Keep this file for the historical record; do not add new channel test results
> here — add them to `domains/channels/testing-criteria.md`.

**Date**: 2026-06-02  
**Tester**: Devin CLI (dogfood testing)  
**Domain**: Teams  
**Feature**: Channels (agent communication)

## Test Environment
- CEO Studio running on localhost:5173
- Chrome DevTools MCP server for UI automation
- Harness runtime: /Users/hans/Code/AGENT/CEO_STUDIO/runtime/harness
- Active agents: ba (echo), pm (devin), others

## Test Results

### 1. Channels UI Rendering ✅
**Status**: PASS
- Channels view renders correctly
- Shows group channels (team channels like # discovery-planning, # execution-builders)
- Shows direct messages (individual agents)
- Agent metadata displayed correctly (provider, persona, capabilities)
- Visual structure is clear and organized

### 2. Channel Click Behavior ❌
**Status**: FAIL
- Clicking any channel (team or DM) has no effect
- UI shows: "Channels will open a live room in the chat panel on the right. (Room wiring is the next step.)"
- This is explicitly documented as unimplemented
- **Critical Issue**: Channels are a static list with no actual room functionality

### 3. Agent Mounting via UI ✅ (RESOLVED)
**Status**: FIXED (was FAIL)
- Original symptom: "mount failed: tmux session did not start (see output)" for any agent.
- **Real root cause** (diagnosed): NOT a tmux problem. The cost guardrail's
  `count_running_agents()` counted *every* tmux session on the machine, including
  unrelated scratch shells (`agent-chat`, `agent-orchestration`). With 3 real
  agents + 2 scratch sessions it read 5/5 and denied the spawn; `launch-agent`
  then exited before creating the session, and `mount()` reported the generic
  "tmux session did not start". The error message hid the true reason.
- **Fix**:
  1. `config/cost_limits.py` — `count_running_agents()` now counts only agent
     sessions matching the `pipe-*` naming convention (`AGENT_SESSION_PREFIX`,
     override `CEO_AGENT_SESSION_PREFIX`, set "" for legacy count-all).
  2. `main/core/mount.js` — `mount()` now surfaces the real failure via
     `failureReason()` (e.g. "spawn refused by guardrail: ... (5/5)") instead of
     the generic tmux message.
- **Verified**: guardrail status dropped 5→3 running agents; `docs-steward`
  mounts successfully; regression test added
  (`tests/test_cost_limits.py::test_count_running_agents_only_counts_pipe_sessions`).
- **Note**: the hourly spawn cap (`MAX_SPAWNS_PER_HOUR`, default 12) is a separate
  limit and can still block bursts of mounts.

### 4. Agent Mounting via CLI ⚠️
**Status**: PARTIAL
- Manual CLI mounting works: `./bin/launch-agent --name ba`
- Successfully creates tmux session and watcher
- However, agents launch in "watcher_only" mode
- **Issue**: Watcher-only agents don't respond to messages - they only send heartbeats

### 5. Agent Communication ❌
**Status**: FAIL
- Messages posted to discovery room via CLI: `./bin/domain-room post discovery CEO "message"`
- Messages appear in chat.log
- **Problem**: Agents only send heartbeats, no actual responses
- ba (echo provider): Fake, no real brain
- pm (devin provider): Running as watcher, not configured to respond
- **Critical Issue**: Even with mounted agents and active rooms, no two-way communication

### 6. Room Integration ❌
**Status**: FAIL
- Room logs exist at `brain/rooms/discovery/chat.log`
- Messages are being recorded
- But UI doesn't show room activity
- No way to view room history through CEO Studio
- Channels UI doesn't connect to actual room functionality

## Critical Issues Summary

1. **Channels are non-functional UI shell**: The channels view exists but does nothing when clicked
2. **No room wiring**: Channel clicks don't open live rooms in chat panel
3. **Agent mounting fails in UI**: Can't mount agents through CEO Studio interface
4. **Watcher-only mode**: Mounted agents don't respond to messages, only send heartbeats
5. **No two-way communication**: Even with CLI-mounted agents, can't get real responses
6. **Missing error visibility**: Mount failures show generic messages without debugging info

## Architecture Issues

### Dependency Loop
- Channels depend on agents being mounted
- Mounting fails in UI (cost guardrail, tmux issues)
- Even when mounted, agents are in watcher-only mode
- Watcher-only agents don't respond to messages
- Result: Complete lack of functionality

### Provider Limitations
- Most agents use "echo" provider (fake, no brain)
- Real agents (devin, hermes) run as watchers, not conversational participants
- No configuration for agents to actively participate in room conversations

## Recommendations

### Immediate Fixes
1. **Fix mounting first**: Debug why tmux sessions aren't starting via UI
2. **Implement room wiring**: Connect channel clicks to actual room functionality
3. **Better error visibility**: Show actual mount error output instead of generic messages
4. **Configure active participation**: Make agents respond to messages, not just watch

### Design Changes
1. **Distinguish modes**: Separate "watcher" mode from "participant" mode
2. **Room-first architecture**: Channels should open rooms directly, not depend on mounting
3. **Offline mode support**: Allow basic messaging for echo providers without live tmux
4. **Clear status labeling**: Mark channels as "UI shell - room functionality not yet implemented"

## Test Evidence

### Console Errors
- `Uncaught ReferenceError: require is not defined` at highlight.min.js:8:12
- CDN warning: tailwindcss.com should not be used in production

### Agent Status
- ba: echo provider, watcher-only, fake brain
- pm: devin provider, watcher-only, real brain but not responding
- Other agents: mostly echo providers (fake)

### Room Activity
- Messages posted successfully to discovery room
- Only heartbeat messages from agents, no responses
- Chat log shows: `[CEO] Hello pm agent...` followed by more heartbeats

## Conclusion

The channels feature is currently **non-functional**. It has the right visual structure and shows correct data from the registry, but lacks the core functionality needed to be useful:

- No room wiring
- No working agent mounting via UI  
- No two-way agent communication
- Agents in watcher-only mode don't respond

**Recommendation**: Either hide the feature until functional or clearly mark it as incomplete/in development. The current state will confuse users who expect working agent communication.