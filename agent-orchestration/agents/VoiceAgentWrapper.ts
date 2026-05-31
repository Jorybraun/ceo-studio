/**
 * Voice Agent Wrapper - Wrapper for voice interface agent
 */

import { BaseAgentWrapper, AgentConfig } from '../base/BaseAgentWrapper';
import { MemoryManager } from '../memory/MemoryManager';
import { PersonaManager } from '../persona/PersonaManager';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export class VoiceAgentWrapper extends BaseAgentWrapper {
  constructor(instanceId: string = 'voice-agent-1', memoryManager: MemoryManager, personaManager: PersonaManager, registry: any = null, orchestrator: any = null) {
    const config: AgentConfig = {
      name: 'Voice Agent',
      version: '1.0.0',
      description: 'Conversational voice interface agent',
      capabilities: [
        'conversation',
        'voice-input',
        'voice-output',
        'context-management'
      ],
      cliCommand: 'voice-agent',
      instanceId,
      mailboxAddress: `${instanceId}@local`
    };

    super(config, memoryManager, personaManager, registry, orchestrator);
  }

  /**
   * Execute voice agent CLI command
   */
  protected async executeCLICommand(command: string, request: string): Promise<string> {
    try {
      console.log(`Executing Voice Agent CLI: ${command} "${request}"`);
      
      const { stdout, stderr } = await execAsync(`${command} "${request}"`, {
        timeout: 120000, // 2 minute timeout
        maxBuffer: 10 * 1024 * 1024 // 10MB buffer
      });
      
      if (stderr) {
        console.error(`Voice Agent CLI stderr: ${stderr}`);
      }
      
      console.log(`Voice Agent CLI response received`);
      return stdout.trim();
    } catch (error: any) {
      console.error(`Error executing Voice Agent CLI: ${error.message}`);
      if (error.message.includes('command not found') || error.message.includes('ENOENT')) {
        throw new Error(`Voice Agent CLI not found. Please ensure '${command}' is installed and available in PATH.`);
      }
      throw new Error(`Voice Agent CLI execution failed: ${error.message}`);
    }
  }

  /**
   * Get voice agent-specific instructions
   */
  protected getAgentInstructions(): string {
    return `You are a Voice Agent for conversational interfaces.

Your core capabilities:
- Conversation: Natural language interaction
- Voice Input: Process spoken input
- Voice Output: Generate spoken responses
- Context Management: Maintain conversation context

Memory Key: ${this.config.memoryKey}

When responding to requests:
- Be conversational and natural
- Maintain context across turns
- Provide clear, spoken-style responses
- Handle interruptions gracefully`;
  }

  /**
   * Get voice agent-specific tools
   */
  protected getAgentTools(): any[] {
    return [
      {
        name: 'converse',
        description: 'Engage in natural conversation',
        parameters: {
          type: 'object',
          properties: {
            message: { type: 'string', description: 'The message to respond to' },
            context: { type: 'string', description: 'Conversation context' }
          },
          required: ['message']
        }
      }
    ];
  }
}