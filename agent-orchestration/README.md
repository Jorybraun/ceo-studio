# Agent Orchestration System

A powerful, protocol-agnostic agent orchestration library for managing multi-agent systems with domain isolation, lifecycle management, pluggable architecture, and **Inversion of Control (IoC)** for complete customization.

## Features

- 🚀 **Protocol Agnostic** - Support CLI, REST, WebSocket, and custom agent protocols
- 🔄 **Lifecycle Management** - Wake/sleep/start/stop agents on-demand
- 🏗️ **Domain Isolation** - Separate contexts and memory per domain
- 💾 **Memory Management** - Agent-specific memory with unique keys
- 🎭 **Persona System** - Dynamic personality assignment for agents
- 📊 **Conversation Logging** - Real-time logging and audit trails
- 🔌 **Plugin System** - Easy integration of new agent types
- 🌐 **Agent Discovery** - Capability-based agent discovery
- 📨 **Mailbox Communication** - Async message routing between agents
- 🎯 **Inversion of Control** - Dependency injection for complete customization

## Installation

```bash
npm install agent-orchestration
```

## Quick Start

### Default Usage

```typescript
import { AgentOrchestrator } from 'agent-orchestration';

// Initialize orchestrator with default implementations
const orchestrator = new AgentOrchestrator();
await orchestrator.initialize();

// Create agent instances
const devin1 = await orchestrator.createAgentInstance('devin');
const voiceAgent = await orchestrator.createAgentInstance('voice-agent');

// Wake up agents
await orchestrator.wakeUpAgent(devin1);
await orchestrator.wakeUpAgent(voiceAgent);

// Send messages between agents
await orchestrator.sendMessage(
  `${voiceAgent}@local`,
  `${devin1}@local`,
  { task: 'Help me debug this code' }
);

// Clean up
await orchestrator.stopAllAgents();
```

### Custom Dependencies (IoC)

```typescript
import { AgentOrchestrator, IMemoryManager } from 'agent-orchestration';

// Implement custom memory manager (e.g., Redis, database)
class RedisMemoryManager implements IMemoryManager {
  // Your custom implementation
}

// Inject custom dependencies
const orchestrator = new AgentOrchestrator({
  memoryManager: new RedisMemoryManager(redisClient),
  enableLogging: true
});
await orchestrator.initialize();
```

**See [IOC_DOCUMENTATION.md](IOC_DOCUMENTATION.md) for detailed IoC examples.**

## Architecture

### Core Components

- **AgentOrchestrator** - Central coordinator for all agent operations
- **AgentRegistry** - Agent type registration and instance tracking
- **MailboxRouter** - Async message routing between agents
- **MemoryManager** - Agent-specific memory and state management
- **PersonaManager** - Dynamic personality assignment
- **DomainIsolation** - Domain-specific contexts and isolation
- **AgentLifecycleManager** - Wake/sleep/start/stop agent lifecycle
- **ConversationLogger** - Real-time conversation logging

### Interfaces (for IoC)

- **IMemoryManager** - Interface for custom memory implementations
- **IPersonaManager** - Interface for custom persona systems
- **IDomainConfig** - Interface for custom domain configurations

### Adapters

- **AgentAdapter** - Universal interface for all agent types
- **CLIAdapter** - CLI-based agents (Devin, etc.)
- **RESTAdapter** - REST API agents (OpenAI, Anthropic, etc.)
- **WebSocketAdapter** - Real-time WebSocket agents

### Plugins

- **AgentPlugin** - Plugin interface for agent registration
- **AgentPluginRegistry** - Dynamic plugin management
- **DevinPlugin** - Example CLI agent plugin
- **OpenAIPlugin** - Example REST API agent plugin

## Usage Examples

### Domain Isolation

```typescript
// Switch to CEO Studio domain
orchestrator.switchDomain('ceo-studio');

// Create agent in specific domain
const agent = await orchestrator.createAgentInstance('devin', {}, 'ceo-studio');

// Get domain statistics
const stats = orchestrator.getDomainStats();
```

### Lifecycle Management

```typescript
// Create agent (starts in DORMANT state)
const agent = await orchestrator.createAgentInstance('devin');

// Wake up agent when needed
await orchestrator.wakeUpAgent(agent);

// Put to sleep when idle
await orchestrator.sleepAgent(agent);

// Stop completely
await orchestrator.stopAgent(agent);
```

### Plugin System

