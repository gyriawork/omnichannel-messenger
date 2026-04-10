'use client';

import { BarChart3 } from 'lucide-react';
import { cn } from '@/lib/utils';
import type {
  TrendBucket,
  AnalyticsScope,
  AnalyticsGranularity,
  AnalyticsMessenger,
} from '@/types/analytics';

interface TrendChartProps {
  data: TrendBucket[];
  scope: AnalyticsScope;
  granularity: AnalyticsGranularity;
  isDrillDown: boolean;
}

// Colours picked to match the rest of the UI's messenger palette.
const MESSENGER_COLORS: Record<AnalyticsMessenger, string> = {
  telegram: 'bg-[#2AABEE]',
  slack: 'bg-[#E01E5A]',
  whatsapp: 'bg-[#25D366]',
  gmail: 'bg-[#EA4335]',
};

const MESSENGER_LABELS: Record<AnalyticsMessenger, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  whatsapp: 'WhatsApp',
  gmail: 'Gmail',
};

export function TrendChart({
  data,
  scope,
  granularity,
  isDrillDown,
}: TrendChartProps) {
  // Bars are stacked by messenger only in the "whole org" view — in drill-down
  // mode we're showing one person's history, so a flat bar is cleaner.
  const stacked = scope === 'org' && !isDrillDown;

  if (!data.length) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-slate-400">
        <div className="flex flex-col items-center gap-2">
          <BarChart3 className="h-8 w-8" />
          No activity in this period
        </div>
      </div>
    );
  }

  const maxTotal = Math.max(...data.map((b) => b.total), 1);

  return (
    <div>
      <div className="flex h-48 items-end gap-1">
        {data.map((bucket) => (
          <TrendBar
            key={bucket.bucket}
            bucket={bucket}
            maxTotal={maxTotal}
            stacked={stacked}
            granularity={granularity}
            showLabel={shouldShowLabel(data.length, data.indexOf(bucket), data.length)}
          />
        ))}
      </div>
      {stacked && (
        <div className="mt-4 flex flex-wrap items-center gap-4 border-t border-slate-100 pt-3">
          {(Object.keys(MESSENGER_COLORS) as AnalyticsMessenger[]).map((m) => (
            <div key={m} className="flex items-center gap-2 text-xs text-slate-500">
              <span
                className={cn('h-2.5 w-2.5 rounded-sm', MESSENGER_COLORS[m])}
              />
              {MESSENGER_LABELS[m]}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TrendBar({
  bucket,
  maxTotal,
  stacked,
  granularity,
  showLabel,
}: {
  bucket: TrendBucket;
  maxTotal: number;
  stacked: boolean;
  granularity: AnalyticsGranularity;
  showLabel: boolean;
}) {
  const totalHeight = (bucket.total / maxTotal) * 160;

  return (
    <div className="group relative flex min-w-[3px] flex-1 flex-col items-center justify-end">
      {/* Tooltip */}
      <div className="pointer-events-none absolute -top-14 z-10 whitespace-nowrap rounded bg-slate-800 px-2 py-1 text-xs text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
        <div className="font-medium">{formatBucketLabel(bucket.bucket, granularity)}</div>
        <div>{bucket.total} total</div>
      </div>

      {/* Bar */}
      <div
        className="flex w-full flex-col-reverse overflow-hidden rounded-t"
        style={{ height: `${totalHeight}px` }}
      >
        {stacked ? (
          (Object.keys(MESSENGER_COLORS) as AnalyticsMessenger[]).map((m) => {
            const count = bucket.byMessenger[m];
            if (count <= 0) return null;
            const segmentHeight = (count / bucket.total) * 100;
            return (
              <div
                key={m}
                className={cn(MESSENGER_COLORS[m])}
                style={{ height: `${segmentHeight}%` }}
              />
            );
          })
        ) : (
          <div className="h-full w-full bg-accent/70 transition-colors group-hover:bg-accent" />
        )}
      </div>

      {showLabel && (
        <span className="mt-1 text-[10px] text-slate-400">
          {formatShortBucketLabel(bucket.bucket, granularity)}
        </span>
      )}
    </div>
  );
}

function shouldShowLabel(_bucketCount: number, index: number, total: number): boolean {
  // Show every Nth label (max 7 labels) to avoid crowding.
  const step = Math.max(Math.floor(total / 7), 1);
  return index % step === 0 || index === total - 1;
}

function formatBucketLabel(iso: string, granularity: AnalyticsGranularity): string {
  const d = new Date(iso);
  if (granularity === 'month') {
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  }
  if (granularity === 'week') {
    return `Week of ${d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })}`;
  }
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function formatShortBucketLabel(iso: string, granularity: AnalyticsGranularity): string {
  const d = new Date(iso);
  if (granularity === 'month') {
    return d.toLocaleDateString('en-US', { month: 'short' });
  }
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
