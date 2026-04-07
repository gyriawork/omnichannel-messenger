'use client';

import { ChatList } from '@/components/messenger/ChatList';
import { ChatArea } from '@/components/messenger/ChatArea';
import { ChatInfo } from '@/components/messenger/ChatInfo';
import { useChatStore } from '@/stores/chat';
import { useIsMobile } from '@/hooks/useIsMobile';
import { RequireOrgContext } from '@/components/layout/RequireOrgContext';

export default function MessengerPage() {
  const mobileView = useChatStore((s) => s.mobileView);
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <RequireOrgContext>
      <div className="flex h-full flex-col">
        {mobileView === 'list' && <ChatList />}
        {mobileView === 'chat' && <ChatArea />}
        {mobileView === 'info' && <ChatInfo />}
      </div>
      </RequireOrgContext>
    );
  }

  return (
    <RequireOrgContext>
    <div className="flex h-full">
      <ChatList />
      <ChatArea />
      <ChatInfo />
    </div>
    </RequireOrgContext>
  );
}
