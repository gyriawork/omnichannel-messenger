export type MessengerType = 'telegram' | 'slack' | 'whatsapp' | 'gmail';

export type ChatType = 'direct' | 'group' | 'channel';

export interface Chat {
  id: string;
  name: string;
  messenger: MessengerType;
  chatType: ChatType;
  status: string;
  ownerId?: string;
  ownerName?: string;
  messageCount: number;
  syncStatus?: string; // pending | syncing | synced | failed
  createdAt?: string;
  lastActivityAt?: string;
  externalChatId?: string;
  importedByName?: string;
  participants?: Array<{
    id: string;
    name: string;
    role?: string;
  }>;
  lastMessage?: {
    text: string;
    senderName: string;
    createdAt: string;
  };
  tags?: Array<{
    id: string;
    name: string;
    color: string;
  }>;
  preferences?: {
    pinned: boolean;
    favorite: boolean;
    muted: boolean;
    unread: boolean;
  };
}

export interface Message {
  id: string;
  chatId: string;
  senderName: string;
  isSelf: boolean;
  text: string;
  editedAt?: string;
  replyToMessage?: {
    id: string;
    senderName: string;
    text: string;
  };
  reactions?: Array<{
    id: string;
    emoji: string;
    userId: string;
  }>;
  isPinned: boolean;
  deliveryStatus?: string;
  attachments?: Array<{
    url: string;
    filename: string;
    mimeType: string;
    size: number;
  }>;
  createdAt: string;
}

export interface AvailableChat {
  externalChatId: string;
  name: string;
  chatType: ChatType;
  memberCount?: number;
  lastActivity?: string;
}

export interface ChatFilters {
  search?: string;
  messenger?: MessengerType | null;
  status?: string;
  ownerId?: string;
  tagId?: string;
}
