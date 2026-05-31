/**
 * Base Agent Wrapper - Foundation for wrapping any CLI agent as an A2A-compliant agent
 * 
 * This class provides:
 * - A2A server capabilities using Google ADK
 * - Agent lifecycle management
 * - Instance identity and tracking
 * - Mailbox system for async communication
 * - CLI agent invocation
 */

import { MemoryManager } from '../memory/MemoryManager';
import { PersonaManager } from '../persona/PersonaManager';

export interface AgentConfig {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  cliCommand: string;
  instanceId: string;
  mailboxAddress: string;
  memoryKey?: string;
  personaId?: string;
}

export interface AgentInstance {
  config: AgentConfig;
  status: 'idle' | 'busy' | 'offline';
  lastActivity: Date;
  processId?: number;
}

export abstract class BaseAgentWrapper {
  protected config: AgentConfig;
  protected a2aServer: any = null;
  protected status: 'idle' | 'busy' | 'offline' = 'offline';
  protected currentProcess: any = null;
  protected memoryManager: MemoryManager;
  protected personaManager: PersonaManager;
  protected registry: any; // Callback to update registry status
  protected orchestrator: any; // Callback to log responses

  constructor(config: AgentConfig, memoryManager: MemoryManager, personaManager: PersonaManager, registry: any = null, orchestrator: any = null) {
    this.config = config;
    this.memoryManager = memoryManager;
    this.personaManager = personaManager;
    this.registry = registry;
    this.orchestrator = orchestrator;
  }

  /**
   * Initialize the A2A server for this agent
   */
  async initializeA2A(port: number): Promise<void> {
    try {
      console.log(`Initializing A2A server for ${this.config.name} on port ${port}`);

      const express: any = require('express');
      const app = express();
      app.use(express.json({ limit: '1mb' }));

      app.get('/.well-known/agent-card.json', (_req: any, res: any) => {
        res.json(this.generateAgentCard());
      });

      app.post('/a2a/jsonrpc', async (req: any, res: any) => {
        try {
          const body = req.body || {};
          if (body.method !== 'message/send') {
            res.status(400).json({
              jsonrpc: '2.0',
              id: body.id ?? null,
              error: {
                code: -32601,
                message: `Unsupported method: ${body.method}`
              }
            });
            return;
          }

          const result = await this.handleA2AMessage(body.params);
          res.json({
            jsonrpc: '2.0',
            id: body.id ?? null,
            result
          });
        } catch (error: any) {
          res.status(500).json({
            jsonrpc: '2.0',
            id: req.body?.id ?? null,
            error: {
              code: -32000,
              message: error?.message || 'A2A request failed'
            }
          });
        }
      });

      app.get('/a2a/rest', (_req: any, res: any) => {
        res.json({
          ok: true,
          message: 'A2A REST compatibility endpoint is available via /a2a/jsonrpc'
        });
      });

      await new Promise<void>((resolve, reject) => {
        this.a2aServer = app.listen(port, () => {
          console.log(`A2A server started for ${this.config.name} on port ${port}`);
          resolve();
        });
        this.a2aServer.on('error', (error: any) => {
          if (error?.code === 'EPERM' || error?.code === 'EACCES') {
            console.warn(`A2A server could not bind for ${this.config.name}; continuing without HTTP listener in this environment.`);
            this.a2aServer = null;
            resolve();
            return;
          }
          reject(error);
        });
      });
    } catch (error) {
      console.error(`Failed to initialize A2A server for ${this.config.name}:`, error);
      throw error;
    }
  }

  /**
   * Get agent instructions (to be overridden by subclasses)
   */
  protected getAgentInstructions(): string {
    let instructions = `You are ${this.config.name}, version ${this.config.version}.
    
Description: ${this.config.description}

Capabilities: ${this.config.capabilities.join(', ')}

Memory Key: ${this.config.memoryKey}`;

    // Add persona instructions if assigned
    if (this.config.personaId) {
      const personaInstructions = this.personaManager.getPersonaInstructions(this.config.instanceId);
      if (personaInstructions) {
        instructions += `\n\n${personaInstructions}`;
      }
    }

    instructions += `\n\nYou should respond to requests using your available tools and capabilities.`;
    return instructions;
  }

  /**
   * Get agent tools (to be overridden by subclasses)
   */
  protected getAgentTools(): any[] {
    return [];
  }

  /**
   * Start the agent wrapper
   */
  async start(): Promise<void> {
    console.log(`Starting agent wrapper for ${this.config.name} (instance: ${this.config.instanceId})`);
    
    // Generate memory key for this instance
    this.config.memoryKey = this.memoryManager.generateMemoryKey(this.config.instanceId);
    
    // Store initial context in memory
    this.memoryManager.storeMemory(
      this.config.instanceId,
      'context',
      {
        agentName: this.config.name,
        instanceId: this.config.instanceId,
        capabilities: this.config.capabilities,
        startedAt: new Date().toISOString()
      }
    );
    
    this.status = 'idle';
    await this.initializeA2A(this.getPortForInstance());
  }

