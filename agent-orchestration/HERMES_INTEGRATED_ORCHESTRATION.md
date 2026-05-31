# Hermes-Integrated Intelligent Orchestration

## Vision

An orchestration system that extends CEO Studio's Hermes-based workflow with:
1. **Domain-aware task analysis** that feeds into Hermes kanban
2. **Intelligent agent selection** using Hermes registry
3. **Automatic persona loading** from Hermes profiles
4. **Brief generation** that creates proper kanban task bodies
5. **Workflow orchestration** that coordinates Hermes workers
6. **CMUX integration** for visual agent coordination

## Architecture (Hermes-Integrated)

```
User Input (Voice/Text) → Domain Analyzer → Task Classifier → Brief Generator → Hermes Kanban
                                      ↓                    ↓                    ↓
                              Domain Config        Task Analysis        Task Creation
                                      ↓                    ↓                    ↓
                              Agent Selection      Agent Mapping        Worker Dispatch
                                      ↓                    ↓                    ↓
                              Persona Loading      Persona Config      Hermes Workers
                                      ↓                    ↓                    ↓
                              CMUX Orchestration   Visual Layout      Progress Tracking
```

## Integration Points

### 1. Domain Analyzer → Hermes Kanban
```typescript
class DomainAnalyzer {
  async analyzeProject(projectPath: string): Promise<DomainProfile> {
    // Analyze project structure
    const structure = await this.analyzeStructure(projectPath);
    
    // Identify domain type
    const domain = this.identifyDomain(structure);
    
    // Extract requirements
    const requirements = await this.extractRequirements(projectPath, domain);
    
    // Generate domain profile
    return {
      name: this.extractProjectName(projectPath),
      domain,
      structure,
      requirements,
      techStack: await this.detectTechStack(projectPath),
      workflows: this.getDomainWorkflows(domain)
    };
  }
  
  async createKanbanBoard(profile: DomainProfile): Promise<string> {
    // Create Hermes kanban board for this domain
    const boardName = `${profile.name}-${profile.domain}`;
    
    // Use Hermes CLI to create board
    const result = await exec(`hermes kanban create ${boardName}`);
    
    // Configure board with domain-specific columns
    await this.configureBoard(boardName, profile.domain);
    
    return boardName;
  }
}
```

### 2. Task Classifier → Brief Generator
```typescript
class TaskClassifier {
  async classifyTask(userInput: string, domain: DomainProfile): Promise<TaskClassification> {
    // Use Hermes CEO to classify the task
    const classification = await this.askHermesCEO(`
      Analyze this task: "${userInput}"
      Domain: ${domain.domain}
      Requirements: ${domain.requirements.join(', ')}
      
      Classify as:
      - Task type (analysis/implementation/debugging/planning/review/deployment)
      - Complexity (simple/moderate/complex)
      - Priority (low/medium/high/urgent)
      - Required agents from Hermes registry
      - Required personas from Hermes profiles
    `);
    
    return this.parseClassification(classification);
  }
  
  async generateBrief(task: Task, domain: DomainProfile): Promise<string> {
    // Generate comprehensive brief for kanban task
    const brief = `
# Task: ${task.description}

## Domain Context
- Domain: ${domain.domain}
- Project: ${domain.name}
- Tech Stack: ${domain.techStack.join(', ')}

## Requirements
${domain.requirements.map(req => `- ${req}`).join('\n')}

## Task Details
- Type: ${task.type}
- Complexity: ${task.complexity}
- Priority: ${task.priority}

## Architecture Constraints
- CEO is Hermes (openai-codex, OAuth authed)
- No API keys - use Hermes relay
- Orchestrator + workers run on codex
- Use hermes kanban for task tracking
- Provide workspace: --workspace dir:<repo>

## Success Criteria
[To be generated based on task type]

## Recommended Agents
${task.recommendedAgents.map(agent => `- ${agent}`).join('\n')}

## Recommended Personas
${task.recommendedPersonas.map(persona => `- ${persona}`).join('\n')}
    `;
    
    return brief;
  }
}
```

