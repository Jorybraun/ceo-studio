# Domain-Based Team System Design

## Core Concepts

### Domain = Team
A domain is a team with:
- **Purpose/Goal** - What they're responsible for
- **Roles** - Designer, QA, Architect, Frontend, Backend, PM
- **Workflows** - How they work together
- **Briefs** - Domain-specific task definitions
- **Documentation** - Living requirements and docs
- **Schedule** - Recurring agent events

## Domain Configuration

```typescript
interface Domain {
  id: string;
  name: string;
  purpose: string; // "Manage social media for XYZ"
  type: DomainType;
  
  // Team Structure
  roles: DomainRole[];
  agents: DomainAgent[];
  
  // Workflows
  workflows: DomainWorkflow[];
  taskLifecycle: TaskLifecycle;
  
  // Documentation
  requirements: DomainRequirements;
  documentation: LivingDocumentation;
  
  // Scheduling
  schedule: RecurringSchedule[];
  
  // Briefs
  briefs: DomainBrief[];
  
  // State
  state: DomainState;
}

interface DomainRole {
  id: string;
  name: string; // "Designer", "QA", "Architect"
  persona: string; // Reference to persona system
  capabilities: string[];
  responsibilities: string[];
}

interface DomainAgent {
  id: string;
  agentId: string; // Reference to agent registry
  role: string; // Role in this domain
  persona: string; // Specific persona for this domain
  availability: Availability;
}

interface DomainWorkflow {
  id: string;
  name: string;
  description: string;
  phases: WorkflowPhase[];
  triggers: WorkflowTrigger[];
}

interface WorkflowPhase {
  id: string;
  name: string; // "PM", "PLAN", "ARCHITECT", "ENGINEER", "QA"
  role: string; // Which role handles this phase
  tasks: PhaseTask[];
  dependencies: string[]; // Dependencies on other phases
  outputs: string[]; // What this phase produces
}

interface PhaseTask {
  id: string;
  name: string;
  description: string;
  assignee: string; // Specific agent or role
  estimatedDuration: number;
  acceptanceCriteria: string[];
}
```

## Task Lifecycle

```typescript
interface TaskLifecycle {
  phases: LifecyclePhase[];
  transitions: PhaseTransition[];
  autoBreakdown: boolean; // Automatically break down into small tasks
  delegationRules: DelegationRule[];
}

interface LifecyclePhase {
  id: string;
  name: string;
  order: number;
  role: string;
  requiredInputs: string[];
  outputs: string[];
  qualityGates: QualityGate[];
}

interface PhaseTransition {
  from: string;
  to: string;
  condition: string;
  autoTransition: boolean;
}

interface DelegationRule {
  taskType: string;
  persona: string;
  criteria: string;
}
```

## Domain Purpose & Brief Generation

```typescript
interface DomainPurpose {
  statement: string; // "Manage social media for XYZ"
  objectives: string[];
  kpis: string[];
  constraints: string[];
}

interface DomainBrief {
  id: string;
  title: string;
  description: string;
  domain: string;
  workflow: string;
  phases: BriefPhase[];
  requirements: string[];
  successCriteria: string[];
  timeline: Timeline;
}

interface BriefPhase {
  phase: string;
  role: string;
  tasks: BriefTask[];
  deliverables: string[];
}
```

## Collaborative Planning System

```typescript
interface TeamPlanning {
  id: string;
  domain: string;
  participants: PlanningParticipant[];
  discussion: DiscussionThread[];
  researchTasks: ResearchTask[];
  decisions: PlanningDecision[];
  workflow: PlannedWorkflow;
}

interface PlanningParticipant {
  agentId: string;
  role: string;
  contributions: Contribution[];
}

interface DiscussionThread {
  id: string;
  topic: string;
  messages: DiscussionMessage[];
  participants: string[];
  status: 'active' | 'resolved' | 'deferred';
}

interface ResearchTask {
  id: string;
  topic: string;
  assignedTo: string;
  status: 'pending' | 'in-progress' | 'completed';
  findings: ResearchFinding[];
}

interface PlannedWorkflow {
  phases: PlannedPhase[];
  dependencies: DependencyGraph;
  timeline: GanttChart;
}
```

