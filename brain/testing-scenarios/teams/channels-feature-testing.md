# Scenario: Channels Feature Testing

**Date**: 2026-06-02
**Domain**: Teams
**Feature**: Channels/Room browser
**Status**: FAILING
**Last Tested**: 2026-06-02

## Purpose
Test the channels UI and agent communication functionality to verify that users can navigate to rooms and communicate with agents through the CEO Studio interface.

## Setup
1. Open CEO Studio
2. Select project: CEO_STUDIO
3. Navigate to Teams → Channels

## Test Steps
1. Click on "Channels" in navigation
2. Observe displayed channels (team rooms and direct messages)
3. Click on a channel (e.g., # discovery-planning)
4. Click on a direct message agent (e.g., Domain Architect)
5. Attempt to mount an agent via UI
6. Test agent communication via CLI

## Expected Results
- Channels should open live rooms in chat panel
- Agent mounting should work via UI
- Agents should respond to messages in their rooms
- Room wiring should connect UI to actual room functionality

## Actual Results
- ❌ Channels are a UI shell - clicking does nothing
- ❌ Agent mounting fails in UI with generic error
- ❌ Agents only send heartbeats, no responses
- ❌ Room wiring not implemented
- UI explicitly states: "Channels will open a live room in the chat panel on the right. (Room wiring is the next step.)"

## Issues Found
1. Channels have no actual room functionality - they are a static list
2. Agent mounting fails: "tmux session did not start (see output)"
3. Cost guardrail blocks mounting (5/5 concurrent agents)
4. Agents run in watcher-only mode, don't respond to messages
5. Even CLI-mounted agents don't respond (echo providers are fake)
6. No error visibility - generic messages without debugging info

## Implementation Notes
- Channels UI exists but lacks core functionality
- No room wiring implementation
- Agent mounting via UI is broken
- Most agents use "echo" provider (fake, no brain)
- Real agents (devin, hermes) run as watchers, not conversational participants

## Files Modified
- None (feature not implemented)

## Related Issues
- Full test log: `domains/teams/channels-testing-log.md`
- Feature marked as incomplete in UI

## History
- 2026-06-02: Initial testing revealed feature is non-functional UI shell. Critical issues documented.