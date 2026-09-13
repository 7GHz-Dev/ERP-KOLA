import Link from 'next/link';
import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { loadDoPayBatch } from '@/lib/queries/do-files';
import { doPaySelectionIds } from '@/lib/do-pay-selection';
import { DoPayBatchPanel } from '@/components/DoPayBatchPanel';

export const dynamic = 'force-dynamic';
export default async function DoPayBatchPage({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['MAY']);
  const entries = await loadDoPayBatch(doPaySelectionIds((await searchParams).jobId));
  if (!entries) notFound();
  return <>
    <div className="page-head"><h1>Invoice DO · {entries.length} รายการ</h1><Link href="/may/do-pay">กลับหน้ารอแลก DO</Link></div>
    <DoPayBatchPanel entries={entries} />
  </>;
}
