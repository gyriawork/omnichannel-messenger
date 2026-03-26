'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import type { DashboardStats } from '@/types/dashboard';
import type { BroadcastAnalytics } from '@/types/broadcast';
import type { ActivityEntry } from '@/types/activity';

interface ChatsResponse {
  chats: unknown[];
  total: number;
}

interface BroadcastsResponse {
  broadcasts: unknown[];
  total: number;
}

interface IntegrationsResponse {
  integrations: Array<{ messenger: string; status: string }>;
}

interface ActivityResponse {
  entries: ActivityEntry[];
  total: number;
}

export function useDashboardStats() {
  return useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async (): Promise<DashboardStats> => {
      const [chatsData, broadcastsData, integrationsData, analyticsData, activityData] =
        await Promise.allSettled([
          api.get<ChatsResponse>('/api/chats'),
          api.get<BroadcastsResponse>('/api/broadcasts'),
          api.get<IntegrationsResponse>('/api/integrations'),
          api.get<BroadcastAnalytics>('/api/broadcasts/analytics?period=30d'),
          api.get<ActivityResponse>('/api/activity?limit=10'),
        ]);

      const chats = chatsData.status === 'fulfilled' ? chatsData.value : { chats: [], total: 0 };
      const broadcasts = broadcastsData.status === 'fulfilled' ? broadcastsData.value : { broadcasts: [], total: 0 };
      const integrations = integrationsData.status === 'fulfilled' ? integrationsData.value : { integrations: [] };
      const analytics = analyticsData.status === 'fulfilled' ? analyticsData.value : null;
      const activity = activityData.status === 'fulfilled' ? activityData.value : { entries: [], total: 0 };

      const activeIntegrations = integrations.integrations.filter(
        (i) => i.status === 'connected',
      );

      const messengerChatCounts = { telegram: 0, slack: 0, whatsapp: 0, gmail: 0 };
      if (chatsData.status === 'fulfilled' && Array.isArray(chats.chats)) {
        for (const chat of chats.chats as Array<{ messenger?: string }>) {
          const m = chat.messenger as keyof typeof messengerChatCounts;
          if (m && m in messengerChatCounts) {
            messengerChatCounts[m]++;
          }
        }
      }

      const isConnected = (messenger: string) =>
        activeIntegrations.some((i) => i.messenger === messenger);

      return {
        totalChats: chats.total,
        totalBroadcasts: broadcasts.total,
        activeIntegrations: activeIntegrations.length,
        messagesSent: analytics?.totalMessagesSent ?? 0,
        deliveryRate: analytics?.averageDeliveryRate ?? 0,
        recentActivity: activity.entries,
        perMessenger: {
          telegram: { chats: messengerChatCounts.telegram, connected: isConnected('telegram') },
          slack: { chats: messengerChatCounts.slack, connected: isConnected('slack') },
          whatsapp: { chats: messengerChatCounts.whatsapp, connected: isConnected('whatsapp') },
          gmail: { chats: messengerChatCounts.gmail, connected: isConnected('gmail') },
        },
      };
    },
    staleTime: 30_000,
  });
}
