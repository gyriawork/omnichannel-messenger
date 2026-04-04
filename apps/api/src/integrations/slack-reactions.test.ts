import { describe, it, expect } from 'vitest';
import { emojiToSlackName, slackNameToEmoji } from './slack.js';

describe('Slack emoji mapping', () => {
  it('should convert thumbs up Unicode to slack name', () => {
    expect(emojiToSlackName('👍')).toBe('thumbsup');
  });

  it('should convert heart Unicode to slack name', () => {
    expect(emojiToSlackName('❤️')).toBe('heart');
  });

  it('should convert fire Unicode to slack name', () => {
    expect(emojiToSlackName('🔥')).toBe('fire');
  });

  it('should convert slack name back to Unicode', () => {
    expect(slackNameToEmoji('thumbsup')).toBe('👍');
  });

  it('should return original for unknown emoji', () => {
    expect(emojiToSlackName('⚡')).toBeTruthy(); // should not throw
  });
});

describe('SlackAdapter reactions', () => {
  it('should have addReaction method', async () => {
    const { SlackAdapter } = await import('./slack.js');
    expect(SlackAdapter.prototype.addReaction).toBeDefined();
  });

  it('should have removeReaction method', async () => {
    const { SlackAdapter } = await import('./slack.js');
    expect(SlackAdapter.prototype.removeReaction).toBeDefined();
  });
});
