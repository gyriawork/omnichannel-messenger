'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, ArrowRight } from 'lucide-react';
import { MessengerIcon } from '@/components/ui/MessengerIcon';
import { cn } from '@/lib/utils';
import type { MemberRow } from '@/types/analytics';
import { ActiveInactiveBar } from './ActiveInactiveBar';

interface TeamTableProps {
  members: MemberRow[];
  onDrillDown: (userId: string) => void;
}

type SortKey = 'name' | 'messages' | 'lastActive';

export function TeamTable({ members, onDrillDown }: TeamTableProps) {
  const [sortKey, setSortKey] = useState<SortKey>('messages');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const sorted = [...members].sort((a, b) => {
    let cmp = 0;
    if (sortKey === 'name') cmp = a.name.localeCompare(b.name);
    else if (sortKey === 'messages') cmp = a.messages - b.messages;
    else {
      const at = a.lastActiveAt ? new Date(a.lastActiveAt).getTime() : 0;
      const bt = b.lastActiveAt ? new Date(b.lastActiveAt).getTime() : 0;
      cmp = at - bt;
    }
    return sortDir === 'asc' ? cmp : -cmp;
  });

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };

  if (!members.length) {
    return (
      <p className="py-8 text-center text-sm text-slate-400">
        No members in this organization yet
      </p>
    );
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-left text-sm" style={{ minWidth: '600px' }}>
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50">
            <SortableHeader
              label="Name"
              active={sortKey === 'name'}
              dir={sortDir}
              onClick={() => toggleSort('name')}
            />
            <th className="px-4 py-2.5 text-xs font-medium text-slate-500">
              Role
            </th>
            <SortableHeader
              label="Messages"
              active={sortKey === 'messages'}
              dir={sortDir}
              onClick={() => toggleSort('messages')}
              align="right"
            />
            <th className="px-4 py-2.5 text-xs font-medium text-slate-500">
              Chats
            </th>
            <SortableHeader
              label="Last active"
              active={sortKey === 'lastActive'}
              dir={sortDir}
              onClick={() => toggleSort('lastActive')}
            />
            <th className="px-4 py-2.5 text-xs font-medium text-slate-500">
              Top
            </th>
            <th className="px-4 py-2.5" />
          </tr>
        </thead>
        <tbody>
          {sorted.map((m) => (
            <tr
              key={m.id}
              onClick={() => onDrillDown(m.id)}
              className="cursor-pointer border-b border-slate-100 transition-colors last:border-b-0 hover:bg-slate-50"
            >
              <td className="px-4 py-3">
                <div className="font-medium text-slate-900">{m.name}</div>
                <div className="text-xs text-slate-400">{m.email}</div>
              </td>
              <td className="px-4 py-3">
                <span
                  className={cn(
                    'inline-flex rounded-full px-2 py-0.5 text-[10px] font-medium capitalize',
                    m.role === 'superadmin'
                      ? 'bg-purple-50 text-purple-700'
                      : m.role === 'admin'
                        ? 'bg-blue-50 text-blue-700'
                        : 'bg-slate-100 text-slate-600',
                  )}
                >
                  {m.role}
                </span>
              </td>
              <td className="px-4 py-3 text-right font-medium text-slate-900">
                {m.messages.toLocaleString()}
              </td>
              <td className="px-4 py-3" style={{ minWidth: 120 }}>
                <ActiveInactiveBar
                  active={m.activeChats}
                  inactive={m.inactiveChats}
                  compact
                  showLabel={false}
                />
                <div className="mt-1 text-[10px] text-slate-400">
                  <span className="text-emerald-600">{m.activeChats}</span>
                  <span className="mx-1 text-slate-300">·</span>
                  <span>{m.inactiveChats} inactive</span>
                </div>
              </td>
              <td className="px-4 py-3 text-xs text-slate-500">
                {formatRelative(m.lastActiveAt)}
              </td>
              <td className="px-4 py-3">
                {m.topMessenger ? (
                  <MessengerIcon messenger={m.topMessenger} size={22} />
                ) : (
                  <span className="text-xs text-slate-300">—</span>
                )}
              </td>
              <td className="px-4 py-3 text-right">
                <ArrowRight className="h-4 w-4 text-slate-300" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function SortableHeader({
  label,
  active,
  dir,
  onClick,
  align = 'left',
}: {
  label: string;
  active: boolean;
  dir: 'asc' | 'desc';
  onClick: () => void;
  align?: 'left' | 'right';
}) {
  return (
    <th
      className={cn(
        'cursor-pointer px-4 py-2.5 text-xs font-medium transition-colors select-none',
        active ? 'text-slate-900' : 'text-slate-500 hover:text-slate-700',
        align === 'right' && 'text-right',
      )}
      onClick={onClick}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active &&
          (dir === 'asc' ? (
            <ChevronUp className="h-3 w-3" />
          ) : (
            <ChevronDown className="h-3 w-3" />
          ))}
      </span>
    </th>
  );
}

function formatRelative(iso: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diffMs = Date.now() - d.getTime();
  const diffMin = Math.floor(diffMs / 60_000);
  const diffHour = Math.floor(diffMs / 3_600_000);
  const diffDay = Math.floor(diffMs / 86_400_000);
  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHour < 24) return `${diffHour}h ago`;
  if (diffDay < 7) return `${diffDay}d ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
