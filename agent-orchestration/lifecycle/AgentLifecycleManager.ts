/**
 * Agent Lifecycle Manager - Manages agent wake/sleep cycles
 * 
 * Provides:
 * - On-demand agent activation (wake up when needed)
 * - Automatic sleep when idle
 * - Resource cleanup when done
 * - Lifecycle state management
 */

export enum AgentState {
  DORMANT = 'dormant',      // Not instantiated, ready to wake up
  STARTING = 'starting',    // Waking up, initializing
  ACTIVE = 'active',        // Running and processing
  IDLE = 'idle',            // Running but no current work
  SLEEPING = 'sleeping',    // Going to sleep
  SLEEP = 'sleep',          // Sleeping, minimal resource usage
  STOPPING = 'stopping',    // Shutting down
  STOPPED = 'stopped'       // Terminated, resources freed
}

export interface AgentLifecycleConfig {
  idleTimeout: number;      // Time in ms before going to sleep (default: 5 minutes)
  sleepTimeout: number;     // Time in ms before stopping (default: 30 minutes)
  maxInstances: number;     // Max instances per agent type (default: 3)
  preWarmInstances: number; // Keep N instances warm (default: 0)
}

export class AgentLifecycleManager {
  private agentStates: Map<string, AgentState> = new Map();
  private agentLastActivity: Map<string, Date> = new Map();
  private lifecycleConfig: AgentLifecycleConfig;
  private sleepTimers: Map<string, NodeJS.Timeout> = new Map();
  private stopTimers: Map<string, NodeJS.Timeout> = new Map();

  constructor(config: Partial<AgentLifecycleConfig> = {}) {
    this.lifecycleConfig = {
      idleTimeout: config.idleTimeout || 5 * 60 * 1000,      // 5 minutes
      sleepTimeout: config.sleepTimeout || 30 * 60 * 1000,    // 30 minutes
      maxInstances: config.maxInstances || 3,
      preWarmInstances: config.preWarmInstances || 0
    };
  }

  /**
   * Register an agent instance (starts in DORMANT state)
   */
  registerAgent(instanceId: string): void {
    this.agentStates.set(instanceId, AgentState.DORMANT);
    this.agentLastActivity.set(instanceId, new Date());
    console.log(`Registered agent ${instanceId} in DORMANT state`);
  }

  /**
   * Wake up an agent (transition from DORMANT/SLEEP to ACTIVE)
   */
  async wakeUp(instanceId: string, wakeUpFn: () => Promise<void>): Promise<void> {
    const currentState = this.agentStates.get(instanceId);
    
    if (currentState === AgentState.ACTIVE || currentState === AgentState.STARTING) {
      console.log(`Agent ${instanceId} is already ${currentState}`);
      return;
    }

    console.log(`Waking up agent ${instanceId} from ${currentState}`);
    this.agentStates.set(instanceId, AgentState.STARTING);
    this.agentLastActivity.set(instanceId, new Date());

    try {
      await wakeUpFn();
      this.agentStates.set(instanceId, AgentState.ACTIVE);
      this.resetTimers(instanceId);
      console.log(`Agent ${instanceId} is now ACTIVE`);
    } catch (error) {
      console.error(`Failed to wake up agent ${instanceId}:`, error);
      this.agentStates.set(instanceId, AgentState.STOPPED);
      throw error;
    }
  }

  /**
   * Mark agent as active (processing a request)
   */
  markActive(instanceId: string): void {
    this.agentStates.set(instanceId, AgentState.ACTIVE);
    this.agentLastActivity.set(instanceId, new Date());
    this.resetTimers(instanceId);
  }

  /**
   * Mark agent as idle (finished processing, waiting for next request)
   */
  markIdle(instanceId: string): void {
    this.agentStates.set(instanceId, AgentState.IDLE);
    this.agentLastActivity.set(instanceId, new Date());
    this.resetTimers(instanceId);
    console.log(`Agent ${instanceId} is now IDLE`);
  }

  /**
   * Put agent to sleep (minimal resource usage, can wake quickly)
   */
  async goToSleep(instanceId: string, sleepFn: () => Promise<void>): Promise<void> {
    const currentState = this.agentStates.get(instanceId);
    
    if (currentState === AgentState.SLEEP || currentState === AgentState.DORMANT) {
      console.log(`Agent ${instanceId} is already ${currentState}`);
      return;
    }

    console.log(`Putting agent ${instanceId} to SLEEP`);
    this.agentStates.set(instanceId, AgentState.SLEEPING);

    try {
      await sleepFn();
      this.agentStates.set(instanceId, AgentState.SLEEP);
      this.clearTimers(instanceId);
      console.log(`Agent ${instanceId} is now SLEEPING`);
    } catch (error) {
      console.error(`Failed to put agent ${instanceId} to sleep:`, error);
      this.agentStates.set(instanceId, AgentState.ACTIVE);
      throw error;
    }
  }

  /**
   * Stop an agent (terminate, free resources)
   */
  async stopAgent(instanceId: string, stopFn: () => Promise<void>): Promise<void> {
    const currentState = this.agentStates.get(instanceId);
    
    if (currentState === AgentState.STOPPED || currentState === AgentState.DORMANT) {
      console.log(`Agent ${instanceId} is already ${currentState}`);
      return;
    }

    console.log(`Stopping agent ${instanceId}`);
    this.agentStates.set(instanceId, AgentState.STOPPING);
    this.clearTimers(instanceId);

    try {
      await stopFn();
      this.agentStates.set(instanceId, AgentState.STOPPED);
      this.agentLastActivity.delete(instanceId);
      console.log(`Agent ${instanceId} is now STOPPED`);
    } catch (error) {
      console.error(`Failed to stop agent ${instanceId}:`, error);
      this.agentStates.set(instanceId, AgentState.ACTIVE);
      throw error;
    }
  }

