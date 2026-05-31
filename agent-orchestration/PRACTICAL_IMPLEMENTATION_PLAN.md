# Domain Team System - Practical Implementation Plan

## Goal
Build a UI for domain team management using our existing CMUX agent orchestration (HTTP servers, CLI, panes).

## What We Use (Existing)
✅ Agent Server CLI - Starts agents as HTTP servers
✅ Agent CLI - Discovers and communicates with agents
✅ CMUX Orchestration Script - Sets up agents in panes
✅ HTTP-based communication - Agents talk via HTTP
✅ Agent discovery - Scans ports to find agents

## What We Build (UI)
❌ Domain Manager UI
❌ Team Configuration UI
❌ Workflow Designer UI
❌ Brief Generator UI
❌ Task Delegation UI
❌ Progress Dashboard UI

## Architecture

```
CEO Studio UI
    ↓
Domain Manager (NEW)
    ↓
CMUX Orchestration (EXISTING)
    ↓
Agent Servers (EXISTING)
```

## Implementation Plan

### Part 1: Domain Manager UI

**Purpose:** Create and manage domains with teams

**UI Components:**
```typescript
<DomainManager>
  <DomainList />
  <DomainCreator />
  <DomainEditor />
</DomainManager>
```

**Functionality:**
```typescript
class DomainManager {
  async createDomain(config: DomainConfig): Promise<void> {
    // 1. Save domain configuration
    await this.saveDomainConfig(config);
    
    // 2. Use our CMUX orchestration to start the team
    await this.startDomainTeam(config);
  }
  
  async startDomainTeam(config: DomainConfig): Promise<void> {
    // USE OUR EXISTING CMUX ORCHESTRATION
    const script = `
      cmux new-workspace --name "${config.name}" --cwd "${config.projectPath}"
    `;
    
    // Start each agent in the domain
    for (const role of config.team.roles) {
      const agentCmd = `
        cmux send --workspace "${config.name}" "npm run agent-server -- --type ${role.agentType} --port ${role.port} --project ${config.projectPath}"
        cmux send-key --workspace "${config.name}" Enter
      `;
      await exec(agentCmd);
    }
    
    // Create CLI pane for coordination
    await this.createCoordinationPane(config.name);
  }
  
  async getDomainStatus(domainId: string): Promise<DomainStatus> {
    // USE OUR EXISTING AGENT DISCOVERY
    const agents = await exec('npm run agent-cli -- discover');
    const domainAgents = this.filterDomainAgents(agents, domainId);
    
    return {
      domainId,
      agents: domainAgents,
      status: this.calculateStatus(domainAgents)
    };
  }
}
```

**UI Form:**
```typescript
<DomainCreator>
  <Input label="Domain Name" value={name} onChange={setName} />
  <Input label="Purpose" value={purpose} onChange={setPurpose} />
  <Input label="Project Path" value={projectPath} onChange={setProjectPath} />
  
  <TeamConfigurator>
    <RoleList>
      <RoleItem role="Designer" agentType="specialist" port={8001} />
      <RoleItem role="QA" agentType="specialist" port={8002} />
      <RoleItem role="Architect" agentType="devin" port={8003} />
      <RoleItem role="Frontend" agentType="devin" port={8004} />
      <RoleItem role="Backend" agentType="devin" port={8005} />
    </RoleList>
  </TeamConfigurator>
  
  <WorkflowSelector>
    <WorkflowOption name="PM → PLAN → ARCHITECT → ENGINEER → QA" />
    <WorkflowOption name="Custom Workflow" />
  </WorkflowSelector>
  
  <Button onClick={createDomain}>Create Domain</Button>
</DomainCreator>
```

---

### Part 2: Team Configuration UI

**Purpose:** Configure roles, agents, and personas for a domain

**UI Components:**
```typescript
<TeamConfigurator>
  <RoleManager />
  <AgentAssigner />
  <PersonaSelector />
</TeamConfigurator>
```

