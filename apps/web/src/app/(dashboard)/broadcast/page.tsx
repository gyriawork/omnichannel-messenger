'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Send,
  Copy,
  Trash2,
  RotateCcw,
  Radio,
  BarChart3,
  Shield,
  Search,
  Inbox,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  useBroadcasts,
  useSendBroadcast,
  useRetryBroadcast,
  useDuplicateBroadcast,
  useDeleteBroadcast,
} from '@/hooks/useBroadcasts';
import { AntibanSettings } from '@/components/broadcast/AntibanSettings';
import type { BroadcastStatus } from '@/types/broadcast';

const statusTabs: Array<{ label: string; value: BroadcastStatus | null }> = [
  { label: 'All', value: null },
  { label: 'Draft', value: 'draft' },
  { label: 'Sending', value: 'sending' },
  { label: 'Sent', value: 'sent' },
  { label: 'Failed', value: 'failed' },
];

const statusConfig: Record<
  BroadcastStatus,
  { label: string; className: string }
> = {
  draft: { label: 'Draft', className: 'bg-slate-100 text-slate-600' },
  scheduled: { label: 'Scheduled', className: 'bg-blue-100 text-blue-700' },
  sending: {
    label: 'Sending',
    className: 'bg-amber-100 text-amber-700 animate-pulse',
  },
  sent: { label: 'Sent', className: 'bg-emerald-100 text-emerald-700' },
  partially_failed: {
    label: 'Partial Fail',
    className: 'bg-orange-100 text-orange-700',
  },
  failed: { label: 'Failed', className: 'bg-red-100 text-red-700' },
};

type SideView = 'none' | 'antiban' | 'analytics';

