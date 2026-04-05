'use client';

import { useState, useCallback, useMemo } from 'react';
import {
  X,
  ChevronRight,
  ChevronLeft,
  Check,
  Loader2,
  MessageSquare,
  QrCode,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAvailableChats, useImportChats } from '@/hooks/useChats';
import { useWhatsAppPairing } from '@/hooks/useWhatsAppPairing';
import { WhatsAppChatSelection } from './WhatsAppChatSelection';
import { toast } from 'sonner';
import type { MessengerType, AvailableChat } from '@/types/chat';

interface ImportChatsModalProps {
  open: boolean;
  onClose: () => void;
}

const MESSENGERS: Array<{
  key: MessengerType;
  name: string;
  description: string;
  dotColor: string;
  bgClass: string;
  textClass: string;
  borderClass: string;
}> = [
  {
    key: 'telegram',
    name: 'Telegram',
    description: 'Import personal and group chats',
    dotColor: '#0088cc',
    bgClass: 'bg-messenger-tg-bg',
    textClass: 'text-messenger-tg-text',
    borderClass: 'border-[#0088cc]/20',
  },
  {
    key: 'slack',
    name: 'Slack',
    description: 'Import channels and DMs',
    dotColor: '#611f69',
    bgClass: 'bg-messenger-sl-bg',
    textClass: 'text-messenger-sl-text',
    borderClass: 'border-[#611f69]/20',
  },
  {
    key: 'whatsapp',
    name: 'WhatsApp',
    description: 'Import personal and group chats',
    dotColor: '#25D366',
    bgClass: 'bg-messenger-wa-bg',
    textClass: 'text-messenger-wa-text',
    borderClass: 'border-[#25D366]/20',
  },
  {
    key: 'gmail',
    name: 'Gmail',
    description: 'Import email conversations',
    dotColor: '#EA4335',
    bgClass: 'bg-messenger-gm-bg',
    textClass: 'text-messenger-gm-text',
    borderClass: 'border-[#EA4335]/20',
  },
];

// Mock data for development
const MOCK_CHATS: Record<MessengerType, AvailableChat[]> = {
  telegram: [
    { externalChatId: 'tg-1', name: 'Product Team', chatType: 'group', memberCount: 12 },
    { externalChatId: 'tg-2', name: 'Anna M.', chatType: 'direct' },
    { externalChatId: 'tg-3', name: 'Dev Channel', chatType: 'channel', memberCount: 154 },
    { externalChatId: 'tg-4', name: 'Alex K.', chatType: 'direct' },
    { externalChatId: 'tg-5', name: 'Marketing Updates', chatType: 'channel', memberCount: 87 },
  ],
  slack: [
    { externalChatId: 'sl-1', name: '#general', chatType: 'channel', memberCount: 45 },
    { externalChatId: 'sl-2', name: '#engineering', chatType: 'channel', memberCount: 20 },
    { externalChatId: 'sl-3', name: 'Sarah C.', chatType: 'direct' },
    { externalChatId: 'sl-4', name: '#design', chatType: 'channel', memberCount: 15 },
  ],
  whatsapp: [
    { externalChatId: 'wa-1', name: 'Family Group', chatType: 'group', memberCount: 8 },
    { externalChatId: 'wa-2', name: 'Mike T.', chatType: 'direct' },
    { externalChatId: 'wa-3', name: 'Project Alpha', chatType: 'group', memberCount: 5 },
  ],
  gmail: [
    { externalChatId: 'gm-1', name: 'support@company.com', chatType: 'direct' },
    { externalChatId: 'gm-2', name: 'Newsletter Thread', chatType: 'group' },
    { externalChatId: 'gm-3', name: 'john@client.com', chatType: 'direct' },
  ],
};

