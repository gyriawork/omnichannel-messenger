'use client';

import { Suspense, useCallback, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, BarChart3 } from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { useAnalytics } from '@/hooks/useAnalytics';
import { RequireOrgContext } from '@/components/layout/RequireOrgContext';
import { Skeleton } from '@/components/ui/Skeleton';
import type {
  AnalyticsScope,
  AnalyticsPeriod,
  AnalyticsGranularity,
} from '@/types/analytics';
import { AnalyticsControls } from './components/AnalyticsControls';
import { KpiCards } from './components/KpiCards';
import { TrendChart } from './components/TrendChart';
import { MessengerBreakdown } from './components/MessengerBreakdown';
import { ActivityHeatmap } from './components/ActivityHeatmap';
import { TeamTable } from './components/TeamTable';

function isScope(v: string | null): v is AnalyticsScope {
  return v === 'my' || v === 'org';
}
function isPeriod(v: string | null): v is AnalyticsPeriod {
  return v === '7d' || v === '30d' || v === '90d';
}
function isGranularity(v: string | null): v is AnalyticsGranularity {
  return v === 'day' || v === 'week' || v === 'month';
}

function AnalyticsPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const user = useAuthStore((s) => s.user);
  const isAdmin = user?.role === 'admin' || user?.role === 'superadmin';

  // URL-driven state so deep links and back/forward work.
  const rawScope = searchParams.get('scope');
  const rawPeriod = searchParams.get('period');
  const rawGranularity = searchParams.get('granularity');
  const userId = searchParams.get('userId') || undefined;

  const defaultScope: AnalyticsScope = isAdmin ? 'org' : 'my';
  const scope: AnalyticsScope =
    isScope(rawScope) && (rawScope === 'my' || isAdmin) ? rawScope : defaultScope;
  const period: AnalyticsPeriod = isPeriod(rawPeriod) ? rawPeriod : '30d';
  const granularity: AnalyticsGranularity = isGranularity(rawGranularity)
    ? rawGranularity
    : 'day';

  const isDrillDown = !!userId && scope === 'org' && isAdmin;

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value === undefined) params.delete(key);
        else params.set(key, value);
      }
      router.replace(`/analytics?${params.toString()}`);
    },
    [router, searchParams],
  );

  const { data, isLoading, error } = useAnalytics({
    scope,
    period,
    granularity,
    userId: isDrillDown ? userId : undefined,
  });

  const drilledMemberName = useMemo(() => {
    if (!isDrillDown || !data?.members) return null;
    return data.members.find((m) => m.id === userId)?.name ?? null;
  }, [isDrillDown, data, userId]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 md:px-6 md:py-8">
      {/* Header */}
      <div className="mb-6">
        {isDrillDown && (
          <button
            onClick={() => updateParams({ userId: undefined })}
            className="mb-3 flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to team
          </button>
        )}

        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">
              {isDrillDown && drilledMemberName
                ? drilledMemberName
                : 'Analytics'}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {scope === 'my'
                ? 'Your activity across all messengers'
                : isDrillDown
                  ? 'Individual member activity'
                  : 'Organization activity across all messengers'}
            </p>
          </div>

          <AnalyticsControls
            scope={scope}
            period={period}
            granularity={granularity}
            canSwitchScope={isAdmin && !isDrillDown}
            onScopeChange={(s) => updateParams({ scope: s, userId: undefined })}
            onPeriodChange={(p) => updateParams({ period: p })}
            onGranularityChange={(g) => updateParams({ granularity: g })}
          />
        </div>
      </div>

      {error && (
        <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">
          Failed to load analytics. Please try again.
        </div>
      )}

      {isLoading || !data ? (
        <LoadingSkeleton />
      ) : (
        <div className="space-y-6">
          {/* KPI cards */}
          <KpiCards data={data} scope={scope} isDrillDown={isDrillDown} />

          {/* Trend chart */}
          <section className="rounded-xl bg-white p-6 shadow-xs">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-slate-900">
                Activity Over Time
              </h2>
              <span className="flex items-center gap-1 text-xs text-slate-400">
                <BarChart3 className="h-4 w-4" />
                by {granularity}
              </span>
            </div>
            <TrendChart
              data={data.trend}
              scope={scope}
              granularity={granularity}
              isDrillDown={isDrillDown}
            />
          </section>

          {/* Per-messenger breakdown */}
          <section>
            <h2 className="mb-3 text-base font-semibold text-slate-900">
              By Messenger
            </h2>
            <MessengerBreakdown data={data.byMessenger} />
          </section>

          {/* Activity heatmap */}
          <section className="rounded-xl bg-white p-6 shadow-xs">
            <h2 className="mb-4 text-base font-semibold text-slate-900">
              Activity Heatmap
            </h2>
            <p className="mb-4 text-xs text-slate-400">
              When messages are sent and received, by day of week and hour
            </p>
            <ActivityHeatmap data={data.heatmap} />
          </section>

          {/* Team table (org scope, not in drill-down) */}
          {data.members && (
            <section className="rounded-xl bg-white p-6 shadow-xs">
              <h2 className="mb-4 text-base font-semibold text-slate-900">
                Team Activity
              </h2>
              <p className="mb-4 text-xs text-slate-400">
                Click a member to drill into their individual stats
              </p>
              <TeamTable
                members={data.members}
                onDrillDown={(id) => updateParams({ userId: id })}
              />
            </section>
          )}
        </div>
      )}
    </div>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl bg-white p-5 shadow-xs">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-3 h-7 w-16" />
            <Skeleton className="mt-2 h-3 w-24" />
          </div>
        ))}
      </div>
      <div className="rounded-xl bg-white p-6 shadow-xs">
        <Skeleton className="mb-4 h-5 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
      <div className="rounded-xl bg-white p-6 shadow-xs">
        <Skeleton className="mb-4 h-5 w-40" />
        <Skeleton className="h-32 w-full" />
      </div>
    </div>
  );
}

export default function AnalyticsPage() {
  return (
    <RequireOrgContext>
      <Suspense fallback={<LoadingSkeleton />}>
        <AnalyticsPageContent />
      </Suspense>
    </RequireOrgContext>
  );
}
