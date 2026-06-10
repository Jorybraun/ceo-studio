# Scenario: Terminal Input via Agent Surface

**Date**: 2026-06-02
**Domain**: Teams
**Feature**: Agent terminal interaction
**Status**: PASSING
**Last Tested**: 2026-06-02

## Purpose
Enable direct terminal command input to mounted agents through CEO Studio UI, allowing users to interact with agent tmux sessions without leaving the CEO Studio interface.

## Setup
1. Open CEO Studio (localhost:5173)
2. Select project: CEO_STUDIO
3. Select domain: Teams
4. Navigate to Teams → Personas
5. Select agent: pm (already mounted, tmux session: pipe-pm)

## Test Steps
1. Click on agent to open detail view
2. In right panel, ensure Terminal tab is selected
3. Click "Terminal" mode button (new toggle: Room/Terminal)
4. Input field placeholder should change to "Type terminal command to send to agent…"
5. Type command: `pwd`
6. Click Send or press Enter

## Expected Results
- Command is sent to agent's tmux session
- Terminal output refreshes to show command result
- Current working directory appears in terminal view
- No JavaScript errors in console

## Actual Results
- **Initial attempt**: Failed with JavaScript error due to variable naming conflict (`window` variable shadowing global window object)
- **After fix**: Commands can be sent to terminal via UI
- Terminal output refreshes automatically after command
- **Test command `pwd`**: Successfully executed and returned `/Users/hans/Code/AGENT/CEO_STUDIO/runtime/harness`
- Terminal shows proper Devin CLI formatting with command execution display
- No console errors after fix

## Implementation Notes
- Added mode toggle buttons (Room/Terminal) in agent surface input row
- Modified `sendAgentKeys()` to route input based on mode
- Terminal mode uses `registryTerminalSend()` backend function
- Room mode uses existing `registryMessage()` function
- Fixed variable naming: changed `window` to `tmuxWindow` to avoid shadowing global window object

## Files Modified
- `renderer/index.html`: Added Room/Terminal toggle buttons
- `renderer/app.js`: Added `agentInputMode` state, `setAgentInputMode()`, modified `sendAgentKeys()`

## Related Issues
- None currently logged

## History
- 2026-06-02: Initial implementation and testing. Fixed variable naming bug. Feature now passing.