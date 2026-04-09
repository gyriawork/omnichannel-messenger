'use client';

import { cn } from '@/lib/utils';
import type {
  AnalyticsScope,
  AnalyticsPeriod,
  AnalyticsGranularity,
} from '@/types/analytics';

interface AnalyticsControlsProps {
  scope: AnalyticsScope;
  period: AnalyticsPeriod;
  granularity: AnalyticsGranularity;
  onScopeChange: (scope: AnalyticsScope) => void;
  onPeriodChange: (period: AnalyticsPeriod) => void;
  onGranularityChange: (granularity: AnalyticsGranularity) => void;
  canSwitchScope: boolean;
}

const PERIODS: Array<{ label: string; value: AnalyticsPeriod }> = [
  { label: '7 days', value: '7d' },
  { label: '30 days', value: '30d' },
  { label: '90 days', value: '90d' },
];

const GRANULARITIES: Array<{ label: string; value: AnalyticsGranularity }> = [
  { label: 'Day', value: 'day' },
  { label: 'Week', value: 'week' },
  { label: 'Month', value: 'month' },
];

export function AnalyticsControls({
  scope,
  period,
  granularity,
  onScopeChange,
  onPeriodChange,
  onGranularityChange,
  canSwitchScope,
}: AnalyticsControlsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {canSwitchScope && (
        <div className="flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
          <button
            onClick={() => onScopeChange('my')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              scope === 'my'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            My Stats
          </button>
          <button
            onClick={() => onScopeChange('org')}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors',
              scope === 'org'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            Organization
          </button>
        </div>
      )}

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => onPeriodChange(p.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              period === p.value
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {p.label}
          </button>
        ))}
      </div>

      <div className="flex gap-1 rounded-lg bg-slate-100 p-1">
        {GRANULARITIES.map((g) => (
          <button
            key={g.value}
            onClick={() => onGranularityChange(g.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-all',
              granularity === g.value
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-500 hover:text-slate-700',
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>
  );
}
