/**
 * Agent Orchestrator - Main coordinator for the agent orchestration system
 * 
 * Ties together:
 * - Agent Registry (agent management)
 * - Mailbox Router (async communication)
 * - Base Agent Wrappers (A2A compliance)
 * - Specific agent implementations
 */

import { AgentRegistry } from './registry/AgentRegistry';
import { MailboxRouter } from './mailbox/MailboxRouter';
import { IMemoryManager } from './interfaces/IMemoryManager';
import { IPersonaManager } from './interfaces/IPersonaManager';
import { IDomainConfig } from './interfaces/IDomainConfig';
import { AgentCardGenerator } from './discovery/AgentCardGenerator';
import { ConversationLogger } from './logging/ConversationLogger';
import { DomainIsolation } from './domain/DomainIsolation';
import { AgentLifecycleManager, AgentState } from './lifecycle/AgentLifecycleManager';
import { DevinWrapper } from './agents/DevinWrapper';
import { VoiceAgentWrapper } from './agents/VoiceAgentWrapper';
import { MemoryManager } from './memory/MemoryManager';
import { PersonaManager } from './persona/PersonaManager';
import { DomainConfig } from './domain/DomainConfig';

export class AgentOrchestrator {
  private registry: AgentRegistry;
  private mailboxRouter: MailboxRouter;
  private memoryManager: IMemoryManager;
  private personaManager: IPersonaManager;
  private agentCardGenerator: AgentCardGenerator;
  private conversationLogger: ConversationLogger;
  private domainIsolation: DomainIsolation;
  private lifecycleManager: AgentLifecycleManager;
  private agentWrappers: Map<string, any> = new Map();
  private currentDomain: string | null = null;

  constructor(
    config: {
      logDir?: string;
      enableLogging?: boolean;
      enableDomainIsolation?: boolean;
      enableLifecycleManagement?: boolean;
      // IoC: Allow dependency injection
      memoryManager?: IMemoryManager;
      personaManager?: IPersonaManager;
      domainConfig?: IDomainConfig;
    } = {}
  ) {
    this.registry = new AgentRegistry();
    this.mailboxRouter = new MailboxRouter();
    
    // IoC: Use injected dependencies or defaults
    this.memoryManager = config.memoryManager || new MemoryManager();
    this.personaManager = config.personaManager || new PersonaManager();
    
    this.agentCardGenerator = new AgentCardGenerator();
    this.conversationLogger = config.enableLogging !== false 
      ? new ConversationLogger(config.logDir || './logs') 
      : null as any;
    this.domainIsolation = config.enableDomainIsolation !== false 
      ? new DomainIsolation() 
      : null as any;
    this.lifecycleManager = config.enableLifecycleManagement !== false 
      ? new AgentLifecycleManager() 
      : null as any;
  }

  /**
   * Initialize the orchestrator
   */
  async initialize(): Promise<void> {
    console.log('Initializing Agent Orchestrator...');

    // Register agent types
    this.registerAgentTypes();

    // Start core services
    await this.startServices();

    // Initialize domain isolation
    if (this.domainIsolation) {
      console.log('Domain isolation initialized');
    }

    // Initialize lifecycle management
    if (this.lifecycleManager) {
      console.log('Agent lifecycle management initialized');
    }

    console.log('Agent Orchestrator initialized successfully');
  }

  /**
   * Get injected dependencies (for testing/customization)
   */
  getMemoryManager(): IMemoryManager {
    return this.memoryManager;
  }

  getPersonaManager(): IPersonaManager {
    return this.personaManager;
  }

  /**
   * Switch to a specific domain (isolates agents to domain context)
   */
  switchDomain(domainId: string): void {
    if (!this.domainIsolation) {
      console.warn('Domain isolation is not enabled');
      return;
    }

    const domain = this.domainIsolation.getDomain(domainId);
    if (!domain) {
      throw new Error(`Domain not found: ${domainId}`);
    }

    this.currentDomain = domainId;
    
    // Switch to domain-specific memory manager
    const domainMemoryManager = this.domainIsolation.getDomainMemoryManager(domainId);
    if (domainMemoryManager) {
      this.memoryManager = domainMemoryManager;
    }

    // Switch to domain-specific persona manager
    const domainPersonaManager = this.domainIsolation.getDomainPersonaManager(domainId);
    if (domainPersonaManager) {
      this.personaManager = domainPersonaManager;
    }

    // Load domain context
    const domainContext = this.domainIsolation.loadDomainContext(domainId);
    console.log(`Switched to domain: ${domain.name}`);
    console.log(`Domain context:`, domainContext);
  }

