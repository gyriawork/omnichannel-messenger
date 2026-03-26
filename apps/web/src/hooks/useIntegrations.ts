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

export function useUpdateIntegrationSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ messenger, settings }: { messenger: string; settings: Record<string, unknown> }) =>
      api.patch(`/api/integrations/${messenger}/settings`, { settings }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['integrations'] }),
  });
}