**Functionality:**
```typescript
class TeamConfigurator {
  async addRole(domainId: string, role: Role): Promise<void> {
    // Add role to domain configuration
    await this.addRoleToDomain(domainId, role);
    
    // USE OUR EXISTING AGENT ORCHESTRATION
    // Start agent for this role in CMUX
    await this.startAgentForRole(domainId, role);
  }
  
  async startAgentForRole(domainId: string, role: Role): Promise<void> {
    const domain = await this.getDomain(domainId);
    
    // Start agent server using our CLI
    const cmd = `
      npm run agent-server -- --type ${role.agentType} --port ${role.port} --project ${domain.projectPath}
    `;
    
    // Execute in CMUX workspace
    await exec(`cmux send --workspace "${domain.name}" "${cmd}"`);
    await exec(`cmux send-key --workspace "${domain.name}" Enter`);
  }
  
  async assignAgent(domainId: string, roleId: string, agentId: string): Promise<void> {
    // Update domain configuration
    await this.updateAgentAssignment(domainId, roleId, agentId);
    
    // USE OUR EXISTING AGENT CLI
    // Notify agent of assignment
    await exec(`npm run agent-cli -- talk --from coordinator --to ${agentId} --message "You are now ${roleId} for domain ${domainId}"`);
  }
}
```

**UI Form:**
```typescript
<RoleManager>
  <RoleList>
    {roles.map(role => (
      <RoleItem key={role.id}>
        <Input label="Role Name" value={role.name} />
        <Select label="Agent Type" value={role.agentType} options={['devin', 'specialist', 'coordinator']} />
        <Input label="Port" value={role.port} type="number" />
        <Select label="Persona" value={role.persona} options={availablePersonas} />
        <Button onClick={() => removeRole(role.id)}>Remove</Button>
      </RoleItem>
    ))}
  </RoleList>
  <Button onClick={addRole}>Add Role</Button>
</RoleManager>
```

---

### Part 3: Workflow Designer UI

**Purpose:** Design workflows with phases and task delegation

**UI Components:**
```typescript
<WorkflowDesigner>
  <PhaseEditor />
  <TaskBreakdown />
  <DependencyMapper />
</WorkflowDesigner>
```

**Functionality:**
```typescript
class WorkflowDesigner {
  async createWorkflow(domainId: string, workflow: Workflow): Promise<void> {
    // Save workflow configuration
    await this.saveWorkflow(domainId, workflow);
    
    // For each phase, configure agent communication
    for (const phase of workflow.phases) {
      await this.configurePhase(domainId, phase);
    }
  }
  
  async configurePhase(domainId: string, phase: Phase): Promise<void> {
    // USE OUR EXISTING AGENT CLI
    // Set up communication pattern for this phase
    
    for (const task of phase.tasks) {
      const assignee = await this.getAssigneeForTask(task, domainId);
      
      // Configure task delegation
      await this.configureTaskDelegation(task, assignee);
    }
  }
  
  async executeWorkflow(domainId: string, workflowId: string): Promise<void> {
    const workflow = await this.getWorkflow(domainId, workflowId);
    const domain = await this.getDomain(domainId);
    
    // Execute phases in order
    for (const phase of workflow.phases) {
      await this.executePhase(domain, phase);
      
      // Wait for phase completion
      await this.waitForPhaseCompletion(phase.id);
    }
  }
  
  async executePhase(domain: Domain, phase: Phase): Promise<void> {
    // USE OUR EXISTING AGENT CLI
    // Send tasks to appropriate agents
    
    for (const task of phase.tasks) {
      const assignee = this.getAgentForRole(task.role, domain);
      
      await exec(`npm run agent-cli -- talk --from coordinator --to ${assignee} --message "${task.description}"`);
    }
  }
}
```

**UI Form:**
```typescript
<WorkflowDesigner>
  <PhaseList>
    {phases.map((phase, index) => (
      <PhaseItem key={phase.id}>
        <Input label="Phase Name" value={phase.name} />
        <Select label="Role" value={phase.role} options={domainRoles} />
        <TaskList>
          {phase.tasks.map(task => (
            <TaskItem key={task.id}>
              <Input label="Task Name" value={task.name} />
              <Input label="Description" value={task.description} />
              <Select label="Assignee" value={task.assignee} options={roleAgents} />
              <Button onClick={() => removeTask(task.id)}>Remove</Button>
            </TaskItem>
          ))}
        </TaskList>
        <Button onClick={() => addTask(phase.id)}>Add Task</Button>
        <Button onClick={() => removePhase(phase.id)}>Remove Phase</Button>
      </PhaseItem>
    ))}
  </PhaseList>
  <Button onClick={addPhase}>Add Phase</Button>
  <Button onClick={saveWorkflow}>Save Workflow</Button>
  <Button onClick={executeWorkflow}>Execute Workflow</Button>
</WorkflowDesigner>
```

---

