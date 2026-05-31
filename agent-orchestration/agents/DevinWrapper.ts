/**
 * Devin Wrapper - Specific implementation for Devin CLI agent
 * 
 * Wraps Devin as an A2A-compliant agent with planning and coding capabilities
 */

import { BaseAgentWrapper, AgentConfig } from '../base/BaseAgentWrapper';
import { MemoryManager } from '../memory/MemoryManager';
import { PersonaManager } from '../persona/PersonaManager';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class DevinWrapper extends BaseAgentWrapper {
  constructor(instanceId: string = 'devin-1', memoryManager: MemoryManager, personaManager: PersonaManager, registry: any = null, orchestrator: any = null) {
    const config: AgentConfig = {
      name: 'Devin',
      version: '1.0.0',
      description: 'AI coding assistant for planning, debugging, and implementation',
      capabilities: [
        'planning',
        'code-analysis',
        'debugging',
        'implementation',
        'gbrain-access',
        'file-operations'
      ],
      cliCommand: 'devin',
      instanceId,
      mailboxAddress: `${instanceId}@local`
    };

    super(config, memoryManager, personaManager, registry, orchestrator);
  }

  /**
   * Execute Devin CLI command
   */
  protected async executeCLICommand(command: string, request: string): Promise<string> {
    try {
      console.log(`Executing Devin CLI: ${command} -p "${request}"`);
      
      const { stdout, stderr } = await execAsync(`${command} -p "${request}"`, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      
      if (stderr) {
        console.error(`Devin CLI stderr: ${stderr}`);
      }
      
      console.log(`Devin CLI response received`);
      return stdout.trim();
    } catch (error: any) {
      console.error(`Error executing Devin CLI: ${error.message}`);
      if (error.message.includes('command not found') || error.message.includes('ENOENT')) {
        throw new Error(`Devin CLI not found. Please ensure '${command}' is installed and available in PATH.`);
      }
      throw new Error(`Devin CLI execution failed: ${error.message}`);
    }
  }

  /**
   * Get Devin-specific agent instructions
   */
  protected getAgentInstructions(): string {
    return `You are Devin, an AI coding assistant and planning agent.

Your core capabilities:
- Planning: Break down complex tasks into actionable steps
- Code Analysis: Analyze code quality, bugs, and improvement opportunities
- Debugging: Help identify and fix issues in code
- Implementation: Write and modify code following best practices
- GBrain Access: Query and store information in the knowledge base
- File Operations: Read, write, and manage project files

Your memory key: ${this.config.memoryKey}

When responding to requests:
1. Use your available tools to accomplish the task
2. Store important context in your memory for future reference
3. Provide clear, actionable responses
4. When planning, break down into steps with dependencies and timelines
5. When analyzing code, focus on quality, security, and maintainability

You are wrapped as an A2A agent, so you communicate via the A2A protocol.`;
  }

  /**
   * Get Devin-specific tools
   */
  protected getAgentTools(): any[] {
    return [
      {
        name: 'plan_task',
        description: 'Create a detailed plan for a given task or project',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The task to plan' },
            context: { type: 'string', description: 'Additional context about the task' }
          },
          required: ['task']
        }
      },
      {
        name: 'analyze_code',
        description: 'Analyze code for quality, bugs, and improvements',
        parameters: {
          type: 'object',
          properties: {
            filePath: { type: 'string', description: 'Path to the file to analyze' },
            focus: { type: 'string', description: 'Specific focus area (quality, security, performance, etc.)' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'query_gbrain',
        description: 'Query the knowledge base for relevant information',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query' },
            limit: { type: 'number', description: 'Maximum results to return' }
          },
          required: ['query']
        }
      },
      {
        name: 'store_memory',
        description: 'Store important information in your memory',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', description: 'Memory type (preference, state, conversation)' },
            content: { type: 'object', description: 'The content to store' }
          },
          required: ['type', 'content']
        }
      }
    ];
  }

  /**
   * Handle planning-specific requests
   */
  async handlePlanningRequest(request: any): Promise<any> {
    console.log('Devin handling planning request:', request);
    
    const planningPrompt = `Create a detailed plan for: ${request.task}
    
Context:
- Project: ${request.project || 'CEO Studio'}
- Domain: ${request.domain || 'general'}
- Requirements: ${request.requirements || 'none specified'}

Please break this down into:
1. High-level approach
2. Specific steps with dependencies
3. Timeline estimates
4. Resource requirements
5. Risk assessment`;

    const plan = await this.invokeCLI(planningPrompt);
    
    return {
      type: 'planning-response',
      plan: plan,
      agentId: this.config.instanceId,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Handle code analysis requests
   */
  async handleCodeAnalysisRequest(request: any): Promise<any> {
    console.log('Devin handling code analysis request:', request);
    
    const analysisPrompt = `Analyze the code at ${request.filePath}
    
Focus on:
- Code quality and structure
- Potential bugs or issues
- Performance considerations
- Security concerns
- Improvement suggestions`;

    const analysis = await this.invokeCLI(analysisPrompt);
    
    return {
      type: 'code-analysis-response',
      filePath: request.filePath,
      analysis: analysis,
      agentId: this.config.instanceId,
      timestamp: new Date().toISOString()
    };
  }
}