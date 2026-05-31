/**
 * Agent Orchestration System - Main Entry Point
 * 
 * This system provides:
 * - A2A-compliant wrapping for CLI agents
 * - Agent registry with discovery and instance tracking
 * - Mailbox-based async communication
 * - Multi-agent orchestration
 */

import { AgentOrchestrator } from './AgentOrchestrator';

async function main() {
  const orchestrator = new AgentOrchestrator();

  try {
    // Initialize the orchestrator
    await orchestrator.initialize();

    // Create some agent instances for testing
    console.log('\n=== Creating Agent Instances ===');
    
    const devin1 = await orchestrator.createAgentInstance('devin');
    console.log(`Created Devin instance: ${devin1}`);

    const devin2 = await orchestrator.createAgentInstance('devin');
    console.log(`Created Devin instance: ${devin2}`);

    // Show system status
    console.log('\n=== System Status ===');
    console.log(JSON.stringify(orchestrator.getAllAgents(), null, 2));

    // Test messaging
    console.log('\n=== Testing Agent Communication ===');
    const messageId = await orchestrator.sendMessage(
      'voice-agent@local',
      'devin-1@local',
      { task: 'Plan the architecture for the agent orchestration system' }
    );
    console.log(`Message sent: ${messageId}`);

    // Find agents by capability
    console.log('\n=== Agents with Planning Capability ===');
    const planningAgents = orchestrator.getAgentsByCapability('planning');
    console.log(planningAgents.map(agent => agent.config.instanceId));

    // Keep running for demonstration
    console.log('\nAgent Orchestration System running. Press Ctrl+C to stop.');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      console.log('\nShutting down...');
      await orchestrator.shutdown();
      process.exit(0);
    });

  } catch (error) {
    console.error('Error in agent orchestration system:', error);
    await orchestrator.shutdown();
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

export { AgentOrchestrator } from './AgentOrchestrator';
export { AgentRegistry } from './registry/AgentRegistry';
export { MailboxRouter } from './mailbox/MailboxRouter';

// Interfaces (for IoC)
export { IMemoryManager } from './interfaces/IMemoryManager';
export { IPersonaManager } from './interfaces/IPersonaManager';
export { IDomainConfig } from './interfaces/IDomainConfig';

// Default implementations
export { MemoryManager } from './memory/MemoryManager';
export { PersonaManager } from './persona/PersonaManager';
export { DomainConfig } from './domain/DomainConfig';

// Core features
export { ConversationLogger } from './logging/ConversationLogger';
export { DomainIsolation } from './domain/DomainIsolation';
export { AgentLifecycleManager, AgentState } from './lifecycle/AgentLifecycleManager';

// Base classes
export { BaseAgentWrapper } from './base/BaseAgentWrapper';

// Example agents (can be removed/moved to examples)
export { DevinWrapper } from './agents/DevinWrapper';
export { VoiceAgentWrapper } from './agents/VoiceAgentWrapper';

// Adapters
export { AgentAdapter, AgentMetadata, AgentRequest, AgentResponse } from './adapters/AgentAdapter';
export { CLIAdapter, CLIAdapterConfig } from './adapters/CLIAdapter';
export { RESTAdapter, RESTAdapterConfig } from './adapters/RESTAdapter';

// Plugins
export { AgentPlugin, AgentPluginConfig, AgentPluginRegistry } from './plugins/AgentPlugin';
export { DevinPlugin } from './plugins/DevinPlugin';
export { OpenAIPlugin } from './plugins/OpenAIPlugin';