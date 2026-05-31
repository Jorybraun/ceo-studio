# IoC (Inversion of Control) Implementation

## Overview

The Agent Orchestration System now uses **Inversion of Control (IoC)** with **Dependency Injection** to make it completely framework-agnostic and customizable.

## What is IoC?

**Inversion of Control** is a design principle where the control of object creation and dependency management is inverted from the class itself to an external entity (the user/caller).

**Before (Tight Coupling):**
```typescript
class AgentOrchestrator {
  private memoryManager = new MemoryManager();     // Hardcoded
  private personaManager = new PersonaManager();   // Hardcoded
  // User cannot change these
}
```

**After (IoC/Dependency Injection):**
```typescript
class AgentOrchestrator {
  constructor(
    private memoryManager: IMemoryManager,      // Injected
    private personaManager: IPersonaManager    // Injected
  ) {}
  // User provides their own implementations
}
```

## Interfaces

The library defines interfaces for all major components:

### IMemoryManager
```typescript
interface IMemoryManager {
  generateMemoryKey(instanceId: string): string;
  storeMemory(instanceId: string, type: string, content: any): void;
  retrieveMemory(instanceId: string, type?: string): any[];
  getMemory(instanceId: string, type: string): any[];
  getMemoryKey(instanceId: string): string | null;
  deleteMemoryKey(instanceId: string): void;
  getMemoryStats(): any;
}
```

### IPersonaManager
```typescript
interface IPersonaManager {
  registerPersona(persona: any): void;
  getPersona(personaId: string): any;
  getAllPersonas(): any[];
  assignPersona(instanceId: string, personaId: string): void;
  getInstancePersona(instanceId: string): any;
  findPersonasByCapability(capability: string): any[];
  getPersonaStats(): any;
}
```

### IDomainConfig
```typescript
interface IDomainConfig {
  getPersona(personaId: string): any;
  getAllPersonas(): any[];
  getPersonasByExpertise(expertise: string): any[];
  getAgentType(agentTypeId: string): any;
  getAllAgentTypes(): any[];
}
```

## Default Implementations

The library provides default implementations:

- **MemoryManager** - In-memory storage
- **PersonaManager** - In-memory persona management
- **DomainConfig** - Generic domain configuration

## Usage Examples

### 1. Default Usage (No Customization)

```typescript
import { AgentOrchestrator } from 'agent-orchestration';

// Uses default implementations
const orchestrator = new AgentOrchestrator();
await orchestrator.initialize();
```

### 2. Custom Memory Manager

```typescript
import { AgentOrchestrator, IMemoryManager } from 'agent-orchestration';

class RedisMemoryManager implements IMemoryManager {
  private redisClient: any;
  
  constructor(redisClient: any) {
    this.redisClient = redisClient;
  }
  
  generateMemoryKey(instanceId: string): string {
    return `agent:${instanceId}`;
  }
  
  storeMemory(instanceId: string, type: string, content: any): void {
    const key = this.generateMemoryKey(instanceId);
    this.redisClient.hset(key, type, JSON.stringify(content));
  }
  
  retrieveMemory(instanceId: string, type?: string): any[] {
    const key = this.generateMemoryKey(instanceId);
    const data = this.redisClient.hgetall(key);
    return type ? [data[type]] : Object.values(data);
  }
  
  getMemory(instanceId: string, type: string): any[] {
    return this.retrieveMemory(instanceId, type);
  }
  
  getMemoryKey(instanceId: string): string | null {
    return `agent:${instanceId}`;
  }
  
  deleteMemoryKey(instanceId: string): void {
    const key = this.generateMemoryKey(instanceId);
    this.redisClient.del(key);
  }
  
  getMemoryStats(): any {
    return { storage: 'redis' };
  }
}

const redisClient = createRedisClient();
const orchestrator = new AgentOrchestrator({
  memoryManager: new RedisMemoryManager(redisClient)
});
await orchestrator.initialize();
```

### 3. Custom Persona Manager

```typescript
import { AgentOrchestrator, IPersonaManager } from 'agent-orchestration';

class DatabasePersonaManager implements IPersonaManager {
  private db: any;
  
  constructor(db: any) {
    this.db = db;
  }
  
  registerPersona(persona: any): void {
    this.db.personas.insert(persona);
  }
  
  getPersona(personaId: string): any {
    return this.db.personas.findOne({ id: personaId });
  }
  
  getAllPersonas(): any[] {
    return this.db.personas.find().toArray();
  }
  
  assignPersona(instanceId: string, personaId: string): void {
    this.db.assignments.insert({ instanceId, personaId, assignedAt: new Date() });
  }
  
  getInstancePersona(instanceId: string): any {
    const assignment = this.db.assignments.findOne({ instanceId });
    return assignment ? this.getPersona(assignment.personaId) : null;
  }
  
  findPersonasByCapability(capability: string): any[] {
    return this.db.personas.find({ capabilities: capability }).toArray();
  }
  
  getPersonaStats(): any {
    return { storage: 'database', count: this.db.personas.count() };
  }
}

const db = createDatabaseConnection();
const orchestrator = new AgentOrchestrator({
  personaManager: new DatabasePersonaManager(db)
});
await orchestrator.initialize();
```

