# Domain Team System - Agent Delegation Plan

## Overview
Break down the domain team system implementation into tasks that can be delegated to different agents using our orchestration system.

## Master Plan

### Phase 1: Domain State Machine (Devin - Architect)
**Agent:** Devin (Architect persona)
**Task:** Design and implement the domain state machine
**Brief:**
```
Design and implement the domain state machine for the domain team system.

Requirements:
- Domain states: draft, active, paused, archived, deleting
- State transitions with guards and effects
- Lock-based concurrency control
- Event-driven architecture
- Persistence layer

Deliverables:
- DomainState interface
- DomainTransition interface
- DomainStateMachine class
- Unit tests
- Integration with existing DomainConfig
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to devin-architect --message "Implement domain state machine with states: draft, active, paused, archived, deleting. Include transitions, guards, effects, and persistence."
```

---

### Phase 2: Team/Role State Machine (Specialist - Team Architect)
**Agent:** Specialist (Team Architect persona)
**Task:** Design and implement the team/role state machine
**Brief:**
```
Design and implement the team/role state machine for managing domain teams.

Requirements:
- Role states: unstaffed, understaffed, staffed, overstaffed
- Agent assignment states: assigned, active, idle, unassigning, unassigned
- Role capacity management
- Agent availability tracking
- Assignment/deassignment logic

Deliverables:
- TeamState interface
- RoleState interface
- AgentAssignment interface
- AgentAssignmentStateMachine class
- Unit tests
- Integration with existing AgentRegistry
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to specialist-team --message "Implement team/role state machine with role staffing levels and agent assignment lifecycle. Include capacity management and availability tracking."
```

---

### Phase 3: Workflow State Machine (Devin - Workflow Architect)
**Agent:** Devin (Workflow Architect persona)
**Task:** Design and implement the workflow state machine
**Brief:**
```
Design and implement the workflow state machine for executing domain workflows.

Requirements:
- Workflow states: draft, ready, running, paused, completed, failed, archived
- Phase states: pending, ready, running, waiting, completed, failed, skipped
- Phase dependencies and transitions
- Workflow execution engine
- Integration with agent orchestration

Deliverables:
- WorkflowState interface
- PhaseState interface
- WorkflowStateMachine class
- Workflow execution engine
- Unit tests
- Integration with existing orchestration
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to devin-workflow --message "Implement workflow state machine with phase-based execution. Include dependency management, phase transitions, and integration with agent orchestration."
```

---

### Phase 4: Task Lifecycle State Machine (Specialist - Task Architect)
**Agent:** Specialist (Task Architect persona)
**Task:** Design and implement the task lifecycle state machine
**Brief:**
```
Design and implement the task lifecycle state machine for task management.

Requirements:
- Task states: draft, planned, ready, assigned, in-progress, review, blocked, completed, failed, cancelled
- Automatic task breakdown
- Delegation rules and assignment
- Quality gates
- Progress tracking

Deliverables:
- TaskState interface
- SubtaskState interface
- TaskBreakdownStateMachine class
- TaskProgressStateMachine class
- Unit tests
- Integration with existing AgentLifecycleManager
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to specialist-task --message "Implement task lifecycle state machine with automatic breakdown, delegation rules, and quality gates. Include progress tracking and subtask management."
```

---

### Phase 5: Collaborative Planning State Machine (Specialist - Collaboration Architect)
**Agent:** Specialist (Collaboration Architect persona)
**Task:** Design and implement the collaborative planning state machine
**Brief:**
```
Design and implement the collaborative planning state machine for team planning sessions.

Requirements:
- Planning session states: forming, discussing, researching, deciding, planning, completed, abandoned
- Participant management
- Discussion threads
- Research task management
- Decision logging

Deliverables:
- PlanningSessionState interface
- ParticipantState interface
- DiscussionState interface
- PlanningSessionStateMachine class
- Unit tests
- Integration with existing ConversationLogger
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to specialist-collaboration --message "Implement collaborative planning state machine with session management, participant tracking, discussion threads, and research task coordination."
```

---

### Phase 6: Agent Availability State Machine (Devin - Resource Architect)
**Agent:** Devin (Resource Architect persona)
**Task:** Design and implement the agent availability state machine
**Brief:**
```
Design and implement the agent availability state machine for resource management.

Requirements:
- Availability states: available, busy, unavailable, maintenance, offline
- Schedule management
- Capacity tracking
- Utilization monitoring
- Conflict detection

Deliverables:
- AvailabilityState interface
- ScheduleState interface
- AvailabilityStateMachine class
- Unit tests
- Integration with existing AgentLifecycleManager
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to devin-resource --message "Implement agent availability state machine with schedule management, capacity tracking, and utilization monitoring. Include conflict detection and resolution."
```

---

### Phase 7: Schedule/Event State Machine (Specialist - Schedule Architect)
**Agent:** Specialist (Schedule Architect persona)
**Task:** Design and implement the schedule/event state machine
**Brief:**
```
Design and implement the schedule/event state machine for recurring agent events.

Requirements:
- Event states: scheduled, starting, in-progress, completed, cancelled, missed
- Recurring event patterns
- Event execution
- Participant availability checking
- Next occurrence scheduling

Deliverables:
- ScheduleState interface
- ScheduledEvent interface
- EventStateMachine class
- Recurring event scheduler
- Unit tests
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to specialist-schedule --message "Implement schedule/event state machine with recurring event patterns, execution management, and participant availability checking."
```

---