### 3. Agent Selector → Hermes Registry
```typescript
class AgentSelector {
  async selectAgents(task: Task, domain: DomainProfile): Promise<AgentSelection> {
    // Query Hermes registry for available agents
    const hermesAgents = await this.getHermesAgents();
    
    // Filter by domain requirements
    const domainAgents = hermesAgents.filter(agent => 
      this.agentMatchesDomain(agent, domain)
    );
    
    // Filter by task requirements
    const taskAgents = domainAgents.filter(agent =>
      this.agentMatchesTask(agent, task)
    );
    
    // Select optimal agents
    const selectedAgents = this.applySelectionLogic(taskAgents, task);
    
    // Get Hermes profiles for personas
    const personas = await this.getHermesPersonas(task, domain);
    
    return {
      agents: selectedAgents,
      personas,
      workflow: this.selectHermesWorkflow(task, domain),
      confidence: this.calculateConfidence(task, domain)
    };
  }
  
  async getHermesAgents(): Promise<HermesAgent[]> {
    // Query Hermes registry
    const result = await exec('hermes registry list');
    return this.parseHermesAgents(result);
  }
  
  async getHermesPersonas(task: Task, domain: DomainProfile): Promise<Persona[]> {
    // Get personas from Hermes profiles
    const profiles = await this.getHermesProfiles();
    
    // Filter by domain and task requirements
    return profiles.filter(profile =>
      this.profileMatchesRequirements(profile, task, domain)
    );
  }
}
```

### 4. Workflow Executor → Hermes Kanban
```typescript
class WorkflowExecutor {
  async executeWorkflow(task: Task, selection: AgentSelection): Promise<WorkflowResult> {
    // Create kanban task with generated brief
    const brief = await this.generateBrief(task, selection);
    
    // Create task in Hermes kanban
    const taskId = await this.createKanbanTask({
      title: task.description,
      body: brief,
      board: selection.board,
      workspace: this.getWorkspace(task),
      agents: selection.agents,
      personas: selection.personas
    });
    
    // Dispatch to Hermes workers
    const dispatchResult = await this.dispatchToHermes(taskId, {
      maxWorkers: this.calculateMaxWorkers(task),
      workspace: this.getWorkspace(task)
    });
    
    // Monitor progress via kanban
    const progress = await this.monitorKanbanTask(taskId);
    
    // Coordinate with CMUX for visual feedback
    await this.updateCMUXLayout(progress);
    
    return {
      taskId,
      status: progress.status,
      result: progress.result,
      agents: selection.agents,
      personas: selection.personas
    };
  }
  
  async createKanbanTask(taskConfig: TaskConfig): Promise<string> {
    const cmd = [
      'hermes',
      'kanban',
      'create',
      `--board ${taskConfig.board}`,
      `--workspace ${taskConfig.workspace}`,
      `"${taskConfig.title}"`,
      `"${taskConfig.body}"`
    ].join(' ');
    
    const result = await exec(cmd);
    return this.parseTaskId(result);
  }
  
  async dispatchToHermes(taskId: string, options: DispatchOptions): Promise<void> {
    const cmd = [
      'hermes',
      'kanban',
      'dispatch',
      taskId,
      `--max ${options.maxWorkers}`,
      `--workspace ${options.workspace}`
    ].join(' ');
    
    await exec(cmd);
  }
  
  async monitorKanbanTask(taskId: string): Promise<TaskProgress> {
    // Use hermes kanban log to monitor progress
    const cmd = `hermes kanban log ${taskId}`;
    const result = await exec(cmd);
    return this.parseProgress(result);
  }
}
```

### 5. CMUX Integration
```typescript
class CMUXOrchestrator {
  async setupAgentWorkspace(selection: AgentSelection): Promise<void> {
    // Create CMUX workspace for this orchestration
    const workspaceId = await this.createCMUXWorkspace({
      name: `orchestration-${selection.task.id}`,
      agents: selection.agents,
      domain: selection.domain
    });
    
    // Create panes for each agent
    for (const agent of selection.agents) {
      await this.createAgentPane(workspaceId, agent);
    }
    
    // Create coordination pane
    await this.createCoordinationPane(workspaceId);
    
    // Link to Hermes kanban for progress tracking
    await this.linkToKanban(workspaceId, selection.taskId);
  }
  
  async updateCMUXLayout(progress: TaskProgress): Promise<void> {
    // Update CMUX layout based on progress
    for (const agent of progress.activeAgents) {
      await this.updateAgentPane(agent.id, agent.status);
    }
    
    // Update coordination pane with overall progress
    await this.updateCoordinationPane(progress);
    
    // Trigger notifications for important events
    if (progress.status === 'completed' || progress.status === 'failed') {
      await this.triggerCMUXNotification(progress);
    }
  }
}
```

