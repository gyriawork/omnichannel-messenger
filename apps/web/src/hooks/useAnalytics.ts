'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type {
  AnalyticsResponse,
  AnalyticsScope,
  AnalyticsPeriod,
  AnalyticsGranularity,
} from '@/types/analytics';

export interface UseAnalyticsParams {
  scope: AnalyticsScope;
  period: AnalyticsPeriod;
  granularity: AnalyticsGranularity;
  userId?: string;
}

export function useAnalytics(params: UseAnalyticsParams) {
  const search = new URLSearchParams({
    scope: params.scope,
    period: params.period,
    granularity: params.granularity,
  });
  if (params.userId) search.set('userId', params.userId);

  return useQuery({
    queryKey: [
      'analytics',
      params.scope,
      params.period,
      params.granularity,
      params.userId ?? null,
    ],
    queryFn: () => api.get<AnalyticsResponse>(`/api/analytics?${search.toString()}`),
    staleTime: 30_000,
  });
}
