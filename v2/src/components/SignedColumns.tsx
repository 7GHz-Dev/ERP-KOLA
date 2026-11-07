import { col } from '@/lib/columns';
import { FileChip, type Column } from '@/components/JobTable';
import { RequestEditButton, SendEofficeButton, UndoHandoverButton, UploadForm } from '@/components/ActionForms';
import { formatDateTime } from '@/lib/format';
import { listMaster } from '@/lib/queries/master';
import { isPartnerRelease } from '@/lib/job-types';
import { isShipmePartner, parseEmails } from '@/lib/partner-message';

/**
 * คอลัมน์ของขั้น Submit (Signed) E-office — อัปชุดปล่อยที่เซ็นแล้ว แล้วกดส่ง Partner
 *
 * ใช้สองที่: หน้า Submit (Signed) E-office Doc ของ Import Officer และแท็บ 5 ของหน้า Other cargo (Head Officer)
 * sent = แท็บที่ส่ง Partner ไปแล้ว (ล็อกไฟล์ ต้องขอแก้)
 */
export async function signedColumns(sent: boolean): Promise<Column[]> {
  const partnerRows = await listMaster('partners');
  /*
   * ช่องทางที่ผูกไว้กับ Partner ของแต่ละงาน (Master Data → Port Release Partner)
   * กดส่ง Partner แล้วชุดปล่อยที่เซ็นแล้วออกไปทางนี้ทันที — บอกไว้ในแถวให้รู้ก่อนกด
   */
  const channelsOf = (name: string | null) => {
    // SHIPME ส่งผ่าน ERP SHIPME (เชื่อมภายหลัง) — ยังไม่มีอะไรออกไปตอนกดส่ง
    if (isShipmePartner(name)) return [];
    const p = partnerRows.find((x) => x.name.trim().toUpperCase() === (name ?? '').trim().toUpperCase());
    return [
      parseEmails(p?.email).length ? 'Email' : null,
      p?.lineGroupId ? 'LINE' : null,
    ].filter((v): v is string => Boolean(v));
  };

  return [
    {
      // เวลาที่ PAINT กดส่งมอบคนเดินเอกสารที่แท็บ 4 — ใช้ดูว่าชุดไหนออกไปนานแล้วยังไม่กลับ
      label: 'ส่งมอบคนเดินเอกสาร', kind: 'wrap',
      render: (r) => (r.eofficeHandoverAt ? formatDateTime(r.eofficeHandoverAt) : '-'),
    },
    col.clientInCharge(), col.shipper(), col.blNo(), col.refNo(),
    col.declarationNo(), col.consignee(),
    {
      label: 'Port Release Partner', kind: 'wrap',
      render: (r) => {
        const channels = channelsOf(r.releasePartner);
        return (
          <span className="chip-row">
            <span>{r.releasePartner ?? '-'}</span>
            {isPartnerRelease(r.jobTypeCode) ? <span className="badge neutral">MUO</span> : null}
            {channels.map((c) => <span key={c} className="badge approved">{c}</span>)}
            {isShipmePartner(r.releasePartner) ? <span className="badge neutral">ERP SHIPME (เชื่อมภายหลัง)</span> : null}
          </span>
        );
      },
    },
    {
      // ชุดที่รวมไว้แล้ว เอาไว้ให้โหลดไปเดินพิธีการ
      label: 'ชุด E-Office รวม', kind: 'wrap', className: 'col-file',
      render: (r) => (
        <div className="file-cell">
          <FileChip file={r.currentFiles?.EOFFICE_MERGED} />
        </div>
      ),
    },
    {
      label: 'ชุดปล่อย (เซ็นแล้ว)', kind: 'wrap', className: 'col-file',
      render: (r) => {
        const file = r.currentFiles?.EOFFICE_SIGNED;
        return (
          <div className="file-cell">
            <FileChip file={file} />
            {/* ส่ง Partner แล้วล็อกไฟล์ไว้ ต้องขออนุมัติก่อนจึงแก้ได้ */}
            {sent || file ? null : (
              <UploadForm jobId={r.id} category="EOFFICE_SIGNED" label="อัปโหลด" />
            )}
          </div>
        );
      },
    },
    {
      label: 'จัดการ', kind: 'actions',
      // ส่งแล้วแก้เองไม่ได้ ต้องขออนุมัติก่อน · ยังไม่ส่งและมีไฟล์แล้วจึงกดส่งได้
      render: (r) =>
        (sent
          ? <RequestEditButton jobId={r.id} />
          : r.currentFiles?.EOFFICE_SIGNED
            ? <SendEofficeButton jobId={r.id} ready partner={r.releasePartner} channels={channelsOf(r.releasePartner)} />
            : r.eofficeHandoverAt
              ? <UndoHandoverButton jobId={r.id} />
              : null),
    },
  ];
}