## Flow Chart Visualization

```typescript
interface WorkflowVisualization {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  layout: FlowLayout;
}

interface WorkflowNode {
  id: string;
  type: 'agent' | 'task' | 'decision' | 'milestone';
  label: string;
  agent?: string;
  role?: string;
  status: NodeStatus;
  position: Position;
}

interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  condition?: string;
  type: 'dependency' | 'flow' | 'communication';
}

interface NodeStatus {
  state: 'pending' | 'in-progress' | 'completed' | 'blocked';
  progress: number;
  assignee?: string;
}
```

## Recurring Agent Events

```typescript
interface RecurringSchedule {
  id: string;
  domain: string;
  agent: string;
  eventType: 'standup' | 'review' | 'planning' | 'maintenance';
  schedule: SchedulePattern;
  participants: string[];
  agenda: string[];
}

interface SchedulePattern {
  frequency: 'daily' | 'weekly' | 'monthly';
  days: number[]; // Days of week
  time: string; // HH:MM
  timezone: string;
}
```

## UI Components Needed

### 1. Domain Management UI
```typescript
<DomainManager>
  <DomainList />
  <DomainCreator />
  <DomainEditor />
  <DomainDeleter />
</DomainManager>
```

### 2. Team Configuration UI
```typescript
<TeamConfigurator>
  <RoleManager />
  <AgentAssigner />
  <PersonaSelector />
  <AvailabilityManager />
</TeamConfigurator>
```

### 3. Workflow Designer UI
```typescript
<WorkflowDesigner>
  <PhaseEditor />
  <TaskBreakdown />
  <DependencyMapper />
  <RoleAssigner />
</WorkflowDesigner>
```

### 4. Brief Generator UI
```typescript
<BriefGenerator>
  <DomainSelector />
  <PurposeInput />
  <WorkflowSelector />
  <BriefPreview />
  <BriefEditor />
</BriefGenerator>
```

### 5. Collaborative Planning UI
```typescript
<TeamPlanning>
  <DiscussionBoard />
  <ResearchTracker />
  <DecisionLog />
  <ParticipantList />
</TeamPlanning>
```

### 6. Flow Chart Visualization UI
```typescript
<WorkflowVisualizer>
  <FlowChart />
  <NodeEditor />
  <EdgeEditor />
  <StatusOverlay />
  <DragDropInterface />
</WorkflowVisualizer>
```

### 7. Task Lifecycle UI
```typescript
<TaskLifecycleManager>
  <PhaseTracker />
  <TaskBreakdown />
  <DelegationView />
  <QualityGates />
</TaskLifecycleManager>
```

### 8. Schedule Manager UI
```typescript
<ScheduleManager>
  <RecurringEventCreator />
  <CalendarView />
  <AgentAvailability />
  <EventHistory />
</ScheduleManager>
```

## Example: Social Media Domain

