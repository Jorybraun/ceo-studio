/**
 * Agent Registry - Central management for all wrapped agents
 * 
 * Provides:
 * - Agent registration and discovery
 * - Instance tracking
 * - Agent lifecycle management
 * - Query capabilities
 */

import { BaseAgentWrapper, AgentInstance } from '../base/BaseAgentWrapper';

export interface RegistryEntry {
  agentType: string;
  instances: Map<string, AgentInstance>;
  template: any; // Agent configuration template
}

export class AgentRegistry {
  private agents: Map<string, RegistryEntry> = new Map();
  private nextInstanceId = 1;

  /**
   * Register a new agent type
   */
  registerAgentType(agentType: string, template: any): void {
    if (this.agents.has(agentType)) {
      throw new Error(`Agent type ${agentType} already registered`);
    }

    this.agents.set(agentType, {
      agentType,
      instances: new Map(),
      template
    });

    console.log(`Registered agent type: ${agentType}`);
  }

  /**
   * Create a new agent instance
   */
  async createInstance(agentType: string, config: any): Promise<string> {
    const entry = this.agents.get(agentType);
    if (!entry) {
      throw new Error(`Unknown agent type: ${agentType}`);
    }

    const instanceId = `${agentType}-${this.nextInstanceId++}`;
    const mailboxAddress = `${instanceId}@local`;

    const instanceConfig = {
      ...entry.template,
      ...config,
      instanceId,
      mailboxAddress
    };

    // Store the instance config (wrapper creation handled by orchestrator)
    entry.instances.set(instanceId, {
      config: instanceConfig,
      status: 'idle',
      lastActivity: new Date()
    });

    console.log(`Created instance: ${instanceId} for agent type: ${agentType}`);
    return instanceId;
  }

  /**
   * Get instance config for external wrapper creation
   */
  getInstanceConfig(instanceId: string): any {
    for (const entry of this.agents.values()) {
      const instance = entry.instances.get(instanceId);
      if (instance) {
        return instance.config;
      }
    }
    return null;
  }

  /**
   * Update instance status (called by wrapper)
   */
  updateInstanceStatus(instanceId: string, status: 'idle' | 'busy' | 'offline'): void {
    for (const entry of this.agents.values()) {
      const instance = entry.instances.get(instanceId);
      if (instance) {
        instance.status = status;
        instance.lastActivity = new Date();
        return;
      }
    }
  }

  /**
   * Get all registered agent types
   */
  getAgentTypes(): string[] {
    return Array.from(this.agents.keys());
  }

  /**
   * Get all instances for a specific agent type
   */
  getInstances(agentType: string): AgentInstance[] {
    const entry = this.agents.get(agentType);
    if (!entry) {
      return [];
    }
    return Array.from(entry.instances.values());
  }

  /**
   * Get a specific instance
   */
  getInstance(instanceId: string): AgentInstance | null {
    for (const entry of this.agents.values()) {
      const instance = entry.instances.get(instanceId);
      if (instance) {
        return instance;
      }
    }
    return null;
  }

  /**
   * Get all active instances across all agent types
   */
  getAllInstances(): AgentInstance[] {
    const allInstances: AgentInstance[] = [];
    for (const entry of this.agents.values()) {
      allInstances.push(...Array.from(entry.instances.values()));
    }
    return allInstances;
  }

  /**
   * Stop a specific instance
   */
  async stopInstance(instanceId: string): Promise<void> {
    for (const entry of this.agents.values()) {
      const instance = entry.instances.get(instanceId);
      if (instance) {
        // TODO: Stop the actual agent wrapper
        entry.instances.delete(instanceId);
        console.log(`Stopped instance: ${instanceId}`);
        return;
      }
    }
    throw new Error(`Instance not found: ${instanceId}`);
  }

  /**
   * Stop all instances for an agent type
   */
  async stopAgentType(agentType: string): Promise<void> {
    const entry = this.agents.get(agentType);
    if (!entry) {
      return;
    }

    for (const instanceId of entry.instances.keys()) {
      await this.stopInstance(instanceId);
    }
  }

  /**
   * Get registry status for monitoring
   */
  getRegistryStatus(): any {
    const status: any = {
      totalAgentTypes: this.agents.size,
      totalInstances: 0,
      agents: {}
    };

    for (const [agentType, entry] of this.agents.entries()) {
      const instances = Array.from(entry.instances.values());
      status.totalInstances += instances.length;
      status.agents[agentType] = {
        instanceCount: instances.length,
        instances: instances.map(inst => ({
          instanceId: inst.config.instanceId,
          status: inst.status,
          mailbox: inst.config.mailboxAddress
        }))
      };
    }

    return status;
  }

  /**
   * Discover agents by capability
   */
  discoverByCapability(capability: string): AgentInstance[] {
    const matchingInstances: AgentInstance[] = [];
    for (const entry of this.agents.values()) {
      for (const instance of entry.instances.values()) {
        if (instance.config.capabilities.includes(capability)) {
          matchingInstances.push(instance);
        }
      }
    }
    return matchingInstances;
  }
}