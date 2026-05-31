/**
 * REST Adapter - Adapter for REST API-based agents
 * 
 * Wraps REST API agents (like OpenAI, Anthropic, etc.) to work with the orchestrator.
 */

import { AgentAdapter, AgentRequest, AgentResponse, AgentMetadata } from './AgentAdapter';

export interface RESTAdapterConfig {
  baseUrl: string;
  apiKey?: string;
  headers?: Record<string, string>;
  timeout?: number;
  endpoints: {
    chat: string;
    health?: string;
  };
}

export class RESTAdapter implements AgentAdapter {
  private config: RESTAdapterConfig;
  private state: string = 'stopped';
  private metadata: AgentMetadata;

  constructor(config: RESTAdapterConfig, metadata: AgentMetadata) {
    this.config = config;
    this.metadata = metadata;
  }

  getProtocol(): string {
    return 'rest';
  }

  async start(): Promise<void> {
    console.log(`Starting REST adapter for ${this.config.baseUrl}`);
    this.state = 'active';
  }

  async stop(): Promise<void> {
    console.log(`Stopping REST adapter for ${this.config.baseUrl}`);
    this.state = 'stopped';
  }

  async wakeUp(): Promise<void> {
    console.log(`Waking up REST adapter for ${this.config.baseUrl}`);
    this.state = 'active';
  }

  async sleep(): Promise<void> {
    console.log(`Putting REST adapter to sleep for ${this.config.baseUrl}`);
    this.state = 'sleeping';
  }

  async sendRequest(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    
    try {
      const url = `${this.config.baseUrl}${this.config.endpoints.chat}`;
      const headers = {
        'Content-Type': 'application/json',
        ...this.config.headers,
        ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` })
      };

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(request.payload),
        signal: AbortSignal.timeout(this.config.timeout || 30000)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const duration = Date.now() - startTime;

      return {
        id: request.id,
        payload: data,
        timestamp: new Date(),
        duration,
        metadata: {
          statusCode: response.status,
          headers: Object.fromEntries(response.headers.entries())
        }
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        id: request.id,
        payload: {
          error: error.message,
          success: false
        },
        timestamp: new Date(),
        duration,
        metadata: {
          errorType: error.name
        }
      };
    }
  }

  handleResponse(response: AgentResponse): void {
    console.log(`REST adapter received response: ${response.id}`);
  }

  getCapabilities(): string[] {
    return this.metadata.capabilities;
  }

  getMetadata(): AgentMetadata {
    return this.metadata;
  }

  configure(config: Partial<RESTAdapterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const healthUrl = this.config.endpoints.health 
        ? `${this.config.baseUrl}${this.config.endpoints.health}`
        : `${this.config.baseUrl}/health`;
      
      const response = await fetch(healthUrl, {
        method: 'GET',
        signal: AbortSignal.timeout(5000)
      });
      
      return response.ok;
    } catch {
      return false;
    }
  }

  getState(): string {
    return this.state;
  }
}