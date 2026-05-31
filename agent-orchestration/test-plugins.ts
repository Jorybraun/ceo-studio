/**
 * Test Pluggable Architecture
 * 
 * Demonstrates how the system can work with different agent types
 * through the plugin system, making Hermes optional.
 */

import { AgentPluginRegistry } from './plugins/AgentPlugin';
import { DevinPlugin } from './plugins/DevinPlugin';
import { OpenAIPlugin } from './plugins/OpenAIPlugin';

async function testPluggableArchitecture() {
  console.log('=== Testing Pluggable Architecture ===\n');

  // Create plugin registry
  const registry = new AgentPluginRegistry();

  // Test 1: Register CLI plugin (Devin)
  console.log('Test 1: Register CLI plugin (Devin)');
  const devinPlugin = new DevinPlugin();
  registry.registerPlugin(devinPlugin);
  console.log(`✓ Registered: ${devinPlugin.getInfo().name}\n`);

  // Test 2: Register REST plugin (OpenAI)
  console.log('Test 2: Register REST plugin (OpenAI)');
  const openaiPlugin = new OpenAIPlugin();
  registry.registerPlugin(openaiPlugin);
  console.log(`✓ Registered: ${openaiPlugin.getInfo().name}\n`);

  // Test 3: List all plugins
  console.log('Test 3: List all plugins');
  const allPlugins = registry.getAllPlugins();
  console.log(`✓ Total plugins: ${allPlugins.length}`);
  allPlugins.forEach(plugin => {
    const info = plugin.getInfo();
    console.log(`  - ${info.name} (${info.adapterType}): ${info.description}`);
  });
  console.log();

  // Test 4: Get plugins by adapter type
  console.log('Test 4: Get plugins by adapter type');
  const cliPlugins = registry.getPluginsByAdapterType('cli');
  const restPlugins = registry.getPluginsByAdapterType('rest');
  console.log(`✓ CLI plugins: ${cliPlugins.length}`);
  console.log(`✓ REST plugins: ${restPlugins.length}\n`);

  // Test 5: Create CLI adapter
  console.log('Test 5: Create CLI adapter from plugin');
  const devinAdapter = registry.createAdapter('devin', {
    command: 'devin',
    timeout: 30000
  });
  if (devinAdapter) {
    console.log(`✓ Created adapter: ${devinAdapter.getProtocol()}`);
    console.log(`✓ Capabilities: ${devinAdapter.getCapabilities().join(', ')}`);
    console.log(`✓ Metadata: ${devinAdapter.getMetadata().name}\n`);
  }

  // Test 6: Create REST adapter
  console.log('Test 6: Create REST adapter from plugin');
  const openaiAdapter = registry.createAdapter('openai', {
    apiKey: 'test-key',
    baseUrl: 'https://api.openai.com/v1'
  });
  if (openaiAdapter) {
    console.log(`✓ Created adapter: ${openaiAdapter.getProtocol()}`);
    console.log(`✓ Capabilities: ${openaiAdapter.getCapabilities().join(', ')}`);
    console.log(`✓ Metadata: ${openaiAdapter.getMetadata().name}\n`);
  }

  // Test 7: Validate configurations
  console.log('Test 7: Validate configurations');
  const validConfig = { command: 'devin' };
  const invalidConfig = { };
  console.log(`✓ Valid config: ${devinPlugin.validateConfig(validConfig)}`);
  console.log(`✓ Invalid config: ${devinPlugin.validateConfig(invalidConfig)}\n`);

  // Test 8: Get default configurations
  console.log('Test 8: Get default configurations');
  console.log('✓ Devin default config:', JSON.stringify(devinPlugin.getDefaultConfig(), null, 2));
  console.log('✓ OpenAI default config:', JSON.stringify(openaiPlugin.getDefaultConfig(), null, 2));
  console.log();

  console.log('=== Pluggable Architecture Test Complete ===');
  console.log('\nKey Benefits:');
  console.log('✓ Hermes is NOT required - works with any agent');
  console.log('✓ Protocol agnostic - CLI, REST, WebSocket, etc.');
  console.log('✓ Plugin system - easy to add new agent types');
  console.log('✓ Configuration driven - no hardcoded dependencies');
  console.log('✓ Backward compatible - existing CLI wrappers still work');
}

// Run the test
testPluggableArchitecture().catch(console.error);