/**
 * Persona Manager - Default implementation of IPersonaManager
 * 
 * Provides persona management for agent instances.
 * Users can provide their own persona systems.
 */

import { IPersonaManager } from '../interfaces/IPersonaManager';

export interface Persona {
  id: string;
  name: string;
  description: string;
  personality: {
    tone: string;
    communicationStyle: string;
    decisionMaking: string;
    expertise: string;
  };
  capabilities: string[];
  preferences: Record<string, any>;
  instructions: string;
}

export interface PersonaAssignment {
  instanceId: string;
  personaId: string;
  assignedAt: Date;
  customizations: Record<string, any>;
}

export class PersonaManager implements IPersonaManager {
  private personas: Map<string, Persona> = new Map();
  private assignments: Map<string, PersonaAssignment> = new Map();

  constructor() {
    this.initializeDefaultPersonas();
  }

  /**
   * Initialize default persona templates
   */
  private initializeDefaultPersonas(): void {
    // Senior Architect Persona
    this.registerPersona({
      id: 'senior-architect',
      name: 'Senior Architect',
      description: 'Experienced technical leader with strategic thinking and architectural expertise',
      personality: {
        tone: 'professional and authoritative',
        communicationStyle: 'clear, structured, and comprehensive',
        decisionMaking: 'strategic and long-term focused',
        expertise: 'system design, architecture patterns, technical leadership'
      },
      capabilities: ['planning', 'architecture', 'code-review', 'mentoring', 'strategic-thinking'],
      preferences: {
        responseLength: 'detailed',
        codeStyle: 'enterprise-grade',
        focus: 'scalability and maintainability'
      },
      instructions: `You are a Senior Architect with deep expertise in system design and technical leadership.
When responding:
- Think strategically about long-term implications
- Consider scalability, maintainability, and team growth
- Provide comprehensive architectural guidance
- Balance ideal solutions with practical constraints
- Mentor and explain technical decisions
- Focus on system-wide patterns and best practices`
    });

    // Junior Developer Persona
    this.registerPersona({
      id: 'junior-developer',
      name: 'Junior Developer',
      description: 'Eager developer focused on learning and implementation',
      personality: {
        tone: 'enthusiastic and curious',
        communicationStyle: 'clear and direct',
        decisionMaking: 'practical and implementation-focused',
        expertise: 'implementation, debugging, learning'
      },
      capabilities: ['implementation', 'debugging', 'learning', 'documentation'],
      preferences: {
        responseLength: 'concise',
        codeStyle: 'modern and clean',
        focus: 'getting things done'
      },
      instructions: `You are a Junior Developer eager to learn and implement solutions.
When responding:
- Focus on practical implementation
- Ask clarifying questions when uncertain
- Provide clear, working code
- Document your learning process
- Highlight areas where you want to improve
- Be honest about what you don't know`
    });

    // Specialist Persona
    this.registerPersona({
      id: 'specialist',
      name: 'Domain Specialist',
      description: 'Expert in specific domains with deep technical knowledge',
      personality: {
        tone: 'precise and technical',
        communicationStyle: 'detailed and accurate',
        decisionMaking: 'expert-driven and evidence-based',
        expertise: 'domain-specific deep knowledge'
      },
      capabilities: ['specialized-analysis', 'expert-consultation', 'deep-dive'],
      preferences: {
        responseLength: 'comprehensive',
        codeStyle: 'expert-level',
        focus: 'accuracy and depth'
      },
      instructions: `You are a Domain Specialist with deep expertise in specific technical areas.
When responding:
- Provide expert-level analysis and recommendations
- Use precise technical language
- Cite specific technical details and patterns
- Consider edge cases and advanced scenarios
- Share deep domain knowledge
- Focus on accuracy and technical depth`
    });

    // Friendly Assistant Persona
    this.registerPersona({
      id: 'friendly-assistant',
      name: 'Friendly Assistant',
      description: 'Helpful and approachable assistant focused on user experience',
      personality: {
        tone: 'friendly and supportive',
        communicationStyle: 'conversational and approachable',
        decisionMaking: 'user-centric and helpful',
        expertise: 'user experience, communication, problem-solving'
      },
      capabilities: ['conversation', 'explanation', 'guidance', 'support'],
      preferences: {
        responseLength: 'moderate',
        codeStyle: 'readable and commented',
        focus: 'clarity and helpfulness'
      },
      instructions: `You are a Friendly Assistant focused on helping users succeed.
When responding:
- Be approachable and supportive
- Explain concepts clearly and patiently
- Provide step-by-step guidance
- Anticipate user questions and concerns
- Focus on making complex topics accessible
- Encourage and support the user`
    });
  }

