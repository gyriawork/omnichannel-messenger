'use client';

import { useState, useCallback } from 'react';
import { X, Loader2, Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { useIntegrations } from '@/hooks/useIntegrations';
import { useQueryClient } from '@tanstack/react-query';
import type { MessengerType } from '@/types/chat';

interface AvailableChat {
  externalChatId: string;
  name: string;
  chatType: string;
}

interface ImportChatsModalProps {
  onClose: () => void;
}

const MESSENGER_LABELS: Record<MessengerType, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  gmail: 'Gmail',
};

export function ImportChatsModal({ onClose }: ImportChatsModalProps) {
  const { data: integrationsData } = useIntegrations();
  const queryClient = useQueryClient();

  const connectedMessengers = (integrationsData?.integrations ?? [])
    .filter((i) => i.status === 'connected')
    .map((i) => i.messenger as MessengerType);

  const [selectedMessenger, setSelectedMessenger] = useState<MessengerType | null>(
    connectedMessengers[0] ?? null,
  );
  const [availableChats, setAvailableChats] = useState<AvailableChat[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoadingChats, setIsLoadingChats] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [hasLoaded, setHasLoaded] = useState(false);

  const handleLoadChats = useCallback(async () => {
    if (!selectedMessenger) return;
    setIsLoadingChats(true);
    setAvailableChats([]);
    setSelectedIds(new Set());
    setHasLoaded(false);

    try {
      const data = await api.post<{ chats: AvailableChat[] }>(
        `/api/integrations/${selectedMessenger}/list-chats`,
        {},
      );
      setAvailableChats(data.chats);
      setHasLoaded(true);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to load chats',
      );
    } finally {
      setIsLoadingChats(false);
    }
  }, [selectedMessenger]);

  const toggleChat = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleImport = async () => {
    if (!selectedMessenger || selectedIds.size === 0) return;
    setIsImporting(true);
    try {
      await api.post('/api/chats/import', {
        messenger: selectedMessenger,
        externalChatIds: Array.from(selectedIds),
      });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      toast.success(`Imported ${selectedIds.size} chat(s)`);
      onClose();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : 'Failed to import chats',
      );
    } finally {
      setIsImporting(false);
    }
  };

  const filteredChats = searchFilter
    ? availableChats.filter((c) =>
        c.name.toLowerCase().includes(searchFilter.toLowerCase()),
      )
    : availableChats;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 backdrop-blur-sm md:items-center">
      <div className="flex w-full max-h-[90dvh] flex-col rounded-t-2xl bg-white shadow-lg md:max-w-lg md:rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">
              Import Chats
            </h3>
            <p className="text-xs text-slate-500">
              Select chats to add from a connected messenger
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {connectedMessengers.length === 0 ? (
            <div className="py-8 text-center text-sm text-slate-400">
              No messengers connected. Go to Settings to connect one.
            </div>
          ) : (
            <>
              {/* Messenger selector */}
              <div className="mb-4 flex items-center gap-2">
                <select
                  value={selectedMessenger ?? ''}
                  onChange={(e) => {
                    setSelectedMessenger(e.target.value as MessengerType);
                    setAvailableChats([]);
                    setSelectedIds(new Set());
                    setHasLoaded(false);
                  }}
                  className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700 outline-none focus:border-accent focus:bg-white"
                >
                  {connectedMessengers.map((m) => (
                    <option key={m} value={m}>
                      {MESSENGER_LABELS[m]}
                    </option>
                  ))}
                </select>
                <button
                  onClick={handleLoadChats}
                  disabled={!selectedMessenger || isLoadingChats}
                  className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                >
                  {isLoadingChats ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Load Chats
                </button>
              </div>

              {/* Search */}
              {hasLoaded && availableChats.length > 0 && (
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Filter chats..."
                    value={searchFilter}
                    onChange={(e) => setSearchFilter(e.target.value)}
                    className="h-9 w-full rounded-lg border border-slate-200 bg-slate-50 pl-9 pr-3 text-sm outline-none focus:border-accent focus:bg-white"
                  />
                </div>
              )}

              {/* Chat list */}
              {hasLoaded && availableChats.length === 0 && (
                <div className="py-8 text-center text-sm text-slate-400">
                  No available chats found
                </div>
              )}

              {filteredChats.length > 0 && (
                <div className="max-h-64 space-y-1 overflow-y-auto">
                  {filteredChats.map((chat) => (
                    <label
                      key={chat.externalChatId}
                      className={cn(
                        'flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors',
                        selectedIds.has(chat.externalChatId)
                          ? 'bg-accent-bg'
                          : 'hover:bg-slate-50',
                      )}
                    >
                      <input
                        type="checkbox"
                        checked={selectedIds.has(chat.externalChatId)}
                        onChange={() => toggleChat(chat.externalChatId)}
                        className="h-4 w-4 rounded border-slate-300 text-accent focus:ring-accent"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-slate-700">
                          {chat.name}
                        </p>
                        <p className="text-xs text-slate-400">{chat.chatType}</p>
                      </div>
                    </label>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer */}
        {hasLoaded && availableChats.length > 0 && (
          <div className="border-t border-slate-100 px-5 py-4">
            <button
              onClick={handleImport}
              disabled={selectedIds.size === 0 || isImporting}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-all hover:bg-accent-hover disabled:opacity-50"
            >
              {isImporting ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Download className="h-4 w-4" />
              )}
              Import {selectedIds.size > 0 ? `${selectedIds.size} chat(s)` : 'selected'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