## Domain Configuration (Hermes-Integrated)

```typescript
interface HermesDomainConfig {
  name: string;
  type: DomainType;
  hermesBoard: string;
  hermesProfiles: string[];
  techStack: string[];
  workflows: HermesWorkflow[];
  agentMappings: AgentMapping[];
  personaMappings: PersonaMapping[];
}

interface HermesWorkflow {
  name: string;
  trigger: string;
  hermesSteps: HermesStep[];
  requiredProfiles: string[];
  workspaceTemplate: string;
}

interface HermesStep {
  name: string;
  hermesAgent: string;
  hermesProfile: string;
  workspace: string;
  dependencies: string[];
}
```

## Example: Web Development Domain

```typescript
const webDomain: HermesDomainConfig = {
  name: 'web-development',
  type: 'web',
  hermesBoard: 'web-dev-board',
  hermesProfiles: [
    'senior-developer',
    'ux-designer',
    'qa-specialist',
    'frontend-engineer',
    'backend-engineer'
  ],
  techStack: ['React', 'TypeScript', 'Node.js', 'PostgreSQL'],
  workflows: [
    {
      name: 'feature-development',
      trigger: 'implement new feature',
      hermesSteps: [
        {
          name: 'analyze-requirements',
          hermesAgent: 'specialist',
          hermesProfile: 'senior-developer',
          workspace: 'dir:repo',
          dependencies: []
        },
        {
          name: 'design-architecture',
          hermesAgent: 'devin',
          hermesProfile: 'senior-developer',
          workspace: 'worktree:feature-branch',
          dependencies: ['analyze-requirements']
        },
        {
          name: 'implement-feature',
          hermesAgent: 'devin',
          hermesProfile: 'frontend-engineer',
          workspace: 'worktree:feature-branch',
          dependencies: ['design-architecture']
        },
        {
          name: 'code-review',
          hermesAgent: 'specialist',
          hermesProfile: 'senior-developer',
          workspace: 'worktree:feature-branch',
          dependencies: ['implement-feature']
        }
      ],
      requiredProfiles: ['senior-developer', 'frontend-engineer'],
      workspaceTemplate: 'worktree:feature-branch'
    }
  ],
  agentMappings: [
    { task: 'analysis', agent: 'specialist' },
    { task: 'implementation', agent: 'devin' },
    { task: 'review', agent: 'specialist' }
  ],
  personaMappings: [
    { task: 'architecture', persona: 'senior-developer' },
    { task: 'frontend', persona: 'frontend-engineer' },
    { task: 'backend', persona: 'backend-engineer' }
  ]
};
```

## User Workflow

```typescript
// User provides high-level input (voice or text)
const userInput = "I need to add user authentication to my web application";

// System orchestrates automatically
const orchestrator = new HermesOrchestrator();

// 1. Analyze domain using Hermes CEO
const domain = await orchestrator.analyzeDomain(projectPath);

// 2. Classify task using Hermes CEO
const task = await orchestrator.classifyTask(userInput, domain);

// 3. Select agents from Hermes registry
const selection = await orchestrator.selectAgents(task, domain);

// 4. Generate brief with architecture constraints
const brief = await orchestrator.generateBrief(task, domain);

// 5. Create kanban task in Hermes
const taskId = await orchestrator.createKanbanTask(task, brief, selection);

// 6. Setup CMUX workspace for visual orchestration
await orchestrator.setupCMUXWorkspace(selection);

// 7. Dispatch to Hermes workers
await orchestrator.dispatchToHermes(taskId, selection);

// 8. Monitor progress and update CMUX
await orchestrator.monitorAndCoordinate(taskId);

// User gets intelligent orchestration within Hermes ecosystem
```

## Implementation Plan

1. **Domain Analyzer** - Integrate with Hermes CEO for domain analysis
2. **Task Classifier** - Use Hermes CEO for intelligent task classification
3. **Agent Selector** - Query Hermes registry for agent selection
4. **Persona Loader** - Load personas from Hermes profiles
5. **Brief Generator** - Generate kanban task bodies with architecture constraints
6. **Workflow Executor** - Execute via Hermes kanban dispatch
7. **CMUX Integration** - Visual orchestration and progress tracking
8. **Voice Integration** - Add voice input via Hermes voice commands

This keeps everything within the Hermes ecosystem while adding intelligent orchestration capabilities.