/**
 * Adapter factory for the worker process.
 * Imports real adapters from the API package via relative paths.
 * Falls back gracefully if adapters can't be loaded.
 */

import type { MessengerAdapter } from './base.js';
import { MessengerError } from './base.js';

const SUPPORTED_MESSENGERS = ['telegram', 'slack', 'whatsapp', 'gmail'] as const;
type SupportedMessenger = (typeof SUPPORTED_MESSENGERS)[number];

// Path to API integrations (relative from worker/dist/integrations/)
const API_INTEGRATIONS = '../../../api/dist/integrations';

/**
 * Create a messenger adapter for the given type.
 * Dynamically imports from the API's compiled adapter files.
 */
export async function createAdapter(
  messenger: string,
  credentials: Record<string, unknown>,
): Promise<MessengerAdapter> {
  try {
    switch (messenger as SupportedMessenger) {
      case 'telegram': {
        const mod = await import(`${API_INTEGRATIONS}/telegram.js`);
        return new mod.TelegramAdapter(credentials);
      }
      case 'slack': {
        const mod = await import(`${API_INTEGRATIONS}/slack.js`);
        return new mod.SlackAdapter(credentials);
      }
      case 'whatsapp': {
        const mod = await import(`${API_INTEGRATIONS}/whatsapp.js`);
        return new mod.WhatsAppAdapter(credentials);
      }
      case 'gmail': {
        const mod = await import(`${API_INTEGRATIONS}/gmail.js`);
        return new mod.GmailAdapter(credentials);
      }
      default:
        throw new MessengerError(
          messenger,
          null,
          `Unsupported messenger: ${messenger}`,
        );
    }
  } catch (err) {
    throw new MessengerError(
      messenger,
      null,
      `Failed to load ${messenger} adapter: ${(err as Error).message}`,
    );
  }
}

export { SUPPORTED_MESSENGERS };
export type { SupportedMessenger };