export default function BroadcastPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<BroadcastStatus | null>(null);
  const [search, setSearch] = useState('');
  const [sideView, setSideView] = useState<SideView>('none');

  const { data, isLoading } = useBroadcasts({
    status: activeTab,
    search: search || undefined,
  });

  const sendMutation = useSendBroadcast();
  const retryMutation = useRetryBroadcast();
  const duplicateMutation = useDuplicateBroadcast();
  const deleteMutation = useDeleteBroadcast();

  const broadcasts = data?.broadcasts || [];

  function handleSend(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    sendMutation.mutate(id, {
      onSuccess: () => toast.success('Broadcast sending started'),
      onError: () => toast.error('Failed to send broadcast'),
    });
  }

  function handleRetry(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    retryMutation.mutate(id, {
      onSuccess: () => toast.success('Retrying failed messages'),
      onError: () => toast.error('Failed to retry broadcast'),
    });
  }

  function handleDuplicate(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    duplicateMutation.mutate(id, {
      onSuccess: () => toast.success('Broadcast duplicated'),
      onError: () => toast.error('Failed to duplicate broadcast'),
    });
  }

  function handleDelete(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    deleteMutation.mutate(id, {
      onSuccess: () => toast.success('Broadcast deleted'),
      onError: () => toast.error('Failed to delete broadcast'),
    });
  }

  return (
    <div className="flex h-full">
      {/* Main content */}
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-4xl px-6 py-8">
          {/* Header */}
          <div className="mb-6 flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-slate-900">
                Broadcasts
              </h1>
              <p className="mt-1 text-sm text-slate-500">
                Send messages to multiple chats at once
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() =>
                  setSideView(sideView === 'analytics' ? 'none' : 'analytics')
                }
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors',
                  sideView === 'analytics'
                    ? 'bg-accent-bg text-accent'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                <BarChart3 className="h-4 w-4" />
                Analytics
              </button>
              <button
                onClick={() =>
                  setSideView(sideView === 'antiban' ? 'none' : 'antiban')
                }
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-2 text-sm font-medium transition-colors',
                  sideView === 'antiban'
                    ? 'bg-accent-bg text-accent'
                    : 'text-slate-600 hover:bg-slate-100',
                )}
              >
                <Shield className="h-4 w-4" />
                Anti-ban
              </button>
              <button
                onClick={() => router.push('/broadcast/new')}
                className="flex items-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white shadow-accent-sm transition-colors hover:bg-accent-hover"
              >
                <Plus className="h-4 w-4" />
                New Broadcast
              </button>
            </div>
          </div>

          {/* Search */}
          <div className="relative mb-4">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search broadcasts..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border-[1.5px] border-slate-200 bg-white py-2 pl-9 pr-4 text-sm text-slate-900 placeholder:text-slate-400 transition-shadow focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/15"
            />
          </div>

          {/* Tabs */}
          <div className="mb-6 flex gap-1 rounded-lg bg-slate-100 p-1">
            {statusTabs.map((tab) => (
              <button
                key={tab.label}
                onClick={() => setActiveTab(tab.value)}
                className={cn(
                  'flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                  activeTab === tab.value
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-500 hover:text-slate-700',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Broadcast list */}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            </div>
          ) : broadcasts.length === 0 ? (
            <EmptyState status={activeTab} />
          ) : (
            <div className="space-y-3">
              {broadcasts.map((broadcast) => {
                const config = statusConfig[broadcast.status];
                return (
                  <div
                    key={broadcast.id}
                    onClick={() => {
                      if (broadcast.status === 'draft') {
                        router.push(`/broadcast/new?edit=${broadcast.id}`);
                      } else {
                        router.push(`/broadcast/${broadcast.id}`);
                      }
                    }}
                    className="group cursor-pointer rounded-lg bg-white p-4 shadow-xs transition-shadow hover:shadow-sm"
                  >
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <h3 className="truncate text-sm font-semibold text-slate-900">
                            {broadcast.name}
                          </h3>
                          <span
                            className={cn(
                              'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
                              config.className,
                            )}
                          >
                            {config.label}
                          </span>
                        </div>
                        <p className="mt-1 line-clamp-2 text-sm text-slate-500">
                          {broadcast.messageText}
                        </p>
                        <div className="mt-3 flex flex-wrap items-center gap-4 text-xs text-slate-400">
                          {broadcast.chatCount != null && (
                            <span>{broadcast.chatCount} recipients</span>
                          )}
                          {broadcast.sentCount != null && (
                            <span className="text-emerald-600">
                              {broadcast.sentCount} sent
                            </span>
                          )}
                          {(broadcast.failedCount ?? 0) > 0 && (
                            <span className="text-red-500">
                              {broadcast.failedCount} failed
                            </span>
                          )}
                          {broadcast.deliveryRate != null && (
                            <span className="font-medium text-slate-600">
                              {Math.round((broadcast.deliveryRate ?? 0) * 100)}% delivered
                            </span>
                          )}
                          <span>
                            {new Date(broadcast.createdAt).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit',
                              },
                            )}
                          </span>
                          {broadcast.sentAt && (
                            <span>
                              Sent{' '}
                              {new Date(broadcast.sentAt).toLocaleDateString(
                                'en-US',
                                {
                                  month: 'short',
                                  day: 'numeric',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                },
                              )}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Actions */}
                      <div className="ml-4 flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                        {broadcast.status === 'draft' && (
                          <button
                            onClick={(e) => handleSend(broadcast.id, e)}
                            title="Send now"
                            className="rounded p-1.5 text-accent hover:bg-accent-bg"
                          >
                            <Send className="h-4 w-4" />
                          </button>
                        )}
                        {(broadcast.status === 'failed' ||
                          broadcast.status === 'partially_failed') && (
                          <button
                            onClick={(e) => handleRetry(broadcast.id, e)}
                            title="Retry failed"
                            className="rounded p-1.5 text-amber-600 hover:bg-amber-50"
                          >
                            <RotateCcw className="h-4 w-4" />
                          </button>
                        )}
                        <button
                          onClick={(e) => handleDuplicate(broadcast.id, e)}
                          title="Duplicate"
                          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                        >
                          <Copy className="h-4 w-4" />
                        </button>
                        <button
                          onClick={(e) => handleDelete(broadcast.id, e)}
                          title="Delete"
                          className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Side panel */}
      {sideView === 'antiban' && (
        <div className="w-[420px] shrink-0 overflow-auto border-l border-slate-200 bg-white">
          <AntibanSettings />
        </div>
      )}
      {sideView === 'analytics' && (
        <div className="w-[420px] shrink-0 overflow-auto border-l border-slate-200 bg-white">
          <AnalyticsPanel />
        </div>
      )}
    </div>
  );
}

function EmptyState({ status }: { status: BroadcastStatus | null }) {
  const messages: Record<string, { icon: React.ReactNode; text: string }> = {
    default: {
      icon: <Radio className="h-10 w-10 text-slate-300" />,
      text: 'No broadcasts yet. Create your first broadcast to start reaching multiple chats at once.',
    },
    draft: {
      icon: <Inbox className="h-10 w-10 text-slate-300" />,
      text: 'No draft broadcasts. Start a new broadcast to save it as a draft.',
    },
    sending: {
      icon: <Send className="h-10 w-10 text-slate-300" />,
      text: 'No broadcasts are currently sending.',
    },
    sent: {
      icon: <Radio className="h-10 w-10 text-slate-300" />,
      text: 'No sent broadcasts yet.',
    },
    failed: {
      icon: <RotateCcw className="h-10 w-10 text-slate-300" />,
      text: 'No failed broadcasts. Great job!',
    },
  };

  const content = messages[status || 'default'] || messages.default;

  return (
    <div className="flex flex-col items-center justify-center py-20 text-center">
      {content.icon}
      <p className="mt-4 max-w-sm text-sm text-slate-500">{content.text}</p>
    </div>
  );
}

function AnalyticsPanel() {
  const router = useRouter();

  return (
    <div className="p-6">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-slate-900">
          Quick Analytics
        </h2>
        <button
          onClick={() => router.push('/broadcast/analytics')}
          className="text-sm font-medium text-accent hover:text-accent-hover"
        >
          View Full
        </button>
      </div>
      <p className="text-sm text-slate-500">
        Open the full analytics page for detailed broadcast performance data,
        charts, and per-messenger breakdowns.
      </p>
      <button
        onClick={() => router.push('/broadcast/analytics')}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded bg-accent px-4 py-2 text-sm font-medium text-white shadow-accent-sm transition-colors hover:bg-accent-hover"
      >
        <BarChart3 className="h-4 w-4" />
        Open Analytics
      </button>
    </div>
  );
}
