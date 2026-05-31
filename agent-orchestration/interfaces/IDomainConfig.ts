/**
 * Domain Config Interface
 * 
 * Defines the contract for domain configuration implementations.
 * Users can provide their own domain/persona configurations.
 */

export interface IDomainConfig {
  /**
   * Get a persona by ID
   */
  getPersona(personaId: string): any;

  /**
   * Get all personas
   */
  getAllPersonas(): any[];

  /**
   * Get personas by domain expertise
   */
  getPersonasByExpertise(expertise: string): any[];

  /**
   * Get agent type configuration
   */
  getAgentType(agentTypeId: string): any;

  /**
   * Get all agent types
   */
  getAllAgentTypes(): any[];
}