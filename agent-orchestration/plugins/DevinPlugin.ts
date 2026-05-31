/**
 * Devin Plugin - Plugin for Devin CLI agent
 * 
 * Example plugin showing how to wrap a CLI agent as a pluggable component.
 */

import { AgentPlugin, AgentPluginConfig } from './AgentPlugin';
import { CLIAdapter, CLIAdapterConfig } from '../adapters/CLIAdapter';
import { AgentAdapter, AgentMetadata } from '../adapters/AgentAdapter';

export class DevinPlugin implements AgentPlugin {
  getInfo(): AgentPluginConfig {
    return {
      name: 'devin',
      version: '1.0.0',
      description: 'Devin CLI agent for coding tasks',
      adapterType: 'cli',
      defaultConfig: {
        command: 'devin',
        args: [],
        timeout: 30000
      },
      capabilities: [
        'planning',
        'code-analysis',
        'debugging',
        'implementation',
        'file-operations'
      ],
      metadata: {
        name: 'Devin',
        version: '1.0.0',
        description: 'AI coding assistant for planning, debugging, and implementation',
        capabilities: [
          'planning',
          'code-analysis',
          'debugging',
          'implementation',
          'file-operations'
        ],
        protocol: 'cli',
        configuration: {}
      }
    };
  }

  createAdapter(config: any): AgentAdapter {
    const cliConfig: CLIAdapterConfig = {
      command: config.command || 'devin',
      args: config.args || [],
      timeout: config.timeout || 30000,
      env: config.env,
      workingDirectory: config.workingDirectory
    };

    const metadata: AgentMetadata = {
      name: 'Devin',
      version: '1.0.0',
      description: 'AI coding assistant for planning, debugging, and implementation',
      capabilities: this.getInfo().capabilities,
      protocol: 'cli',
      configuration: config
    };

    return new CLIAdapter(cliConfig, metadata);
  }

  validateConfig(config: any): boolean {
    return !!config.command;
  }

  getDefaultConfig(): any {
    return this.getInfo().defaultConfig;
  }
}