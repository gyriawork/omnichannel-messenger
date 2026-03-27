'use client';

import { BroadcastDetail } from '@/components/broadcast/BroadcastDetail';

interface BroadcastDetailPageProps {
  params: { id: string };
}

export default function BroadcastDetailPage({ params }: BroadcastDetailPageProps) {
  return <BroadcastDetail id={params.id} />;
}
