import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { loadDoPayBatch } from '@/lib/queries/do-files';
import { doPaySelectionIds } from '@/lib/do-pay-selection';
import { DoPayBatchPanel } from '@/components/DoPayBatchPanel';
import { chargesFor, doChargeTopics } from '@/lib/queries/do-charges';

export const dynamic = 'force-dynamic';
export default async function DoPayBatchPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['MAY']);
  const ids = doPaySelectionIds((await searchParams).jobId);
  const [entries, charges, topics] = await Promise.all([loadDoPayBatch(ids), chargesFor(ids), doChargeTopics()]);
  if (!entries) notFound();
  return <>
    <div className="page-head"><h1>Invoice DO · {entries.length} รายการ</h1><Link href="/may/do-pay">กลับหน้ารอแลก DO</Link></div>
    <DoPayBatchPanel entries={entries} charges={Object.fromEntries(charges)} topics={topics} />
  </>;
}
