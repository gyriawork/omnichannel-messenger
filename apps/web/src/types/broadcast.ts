export type BroadcastStatus =
  | 'draft'
  | 'scheduled'
  | 'sending'
  | 'sent'
  | 'partially_failed'
  | 'failed';

export interface Broadcast {
  id: string;
  name: string;
  messageText: string;
  attachments?: unknown[];
  status: BroadcastStatus;
  scheduledAt?: string;
  sentAt?: string;
  deliveryRate?: number;
  createdById: string;
  templateId?: string;
  createdAt: string;
  chatCount?: number;
  sentCount?: number;
  failedCount?: number;
  chats?: BroadcastChat[];
}

export interface BroadcastChat {
  chatId: string;
  chatName: string;
  messenger: string;
  status: 'pending' | 'sent' | 'failed';
  sentAt?: string;
  error?: string;
}

export interface AntibanSettings {
  id?: string;
  messenger: string;
  messagesPerBatch: number;
  delayBetweenMessages: number;
  delayBetweenBatches: number;
  maxMessagesPerHour: number;
  maxMessagesPerDay: number;
  autoRetryEnabled: boolean;
  maxRetryAttempts: number;
  retryWindowHours: number;
}

export interface RiskScore {
  score: number;
  zone: 'safe' | 'moderate' | 'risky' | 'dangerous';
  description: string;
}

export interface BroadcastFilters {
  status?: BroadcastStatus | null;
  search?: string;
}

export interface BroadcastAnalytics {
  totalBroadcasts: number;
  totalMessagesSent: number;
  averageDeliveryRate: number;
  totalFailed: number;
  perDay: Array<{ date: string; sent: number; failed: number }>;
  perMessenger: Array<{
    messenger: string;
    sent: number;
    failed: number;
    deliveryRate: number;
  }>;
  topFailReasons: Array<{ reason: string; count: number }>;
}

export interface CreateBroadcastInput {
  name: string;
  messageText: string;
  chatIds: string[];
  scheduledAt?: string;
  templateId?: string;
}

export interface UpdateBroadcastInput {
  name?: string;
  messageText?: string;
  chatIds?: string[];
  scheduledAt?: string;
  templateId?: string;
}

export const ANTIBAN_DEFAULTS: Record<string, AntibanSettings> = {
  telegram: {
    messenger: 'telegram',
    messagesPerBatch: 20,
    delayBetweenMessages: 2,
    delayBetweenBatches: 30,
    maxMessagesPerHour: 200,
    maxMessagesPerDay: 2000,
    autoRetryEnabled: true,
    maxRetryAttempts: 3,
    retryWindowHours: 24,
  },
  slack: {
    messenger: 'slack',
    messagesPerBatch: 50,
    delayBetweenMessages: 1,
    delayBetweenBatches: 10,
    maxMessagesPerHour: 500,
    maxMessagesPerDay: 5000,
    autoRetryEnabled: true,
    maxRetryAttempts: 3,
    retryWindowHours: 24,
  },
  whatsapp: {
    messenger: 'whatsapp',
    messagesPerBatch: 10,
    delayBetweenMessages: 5,
    delayBetweenBatches: 60,
    maxMessagesPerHour: 100,
    maxMessagesPerDay: 1000,
    autoRetryEnabled: true,
    maxRetryAttempts: 3,
    retryWindowHours: 24,
  },
  gmail: {
    messenger: 'gmail',
    messagesPerBatch: 30,
    delayBetweenMessages: 1,
    delayBetweenBatches: 20,
    maxMessagesPerHour: 300,
    maxMessagesPerDay: 2000,
    autoRetryEnabled: true,
    maxRetryAttempts: 3,
    retryWindowHours: 24,
  },
};
