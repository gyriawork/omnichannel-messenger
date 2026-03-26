'use client';

import { use } from 'react';
import { BroadcastDetail } from '@/components/broadcast/BroadcastDetail';

interface BroadcastDetailPageProps {
  params: Promise<{ id: string }>;
}

export default function BroadcastDetailPage({ params }: BroadcastDetailPageProps) {
  const { id } = use(params);

  return <BroadcastDetail id={id} />;
}
