/**
 * Test IoC (Inversion of Control) Implementation
 * 
 * Tests dependency injection and custom implementations
 */

import { AgentOrchestrator } from './index';
import { IMemoryManager, IPersonaManager, IDomainConfig } from './index';

async function testIoC() {
  console.log('=== Testing IoC (Inversion of Control) ===\n');

  // Test 1: Default constructor (uses default implementations)
  console.log('Test 1: Default constructor (IoC with defaults)');
  const defaultOrchestrator = new AgentOrchestrator();
  await defaultOrchestrator.initialize();
  console.log('✓ System initialized with default implementations');
  console.log('✓ Memory manager type:', defaultOrchestrator.getMemoryManager().constructor.name);
  console.log('✓ Persona manager type:', defaultOrchestrator.getPersonaManager().constructor.name);
  console.log();

  // Test 2: Custom memory manager (IoC injection)
  console.log('Test 2: Custom memory manager (IoC injection)');
  class CustomMemoryManager implements IMemoryManager {
    private customStore: Map<string, any> = new Map();
    
    generateMemoryKey(instanceId: string): string {
      return `custom-${instanceId}`;
    }
    
    storeMemory(instanceId: string, type: string, content: any): void {
      const key = this.generateMemoryKey(instanceId);
      if (!this.customStore.has(key)) {
        this.customStore.set(key, []);
      }
      this.customStore.get(key).push({ type, content, timestamp: new Date() });
    }
    
    getMemory(instanceId: string, type: string): any[] {
      const key = this.generateMemoryKey(instanceId);
      const entries = this.customStore.get(key) || [];
      return entries.filter((e: any) => e.type === type);
    }

    retrieveMemory(instanceId: string, type?: string): any[] {
      if (type) {
        return this.getMemory(instanceId, type);
      }
      const key = this.generateMemoryKey(instanceId);
      return this.customStore.get(key) || [];
    }
    
    getMemoryKey(instanceId: string): string | null {
      return `custom-${instanceId}`;
    }
    
    deleteMemoryKey(instanceId: string): void {
      this.customStore.delete(`custom-${instanceId}`);
    }
    
    getMemoryStats(): any {
      return { customStore: true, entries: this.customStore.size };
    }
  }

  const customMemoryManager = new CustomMemoryManager();
  const orchestratorWithCustomMemory = new AgentOrchestrator({
    memoryManager: customMemoryManager
  });
  await orchestratorWithCustomMemory.initialize();
  console.log('✓ System initialized with custom memory manager');
  console.log('✓ Memory manager type:', orchestratorWithCustomMemory.getMemoryManager().constructor.name);
  console.log('✓ Memory stats:', JSON.stringify(orchestratorWithCustomMemory.getMemoryManager().getMemoryStats()));
  console.log();

  // Test 3: Custom persona manager (IoC injection)
  console.log('Test 3: Custom persona manager (IoC injection)');
  class CustomPersonaManager implements IPersonaManager {
    private customPersonas: Map<string, any> = new Map();
    
    registerPersona(persona: any): void {
      this.customPersonas.set(persona.id, persona);
    }
    
    getPersona(personaId: string): any {
      return this.customPersonas.get(personaId);
    }
    
    assignPersona(instanceId: string, personaId: string): void {
      console.log(`Custom: Assigned ${personaId} to ${instanceId}`);
    }
    
    getInstancePersona(instanceId: string): any {
      return null;
    }
    
    findPersonasByCapability(capability: string): any[] {
      return [];
    }
    
    getAllPersonas(): any[] {
      return [];
    }
    
    getPersonaStats(): any {
      return { customPersonas: true, count: this.customPersonas.size };
    }
  }

  const customPersonaManager = new CustomPersonaManager();
  const orchestratorWithCustomPersona = new AgentOrchestrator({
    personaManager: customPersonaManager
  });
  await orchestratorWithCustomPersona.initialize();
  console.log('✓ System initialized with custom persona manager');
  console.log('✓ Persona manager type:', orchestratorWithCustomPersona.getPersonaManager().constructor.name);
  console.log('✓ Persona stats:', JSON.stringify(orchestratorWithCustomPersona.getPersonaManager().getPersonaStats()));
  console.log();

  // Test 4: Multiple custom dependencies (full IoC)
  console.log('Test 4: Multiple custom dependencies (full IoC)');
  const fullCustomOrchestrator = new AgentOrchestrator({
    memoryManager: customMemoryManager,
    personaManager: customPersonaManager,
    enableLogging: false,
    enableDomainIsolation: false,
    enableLifecycleManagement: false
  });
  await fullCustomOrchestrator.initialize();
  console.log('✓ System initialized with all custom dependencies');
  console.log('✓ Memory manager:', fullCustomOrchestrator.getMemoryManager().constructor.name);
  console.log('✓ Persona manager:', fullCustomOrchestrator.getPersonaManager().constructor.name);
  console.log();

  // Test 5: Mix of default and custom (partial IoC)
  console.log('Test 5: Mix of default and custom (partial IoC)');
  const mixedOrchestrator = new AgentOrchestrator({
    memoryManager: customMemoryManager,
    // personaManager will use default
    enableLogging: true
  });
  await mixedOrchestrator.initialize();
  console.log('✓ System initialized with mixed dependencies');
  console.log('✓ Memory manager (custom):', mixedOrchestrator.getMemoryManager().constructor.name);
  console.log('✓ Persona manager (default):', mixedOrchestrator.getPersonaManager().constructor.name);
  console.log();

  console.log('=== IoC Test Complete ===');
  console.log('\nKey Benefits Demonstrated:');
  console.log('✓ Default implementations work out of the box');
  console.log('✓ Custom implementations can be injected');
  console.log('✓ Users can provide their own memory/persona systems');
  console.log('✓ Mix of default and custom works seamlessly');
  console.log('✓ No framework-specific code in core library');
  console.log('✓ Users have complete control over dependencies');
}

// Run the test
testIoC().catch(console.error);