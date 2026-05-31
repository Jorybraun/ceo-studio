/**
 * Agent Adapter Interface - Standard interface for all agent communication protocols
 * 
 * This interface allows the orchestrator to work with any agent type:
 * - CLI agents (Devin, etc.)
 * - REST API agents (OpenAI, Anthropic)
 * - WebSocket agents (real-time)
 * - Hermes agents (optional)
 * - Custom protocols
 */

export interface AgentMetadata {
  name: string;
  version: string;
  description: string;
  capabilities: string[];
  protocol: string;
  configuration: any;
}

export interface AgentRequest {
  id: string;
  payload: any;
  timestamp: Date;
  metadata?: any;
}

export interface AgentResponse {
  id: string;
  payload: any;
  timestamp: Date;
  duration: number;
  metadata?: any;
}

export interface AgentAdapter {
  /**
   * Get the adapter type/protocol
   */
  getProtocol(): string;

  /**
   * Start the agent (initialize resources)
   */
  start(): Promise<void>;

  /**
   * Stop the agent (cleanup resources)
   */
  stop(): Promise<void>;

  /**
   * Wake up the agent (from sleep/dormant state)
   */
  wakeUp(): Promise<void>;

  /**
   * Put the agent to sleep (minimize resource usage)
   */
  sleep(): Promise<void>;

  /**
   * Send a request to the agent
   */
  sendRequest(request: AgentRequest): Promise<AgentResponse>;

  /**
   * Handle a response from the agent
   */
  handleResponse(response: AgentResponse): void;

  /**
   * Get agent capabilities
   */
  getCapabilities(): string[];

  /**
   * Get agent metadata
   */
  getMetadata(): AgentMetadata;

  /**
   * Configure the agent
   */
  configure(config: any): void;

  /**
   * Check if agent is healthy
   */
  healthCheck(): Promise<boolean>;

  /**
   * Get current state
   */
  getState(): string;
}