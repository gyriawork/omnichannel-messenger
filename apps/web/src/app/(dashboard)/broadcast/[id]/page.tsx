import { BroadcastDetail } from '@/components/broadcast/BroadcastDetail';

interface Props { params: Promise<{ id: string }> }

export default async function BroadcastDetailPage({ params }: Props) {
  const { id } = await params;
  return <BroadcastDetail id={id} />;
}
