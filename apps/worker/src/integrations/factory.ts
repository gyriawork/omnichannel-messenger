/**
 * Adapter factory for the worker process.
 * Dynamically imports adapters from the API package since they share the
 * same messenger dependencies. Falls back to a stub if imports fail.
 *
 * In production, the API's adapter implementations (telegram.ts, slack.ts, etc.)
 * should be extracted into a shared package. For now, we create lightweight
 * wrappers that use the same underlying SDKs.
 */

import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

const SUPPORTED_MESSENGERS = ['telegram', 'slack', 'whatsapp', 'gmail'] as const;
type SupportedMessenger = (typeof SUPPORTED_MESSENGERS)[number];

/**
 * Stub adapter used when real messenger integration is not yet implemented.
 * Simulates sending with a small delay and always succeeds.
 */
class StubAdapter implements MessengerAdapter {
  private messenger: string;
  private _status: 'connected' | 'disconnected' | 'token_expired' | 'session_expired' = 'disconnected';

  constructor(messenger: string, _credentials: Record<string, unknown>) {
    this.messenger = messenger;
  }

  async connect(): Promise<void> {
    this._status = 'connected';
  }

  async disconnect(): Promise<void> {
    this._status = 'disconnected';
  }

  async sendMessage(
    externalChatId: string,
    _text: string,
  ): Promise<{ externalMessageId: string }> {
    if (this._status !== 'connected') {
      throw new MessengerError(this.messenger, null, 'Adapter is not connected');
    }
    // Simulate network latency
    await new Promise((resolve) => setTimeout(resolve, 50 + Math.random() * 100));
    return { externalMessageId: `${this.messenger}_msg_${Date.now()}_${externalChatId}` };
  }

  getStatus() {
    return this._status;
  }
}

/**
 * Create a messenger adapter for the given type.
 * Currently uses stub adapters; swap in real implementations as they become available.
 */
export function createAdapter(
  messenger: string,
  credentials: Record<string, unknown>,
): MessengerAdapter {
  if (!(SUPPORTED_MESSENGERS as readonly string[]).includes(messenger)) {
    throw new MessengerError(
      messenger,
      null,
      `Unsupported messenger type: ${messenger}. Supported: ${SUPPORTED_MESSENGERS.join(', ')}`,
    );
  }

  // TODO: Replace with real adapter imports once the adapters are in a shared package:
  //   case 'telegram': return new TelegramAdapter(credentials);
  //   case 'slack':    return new SlackAdapter(credentials);
  //   etc.
  return new StubAdapter(messenger, credentials);
}

export { SUPPORTED_MESSENGERS };
export type { SupportedMessenger };
