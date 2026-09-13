import { notFound } from 'next/navigation';
import { requireUserReady } from '@/lib/auth';
import { loadDoPayBatch } from '@/lib/queries/do-files';
import { doPaySelectionIds } from '@/lib/do-pay-selection';
import { DoPayBatchPanel } from '@/components/DoPayBatchPanel';
import { FileDrawerShell } from '@/components/FileDrawerShell';

export const dynamic = 'force-dynamic';
export default async function DoPayBatchDrawer({ searchParams }: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireUserReady(['MAY']);
  const ids = doPaySelectionIds((await searchParams).jobId);
  const entries = await loadDoPayBatch(ids);
  if (!entries) notFound();
  const params = new URLSearchParams();
  ids.forEach(id => params.append('jobId', id));
  return <FileDrawerShell title="ยอดชำระค่าแลก D/O" fileName={`Invoice DO · ${entries.length} รายการ`}
    meta="กรอกยอดแยกตาม Job / BL" viewHref={`/may/do-pay/batch?${params}`} wide>
    <DoPayBatchPanel entries={entries} />
  </FileDrawerShell>;
}