  /**
   * Stop the agent wrapper
   */
  async stop(): Promise<void> {
    console.log(`Stopping agent wrapper for ${this.config.name}`);
    this.status = 'offline';
    
    // Clean up memory
    if (this.config.instanceId) {
      this.memoryManager.deleteMemoryKey(this.config.instanceId);
    }
    
    if (this.a2aServer) {
      await this.a2aServer.stop();
      this.a2aServer = null;
    }
    if (this.currentProcess) {
      this.currentProcess.kill();
      this.currentProcess = null;
    }
  }

  /**
   * Invoke the CLI agent with a request
   */
  protected async invokeCLI(request: string): Promise<string> {
    this.status = 'busy';
    if (this.registry) {
      this.registry.updateInstanceStatus(this.config.instanceId, 'busy');
    }
    try {
      // TODO: Implement CLI invocation
      // This will execute the CLI command and capture output
      const result = await this.executeCLICommand(this.config.cliCommand, request);
      return result;
    } finally {
      this.status = 'idle';
      if (this.registry) {
        this.registry.updateInstanceStatus(this.config.instanceId, 'idle');
      }
    }
  }

  /**
   * Execute the actual CLI command (to be implemented by subclasses)
   */
  protected abstract executeCLICommand(command: string, request: string): Promise<string>;

