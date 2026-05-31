/**
 * Agent Plugin System - Plugin interface for registering agent types
 * 
 * Allows dynamic registration of agent types with different protocols:
 * - CLI agents
 * - REST API agents
 * - WebSocket agents
 * - Hermes agents (optional)
 * - Custom agents
 */

import { AgentAdapter, AgentMetadata } from '../adapters/AgentAdapter';

export interface AgentPluginConfig {
  name: string;
  version: string;
  description: string;
  adapterType: string;
  defaultConfig: any;
  capabilities: string[];
  metadata: AgentMetadata;
}

export interface AgentPlugin {
  /**
   * Get plugin information
   */
  getInfo(): AgentPluginConfig;

  /**
   * Create an adapter instance
   */
  createAdapter(config: any): AgentAdapter;

  /**
   * Validate configuration
   */
  validateConfig(config: any): boolean;

  /**
   * Get default configuration
   */
  getDefaultConfig(): any;
}

export class AgentPluginRegistry {
  private plugins: Map<string, AgentPlugin> = new Map();

  /**
   * Register a plugin
   */
  registerPlugin(plugin: AgentPlugin): void {
    const info = plugin.getInfo();
    this.plugins.set(info.name, plugin);
    console.log(`Registered agent plugin: ${info.name} v${info.version}`);
  }

  /**
   * Unregister a plugin
   */
  unregisterPlugin(pluginName: string): void {
    this.plugins.delete(pluginName);
    console.log(`Unregistered agent plugin: ${pluginName}`);
  }

  /**
   * Get a plugin by name
   */
  getPlugin(pluginName: string): AgentPlugin | null {
    return this.plugins.get(pluginName) || null;
  }

  /**
   * Get all registered plugins
   */
  getAllPlugins(): AgentPlugin[] {
    return Array.from(this.plugins.values());
  }

  /**
   * Get plugins by adapter type
   */
  getPluginsByAdapterType(adapterType: string): AgentPlugin[] {
    return this.getAllPlugins().filter(plugin => 
      plugin.getInfo().adapterType === adapterType
    );
  }

  /**
   * Create an adapter from a plugin
   */
  createAdapter(pluginName: string, config: any): AgentAdapter | null {
    const plugin = this.getPlugin(pluginName);
    if (!plugin) {
      console.error(`Plugin not found: ${pluginName}`);
      return null;
    }

    if (!plugin.validateConfig(config)) {
      console.error(`Invalid configuration for plugin: ${pluginName}`);
      return null;
    }

    return plugin.createAdapter(config);
  }

  /**
   * Check if a plugin is registered
   */
  hasPlugin(pluginName: string): boolean {
    return this.plugins.has(pluginName);
  }
}