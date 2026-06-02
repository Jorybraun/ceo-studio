name: ceo-studio-dogfood
description: "CEO Studio planning features dogfood testing - regression tests, planning workflow, lane behavior, usability"
version: 1.0.0
platforms: [linux, macos, windows]
metadata:
  hermes:
    tags: [qa, testing, ceo-studio, planning, dogfood]
    related_skills: [dogfood]


CEO Studio Dogfood: Planning Features Testing

Overview

This skill guides you through systematic testing of CEO Studio's planning capabilities (briefs, tasks, goals, decomposition, lane behavior, usability). It builds on the general dogfood skill but is specifically tailored for CEO Studio's architecture and testing requirements.

Prerequisites

- CEO Studio running in debug mode (npm run start:debug)
- Chrome DevTools MCP server available
- Hermes gateway started
- CEO_STUDIO project available in project switcher

Inputs

The user provides:
1. Testing scope - which areas to focus on (regression tests, planning workflow, lane behavior, usability, or "full" for comprehensive testing)
2. Output directory (optional) - where to save screenshots and report (default: ./dogfood-output)

Workflow

Follow this systematic workflow based on the CEO Studio Comprehensive Testing Plan:

Phase 1: Setup & Regression Tests

1. Create output directory structure:
   {output_dir}/
   ├── screenshots/
   └── report.md

2. Verify CEO Studio is running:
   - Check that CEO Studio is accessible on localhost:5173
   - Verify CEO status shows "online"

3. Execute Priority 1 Regression Tests:
   - CEO Agent Mount: Verify CEO agent mounts successfully and responds to messages
   - BUG Lane Dispatch: Test that bug tasks can be created and dispatched
   - Task Creation without project selection: Test that New Task works without manual project selection
   - Ready Button DB update: Test that Ready button actually changes Hermes DB status

Phase 2: Core Planning Workflow

1. Brief Creation Test:
   - Navigate to Board
   - Click "+" → "New task"
   - Fill in all required sections (Goal, Board, Domain, Current State, Problem, Constraints, Acceptance Criteria, Next Action, Owner)
   - Submit and verify brief appears in board
   - Verify brief is written to Hermes Kanban DB using `hermes kanban show <task_id>`
   - Verify brief is recorded in project brain

2. Task Decomposition Test:
   - Select a brief in Planning/Triage lane
   - Click "Decompose" button
   - Verify child tasks are created
   - Verify child tasks reference the parent brief
   - Verify child tasks have assignees
   - Verify child tasks appear in TODO lane
   - Use `hermes kanban show` to verify task relationships

3. Goal Alignment Test:
   - Check that goal alignment section is visible in task planning view
   - Verify infrastructure is in place for goal linking
   - Test link_work_to_goal tool if available

Phase 3: Lane & Workflow Semantics

1. Lane Behavior Test:
   - Verify all lanes are visible: Triage → Planning → TODO → Ready → Running → Blocked → Review → Done
   - Test that items move correctly between lanes
   - Test that BUG lane is owned by self-repair team
   - Verify lane routing via orchestration-org

2. Blocked Escalation Test:
   - Move a task to Blocked lane
   - Check if blocker analysis is triggered
   - Verify comments are written to the task
   - Check escalation target is chosen

Phase 4: Usability Testing

1. Task Creation Usability:
   - Verify form is clear about required fields
   - Check that it auto-selects the current project
   - Verify required sections (acceptance criteria, etc.) are obvious

2. Board Navigation:
   - Verify users can easily find tasks
   - Check that lane labels are clear
   - Verify difference between Triage/Planning/TODO is obvious

3. Agent Interaction:
   - Verify user can mount an agent
   - Verify user can send messages to an agent
   - Check that agent responses are visible

Phase 5: Documentation Verification

1. Run npm run docs:check:
   - All checks should pass
   - Verify AGENTS.md has Hermes CEO rule
   - Verify README points to autonomy docs
   - Verify docs-steward is registered

Phase 6: Report Generation

Generate the final report including:
1. Executive summary with test results (pass/fail per scenario)
2. Regression test results
3. Planning workflow test results
4. Lane behavior test results
5. Usability findings
6. Documentation check results
7. Any bugs found with severity and category
8. Screenshots of key steps
9. Testing notes and recommendations

Save the report to {output_dir}/report.md.

Phase 7: Testing Scenario Database Management

Maintain a structured database of testing scenarios in the CEO Studio brain for systematic regression testing:

1. Scenario Storage Structure:
   - brain/testing-scenarios/
     - index.md (registry of all scenarios across domains)
     - {domain}/
       - {scenario-name}.md (individual scenario documentation)

2. Automatic Directory Creation:
   - If brain/testing-scenarios/ does not exist, create it
   - If brain/testing-scenarios/index.md does not exist, create it with the registry template
   - If brain/testing-scenarios/{domain}/ does not exist, create it
   - If brain/testing-scenarios/{domain}/{scenario}.md does not exist, create it using the template

3. Scenario Registration:
   - Every new testing scenario must be registered in brain/testing-scenarios/index.md
   - Include: scenario name, domain, date, status, related features
   - Use the template format for consistency
   - Update the scenario count and status summary in index.md

