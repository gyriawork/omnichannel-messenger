'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  MessageSquare,
  LayoutDashboard,
  Send,
  FileText,
  Activity,
  Settings,
  LogOut,
  Inbox,
  Tag,
  BookOpen,
  ShieldCheck,
  Shield,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';

const baseNavItems = [
  { icon: LayoutDashboard, href: '/', label: 'Dashboard' },
  { icon: Inbox, href: '/chats', label: 'Chats' },
  { icon: MessageSquare, href: '/messenger', label: 'Messenger' },
  { icon: Send, href: '/broadcast', label: 'Broadcast' },
  { icon: FileText, href: '/templates', label: 'Templates' },
  { icon: BookOpen, href: '/wiki', label: 'Wiki' },
  { icon: Tag, href: '/tags', label: 'Tags' },
  { icon: Activity, href: '/activity', label: 'Activity Log' },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const [collapsed, setCollapsed] = useState(false);

  const isActive = (href: string) => {
    if (href === '/') return pathname === '/';
    return pathname.startsWith(href);
  };

  const initials = user?.name
    ? user.name
        .split(' ')
        .map((n) => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2)
    : '?';

  return (
    <aside
      className={cn(
        'hidden h-[100dvh] flex-col bg-gradient-to-b from-[#1e1b4b] to-[#312e81] py-4 transition-all duration-200 md:flex',
        collapsed ? 'w-14 items-center px-1.5' : 'w-56 px-3',
      )}
    >
      {/* Logo + Collapse toggle */}
      <div className={cn('mb-6 flex items-center', collapsed ? 'justify-center' : 'justify-between px-2')}>
        <div className="flex items-center gap-2.5">
          {collapsed ? (
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-purple-500">
              <span className="text-sm font-bold text-white">m</span>
            </div>
          ) : (
            <img src="/logo.svg" alt="messengly" className="h-6" />
          )}
        </div>
        {!collapsed && (
          <button
            onClick={() => setCollapsed(true)}
            className="rounded-md p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
            title="Collapse sidebar"
          >
            <ChevronsLeft className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* Expand button when collapsed */}
      {collapsed && (
        <button
          onClick={() => setCollapsed(false)}
          className="mb-3 flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          title="Expand sidebar"
        >
          <ChevronsRight className="h-4 w-4" />
        </button>
      )}

      {/* Navigation */}
      <nav className={cn('flex flex-1 flex-col gap-0.5', collapsed && 'items-center')}>
        {[
          ...baseNavItems,
          ...(user?.role === 'superadmin'
            ? [
                { icon: ShieldCheck, href: '/admin', label: 'Admin' },
                { icon: Shield, href: '/admin/platform', label: 'Platform' },
              ]
            : []),
          { icon: Settings, href: '/settings', label: 'Settings' },
        ].map(({ icon: Icon, href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={collapsed ? label : undefined}
              className={cn(
                'group relative flex items-center rounded-lg transition-all',
                collapsed
                  ? 'h-10 w-10 justify-center'
                  : 'gap-3 px-2.5 py-2 text-sm',
                active
                  ? 'bg-white/15 font-medium text-white'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80',
              )}
            >
              <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={active ? 2 : 1.5} />
              {!collapsed && label}
              {collapsed && (
                <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                  {label}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Bottom: User info + Logout */}
      <div
        className={cn(
          'flex items-center border-t border-white/10 pt-3',
          collapsed ? 'flex-col gap-2' : 'gap-2',
        )}
      >
        <div
          title={collapsed ? (user?.name || 'User') : undefined}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-avatar bg-white/15 text-xs font-medium text-white"
        >
          {initials}
        </div>
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1 truncate text-xs text-white/60">
              {user?.email || user?.name || 'User'}
            </span>
            <button
              onClick={logout}
              title="Sign out"
              className="shrink-0 rounded-md p-1 text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.5} />
            </button>
          </>
        )}
        {collapsed && (
          <button
            onClick={logout}
            title="Sign out"
            className="group relative flex h-8 w-8 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/5 hover:text-white/60"
          >
            <LogOut className="h-4 w-4" strokeWidth={1.5} />
            <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
              Sign out
            </span>
          </button>
        )}
      </div>
    </aside>
  );
}
