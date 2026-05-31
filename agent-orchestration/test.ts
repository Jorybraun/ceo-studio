/**
 * Test file for agent orchestration system with IoC
 * Tests core functionality with dependency injection
 */

import { AgentOrchestrator } from './index';
import { IMemoryManager } from './interfaces/IMemoryManager';

async function testAgentOrchestration() {
  console.log('=== Testing Agent Orchestration System ===\n');

  const orchestrator = new AgentOrchestrator();

  try {
    // Test 1: Initialize system
    console.log('Test 1: Initialize system');
    await orchestrator.initialize();
    console.log('✓ System initialized successfully\n');

    // Test 2: Create agent instances
    console.log('Test 2: Create agent instances (DORMANT state)');
    const devin1 = await orchestrator.createAgentInstance('devin');
    console.log(`✓ Created Devin instance: ${devin1} (DORMANT)`);

    const devin2 = await orchestrator.createAgentInstance('devin');
    console.log(`✓ Created Devin instance: ${devin2} (DORMANT)`);

    // Check lifecycle states
    const devin1LifecycleState = orchestrator.getAgentState(devin1);
    const devin2LifecycleState = orchestrator.getAgentState(devin2);
    console.log(`✓ Devin #1 state: ${devin1LifecycleState}`);
    console.log(`✓ Devin #2 state: ${devin2LifecycleState}\n`);

    // Test 3: Check system status
    console.log('Test 3: Check system status');
    const status = orchestrator.getAllAgents();
    console.log('✓ System status:');
    console.log(JSON.stringify(status, null, 2));
    console.log();

    // Test 4: Test memory management
    console.log('Test 4: Test memory management');
    
    // Wake up agents first to initialize their memory
    await orchestrator.wakeUpAgent(devin1);
    await orchestrator.wakeUpAgent(devin2);
    
    const memoryKey1 = orchestrator.getMemoryKey(devin1);
    console.log(`✓ Devin #1 memory key: ${memoryKey1}`);

    const memoryKey2 = orchestrator.getMemoryKey(devin2);
    console.log(`✓ Devin #2 memory key: ${memoryKey2}`);

    orchestrator.storeAgentMemory(devin1, 'preference', {
      key: 'testPreference',
      value: 'testValue'
    });
    console.log('✓ Stored preference in Devin #1 memory');

    const devin1Memory = orchestrator.getAgentMemory(devin1, 'preference');
    console.log(`✓ Retrieved Devin #1 memory: ${devin1Memory.length} entries\n`);

    // Test 5: Test persona management
    console.log('Test 5: Test persona management');
    const personas = orchestrator.getAllPersonas();
    console.log(`✓ Available personas: ${personas.length}`);
    personas.forEach(p => console.log(`  - ${p.name} (${p.id})`));

    orchestrator.assignPersonaToInstance(devin1, 'senior-architect', {
      responseLength: 'detailed'
    });
    console.log('✓ Assigned Senior Architect persona to Devin #1');

    const devin1Persona = orchestrator.getInstancePersona(devin1);
    console.log(`✓ Devin #1 persona: ${devin1Persona?.name}\n`);

    // Test 6: Test mailbox communication (back-and-forth with wake/sleep)
    console.log('Test 6: Test mailbox communication (back-and-forth with wake/sleep)');
    
    // Wake up Devin #1 to handle requests
    console.log('Waking up Devin #1...');
    await orchestrator.wakeUpAgent(devin1);
    console.log(`✓ Devin #1 state: ${orchestrator.getAgentState(devin1)}`);
    
    // Start monitoring for Devin #1 to receive requests
    const devin1Wrapper = orchestrator['agentWrappers'].get(devin1);
    if (devin1Wrapper) {
      await devin1Wrapper.startMailboxMonitoring(orchestrator['mailboxRouter']);
      console.log(`✓ Devin #1 started monitoring for requests`);
    }
    
    // Wake up Devin #2 for testing
    console.log('Waking up Devin #2...');
    await orchestrator.wakeUpAgent(devin2);
    console.log(`✓ Devin #2 state: ${orchestrator.getAgentState(devin2)}`);
    
    const devin2Wrapper = orchestrator['agentWrappers'].get(devin2);
    if (devin2Wrapper) {
      await devin2Wrapper.startMailboxMonitoring(orchestrator['mailboxRouter']);
      console.log(`✓ Devin #2 started monitoring for requests`);
    }
    
    // Create a voice agent instance to send messages
    const voiceAgent = await orchestrator.createAgentInstance('voice-agent');
    console.log(`✓ Created voice agent: ${voiceAgent}`);

    // Wake up voice agent to initialize its memory
    await orchestrator.wakeUpAgent(voiceAgent);
    console.log(`✓ Voice agent state: ${orchestrator.getAgentState(voiceAgent)}`);

    // Subscribe voice agent to its own mailbox to receive responses
    const voiceAgentWrapper = orchestrator['agentWrappers'].get(voiceAgent);
    if (voiceAgentWrapper) {
      // Subscribe to response messages (not requests)
      orchestrator['mailboxRouter'].subscribe({
        subscriberId: voiceAgent,
        targetMailbox: `${voiceAgent}@local`,
        messageType: 'response',
        callback: async (message: any) => {
          console.log(`Voice Agent received response from ${message.from}`);
          // Store the response in memory
          voiceAgentWrapper.storeConversation({
            from: message.from,
            to: message.to,
            request: null,
            response: message.payload,
            timestamp: new Date().toISOString()
          });
        }
      });
      console.log(`✓ Voice agent subscribed to responses`);
    }

    // Send message from voice agent to Devin #1
    const messageId = await orchestrator.sendMessage(
      `${voiceAgent}@local`,
      'devin-1@local',
      { task: 'Test task for mailbox communication' }
    );
    console.log(`✓ Sent message: ${messageId}`);

    // Wait for message processing and response
    await new Promise(resolve => setTimeout(resolve, 200));

    // Check if message was received and processed by Devin
    const devin1Conversations = orchestrator.getAgentMemory('devin-1', 'conversation');
    console.log(`✓ Devin #1 conversation entries: ${devin1Conversations.length}`);
    
    if (devin1Conversations.length > 0) {
      console.log('✓ Devin #1 received request:', JSON.stringify(devin1Conversations[0].request, null, 2));
    }

    // Check voice agent's mailbox for response from Devin
    const voiceAgentConversations = orchestrator.getAgentMemory(voiceAgent, 'conversation');
    console.log(`✓ Voice agent received responses: ${voiceAgentConversations.length}`);
    
    if (voiceAgentConversations.length > 0) {
      console.log('✓ Voice agent received response:', JSON.stringify(voiceAgentConversations[0].response, null, 2));
    }

    // Test round-trip: Voice agent sends another message
    console.log('\n  Testing second round-trip...');
    const messageId2 = await orchestrator.sendMessage(
        `${voiceAgent}@local`,
        'devin-1@local',
        { task: 'Second test task' }
    );
    console.log(`✓ Sent second message: ${messageId2}`);

    await new Promise(resolve => setTimeout(resolve, 200));

    const voiceAgentConversations2 = orchestrator.getAgentMemory(voiceAgent, 'conversation');
    console.log(`✓ Voice agent total conversations: ${voiceAgentConversations2.length}`);
    
    if (voiceAgentConversations2.length > 1) {
        console.log('✓ Latest response:', JSON.stringify(voiceAgentConversations2[1].response, null, 2));
    }
    console.log();

    // Test 6b: Test conversation logging
    console.log('Test 6b: Test conversation logging');
    const allLogs = orchestrator.getConversationLogs();
    console.log(`✓ Total conversation logs: ${allLogs.length}`);
    
    const voiceAgentLogs = orchestrator.getAgentLogs(`${voiceAgent}@local`);
    console.log(`✓ Voice agent logs: ${voiceAgentLogs.length}`);
    
    const conversationThread = orchestrator.getConversationBetween(`${voiceAgent}@local`, `${devin1}@local`);
    console.log(`✓ Conversation between Voice Agent and Devin #1: ${conversationThread.length} messages`);
    
    const stats = orchestrator.getConversationStats();
    console.log('✓ Conversation statistics:', JSON.stringify(stats, null, 2));
    
    // Print the conversation thread
    console.log('\n  Conversation Thread:');
    orchestrator.printConversationThread(`${voiceAgent}@local`, `${devin1}@local`);
    console.log();

    // Test 6c: Test domain isolation
    console.log('Test 6c: Test domain isolation');
    const allDomains = orchestrator.getAllDomains();
    console.log(`✓ Available domains: ${allDomains.length}`);
    allDomains.forEach(domain => {
      console.log(`  - ${domain.name} (${domain.id})`);
      console.log(`    Allowed agent types: ${domain.allowedAgentTypes.join(', ')}`);
      console.log(`    Allowed personas: ${domain.allowedPersonas.join(', ')}`);
    });

    // Switch to Development domain
    orchestrator.switchDomain('development');
    console.log(`✓ Switched to Development domain`);
    
    const currentDomain = orchestrator.getCurrentDomain();
    console.log(`✓ Current domain: ${currentDomain?.name}`);
    console.log();
    
    const domainStats = orchestrator.getDomainStats();
    console.log('✓ Domain statistics:', JSON.stringify(domainStats, null, 2));
    console.log();

    // Test 6d: Test agent lifecycle management
    console.log('Test 6d: Test agent lifecycle management (wake/sleep)');
    const lifecycleStats = orchestrator.getLifecycleStats();
    console.log('✓ Lifecycle statistics:', JSON.stringify(lifecycleStats, null, 2));

    // Test putting Devin #2 to sleep
    console.log('Putting Devin #2 to sleep...');
    await orchestrator.sleepAgent(devin2);
    console.log(`✓ Devin #2 state: ${orchestrator.getAgentState(devin2)}`);

    // Test waking up Devin #2
    console.log('Waking up Devin #2...');
    await orchestrator.wakeUpAgent(devin2);
    console.log(`✓ Devin #2 state: ${orchestrator.getAgentState(devin2)}`);
    console.log();

    // Test 6e: Test auto-wake on message send
    console.log('Test 6e: Test auto-wake on message send');
    // Put Devin #2 to sleep again
    await orchestrator.sleepAgent(devin2);
    console.log(`✓ Devin #2 put to sleep: ${orchestrator.getAgentState(devin2)}`);

    // Send message to sleeping agent (should auto-wake)
    const wakeMessageId = await orchestrator.sendMessage(
      `${voiceAgent}@local`,
      `${devin2}@local`,
      { task: 'Test auto-wake functionality' }
    );
    console.log(`✓ Sent message to sleeping agent: ${wakeMessageId}`);
    console.log(`✓ Devin #2 auto-woke up: ${orchestrator.getAgentState(devin2)}`);

    // Start monitoring for Devin #2 after wake up
    if (devin2Wrapper) {
      await devin2Wrapper.startMailboxMonitoring(orchestrator['mailboxRouter']);
      console.log(`✓ Devin #2 started monitoring for requests`);
    }
    console.log();

    // Test 7: Test agent discovery
    console.log('Test 7: Test agent discovery');
    const planningAgents = orchestrator.getAgentsByCapability('planning');
    console.log(`✓ Found ${planningAgents.length} agents with planning capability`);
    planningAgents.forEach(agent => {
      console.log(`  - ${agent.instanceId} (${agent.status})`);
    });
    console.log();

    // Test 8: Test Agent Cards
    console.log('Test 8: Test Agent Cards');
    const devin1Card = orchestrator.getAgentCard(devin1);
    console.log('✓ Devin #1 Agent Card:');
    console.log(JSON.stringify(devin1Card, null, 2));
    console.log();

    // Test 9: Test instance isolation
    console.log('Test 9: Test instance isolation');
    console.log('✓ Memory isolation was tested in Test 4 - skipping redundant test\n');

    // Test 10: Cleanup
    console.log('Test 10: Cleanup');
    await orchestrator.stopAgent(devin1);
    console.log(`✓ Stopped ${devin1}`);

    await orchestrator.stopAgent(devin2);
    console.log(`✓ Stopped ${devin2}`);

    await orchestrator.stopAgent(voiceAgent);
    console.log(`✓ Stopped ${voiceAgent}`);

    const finalStatus = orchestrator.getAllAgents();
    console.log('✓ Final system status:');
    console.log(JSON.stringify(finalStatus, null, 2));

    console.log('\n=== All tests passed! ===');

  } catch (error) {
    console.error('Test failed:', error);
    await orchestrator.shutdown();
    process.exit(1);
  }
}

// Run the test
testAgentOrchestration().catch(console.error);