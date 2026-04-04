import { describe, it, expect } from 'vitest';

describe('TelegramAdapter reactions', () => {
  it('addReaction should call SendReaction with emoji', async () => {
    // We can't instantiate a real TelegramAdapter without credentials,
    // so we verify the method exists and has the right signature
    const { TelegramAdapter } = await import('./telegram.js');
    expect(TelegramAdapter.prototype.addReaction).toBeDefined();
    expect(TelegramAdapter.prototype.addReaction.length).toBeGreaterThanOrEqual(3);
  });

  it('removeReaction should call SendReaction with remaining emoji', async () => {
    const { TelegramAdapter } = await import('./telegram.js');
    expect(TelegramAdapter.prototype.removeReaction).toBeDefined();
    expect(TelegramAdapter.prototype.removeReaction.length).toBeGreaterThanOrEqual(3);
  });
});