4. Scenario Documentation Template:
   ```markdown
   # Scenario: {Scenario Name}

   **Date**: {YYYY-MM-DD}
   **Domain**: {domain-name}
   **Feature**: {feature description}
   **Status**: PASSING | FAILING | PARTIAL
   **Last Tested**: {YYYY-MM-DD}

   ## Purpose
   {Why this test exists}

   ## Setup
   1. {Step 1}
   2. {Step 2}

   ## Test Steps
   1. {Step 1}
   2. {Step 2}

   ## Expected Results
   - {Expected outcome 1}
   - {Expected outcome 2}

   ## Actual Results
   - {Actual outcome 1}
   - {Actual outcome 2}

   ## Implementation Notes
   - {Any implementation details or fixes}
   - {Files modified}
   - {Technical observations}

   ## Related Issues
   - {Links to related Kanban tasks or issues}

   ## History
   - {YYYY-MM-DD}: {Change description}
   ```

5. Index Registry Template (for automatic creation):
   ```markdown
   # CEO Studio Testing Scenarios Registry

   This registry tracks all testing scenarios across domains for systematic regression testing.

   ## Scenario Index

   | Scenario Name | Domain | Feature | Status | Last Tested | Location |
   |--------------|--------|---------|--------|-------------|----------|
   (scenarios will be added here)

   ## Domain Directories

   - **teams/** - Teams domain testing scenarios
   - **domain-lifecycle/** - Domain Lifecycle testing scenarios
   - **planning/** - Planning workflow testing scenarios

   ## Cross-Domain Scenarios

   Some scenarios span multiple domains. These are registered with multiple domain tags:

   | Scenario Name | Domains | Primary Location |
   |--------------|---------|------------------|
   (none yet) | - | -

   ## Scenario Status Legend

   - **PASSING** - All expected results achieved
   - **FAILING** - Critical failures preventing feature use
   - **PARTIAL** - Some functionality works but has issues

   ## Regression Testing Protocol

   Before testing any feature:

   1. Check this registry for existing scenarios in the relevant domain
   2. Re-run existing scenarios to verify no regressions
   3. Update scenario status and last-tested date
   4. Add new findings to scenario documentation
   5. Register new scenarios in this index

   ## Adding New Scenarios

   When creating a new testing scenario:

   1. Create scenario file in appropriate domain directory using the template
   2. Register scenario in this index with all required fields
   3. If scenario spans multiple domains, add to Cross-Domain Scenarios section
   4. Update the scenario count and status summary

   ---

   **Last Updated**: {YYYY-MM-DD}
   **Total Scenarios**: 0
   **Passing**: 0
   **Failing**: 0
   **Partial**: 0
   ```

6. Scenario Retrieval for Regression:
   - Before testing a feature, check brain/testing-scenarios/{domain}/ for existing scenarios
   - Re-run existing scenarios to verify no regressions
   - Update scenario status and last-tested date
   - Add new findings to the scenario documentation

7. Cross-Domain Scenario Tracking:
   - Some scenarios span multiple domains (e.g., agent mounting affects Teams, Domain Lifecycle, etc.)
   - Register these in index.md with multiple domain tags
   - Link to the primary scenario file from secondary domain directories

Phase 8: Log Results to Kanban

Create a task in the ceo-studio kanban board with the test results:
- Use `hermes kanban create` to log findings
- Include pass/fail status for all tests
- Document any bugs found
- Set appropriate priority based on findings
- Reference testing scenarios from brain/testing-scenarios/

Tools Reference

Use Chrome DevTools MCP server tools:
- take_snapshot: Get DOM structure for element interaction
- click: Click buttons and links
- fill_form: Fill out form elements efficiently
- evaluate_script: Run JavaScript for verification
- list_console_messages: Check for JavaScript errors
- list_network_requests: Monitor API calls

Use Hermes CLI tools:
- hermes kanban show: Verify task state in DB
- hermes kanban create: Log test results
- hermes kanban boards list: Check board state
- hermes kanban decompose: Test decomposition (if needed via CLI)

Use project tools:
- npm run docs:check: Verify documentation
- npm run check: Run project checks

Tips

- Always check console messages after navigation and interactions
- Use fill_form instead of multiple fill calls for better reliability
- Verify both UI state and backend DB state for critical operations
- Test with both valid and invalid inputs
- Take screenshots of key states for evidence
- Log all findings to the kanban board for tracking
- Distinguish between UI issues and backend issues
- Note any usability concerns even if functionality works
- **When creating testing scenarios**: Always check if brain/testing-scenarios/ exists first. If not, create the entire structure (index.md, domain directories, scenario files) using the templates provided in Phase 7

CEO Studio Specific Notes

- The CEO is the Hermes agent, not a raw API model
- CEO Studio uses Hermes Kanban for task management
- Planning follows the brief → task → goal hierarchy
- BUG lane is owned by self-repair team
- Documentation handoff is mandatory for any changes
- Use the NullProvider for testing when no real provider is configured
- The board of record is `hermes kanban` (SQLite at ~/.hermes/kanban/boards/<slug>/)
- Main project board is `ceo-studio`

Success Criteria

A test pass is successful when:
- All 4 regression bugs are verified as fixed (or working)
- Brief creation works end-to-end (UI → DB → brain)
- Task decomposition produces valid child tasks
- Goal linking infrastructure is in place
- Lane routing follows orchestration-org rules
- npm run docs:check passes
- Usability issues are documented (even if not fixed)
- Results are logged to the kanban board
- Final report is generated with all findings