```typescript
import { AgentPluginRegistry, DevinPlugin, OpenAIPlugin } from 'agent-orchestration';

// Create plugin registry
const registry = new AgentPluginRegistry();

// Register plugins
registry.registerPlugin(new DevinPlugin());
registry.registerPlugin(new OpenAIPlugin());

// Create adapter from plugin
const adapter = registry.createAdapter('openai', {
  apiKey: 'your-api-key',
  baseUrl: 'https://api.openai.com/v1'
});
```

### Conversation Logging

```typescript
// Get all conversation logs
const logs = orchestrator.getConversationLogs();

// Get conversation between specific agents
const conversation = orchestrator.getConversationBetween(
  'voice-agent@local',
  'devin-1@local'
);

// Print conversation thread
orchestrator.printConversationThread('voice-agent@local', 'devin-1@local');

// Export logs
orchestrator.exportConversationLogs('./conversations.json');
```

### Persona Management

```typescript
// Assign persona to agent
await orchestrator.assignPersona('devin-1', 'senior-architect');

// Get agent persona
const persona = orchestrator.getInstancePersona('devin-1');

// Find personas by capability
const technicalPersonas = orchestrator.findPersonasByCapability('planning');
```

## Configuration

### Orchestrator Options

```typescript
const orchestrator = new AgentOrchestrator(
  './logs',           // Log directory
  true,               // Enable logging
  true,               // Enable domain isolation
  true                // Enable lifecycle management
);
```

### Lifecycle Configuration

```typescript
orchestrator.updateLifecycleConfig({
  idleTimeout: 5 * 60 * 1000,      // 5 minutes
  sleepTimeout: 30 * 60 * 1000,    // 30 minutes
  maxInstances: 3,
  preWarmInstances: 0
});
```

## API Reference

### AgentOrchestrator

Main orchestrator class for managing agents.

#### Methods

- `initialize()` - Initialize the orchestrator
- `createAgentInstance(type, config, domain)` - Create agent instance
- `wakeUpAgent(instanceId)` - Wake up agent
- `sleepAgent(instanceId)` - Put agent to sleep
- `stopAgent(instanceId)` - Stop agent
- `sendMessage(from, to, payload)` - Send message between agents
- `switchDomain(domainId)` - Switch to specific domain
- `assignPersona(instanceId, personaId)` - Assign persona
- `getConversationLogs()` - Get all conversation logs
- `getDomainStats()` - Get domain statistics
- `getLifecycleStats()` - Get lifecycle statistics

### AgentAdapter

Universal interface for agent communication.

#### Methods

- `getProtocol()` - Get adapter protocol type
- `start()` - Start the agent
- `stop()` - Stop the agent
- `wakeUp()` - Wake up the agent
- `sleep()` - Put agent to sleep
- `sendRequest(request)` - Send request to agent
- `handleResponse(response)` - Handle response from agent
- `getCapabilities()` - Get agent capabilities
- `getMetadata()` - Get agent metadata

## Development

### Building

```bash
npm run build
```

### Testing

```bash
npm run test
```

### Linting

```bash
npm run lint
```

## Contributing

Contributions are welcome! Please read our contributing guidelines before submitting PRs.

## License

MIT License - see LICENSE file for details

## Philosophy

This library is designed to be:

- **Protocol Agnostic** - Work with any agent type/protocol
- **Hermes Independent** - No external dependencies required
- **Pluggable** - Easy to extend with plugins and adapters
- **Production Ready** - Tested and battle-tested
- **Developer Friendly** - Clean API and good documentation
- **Framework Agnostic** - Works with any system (tmux, Hermes, custom)
- **Fully Customizable** - IoC allows complete control over dependencies

## Inversion of Control (IoC)

The library uses **Inversion of Control** with **Dependency Injection** to allow complete customization:

- **No hardcoded dependencies** - All major components are injectable
- **Default implementations provided** - Works out of the box
- **Custom implementations supported** - Use Redis, database, tmux, etc.
- **Framework-agnostic** - No ties to specific tools or systems
- **Backward compatible** - Gradual migration from defaults to custom

**Detailed documentation:** [IOC_DOCUMENTATION.md](IOC_DOCUMENTATION.md)

## Testing

```bash
# Run full test suite
npm test

# Test IoC implementation
npm run test:ioc

# Test plugin system
npm run test:plugins
```

## Support

For issues, questions, or contributions, please visit our GitHub repository.