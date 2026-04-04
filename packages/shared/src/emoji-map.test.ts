import { describe, it, expect } from 'vitest';
import { TELEGRAM_ALLOWED_EMOJI, getReactionSupport } from './emoji-map';

describe('emoji-map', () => {
  describe('TELEGRAM_ALLOWED_EMOJI', () => {
    it('should contain common emoji', () => {
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('👍');
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('❤️');
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('🔥');
      expect(TELEGRAM_ALLOWED_EMOJI).toContain('😂');
    });

    it('should have at least 50 emoji', () => {
      expect(TELEGRAM_ALLOWED_EMOJI.length).toBeGreaterThanOrEqual(50);
    });

    it('should not contain duplicates', () => {
      const unique = new Set(TELEGRAM_ALLOWED_EMOJI);
      expect(unique.size).toBe(TELEGRAM_ALLOWED_EMOJI.length);
    });
  });

  describe('getReactionSupport', () => {
    it('should return limited for telegram', () => {
      expect(getReactionSupport('telegram')).toBe('limited');
    });

    it('should return full for slack', () => {
      expect(getReactionSupport('slack')).toBe('full');
    });

    it('should return none for gmail', () => {
      expect(getReactionSupport('gmail')).toBe('none');
    });

    it('should return none for whatsapp', () => {
      expect(getReactionSupport('whatsapp')).toBe('none');
    });

    it('should return none for unknown messenger', () => {
      expect(getReactionSupport('unknown')).toBe('none');
    });
  });
});