### Phase 8: UI Components (Devin - UI Architect)
**Agent:** Devin (UI Architect persona)
**Task:** Design and implement the UI components for domain management
**Brief:**
```
Design and implement the UI components for the domain team system.

Requirements:
- Domain Manager UI (create, edit, delete domains)
- Team Configuration UI (roles, agents, personas)
- Workflow Designer UI (phases, tasks, dependencies)
- Brief Generator UI (generate, assign briefs)
- Task Delegation UI (delegate tasks, track progress)
- Progress Dashboard UI (monitor domains, agents, tasks)

Deliverables:
- React components for each UI section
- Integration with state machines
- CMUX workspace management
- Real-time status updates
- User-friendly forms and interfaces
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to devin-ui --message "Implement UI components for domain management: Domain Manager, Team Configurator, Workflow Designer, Brief Generator, Task Delegation, and Progress Dashboard. Integrate with state machines and CMUX."
```

---

### Phase 9: System Integration (Coordinator - Integration Architect)
**Agent:** Coordinator (Integration Architect persona)
**Task:** Integrate all state machines and UI components
**Brief:**
```
Integrate all state machines and UI components into a cohesive system.

Requirements:
- Overall system state machine
- Event bus for component communication
- Lock management for concurrency
- Error handling and recovery
- Persistence and synchronization
- State consistency across components

Deliverables:
- SystemStateMachine class
- EventBus implementation
- LockManager implementation
- ErrorRecoveryStateMachine class
- StatePersistence layer
- Integration tests
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to coordinator-integration --message "Integrate all state machines and UI components. Implement system coordination, event bus, lock management, error handling, and persistence."
```

---

### Phase 10: Testing & Documentation (Specialist - QA Architect)
**Agent:** Specialist (QA Architect persona)
**Task:** Test the entire system and create documentation
**Brief:**
```
Test the entire domain team system and create comprehensive documentation.

Requirements:
- Unit tests for all state machines
- Integration tests for component interactions
- End-to-end tests for workflows
- Performance testing
- User documentation
- API documentation
- Troubleshooting guide

Deliverables:
- Test suite
- Test coverage report
- User guide
- API documentation
- Troubleshooting guide
- Example workflows
```

**Delegation:**
```bash
npm run agent-cli -- talk --from coordinator --to specialist-qa --message "Test the entire domain team system. Create unit tests, integration tests, and end-to-end tests. Write comprehensive documentation including user guide, API docs, and troubleshooting guide."
```

---

## Execution Plan

### Step 1: Start Agents in CMUX
```bash
# Start all specialist agents in CMUX
./cli/cmux-orchestrate.sh
```

### Step 2: Delegate Phase 1 (Domain State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to devin-architect --message "Implement domain state machine with states: draft, active, paused, archived, deleting. Include transitions, guards, effects, and persistence."
```

### Step 3: Delegate Phase 2 (Team/Role State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to specialist-team --message "Implement team/role state machine with role staffing levels and agent assignment lifecycle. Include capacity management and availability tracking."
```

### Step 4: Delegate Phase 3 (Workflow State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to devin-workflow --message "Implement workflow state machine with phase-based execution. Include dependency management, phase transitions, and integration with agent orchestration."
```

### Step 5: Delegate Phase 4 (Task Lifecycle State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to specialist-task --message "Implement task lifecycle state machine with automatic breakdown, delegation rules, and quality gates. Include progress tracking and subtask management."
```

### Step 6: Delegate Phase 5 (Collaborative Planning State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to specialist-collaboration --message "Implement collaborative planning state machine with session management, participant tracking, discussion threads, and research task coordination."
```

### Step 7: Delegate Phase 6 (Agent Availability State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to devin-resource --message "Implement agent availability state machine with schedule management, capacity tracking, and utilization monitoring. Include conflict detection and resolution."
```

### Step 8: Delegate Phase 7 (Schedule/Event State Machine)
```bash
npm run agent-cli -- talk --from coordinator --to specialist-schedule --message "Implement schedule/event state machine with recurring event patterns, execution management, and participant availability checking."
```

### Step 9: Delegate Phase 8 (UI Components)
```bash
npm run agent-cli -- talk --from coordinator --to devin-ui --message "Implement UI components for domain management: Domain Manager, Team Configurator, Workflow Designer, Brief Generator, Task Delegation, and Progress Dashboard. Integrate with state machines and CMUX."
```

### Step 10: Delegate Phase 9 (System Integration)
```bash
npm run agent-cli -- talk --from coordinator --to coordinator-integration --message "Integrate all state machines and UI components. Implement system coordination, event bus, lock management, error handling, and persistence."
```

### Step 11: Delegate Phase 10 (Testing & Documentation)
```bash
npm run agent-cli -- talk --from coordinator --to specialist-qa --message "Test the entire domain team system. Create unit tests, integration tests, and end-to-end tests. Write comprehensive documentation including user guide, API docs, and troubleshooting guide."
```

---

## Monitoring Progress

### Check Agent Status
```bash
npm run agent-cli -- discover
```

### Monitor Specific Agent
```bash
# Switch to CMUX workspace to see agent logs
cmux select-workspace --workspace "agent-orchestration"
```

### Get Progress Update
```bash
npm run agent-cli -- talk --from coordinator --to devin-architect --message "What's your progress on the domain state machine?"
```

---

## Coordination

The Coordinator agent will:
1. Start all agents in CMUX
2. Delegate tasks in order
3. Monitor progress
4. Handle dependencies between phases
5. Resolve conflicts
6. Ensure quality standards
7. Integrate all components

This plan uses our orchestration system to delegate the domain team system implementation to multiple specialized agents, each working on their specific component.