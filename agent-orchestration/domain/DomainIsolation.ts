/**
 * Domain Isolation - Ensures agents only load domain-relevant information
 * 
 * Provides:
 * - Domain-specific agent instances
 * - Domain-isolated memory stores
 * - Domain-specific context loading
 * - Clean agent initialization per domain
 */

import { MemoryManager } from '../memory/MemoryManager';
import { PersonaManager } from '../persona/PersonaManager';

export interface Domain {
  id: string;
  name: string;
  description: string;
  context: any;
  allowedAgentTypes: string[];
  allowedPersonas: string[];
  memoryNamespace: string;
}

export class DomainIsolation {
  private domains: Map<string, Domain> = new Map();
  private domainMemoryManagers: Map<string, MemoryManager> = new Map();
  private domainPersonaManagers: Map<string, PersonaManager> = new Map();
  private domainAgentInstances: Map<string, Set<string>> = new Map(); // domain -> set of instance IDs

  constructor() {
    this.initializeDefaultDomains();
  }

  /**
   * Initialize default domains (users should customize these)
   */
  private initializeDefaultDomains(): void {
    // Example: Development domain
    this.registerDomain({
      id: 'development',
      name: 'Development',
      description: 'Software development and implementation environment',
      context: {
        platform: 'Development',
        primaryFocus: 'implementation',
        environment: 'development'
      },
      allowedAgentTypes: ['worker', 'specialist', 'orchestrator'],
      allowedPersonas: ['senior', 'junior', 'specialist'],
      memoryNamespace: 'development'
    });

    // Example: Production domain
    this.registerDomain({
      id: 'production',
      name: 'Production',
      description: 'Production operations environment',
      context: {
        platform: 'Production',
        primaryFocus: 'operations',
        environment: 'production'
      },
      allowedAgentTypes: ['orchestrator', 'specialist'],
      allowedPersonas: ['senior', 'specialist'],
      memoryNamespace: 'production'
    });

    // Example: Testing domain
    this.registerDomain({
      id: 'testing',
      name: 'Testing',
      description: 'Testing and quality assurance environment',
      context: {
        platform: 'Testing',
        primaryFocus: 'quality-assurance',
        environment: 'testing'
      },
      allowedAgentTypes: ['worker', 'specialist'],
      allowedPersonas: ['junior', 'specialist'],
      memoryNamespace: 'testing'
    });
  }

  /**
   * Register a new domain
   */
  registerDomain(domain: Domain): void {
    this.domains.set(domain.id, domain);
    
    // Create domain-specific memory manager
    const memoryManager = new MemoryManager();
    this.domainMemoryManagers.set(domain.id, memoryManager);
    
    // Create domain-specific persona manager  
    const personaManager = new PersonaManager();
    this.domainPersonaManagers.set(domain.id, personaManager);
    
    // Initialize agent instance set for this domain
    this.domainAgentInstances.set(domain.id, new Set());
    
    console.log(`Registered domain: ${domain.name} (${domain.id})`);
  }

  /**
   * Get a domain by ID
   */
  getDomain(domainId: string): Domain | null {
    return this.domains.get(domainId) || null;
  }

  /**
   * Get all domains
   */
  getAllDomains(): Domain[] {
    return Array.from(this.domains.values());
  }

  /**
   * Get memory manager for a specific domain
   */
  getDomainMemoryManager(domainId: string): MemoryManager | null {
    return this.domainMemoryManagers.get(domainId) || null;
  }

  /**
   * Get persona manager for a specific domain
   */
  getDomainPersonaManager(domainId: string): PersonaManager | null {
    return this.domainPersonaManagers.get(domainId) || null;
  }

  /**
   * Check if an agent type is allowed in a domain
   */
  isAgentTypeAllowed(domainId: string, agentType: string): boolean {
    const domain = this.getDomain(domainId);
    if (!domain) {
      return false;
    }
    return domain.allowedAgentTypes.includes(agentType);
  }

  /**
   * Check if a persona is allowed in a domain
   */
  isPersonaAllowed(domainId: string, personaId: string): boolean {
    const domain = this.getDomain(domainId);
    if (!domain) {
      return false;
    }
    return domain.allowedPersonas.includes(personaId);
  }

  /**
   * Register an agent instance with a domain
   */
  registerAgentInstance(domainId: string, instanceId: string): void {
    const instances = this.domainAgentInstances.get(domainId);
    if (instances) {
      instances.add(instanceId);
      console.log(`Registered instance ${instanceId} with domain ${domainId}`);
    }
  }

  /**
   * Get all agent instances for a domain
   */
  getDomainAgentInstances(domainId: string): string[] {
    const instances = this.domainAgentInstances.get(domainId);
    return instances ? Array.from(instances) : [];
  }

  /**
   * Load domain-specific context for an agent
   */
  loadDomainContext(domainId: string): any {
    const domain = this.getDomain(domainId);
    if (!domain) {
      return null;
    }

    return {
      domain: domain.id,
      domainName: domain.name,
      context: domain.context,
      allowedAgentTypes: domain.allowedAgentTypes,
      allowedPersonas: domain.allowedPersonas,
      memoryNamespace: domain.memoryNamespace
    };
  }

  /**
   * Clean up domain resources
   */
  cleanupDomain(domainId: string): void {
    const instances = this.domainAgentInstances.get(domainId);
    if (instances) {
      instances.clear();
    }
    this.domainAgentInstances.delete(domainId);
    this.domainMemoryManagers.delete(domainId);
    this.domainPersonaManagers.delete(domainId);
    console.log(`Cleaned up domain: ${domainId}`);
  }

  /**
   * Get domain statistics
   */
  getDomainStats(): any {
    const stats: any = {
      totalDomains: this.domains.size,
      domains: []
    };

    for (const [domainId, domain] of this.domains.entries()) {
      const memoryManager = this.domainMemoryManagers.get(domainId);
      const personaManager = this.domainPersonaManagers.get(domainId);
      const instances = this.domainAgentInstances.get(domainId);

      stats.domains.push({
        id: domainId,
        name: domain.name,
        agentInstances: instances?.size || 0,
        memoryEntries: memoryManager?.getMemoryStats()?.totalMemoryEntries || 0,
        personaAssignments: personaManager?.getPersonaStats()?.totalAssignments || 0
      });
    }

    return stats;
  }
}