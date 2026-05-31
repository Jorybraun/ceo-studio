# State Machine Planning - Domain Team System

## Overview

This system has multiple interconnected state machines that need to be carefully designed to avoid race conditions, ensure consistency, and handle complex workflows.

## Part 1: Domain State Machine

### State Structure
```typescript
interface DomainState {
  domains: Map<string, Domain>;
  activeDomain: string | null;
  domainTransitions: DomainTransition[];
}

interface Domain {
  id: string;
  name: string;
  purpose: string;
  status: DomainStatus;
  config: DomainConfig;
  team: TeamState;
  workflows: WorkflowState[];
  tasks: TaskState[];
  documentation: DocumentationState;
  schedule: ScheduleState;
}

type DomainStatus = 
  | 'draft'        // Being created
  | 'active'       // Fully operational
  | 'paused'       // Temporarily suspended
  | 'archived'     // No longer active
  | 'deleting';    // Being deleted
```

### State Transitions
```typescript
interface DomainTransition {
  from: DomainStatus;
  to: DomainStatus;
  trigger: DomainTrigger;
  guard?: (domain: Domain) => boolean;
  effect: (domain: Domain) => Promise<void>;
}

const domainTransitions: DomainTransition[] = [
  {
    from: 'draft',
    to: 'active',
    trigger: 'activate',
    guard: (domain) => domain.team.roles.length > 0,
    effect: async (domain) => {
      await initializeTeam(domain);
      await setupWorkflows(domain);
      await startSchedule(domain);
    }
  },
  {
    from: 'active',
    to: 'paused',
    trigger: 'pause',
    effect: async (domain) => {
      await pauseAllTasks(domain);
      await suspendSchedule(domain);
    }
  },
  {
    from: 'paused',
    to: 'active',
    trigger: 'resume',
    effect: async (domain) => {
      await resumeTasks(domain);
      await resumeSchedule(domain);
    }
  },
  {
    from: 'active' | 'paused',
    to: 'archived',
    trigger: 'archive',
    guard: (domain) => domain.tasks.every(t => t.status === 'completed'),
    effect: async (domain) => {
      await backupDomain(domain);
      await cleanupResources(domain);
    }
  }
];
```

### Event Handling
```typescript
class DomainStateMachine {
  private state: DomainState;
  private transitionQueue: TransitionQueue;
  
  async handleEvent(event: DomainEvent): Promise<void> {
    const transition = this.findTransition(event);
    
    if (!transition) {
      throw new Error(`No transition for event: ${event.type}`);
    }
    
    if (transition.guard && !transition.guard(this.getCurrentDomain())) {
      throw new Error('Guard condition failed');
    }
    
    await this.executeTransition(transition);
  }
  
  private async executeTransition(transition: DomainTransition): Promise<void> {
    // Acquire lock for domain
    const lock = await this.acquireLock(transition.domainId);
    
    try {
      // Check state hasn't changed
      const currentDomain = this.state.domains.get(transition.domainId);
      if (currentDomain.status !== transition.from) {
        throw new Error('State changed during transition');
      }
      
      // Execute effect
      await transition.effect(currentDomain);
      
      // Update state
      currentDomain.status = transition.to;
      this.state.domains.set(transition.domainId, currentDomain);
      
      // Persist
      await this.persistState();
      
      // Emit event
      this.emit('domainStateChanged', {
        domainId: transition.domainId,
        from: transition.from,
        to: transition.to
      });
      
    } finally {
      await lock.release();
    }
  }
}
```

---

## Part 2: Team/Role State Machine

