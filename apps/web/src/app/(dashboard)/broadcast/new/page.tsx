'use client';

import { Suspense } from 'react';
import { BroadcastWizard } from '@/components/broadcast/BroadcastWizard';

export default function NewBroadcastPage() {
  return (
    <Suspense
      fallback={
        <div className="flex items-center justify-center py-20">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent border-t-transparent" />
        </div>
      }
    >
      <BroadcastWizard />
    </Suspense>
  );
}
