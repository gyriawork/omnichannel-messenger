// ─── EmptyState primitive ───
// Friendly placeholder for "no data yet" states. Replaces blank screens
// with an icon, an explanation, and an optional call-to-action button.
//
// Usage:
//   <EmptyState
//     icon={<MessageCircle className="h-12 w-12" />}
//     title="No chats yet"
//     description="Import your first chat to start messaging."
//     action={<button onClick={onImport}>+ Import chats</button>}
//   />

import type { ReactNode } from 'react';

export interface EmptyStateProps {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  /** Use compact spacing — appropriate for smaller cards/panels. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
  className = '',
}: EmptyStateProps) {
  return (
    <div
      className={`flex flex-col items-center justify-center text-center ${
        compact ? 'gap-2 py-8 px-4' : 'gap-3 py-16 px-6'
      } ${className}`}
      role="status"
    >
      {icon && (
        <div className={`text-gray-300 ${compact ? 'mb-1' : 'mb-2'}`} aria-hidden="true">
          {icon}
        </div>
      )}
      <h3 className={`font-semibold text-gray-700 ${compact ? 'text-sm' : 'text-base'}`}>
        {title}
      </h3>
      {description && (
        <p className={`max-w-sm text-gray-500 ${compact ? 'text-xs' : 'text-sm'}`}>
          {description}
        </p>
      )}
      {action && <div className={compact ? 'mt-1' : 'mt-2'}>{action}</div>}
    </div>
  );
}