### State Structure
```typescript
interface TeamState {
  domainId: string;
  roles: Map<string, RoleState>;
  agents: Map<string, AgentAssignment>;
  availability: Map<string, AvailabilityState>;
  assignments: Map<string, TaskAssignment>;
}

interface RoleState {
  id: string;
  name: string;
  persona: string;
  status: RoleStatus;
  currentAssignments: string[];
  capacity: number;
  utilization: number;
}

type RoleStatus = 
  | 'unstaffed'    // No agent assigned
  | 'understaffed' // Not enough agents
  | 'staffed'      // Adequately staffed
  | 'overstaffed'; // Too many agents

interface AgentAssignment {
  agentId: string;
  domainId: string;
  roleId: string;
  status: AssignmentStatus;
  currentTask: string | null;
  workload: number;
}

type AssignmentStatus = 
  | 'assigned'
  | 'active'
  | 'idle'
  | 'unassigning'
  | 'unassigned';
```

### State Transitions
```typescript
interface RoleTransition {
  from: RoleStatus;
  to: RoleStatus;
  trigger: RoleTrigger;
  condition: (role: RoleState, team: TeamState) => boolean;
}

const roleTransitions: RoleTransition[] = [
  {
    from: 'unstaffed',
    to: 'understaffed',
    trigger: 'agent_assigned',
    condition: (role, team) => {
      const assignments = team.agents.filter(a => a.roleId === role.id);
      return assignments.length > 0 && assignments.length < role.capacity;
    }
  },
  {
    from: 'understaffed',
    to: 'staffed',
    trigger: 'agent_assigned',
    condition: (role, team) => {
      const assignments = team.agents.filter(a => a.roleId === role.id);
      return assignments.length >= role.capacity;
    }
  },
  {
    from: 'staffed',
    to: 'overstaffed',
    trigger: 'agent_assigned',
    condition: (role, team) => {
      const assignments = team.agents.filter(a => a.roleId === role.id);
      return assignments.length > role.capacity;
    }
  }
];
```

### Agent Assignment State Machine
```typescript
class AgentAssignmentStateMachine {
  async assignAgent(agentId: string, domainId: string, roleId: string): Promise<void> {
    // Check agent availability
    const availability = await this.checkAvailability(agentId);
    if (!availability.available) {
      throw new Error('Agent not available');
    }
    
    // Check role capacity
    const role = await this.getRole(roleId);
    const currentAssignments = await this.getRoleAssignments(roleId);
    if (currentAssignments.length >= role.capacity) {
      throw new Error('Role at capacity');
    }
    
    // Create assignment
    const assignment: AgentAssignment = {
      agentId,
      domainId,
      roleId,
      status: 'assigned',
      currentTask: null,
      workload: 0
    };
    
    // Update state
    await this.updateAssignment(assignment);
    
    // Notify agent
    await this.notifyAgent(agentId, {
      type: 'domain_assignment',
      domainId,
      roleId
    });
    
    // Update role status
    await this.updateRoleStatus(roleId);
  }
  
  async unassignAgent(agentId: string): Promise<void> {
    const assignment = await this.getAssignment(agentId);
    
    // Check if agent has active tasks
    if (assignment.currentTask) {
      // Reassign tasks or fail
      const canReassign = await this.tryReassignTasks(assignment.currentTask);
      if (!canReassign) {
        throw new Error('Agent has active tasks that cannot be reassigned');
      }
    }
    
    // Transition to unassigning
    assignment.status = 'unassigning';
    await this.updateAssignment(assignment);
    
    // Cleanup agent resources
    await this.cleanupAgentResources(agentId);
    
    // Complete unassignment
    assignment.status = 'unassigned';
    await this.updateAssignment(assignment);
    
    // Update role status
    await this.updateRoleStatus(assignment.roleId);
  }
}
```

---

## Part 3: Workflow State Machine