### Part 4: Brief Generator UI

**Purpose:** Generate briefs for domains and tasks

**UI Components:**
```typescript
<BriefGenerator>
  <DomainSelector />
  <PurposeInput />
  <WorkflowSelector />
  <BriefPreview />
  <BriefEditor />
</BriefGenerator>
```

**Functionality:**
```typescript
class BriefGenerator {
  async generateBrief(domainId: string, purpose: string): Promise<Brief> {
    const domain = await this.getDomain(domainId);
    
    // USE OUR EXISTING AGENT CLI
    // Ask specialist agent to generate brief
    const response = await exec(`npm run agent-cli -- talk --from coordinator --to ${domain.team.roles[0].agentId} --message "Generate a brief for domain with purpose: ${purpose}"`);
    
    const brief = this.parseBriefResponse(response);
    
    // Save brief
    await this.saveBrief(domainId, brief);
    
    return brief;
  }
  
  async assignBriefToDomain(domainId: string, briefId: string): Promise<void> {
    const brief = await this.getBrief(briefId);
    const domain = await this.getDomain(domainId);
    
    // USE OUR EXISTING AGENT CLI
    // Send brief to all domain agents
    for (const role of domain.team.roles) {
      await exec(`npm run agent-cli -- talk --from coordinator --to ${role.agentId} --message "Brief: ${brief.content}"`);
    }
  }
}
```

**UI Form:**
```typescript
<BriefGenerator>
  <Select label="Domain" value={selectedDomain} options={domains} onChange={setSelectedDomain} />
  <Textarea label="Purpose" value={purpose} onChange={setPurpose} placeholder="e.g., Manage social media for XYZ" />
  <Button onClick={generateBrief}>Generate Brief</Button>
  
  {brief && (
    <BriefPreview>
      <h3>{brief.title}</h3>
      <p>{brief.description}</p>
      <h4>Requirements:</h4>
      <ul>
        {brief.requirements.map(req => <li key={req}>{req}</li>)}
      </ul>
      <h4>Success Criteria:</h4>
      <ul>
        {brief.successCriteria.map(criteria => <li key={criteria}>{criteria}</li>)}
      </ul>
      <Button onClick={assignBrief}>Assign to Domain</Button>
    </BriefPreview>
  )}
</BriefGenerator>
```

---

### Part 5: Task Delegation UI

**Purpose:** Delegate tasks to agents and track progress

**UI Components:**
```typescript
<TaskDelegation>
  <TaskInput />
  <AgentSelector />
  <DelegationButton />
  <ProgressTracker />
</TaskDelegation>
```

**Functionality:**
```typescript
class TaskDelegation {
  async delegateTask(domainId: string, task: Task): Promise<void> {
    const domain = await this.getDomain(domainId);
    
    // Select appropriate agent based on task type
    const assignee = await this.selectAssignee(task, domain);
    
    // USE OUR EXISTING AGENT CLI
    await exec(`npm run agent-cli -- talk --from coordinator --to ${assignee} --message "${task.description}"`);
    
    // Track delegation
    await this.trackDelegation(task.id, assignee);
  }
  
  async trackProgress(taskId: string): Promise<TaskProgress> {
    // USE OUR EXISTING CONVERSATION LOGGER
    const logs = await this.getConversationLogs();
    const taskLogs = logs.filter(log => log.taskId === taskId);
    
    return this.calculateProgress(taskLogs);
  }
}
```

**UI Form:**
```typescript
<TaskDelegation>
  <Select label="Domain" value={selectedDomain} options={domains} onChange={setSelectedDomain} />
  <Textarea label="Task Description" value={taskDescription} onChange={setTaskDescription} />
  <Select label="Assign to Role" value={selectedRole} options={domainRoles} onChange={setSelectedRole} />
  <Button onClick={delegateTask}>Delegate Task</Button>
  
  <ProgressTracker>
    {delegatedTasks.map(task => (
      <TaskItem key={task.id}>
        <span>{task.description}</span>
        <span>Assigned to: {task.assignee}</span>
        <ProgressBar progress={task.progress} />
        <span>Status: {task.status}</span>
      </TaskItem>
    ))}
  </ProgressTracker>
</TaskDelegation>
```

---

### Part 6: Progress Dashboard UI

**Purpose:** Monitor domain, agent, and task progress

**UI Components:**
```typescript
<ProgressDashboard>
  <DomainStatus />
  <AgentStatus />
  <TaskStatus />
  <WorkflowStatus />
</ProgressDashboard>
```