### 4. Multiple Custom Dependencies

```typescript
import { AgentOrchestrator, IMemoryManager, IPersonaManager } from 'agent-orchestration';

const orchestrator = new AgentOrchestrator({
  memoryManager: new RedisMemoryManager(redisClient),
  personaManager: new DatabasePersonaManager(db),
  enableLogging: true,
  enableDomainIsolation: true,
  enableLifecycleManagement: true
});
await orchestrator.initialize();
```

### 5. Mix of Default and Custom

```typescript
// Use custom memory manager, default persona manager
const orchestrator = new AgentOrchestrator({
  memoryManager: new RedisMemoryManager(redisClient),
  // personaManager will use default
  enableLogging: true
});
await orchestrator.initialize();
```

## Benefits

### 1. Framework Agnostic
- No hardcoded dependencies on specific tools (Hermes, gbrain, etc.)
- Works with any storage backend (Redis, database, file system, etc.)
- Compatible with any persona system

### 2. Complete Customization
- Users have full control over all major components
- Can implement custom storage, personas, domains
- No "ruining" of the library - users provide their own implementations

### 3. Backward Compatible
- Default implementations work out of the box
- Gradual migration path from defaults to custom
- No breaking changes for existing users

### 4. Testable
- Easy to mock dependencies for testing
- Can inject test implementations
- Isolated unit testing possible

### 5. Extensible
- New implementations can be added without modifying library
- Plugin architecture for extensions
- Future-proof design

## Testing

Run the IoC test to see it in action:

```bash
npm run test:ioc
```

This test demonstrates:
- Default constructor with default implementations
- Custom memory manager injection
- Custom persona manager injection
- Multiple custom dependencies
- Mix of default and custom

## Configuration Options

```typescript
interface OrchestratorConfig {
  // Core options
  logDir?: string;
  enableLogging?: boolean;
  enableDomainIsolation?: boolean;
  enableLifecycleManagement?: boolean;
  
  // IoC: Dependency injection
  memoryManager?: IMemoryManager;
  personaManager?: IPersonaManager;
  domainConfig?: IDomainConfig;
}
```

## Real-World Examples

### Tmux-Specific Implementation

```typescript
class TmuxMemoryManager implements IMemoryManager {
  // Store memory in tmux sessions
  storeMemory(instanceId: string, type: string, content: any): void {
    const sessionName = `agent-${instanceId}`;
    exec(`tmux set-option -g -t ${sessionName} ${type} '${JSON.stringify(content)}'`);
  }
}

class TmuxPersonaManager implements IPersonaManager {
  // Manage personas via tmux session properties
  assignPersona(instanceId: string, personaId: string): void {
    const sessionName = `agent-${instanceId}`;
    exec(`tmux set-option -g -t ${sessionName} persona ${personaId}`);
  }
}

const orchestrator = new AgentOrchestrator({
  memoryManager: new TmuxMemoryManager(),
  personaManager: new TmuxPersonaManager()
});
```

### Database Implementation

```typescript
class PostgresMemoryManager implements IMemoryManager {
  private pool: any;
  
  async storeMemory(instanceId: string, type: string, content: any): void {
    await this.pool.query(
      'INSERT INTO agent_memory (instance_id, type, content) VALUES ($1, $2, $3)',
      [instanceId, type, JSON.stringify(content)]
    );
  }
  
  async retrieveMemory(instanceId: string, type?: string): any[] {
    const query = type
      ? 'SELECT content FROM agent_memory WHERE instance_id = $1 AND type = $2'
      : 'SELECT content FROM agent_memory WHERE instance_id = $1';
    const result = await this.pool.query(query, type ? [instanceId, type] : [instanceId]);
    return result.rows.map(row => JSON.parse(row.content));
  }
}
```

## Migration Guide

### From Default to Custom

**Step 1:** Identify the component you want to customize
```typescript
// Current: Using default memory manager
const orchestrator = new AgentOrchestrator();
```

**Step 2:** Implement the interface
```typescript
class MyCustomMemoryManager implements IMemoryManager {
  // Implement all interface methods
}
```

**Step 3:** Inject your implementation
```typescript
const orchestrator = new AgentOrchestrator({
  memoryManager: new MyCustomMemoryManager()
});
```

**Step 4:** Test thoroughly
```bash
npm run test:ioc
```

## Conclusion

The IoC implementation makes the Agent Orchestration System:

- ✅ **Framework-agnostic** - No dependencies on specific tools
- ✅ **Fully customizable** - Users control all dependencies
- ✅ **Backward compatible** - Defaults work out of the box
- ✅ **Production-ready** - Tested and documented
- ✅ **Future-proof** - Extensible architecture

Users can now integrate the library with any system (tmux, Hermes, custom) without modifying the library code.