### State Structure
```typescript
interface WorkflowState {
  id: string;
  domainId: string;
  name: string;
  status: WorkflowStatus;
  phases: Map<string, PhaseState>;
  currentPhase: string | null;
  dependencies: DependencyGraph;
  executionHistory: WorkflowExecution[];
}

type WorkflowStatus = 
  | 'draft'        // Being designed
  | 'ready'        // Ready to execute
  | 'running'      // Currently executing
  | 'paused'       // Temporarily paused
  | 'completed'    // All phases complete
  | 'failed'       // Execution failed
  | 'archived';    // No longer used

interface PhaseState {
  id: string;
  name: string;
  status: PhaseStatus;
  tasks: Map<string, TaskState>;
  dependencies: string[];
  outputs: PhaseOutput[];
  startTime: Date | null;
  endTime: Date | null;
}

type PhaseStatus = 
  | 'pending'      // Waiting to start
  | 'ready'        // Dependencies met, ready to start
  | 'running'      // Currently executing
  | 'waiting'      // Waiting for input/decision
  | 'completed'    // Successfully completed
  | 'failed'       // Failed
  | 'skipped';     // Skipped due to condition
```

### Workflow Execution State Machine
```typescript
class WorkflowStateMachine {
  async startWorkflow(workflowId: string): Promise<void> {
    const workflow = await this.getWorkflow(workflowId);
    
    // Validate workflow is ready
    if (workflow.status !== 'ready') {
      throw new Error('Workflow not ready');
    }
    
    // Check all phases are valid
    await this.validateWorkflow(workflow);
    
    // Transition to running
    workflow.status = 'running';
    await this.updateWorkflow(workflow);
    
    // Start first phase(s)
    const startPhases = this.findStartPhases(workflow);
    for (const phaseId of startPhases) {
      await this.startPhase(phaseId);
    }
  }
  
  async startPhase(phaseId: string): Promise<void> {
    const phase = await this.getPhase(phaseId);
    
    // Check dependencies
    const dependenciesMet = await this.checkDependencies(phase);
    if (!dependenciesMet) {
      phase.status = 'pending';
      await this.updatePhase(phase);
      return;
    }
    
    // Transition to running
    phase.status = 'running';
    phase.startTime = new Date();
    await this.updatePhase(phase);
    
    // Start tasks in phase
    const tasks = await this.getPhaseTasks(phaseId);
    for (const task of tasks) {
      await this.startTask(task.id);
    }
  }
  
  async completePhase(phaseId: string): Promise<void> {
    const phase = await this.getPhase(phaseId);
    
    // Check all tasks are complete
    const tasks = await this.getPhaseTasks(phaseId);
    const allComplete = tasks.every(t => t.status === 'completed');
    
    if (!allComplete) {
      throw new Error('Not all tasks completed');
    }
    
    // Transition to completed
    phase.status = 'completed';
    phase.endTime = new Date();
    await this.updatePhase(phase);
    
    // Check if workflow is complete
    const workflow = await this.getWorkflow(phase.workflowId);
    const allPhasesComplete = await this.checkAllPhasesComplete(workflow);
    
    if (allPhasesComplete) {
      await this.completeWorkflow(workflow.id);
    } else {
      // Start dependent phases
      const dependentPhases = await this.getDependentPhases(phaseId);
      for (const depPhase of dependentPhases) {
        await this.startPhase(depPhase.id);
      }
    }
  }
}
```

---

## Part 4: Task Lifecycle State Machine

### State Structure
```typescript
interface TaskState {
  id: string;
  domainId: string;
  workflowId: string;
  phaseId: string;
  name: string;
  status: TaskStatus;
  assignee: string | null;
  subtasks: Map<string, SubtaskState>;
  dependencies: string[];
  qualityGates: QualityGate[];
  progress: number;
  timeline: TaskTimeline;
}

type TaskStatus = 
  | 'draft'        // Being created
  | 'planned'      // Planned but not started
  | 'ready'        // Ready to start
  | 'assigned'     // Assigned to agent
  | 'in-progress'  // Being worked on
  | 'review'       // Under review
  | 'blocked'      // Blocked by dependency
  | 'completed'    // Successfully completed
  | 'failed'       // Failed
  | 'cancelled';   // Cancelled

interface SubtaskState {
  id: string;
  parentTaskId: string;
  name: string;
  status: TaskStatus;
  assignee: string | null;
  estimatedDuration: number;
  actualDuration: number;
}
```

