// ─── Adapter Factory ───
// Creates the appropriate messenger adapter based on messenger type.
// Uses dynamic imports to avoid crashing if native deps are missing.

import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

const SUPPORTED_MESSENGERS = ['telegram', 'slack', 'whatsapp', 'gmail'] as const;
type SupportedMessenger = (typeof SUPPORTED_MESSENGERS)[number];

/**
 * Create a messenger adapter instance for the given messenger type.
 * Does NOT call connect() — caller must do that separately.
 */
export async function createAdapter(
  messenger: string,
  credentials: Record<string, unknown>,
): Promise<MessengerAdapter> {
  switch (messenger as SupportedMessenger) {
    case 'telegram': {
      const { TelegramAdapter } = await import('./telegram.js');
      return new TelegramAdapter(credentials as { apiId: number; apiHash: string; session?: string });
    }
    case 'slack': {
      const { SlackAdapter } = await import('./slack.js');
      return new SlackAdapter(credentials as { token: string });
    }
    case 'whatsapp': {
      const { WhatsAppAdapter } = await import('./whatsapp.js');
      return new WhatsAppAdapter(credentials as { authState?: string; phoneNumber?: string });
    }
    case 'gmail': {
      const { GmailAdapter } = await import('./gmail.js');
      return new GmailAdapter(
        credentials as { clientId: string; clientSecret: string; refreshToken: string },
      );
    }
    default:
      throw new MessengerError(
        messenger,
        null,
        `Unsupported messenger type: ${messenger}. Supported: ${SUPPORTED_MESSENGERS.join(', ')}`,
      );
  }
}

export { SUPPORTED_MESSENGERS };
export type { SupportedMessenger };
