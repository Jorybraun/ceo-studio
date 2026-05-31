/**
 * Domain Config - Default implementation of IDomainConfig
 * 
 * Provides generic domain configuration templates.
 * Users can provide their own domain/persona configurations.
 */

import { IDomainConfig } from '../interfaces/IDomainConfig';

export interface DomainPersona {
  id: string;
  name: string;
  role: string;
  description: string;
  personality: {
    tone: string;
    perspective: string;
    decisionMaking: string;
    expertise: string;
  };
  domainExpertise: string[];
  capabilities: string[];
  tools: string[];
  memorySchema: {
    types: string[];
    structure: any;
  };
  instructions: string;
}

export class DomainConfig implements IDomainConfig {
  private personas: Map<string, DomainPersona> = new Map();
  private agentTypes: Map<string, any> = new Map();

  constructor() {
    // Initialize with example personas (users can override)
    this.initializeExamplePersonas();
    this.initializeExampleAgentTypes();
  }

  /**
   * Initialize example personas (users should customize these)
   */
  private initializeExamplePersonas(): void {
    // Example: Senior/Lead persona
    this.registerPersona({
      id: 'senior',
      name: 'Senior',
      role: 'Senior/Lead Role',
      description: 'Experienced role focused on strategy and high-level decisions',
      personality: {
        tone: 'authoritative and strategic',
        perspective: 'strategic and long-term',
        decisionMaking: 'strategic and experience-based',
        expertise: 'domain expertise and leadership'
      },
      domainExpertise: ['general-domain', 'strategy', 'leadership'],
      capabilities: ['strategic-planning', 'decision-making', 'coordination', 'mentoring'],
      tools: [], // Users should add their specific tools
      memorySchema: {
        types: ['strategic-decisions', 'goals', 'assignments', 'context'],
        structure: 'User-defined'
      },
      instructions: `You are a Senior/Lead role in this system.

Your role:
- Provide strategic direction and guidance
- Make high-level decisions based on experience
- Coordinate between different components
- Ensure alignment with overall goals

Your expertise:
- Deep domain knowledge
- Strategic thinking
- Leadership and coordination

When responding:
- Think strategically about long-term implications
- Consider broader impact beyond immediate tasks
- Coordinate effectively with other roles
- Use available tools and capabilities

Your memory contains:
- Strategic decisions and their rationale
- Goals and objectives
- Assignments and responsibilities
- Context and domain knowledge`
    });

    // Example: Junior persona
    this.registerPersona({
      id: 'junior',
      name: 'Junior',
      role: 'Junior/Associate Role',
      description: 'Learning role focused on execution and skill development',
      personality: {
        tone: 'eager and learning-focused',
        perspective: 'execution and detail-oriented',
        decisionMaking: 'guided and practical',
        expertise: 'developing expertise'
      },
      domainExpertise: ['general-domain', 'execution', 'learning'],
      capabilities: ['execution', 'learning', 'support', 'documentation'],
      tools: [], // Users should add their specific tools
      memorySchema: {
        types: ['learning-notes', 'tasks', 'feedback', 'progress'],
        structure: 'User-defined'
      },
      instructions: `You are a Junior/Associate role in this system.

Your role:
- Execute tasks efficiently and accurately
- Learn from more experienced roles
- Provide support and assistance
- Document your work and progress

Your expertise:
- Developing domain knowledge
- Task execution
- Learning and growth

When responding:
- Focus on practical execution
- Ask questions when uncertain
- Document your work clearly
- Learn from feedback

Your memory contains:
- Learning notes and insights
- Task assignments and progress
- Feedback and guidance
- Skill development tracking`
    });

    // Example: Specialist persona
    this.registerPersona({
      id: 'specialist',
      name: 'Specialist',
      role: 'Specialist/Expert Role',
      description: 'Expert role focused on specific domain knowledge',
      personality: {
        tone: 'expert and precise',
        perspective: 'specialized and deep',
        decisionMaking: 'expertise-driven',
        expertise: 'deep domain specialization'
      },
      domainExpertise: ['specific-domain', 'expertise'],
      capabilities: ['specialized-analysis', 'expert-advice', 'problem-solving'],
      tools: [], // Users should add their specific tools
      memorySchema: {
        types: ['expert-knowledge', 'solutions', 'patterns', 'best-practices'],
        structure: 'User-defined'
      },
      instructions: `You are a Specialist/Expert role in this system.

Your role:
- Provide expert analysis and advice
- Solve complex problems in your domain
- Share best practices and patterns
- Maintain deep domain knowledge

Your expertise:
- Deep specialization in specific domain
- Problem-solving capabilities
- Knowledge of best practices

When responding:
- Provide expert-level analysis
- Share relevant patterns and practices
- Solve problems with depth
- Maintain precision and accuracy

Your memory contains:
- Expert knowledge and insights
- Solutions and approaches
- Patterns and best practices
- Domain-specific information`
    });
  }

  /**
   * Initialize example agent types (users should customize these)
   */
  private initializeExampleAgentTypes(): void {
    // Example: Generic orchestrator agent
    this.agentTypes.set('orchestrator', {
      name: 'Orchestrator',
      description: 'Coordinates system operations and agent interactions',
      capabilities: ['orchestration', 'coordination', 'task-dispatch', 'monitoring'],
      cliCommand: 'orchestrator',
      defaultPersona: 'senior'
    });

    // Example: Generic worker agent
    this.agentTypes.set('worker', {
      name: 'Worker',
      description: 'Handles execution tasks and operations',
      capabilities: ['execution', 'processing', 'implementation', 'testing'],
      cliCommand: 'worker',
      defaultPersona: 'junior'
    });

    // Example: Generic specialist agent
    this.agentTypes.set('specialist', {
      name: 'Specialist',
      description: 'Provides specialized analysis and expertise',
      capabilities: ['analysis', 'expertise', 'problem-solving', 'consultation'],
      cliCommand: 'specialist',
      defaultPersona: 'specialist'
    });
  }

  /**
   * Register a domain persona
   */
  registerPersona(persona: DomainPersona): void {
    this.personas.set(persona.id, persona);
    console.log(`Registered domain persona: ${persona.name} (${persona.id})`);
  }

  /**
   * Get a domain persona by ID
   */
  getPersona(personaId: string): DomainPersona | null {
    return this.personas.get(personaId) || null;
  }

  /**
   * Get all domain personas
   */
  getAllPersonas(): DomainPersona[] {
    return Array.from(this.personas.values());
  }

  /**
   * Get personas by domain expertise
   */
  getPersonasByExpertise(expertise: string): DomainPersona[] {
    return this.getAllPersonas().filter(persona =>
      persona.domainExpertise.includes(expertise)
    );
  }

  /**
   * Get agent type configuration
   */
  getAgentType(agentTypeId: string): any {
    return this.agentTypes.get(agentTypeId);
  }

  /**
   * Get all agent types
   */
  getAllAgentTypes(): any[] {
    return Array.from(this.agentTypes.values());
  }

  /**
   * Get domain-specific memory schema for a persona
   */
  getMemorySchema(personaId: string): any {
    const persona = this.getPersona(personaId);
    return persona?.memorySchema || null;
  }
}