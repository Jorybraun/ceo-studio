/**
 * Persona Manager Interface
 * 
 * Defines the contract for persona management implementations.
 * Users can provide their own persona systems.
 */

export interface IPersonaManager {
  /**
   * Register a persona
   */
  registerPersona(persona: any): void;

  /**
   * Get a persona by ID
   */
  getPersona(personaId: string): any;

  /**
   * Get all personas
   */
  getAllPersonas(): any[];

  /**
   * Assign persona to an agent instance
   */
  assignPersona(instanceId: string, personaId: string): void;

  /**
   * Get persona for an instance
   */
  getInstancePersona(instanceId: string): any;

  /**
   * Find personas by capability
   */
  findPersonasByCapability(capability: string): any[];

  /**
   * Get persona statistics
   */
  getPersonaStats(): any;
}