export function ImportChatsModal({ open, onClose }: ImportChatsModalProps) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [selectedMessenger, setSelectedMessenger] =
    useState<MessengerType | null>(null);
  const [selectedChats, setSelectedChats] = useState<Set<string>>(new Set());

  const { data: availableData, isLoading: isLoadingAvailable } =
    useAvailableChats(selectedMessenger);
  const { mutate: importChats, isPending: isImporting } = useImportChats();

  // WhatsApp-specific pairing hook
  const whatsappPairing = useWhatsAppPairing();

  // Use real data if available, fall back to mock.
  // Ensure all chats have unique non-empty externalChatId to prevent selection bugs.
  const availableChats = useMemo(() => {
    const raw = availableData?.chats ?? (selectedMessenger ? MOCK_CHATS[selectedMessenger] : []);
    return raw.map((chat, idx) => ({
      ...chat,
      externalChatId: chat.externalChatId || `fallback-${idx}`,
    }));
  }, [availableData, selectedMessenger]);

  const handleClose = () => {
    setStep(1);
    setSelectedMessenger(null);
    setSelectedChats(new Set());
    // Cancel WhatsApp pairing if modal is closed
    if (selectedMessenger === 'whatsapp') {
      whatsappPairing.cancelPairing();
    }
    onClose();
  };

  const handleSelectMessenger = (messenger: MessengerType) => {
    setSelectedMessenger(messenger);
    setSelectedChats(new Set());
    setStep(2);

    // Start WhatsApp pairing if WhatsApp is selected
    if (messenger === 'whatsapp') {
      whatsappPairing.reset();
      whatsappPairing.startPairing();
    }
  };

  const toggleChat = (id: string) => {
    setSelectedChats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleAll = () => {
    if (selectedChats.size === availableChats.length) {
      setSelectedChats(new Set());
    } else {
      setSelectedChats(new Set(availableChats.map((c) => c.externalChatId)));
    }
  };

  const handleImport = useCallback(async () => {
    if (!selectedMessenger || selectedChats.size === 0) return;

    // For WhatsApp, use the hook's import function
    if (selectedMessenger === 'whatsapp') {
      try {
        await whatsappPairing.importSelectedChats();
        toast.success(
          `Successfully imported ${selectedChats.size} chat${selectedChats.size !== 1 ? 's' : ''}`,
        );
        handleClose();
      } catch {
        toast.error('Failed to import chats. Please try again.');
      }
      return;
    }

    // For other messengers, use the generic import function
    const chatsToImport = Array.from(selectedChats).map((id) => {
      const chat = availableChats.find((c) => c.externalChatId === id);
      return {
        externalChatId: id,
        name: chat?.name || 'Unknown',
        chatType: chat?.chatType || 'direct',
      };
    });
    importChats(
      { messenger: selectedMessenger, chats: chatsToImport },
      {
        onSuccess: (data) => {
          toast.success(
            `Successfully imported ${data.imported} chat${data.imported !== 1 ? 's' : ''}`,
          );
          handleClose();
        },
        onError: () => {
          toast.error('Failed to import chats. Please try again.');
        },
      },
    );
  }, [selectedMessenger, selectedChats, importChats, whatsappPairing, handleClose]);

  const handleBack = () => {
    if (step === 3) setStep(2);
    else if (step === 2) {
      setStep(1);
      setSelectedMessenger(null);
      setSelectedChats(new Set());
      // Cancel WhatsApp pairing if going back from WhatsApp step
      if (selectedMessenger === 'whatsapp') {
        whatsappPairing.cancelPairing();
      }
    }
  };

  if (!open) return null;

  const messengerInfo = MESSENGERS.find((m) => m.key === selectedMessenger);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="relative z-10 w-full max-h-[100dvh] overflow-y-auto flex flex-col rounded-t-2xl bg-white shadow-lg md:max-w-3xl md:max-h-[90vh] md:rounded-xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
          <div className="flex items-center gap-3">
            {step > 1 && (
              <button
                onClick={handleBack}
                className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
            )}
            <h2 className="text-base font-semibold text-slate-800">
              {step === 1 && 'Import Chats'}
              {step === 2 && `Select ${messengerInfo?.name} Chats`}
              {step === 3 && 'Confirm Import'}
            </h2>
          </div>
          <button
            onClick={handleClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Step indicators */}
        <div className="flex items-center gap-2 px-6 pt-4">
          {[1, 2, 3].map((s) => (
            <div
              key={s}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors',
                s <= step ? 'bg-accent' : 'bg-slate-200',
              )}
            />
          ))}
        </div>

        {/* Content */}
        <div className="px-6 pb-6 pt-4">
          {/* Step 1: Select messenger */}
          {step === 1 && (
            <div className="grid grid-cols-2 gap-3">
              {MESSENGERS.map((m) => (
                <button
                  key={m.key}
                  onClick={() => handleSelectMessenger(m.key)}
                  className={cn(
                    'flex flex-col items-center gap-3 rounded-xl border p-5 text-center transition-all hover:shadow-sm',
                    m.borderClass,
                    m.bgClass,
                  )}
                >
                  <div
                    className="flex h-12 w-12 items-center justify-center rounded-xl"
                    style={{ backgroundColor: `${m.dotColor}20` }}
                  >
                    <MessageSquare
                      className="h-6 w-6"
                      style={{ color: m.dotColor }}
                    />
                  </div>
                  <div>
                    <p className={cn('text-sm font-semibold', m.textClass)}>
                      {m.name}
                    </p>
                    <p className="mt-0.5 text-[11px] text-slate-500">
                      {m.description}
                    </p>
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Step 2: Select chats */}
          {step === 2 && (
            <div>
              {/* WhatsApp-specific pairing flow */}
              {selectedMessenger === 'whatsapp' ? (
                <div className="space-y-4">
                  {/* QR Code Display */}
                  {['starting', 'waiting_for_qr', 'qr_ready'].includes(whatsappPairing.status) && (
                    <div className="flex flex-col items-center justify-center py-8">
                      {whatsappPairing.status === 'qr_ready' && whatsappPairing.qrDataUrl ? (
                        <>
                          <QrCode className="mb-3 h-8 w-8 text-accent" />
                          <div className="mb-4 rounded-xl border border-slate-200 bg-white p-4">
                            <img
                              src={whatsappPairing.qrDataUrl}
                              alt="WhatsApp QR Code"
                              className="h-64 w-64"
                            />
                          </div>
                          <p className="text-center text-sm text-slate-600">
                            {whatsappPairing.statusMessage}
                          </p>
                        </>
                      ) : (
                        <>
                          <Loader2 className="h-6 w-6 animate-spin text-accent" />
                          <p className="mt-2 text-sm text-slate-500">
                            {whatsappPairing.statusMessage}
                          </p>
                        </>
                      )}
                    </div>
                  )}

                  {/* Connection Status */}
                  {['connecting', 'connected'].includes(whatsappPairing.status) && (
                    <div className="flex flex-col items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      <p className="mt-2 text-sm text-slate-500">
                        {whatsappPairing.statusMessage}
                      </p>
                    </div>
                  )}

                  {/* Fetch Chats Button */}
                  {whatsappPairing.status === 'connected' && whatsappPairing.availableChats.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-8">
                      <p className="mb-4 text-center text-sm text-slate-600">
                        WhatsApp connected successfully! Click below to fetch available chats.
                      </p>
                      <button
                        onClick={() => whatsappPairing.listChats()}
                        disabled={whatsappPairing.status !== 'connected'}
                        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-60"
                      >
                        Fetch Available Chats
                      </button>
                    </div>
                  )}

                  {/* Chat Selection */}
                  {whatsappPairing.status === 'fetching_chats' && (
                    <div className="flex flex-col items-center justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      <p className="mt-2 text-sm text-slate-500">
                        {whatsappPairing.statusMessage}
                      </p>
                    </div>
                  )}

                  {whatsappPairing.status === 'chats_ready' && (
                    <>
                      <p className="mb-3 text-sm text-slate-600">
                        {whatsappPairing.statusMessage}
                      </p>
                      <WhatsAppChatSelection
                        chats={whatsappPairing.availableChats}
                        selectedChatIds={whatsappPairing.selectedChatIds}
                        onToggleChat={whatsappPairing.toggleChatSelection}
                        onImport={whatsappPairing.importSelectedChats}
                        isImporting={false}
                      />
                      {/* Continue to Review Step */}
                      <button
                        onClick={() => setStep(3)}
                        disabled={whatsappPairing.selectedChatIds.size === 0}
                        className={cn(
                          'mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
                          whatsappPairing.selectedChatIds.size > 0
                            ? 'bg-accent text-white shadow-accent-sm hover:bg-accent-hover'
                            : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        Continue
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}

                  {/* Error State */}
                  {whatsappPairing.status === 'error' && (
                    <div className="flex flex-col items-center justify-center py-8">
                      <MessageSquare className="mb-3 h-8 w-8 text-red-500" />
                      <p className="mb-4 text-center text-sm text-red-600">
                        {whatsappPairing.error || 'An error occurred during pairing'}
                      </p>
                      <button
                        onClick={() => whatsappPairing.startPairing()}
                        className="rounded-lg bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover"
                      >
                        Try Again
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Generic chat selection for other messengers */
                <>
                  {isLoadingAvailable ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <Loader2 className="h-6 w-6 animate-spin text-accent" />
                      <p className="mt-2 text-sm text-slate-500">
                        Loading available chats...
                      </p>
                    </div>
                  ) : availableChats.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-12">
                      <MessageSquare className="h-8 w-8 text-slate-300" />
                      <p className="mt-2 text-sm text-slate-500">
                        No chats available to import
                      </p>
                    </div>
                  ) : (
                    <>
                      {/* Select all */}
                      <div className="mb-3 flex items-center justify-between">
                        <button
                          onClick={toggleAll}
                          className="text-xs font-medium text-accent hover:text-accent-hover"
                        >
                          {selectedChats.size === availableChats.length
                            ? 'Deselect all'
                            : 'Select all'}
                        </button>
                        <span className="text-xs text-slate-400">
                          {selectedChats.size} of {availableChats.length} selected
                        </span>
                      </div>

                      {/* Chat list */}
                      <div className="max-h-[60vh] space-y-1.5 overflow-y-auto">
                        {availableChats.map((chat) => {
                          const isSelected = selectedChats.has(chat.externalChatId);
                          return (
                            <button
                              key={chat.externalChatId}
                              onClick={() => toggleChat(chat.externalChatId)}
                              className={cn(
                                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                                isSelected
                                  ? 'border-accent/30 bg-accent-bg'
                                  : 'border-slate-200 bg-white hover:bg-slate-50',
                              )}
                            >
                              <div
                                className={cn(
                                  'flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-md border-2 transition-colors',
                                  isSelected
                                    ? 'border-accent bg-accent'
                                    : 'border-slate-300 bg-white',
                                )}
                              >
                                {isSelected && (
                                  <Check className="h-3 w-3 text-white" />
                                )}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm font-medium text-slate-700">
                                  {chat.name}
                                </p>
                                <p className="text-[11px] text-slate-400">
                                  {chat.chatType === 'direct'
                                    ? 'Direct message'
                                    : chat.chatType === 'channel'
                                      ? `Channel${chat.memberCount ? ` · ${chat.memberCount} members` : ''}`
                                      : `Group${chat.memberCount ? ` · ${chat.memberCount} members` : ''}`}
                                </p>
                              </div>
                            </button>
                          );
                        })}
                      </div>

                      {/* Continue button */}
                      <button
                        onClick={() => setStep(3)}
                        disabled={selectedChats.size === 0}
                        className={cn(
                          'mt-4 flex w-full items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-colors',
                          selectedChats.size > 0
                            ? 'bg-accent text-white shadow-accent-sm hover:bg-accent-hover'
                            : 'bg-slate-100 text-slate-400',
                        )}
                      >
                        Continue
                        <ChevronRight className="h-4 w-4" />
                      </button>
                    </>
                  )}
                </>
              )}
            </div>
          )}

          {/* Step 3: Confirm */}
          {step === 3 && (
            <div>
              <div className="rounded-xl bg-slate-50 p-4">
                <div className="flex items-center gap-3">
                  <div
                    className="flex h-10 w-10 items-center justify-center rounded-lg"
                    style={{
                      backgroundColor: `${messengerInfo?.dotColor}15`,
                    }}
                  >
                    <MessageSquare
                      className="h-5 w-5"
                      style={{ color: messengerInfo?.dotColor }}
                    />
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">
                      {messengerInfo?.name}
                    </p>
                    <p className="text-xs text-slate-500">
                      {selectedMessenger === 'whatsapp'
                        ? whatsappPairing.selectedChatIds.size
                        : selectedChats.size}{' '}
                      chat
                      {(selectedMessenger === 'whatsapp'
                        ? whatsappPairing.selectedChatIds.size
                        : selectedChats.size) !== 1
                        ? 's'
                        : ''}{' '}
                      will be imported
                    </p>
                  </div>
                </div>

                <div className="mt-3 max-h-[50vh] space-y-1 overflow-y-auto">
                  {selectedMessenger === 'whatsapp'
                    ? whatsappPairing.availableChats
                        .filter((c) => whatsappPairing.selectedChatIds.has(c.externalChatId))
                        .map((chat) => (
                          <div
                            key={chat.externalChatId}
                            className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs text-slate-600"
                          >
                            <Check className="h-3.5 w-3.5 text-green-500" />
                            {chat.name}
                          </div>
                        ))
                    : availableChats
                        .filter((c) => selectedChats.has(c.externalChatId))
                        .map((chat) => (
                          <div
                            key={chat.externalChatId}
                            className="flex items-center gap-2 rounded-md bg-white px-3 py-2 text-xs text-slate-600"
                          >
                            <Check className="h-3.5 w-3.5 text-green-500" />
                            {chat.name}
                          </div>
                        ))}
                </div>
              </div>

              <p className="mt-3 text-center text-xs text-slate-400">
                Message history will be synced in the background after import.
              </p>

              <button
                onClick={handleImport}
                disabled={selectedMessenger === 'whatsapp' ? whatsappPairing.status === 'importing' : isImporting}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-accent py-2.5 text-sm font-medium text-white shadow-accent-sm transition-colors hover:bg-accent-hover disabled:opacity-60"
              >
                {(selectedMessenger === 'whatsapp' ? whatsappPairing.status === 'importing' : isImporting) ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Importing...
                  </>
                ) : (
                  <>
                    Import{' '}
                    {selectedMessenger === 'whatsapp'
                      ? whatsappPairing.selectedChatIds.size
                      : selectedChats.size}{' '}
                    Chat
                    {(selectedMessenger === 'whatsapp'
                      ? whatsappPairing.selectedChatIds.size
                      : selectedChats.size) !== 1
                      ? 's'
                      : ''}
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
