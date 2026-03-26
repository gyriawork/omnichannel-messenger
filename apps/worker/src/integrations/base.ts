/**
 * Minimal messenger adapter interface for the worker process.
 * Mirrors the API's MessengerAdapter but only includes what the worker needs.
 */
export interface MessengerAdapter {
  connect(credentials?: Record<string, unknown>): Promise<void>;
  disconnect(): Promise<void>;
  sendMessage(
    externalChatId: string,
    text: string,
    options?: { replyToExternalId?: string },
  ): Promise<{ externalMessageId: string }>;
  getStatus(): 'connected' | 'disconnected' | 'token_expired' | 'session_expired';
}

export class MessengerError extends Error {
  constructor(
    public messenger: string,
    public originalError: unknown,
    message?: string,
  ) {
    super(message ?? `${messenger} adapter error`);
    this.name = 'MessengerError';
  }
}
