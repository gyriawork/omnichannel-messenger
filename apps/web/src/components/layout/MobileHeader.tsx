'use client';

import { ArrowLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface MobileHeaderProps {
  title: string;
  onBack?: () => void;
  actions?: React.ReactNode;
  className?: string;
}

export function MobileHeader({ title, onBack, actions, className }: MobileHeaderProps) {
  return (
    <div
      className={cn(
        'flex h-12 flex-shrink-0 items-center gap-3 border-b border-slate-200 bg-white px-3 pt-[env(safe-area-inset-top)] md:hidden',
        className,
      )}
    >
      {onBack && (
        <button
          onClick={onBack}
          className="flex h-9 w-9 items-center justify-center rounded-full text-slate-600 transition-colors hover:bg-slate-100"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
      )}
      <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-slate-900">
        {title}
      </h1>
      {actions && <div className="flex items-center gap-1">{actions}</div>}
    </div>
  );
}
