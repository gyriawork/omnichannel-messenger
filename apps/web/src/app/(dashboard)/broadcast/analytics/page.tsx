'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Radio,
  Send,
  TrendingUp,
  AlertTriangle,
  BarChart3,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useBroadcastAnalytics } from '@/hooks/useBroadcasts';

const periods = [
  { label: '7 days', value: '7d' as const },
  { label: '30 days', value: '30d' as const },
  { label: '90 days', value: '90d' as const },
];

const messengerMeta: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  telegram: {
    label: 'Telegram',
    bgClass: 'bg-messenger-tg-bg',
    textClass: 'text-messenger-tg-text',
  },
  slack: {
    label: 'Slack',
    bgClass: 'bg-messenger-sl-bg',
    textClass: 'text-messenger-sl-text',
  },
  whatsapp: {
    label: 'WhatsApp',
    bgClass: 'bg-messenger-wa-bg',
    textClass: 'text-messenger-wa-text',
  },
  gmail: {
    label: 'Gmail',
    bgClass: 'bg-messenger-gm-bg',
    textClass: 'text-messenger-gm-text',
  },
};

export default function BroadcastAnalyticsPage() {
  const router = useRouter();
  const [period, setPeriod] = useState<'7d' | '30d' | '90d'>('30d');
  const { data, isLoading } = useBroadcastAnalytics(period);

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      {/* Header */}
      <button
        onClick={() => router.push('/broadcast')}
        className="mb-4 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Broadcasts
      </button>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">
            Broadcast Analytics
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Performance overview for your broadcasts
          </p>
        </div>
        <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
          {periods.map((p) => (
            <button
              key={p.value}
              onClick={() => setPeriod(p.value)}
              className={cn(
                'rounded-md px-3 py-1.5 text-sm font-medium transition-all',
                period === p.value
                  ? 'bg-white text-slate-900 shadow-xs'
                  : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="mb-8 grid grid-cols-4 gap-4">
            <SummaryCard
              icon={<Radio className="h-5 w-5 text-accent" />}
              label="Total Broadcasts"
              value={String(data?.totalBroadcasts ?? 0)}
            />
            <SummaryCard
              icon={<Send className="h-5 w-5 text-emerald-500" />}
              label="Messages Sent"
              value={formatNumber(data?.totalMessagesSent ?? 0)}
            />
            <SummaryCard
              icon={<TrendingUp className="h-5 w-5 text-blue-500" />}
              label="Avg Delivery Rate"
              value={`${Math.round(data?.averageDeliveryRate ?? 0)}%`}
            />
            <SummaryCard
              icon={<AlertTriangle className="h-5 w-5 text-red-500" />}
              label="Total Failed"
              value={formatNumber(data?.totalFailed ?? 0)}
            />
          </div>

          {/* Chart placeholder */}
          <div className="mb-8 rounded-lg bg-white p-6 shadow-xs">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">
              Messages Sent Over Time
            </h3>
            {data?.perDay && data.perDay.length > 0 ? (
              <BarChartPlaceholder data={data.perDay} />
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-slate-400">
                <div className="flex flex-col items-center gap-2">
                  <BarChart3 className="h-8 w-8" />
                  No data for this period
                </div>
              </div>
            )}
          </div>

          {/* Per-Messenger Breakdown */}
          <div className="mb-8 rounded-lg bg-white p-6 shadow-xs">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">
              Per-Messenger Breakdown
            </h3>
            {data?.perMessenger && data.perMessenger.length > 0 ? (
              <div className="overflow-hidden rounded-lg border border-slate-200">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50">
                      <th className="px-4 py-2.5 text-xs font-medium text-slate-500">
                        Messenger
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                        Sent
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                        Failed
                      </th>
                      <th className="px-4 py-2.5 text-right text-xs font-medium text-slate-500">
                        Delivery Rate
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.perMessenger.map((row) => {
                      const meta = messengerMeta[row.messenger];
                      return (
                        <tr
                          key={row.messenger}
                          className="border-b border-slate-100 last:border-b-0"
                        >
                          <td className="px-4 py-2.5">
                            <span
                              className={cn(
                                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                                meta?.bgClass || 'bg-slate-100',
                                meta?.textClass || 'text-slate-600',
                              )}
                            >
                              {meta?.label || row.messenger}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 text-right font-medium text-slate-900">
                            {formatNumber(row.sent)}
                          </td>
                          <td className="px-4 py-2.5 text-right text-red-500">
                            {formatNumber(row.failed)}
                          </td>
                          <td className="px-4 py-2.5 text-right">
                            <span
                              className={cn(
                                'font-medium',
                                row.deliveryRate >= 95
                                  ? 'text-emerald-600'
                                  : row.deliveryRate >= 80
                                    ? 'text-amber-600'
                                    : 'text-red-600',
                              )}
                            >
                              {Math.round(row.deliveryRate)}%
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                No messenger data available
              </p>
            )}
          </div>

          {/* Top Fail Reasons */}
          <div className="rounded-lg bg-white p-6 shadow-xs">
            <h3 className="mb-4 text-sm font-semibold text-slate-900">
              Top Failure Reasons
            </h3>
            {data?.topFailReasons && data.topFailReasons.length > 0 ? (
              <div className="space-y-3">
                {data.topFailReasons.map((reason, i) => {
                  const maxCount = data.topFailReasons[0].count;
                  const pct =
                    maxCount > 0
                      ? Math.round((reason.count / maxCount) * 100)
                      : 0;
                  return (
                    <div key={i}>
                      <div className="mb-1 flex items-center justify-between text-sm">
                        <span className="text-slate-700">{reason.reason}</span>
                        <span className="font-medium text-slate-900">
                          {reason.count}
                        </span>
                      </div>
                      <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                        <div
                          className="h-full rounded-full bg-red-400"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="py-8 text-center text-sm text-slate-400">
                No failures recorded
              </p>
            )}
          </div>
        </>
      )}
    </div>
  );
}

/* ---------- Sub-components ---------- */

function SummaryCard({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-xs">
      <div className="mb-2">{icon}</div>
      <p className="text-2xl font-semibold text-slate-900">{value}</p>
      <p className="mt-0.5 text-xs text-slate-500">{label}</p>
    </div>
  );
}

function BarChartPlaceholder({
  data,
}: {
  data: Array<{ date: string; sent: number; failed: number }>;
}) {
  const maxSent = Math.max(...data.map((d) => d.sent), 1);

  return (
    <div className="flex h-48 items-end gap-1">
      {data.map((d, i) => {
        const sentHeight = (d.sent / maxSent) * 160;
        const failedHeight =
          d.failed > 0 ? Math.max((d.failed / maxSent) * 160, 2) : 0;
        const shortDate = new Date(d.date).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
        });

        return (
          <div
            key={i}
            className="group relative flex flex-1 flex-col items-center justify-end"
          >
            {/* Tooltip */}
            <div className="pointer-events-none absolute -top-8 z-10 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              {d.sent} sent, {d.failed} failed
            </div>
            {failedHeight > 0 && (
              <div
                className="w-full rounded-t bg-red-400"
                style={{ height: `${failedHeight}px` }}
              />
            )}
            <div
              className="w-full rounded-t bg-accent/70 transition-colors group-hover:bg-accent"
              style={{ height: `${sentHeight}px` }}
            />
            {/* Only show every few labels to avoid crowding */}
            {(i % Math.max(Math.floor(data.length / 7), 1) === 0 ||
              i === data.length - 1) && (
              <span className="mt-1 text-[10px] text-slate-400">
                {shortDate}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function formatNumber(n: number): string {
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}
