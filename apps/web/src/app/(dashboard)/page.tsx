'use client';

import { LayoutDashboard } from 'lucide-react';

export default function DashboardPage() {
  return (
    <div className="flex h-full flex-col items-center justify-center p-8">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-lg bg-accent-bg">
        <LayoutDashboard className="h-7 w-7 text-accent" />
      </div>
      <h1 className="text-xl font-semibold text-slate-800">Dashboard</h1>
      <p className="mt-1 text-sm text-slate-500">
        Analytics and overview coming soon
      </p>
    </div>
  );
}
