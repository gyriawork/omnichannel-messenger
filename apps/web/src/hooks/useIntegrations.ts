'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { Integration, ConnectPayload, MessengerType } from '@/types/integration';

interface IntegrationsResponse {
  integrations: Integration[];
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: () => api.get<IntegrationsResponse>('/api/integrations'),
  });
}

export function useConnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      messenger,
      payload,
    }: {
      messenger: MessengerType;
      payload: ConnectPayload;
    }) => {
      return api.post<Integration>(
        `/api/integrations/${messenger}/connect`,
        payload,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export function useDisconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messenger: MessengerType) => {
      return api.post<void>(`/api/integrations/${messenger}/disconnect`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export function useReconnectIntegration() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (messenger: MessengerType) => {
      return api.post<Integration>(
        `/api/integrations/${messenger}/reconnect`,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export function useSlackOAuthStatus() {
  return useQuery({
    queryKey: ['slack-oauth-status'],
    queryFn: () => api.get<{ oauthConfigured: boolean }>('/api/oauth/slack/status'),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

export function useGmailOAuthAvailable() {
  return useQuery({
    queryKey: ['gmail-oauth-available'],
    queryFn: () => api.get<{ available: boolean }>('/api/oauth/gmail/available'),
    staleTime: 5 * 60 * 1000, // Cache for 5 minutes
  });
}

export function useUpdateIntegrationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messenger, settings }: { messenger: string; settings: Record<string, unknown> }) =>
      api.patch(`/api/integrations/${messenger}/settings`, { settings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}

// ─── Telegram multi-step auth hooks ───

interface TelegramSendCodeResponse {
  phoneCodeHash: string;
  phoneNumber: string;
}

interface TelegramVerifyCodeResponse {
  integration: Integration;
}

interface TelegramCheckSessionResponse {
  valid: boolean;
  reason?: string;
}

export function useTelegramSendCode() {
  return useMutation({
    mutationFn: async (payload: { apiId: string; apiHash: string; phoneNumber: string }) => {
      return api.post<TelegramSendCodeResponse>(
        '/api/integrations/telegram/send-code',
        {
          apiId: parseInt(payload.apiId, 10),
          apiHash: payload.apiHash,
          phoneNumber: payload.phoneNumber,
        },
      );
    },
  });
}

export function useTelegramVerifyCode() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: {
      phoneNumber: string;
      phoneCodeHash: string;
      code: string;
      password?: string;
    }) => {
      return api.post<TelegramVerifyCodeResponse>(
        '/api/integrations/telegram/verify-code',
        payload,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['integrations'] });
    },
  });
}

export function useTelegramCheckSession() {
  return useMutation({
    mutationFn: async () => {
      return api.post<TelegramCheckSessionResponse>(
        '/api/integrations/telegram/check-session',
      );
    },
  });
}
