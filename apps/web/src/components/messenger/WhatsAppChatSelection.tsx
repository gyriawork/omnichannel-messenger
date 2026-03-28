'use client';

import { useState } from 'react';
import { Check, Loader } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { WhatsAppChat } from '@/hooks/useWhatsAppPairing';

interface WhatsAppChatSelectionProps {
  chats: WhatsAppChat[];
  selectedChatIds: Set<string>;
  onToggleChat: (chatId: string) => void;
  onImport: () => Promise<void>;
  isImporting: boolean;
}

export function WhatsAppChatSelection({
  chats,
  selectedChatIds,
  onToggleChat,
  onImport,
  isImporting,
}: WhatsAppChatSelectionProps) {
  const [isLoading, setIsLoading] = useState(false);

  const handleImport = async () => {
    setIsLoading(true);
    try {
      await onImport();
    } finally {
      setIsLoading(false);
    }
  };

  if (chats.length === 0) {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-4 text-center">
        <p className="text-sm text-slate-600">No chats available</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-slate-200 bg-white">
        <div className="max-h-96 overflow-y-auto">
          {chats.map((chat) => {
            const isSelected = selectedChatIds.has(chat.externalChatId);
            return (
              <button
                key={chat.externalChatId}
                onClick={() => onToggleChat(chat.externalChatId)}
                className={cn(
                  'flex w-full items-center gap-3 border-b border-slate-100 px-4 py-3 text-left transition-colors last:border-b-0 hover:bg-slate-50',
                  isSelected && 'bg-accent-bg'
                )}
              >
                {/* Checkbox */}
                <div
                  className={cn(
                    'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border',
                    isSelected
                      ? 'border-accent bg-accent'
                      : 'border-slate-300 bg-white'
                  )}
                >
                  {isSelected && (
                    <Check className="h-3.5 w-3.5 text-white" />
                  )}
                </div>

                {/* Chat info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-900 truncate">
                    {chat.name}
                  </p>
                  <p className="text-xs text-slate-500">
                    {chat.chatType === 'group' ? 'Group' : 'Contact'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Import button */}
      <button
        onClick={handleImport}
        disabled={selectedChatIds.size === 0 || isLoading || isImporting}
        className={cn(
          'w-full rounded-lg px-4 py-2.5 text-sm font-medium transition-colors',
          selectedChatIds.size === 0 || isLoading || isImporting
            ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
            : 'bg-accent text-white hover:bg-accent-hover'
        )}
      >
        {isLoading || isImporting ? (
          <span className="flex items-center justify-center gap-2">
            <Loader className="h-4 w-4 animate-spin" />
            Importing...
          </span>
        ) : (
          `Import ${selectedChatIds.size} chat${selectedChatIds.size !== 1 ? 's' : ''}`
        )}
      </button>
    </div>
  );
}