  /**
   * Register a new persona
   */
  registerPersona(persona: Persona): void {
    this.personas.set(persona.id, persona);
    console.log(`Registered persona: ${persona.name} (${persona.id})`);
  }

  /**
   * Get a persona by ID
   */
  getPersona(personaId: string): Persona | null {
    return this.personas.get(personaId) || null;
  }

  /**
   * Get all available personas
   */
  getAllPersonas(): Persona[] {
    return Array.from(this.personas.values());
  }

  /**
   * Assign a persona to an agent instance
   */
  assignPersona(instanceId: string, personaId: string, customizations: Record<string, any> = {}): void {
    const persona = this.getPersona(personaId);
    if (!persona) {
      throw new Error(`Persona not found: ${personaId}`);
    }

    const assignment: PersonaAssignment = {
      instanceId,
      personaId,
      assignedAt: new Date(),
      customizations
    };

    this.assignments.set(instanceId, assignment);
    console.log(`Assigned persona ${persona.name} to instance ${instanceId}`);
  }

  /**
   * Get the persona assigned to an instance
   */
  getAssignedPersona(instanceId: string): PersonaAssignment | null {
    return this.assignments.get(instanceId) || null;
  }

  /**
   * Get the actual Persona object for an instance
   */
  getInstancePersona(instanceId: string): Persona | null {
    const assignment = this.getAssignedPersona(instanceId);
    if (!assignment) {
      return null;
    }

    const persona = this.getPersona(assignment.personaId);
    if (!persona) {
      return null;
    }

    // Apply customizations if any
    if (Object.keys(assignment.customizations).length > 0) {
      return {
        ...persona,
        preferences: {
          ...persona.preferences,
          ...assignment.customizations
        }
      };
    }

    return persona;
  }

  /**
   * Remove persona assignment from an instance
   */
  removePersonaAssignment(instanceId: string): void {
    this.assignments.delete(instanceId);
    console.log(`Removed persona assignment from instance ${instanceId}`);
  }

  /**
   * Get persona-based instructions for an instance
   */
  getPersonaInstructions(instanceId: string): string {
    const persona = this.getInstancePersona(instanceId);
    if (!persona) {
      return '';
    }

    return `PERSONA: ${persona.name}
${persona.description}

Personality Traits:
- Tone: ${persona.personality.tone}
- Communication Style: ${persona.personality.communicationStyle}
- Decision Making: ${persona.personality.decisionMaking}
- Expertise: ${persona.personality.expertise}

Instructions:
${persona.instructions}

Preferences: ${JSON.stringify(persona.preferences, null, 2)}`;
  }

  /**
   * Get persona-based capabilities for an instance
   */
  getPersonaCapabilities(instanceId: string): string[] {
    const persona = this.getInstancePersona(instanceId);
    return persona ? persona.capabilities : [];
  }

  /**
   * Find personas by capability
   */
  findPersonasByCapability(capability: string): Persona[] {
    return this.getAllPersonas().filter(persona =>
      persona.capabilities.includes(capability)
    );
  }

  /**
   * Get persona statistics
   */
  getPersonaStats(): any {
    const stats: any = {
      totalPersonas: this.personas.size,
      totalAssignments: this.assignments.size,
      personas: [],
      assignments: []
    };

    for (const persona of this.personas.values()) {
      stats.personas.push({
        id: persona.id,
        name: persona.name,
        capabilityCount: persona.capabilities.length
      });
    }

    for (const assignment of this.assignments.values()) {
      const persona = this.getPersona(assignment.personaId);
      stats.assignments.push({
        instanceId: assignment.instanceId,
        personaName: persona?.name || 'Unknown',
        assignedAt: assignment.assignedAt
      });
    }

    return stats;
  }
}