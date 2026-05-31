/**
 * Mailbox Router - Async communication system for agents
 * 
 * Provides:
 * - Inbox/outbox management for each agent
 * - Message routing between agents
 * - Subscription management
 * - Async notification system
 */

export interface Message {
  id: string;
  from: string; // sender mailbox address
  to: string; // recipient mailbox address
  type: 'request' | 'response' | 'notification';
  payload: any;
  timestamp: Date;
  status: 'pending' | 'delivered' | 'failed';
}

export interface Subscription {
  subscriberId: string;
  targetMailbox: string;
  messageType: string;
  callback: (message: Message) => void;
}

export class MailboxRouter {
  private mailboxes: Map<string, Message[]> = new Map();
  private subscriptions: Map<string, Subscription[]> = new Map();
  private messageIdCounter = 0;

  /**
   * Create a mailbox for an agent
   */
  createMailbox(mailboxAddress: string): void {
    if (!this.mailboxes.has(mailboxAddress)) {
      this.mailboxes.set(mailboxAddress, []);
      console.log(`Created mailbox: ${mailboxAddress}`);
    }
  }

  /**
   * Send a message to a mailbox
   */
  async sendMessage(message: Omit<Message, 'id' | 'timestamp' | 'status'>): Promise<string> {
    const fullMessage: Message = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
      status: 'pending'
    };

    const recipientMailbox = this.mailboxes.get(message.to);
    if (!recipientMailbox) {
      throw new Error(`Mailbox not found: ${message.to}`);
    }

    recipientMailbox.push(fullMessage);
    fullMessage.status = 'delivered';

    console.log(`Message sent from ${message.from} to ${message.to}: ${fullMessage.id}`);

    // Notify subscribers
    await this.notifySubscribers(message.to, fullMessage);

    return fullMessage.id;
  }

  /**
   * Get messages from a mailbox
   */
  getMessages(mailboxAddress: string, since?: Date): Message[] {
    const mailbox = this.mailboxes.get(mailboxAddress);
    if (!mailbox) {
      return [];
    }

    if (since) {
      return mailbox.filter(msg => msg.timestamp >= since);
    }

    return [...mailbox];
  }

  /**
   * Get unread messages from a mailbox
   */
  getUnreadMessages(mailboxAddress: string): Message[] {
    const mailbox = this.mailboxes.get(mailboxAddress);
    if (!mailbox) {
      return [];
    }

    // For simplicity, return all messages (would add read tracking in production)
    return [...mailbox];
  }

  /**
   * Subscribe to messages from a specific mailbox
   */
  subscribe(subscription: Subscription): void {
    const key = `${subscription.subscriberId}-${subscription.targetMailbox}`;
    
    if (!this.subscriptions.has(key)) {
      this.subscriptions.set(key, []);
    }

    this.subscriptions.get(key)!.push(subscription);
    console.log(`Subscription added: ${subscription.subscriberId} -> ${subscription.targetMailbox}`);
  }

  /**
   * Unsubscribe from a mailbox
   */
  unsubscribe(subscriberId: string, targetMailbox: string): void {
    const key = `${subscriberId}-${targetMailbox}`;
    this.subscriptions.delete(key);
    console.log(`Subscription removed: ${subscriberId} -> ${targetMailbox}`);
  }

  /**
   * Notify subscribers of new messages
   */
  private async notifySubscribers(mailboxAddress: string, message: Message): Promise<void> {
    const subscribers: Subscription[] = [];

    // Find all subscriptions for this mailbox
    for (const [key, subs] of this.subscriptions.entries()) {
      if (key.endsWith(`-${mailboxAddress}`)) {
        subscribers.push(...subs);
      }
    }

    // Notify each subscriber if message type matches their subscription
    for (const sub of subscribers) {
      try {
        // Only notify if message type matches subscription
        if (!sub.messageType || sub.messageType === message.type) {
          await sub.callback(message);
        }
      } catch (error) {
        console.error(`Error notifying subscriber ${sub.subscriberId}:`, error);
      }
    }
  }

  /**
   * Clear old messages from a mailbox
   */
  clearMailbox(mailboxAddress: string, olderThan?: Date): void {
    const mailbox = this.mailboxes.get(mailboxAddress);
    if (!mailbox) {
      return;
    }

    if (olderThan) {
      const before = mailbox.length;
      const filtered = mailbox.filter(msg => msg.timestamp >= olderThan);
      this.mailboxes.set(mailboxAddress, filtered);
      console.log(`Cleared ${before - filtered.length} old messages from ${mailboxAddress}`);
    } else {
      this.mailboxes.set(mailboxAddress, []);
      console.log(`Cleared all messages from ${mailboxAddress}`);
    }
  }

  /**
   * Delete a mailbox
   */
  deleteMailbox(mailboxAddress: string): void {
    this.mailboxes.delete(mailboxAddress);
    
    // Remove all subscriptions for this mailbox
    const keysToDelete: string[] = [];
    for (const key of this.subscriptions.keys()) {
      if (key.endsWith(`-${mailboxAddress}`)) {
        keysToDelete.push(key);
      }
    }
    
    for (const key of keysToDelete) {
      this.subscriptions.delete(key);
    }

    console.log(`Deleted mailbox: ${mailboxAddress}`);
  }

  /**
   * Get router status
   */
  getRouterStatus(): any {
    const status: any = {
      totalMailboxes: this.mailboxes.size,
      totalSubscriptions: 0,
      mailboxes: {}
    };

    for (const [address, messages] of this.mailboxes.entries()) {
      status.totalSubscriptions += this.countSubscriptionsForMailbox(address);
      status.mailboxes[address] = {
        messageCount: messages.length,
        subscriberCount: this.countSubscriptionsForMailbox(address)
      };
    }

    return status;
  }

  /**
   * Count subscriptions for a specific mailbox
   */
  private countSubscriptionsForMailbox(mailboxAddress: string): number {
    let count = 0;
    for (const key of this.subscriptions.keys()) {
      if (key.endsWith(`-${mailboxAddress}`)) {
        count += this.subscriptions.get(key)!.length;
      }
    }
    return count;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg-${Date.now()}-${this.messageIdCounter++}`;
  }
}