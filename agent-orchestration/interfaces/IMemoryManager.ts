/**
 * Memory Manager Interface
 * 
 * Defines the contract for memory management implementations.
 * Users can provide their own implementations (Redis, database, etc.)
 */

export interface IMemoryManager {
  /**
   * Generate a unique memory key for an agent instance
   */
  generateMemoryKey(instanceId: string): string;

  /**
   * Store memory for an agent instance
   */
  storeMemory(instanceId: string, type: string, content: any): void;

  /**
   * Retrieve memory for an agent instance
   */
  retrieveMemory(instanceId: string, type?: string): any[];

  /**
   * Get memory for an agent instance (alias for retrieveMemory)
   */
  getMemory(instanceId: string, type: string): any[];

  /**
   * Get memory key for an instance
   */
  getMemoryKey(instanceId: string): string | null;

  /**
   * Delete memory key for an instance
   */
  deleteMemoryKey(instanceId: string): void;

  /**
   * Get memory statistics
   */
  getMemoryStats(): any;
}