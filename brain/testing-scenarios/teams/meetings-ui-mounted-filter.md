# Scenario: Meetings UI Mounted Agent Filter

**Date**: 2026-06-02
**Domain**: Teams
**Feature**: Meetings UI agent selection
**Status**: PASSING
**Last Tested**: 2026-06-02

## Purpose
Ensure the Meetings UI only shows agents that are currently mounted (have active tmux sessions), so users can only start meetings with agents that are actually running.

## Setup
1. CEO Studio running
2. Some agents mounted (e.g., ba, pm)
3. Other agents registered but not mounted

## Test Steps
1. Navigate to Teams → Meetings
2. Observe the "Or pick members" section
3. Verify only mounted agents are shown as checkboxes
4. Verify unmounted agents are not shown

## Expected Results
- Only agents with active tmux sessions appear in the member selection
- Checkbox count matches mounted agent count
- Attempting to start a meeting with mounted agents should work

## Actual Results
- ✅ UI filters to only show mounted agents (ba, pm)
- ✅ `mountedAgents()` function added to `main/core/meetings.js`
- ✅ Filters tmux sessions starting with "pipe-" to identify agent sessions
- ✅ Excludes system sessions like "agent-chat", "agent-orchestration"
- ✅ Only 2 agents shown (ba, pm) matching the 2 active tmux sessions
- ✅ Meeting system skips A2A server launch for mounted agents
- ✅ Mounted agents participate via room watchers instead
- ✅ Meeting completes and shows transcript

## Implementation Notes
- Added `mountedAgents()` function to query active tmux sessions
- Modified `options()` to filter agents list by mounted status
- Session name pattern: `pipe-{agent-id}` for agents
- System sessions excluded: agent-chat, agent-orchestration
- Meeting system separates mounted vs unmounted agents
- Mounted agents participate via room watchers, unmounted via A2A servers

## Files Modified
- `main/core/meetings.js`: Added `mountedAgents()` function, modified `options()` to filter agents
- `runtime/harness/agents/meeting.py`: Added `_is_agent_mounted()` check, modified `_member_clients()` to skip mounted agents, modified `run_meeting()` to handle mixed mounted/unmounted participants

## Related Issues
- Room-based agent communication (room-based-agent-communication.md) - A2A meetings with mounted agents

## History
- 2026-06-02: Initial implementation. Meetings UI now correctly filters to mounted agents only. Meeting system handles mounted agents via room watchers.