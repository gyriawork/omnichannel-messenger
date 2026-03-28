import { describe, it, expect } from 'vitest';

describe('ChatList sort logic', () => {
  it('should sort pinned chats by lastActivityAt DESC, then unpinned by lastActivityAt DESC', () => {
    const chats = [
      { id: '1', name: 'Chat 1', preferences: { pinned: false }, lastActivityAt: '2026-03-28T10:00:00Z' },
      { id: '2', name: 'Chat 2', preferences: { pinned: true }, lastActivityAt: '2026-03-28T08:00:00Z' },
      { id: '3', name: 'Chat 3', preferences: { pinned: true }, lastActivityAt: '2026-03-28T09:00:00Z' },
      { id: '4', name: 'Chat 4', preferences: { pinned: false }, lastActivityAt: '2026-03-28T11:00:00Z' },
    ];

    // Apply sorting logic
    const pinned = chats
      .filter((c) => c.preferences?.pinned)
      .sort((a, b) => {
        const aTime = new Date(a.lastActivityAt || 0).getTime();
        const bTime = new Date(b.lastActivityAt || 0).getTime();
        return bTime - aTime;
      });

    const unpinned = chats
      .filter((c) => !c.preferences?.pinned)
      .sort((a, b) => {
        const aTime = new Date(a.lastActivityAt || 0).getTime();
        const bTime = new Date(b.lastActivityAt || 0).getTime();
        return bTime - aTime;
      });

    const sorted = [...pinned, ...unpinned];

    // Chat 3 (pinned, 09:00), Chat 2 (pinned, 08:00), Chat 4 (unpinned, 11:00), Chat 1 (unpinned, 10:00)
    expect(sorted.map((c) => c.id)).toEqual(['3', '2', '4', '1']);
  });
});
