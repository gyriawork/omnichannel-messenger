'use client';

import { ChatList } from '@/components/messenger/ChatList';
import { ChatArea } from '@/components/messenger/ChatArea';
import { ChatInfo } from '@/components/messenger/ChatInfo';

export default function MessengerPage() {
  return (
    <div className="flex h-full">
      <ChatList />
      <ChatArea />
      <ChatInfo />
    </div>
  );
}