  /**
   * Get current domain
   */
  getCurrentDomain(): any {
    if (!this.currentDomain || !this.domainIsolation) {
      return null;
    }
    return this.domainIsolation.getDomain(this.currentDomain);
  }

  /**
   * Get all available domains
   */
  getAllDomains(): any[] {
    if (!this.domainIsolation) {
      return [];
    }
    return this.domainIsolation.getAllDomains();
  }

  /**
   * Create agent instance within current domain (starts in DORMANT state)
   */
  async createAgentInstance(agentType: string, config: any = {}, domainId?: string): Promise<string> {
    const targetDomain = domainId || this.currentDomain;

    // Check domain isolation if enabled
    if (this.domainIsolation && targetDomain) {
      if (!this.domainIsolation.isAgentTypeAllowed(targetDomain, agentType)) {
        throw new Error(`Agent type ${agentType} not allowed in domain ${targetDomain}`);
      }
    }

    console.log(`Creating agent instance: ${agentType}${targetDomain ? ` in domain ${targetDomain}` : ''}`);

    // Create instance in registry
    const instanceId = await this.registry.createInstance(agentType, config);
    const instanceConfig = this.registry.getInstanceConfig(instanceId);
    
    if (instanceConfig) {
      // Create mailbox for the new instance
      this.mailboxRouter.createMailbox(instanceConfig.mailboxAddress);

      // Register with lifecycle manager (starts in DORMANT state)
      if (this.lifecycleManager) {
        this.lifecycleManager.registerAgent(instanceId);
      }

      // Create and store the actual wrapper (but don't start it yet)
      const wrapper = this.createAgentWrapper(agentType, instanceConfig);
      if (wrapper) {
        this.agentWrappers.set(instanceId, wrapper);
        
        // Register instance with domain if domain isolation is enabled
        if (this.domainIsolation && targetDomain) {
          this.domainIsolation.registerAgentInstance(targetDomain, instanceId);
        }
      }
    }

    return instanceId;
  }

  /**
   * Wake up an agent (transition from DORMANT/SLEEP to ACTIVE)
   */
  async wakeUpAgent(instanceId: string): Promise<void> {
    if (!this.lifecycleManager) {
      // If lifecycle management is disabled, just start the agent
      const wrapper = this.agentWrappers.get(instanceId);
      if (wrapper) {
        await wrapper.start();
      }
      return;
    }

    const currentState = this.lifecycleManager.getAgentState(instanceId);
    if (currentState === AgentState.ACTIVE) {
      console.log(`Agent ${instanceId} is already ACTIVE`);
      return;
    }

    await this.lifecycleManager.wakeUp(instanceId, async () => {
      const wrapper = this.agentWrappers.get(instanceId);
      if (wrapper) {
        await wrapper.start();
        await wrapper.startMailboxMonitoring(this.mailboxRouter);
      }
    });
  }

  /**
   * Put agent to sleep
   */
  async sleepAgent(instanceId: string): Promise<void> {
    if (!this.lifecycleManager) {
      return;
    }

    await this.lifecycleManager.goToSleep(instanceId, async () => {
      const wrapper = this.agentWrappers.get(instanceId);
      if (wrapper) {
        await wrapper.stop();
      }
    });
  }

  /**
   * Stop an agent completely
   */
  async stopAgent(instanceId: string): Promise<void> {
    if (this.lifecycleManager) {
      await this.lifecycleManager.stopAgent(instanceId, async () => {
        const wrapper = this.agentWrappers.get(instanceId);
        if (wrapper) {
          await wrapper.stop();
        }
      });
    } else {
      // Fallback if lifecycle management is disabled
      const wrapper = this.agentWrappers.get(instanceId);
      if (wrapper) {
        await wrapper.stop();
      }
    }

    // Clean up registry and other resources
    const instance = this.registry.getInstance(instanceId);
    if (instance) {
      this.mailboxRouter.deleteMailbox(instance.config.mailboxAddress);
    }

    this.agentWrappers.delete(instanceId);
    await this.registry.stopInstance(instanceId);
  }

