import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { loadDoPayBatch } from '@/lib/queries/do-files';
import { doPaySelectionIds } from '@/lib/do-pay-selection';
import { DoPayBatchPanel } from '@/components/DoPayBatchPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';
import { chargesFor, doChargeTopics } from '@/lib/queries/do-charges';

export const dynamic = 'force-dynamic';
export default async function DoPayBatchDrawer({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['MAY']);
  const ids = doPaySelectionIds((await searchParams).jobId);
  const [entries, charges, topics] = await Promise.all([loadDoPayBatch(ids), chargesFor(ids), doChargeTopics()]);
  if (!entries) notFound();
  const params = new URLSearchParams();
  ids.forEach(id => params.append('jobId', id));
  return <FileDrawerShell title="ยอดชำระค่าแลก D/O" fileName={`Invoice DO · ${entries.length} รายการ`}
    meta="กรอกยอดแยกตาม Job / BL" viewHref={`/may/do-pay/batch?${params}`} wide>
    <DoPayBatchPanel entries={entries} charges={Object.fromEntries(charges)} topics={topics} />
  </FileDrawerShell>;
}
