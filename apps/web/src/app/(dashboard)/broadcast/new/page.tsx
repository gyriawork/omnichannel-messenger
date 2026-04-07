'use client';

import { Suspense } from 'react';
import { BroadcastWizard } from '@/components/broadcast/BroadcastWizard';
import { RequireOrgContext } from '@/components/layout/RequireOrgContext';

export default function NewBroadcastPage() {
  return (
    <RequireOrgContext>
      <Suspense
        fallback={
          <div className="flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
          </div>
        }
      >
        <BroadcastWizard />
      </Suspense>
    </RequireOrgContext>
  );
}
