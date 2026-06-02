# CEO Studio Testing Scenarios

This document logs testing scenarios for CEO Studio features so they can be revisited systematically without manual re-instruction.

## Scenario 1: Terminal Input via Agent Surface

**Date**: 2026-06-02  
**Feature**: Agent terminal interaction  
**Purpose**: Enable direct terminal command input to mounted agents through CEO Studio UI

### Setup
1. Open CEO Studio (localhost:5173)
2. Select project: CEO_STUDIO
3. Select domain: Teams
4. Navigate to Teams → Personas
5. Select agent: pm (already mounted, tmux session: pipe-pm)

### Test Steps
1. Click on agent to open detail view
2. In right panel, ensure Terminal tab is selected
3. Click "Terminal" mode button (new toggle: Room/Terminal)
4. Input field placeholder should change to "Type terminal command to send to agent…"
5. Type command: `ls`
6. Click Send or press Enter

### Expected Results
- Command is sent to agent's tmux session
- Terminal output refreshes to show command result
- Directory listing appears in terminal view

### Actual Results
- **Initial attempt**: Failed with JavaScript error due to variable naming conflict (`window` variable shadowing global window object)
- **After fix**: Commands can be sent to terminal via UI
- Terminal output refreshes automatically after command
- **Test command `pwd`**: Successfully executed and returned `/Users/hans/Code/AGENT/CEO_STUDIO/runtime/harness`
- Terminal shows proper Devin CLI formatting with command execution display

### Implementation Notes
- Added mode toggle buttons (Room/Terminal) in agent surface input row
- Modified `sendAgentKeys()` to route input based on mode
- Terminal mode uses `registryTerminalSend()` backend function
- Room mode uses existing `registryMessage()` function
- Fixed variable naming: changed `window` to `tmuxWindow` to avoid shadowing

### Files Modified
- `renderer/index.html`: Added Room/Terminal toggle buttons
- `renderer/app.js`: Added `agentInputMode` state, `setAgentInputMode()`, modified `sendAgentKeys()`

### Status
✅ **PASSING** - Terminal input works correctly after bug fix

---

## Scenario 2: Channels Feature Testing

**Date**: 2026-06-02  
**Feature**: Channels/Room browser  
**Purpose**: Test the channels UI and agent communication functionality

### Setup
1. Open CEO Studio
2. Select project: CEO_STUDIO
3. Navigate to Teams → Channels

### Test Steps
1. Click on "Channels" in navigation
2. Observe displayed channels (team rooms and direct messages)
3. Click on a channel (e.g., # discovery-planning)
4. Click on a direct message agent (e.g., Domain Architect)
5. Attempt to mount an agent via UI
6. Test agent communication via CLI

### Expected Results
- Channels should open live rooms in chat panel
- Agent mounting should work via UI
- Agents should respond to messages in their rooms

### Actual Results
- ❌ Channels are a UI shell - clicking does nothing
- ❌ Agent mounting fails in UI with generic error
- ❌ Agents only send heartbeats, no responses
- ❌ Room wiring not implemented

### Issues Found
1. Channels have no actual room functionality
2. Agent mounting fails: "tmux session did not start"
3. Cost guardrail blocks mounting (5/5 concurrent agents)
4. Agents run in watcher-only mode, don't respond to messages
5. Even CLI-mounted agents don't respond (echo providers are fake)

### Status
❌ **FAILING** - Channels feature is non-functional UI shell

### Documentation
- Full test log: `domains/teams/channels-testing-log.md`

---

## Testing Template

Use this template for new testing scenarios:

```markdown
## Scenario [N]: [Feature Name]

**Date**: [YYYY-MM-DD]  
**Feature**: [Feature description]  
**Purpose**: [Why this test exists]

### Setup
1. [Step 1]
2. [Step 2]
...

### Test Steps
1. [Step 1]
2. [Step 2]
...

### Expected Results
- [Expected outcome 1]
- [Expected outcome 2]
...

### Actual Results
- [Actual outcome 1]
- [Actual outcome 2]
...

### Implementation Notes
- [Any implementation details or fixes]
- [Files modified]
- [Technical observations]

### Status
✅ PASSING / ❌ FAILING / ⚠️ PARTIAL

### Documentation
- [Links to related docs or logs]
```

---

## Testing Protocol

When adding new testing scenarios:

1. Use the template above
2. Include specific, reproducible steps
3. Document both expected and actual results
4. Note any implementation changes made
5. Link to related documentation
6. Mark status clearly (PASSING/FAILING/PARTIAL)
4. Update this file in the same commit as any code changes