  /**
   * Register all agent types with their templates
   */
  private registerAgentTypes(): void {
    // Register Devin agent type
    this.registry.registerAgentType('devin', {
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
      cliCommand: 'devin'
    });

    // Register voice agent type
    this.registry.registerAgentType('voice-agent', {
      name: 'Voice Agent',
      version: '1.0.0',
      description: 'Conversational voice interface agent',
      capabilities: [
        'conversation',
        'voice-input',
        'voice-output',
        'context-management'
      ],
      cliCommand: 'voice-agent'
    });

    // Register document agent type
    this.registry.registerAgentType('document-agent', {
      name: 'Document Agent',
      version: '1.0.0',
      description: 'Document analysis and research agent',
      capabilities: [
        'document-analysis',
        'research',
        'summarization',
        'knowledge-extraction'
      ],
      cliCommand: 'document-agent'
    });
  }

  /**
   * Start core services
   */
  private async startServices(): Promise<void> {
    // Mailbox router is already initialized in constructor
    console.log('Mailbox Router started');
  }

  /**
   * Create specific agent wrapper based on type
   */
  private createAgentWrapper(agentType: string, config: any): any {
    switch (agentType) {
      case 'devin':
        return new DevinWrapper(config?.instanceId, this.memoryManager as any, this.personaManager as any, this.registry, this);
      case 'voice-agent':
        return new VoiceAgentWrapper(config?.instanceId, this.memoryManager as any, this.personaManager as any, this.registry, this);
      // Add other agent types as they're implemented
      // case 'document-agent':
      //   return new DocumentAgentWrapper(config?.instanceId, this.memoryManager as any, this.personaManager as any, this.registry, this);
      default:
        console.warn(`No wrapper implementation for ${agentType}`);
        return null;
    }
  }

  /**
   * Get domain statistics
   */
  getDomainStats(): any {
    if (!this.domainIsolation) {
      return { domainIsolation: 'disabled' };
    }
    return this.domainIsolation.getDomainStats();
  }

  /**
   * Get lifecycle statistics
   */
  getLifecycleStats(): any {
    if (!this.lifecycleManager) {
      return { lifecycleManagement: 'disabled' };
    }
    return this.lifecycleManager.getLifecycleStats();
  }

  /**
   * Get agent state
   */
  getAgentState(instanceId: string): string {
    if (!this.lifecycleManager) {
      return 'unknown';
    }
    return this.lifecycleManager.getAgentState(instanceId);
  }

  /**
   * Wake up all agents
   */
  async wakeUpAllAgents(): Promise<void> {
    if (!this.lifecycleManager) {
      return;
    }
    await this.lifecycleManager.wakeUpAllAgents(async (instanceId) => {
      await this.wakeUpAgent(instanceId);
    });
  }

  /**
   * Put all idle agents to sleep
   */
  async sleepAllIdleAgents(): Promise<void> {
    if (!this.lifecycleManager) {
      return;
    }
    await this.lifecycleManager.sleepAllAgents(async (instanceId) => {
      await this.sleepAgent(instanceId);
    });
  }

  /**
   * Stop all agents
   */
  async stopAllAgents(): Promise<void> {
    if (this.lifecycleManager) {
      await this.lifecycleManager.stopAllAgents(async (instanceId) => {
        await this.stopAgent(instanceId);
      });
    } else {
      // Fallback: stop all agents directly
      const allInstances = this.registry.getAllInstances();
      for (const instance of allInstances) {
        await this.stopAgent(instance.config.instanceId);
      }
    }
  }

