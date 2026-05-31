/**
 * OpenAI Plugin - Plugin for OpenAI API agent
 * 
 * Example plugin showing how to wrap a REST API agent as a pluggable component.
 */

import { AgentPlugin, AgentPluginConfig } from './AgentPlugin';
import { RESTAdapter, RESTAdapterConfig } from '../adapters/RESTAdapter';
import { AgentAdapter, AgentMetadata } from '../adapters/AgentAdapter';

export class OpenAIPlugin implements AgentPlugin {
  getInfo(): AgentPluginConfig {
    return {
      name: 'openai',
      version: '1.0.0',
      description: 'OpenAI API agent for general AI tasks',
      adapterType: 'rest',
      defaultConfig: {
        baseUrl: 'https://api.openai.com/v1',
        apiKey: '',
        timeout: 30000,
        endpoints: {
          chat: '/chat/completions',
          health: '/models'
        }
      },
      capabilities: [
        'text-generation',
        'code-generation',
        'analysis',
        'reasoning'
      ],
      metadata: {
        name: 'OpenAI',
        version: '1.0.0',
        description: 'OpenAI API agent for general AI tasks',
        capabilities: [
          'text-generation',
          'code-generation',
          'analysis',
          'reasoning'
        ],
        protocol: 'rest',
        configuration: {}
      }
    };
  }

  createAdapter(config: any): AgentAdapter {
    const restConfig: RESTAdapterConfig = {
      baseUrl: config.baseUrl || 'https://api.openai.com/v1',
      apiKey: config.apiKey,
      timeout: config.timeout || 30000,
      headers: config.headers,
      endpoints: config.endpoints || {
        chat: '/chat/completions',
        health: '/models'
      }
    };

    const metadata: AgentMetadata = {
      name: 'OpenAI',
      version: '1.0.0',
      description: 'OpenAI API agent for general AI tasks',
      capabilities: this.getInfo().capabilities,
      protocol: 'rest',
      configuration: config
    };

    return new RESTAdapter(restConfig, metadata);
  }

  validateConfig(config: any): boolean {
    return !!config.apiKey;
  }

  getDefaultConfig(): any {
    return this.getInfo().defaultConfig;
  }
}