/**
 * Conversation Logger - Logs all agent-to-agent communications
 * 
 * Provides:
 * - Structured logging of all agent conversations
 * - Timestamped conversation records
 * - Searchable conversation history
 * - Export functionality
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

export interface ConversationLog {
  id: string;
  timestamp: Date;
  from: string;
  to: string;
  messageType: 'request' | 'response';
  payload: any;
  agentPersona?: string;
  agentMemoryKey?: string;
  duration?: number; // Response time in ms
}

export class ConversationLogger {
  private logs: ConversationLog[] = [];
  private logFilePath: string;
  private maxLogs: number = 10000; // Maximum logs to keep in memory
  private autoSave: boolean = true;
  private conversationCounter = 0;

  constructor(logDir: string = './logs', autoSave: boolean = true) {
    this.logFilePath = join(logDir, 'conversations.jsonl');
    this.autoSave = autoSave;
    
    // Create logs directory if it doesn't exist
    if (!existsSync(logDir)) {
      mkdirSync(logDir, { recursive: true });
    }
    
    // Load existing logs if file exists
    this.loadLogs();
  }

  /**
   * Log a conversation message
   */
  logConversation(
    from: string,
    to: string,
    messageType: 'request' | 'response',
    payload: any,
    metadata?: {
      agentPersona?: string;
      agentMemoryKey?: string;
      duration?: number;
    }
  ): void {
    const log: ConversationLog = {
      id: `conv-${Date.now()}-${this.conversationCounter++}`,
      timestamp: new Date(),
      from,
      to,
      messageType,
      payload,
      ...metadata
    };

    this.logs.push(log);

    // Keep logs under limit
    if (this.logs.length > this.maxLogs) {
      this.logs.shift();
    }

    // Auto-save to file
    if (this.autoSave) {
      this.saveLog(log);
    }

    // Console output for visibility
    this.printLog(log);
  }

  /**
   * Print log to console with formatting
   */
  private printLog(log: ConversationLog): void {
    const arrow = log.messageType === 'request' ? '→' : '←';
    const color = log.messageType === 'request' ? '\x1b[34m' : '\x1b[32m'; // Blue for request, Green for response
    const reset = '\x1b[0m';
    
    console.log(`${color}[${log.timestamp.toISOString()}]${reset} ${log.from} ${arrow} ${log.to} (${log.messageType})`);
    console.log(`  Payload: ${JSON.stringify(log.payload).substring(0, 100)}...`);
    
    if (log.agentPersona) {
      console.log(`  Persona: ${log.agentPersona}`);
    }
    if (log.duration) {
      console.log(`  Duration: ${log.duration}ms`);
    }
    console.log();
  }

  /**
   * Save a single log to file
   */
  private saveLog(log: ConversationLog): void {
    try {
      const logLine = JSON.stringify(log) + '\n';
      writeFileSync(this.logFilePath, logLine, { flag: 'a' });
    } catch (error) {
      console.error('Error saving log:', error);
    }
  }

  /**
   * Load existing logs from file
   */
  private loadLogs(): void {
    if (!existsSync(this.logFilePath)) {
      return;
    }

    try {
      const content = readFileSync(this.logFilePath, 'utf-8');
      const lines = content.trim().split('\n');
      
      for (const line of lines) {
        if (line.trim()) {
          const log = JSON.parse(line);
          log.timestamp = new Date(log.timestamp);
          this.logs.push(log);
        }
      }
      
      console.log(`Loaded ${this.logs.length} existing conversation logs`);
    } catch (error) {
      console.error('Error loading logs:', error);
    }
  }

  /**
   * Get all logs
   */
  getAllLogs(): ConversationLog[] {
    return [...this.logs];
  }

  /**
   * Get logs between two agents
   */
  getConversationBetween(agent1: string, agent2: string): ConversationLog[] {
    return this.logs.filter(log => 
      (log.from === agent1 && log.to === agent2) ||
      (log.from === agent2 && log.to === agent1)
    );
  }

  /**
   * Get logs for a specific agent
   */
  getAgentLogs(agentId: string): ConversationLog[] {
    return this.logs.filter(log => 
      log.from === agentId || log.to === agentId
    );
  }

  /**
   * Get logs by time range
   */
  getLogsByTimeRange(start: Date, end: Date): ConversationLog[] {
    return this.logs.filter(log => 
      log.timestamp >= start && log.timestamp <= end
    );
  }

  /**
   * Get logs by message type
   */
  getLogsByType(messageType: 'request' | 'response'): ConversationLog[] {
    return this.logs.filter(log => log.messageType === messageType);
  }

  /**
   * Search logs by payload content
   */
  searchLogs(query: string): ConversationLog[] {
    const lowerQuery = query.toLowerCase();
    return this.logs.filter(log => 
      JSON.stringify(log.payload).toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Get conversation statistics
   */
  getStatistics(): any {
    const stats: any = {
      totalLogs: this.logs.length,
      byType: { request: 0, response: 0 },
      byAgent: {} as Record<string, number>,
      timeRange: {
        earliest: this.logs.length > 0 ? this.logs[0].timestamp : null,
        latest: this.logs.length > 0 ? this.logs[this.logs.length - 1].timestamp : null
      },
      averageResponseTime: 0
    };

    let totalResponseTime = 0;
    let responseCount = 0;

    for (const log of this.logs) {
      // Count by type
      stats.byType[log.messageType]++;

      // Count by agent
      stats.byAgent[log.from] = (stats.byAgent[log.from] || 0) + 1;
      stats.byAgent[log.to] = (stats.byAgent[log.to] || 0) + 1;

      // Calculate response time
      if (log.duration) {
        totalResponseTime += log.duration;
        responseCount++;
      }
    }

    if (responseCount > 0) {
      stats.averageResponseTime = totalResponseTime / responseCount;
    }

    return stats;
  }

  /**
   * Export logs to JSON file
   */
  exportLogs(filePath: string): void {
    try {
      writeFileSync(filePath, JSON.stringify(this.logs, null, 2));
      console.log(`Exported ${this.logs.length} logs to ${filePath}`);
    } catch (error) {
      console.error('Error exporting logs:', error);
    }
  }

  /**
   * Clear all logs
   */
  clearLogs(): void {
    this.logs = [];
    if (existsSync(this.logFilePath)) {
      writeFileSync(this.logFilePath, '');
    }
    console.log('Cleared all conversation logs');
  }

  /**
   * Get recent logs
   */
  getRecentLogs(count: number = 10): ConversationLog[] {
    return this.logs.slice(-count);
  }

  /**
   * Print a conversation thread between two agents
   */
  printConversationThread(agent1: string, agent2: string): void {
    const conversation = this.getConversationBetween(agent1, agent2);
    
    if (conversation.length === 0) {
      console.log(`No conversation found between ${agent1} and ${agent2}`);
      return;
    }

    console.log(`\n=== Conversation: ${agent1} ↔ ${agent2} ===`);
    console.log(`Total messages: ${conversation.length}\n`);

    for (const log of conversation) {
      const arrow = log.messageType === 'request' ? '→' : '←';
      const color = log.messageType === 'request' ? '\x1b[34m' : '\x1b[32m';
      const reset = '\x1b[0m';
      
      console.log(`${color}[${log.timestamp.toISOString()}]${reset}`);
      console.log(`${log.from} ${arrow} ${log.to}`);
      console.log(`Message: ${JSON.stringify(log.payload, null, 2)}`);
      
      if (log.duration) {
        console.log(`Response time: ${log.duration}ms`);
      }
      console.log();
    }
  }
}