  /**
   * Send a message between agents (auto-wakes up sleeping agents)
   */
  async sendMessage(from: string, to: string, payload: any): Promise<string> {
    // Auto-wake up the target agent if it's sleeping/dormant
    if (this.lifecycleManager) {
      // Convert mailbox address to instance ID if needed
      const targetInstanceId = to.replace('@local', '');
      const targetState = this.lifecycleManager.getAgentState(targetInstanceId);
      if (targetState === AgentState.DORMANT || targetState === AgentState.SLEEP) {
        console.log(`Auto-waking up agent ${targetInstanceId} to receive message`);
        await this.wakeUpAgent(targetInstanceId);
      }
    }

    // Log the message
    if (this.conversationLogger) {
      const fromWrapper = this.agentWrappers.get(from);
      const fromPersona = fromWrapper?.getPersona()?.name;
      const fromMemoryKey = fromWrapper?.['config']?.memoryKey;

      this.conversationLogger.logConversation(
        from,
        to,
        'request',
        payload,
        {
          agentPersona: fromPersona,
          agentMemoryKey: fromMemoryKey
        }
      );
    }

    const targetInstanceId = to.replace('@local', '');
    const targetWrapper = this.agentWrappers.get(targetInstanceId);

    if (targetWrapper) {
      const agentCard = targetWrapper.generateAgentCard?.();
      const endpoint = agentCard?.url;

      if (endpoint) {
        const messageId = `msg-${Date.now()}-${Math.random().toString(16).slice(2)}`;
        const jsonRpcBody = {
          jsonrpc: '2.0',
          id: messageId,
          method: 'message/send',
          params: {
            message: {
              kind: 'message',
              messageId,
              role: 'user',
              parts: [{ kind: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }],
              metadata: { from, to }
            },
            configuration: {
              acceptedOutputModes: ['text'],
              blocking: true
            },
            metadata: {
              from,
              to
            }
          }
        };

        try {
          const response = await fetch(endpoint, {
            method: 'POST',
            headers: {
              'content-type': 'application/json'
            },
            body: JSON.stringify(jsonRpcBody)
          });

          if (!response.ok) {
            throw new Error(`A2A request failed with HTTP ${response.status}`);
          }

          const data: any = await response.json();
          const result = data.result ?? data;

          if (this.conversationLogger) {
            const fromWrapper = this.agentWrappers.get(from.replace('@local', ''));
            const fromPersona = fromWrapper?.getPersona()?.name;
            const fromMemoryKey = fromWrapper?.['config']?.memoryKey;

            this.conversationLogger.logConversation(from, to, 'request', payload, {
              agentPersona: fromPersona,
              agentMemoryKey: fromMemoryKey
            });
            this.conversationLogger.logConversation(to, from, 'response', result, {
              duration: 0
            });
          }

          return typeof result?.messageId === 'string' ? result.messageId : messageId;
        } catch (error) {
          console.warn(`A2A send failed for ${to}; falling back to direct invocation:`, error);

          const directResponse = await targetWrapper.handleRequest({
            message: {
              parts: [{ kind: 'text', text: typeof payload === 'string' ? payload : JSON.stringify(payload) }]
            }
          });

          if (this.conversationLogger) {
            const fromWrapper = this.agentWrappers.get(from.replace('@local', ''));
            const fromPersona = fromWrapper?.getPersona()?.name;
            const fromMemoryKey = fromWrapper?.['config']?.memoryKey;

            this.conversationLogger.logConversation(from, to, 'request', payload, {
              agentPersona: fromPersona,
              agentMemoryKey: fromMemoryKey
            });
            this.conversationLogger.logConversation(to, from, 'response', directResponse, {
              duration: 0
            });
          }

          return directResponse?.timestamp || messageId;
        }
      }
    }

    return await this.mailboxRouter.sendMessage({
      from,
      to,
      type: 'request',
      payload
    });
  }

  /**
   * Get all agents and their status
   */
  getAllAgents(): any {
    return {
      registry: this.registry.getRegistryStatus(),
      mailboxes: this.mailboxRouter.getRouterStatus(),
      memory: this.memoryManager.getMemoryStats(),
      personas: this.personaManager.getPersonaStats()
    };
  }

  /**
   * Get memory key for an agent instance
   */
  getMemoryKey(instanceId: string): string | null {
    return this.memoryManager.getMemoryKey(instanceId);
  }

  /**
   * Get memory for an agent instance
   */
  getAgentMemory(instanceId: string, type?: string): any {
    return this.memoryManager.getMemory(instanceId, type as any);
  }

  /**
   * Store memory for an agent instance
   */
  storeAgentMemory(instanceId: string, type: string, content: any): void {
    this.memoryManager.storeMemory(instanceId, type as any, content);
  }

  /**
   * Get Agent Card for a specific instance
   */
  getAgentCard(instanceId: string): any {
    const instance = this.registry.getInstance(instanceId);
    if (!instance) {
      return null;
    }

    const port = this.getPortForInstance(instanceId);
    return this.agentCardGenerator.generateAgentCard(instance, port);
  }

  /**
   * Get all Agent Cards
   */
  getAllAgentCards(): Map<string, any> {
    const instances = this.registry.getAllInstances();
    return this.agentCardGenerator.generateAgentRegistry(instances);
  }

