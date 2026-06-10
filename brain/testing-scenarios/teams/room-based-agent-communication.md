# Scenario: Room-Based Agent Communication

**Date**: 2026-06-02
**Domain**: Teams
**Feature**: Shared room communication (not A2A)
**Status**: PARTIAL
**Last Tested**: 2026-06-02

## Purpose
Verify that agents can communicate through shared rooms (pub/sub model), enabling multi-agent coordination. Note: This is room-based communication, not direct A2A (agent-to-agent) calling.

## Setup
1. CEO Studio running with Hermes gateway
2. At least 2 agents registered in agents.json
3. Agents mounted with room watchers active
4. Shared room (e.g., discovery) for communication

## Test Steps
1. Check which agents are currently mounted: `tmux list-sessions`
2. Verify agents are posting to shared room: `tail brain/rooms/discovery/chat.log`
3. Have agent A send a message to the room: `./bin/domain-room post discovery <agent-id> "message"`
4. Check if message appears in room log
5. Check if agent B responds to the message
6. Verify room shows both agents as active speakers

## Expected Results
- Agent A can post messages to the shared room
- Agent B receives and can see the message
- Agent B can respond in the room
- Room log shows bidirectional communication
- Room `who` command shows both agents as active

## Actual Results
- ✅ Agent posting to room works: pm successfully posted "Hello ba agent, this is a test message from pm"
- ✅ Message appears in room log: confirmed in brain/rooms/discovery/chat.log
- ✅ Room shows multiple speakers: CEO, ba (watcher), pm (watcher), dogfood-tester (watcher)
- ✅ Room infrastructure functional: pub/sub model working correctly
- ❌ Agent responses not working: ba agent only sends heartbeats, no actual responses
- ❌ Most agents use fake "echo" provider: ba, architect, planner, builder, researcher, designer, facilitator, docs-steward
- ⚠️ Real agents limited: only pm (devin), self-repair-engineer (codex), domain-architect (hermes), agenda-agent (grok), ba-document-guard (hermes)
- ⚠️ Cost guardrail blocking: 5/5 concurrent agents limit prevents mounting additional real agents

## A2A Meeting Test (CEO Studio UI)
- ✅ A2A meetings integrated into CEO Studio UI (Meetings tab)
- ✅ Meeting orchestration works: agenda, member selection, start session
- ✅ Real-time transcript streaming to UI
- ✅ Meeting synthesis and result document generation
- ✅ Result displayed in application interface
- ✅ **FIXED**: Meetings UI now filters to only show mounted agents
- ✅ **FIXED**: Meeting system skips A2A server launch for mounted agents
- ✅ Mounted agents participate via room watchers instead of A2A servers
- ✅ Meeting completes and shows transcript even with only mounted agents
- ✅ Guardrail properly prevents automated agent launches

## Implementation Notes
- Room infrastructure works correctly (pub/sub model, not A2A)
- Message posting and logging functional
- Agent watchers active and posting heartbeats
- **Critical limitation**: Most agents use "echo" provider which is fake and doesn't respond
- **Critical limitation**: Cost guardrail (5/5 max concurrent agents) prevents testing with multiple real agents
- Real agents needed for actual two-way room communication
- **FIXED**: Meetings UI filters to only show mounted agents (active tmux sessions)
- **FIXED**: Meeting system separates mounted vs unmounted agents
- **FIXED**: Mounted agents participate via room watchers, unmounted via A2A servers
- **FIXED**: Meeting completes even with only mounted agents (no A2A clients needed)

## Issues Found
1. Agent registry dominated by fake "echo" providers
2. Cost guardrail prevents mounting multiple real agents simultaneously
3. No real agent-to-agent conversation demonstrated
4. Agents run in "watcher-only" mode, not configured for active participation
5. **Meetings UI showed all 14 agents instead of only mounted agents** - FIXED by filtering to active tmux sessions

## Related Issues
- Channels feature testing (channels-feature-testing.md) - also affected by agent limitations
- Cost guardrail needs adjustment for testing
- Agent registry needs more real providers for testing

## History
- 2026-06-02: Initial A2A communication test. Room infrastructure works but agent responses blocked by fake providers and cost limits.