### Task Breakdown State Machine
```typescript
class TaskBreakdownStateMachine {
  async breakdownTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    
    // Check if auto-breakdown is enabled
    const domain = await this.getDomain(task.domainId);
    if (!domain.config.autoBreakdown) {
      return; // Manual breakdown only
    }
    
    // Use AI to break down task
    const subtasks = await this.generateSubtasks(task);
    
    // Create subtask states
    for (const subtask of subtasks) {
      const subtaskState: SubtaskState = {
        id: this.generateId(),
        parentTaskId: taskId,
        name: subtask.name,
        status: 'planned',
        assignee: null,
        estimatedDuration: subtask.estimatedDuration,
        actualDuration: 0
      };
      
      await this.createSubtask(subtaskState);
    }
    
    // Update task status
    task.status = 'planned';
    await this.updateTask(task);
  }
  
  async delegateSubtask(subtaskId: string): Promise<void> {
    const subtask = await this.getSubtask(subtaskId);
    const parentTask = await this.getTask(subtask.parentTaskId);
    
    // Find appropriate agent based on delegation rules
    const domain = await this.getDomain(parentTask.domainId);
    const rules = domain.config.delegationRules;
    
    const matchedRule = rules.find(rule => 
      this.taskMatchesRule(subtask, rule)
    );
    
    if (!matchedRule) {
      throw new Error('No delegation rule matched');
    }
    
    // Find available agent with required persona
    const agent = await this.findAvailableAgent(matchedRule.persona);
    
    if (!agent) {
      throw new Error('No available agent with required persona');
    }
    
    // Assign subtask
    subtask.assignee = agent.id;
    subtask.status = 'assigned';
    await this.updateSubtask(subtask);
    
    // Notify agent
    await this.notifyAgent(agent.id, {
      type: 'task_assignment',
      taskId: subtaskId,
      task: subtask
    });
  }
}
```

### Task Progress State Machine
```typescript
class TaskProgressStateMachine {
  async updateTaskProgress(taskId: string, progress: number): Promise<void> {
    const task = await this.getTask(taskId);
    
    // Validate progress
    if (progress < 0 || progress > 100) {
      throw new Error('Invalid progress value');
    }
    
    // Update progress
    task.progress = progress;
    await this.updateTask(task);
    
    // Check if task is complete
    if (progress === 100) {
      await this.completeTask(taskId);
    }
  }
  
  async completeTask(taskId: string): Promise<void> {
    const task = await this.getTask(taskId);
    
    // Check all subtasks are complete
    const subtasks = await this.getSubtasks(taskId);
    const allComplete = subtasks.every(st => st.status === 'completed');
    
    if (!allComplete) {
      throw new Error('Not all subtasks completed');
    }
    
    // Run quality gates
    const gatesPassed = await this.runQualityGates(task);
    if (!gatesPassed) {
      task.status = 'review';
      await this.updateTask(task);
      return;
    }
    
    // Transition to completed
    task.status = 'completed';
    await this.updateTask(task);
    
    // Check if phase is complete
    const phase = await this.getPhase(task.phaseId);
    await this.checkPhaseCompletion(phase.id);
  }
}
```

---

## Part 5: Collaborative Planning State Machine

### State Structure
```typescript
interface PlanningSessionState {
  id: string;
  domainId: string;
  status: PlanningStatus;
  participants: Map<string, ParticipantState>;
  discussion: DiscussionState;
  research: ResearchState;
  decisions: DecisionState[];
  workflow: PlannedWorkflowState;
  startTime: Date;
  endTime: Date | null;
}

type PlanningStatus = 
  | 'forming'      // Participants joining
  | 'discussing'   // Active discussion
  | 'researching'  // Research phase
  | 'deciding'     // Making decisions
  | 'planning'     // Creating workflow
  | 'completed'    // Planning complete
  | 'abandoned';   // Planning abandoned

interface ParticipantState {
  agentId: string;
  role: string;
  status: ParticipantStatus;
  contributions: Contribution[];
  lastActive: Date;
}

type ParticipantStatus = 
  | 'invited'
  | 'joined'
  | 'active'
  | 'idle'
  | 'left';
```

