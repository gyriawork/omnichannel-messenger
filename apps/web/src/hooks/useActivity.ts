'use client';

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  ActivityEntry,
  ActivityFilters,
  WorkspaceSettings,
} from '@/types/activity';

interface ActivityResponse {
  data: ActivityEntry[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export function useActivity(filters?: ActivityFilters, page: number = 1) {
  return useQuery({
    queryKey: ['activity', filters, page],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (filters?.category) params.set('category', filters.category);
      if (filters?.userId) params.set('userId', filters.userId);
      if (filters?.dateFrom) params.set('startDate', filters.dateFrom);
      if (filters?.dateTo) params.set('endDate', filters.dateTo);
      params.set('page', String(page));
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
