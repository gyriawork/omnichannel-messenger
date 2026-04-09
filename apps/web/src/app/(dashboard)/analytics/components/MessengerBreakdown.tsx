'use client';

import { MessengerIcon } from '@/components/ui/MessengerIcon';
import type { AnalyticsResponse, AnalyticsMessenger } from '@/types/analytics';
import { ActiveInactiveBar } from './ActiveInactiveBar';

interface MessengerBreakdownProps {
  data: AnalyticsResponse['byMessenger'];
}

const MESSENGERS: Array<{ key: AnalyticsMessenger; label: string }> = [
  { key: 'telegram', label: 'Telegram' },
  { key: 'slack', label: 'Slack' },
  { key: 'whatsapp', label: 'WhatsApp' },
  { key: 'gmail', label: 'Gmail' },
];

export function MessengerBreakdown({ data }: MessengerBreakdownProps) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {MESSENGERS.map(({ key, label }) => {
        const stats = data[key];
        return (
          <div
            key={key}
            className="rounded-lg border border-slate-100 bg-white p-4 shadow-xs"
          >
            <div className="flex items-center gap-2">
              <MessengerIcon messenger={key} size={28} />
              <span className="text-sm font-medium text-slate-800">{label}</span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="text-xl font-semibold text-slate-900">
                {stats.count.toLocaleString()}
              </span>
              <span className="text-xs text-slate-400">
                {Math.round(stats.percent)}%
              </span>
            </div>
            <p className="text-[11px] uppercase tracking-wide text-slate-400">
              messages
            </p>
            <div className="mt-3">
              <ActiveInactiveBar
                active={stats.activeChats}
                inactive={stats.inactiveChats}
                compact
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
