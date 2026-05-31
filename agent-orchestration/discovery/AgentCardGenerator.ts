/**
 * Agent Card Generator - Creates A2A Agent Cards for agent discovery
 * 
 * Provides:
 * - Agent Card generation following A2A specification
 * - Capability advertisement
 * - Endpoint information
 * - Instance metadata
 */

import { AgentInstance } from '../base/BaseAgentWrapper';

export interface AgentCard {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  instanceId: string;
  memoryKey: string;
  mailboxAddress: string;
  endpoints: {
    a2a: string;
    inbox: string;
    outbox: string;
    health: string;
  };
  metadata: {
    status: 'idle' | 'busy' | 'offline';
    lastActivity: string;
    processId?: number;
    uptime: number;
  };
  supportedOperations: string[];
  authentication?: {
    type: 'none' | 'bearer' | 'oauth2';
    token?: string;
  };
}

export class AgentCardGenerator {
  /**
   * Generate an Agent Card for an agent instance
   */
  generateAgentCard(instance: AgentInstance, port: number): AgentCard {
    const uptime = Date.now() - new Date(instance.config.instanceId.split('-')[1] || Date.now()).getTime();

    return {
      name: instance.config.name,
      version: instance.config.version,
      description: instance.config.description,
      capabilities: instance.config.capabilities,
      instanceId: instance.config.instanceId,
      memoryKey: instance.config.memoryKey || '',
      mailboxAddress: instance.config.mailboxAddress,
      endpoints: {
        a2a: `http://localhost:${port}/a2a`,
        inbox: `http://localhost:${port}/inbox`,
        outbox: `http://localhost:${port}/outbox`,
        health: `http://localhost:${port}/health`
      },
      metadata: {
        status: instance.status,
        lastActivity: instance.lastActivity.toISOString(),
        processId: instance.processId,
        uptime: uptime > 0 ? uptime : 0
      },
      supportedOperations: this.getSupportedOperations(instance.config.capabilities),
      authentication: {
        type: 'none' // Can be upgraded to bearer/oauth2
      }
    };
  }

  /**
   * Map capabilities to supported A2A operations
   */
  private getSupportedOperations(capabilities: string[]): string[] {
    const operations: string[] = [];

    const capabilityToOperation: Record<string, string> = {
      'planning': 'plan_task',
      'code-analysis': 'analyze_code',
      'debugging': 'debug_code',
      'implementation': 'implement_code',
      'gbrain-access': 'query_knowledge',
      'file-operations': 'file_operations',
      'conversation': 'converse',
      'voice-input': 'voice_input',
      'voice-output': 'voice_output',
      'context-management': 'manage_context',
      'document-analysis': 'analyze_document',
      'research': 'research',
      'summarization': 'summarize',
      'knowledge-extraction': 'extract_knowledge'
    };

    for (const capability of capabilities) {
      if (capabilityToOperation[capability]) {
        operations.push(capabilityToOperation[capability]);
      }
    }

    return operations;
  }

  /**
   * Generate Agent Card in JSON format for HTTP serving
   */
  generateAgentCardJSON(instance: AgentInstance, port: number): string {
    const card = this.generateAgentCard(instance, port);
    return JSON.stringify(card, null, 2);
  }

  /**
   * Validate an Agent Card
   */
  validateAgentCard(card: any): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!card.name || typeof card.name !== 'string') {
      errors.push('Invalid or missing name');
    }

    if (!card.version || typeof card.version !== 'string') {
      errors.push('Invalid or missing version');
    }

    if (!card.endpoints || typeof card.endpoints !== 'object') {
      errors.push('Invalid or missing endpoints');
    } else {
      if (!card.endpoints.a2a || typeof card.endpoints.a2a !== 'string') {
        errors.push('Invalid or missing A2A endpoint');
      }
    }

    if (!card.capabilities || !Array.isArray(card.capabilities)) {
      errors.push('Invalid or missing capabilities');
    }

    return {
      valid: errors.length === 0,
      errors
    };
  }

  /**
   * Generate a registry of all agent cards
   */
  generateAgentRegistry(instances: AgentInstance[]): Map<string, AgentCard> {
    const registry = new Map<string, AgentCard>();

    for (const instance of instances) {
      const port = this.getPortForInstance(instance.config.instanceId);
      const card = this.generateAgentCard(instance, port);
      registry.set(instance.config.instanceId, card);
    }

    return registry;
  }

  /**
   * Get port for instance (same logic as BaseAgentWrapper)
   */
  private getPortForInstance(instanceId: string): number {
    const basePort = 8000;
    const instanceHash = instanceId.split('-')[1] || '0';
    const port = basePort + parseInt(instanceHash);
    return isNaN(port) ? basePort + 9000 : port; // Fallback for non-numeric IDs
  }
}