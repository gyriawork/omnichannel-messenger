'use client';

import { Send, Inbox, MessageSquare, Calendar, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { AnalyticsResponse, AnalyticsScope } from '@/types/analytics';
import { ActiveInactiveBar } from './ActiveInactiveBar';

interface KpiCardsProps {
  data: AnalyticsResponse;
  scope: AnalyticsScope;
  isDrillDown: boolean;
}

export function KpiCards({ data, scope, isDrillDown }: KpiCardsProps) {
  const fourthIsMembers = scope === 'org' && !isDrillDown;

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
      <KpiCard
        icon={<Send className="h-5 w-5 text-accent" />}
        iconBg="bg-accent-bg"
        label="Messages Sent"
        value={formatNumber(data.kpis.messagesSent.value)}
        deltaPct={data.kpis.messagesSent.deltaPct}
      />
      <KpiCard
        icon={<Inbox className="h-5 w-5 text-blue-500" />}
        iconBg="bg-blue-50"
        label="Messages Received"
        value={formatNumber(data.kpis.messagesReceived.value)}
        deltaPct={data.kpis.messagesReceived.deltaPct}
      />
      <KpiCard
        icon={<MessageSquare className="h-5 w-5 text-purple-500" />}
        iconBg="bg-purple-50"
        label="Chats"
        value={formatNumber(data.kpis.chats.active + data.kpis.chats.inactive)}
        deltaPct={data.kpis.chats.deltaPctActive}
        deltaLabel="active"
        footer={
          <ActiveInactiveBar
            active={data.kpis.chats.active}
            inactive={data.kpis.chats.inactive}
          />
        }
      />
      <KpiCard
        icon={
          fourthIsMembers ? (
            <Users className="h-5 w-5 text-emerald-500" />
          ) : (
            <Calendar className="h-5 w-5 text-emerald-500" />
          )
        }
        iconBg="bg-emerald-50"
        label={fourthIsMembers ? 'Active Members' : 'Active Days'}
        value={String(data.kpis.activeDaysOrMembers.value)}
        deltaPct={data.kpis.activeDaysOrMembers.deltaPct}
      />
    </div>
  );
}

interface KpiCardProps {
  icon: React.ReactNode;
  iconBg: string;
  label: string;
  value: string;
  deltaPct: number | null;
  deltaLabel?: string;
  footer?: React.ReactNode;
}

function KpiCard({
  icon,
  iconBg,
  label,
  value,
  deltaPct,
  deltaLabel,
  footer,
}: KpiCardProps) {
  return (
    <div className="rounded-xl bg-white p-5 shadow-xs">
      <div className="flex items-start justify-between">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-slate-500">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-900">{value}</p>
          <DeltaBadge deltaPct={deltaPct} label={deltaLabel} />
        </div>
        <div
          className={cn(
            'flex h-10 w-10 shrink-0 items-center justify-center rounded-lg',
            iconBg,
          )}
        >
          {icon}
        </div>
      </div>
      {footer && <div className="mt-3">{footer}</div>}
    </div>
  );
}

function DeltaBadge({
  deltaPct,
  label,
}: {
  deltaPct: number | null;
  label?: string;
}) {
  if (deltaPct === null) {
    return (
      <p className="mt-0.5 text-xs text-slate-400">
        No prior data{label ? ` (${label})` : ''}
      </p>
    );
  }
  const rounded = Math.round(deltaPct);
  const positive = rounded >= 0;
  return (
    <p
      className={cn(
        'mt-0.5 text-xs font-medium',
        positive ? 'text-emerald-600' : 'text-red-500',
      )}
    >
      {positive ? '+' : ''}
      {rounded}% {label ? `${label} ` : ''}vs previous
    </p>
  );
}

function formatNumber(num: number): string {
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}
