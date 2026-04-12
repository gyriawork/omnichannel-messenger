'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Sidebar } from '@/components/layout/Sidebar';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { BottomNav } from '@/components/layout/BottomNav';
import { useAuthStore } from '@/stores/auth';
import { useSuperadminStore } from '@/stores/superadmin';
import { useSocket } from '@/hooks/useSocket';

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const router = useRouter();
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);
  const isLoading = useAuthStore((s) => s.isLoading);
  const hydrate = useAuthStore((s) => s.hydrate);
  const fetchMe = useAuthStore((s) => s.fetchMe);

  useEffect(() => {
    hydrate();
    useSuperadminStore.getState().hydrate();
  }, [hydrate]);

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      fetchMe();
    }
  }, [isLoading, isAuthenticated, fetchMe]);

  useEffect(() => {
    if (!isLoading && !isAuthenticated) {
      router.replace('/login');
    }
  }, [isLoading, isAuthenticated, router]);

  useSocket(); // Initialize WebSocket connection

  if (isLoading) {
    return (
      <div className="flex h-[100dvh] items-center justify-center bg-[#f8fafc]">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
      </div>
    );
  }

  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-[100dvh] bg-[#f8fafc]">
      <Sidebar />
      <main className="flex-1 overflow-auto pb-14 md:pb-0">
        <ErrorBoundary>{children}</ErrorBoundary>
      </main>
      <BottomNav />
    </div>
  );
}
