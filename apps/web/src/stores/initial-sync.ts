'use client';

// ─── Initial sync store ───
// Tracks the blocking "we're importing all your chats" overlay state.
// Updated by the WebSocket listener in useSocket and by the initial rehydrate
// fetch in useInitialSync (for page reloads during sync).

import { create } from 'zustand';

export type InitialSyncMessenger = 'telegram' | 'slack' | 'whatsapp' | 'gmail';

export interface ActiveSync {
  integrationId: string;
  messenger: InitialSyncMessenger;
  done: number;
  total: number | null; // null = we don't know the total yet
  currentName?: string;
  error?: string;
  status: 'syncing' | 'failed';
}

interface InitialSyncStore {
  active: ActiveSync | null;
  setProgress: (data: Omit<ActiveSync, 'status'> & { status?: 'syncing' }) => void;
  setComplete: (integrationId: string) => void;
  setFailed: (integrationId: string, error: string) => void;
  clear: () => void;
}

export const useInitialSyncStore = create<InitialSyncStore>((set) => ({
  active: null,

  setProgress: (data) =>
    set({
      active: {
        integrationId: data.integrationId,
        messenger: data.messenger,
        done: data.done,
        total: data.total,
        currentName: data.currentName,
        status: 'syncing',
      },
    }),

  setComplete: (integrationId) =>
    set((state) => {
      if (state.active?.integrationId !== integrationId) return state;
      return { active: null };
    }),

  setFailed: (integrationId, error) =>
    set((state) => {
      if (!state.active || state.active.integrationId !== integrationId) {
        return state;
      }
      return {
        active: { ...state.active, status: 'failed', error },
      };
    }),

  clear: () => set({ active: null }),
}));