**Functionality:**
```typescript
class ProgressDashboard {
  async getDomainStatus(domainId: string): Promise<DomainStatus> {
    // USE OUR EXISTING AGENT DISCOVERY
    const agents = await exec('npm run agent-cli -- discover');
    const domainAgents = this.filterDomainAgents(agents, domainId);
    
    return {
      domainId,
      agents: domainAgents,
      activeTasks: await this.getActiveTasks(domainId),
      completedTasks: await this.getCompletedTasks(domainId)
    };
  }
  
  async getAgentStatus(agentId: string): Promise<AgentStatus> {
    // USE OUR EXISTING AGENT CLI
    const health = await exec(`curl http://localhost:${this.getAgentPort(agentId)}/health`);
    
    return this.parseAgentStatus(health);
  }
}
```

**UI Display:**
```typescript
<ProgressDashboard>
  <DomainStatusCard>
    <h3>{domain.name}</h3>
    <p>Purpose: {domain.purpose}</p>
    <p>Agents: {domain.agents.length}</p>
    <p>Active Tasks: {activeTasks}</p>
    <p>Completed Tasks: {completedTasks}</p>
  </DomainStatusCard>
  
  <AgentStatusGrid>
    {domain.agents.map(agent => (
      <AgentStatusCard key={agent.id}>
        <h4>{agent.role}</h4>
        <p>Status: {agent.status}</p>
        <p>Current Task: {agent.currentTask || 'Idle'}</p>
        <p>Workload: {agent.workload}%</p>
      </AgentStatusCard>
    ))}
  </AgentStatusGrid>
  
  <TaskList>
    {tasks.map(task => (
      <TaskCard key={task.id}>
        <h4>{task.name}</h4>
        <p>Assigned to: {task.assignee}</p>
        <ProgressBar progress={task.progress} />
        <p>Status: {task.status}</p>
      </TaskCard>
    ))}
  </TaskList>
</ProgressDashboard>
```

---

## Integration with CMUX

### CMUX Workspace Management
```typescript
class CMUXIntegration {
  async createDomainWorkspace(domain: Domain): Promise<void> {
    // Create CMUX workspace for domain
    await exec(`cmux new-workspace --name "${domain.name}" --cwd "${domain.projectPath}"`);
    
    // Split into panes for each role
    let paneIndex = 0;
    for (const role of domain.team.roles) {
      if (paneIndex > 0) {
        await exec(`cmux new-split right --workspace "${domain.name}"`);
      }
      
      // Start agent in pane
      await exec(`cmux send --workspace "${domain.name}" "npm run agent-server -- --type ${role.agentType} --port ${role.port} --project ${domain.projectPath}"`);
      await exec(`cmux send-key --workspace "${domain.name}" Enter`);
      
      paneIndex++;
    }
    
    // Create coordination pane
    await exec(`cmux new-split down --workspace "${domain.name}"`);
    await exec(`cmux send --workspace "${domain.name}" "echo 'Coordination pane for ${domain.name}'"`);
    await exec(`cmux send-key --workspace "${domain.name}" Enter`);
  }
  
  async switchToDomain(domainName: string): Promise<void> {
    await exec(`cmux select-workspace --workspace "${domainName}"`);
  }
}
```

---

## Implementation Order

### Week 1: Core Domain Management
1. Domain Manager UI (create, edit, delete domains)
2. Team Configuration UI (roles, agents, personas)
3. CMUX integration (create workspaces, start agents)

### Week 2: Workflow & Briefs
4. Workflow Designer UI (phases, tasks, dependencies)
5. Brief Generator UI (generate, assign briefs)
6. Workflow execution (use agent CLI)

### Week 3: Task Management
7. Task Delegation UI (delegate tasks to agents)
8. Progress Dashboard (monitor domains, agents, tasks)
9. Task breakdown (automatic delegation)

### Week 4: Polish & Integration
10. CMUX workspace management
11. Real-time status updates
12. Error handling
13. Documentation

## Summary

This plan uses our existing CMUX agent orchestration as the foundation and builds user-friendly UI components on top. No complex state machines - just practical UI that makes it easy to:

1. Create domains with teams
2. Configure roles and agents
3. Design workflows
4. Generate briefs
5. Delegate tasks
6. Monitor progress

All using the agent servers, CLI, and CMUX orchestration we already built.