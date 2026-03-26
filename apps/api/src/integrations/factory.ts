// ─── Adapter Factory ───
// Creates the appropriate messenger adapter based on messenger type.

import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';
import { TelegramAdapter } from './telegram.js';
import { SlackAdapter } from './slack.js';
import { WhatsAppAdapter } from './whatsapp.js';
import { GmailAdapter } from './gmail.js';

const SUPPORTED_MESSENGERS = ['telegram', 'slack', 'whatsapp', 'gmail'] as const;
type SupportedMessenger = (typeof SUPPORTED_MESSENGERS)[number];

/**
 * Create a messenger adapter instance for the given messenger type.
 * Does NOT call connect() — caller must do that separately.
 */
export function createAdapter(
  messenger: string,
  credentials: Record<string, unknown>,
): MessengerAdapter {
  switch (messenger as SupportedMessenger) {
    case 'telegram':
      return new TelegramAdapter(credentials as { apiId: number; apiHash: string; session?: string });

    case 'slack':
      return new SlackAdapter(credentials as { token: string });

    case 'whatsapp':
      return new WhatsAppAdapter(credentials as { session?: string; phoneNumber?: string });

    case 'gmail':
      return new GmailAdapter(
        credentials as { clientId: string; clientSecret: string; refreshToken: string },
      );

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