  /**
   * Get Agent Card as JSON for HTTP serving
   */
  getAgentCardJSON(instanceId: string): string {
    const instance = this.registry.getInstance(instanceId);
    if (!instance) {
      return '{}';
    }

    const port = this.getPortForInstance(instanceId);
    return this.agentCardGenerator.generateAgentCardJSON(instance, port);
  }

  /**
   * Discover agents by capability with their Agent Cards
   */
  discoverAgentsByCapability(capability: string): any[] {
    const instances = this.registry.discoverByCapability(capability);
    return instances.map(instance => {
      const port = this.getPortForInstance(instance.config.instanceId);
      return this.agentCardGenerator.generateAgentCard(instance, port);
    });
  }

  /**
   * Get port for instance (consistent with BaseAgentWrapper)
   */
  private getPortForInstance(instanceId: string): number {
    const basePort = 8000;
    const instanceHash = instanceId.split('-')[1] || '0';
    const port = basePort + parseInt(instanceHash);
    return isNaN(port) ? basePort + 9000 : port; // Fallback for non-numeric IDs
  }

  /**
   * Get all available personas
   */
  getAllPersonas(): any[] {
    return this.personaManager.getAllPersonas();
  }

  /**
   * Assign a persona to an agent instance
   */
  assignPersonaToInstance(instanceId: string, personaId: string, customizations: Record<string, any> = {}): void {
    const wrapper = this.agentWrappers.get(instanceId);
    if (wrapper) {
      wrapper.assignPersona(personaId, customizations);
    } else {
      throw new Error(`Agent instance not found: ${instanceId}`);
    }
  }

  /**
   * Get persona for an instance
   */
  getInstancePersona(instanceId: string): any {
    const wrapper = this.agentWrappers.get(instanceId);
    if (wrapper) {
      return wrapper.getPersona();
    }
    return null;
  }

  /**
   * Remove persona from an instance
   */
  removePersonaFromInstance(instanceId: string): void {
    const wrapper = this.agentWrappers.get(instanceId);
    if (wrapper) {
      wrapper.removePersona();
    }
  }

  /**
   * Find personas by capability
   */
  findPersonasByCapability(capability: string): any[] {
    return this.personaManager.findPersonasByCapability(capability);
  }

  /**
   * Get persona statistics
   */
  getPersonaStats(): any {
    return this.personaManager.getPersonaStats();
  }

  /**
   * Log a response message
   */
  logResponse(from: string, to: string, payload: any, duration: number): void {
    if (this.conversationLogger) {
      const fromWrapper = this.agentWrappers.get(from);
      const fromPersona = fromWrapper?.getPersona()?.name;
      const fromMemoryKey = fromWrapper?.['config']?.memoryKey;

      this.conversationLogger.logConversation(
        from,
        to,
        'response',
        payload,
        {
          agentPersona: fromPersona,
          agentMemoryKey: fromMemoryKey,
          duration
        }
      );
    }
  }

  /**
   * Get conversation logs
   */
  getConversationLogs(): any[] {
    return this.conversationLogger?.getAllLogs() || [];
  }

  /**
   * Get conversation between two agents
   */
  getConversationBetween(agent1: string, agent2: string): any[] {
    return this.conversationLogger?.getConversationBetween(agent1, agent2) || [];
  }

  /**
   * Get logs for a specific agent
   */
  getAgentLogs(agentId: string): any[] {
    return this.conversationLogger?.getAgentLogs(agentId) || [];
  }

  /**
   * Get conversation statistics
   */
  getConversationStats(): any {
    return this.conversationLogger?.getStatistics() || {};
  }

  /**
   * Print conversation thread
   */
  printConversationThread(agent1: string, agent2: string): void {
    this.conversationLogger?.printConversationThread(agent1, agent2);
  }

  /**
   * Export conversation logs
   */
  exportConversationLogs(filePath: string): void {
    this.conversationLogger?.exportLogs(filePath);
  }

  /**
   * Get agents by capability
   */
  getAgentsByCapability(capability: string): any[] {
    return this.registry.discoverByCapability(capability);
  }

  /**
   * Shutdown the orchestrator
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down Agent Orchestrator...');

    // Stop all agent instances
    const allInstances = this.registry.getAllInstances();
    for (const instance of allInstances) {
      await this.stopAgent(instance.config.instanceId);
    }

    console.log('Agent Orchestrator shut down successfully');
  }
}
