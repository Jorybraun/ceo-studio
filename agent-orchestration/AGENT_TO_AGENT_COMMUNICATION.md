# Agent-to-Agent Communication Guide

## Overview

The Agent Orchestration System has **complete agent-to-agent (A2A) communication** built-in via the MailboxRouter system. Agents can communicate with each other asynchronously using a mailbox-based messaging system.

## How It Works

### Architecture

```
Agent A                    MailboxRouter                    Agent B
   |                            |                             |
   |  sendMessage(to, payload)  |                             |
   |-------------------------->|                             |
   |                            |  routeMessage(to, payload)   |
   |                            |---------------------------->|
   |                            |                             |  processRequest()
   |                            |                             |  generateResponse()
   |                            |                             |
   |                            |  sendResponse(from, payload) |
   |                            |<----------------------------|
   |  receiveResponse()         |                             |
   |<--------------------------|                             |
```

### Components

1. **MailboxRouter** - Routes messages between agents
2. **Mailbox** - Each agent has a unique mailbox address
3. **Subscription** - Agents subscribe to their mailboxes
4. **Message** - Structured communication (request/response)

## Usage Examples

### Basic Agent-to-Agent Communication

```typescript
import { AgentOrchestrator } from 'agent-orchestration';

const orchestrator = new AgentOrchestrator();
await orchestrator.initialize();

// Create two agents
const agent1 = await orchestrator.createAgentInstance('devin');
const agent2 = await orchestrator.createAgentInstance('voice-agent');

// Wake them up
await orchestrator.wakeUpAgent(agent1);
await orchestrator.wakeUpAgent(agent2);

// Agent 2 sends a message to Agent 1
await orchestrator.sendMessage(
  `${agent2}@local`,           // From: voice-agent-1@local
  `${agent1}@local`,           // To: devin-1@local
  { task: 'Help me debug this code' }
);

// Agent 1 receives the message, processes it, and responds
// Response is automatically routed back to Agent 2
```

### Multi-Agent Conversation

```typescript
// Create multiple agents
const orchestrator = new AgentOrchestrator();
await orchestrator.initialize();

const devin = await orchestrator.createAgentInstance('devin');
const voiceAgent = await orchestrator.createAgentInstance('voice-agent');
const specialist = await orchestrator.createAgentInstance('specialist');

// Wake all agents
await orchestrator.wakeUpAgent(devin);
await orchestrator.wakeUpAgent(voiceAgent);
await orchestrator.wakeUpAgent(specialist);

// Voice agent asks Devin for help
await orchestrator.sendMessage(
  `${voiceAgent}@local`,
  `${devin}@local`,
  { task: 'Analyze this code for bugs' }
);

// Devin can ask the specialist for domain expertise
await orchestrator.sendMessage(
  `${devin}@local`,
  `${specialist}@local`,
  { question: 'What are the best practices for this?' }
);

// Specialist responds to Devin
// Devin responds to voice agent
// Full conversation chain is logged
```

### Broadcast Communication

```typescript
// Send message to multiple agents
const agents = ['devin-1', 'devin-2', 'specialist-1'];
const message = { task: 'Review this PR' };

for (const agent of agents) {
  await orchestrator.sendMessage(
    'coordinator@local',
    `${agent}@local`,
    message
  );
}
```

## Message Structure

### Request Message
```typescript
{
  id: string;              // Unique message ID
  from: string;            // Sender mailbox address
  to: string;              // Receiver mailbox address
  payload: any;            // Message content
  timestamp: Date;         // When sent
  messageType: 'request';  // Message type
}
```

### Response Message
```typescript
{
  id: string;              // Unique message ID
  from: string;            // Sender mailbox address
  to: string;              // Receiver mailbox address
  payload: any;            // Response content
  timestamp: Date;         // When sent
  messageType: 'response'; // Message type
  duration: number;       // Processing time in ms
}
```

## Real-World Examples

### Example 1: Code Review Workflow

