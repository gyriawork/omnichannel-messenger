'use client';

import { cn } from '@/lib/utils';
import type { HeatmapCell } from '@/types/analytics';

interface ActivityHeatmapProps {
  data: HeatmapCell[];
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  // Flatten to a weekday × hour lookup (7 rows, 24 cols).
  const lookup = new Map<string, number>();
  let max = 0;
  for (const cell of data) {
    lookup.set(`${cell.weekday}-${cell.hour}`, cell.count);
    if (cell.count > max) max = cell.count;
  }

  if (max === 0) {
    return (
      <div className="flex h-32 items-center justify-center text-sm text-slate-400">
        No activity in this period
      </div>
    );
  }

  return (
    <div className="overflow-x-auto -mx-2 px-2">
      <div className="inline-block" style={{ minWidth: '500px' }}>
        {/* Hour labels (every 3 hours) */}
        <div className="ml-10 flex">
          {Array.from({ length: 24 }).map((_, hour) => (
            <div
              key={hour}
              className="flex-1 text-center text-[9px] text-slate-400"
              style={{ minWidth: '14px' }}
            >
              {hour % 3 === 0 ? `${hour}h` : ''}
            </div>
          ))}
        </div>

        {WEEKDAYS.map((label, weekday) => (
          <div key={weekday} className="flex items-center">
            <div className="w-10 pr-1 text-right text-[10px] text-slate-500">
              {label}
            </div>
            <div className="flex flex-1 gap-[2px]">
              {Array.from({ length: 24 }).map((_, hour) => {
                const count = lookup.get(`${weekday}-${hour}`) ?? 0;
                const intensity = count === 0 ? 0 : count / max;
                return (
                  <div
                    key={hour}
                    className={cn(
                      'h-4 flex-1 rounded-sm border border-slate-100 transition-colors',
                      count === 0 && 'bg-slate-50',
                    )}
                    style={
                      count > 0
                        ? {
                            backgroundColor: `rgba(99, 102, 241, ${0.1 + intensity * 0.9})`,
                            minWidth: '14px',
                          }
                        : { minWidth: '14px' }
                    }
                    title={`${label} ${hour}:00 — ${count} messages`}
                  />
                );
              })}
            </div>
          </div>
        ))}

        {/* Legend */}
        <div className="ml-10 mt-3 flex items-center gap-2 text-[10px] text-slate-400">
          <span>Less</span>
          {[0.15, 0.35, 0.55, 0.75, 0.95].map((intensity) => (
            <div
              key={intensity}
              className="h-3 w-3 rounded-sm"
              style={{
                backgroundColor: `rgba(99, 102, 241, ${intensity})`,
              }}
            />
          ))}
          <span>More</span>
        </div>
      </div>
    </div>
  );
}