### Planning Session State Machine
```typescript
class PlanningSessionStateMachine {
  async startPlanningSession(domainId: string): Promise<string> {
    // Create session
    const session: PlanningSessionState = {
      id: this.generateId(),
      domainId,
      status: 'forming',
      participants: new Map(),
      discussion: await this.createDiscussion(),
      research: await this.createResearch(),
      decisions: [],
      workflow: null,
      startTime: new Date(),
      endTime: null
    };
    
    await this.createSession(session);
    
    // Invite participants
    const domain = await this.getDomain(domainId);
    for (const agent of domain.team.agents) {
      await this.inviteParticipant(session.id, agent.agentId);
    }
    
    return session.id;
  }
  
  async joinSession(sessionId: string, agentId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    
    // Check session is in forming state
    if (session.status !== 'forming') {
      throw new Error('Session not accepting new participants');
    }
    
    // Add participant
    const participant: ParticipantState = {
      agentId,
      role: await this.getAgentRole(agentId, session.domainId),
      status: 'joined',
      contributions: [],
      lastActive: new Date()
    };
    
    session.participants.set(agentId, participant);
    await this.updateSession(session);
    
    // Check if all participants joined
    const domain = await this.getDomain(session.domainId);
    const allJoined = domain.team.agents.every(agent =>
      session.participants.has(agent.agentId)
    );
    
    if (allJoined) {
      await this.transitionToDiscussion(sessionId);
    }
  }
  
  async transitionToDiscussion(sessionId: string): Promise<void> {
    const session = await this.getSession(sessionId);
    
    session.status = 'discussing';
    await this.updateSession(session);
    
    // Start discussion
    await this.startDiscussion(session.discussion.id);
    
    // Notify participants
    for (const [agentId] of session.participants) {
      await this.notifyAgent(agentId, {
        type: 'planning_discussion_start',
        sessionId
      });
    }
  }
}
```

---

## Part 6: Agent Availability State Machine

### State Structure
```typescript
interface AvailabilityState {
  agentId: string;
  status: AvailabilityStatus;
  currentAssignment: string | null;
  schedule: ScheduleState;
  capacity: number;
  utilization: number;
  nextAvailable: Date | null;
}

type AvailabilityStatus = 
  | 'available'    // Ready for work
  | 'busy'         // Currently working
  | 'unavailable'  // Not available (scheduled, offline, etc.)
  | 'maintenance'  // Under maintenance
  | 'offline';     // Completely offline
```

### Availability State Machine
```typescript
class AvailabilityStateMachine {
  async markAgentBusy(agentId: string, taskId: string): Promise<void> {
    const availability = await this.getAvailability(agentId);
    
    if (availability.status !== 'available') {
      throw new Error('Agent not available');
    }
    
    availability.status = 'busy';
    availability.currentAssignment = taskId;
    await this.updateAvailability(availability);
    
    // Update utilization
    await this.updateUtilization(agentId);
  }
  
  async markAgentAvailable(agentId: string): Promise<void> {
    const availability = await this.getAvailability(agentId);
    
    availability.status = 'available';
    availability.currentAssignment = null;
    await this.updateAvailability(availability);
    
    // Check for pending assignments
    const pendingAssignments = await this.getPendingAssignments(agentId);
    if (pendingAssignments.length > 0) {
      await this.assignNextTask(agentId, pendingAssignments[0]);
    }
  }
  
  async scheduleAgentUnavailable(agentId: string, startTime: Date, endTime: Date): Promise<void> {
    const availability = await this.getAvailability(agentId);
    
    // Check for conflicts
    const hasConflict = await this.checkScheduleConflict(agentId, startTime, endTime);
    if (hasConflict) {
      throw new Error('Schedule conflict');
    }
    
    // Add to schedule
    await this.addToSchedule(agentId, {
      type: 'unavailable',
      startTime,
      endTime
    });
    
    // Update next available time
    availability.nextAvailable = endTime;
    await this.updateAvailability(availability);
  }
}
```

