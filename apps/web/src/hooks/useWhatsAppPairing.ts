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
  | 'error';

interface UseWhatsAppPairingReturn {
  status: WhatsAppPairingStatus;
  qrDataUrl: string | null;
  statusMessage: string;
  error: string | null;
  startPairing: () => Promise<void>;
  cancelPairing: () => void;
  reset: () => void;
}

export function useWhatsAppPairing(): UseWhatsAppPairingReturn {
  const [status, setStatus] = useState<WhatsAppPairingStatus>('idle');
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const listenersAttachedRef = useRef(false);

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
      setStatus('connected');
      setStatusMessage('WhatsApp connected successfully!');
      setQrDataUrl(null);
      // Refresh integrations list
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
      // Detach after success
      detachListeners();
    });

    socket.on('whatsapp:error', (data: { message: string }) => {
      setError(data.message);
      setStatus('error');
      setQrDataUrl(null);
      detachListeners();
    });

    listenersAttachedRef.current = true;
  }, [queryClient, detachListeners]);

  // Clean up on unmount
  useEffect(() => {
    return () => {
      detachListeners();
    };
  }, [detachListeners]);

  const startPairing = useCallback(async () => {
    setStatus('starting');
    setError(null);
    setQrDataUrl(null);
    setStatusMessage('Starting WhatsApp pairing...');

    try {
      // Attach WebSocket listeners before calling the API
      attachListeners();

      await api.post('/api/integrations/whatsapp/start-pairing', {});

      setStatus('waiting_for_qr');
      setStatusMessage('Generating QR code...');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to start WhatsApp pairing';
      setError(message);
      setStatus('error');
      detachListeners();
    }
  }, [attachListeners, detachListeners]);

  const cancelPairing = useCallback(() => {
    detachListeners();
    setStatus('idle');
    setQrDataUrl(null);
    setStatusMessage('');
    setError(null);

    // Fire and forget the cancel request
    api.post('/api/integrations/whatsapp/cancel-pairing', {}).catch(() => {});
  }, [detachListeners]);

  const reset = useCallback(() => {
    detachListeners();
    setStatus('idle');
    setQrDataUrl(null);
    setStatusMessage('');
    setError(null);
  }, [detachListeners]);

  return {
    status,
    qrDataUrl,
    statusMessage,
    error,
    startPairing,
    cancelPairing,
    reset,
  };
}
