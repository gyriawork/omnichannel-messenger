'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ActivityEntry,
  ActivityFilters,
  WorkspaceSettings,
} from '@/types/activity';

interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
  nextCursor?: string;
}

export function useActivity(filters?: ActivityFilters, cursor?: string) {
  return useQuery({
    queryKey: ['activity', filters, cursor],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.category) params.set('category', filters.category);
      if (filters?.userId) params.set('userId', filters.userId);
      if (filters?.dateFrom) params.set('dateFrom', filters.dateFrom);
      if (filters?.dateTo) params.set('dateTo', filters.dateTo);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '20');
      const query = params.toString();
      return api.get<ActivityResponse>(
        `/api/activity${query ? `?${query}` : ''}`,
      );
    },
  });
}

export function useWorkspaceSettings() {
  return useQuery({
    queryKey: ['workspace-settings'],
    queryFn: () => api.get<WorkspaceSettings>('/api/settings/workspace'),
  });
}

export function useUpdateWorkspace() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (settings: Partial<WorkspaceSettings>) =>
      api.patch<WorkspaceSettings>('/api/settings/workspace', settings),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['workspace-settings'] });
    },
  });
}
