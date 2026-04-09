'use client';

import { cn } from '@/lib/utils';

interface ActiveInactiveBarProps {
  active: number;
  inactive: number;
  /** Show the numeric label ("X active · Y inactive") below the bar. */
  showLabel?: boolean;
  /** Smaller variant used inside tables / tight spaces. */
  compact?: boolean;
  className?: string;
}

/**
 * A tiny stacked bar used wherever a chat collection is shown: active share on the left
 * (emerald), inactive on the right (slate). When the total is 0 the bar renders empty.
 */
export function ActiveInactiveBar({
  active,
  inactive,
  showLabel = true,
  compact = false,
  className,
}: ActiveInactiveBarProps) {
  const total = active + inactive;
  const activePct = total > 0 ? (active / total) * 100 : 0;
  const inactivePct = total > 0 ? (inactive / total) * 100 : 0;

  return (
    <div className={cn('flex flex-col gap-1', className)}>
      <div
        className={cn(
          'flex w-full overflow-hidden rounded-full bg-slate-100',
          compact ? 'h-1.5' : 'h-2',
        )}
        aria-label={`${active} active, ${inactive} inactive`}
      >
        {activePct > 0 && (
          <div
            className="bg-emerald-500 transition-all"
            style={{ width: `${activePct}%` }}
          />
        )}
        {inactivePct > 0 && (
          <div
            className="bg-slate-300 transition-all"
            style={{ width: `${inactivePct}%` }}
          />
        )}
      </div>
      {showLabel && (
        <div className={cn('text-slate-500', compact ? 'text-[10px]' : 'text-xs')}>
          <span className="font-medium text-emerald-600">{active}</span>
          <span className="mx-1 text-slate-300">·</span>
          <span className="text-slate-500">{inactive} inactive</span>
        </div>
      )}
    </div>
  );
}
