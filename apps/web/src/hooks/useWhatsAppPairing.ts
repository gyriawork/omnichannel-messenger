'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { getSocket } from '@/hooks/useSocket';
import QRCode from 'qrcode';

export type WhatsAppPairingStatus =
  | 'idle'
  | 'starting'
  | 'waiting_for_qr'
  | 'qr_ready'
  | 'connecting'
  | 'connected'
  | 'fetching_chats'
  | 'chats_ready'
  | 'importing'
  | 'error';

export interface WhatsAppChat {
  externalChatId: string;
  name: string;
  chatType: string; // 'group' or 'individual'
}

interface UseWhatsAppPairingReturn {
  status: WhatsAppPairingStatus;
  qrDataUrl: string | null;
  statusMessage: string;
  error: string | null;
  availableChats: WhatsAppChat[];
  selectedChatIds: Set<string>;
  startPairing: () => Promise<void>;
  cancelPairing: () => void;
  reset: () => void;
  listChats: () => Promise<void>;
  toggleChatSelection: (chatId: string) => void;
  importSelectedChats: () => Promise<void>;
}

export function useWhatsAppPairing(): UseWhatsAppPairingReturn {
  const [status, setStatus] = useState<WhatsAppPairingStatus>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [availableChats, setAvailableChats] = useState<WhatsAppChat[]>([]);
  const [selectedChatIds, setSelectedChatIds] = useState<Set<string>>(new Set());
  const queryClient = useQueryClient();
  const listenersAttachedRef = useRef(false);
  const qrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialQrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear the 120s QR expiry timeout
  const clearQrTimeout = useCallback(() => {
    if (qrTimeoutRef.current !== null) {
      clearTimeout(qrTimeoutRef.current);
      qrTimeoutRef.current = null;
    }
  }, []);

  // (Re)start the 120s QR expiry timeout
  const resetQrTimeout = useCallback(() => {
    clearQrTimeout();
    qrTimeoutRef.current = setTimeout(() => {
      setError('QR code expired. Click to try again.');
      setStatus('error');
      setQrDataUrl(null);
    }, 120_000);
  }, [clearQrTimeout]);

  // Clean up socket listeners
  const detachListeners = useCallback(() => {
    const socket = getSocket();
    if (socket && listenersAttachedRef.current) {
      socket.off('whatsapp:qr');
      socket.off('whatsapp:status');
      socket.off('whatsapp:connected');
      socket.off('whatsapp:error');
      listenersAttachedRef.current = false;
    }
  }, []);

  // Attach WebSocket listeners for WhatsApp pairing events
  const attachListeners = useCallback(() => {
    const socket = getSocket();
    if (!socket) return;

    // Prevent duplicate listeners
    if (listenersAttachedRef.current) {
      detachListeners();
    }

    socket.on('whatsapp:qr', async (data: { qr: string }) => {
      // Cancel the initial "no QR arrived" safety timer
      if (initialQrTimeoutRef.current) {
        clearTimeout(initialQrTimeoutRef.current);
        initialQrTimeoutRef.current = null;
      }
      // Reset the 120s expiry timer on every QR refresh (Baileys regenerates ~every 20s)
      resetQrTimeout();
      try {
        // Convert the QR code string into a data URL image
        const dataUrl = await QRCode.toDataURL(data.qr, {
          width: 280,
          margin: 2,
          color: {
            dark: '#000000',
            light: '#ffffff',
          },
        });
        setQrDataUrl(dataUrl);
        setStatus('qr_ready');
        setStatusMessage('Scan the QR code with WhatsApp on your phone');
      } catch {
        setError('Failed to generate QR code image');
        setStatus('error');
      }
    });

    socket.on('whatsapp:status', (data: { message: string }) => {
      setStatusMessage(data.message);
    });

    socket.on('whatsapp:connected', () => {
      clearQrTimeout();
      if (initialQrTimeoutRef.current) { clearTimeout(initialQrTimeoutRef.current); initialQrTimeoutRef.current = null; }
      setStatus('connected');
      setStatusMessage('WhatsApp connected successfully!');
      setQrDataUrl(null);
      // Refresh integrations list
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      // Detach after success
      detachListeners();
    });

    socket.on('whatsapp:error', (data: { message: string }) => {
      clearQrTimeout();
      if (initialQrTimeoutRef.current) { clearTimeout(initialQrTimeoutRef.current); initialQrTimeoutRef.current = null; }
      setError(data.message);
      setStatus('error');
      setQrDataUrl(null);
      detachListeners();
    });

    socket.on('whatsapp:chats-available', (data: { chats: WhatsAppChat[] }) => {
      setAvailableChats(data.chats);
      setStatus('chats_ready');
      setStatusMessage(`Found ${data.chats.length} chats. Select chats to import.`);
    });

    listenersAttachedRef.current = true;
  }, [queryClient, detachListeners, resetQrTimeout, clearQrTimeout]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      clearQrTimeout();
      if (initialQrTimeoutRef.current) clearTimeout(initialQrTimeoutRef.current);
      detachListeners();
    };
  }, [detachListeners, clearQrTimeout]);

  const startPairing = useCallback(async () => {
    setStatus('starting');
    setError(null);
    setQrDataUrl(null);
    setStatusMessage('Starting WhatsApp pairing...');

    try {
      // Attach WebSocket listeners before calling the API so no events are missed
      attachListeners();

      await api.post('/api/integrations/whatsapp/start-pairing', {});

      setStatus('waiting_for_qr');
      setStatusMessage('Generating QR code...');

      // Safety: if no QR arrives within 15s, show error instead of hanging
      initialQrTimeoutRef.current = setTimeout(() => {
        setError('Could not generate QR code. The server may have trouble connecting to WhatsApp. Try again.');
        setStatus('error');
        detachListeners();
      }, 15_000);

      // Start the 120s session-expiry guard; will be reset on each whatsapp:qr event
      resetQrTimeout();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start WhatsApp pairing';
      setError(message);
      setStatus('error');
      clearQrTimeout();
      detachListeners();
    }
  }, [attachListeners, detachListeners, resetQrTimeout, clearQrTimeout]);

  const cancelPairing = useCallback(() => {
    clearQrTimeout();
    if (initialQrTimeoutRef.current) { clearTimeout(initialQrTimeoutRef.current); initialQrTimeoutRef.current = null; }
    detachListeners();
    setStatus('idle');
    setQrDataUrl(null);
    setStatusMessage('');
    setError(null);

    // Fire and forget the cancel request
    api.post('/api/integrations/whatsapp/cancel-pairing', {}).catch(() => {});
  }, [detachListeners, clearQrTimeout]);

  const reset = useCallback(() => {
    clearQrTimeout();
    if (initialQrTimeoutRef.current) { clearTimeout(initialQrTimeoutRef.current); initialQrTimeoutRef.current = null; }
    detachListeners();
    setStatus('idle');
    setQrDataUrl(null);
    setStatusMessage('');
    setError(null);
    setAvailableChats([]);
    setSelectedChatIds(new Set());
  }, [detachListeners, clearQrTimeout]);

  const listChats = useCallback(async () => {
    if (status !== 'connected') {
      setError('Not connected to WhatsApp');
      return;
    }

    setStatus('fetching_chats');
    setStatusMessage('Fetching available chats...');

    try {
      await api.post('/api/integrations/whatsapp/list-chats', {});
      // The 'whatsapp:chats-available' event will be emitted via WebSocket
      // and handled by the attachListeners socket.on('whatsapp:chats-available')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to fetch chats';
      setError(message);
      setStatus('error');
    }
  }, [status]);

  const toggleChatSelection = useCallback((chatId: string) => {
    setSelectedChatIds((prev) => {
      const next = new Set(prev);
      if (next.has(chatId)) {
        next.delete(chatId);
      } else {
        next.add(chatId);
      }
      return next;
    });
  }, []);

  const importSelectedChats = useCallback(async () => {
    if (selectedChatIds.size === 0) {
      setError('Please select at least one chat');
      return;
    }

    setStatus('importing');
    setStatusMessage(`Importing ${selectedChatIds.size} chat(s)...`);

    try {
      await api.post('/api/chats/import', {
        messenger: 'whatsapp',
        externalChatIds: Array.from(selectedChatIds),
      });

      setStatusMessage('Chats imported successfully!');
      setStatus('idle');
      setAvailableChats([]);
      setSelectedChatIds(new Set());
      queryClient.invalidateQueries({ queryKey: ['chats'] });
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to import chats';
      setError(message);
      setStatus('error');
    }
  }, [selectedChatIds, queryClient]);

  return {
    status,
    qrDataUrl,
    statusMessage,
    error,
    availableChats,
    selectedChatIds,
    startPairing,
    cancelPairing,
    reset,
    listChats,
    toggleChatSelection,
    importSelectedChats,
  };
}
