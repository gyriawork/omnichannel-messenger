'use client';

import { use } from 'react';
import { BroadcastDetail } from '@/components/broadcast/BroadcastDetail';
import { RequireOrgContext } from '@/components/layout/RequireOrgContext';

interface Props { params: Promise<{ id: string }> }

export default function BroadcastDetailPage({ params }: Props) {
  const { id } = use(params);
  return (
    <RequireOrgContext>
      <BroadcastDetail id={id} />
    </RequireOrgContext>
  );
}
