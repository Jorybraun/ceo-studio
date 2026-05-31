/**
 * Memory Manager - Default implementation of IMemoryManager
 * 
 * Provides in-memory storage for agent instances.
 * Users can provide their own implementations (Redis, database, etc.)
 */

import { randomUUID } from 'node:crypto';
import { IMemoryManager } from '../interfaces/IMemoryManager';

export interface MemoryEntry {
  key: string;
  instanceId: string;
  type: 'context' | 'preference' | 'state' | 'conversation';
  content: any;
  timestamp: Date;
  expiresAt?: Date;
}

export interface MemoryKey {
  instanceId: string;
  memoryKey: string;
  createdAt: Date;
  lastAccessed: Date;
}

export class MemoryManager implements IMemoryManager {
  private memoryKeys: Map<string, MemoryKey> = new Map();
  private memoryStore: Map<string, MemoryEntry[]> = new Map();
  private defaultTTL = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

  /**
   * Generate a unique memory key for an agent instance
   */
  generateMemoryKey(instanceId: string): string {
    const memoryKey = `mem-${instanceId}-${randomUUID()}`;
    
    this.memoryKeys.set(instanceId, {
      instanceId,
      memoryKey,
      createdAt: new Date(),
      lastAccessed: new Date()
    });

    console.log(`Generated memory key for ${instanceId}: ${memoryKey}`);
    return memoryKey;
  }

  /**
   * Get the memory key for an instance
   */
  getMemoryKey(instanceId: string): string | null {
    const keyData = this.memoryKeys.get(instanceId);
    if (!keyData) {
      return null;
    }

    // Update last accessed time
    keyData.lastAccessed = new Date();
    return keyData.memoryKey;
  }

  /**
   * Store memory entry for an instance
   */
  storeMemory(instanceId: string, type: MemoryEntry['type'], content: any, ttl?: number): void {
    const memoryKey = this.getMemoryKey(instanceId);
    if (!memoryKey) {
      throw new Error(`No memory key found for instance: ${instanceId}`);
    }

    const entry: MemoryEntry = {
      key: memoryKey,
      instanceId,
      type,
      content,
      timestamp: new Date(),
      expiresAt: ttl ? new Date(Date.now() + ttl) : new Date(Date.now() + this.defaultTTL)
    };

    if (!this.memoryStore.has(memoryKey)) {
      this.memoryStore.set(memoryKey, []);
    }

    this.memoryStore.get(memoryKey)!.push(entry);
    console.log(`Stored ${type} memory for ${instanceId} (key: ${memoryKey})`);
  }

  /**
   * Retrieve memory for an instance
   */
  retrieveMemory(instanceId: string, type?: MemoryEntry['type']): MemoryEntry[] {
    const memoryKey = this.getMemoryKey(instanceId);
    if (!memoryKey) {
      return [];
    }

    const entries = this.memoryStore.get(memoryKey) || [];
    
    // Filter by type if specified
    const filtered = type 
      ? entries.filter(entry => entry.type === type)
      : entries;

    // Filter out expired entries
    const now = new Date();
    const validEntries = filtered.filter(entry => 
      !entry.expiresAt || entry.expiresAt > now
    );

    return validEntries.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get latest memory entry of a specific type
   */
  getLatestMemory(instanceId: string, type: MemoryEntry['type']): MemoryEntry | null {
    const entries = this.retrieveMemory(instanceId, type);
    return entries.length > 0 ? entries[0] : null;
  }

  /**
   * Get memory for an instance (alias for retrieveMemory)
   */
  getMemory(instanceId: string, type: string): any[] {
    return this.retrieveMemory(instanceId, type as any);
  }

  /**
   * Clear memory for an instance
   */
  clearMemory(instanceId: string, type?: MemoryEntry['type']): void {
    const memoryKey = this.getMemoryKey(instanceId);
    if (!memoryKey) {
      return;
    }

    if (type) {
      // Clear only specific type
      const entries = this.memoryStore.get(memoryKey) || [];
      const filtered = entries.filter(entry => entry.type !== type);
      this.memoryStore.set(memoryKey, filtered);
    } else {
      // Clear all memory
      this.memoryStore.delete(memoryKey);
    }

    console.log(`Cleared ${type || 'all'} memory for ${instanceId}`);
  }

  /**
   * Delete memory key for an instance (when instance is destroyed)
   */
  deleteMemoryKey(instanceId: string): void {
    const memoryKey = this.getMemoryKey(instanceId);
    if (memoryKey) {
      this.memoryStore.delete(memoryKey);
      this.memoryKeys.delete(instanceId);
      console.log(`Deleted memory key for ${instanceId}`);
    }
  }

  /**
   * Clean up expired memory entries
   */
  cleanupExpiredMemory(): void {
    const now = new Date();
    let cleanedCount = 0;

    for (const [memoryKey, entries] of this.memoryStore.entries()) {
      const validEntries = entries.filter(entry => 
        !entry.expiresAt || entry.expiresAt > now
      );

      if (validEntries.length !== entries.length) {
        cleanedCount += entries.length - validEntries.length;
        
        if (validEntries.length === 0) {
          this.memoryStore.delete(memoryKey);
        } else {
          this.memoryStore.set(memoryKey, validEntries);
        }
      }
    }

    if (cleanedCount > 0) {
      console.log(`Cleaned up ${cleanedCount} expired memory entries`);
    }
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): any {
    const stats: any = {
      totalInstances: this.memoryKeys.size,
      totalMemoryEntries: 0,
      entriesByType: {} as Record<string, number>,
      instances: []
    };

    for (const [instanceId, keyData] of this.memoryKeys.entries()) {
      const entries = this.memoryStore.get(keyData.memoryKey) || [];
      stats.totalMemoryEntries += entries.length;

      const instanceStats: any = {
        instanceId,
        memoryKey: keyData.memoryKey,
        entryCount: entries.length,
        entriesByType: {} as Record<string, number>
      };

      for (const entry of entries) {
        stats.entriesByType[entry.type] = (stats.entriesByType[entry.type] || 0) + 1;
        instanceStats.entriesByType[entry.type] = (instanceStats.entriesByType[entry.type] || 0) + 1;
      }

      stats.instances.push(instanceStats);
    }

    return stats;
  }

  /**
   * Export memory for an instance (for backup/migration)
   */
  exportMemory(instanceId: string): MemoryEntry[] {
    return this.retrieveMemory(instanceId);
  }

  /**
   * Import memory for an instance (for restore/migration)
   */
  importMemory(instanceId: string, entries: MemoryEntry[]): void {
    const memoryKey = this.getMemoryKey(instanceId);
    if (!memoryKey) {
      throw new Error(`No memory key found for instance: ${instanceId}`);
    }

    for (const entry of entries) {
      // Update the entry to use the current memory key
      entry.key = memoryKey;
      entry.instanceId = instanceId;
      
      if (!this.memoryStore.has(memoryKey)) {
        this.memoryStore.set(memoryKey, []);
      }
      
      this.memoryStore.get(memoryKey)!.push(entry);
    }

    console.log(`Imported ${entries.length} memory entries for ${instanceId}`);
  }
}