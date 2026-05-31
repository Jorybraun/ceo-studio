/**
 * CLI Adapter - Adapter for CLI-based agents
 * 
 * Wraps CLI-based agents (like Devin) to work with the orchestrator.
 * This is the current behavior, now standardized as an adapter.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { AgentAdapter, AgentRequest, AgentResponse, AgentMetadata } from './AgentAdapter';

const execAsync = promisify(exec);

export interface CLIAdapterConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  workingDirectory?: string;
  timeout?: number;
}

export class CLIAdapter implements AgentAdapter {
  private config: CLIAdapterConfig;
  private state: string = 'stopped';
  private metadata: AgentMetadata;

  constructor(config: CLIAdapterConfig, metadata: AgentMetadata) {
    this.config = config;
    this.metadata = metadata;
  }

  getProtocol(): string {
    return 'cli';
  }

  async start(): Promise<void> {
    console.log(`Starting CLI adapter for ${this.config.command}`);
    this.state = 'active';
  }

  async stop(): Promise<void> {
    console.log(`Stopping CLI adapter for ${this.config.command}`);
    this.state = 'stopped';
  }

  async wakeUp(): Promise<void> {
    console.log(`Waking up CLI adapter for ${this.config.command}`);
    this.state = 'active';
  }

  async sleep(): Promise<void> {
    console.log(`Putting CLI adapter to sleep for ${this.config.command}`);
    this.state = 'sleeping';
  }

  async sendRequest(request: AgentRequest): Promise<AgentResponse> {
    const startTime = Date.now();
    
    try {
      const command = this.buildCommand(request.payload);
      const { stdout, stderr } = await execAsync(command, {
        env: { ...process.env, ...this.config.env },
        cwd: this.config.workingDirectory,
        timeout: this.config.timeout || 30000
      });

      const duration = Date.now() - startTime;

      return {
        id: request.id,
        payload: {
          output: stdout,
          error: stderr,
          success: !stderr
        },
        timestamp: new Date(),
        duration,
        metadata: {
          command: this.config.command,
          exitCode: stderr ? 1 : 0
        }
      };
    } catch (error: any) {
      const duration = Date.now() - startTime;
      
      return {
        id: request.id,
        payload: {
          output: '',
          error: error.message,
          success: false
        },
        timestamp: new Date(),
        duration,
        metadata: {
          command: this.config.command,
          exitCode: error.code || -1
        }
      };
    }
  }

  handleResponse(response: AgentResponse): void {
    console.log(`CLI adapter received response: ${response.id}`);
  }

  getCapabilities(): string[] {
    return this.metadata.capabilities;
  }

  getMetadata(): AgentMetadata {
    return this.metadata;
  }

  configure(config: Partial<CLIAdapterConfig>): void {
    this.config = { ...this.config, ...config };
  }

  async healthCheck(): Promise<boolean> {
    try {
      const { stdout } = await execAsync(`${this.config.command} --version`, {
        timeout: 5000
      });
      return !!stdout;
    } catch {
      return false;
    }
  }

  getState(): string {
    return this.state;
  }

  private buildCommand(payload: any): string {
    const args = this.config.args || [];
    const payloadArgs = this.payloadToArgs(payload);
    return `${this.config.command} ${args.join(' ')} ${payloadArgs.join(' ')}`;
  }

  private payloadToArgs(payload: any): string[] {
    if (typeof payload === 'string') {
      return [payload];
    }
    
    const args: string[] = [];
    for (const [key, value] of Object.entries(payload)) {
      if (typeof value === 'string') {
        args.push(`--${key}`, value);
      } else {
        args.push(`--${key}`, JSON.stringify(value));
      }
    }
    return args;
  }
}