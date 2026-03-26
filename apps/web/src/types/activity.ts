export type ActivityCategory =
  | 'chats'
  | 'messages'
  | 'broadcast'
  | 'templates'
  | 'users'
  | 'integrations'
  | 'settings'
  | 'organizations';

export interface ActivityEntry {
  id: string;
  category: ActivityCategory;
  action: string;
  description: string;
  userId: string;
  userName: string;
  targetId?: string;
  targetType?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface ActivityFilters {
  category?: ActivityCategory | null;
  userId?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
}

export interface WorkspaceSettings {
  organizationName: string;
  timezone: string;
  language: string;
  chatVisibility: boolean;
}
