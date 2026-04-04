'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

interface AvailableIntegrationsResponse {
  available: string[];
  unavailable: string[];
}

export function useAvailableIntegrations() {
  return useQuery({
    queryKey: ['integrations', 'available'],
    queryFn: () => api.get<AvailableIntegrationsResponse>('/api/integrations/available'),
    staleTime: 2 * 60 * 1000, // 2 minutes
  });
}
