# Orchestrator Interface Layer

## Ways to Talk to the Orchestrator

### 1. Conversational CLI (Recommended)
A natural language interface where you just type/speak what you want.

```bash
# Start the orchestrator conversation interface
npm run orchestrator chat

# Examples:
> "Analyze my web project and suggest improvements"
> "Add user authentication to my app"
> "Review the code in the authentication module"
> "Deploy this to production"
> "Create a brief for the new feature"
```

### 2. Voice Input (Hermes-Integrated)
Use Hermes voice for hands-free interaction.

```bash
# Start voice-enabled orchestrator
npm run orchestrator voice

# Speak commands:
"Hey orchestrator, analyze my project"
"Orchestrator, add authentication to my app"
"Review the code in the auth module"
```

### 3. CMUX Skill
Use the CMUX skill we created for seamless integration.

```bash
# In CMUX, invoke the skill
Use $cmux-agent-orchestration to analyze my project

# Or use the skill directly
cmux orchestrate "analyze my web project"
```

### 4. Direct Commands
Specific commands for precise control.

```bash
# Domain analysis
npm run orchestrator analyze --project /path/to/project

# Task execution
npm run orchestrator execute --task "add authentication" --project /path/to/project

# Brief generation
npm run orchestrator brief --task "new feature" --project /path/to/project

# Agent coordination
npm run orchestrator coordinate --agents devin,specialist --task "code review"
```

### 5. HTTP API
REST API for programmatic access.

```bash
# Start the orchestrator API server
npm run orchestrator api

# Make requests
curl -X POST http://localhost:9000/api/orchestrate \
  -H "Content-Type: application/json" \
  -d '{
    "task": "add authentication",
    "project": "/path/to/project",
    "mode": "automatic"
  }'
```

## Implementation

### Conversational Interface

```typescript
// cli/orchestrator-chat.ts
class OrchestratorChat {
  private orchestrator: AgentOrchestrator;
  
  async start(): Promise<void> {
    console.log('🎯 Orchestrator Chat Interface');
    console.log('Type your requests naturally, or "exit" to quit\n');
    
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    while (true) {
      const input = await this.prompt('> ');
      
      if (input.toLowerCase() === 'exit') {
        break;
      }
      
      await this.processInput(input);
    }
    
    rl.close();
  }
  
  private async processInput(input: string): Promise<void> {
    console.log(`\n🤔 Processing: "${input}"`);
    
    // Use Hermes CEO if available for intelligent parsing
    const intent = await this.parseIntent(input);
    
    switch (intent.type) {
      case 'analyze':
        await this.handleAnalysis(intent);
        break;
      case 'execute':
        await this.handleExecution(intent);
        break;
      case 'brief':
        await this.handleBrief(intent);
        break;
      case 'coordinate':
        await this.handleCoordination(intent);
        break;
      default:
        await this.handleGeneral(input);
    }
  }
  
  private async parseIntent(input: string): Promise<Intent> {
    // Use Hermes CEO for intelligent intent parsing
    if (this.hermesAvailable) {
      return await this.parseWithHermes(input);
    }
    
    // Fallback to basic pattern matching
    return this.parseBasic(input);
  }
  
  private async handleAnalysis(intent: AnalysisIntent): Promise<void> {
    console.log('🔍 Analyzing project...');
    
    const domain = await this.orchestrator.analyzeDomain(intent.project);
    const analysis = await this.orchestrator.analyzeProject(intent.project);
    
    console.log('\n📊 Analysis Results:');
    console.log(`Domain: ${domain.name}`);
    console.log(`Type: ${domain.type}`);
    console.log(`Tech Stack: ${domain.techStack.join(', ')}`);
    console.log(`\nKey Findings:`);
    analysis.findings.forEach(finding => {
      console.log(`  - ${finding}`);
    });
  }
  
  private async handleExecution(intent: ExecutionIntent): Promise<void> {
    console.log('⚡ Executing task...');
    
    const result = await this.orchestrator.orchestrateTask(intent);
    
    console.log('\n✅ Execution Results:');
    console.log(`Status: ${result.status}`);
    console.log(`Agents used: ${result.agents.join(', ')}`);
    console.log(`Duration: ${result.duration}ms`);
    
    if (result.output) {
      console.log(`\nOutput:\n${result.output}`);
    }
  }
  
  private async handleBrief(intent: BriefIntent): Promise<void> {
    console.log('📝 Generating brief...');
    
    const brief = await this.orchestrator.generateBrief(intent);
    
    console.log('\n📋 Generated Brief:');
    console.log(brief);
  }
  
  private async handleCoordination(intent: CoordinationIntent): Promise<void> {
    console.log('🤝 Coordinating agents...');
    
    const result = await this.orchestrator.coordinateAgents(intent);
    
    console.log('\n🔄 Coordination Results:');
    console.log(`Agents: ${result.agents.join(', ')}`);
    console.log(`Workflow: ${result.workflow}`);
    console.log(`Status: ${result.status}`);
  }
  
  private async handleGeneral(input: string): Promise<void> {
    console.log('🎯 Processing general request...');
    
    // Use orchestrator to handle general requests
    const result = await this.orchestrator.processRequest(input);
    
    console.log('\n📤 Response:');
    console.log(result);
  }
  
  private prompt(question: string): Promise<string> {
    const readline = require('readline');
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
    
    return new Promise(resolve => {
      rl.question(question, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}
```