---

## Part 7: Schedule/Event State Machine

### State Structure
```typescript
interface ScheduleState {
  domainId: string;
  events: Map<string, ScheduledEvent>;
  recurringEvents: Map<string, RecurringEvent>;
  nextEvents: Map<string, Date>;
}

interface ScheduledEvent {
  id: string;
  domainId: string;
  type: EventType;
  participants: string[];
  startTime: Date;
  endTime: Date;
  status: EventStatus;
  agenda: string[];
  notes: string;
}

type EventStatus = 
  | 'scheduled'    // Scheduled in future
  | 'starting'     // About to start
  | 'in-progress'  // Currently happening
  | 'completed'    // Finished
  | 'cancelled'    // Cancelled
  | 'missed';      // Was missed
```

### Event Execution State Machine
```typescript
class EventStateMachine {
  async startEvent(eventId: string): Promise<void> {
    const event = await this.getEvent(eventId);
    
    // Check event is scheduled
    if (event.status !== 'scheduled') {
      throw new Error('Event not in scheduled state');
    }
    
    // Check all participants are available
    const allAvailable = await this.checkParticipantAvailability(event);
    if (!allAvailable) {
      event.status = 'missed';
      await this.updateEvent(event);
      return;
    }
    
    // Transition to in-progress
    event.status = 'in-progress';
    await this.updateEvent(event);
    
    // Notify participants
    for (const participant of event.participants) {
      await this.notifyAgent(participant, {
        type: 'event_start',
        eventId,
        agenda: event.agenda
      });
    }
    
    // Mark participants as busy
    for (const participant of event.participants) {
      await this.markAgentBusy(participant, eventId);
    }
  }
  
  async completeEvent(eventId: string): Promise<void> {
    const event = await this.getEvent(eventId);
    
    event.status = 'completed';
    await this.updateEvent(event);
    
    // Mark participants as available
    for (const participant of event.participants) {
      await this.markAgentAvailable(participant);
    }
    
    // Generate next occurrence if recurring
    if (event.recurring) {
      await this.scheduleNextOccurrence(event);
    }
  }
}
```

---

## Part 8: Overall System State Machine

### State Structure
```typescript
interface SystemState {
  domains: DomainState;
  teams: TeamState;
  workflows: WorkflowState;
  tasks: TaskState;
  planning: PlanningState;
  availability: AvailabilityState;
  schedule: ScheduleState;
  ui: UIState;
}

interface UIState {
  currentView: ViewType;
  selectedDomain: string | null;
  selectedWorkflow: string | null;
  selectedTask: string | null;
  modalStack: ModalState[];
  notifications: NotificationState[];
  dragState: DragState | null;
}
```

### System Coordination
```typescript
class SystemStateMachine {
  private state: SystemState;
  private eventBus: EventBus;
  private stateLocks: Map<string, Lock>;
  
  async handleSystemEvent(event: SystemEvent): Promise<void> {
    // Determine which state machine to use
    const handler = this.getEventHandler(event.type);
    
    // Acquire appropriate locks
    const locks = await this.acquireLocks(event.locks);
    
    try {
      // Handle event
      const result = await handler(event);
      
      // Update system state
      await this.updateSystemState(result);
      
      // Emit side effects
      await this.emitSideEffects(result);
      
    } finally {
      // Release locks
      await this.releaseLocks(locks);
    }
  }
  
  private async acquireLocks(lockIds: string[]): Promise<Lock[]> {
    const locks: Lock[] = [];
    
    for (const lockId of lockIds) {
      let lock = this.stateLocks.get(lockId);
      if (!lock) {
        lock = new Lock(lockId);
        this.stateLocks.set(lockId, lock);
      }
      
      await lock.acquire();
      locks.push(lock);
    }
    
    return locks;
  }
}
```

