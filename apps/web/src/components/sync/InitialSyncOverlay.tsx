'use client';

// ─── Initial sync overlay ───
// Blocks the whole dashboard while we import chats for a freshly-connected
// integration. Driven by the `useInitialSyncStore` Zustand store, which is
// populated by WebSocket events in `useSocket` and rehydrated on page reload
// by `useInitialSync`.

import { useInitialSyncStore } from '@/stores/initial-sync';
import { MessengerIcon } from '@/components/ui/MessengerIcon';
import { api } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';

const MESSENGER_LABELS: Record<string, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  gmail: 'Gmail',
};

export function InitialSyncOverlay() {
  const active = useInitialSyncStore((s) => s.active);
  const setProgress = useInitialSyncStore((s) => s.setProgress);
  const setFailed = useInitialSyncStore((s) => s.setFailed);
  const clear = useInitialSyncStore((s) => s.clear);
  const queryClient = useQueryClient();

  if (!active) return null;

  const label = MESSENGER_LABELS[active.messenger] ?? active.messenger;
  const isFailed = active.status === 'failed';

  const percent =
    active.total && active.total > 0
      ? Math.min(100, Math.round((active.done / active.total) * 100))
      : null;

  const handleRetry = async () => {
    // Flip to "syncing" immediately so the user sees feedback right away —
    // otherwise the failed state lingers until the first WS progress event.
    const snapshot = active;
    setProgress({
      integrationId: snapshot.integrationId,
      messenger: snapshot.messenger,
      done: 0,
      total: null,
    });
    try {
      await api.post(`/api/integrations/${snapshot.messenger}/resync`, {});
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    } catch (err) {
      console.error('[InitialSync] retry failed', err);
      const message = err instanceof Error ? err.message : 'Failed to restart sync';
      setFailed(snapshot.integrationId, message);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm"
      aria-modal="true"
      role="dialog"
    >
      <div className="mx-4 w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl dark:bg-slate-900">
        <div className="flex flex-col items-center text-center">
          <MessengerIcon messenger={active.messenger} size={56} />

          <h2 className="mt-5 text-xl font-semibold text-slate-900 dark:text-slate-100">
            {isFailed
              ? `Failed to sync ${label}`
              : `Syncing ${label}`}
          </h2>

          {!isFailed && (
            <p className="mt-2 text-sm text-slate-500 dark:text-slate-400">
              Pulling in all your chats. This may take a couple of minutes — do not close the tab.
            </p>
          )}

          {isFailed && active.error && (
            <p className="mt-2 text-sm text-red-600 dark:text-red-400">
              {active.error}
            </p>
          )}

          {!isFailed && (
            <div className="mt-6 w-full">
              <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
                <div
                  className="h-full bg-blue-600 transition-all duration-500 ease-out"
                  style={{
                    width: percent !== null ? `${percent}%` : '33%',
                  }}
                />
              </div>
              <div className="mt-3 flex items-center justify-between text-sm">
                <span className="text-slate-600 dark:text-slate-300">
                  {active.total !== null
                    ? `${active.done} of ${active.total}`
                    : `${active.done} chats`}
                </span>
                {percent !== null && (
                  <span className="font-medium text-slate-700 dark:text-slate-200">
                    {percent}%
                  </span>
                )}
              </div>
              {active.currentName && (
                <p className="mt-3 truncate text-xs text-slate-500 dark:text-slate-400">
                  {active.currentName}
                </p>
              )}
            </div>
          )}

          {isFailed && (
            <div className="mt-6 flex w-full gap-3">
              <button
                type="button"
                onClick={clear}
                className="flex-1 rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-200 dark:hover:bg-slate-800"
              >
                Close
              </button>
              <button
                type="button"
                onClick={handleRetry}
                className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Retry
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
