'use client';

import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { HeatmapCell } from '@/types/analytics';

interface ActivityHeatmapProps {
  data: HeatmapCell[];
}

const WEEKDAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_LONG = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

interface HoveredCell {
  weekday: number;
  hour: number;
  count: number;
  /** x offset within the grid column (0-23) */
  col: number;
  /** row index within the grid (0-6) */
  row: number;
}

export function ActivityHeatmap({ data }: ActivityHeatmapProps) {
  const [hovered, setHovered] = useState<HoveredCell | null>(null);

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
      <div className="relative inline-block" style={{ minWidth: '500px' }}>
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

        {WEEKDAYS_SHORT.map((label, weekday) => (
          <div key={weekday} className="flex items-center">
            <div className="w-10 pr-1 text-right text-[10px] text-slate-500">
              {label}
            </div>
            <div className="flex flex-1 gap-[2px]">
              {Array.from({ length: 24 }).map((_, hour) => {
                const count = lookup.get(`${weekday}-${hour}`) ?? 0;
                const intensity = count === 0 ? 0 : count / max;
                const isHovered =
                  hovered?.weekday === weekday && hovered?.hour === hour;
                return (
                  <div
                    key={hour}
                    role="gridcell"
                    tabIndex={0}
                    aria-label={`${WEEKDAYS_LONG[weekday]} ${hour}:00 — ${count} messages`}
                    className={cn(
                      'h-4 flex-1 cursor-default rounded-sm border border-slate-100 transition-all outline-none',
                      count === 0 && 'bg-slate-50',
                      isHovered && 'ring-2 ring-accent ring-offset-1',
                    )}
                    style={
                      count > 0
                        ? {
                            backgroundColor: `rgba(99, 102, 241, ${0.1 + intensity * 0.9})`,
                            minWidth: '14px',
                          }
                        : { minWidth: '14px' }
                    }
                    onMouseEnter={() =>
                      setHovered({ weekday, hour, count, col: hour, row: weekday })
                    }
                    onMouseLeave={() => setHovered(null)}
                    onFocus={() =>
                      setHovered({ weekday, hour, count, col: hour, row: weekday })
                    }
                    onBlur={() => setHovered(null)}
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

        {/* Tooltip */}
        {hovered && (
          <HeatmapTooltip
            weekday={hovered.weekday}
            hour={hovered.hour}
            count={hovered.count}
            max={max}
            col={hovered.col}
            row={hovered.row}
          />
        )}
      </div>
    </div>
  );
}

function HeatmapTooltip({
  weekday,
  hour,
  count,
  max,
  col,
  row,
}: {
  weekday: number;
  hour: number;
  count: number;
  max: number;
  col: number;
  row: number;
}) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  const nextHour = (hour + 1) % 24;

  // Position: each cell row is ~16px tall, plus some header offset.
  // Labels row + weekday row heights are consistent; we use simple percentages
  // of the grid width for x positioning and absolute pixel offsets for y.
  // col 0-23 → left as percentage of the grid (which starts after 40px label col).
  const leftPct = ((col + 0.5) / 24) * 100;
  const topPx = 14 /* label row */ + row * 18 /* row height */ + 22 /* below cell */;

  // Flip horizontal anchor near the edges so the tooltip doesn't clip.
  const anchorRight = col >= 19;
  const anchorLeft = col <= 3;

  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 flex min-w-[160px] flex-col gap-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg"
      style={{
        top: topPx,
        left: anchorRight ? undefined : `calc(40px + ${leftPct}% - 80px)`,
        right: anchorRight ? '0' : undefined,
        transform: anchorLeft && !anchorRight ? 'translateX(0)' : undefined,
      }}
    >
      <div className="font-medium text-slate-900">
        {WEEKDAYS_LONG[weekday]} {formatHour(hour)}–{formatHour(nextHour)}
      </div>
      <div className="text-slate-600">
        <span className="font-semibold text-slate-900">{count.toLocaleString()}</span>{' '}
        {count === 1 ? 'message' : 'messages'}
      </div>
      <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="h-full bg-accent"
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="text-[10px] text-slate-400">
        {pct}% of peak hour
      </div>
    </div>
  );
}

function formatHour(h: number): string {
  return `${String(h).padStart(2, '0')}:00`;
}