### Voice Interface

```typescript
// cli/orchestrator-voice.ts
class OrchestratorVoice {
  private orchestrator: AgentOrchestrator;
  private hermesVoice?: HermesVoiceIntegration;
  
  async start(): Promise<void> {
    console.log('🎤 Orchestrator Voice Interface');
    console.log('Speak your requests naturally, or say "exit" to quit\n');
    
    if (this.hermesVoice) {
      await this.startHermesVoice();
    } else {
      console.log('❌ Hermes voice not available');
      console.log('💡 Use the chat interface instead: npm run orchestrator chat');
    }
  }
  
  private async startHermesVoice(): Promise<void> {
    while (true) {
      console.log('🎤 Listening...');
      
      // Get voice input from Hermes
      const input = await this.hermesVoice!.listen();
      
      console.log(`👤 Heard: "${input}"`);
      
      if (input.toLowerCase() === 'exit') {
        break;
      }
      
      // Process the same way as chat interface
      await this.processInput(input);
    }
  }
  
  private async processInput(input: string): Promise<void> {
    // Same processing as chat interface
    const chat = new OrchestratorChat(this.orchestrator);
    await chat.processInput(input);
  }
}
```

### CMUX Skill Integration

```typescript
// skills/cmux-agent-orchestration/orchestrator-interface.ts
class CMUXOrchestratorInterface {
  async handleCommand(command: string): Promise<string> {
    const orchestrator = new AgentOrchestrator();
    await orchestrator.initialize();
    
    // Parse command from CMUX
    const intent = this.parseCMUXCommand(command);
    
    // Execute using orchestrator
    const result = await orchestrator.processRequest(intent);
    
    // Format output for CMUX
    return this.formatForCMUX(result);
  }
  
  private parseCMUXCommand(command: string): Intent {
    // Parse commands like:
    // "orchestrate analyze my project"
    // "orchestrate execute add authentication"
    // "orchestrate brief new feature"
    
    const parts = command.split(' ');
    const action = parts[1]; // analyze, execute, brief, coordinate
    const rest = parts.slice(2).join(' ');
    
    return {
      type: action,
      input: rest
    };
  }
}
```

## Usage Examples

### Chat Interface
```bash
$ npm run orchestrator chat

🎯 Orchestrator Chat Interface
Type your requests naturally, or "exit" to quit

> analyze my web project
🔍 Analyzing project...

📊 Analysis Results:
Domain: web-development
Type: web
Tech Stack: React, TypeScript, Node.js, PostgreSQL

Key Findings:
  - Missing authentication system
  - No error handling in API routes
  - Performance issues in data fetching
  - Good test coverage

> add user authentication
⚡ Executing task...

✅ Execution Results:
Status: completed
Agents used: devin, specialist
Duration: 2.5s

Output:
Implemented JWT-based authentication with:
  - User registration endpoint
  - Login/logout functionality
  - Protected routes middleware
  - Token refresh mechanism

> exit
```

### Voice Interface
```bash
$ npm run orchestrator voice

🎤 Orchestrator Voice Interface
Speak your requests naturally, or say "exit" to quit

🎤 Listening...
👤 Heard: "analyze my web project"
🔍 Analyzing project...

📊 Analysis Results:
[Same as above]

🎤 Listening...
👤 Heard: "add user authentication"
⚡ Executing task...

✅ Execution Results:
[Same as above]

🎤 Listening...
👤 Heard: "exit"
```

### CMUX Skill
```bash
# In CMUX
Use $cmux-agent-orchestration to analyze my project

# Output in CMUX pane
🔍 Analyzing project...
📊 Analysis Results:
Domain: web-development
Type: web
Tech Stack: React, TypeScript, Node.js, PostgreSQL
```

## Next Steps

1. **Implement chat interface** - Primary way to interact
2. **Add Hermes voice integration** - For hands-free use
3. **Enhance CMUX skill** - Seamless terminal integration
4. **Add HTTP API** - For programmatic access
5. **Create web interface** - Optional GUI

This gives you multiple natural ways to talk to the orchestrator!