  /**
   * Reset idle/sleep timers for an active agent
   */
  private resetTimers(instanceId: string): void {
    this.clearTimers(instanceId);

    // Set idle timer (go to sleep after idle timeout)
    const idleTimer = setTimeout(() => {
      this.handleIdleTimeout(instanceId);
    }, this.lifecycleConfig.idleTimeout);
    this.sleepTimers.set(instanceId, idleTimer);

    // Set stop timer (stop after sleep timeout)
    const stopTimer = setTimeout(() => {
      this.handleSleepTimeout(instanceId);
    }, this.lifecycleConfig.sleepTimeout);
    this.stopTimers.set(instanceId, stopTimer);
  }

  /**
   * Clear all timers for an agent
   */
  private clearTimers(instanceId: string): void {
    const sleepTimer = this.sleepTimers.get(instanceId);
    if (sleepTimer) {
      clearTimeout(sleepTimer);
      this.sleepTimers.delete(instanceId);
    }

    const stopTimer = this.stopTimers.get(instanceId);
    if (stopTimer) {
      clearTimeout(stopTimer);
      this.stopTimers.delete(instanceId);
    }
  }

  /**
   * Handle idle timeout (agent should go to sleep)
   */
  private async handleIdleTimeout(instanceId: string): Promise<void> {
    const currentState = this.agentStates.get(instanceId);
    if (currentState === AgentState.IDLE) {
      console.log(`Agent ${instanceId} idle timeout, going to sleep`);
      // This would trigger the actual sleep logic
      // For now, just mark as sleeping
      this.agentStates.set(instanceId, AgentState.SLEEP);
    }
  }

  /**
   * Handle sleep timeout (agent should be stopped)
   */
  private async handleSleepTimeout(instanceId: string): Promise<void> {
    const currentState = this.agentStates.get(instanceId);
    if (currentState === AgentState.SLEEP) {
      console.log(`Agent ${instanceId} sleep timeout, stopping`);
      this.agentStates.set(instanceId, AgentState.STOPPED);
      this.agentLastActivity.delete(instanceId);
    }
  }

  /**
   * Get agent state
   */
  getAgentState(instanceId: string): AgentState {
    return this.agentStates.get(instanceId) || AgentState.DORMANT;
  }

  /**
   * Get all agents in a specific state
   */
  getAgentsByState(state: AgentState): string[] {
    const agents: string[] = [];
    for (const [instanceId, agentState] of this.agentStates.entries()) {
      if (agentState === state) {
        agents.push(instanceId);
      }
    }
    return agents;
  }

  /**
   * Get lifecycle statistics
   */
  getLifecycleStats(): any {
    const stats: any = {
      totalAgents: this.agentStates.size,
      byState: {} as Record<string, number>,
      configuration: this.lifecycleConfig
    };

    for (const state of Object.values(AgentState)) {
      stats.byState[state] = this.getAgentsByState(state).length;
    }

    return stats;
  }

  /**
   * Wake up all agents (for system startup)
   */
  async wakeUpAllAgents(wakeUpFn: (instanceId: string) => Promise<void>): Promise<void> {
    const dormantAgents = this.getAgentsByState(AgentState.DORMANT);
    const sleepingAgents = this.getAgentsByState(AgentState.SLEEP);
    
    const allAgents = [...dormantAgents, ...sleepingAgents];
    
    console.log(`Waking up ${allAgents.length} agents`);
    
    for (const instanceId of allAgents) {
      try {
        await this.wakeUp(instanceId, () => wakeUpFn(instanceId));
      } catch (error) {
        console.error(`Failed to wake up ${instanceId}:`, error);
      }
    }
  }

  /**
   * Put all idle agents to sleep
   */
  async sleepAllAgents(sleepFn: (instanceId: string) => Promise<void>): Promise<void> {
    const idleAgents = this.getAgentsByState(AgentState.IDLE);
    
    console.log(`Putting ${idleAgents.length} idle agents to sleep`);
    
    for (const instanceId of idleAgents) {
      try {
        await this.goToSleep(instanceId, () => sleepFn(instanceId));
      } catch (error) {
        console.error(`Failed to put ${instanceId} to sleep:`, error);
      }
    }
  }

  /**
   * Stop all agents
   */
  async stopAllAgents(stopFn: (instanceId: string) => Promise<void>): Promise<void> {
    const activeStates = [AgentState.ACTIVE, AgentState.IDLE, AgentState.SLEEP];
    const agentsToStop: string[] = [];
    
    for (const state of activeStates) {
      agentsToStop.push(...this.getAgentsByState(state));
    }
    
    console.log(`Stopping ${agentsToStop.length} agents`);
    
    for (const instanceId of agentsToStop) {
      try {
        await this.stopAgent(instanceId, () => stopFn(instanceId));
      } catch (error) {
        console.error(`Failed to stop ${instanceId}:`, error);
      }
    }
  }

  /**
   * Update lifecycle configuration
   */
  updateConfig(config: Partial<AgentLifecycleConfig>): void {
    this.lifecycleConfig = { ...this.lifecycleConfig, ...config };
    console.log('Updated lifecycle configuration:', this.lifecycleConfig);
  }
}