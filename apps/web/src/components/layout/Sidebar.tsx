'use client';

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
  ShieldCheck,
} from 'lucide-react';
import { useAuthStore } from '@/stores/auth';
import { cn } from '@/lib/utils';

const baseNavItems = [
  { icon: LayoutDashboard, href: '/', label: 'Dashboard' },
  { icon: Inbox, href: '/chats', label: 'Chats' },
  { icon: MessageSquare, href: '/messenger', label: 'Messenger' },
  { icon: Send, href: '/broadcast', label: 'Broadcast' },
  { icon: FileText, href: '/templates', label: 'Templates' },
  { icon: Tag, href: '/tags', label: 'Tags' },
  { icon: Activity, href: '/activity', label: 'Activity Log' },
];

export function Sidebar() {
  const pathname = usePathname();
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);

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
    <aside className="flex h-screen w-14 flex-col items-center bg-gradient-to-b from-[#1e1b4b] to-[#312e81] py-3">
      {/* Logo */}
      <div className="mb-6 flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-accent to-purple-500">
        <span className="text-sm font-bold text-white">O</span>
      </div>

      {/* Navigation */}
      <nav className="flex flex-1 flex-col items-center gap-1">
        {[
          ...baseNavItems,
          ...(user?.role === 'superadmin'
            ? [{ icon: ShieldCheck, href: '/admin', label: 'Admin' }]
            : []),
          { icon: Settings, href: '/settings', label: 'Settings' },
        ].map(({ icon: Icon, href, label }) => {
          const active = isActive(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              className={cn(
                'group relative flex h-10 w-10 items-center justify-center rounded-lg transition-all',
                active
                  ? 'bg-white/15 text-white'
                  : 'text-white/40 hover:text-white/60 hover:bg-white/5',
              )}
            >
              <Icon className="h-5 w-5" strokeWidth={active ? 2 : 1.5} />
              {/* Tooltip */}
              <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
                {label}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Bottom: Avatar + Logout */}
      <div className="flex flex-col items-center gap-2">
        <div
          title={user?.name || 'User'}
          className="flex h-8 w-8 items-center justify-center rounded-avatar bg-white/15 text-xs font-medium text-white"
        >
          {initials}
        </div>
        <button
          onClick={logout}
          title="Sign out"
          className="group relative flex h-10 w-10 items-center justify-center rounded-lg text-white/40 transition-all hover:bg-white/5 hover:text-white/60"
        >
          <LogOut className="h-5 w-5" strokeWidth={1.5} />
          <span className="pointer-events-none absolute left-full z-50 ml-3 whitespace-nowrap rounded-lg bg-slate-800 px-2.5 py-1.5 text-xs font-medium text-white opacity-0 shadow-sm transition-opacity group-hover:opacity-100">
            Sign out
          </span>
        </button>
      </div>
    </aside>
  );
}
