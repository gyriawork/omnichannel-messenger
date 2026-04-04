import { describe, it, expect } from 'vitest';
import { externalUserToUuid } from './message-service.js';

describe('externalUserToUuid', () => {
  it('should return a valid UUID string', () => {
    const uuid = externalUserToUuid('telegram', '12345');
    expect(uuid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('should be deterministic (same input = same output)', () => {
    const uuid1 = externalUserToUuid('telegram', '12345');
    const uuid2 = externalUserToUuid('telegram', '12345');
    expect(uuid1).toBe(uuid2);
  });

  it('should produce different UUIDs for different messengers', () => {
    const tgUuid = externalUserToUuid('telegram', '12345');
    const slackUuid = externalUserToUuid('slack', '12345');
    expect(tgUuid).not.toBe(slackUuid);
  });

  it('should produce different UUIDs for different user IDs', () => {
    const uuid1 = externalUserToUuid('telegram', '12345');
    const uuid2 = externalUserToUuid('telegram', '67890');
    expect(uuid1).not.toBe(uuid2);
  });
});