```typescript
// Voice agent asks Devin to review code
await orchestrator.sendMessage(
  'voice-agent@local',
  'devin-1@local',
  {
    task: 'Review this pull request',
    files: ['src/component.ts', 'tests/component.test.ts'],
    requirements: ['security', 'performance', 'readability']
  }
);

// Devin processes and responds with review
// Response automatically routed back to voice agent
```

### Example 2: Multi-Agent Problem Solving

```typescript
// Coordinator assigns task to Devin
await orchestrator.sendMessage(
  'coordinator@local',
  'devin-1@local',
  { task: 'Fix authentication bug' }
);

// Devin realizes it needs domain expertise
await orchestrator.sendMessage(
  'devin-1@local',
  'specialist-1@local',
  { question: 'What are the OAuth2 best practices?' }
);

// Specialist provides guidance
// Devin implements fix
// Devin responds to coordinator
```

### Example 3: Parallel Processing

```typescript
// Send task to multiple agents in parallel
const tasks = [
  { task: 'Analyze frontend', agent: 'devin-1' },
  { task: 'Analyze backend', agent: 'devin-2' },
  { task: 'Analyze database', agent: 'specialist-1' }
];

const promises = tasks.map(({ task, agent }) =>
  orchestrator.sendMessage(
    'coordinator@local',
    `${agent}@local`,
    { task }
  )
);

await Promise.all(promises);
```

## Conversation Logging

All agent-to-agent communication is automatically logged:

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

## Advanced Features

### 1. Message Filtering

```typescript
// Filter messages by type
const requests = logs.filter(log => log.messageType === 'request');
const responses = logs.filter(log => log.messageType === 'response');
```

### 2. Conversation Analysis

```typescript
// Get conversation statistics
const stats = orchestrator.getConversationStats();
console.log(`Total messages: ${stats.totalMessages}`);
console.log(`Average response time: ${stats.avgResponseTime}ms`);
```

### 3. Message Prioritization

```typescript
// Send high-priority message
await orchestrator.sendMessage(
  'urgent@local',
  'devin-1@local',
  { task: 'Critical bug fix', priority: 'high' }
);
```

### 4. Async/Await Pattern

```typescript
// Send message and wait for response
const response = await orchestrator.sendMessage(
  'agent-a@local',
  'agent-b@local',
  { task: 'Process this data' }
);

console.log('Response:', response);
```

## Testing A2A Communication

The test suite already includes comprehensive A2A communication tests:

```bash
npm run test
```

**Test 6** specifically tests:
- Agent-to-agent message sending
- Request/response cycles
- Back-and-forth communication
- Conversation logging
- Multi-agent coordination

## Current Implementation Status

✅ **Fully Implemented:**
- MailboxRouter for message routing
- Unique mailbox addresses per agent
- Request/response message types
- Automatic message routing
- Conversation logging
- Multi-agent support
- Async communication
- Message filtering and analysis

✅ **Tested and Working:**
- Basic A2A communication
- Multi-agent conversations
- Back-and-forth communication
- Conversation logging
- Message tracking

## What You Can Do Right Now

```typescript
// 1. Create agents
const orchestrator = new AgentOrchestrator();
await orchestrator.initialize();

const agent1 = await orchestrator.createAgentInstance('devin');
const agent2 = await orchestrator.createAgentInstance('voice-agent');

// 2. Wake them up
await orchestrator.wakeUpAgent(agent1);
await orchestrator.wakeUpAgent(agent2);

// 3. Communicate
await orchestrator.sendMessage(
  `${agent2}@local`,
  `${agent1}@local`,
  { task: 'Your message here' }
);

// 4. Monitor conversations
const logs = orchestrator.getConversationLogs();
console.log(logs);
```

## Next Steps

The A2A communication system is **fully functional**. You can:

1. Use it immediately for agent coordination
2. Extend with custom message types
3. Add message encryption
4. Implement message queuing
5. Add message priorities
6. Implement broadcast patterns
7. Add conversation context management

The foundation is solid and ready for production use!