---

## Part 9: Error Handling & Recovery

### Error State Structure
```typescript
interface ErrorState {
  errors: Map<string, ErrorRecord>;
  recoveryStrategies: Map<string, RecoveryStrategy>;
  rollbackStates: Map<string, any>;
}

interface ErrorRecord {
  id: string;
  type: ErrorType;
  component: string;
  timestamp: Date;
  state: any;
  message: string;
  stack: string;
  resolved: boolean;
  recoveryAttempted: boolean;
}

type ErrorType = 
  | 'state_transition_failed'
  | 'lock_timeout'
  | 'guard_condition_failed'
  | 'effect_execution_failed'
  | 'persistence_failed'
  | 'notification_failed';
```

### Error Recovery State Machine
```typescript
class ErrorRecoveryStateMachine {
  async handleError(error: ErrorRecord): Promise<void> {
    // Get recovery strategy
    const strategy = await this.getRecoveryStrategy(error.type);
    
    // Attempt recovery
    const recovered = await this.attemptRecovery(error, strategy);
    
    if (recovered) {
      error.resolved = true;
      await this.updateError(error);
      
      // Resume normal operation
      await this.resumeFromError(error);
    } else {
      // Mark for manual intervention
      await this.markForManualIntervention(error);
    }
  }
  
  private async attemptRecovery(error: ErrorRecord, strategy: RecoveryStrategy): Promise<boolean> {
    switch (strategy.type) {
      case 'retry':
        return await this.retryOperation(error);
      case 'rollback':
        return await this.rollbackState(error);
      case 'fallback':
        return await this.useFallback(error);
      case 'manual':
        return false; // Requires manual intervention
      default:
        return false;
    }
  }
}
```

---

## Part 10: Persistence & Synchronization

### Persistence Strategy
```typescript
class StatePersistence {
  async persistState(component: string, state: any): Promise<void> {
    // Determine persistence strategy
    const strategy = this.getPersistenceStrategy(component);
    
    switch (strategy) {
      case 'immediate':
        await this.persistImmediately(component, state);
        break;
      case 'debounced':
        await this.persistDebounced(component, state);
        break;
      case 'batched':
        await this.addToBatch(component, state);
        break;
    }
  }
  
  async syncState(component: string): Promise<void> {
    // Fetch from persistence
    const persisted = await this.fetchPersisted(component);
    
    // Merge with current state
    const merged = await this.mergeStates(component, persisted);
    
    // Update component state
    await this.updateComponentState(component, merged);
  }
}
```

---

## Implementation Priority

### Phase 1: Core State Machines (Week 1-2)
1. Domain State Machine
2. Team/Role State Machine
3. Agent Availability State Machine

### Phase 2: Workflow State Machines (Week 3-4)
4. Workflow State Machine
5. Task Lifecycle State Machine
6. Task Breakdown State Machine

### Phase 3: Collaboration State Machines (Week 5-6)
7. Collaborative Planning State Machine
8. Discussion State Machine
9. Research Task State Machine

### Phase 4: Schedule & Events (Week 7)
10. Schedule/Event State Machine
11. Recurring Event State Machine

### Phase 5: System Integration (Week 8)
12. Overall System State Machine
13. Error Handling & Recovery
14. Persistence & Synchronization

### Phase 6: UI State (Week 9)
15. UI State Machine
16. Drag & Drop State Machine
17. Notification State Machine

This comprehensive state machine planning provides a solid foundation for implementing the complex domain team system while ensuring consistency, reliability, and proper error handling.