```typescript
const socialMediaDomain: Domain = {
  id: 'social-media-xyz',
  name: 'Social Media - XYZ',
  purpose: 'Manage social media presence for XYZ company',
  type: 'marketing',
  
  roles: [
    {
      id: 'social-media-manager',
      name: 'Social Media Manager',
      persona: 'marketing-specialist',
      capabilities: ['content-creation', 'analytics', 'community-management'],
      responsibilities: ['Content strategy', 'Posting schedule', 'Engagement']
    },
    {
      id: 'content-designer',
      name: 'Content Designer',
      persona: 'graphic-designer',
      capabilities: ['visual-design', 'brand-consistency', 'asset-creation'],
      responsibilities: ['Visual content', 'Brand assets', 'Creative direction']
    },
    {
      id: 'content-writer',
      name: 'Content Writer',
      persona: 'copywriter',
      capabilities: ['copywriting', 'storytelling', 'seo-writing'],
      responsibilities: ['Copy creation', 'Blog posts', 'Captions']
    }
  ],
  
  agents: [
    {
      agentId: 'specialist-1',
      role: 'social-media-manager',
      persona: 'marketing-specialist',
      availability: 'full-time'
    },
    {
      agentId: 'specialist-2',
      role: 'content-designer',
      persona: 'graphic-designer',
      availability: 'part-time'
    }
  ],
  
  workflows: [
    {
      id: 'content-creation',
      name: 'Content Creation Workflow',
      phases: [
        {
          id: 'planning',
          name: 'Content Planning',
          role: 'social-media-manager',
          tasks: [
            {
              name: 'Review content calendar',
              assignee: 'social-media-manager',
              estimatedDuration: 30
            },
            {
              name: 'Identify content themes',
              assignee: 'social-media-manager',
              estimatedDuration: 60
            }
          ]
        },
        {
          id: 'creation',
          name: 'Content Creation',
          role: 'content-writer',
          tasks: [
            {
              name: 'Write blog post',
              assignee: 'content-writer',
              estimatedDuration: 120
            },
            {
              name: 'Create social copy',
              assignee: 'content-writer',
              estimatedDuration: 60
            }
          ]
        },
        {
          id: 'design',
          name: 'Visual Design',
          role: 'content-designer',
          tasks: [
            {
              name: 'Create graphics',
              assignee: 'content-designer',
              estimatedDuration: 90
            },
            {
              name: 'Review brand consistency',
              assignee: 'content-designer',
              estimatedDuration: 30
            }
          ]
        },
        {
          id: 'review',
          name: 'Content Review',
          role: 'social-media-manager',
          tasks: [
            {
              name: 'Review all content',
              assignee: 'social-media-manager',
              estimatedDuration: 45
            },
            {
              name: 'Approve for publishing',
              assignee: 'social-media-manager',
              estimatedDuration: 15
            }
          ]
        }
      ]
    }
  ],
  
  taskLifecycle: {
    phases: [
      { id: 'pm', name: 'PM', role: 'social-media-manager', order: 1 },
      { id: 'plan', name: 'PLAN', role: 'social-media-manager', order: 2 },
      { id: 'create', name: 'CREATE', role: 'content-writer', order: 3 },
      { id: 'design', name: 'DESIGN', role: 'content-designer', order: 4 },
      { id: 'review', name: 'REVIEW', role: 'social-media-manager', order: 5 }
    ],
    autoBreakdown: true,
    delegationRules: [
      { taskType: 'writing', persona: 'copywriter' },
      { taskType: 'design', persona: 'graphic-designer' }
    ]
  },
  
  schedule: [
    {
      id: 'daily-standup',
      domain: 'social-media-xyz',
      agent: 'specialist-1',
      eventType: 'standup',
      schedule: {
        frequency: 'daily',
        days: [1, 2, 3, 4, 5],
        time: '09:00',
        timezone: 'America/New_York'
      },
      participants: ['specialist-1', 'specialist-2'],
      agenda: ['Review yesterday', 'Plan today', 'Blockers']
    }
  ]
};
```

## Implementation Plan

### Phase 1: Domain System
1. Enhanced DomainConfig with team structure
2. Role and persona management
3. Agent assignment to domains
4. Domain purpose and brief generation

### Phase 2: Workflow System
1. Workflow designer UI
2. Phase and task breakdown
3. Dependency mapping
4. Auto-delegation rules

### Phase 3: Collaborative Planning
1. Discussion system for team planning
2. Research task management
3. Decision logging
4. Multi-agent planning sessions

### Phase 4: Visualization
1. Flow chart UI with drag-drop
2. Real-time status updates
3. Work state visualization
4. Interactive workflow planning

### Phase 5: Task Lifecycle
1. Phase tracking
2. Automatic task breakdown
3. Quality gates
4. Progress tracking

### Phase 6: Scheduling
1. Recurring event system
2. Calendar integration
3. Agent availability
4. Event automation

This provides a comprehensive domain-based team system with all the features you described!