  /**
   * Handle incoming A2A requests
   */
  async handleRequest(request: any): Promise<any> {
    console.log(`${this.config.name} received request:`, request);
    
    // Handle different request formats
    const message = this.extractRequestText(request);
    const response = await this.invokeCLI(message);
    
    return {
      agentId: this.config.instanceId,
      mailbox: this.config.mailboxAddress,
      response: response,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Extract plain text from a request payload.
   */
  private extractRequestText(request: any): string {
    if (typeof request === 'string') {
      return request;
    }

    const message = request?.message || request?.task || request;
    if (typeof message === 'string') {
      return message;
    }

    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const text = parts
      .map((part: any) => {
        if (!part) return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean)
      .join('\n');

    if (text) {
      return text;
    }

    return message?.text || JSON.stringify(message);
  }

  /**
   * Handle a real A2A message/send request.
   */
  private async handleA2AMessage(params: any): Promise<any> {
    const message = params?.message || params || {};
    const text = this.extractMessageText(message);
    const response = await this.invokeCLI(text);

    return {
      kind: 'message',
      messageId: `${this.config.instanceId}-${Date.now()}`,
      role: 'agent',
      parts: [{ kind: 'text', text: response }],
      contextId: message.contextId,
      metadata: {
        agentId: this.config.instanceId,
        mailbox: this.config.mailboxAddress
      }
    };
  }

  /**
   * Convert an A2A message into plain text for the CLI.
   */
  private extractMessageText(message: any): string {
    if (typeof message === 'string') {
      return message;
    }

    const parts = Array.isArray(message?.parts) ? message.parts : [];
    const textParts = parts
      .map((part: any) => {
        if (!part) return '';
        if (typeof part.text === 'string') return part.text;
        if (typeof part.content === 'string') return part.content;
        return '';
      })
      .filter(Boolean);

    if (textParts.length > 0) {
      return textParts.join('\n');
    }

    return message?.text || message?.task || JSON.stringify(message);
  }

  /**
   * Start monitoring mailbox for incoming messages
   */
  async startMailboxMonitoring(mailboxRouter: any): Promise<void> {
    console.log(`${this.config.name} starting mailbox monitoring for ${this.config.mailboxAddress}`);
    
    // Subscribe to own mailbox for requests only (not responses)
    mailboxRouter.subscribe({
      subscriberId: this.config.instanceId,
      targetMailbox: this.config.mailboxAddress,
      messageType: 'request',
      callback: async (message: any) => {
        // Only process request messages, ignore responses
        if (message.type === 'request') {
          await this.handleIncomingMessage(message, mailboxRouter);
        }
      }
    });
  }

  /**
   * Handle incoming message from mailbox
   */
  private async handleIncomingMessage(message: any, mailboxRouter: any): Promise<void> {
    console.log(`${this.config.name} processing request:`, message.id);
    
    const startTime = Date.now();
    
    try {
      // Process the request
      const response = await this.handleRequest(message.payload);
      
      const duration = Date.now() - startTime;
      
      // Log the response
      if (this.orchestrator) {
        this.orchestrator.logResponse(
          this.config.mailboxAddress,
          message.from,
          response,
          duration
        );
      }
      
      // Store conversation in memory
      this.storeConversation({
        from: message.from,
        to: message.to,
        request: message.payload,
        response: response,
        timestamp: new Date().toISOString()
      });
      
      // Send response back on the mailbox bus for legacy/internal consumers.
      await mailboxRouter.sendMessage({
        from: this.config.mailboxAddress,
        to: message.from,
        type: 'response',
        payload: response
      });

      console.log(`${this.config.name} sent response to ${message.from} (${duration}ms)`);
    } catch (error) {
      console.error(`${this.config.name} error processing message:`, error);
    }
  }

  /**
   * Get agent status and info
   */
  getStatus(): AgentInstance {
    return {
      config: this.config,
      status: this.status,
      lastActivity: new Date(),
      processId: this.currentProcess?.pid
    };
  }

  /**
   * Store preference in agent memory
   */
  storePreference(key: string, value: any): void {
    this.memoryManager.storeMemory(
      this.config.instanceId,
      'preference',
      { key, value },
      7 * 24 * 60 * 60 * 1000 // 7 days TTL for preferences
    );
  }

  /**
   * Get preference from agent memory
   */
  getPreference(key: string): any {
    const preferences = this.memoryManager.retrieveMemory(this.config.instanceId, 'preference');
    const pref = preferences.find(p => p.content.key === key);
    return pref ? pref.content.value : null;
  }

  /**
   * Store state in agent memory
   */
  storeState(state: any): void {
    this.memoryManager.storeMemory(
      this.config.instanceId,
      'state',
      state,
      24 * 60 * 60 * 1000 // 24 hours TTL for state
    );
  }

  /**
   * Get latest state from agent memory
   */
  getState(): any {
    const stateEntry = this.memoryManager.getLatestMemory(this.config.instanceId, 'state');
    return stateEntry ? stateEntry.content : null;
  }

  /**
   * Store conversation context in agent memory
   */
  storeConversation(context: any): void {
    this.memoryManager.storeMemory(
      this.config.instanceId,
      'conversation',
      context,
      30 * 24 * 60 * 60 * 1000 // 30 days TTL for conversations
    );
  }

  /**
   * Get conversation history from agent memory
   */
  getConversationHistory(limit: number = 10): any[] {
    const conversations = this.memoryManager.retrieveMemory(this.config.instanceId, 'conversation');
    return conversations.slice(0, limit).map(c => c.content);
  }

  /**
   * Assign a persona to this agent instance
   */
  assignPersona(personaId: string, customizations: Record<string, any> = {}): void {
    this.config.personaId = personaId;
    this.personaManager.assignPersona(this.config.instanceId, personaId, customizations);
    
    // Store persona assignment in memory
    this.memoryManager.storeMemory(
      this.config.instanceId,
      'context',
      {
        personaId,
        customizations,
        assignedAt: new Date().toISOString()
      }
    );

    // Update agent instructions with new persona
    this.updateAgentInstructions();
  }

  /**
   * Get current persona assignment
   */
  getPersona(): any {
    if (!this.config.personaId) {
      return null;
    }
    return this.personaManager.getInstancePersona(this.config.instanceId);
  }

  /**
   * Remove persona assignment
   */
  removePersona(): void {
    if (this.config.personaId) {
      this.personaManager.removePersonaAssignment(this.config.instanceId);
      this.config.personaId = undefined;
      this.updateAgentInstructions();
    }
  }

  /**
   * Update agent instructions (called when persona changes)
   */
  private updateAgentInstructions(): void {
    // This would trigger a re-initialization of the A2A agent with new instructions
    // For now, it's a placeholder for future implementation
    console.log(`Updated agent instructions for ${this.config.instanceId}`);
  }

  /**
   * Get unique port for this agent instance
   */
  protected getPortForInstance(): number {
    // Base port + hash of instance ID to ensure unique ports
    const basePort = 8000;
    const instanceHash = this.config.instanceId.split('-')[1] || '0';
    const port = basePort + parseInt(instanceHash);
    return isNaN(port) ? basePort + 9000 : port; // Fallback for non-numeric IDs
  }

  /**
   * Generate Agent Card for A2A discovery
   */
  generateAgentCard(): any {
    const a2aCapabilities = {
      streaming: false,
      pushNotifications: false
    };

    return {
      name: this.config.name,
      version: this.config.version,
      description: this.config.description,
      protocolVersion: '0.3.0',
      capabilities: this.config.capabilities,
      instanceId: this.config.instanceId,
      mailbox: this.config.mailboxAddress,
      url: `http://localhost:${this.getPortForInstance()}/a2a/jsonrpc`,
      skills: this.config.capabilities.map(capability => ({
        id: capability,
        name: capability,
        description: `${this.config.name} capability: ${capability}`,
        tags: [capability]
      })),
      defaultInputModes: ['text'],
      defaultOutputModes: ['text'],
      a2aCapabilities,
      endpoints: {
        a2a: `http://localhost:${this.getPortForInstance()}/a2a`,
        inbox: `http://localhost:${this.getPortForInstance()}/inbox`,
        outbox: `http://localhost:${this.getPortForInstance()}/outbox`
      }
    };
  }
}
