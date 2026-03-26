'use client';

import { MessageSquare } from 'lucide-react';

export default function MessengerPage() {
  return (
    <div className="flex h-full">
      {/* Chat List Panel */}
      <div className="flex w-80 flex-col border-r border-slate-200 bg-white">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3">
          <h2 className="text-sm font-semibold text-slate-800">Chats</h2>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <p className="text-xs text-slate-400">No chats imported yet</p>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex flex-1 flex-col items-center justify-center bg-[#f8fafc]">
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-lg bg-accent-bg">
          <MessageSquare className="h-6 w-6 text-accent" />
        </div>
        <h2 className="text-base font-semibold text-slate-800">Messenger</h2>
        <p className="mt-1 text-sm text-slate-500">
          Select a chat to start messaging
        </p>
      </div>

      {/* Info Panel */}
      <div className="hidden w-72 border-l border-slate-200 bg-white xl:block">
        <div className="flex items-center border-b border-slate-100 px-4 py-3">
          <h3 className="text-sm font-semibold text-slate-800">Details</h3>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center p-4">
          <p className="text-xs text-slate-400">
            Select a chat to view details
          </p>
        </div>
      </div>
    </div>
  );
}
