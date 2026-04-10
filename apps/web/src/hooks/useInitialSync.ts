'use client';

// ─── Initial sync rehydrate hook ───
// When the dashboard mounts (or the user hard-refreshes the page in the
// middle of a sync), fetch the current integration list once and seed the
// `useInitialSyncStore` if a sync is already running. From that point on the
// store is driven by WebSocket events in `useSocket`.

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthStore } from '@/stores/auth';
import { useInitialSyncStore, type InitialSyncMessenger } from '@/stores/initial-sync';
import { api } from '@/lib/api';

interface IntegrationWithSync {
  id: string;
  messenger: string;
  status: string;
  syncStatus?: string | null;
  syncTotalChats?: number | null;
  syncCompletedChats?: number | null;
  syncError?: string | null;
}

interface IntegrationsResponse {
  integrations: IntegrationWithSync[];
}

const SYNCING_MESSENGERS: InitialSyncMessenger[] = ['telegram', 'slack', 'whatsapp', 'gmail'];

export function useInitialSync() {
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const setProgress = useInitialSyncStore((s) => s.setProgress);
  const setFailed = useInitialSyncStore((s) => s.setFailed);
  const active = useInitialSyncStore((s) => s.active);
  const dismissed = useInitialSyncStore((s) => s.dismissed);

  // Fetch on mount so the overlay can reappear after a page reload, and
  // refetch each time the store clears (`!active`) — e.g. after the user
  // dismisses a failed sync and retries. Using `refetchOnMount: 'always'`
  // prevents a stale cache from masking a fresh syncing/failed state.
  const { data } = useQuery({
    queryKey: ['integrations', 'initial-sync-rehydrate'],
    queryFn: () => api.get<IntegrationsResponse>('/api/integrations'),
    enabled: isAuthenticated && !active,
    staleTime: 15_000,
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!data?.integrations || active) return;

    const running = data.integrations.find(
      (i) =>
        i.syncStatus === 'syncing' &&
        !dismissed.has(i.id) &&
        SYNCING_MESSENGERS.includes(i.messenger as InitialSyncMessenger),
    );
    const failed = data.integrations.find(
      (i) =>
        i.syncStatus === 'failed' &&
        !dismissed.has(i.id) &&
        SYNCING_MESSENGERS.includes(i.messenger as InitialSyncMessenger),
    );

    if (running) {
      setProgress({
        integrationId: running.id,
        messenger: running.messenger as InitialSyncMessenger,
        done: running.syncCompletedChats ?? 0,
        total: running.syncTotalChats ?? null,
      });
    } else if (failed) {
      setProgress({
        integrationId: failed.id,
        messenger: failed.messenger as InitialSyncMessenger,
        done: failed.syncCompletedChats ?? 0,
        total: failed.syncTotalChats ?? null,
      });
      setFailed(failed.id, failed.syncError ?? 'Sync failed');
    }
  }, [data, active, dismissed, setProgress, setFailed]);

  return active;
}
