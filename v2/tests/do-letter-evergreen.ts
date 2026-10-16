import assert from 'node:assert/strict';
import * as pdfLib from '@cantoo/pdf-lib';
import {
  DO_LETTER_FIELDS, EVERGREEN_BLOCKS, LETTER_BLOCKS, blocksFor, fieldsFor, matchShippingLine,
  type DoLetterForm,
} from '../src/lib/do-letter';
import { renderDoLetterPdf } from '../src/lib/do-letter-pdf';
import {
  amountText, blChoice, depositTotal, slashDate, thaiLetterDate,
} from '../src/lib/do-letter-evergreen';

/** แบบฟอร์มที่ใช้แต่ค่าตั้งต้นในโค้ด — ไม่ต้องต่อฐานข้อมูล */
function defaultForm(): DoLetterForm {
  const fallback = new Map(DO_LETTER_FIELDS.map((f) => [f.key, f.fallback]));
  return {
    raw: () => '',
    value: (k) => fallback.get(k) ?? '',
    coValue: (co, k) => fallback.get(`co${co}.${k}`) ?? '',
    attentionCompany: () => '',
    block: (k) => {
      const b = [...LETTER_BLOCKS, ...EVERGREEN_BLOCKS].find((x) => x.key === k)!;
      return { ...b, gap: b.gap ?? 21 };
    },
  };
}

async function main() {
  assert.equal(matchShippingLine('EVERGREEN LINE'), 'EVERGREEN');
  assert.equal(matchShippingLine('EVERGREEN'), 'EVERGREEN');

  assert.equal(thaiLetterDate('2026-10-01'), 'วันที่ 1 เดือน ตุลาคม พ.ศ. 2569');
  assert.equal(slashDate('2026-10-01'), '01/10/2026');
  // ข้อความวันที่ที่ผู้ใช้พิมพ์เองคืนตามเดิม
  assert.equal(slashDate('1 OCTOBER 2026'), '1 OCTOBER 2026');

  assert.equal(blChoice('SWB'), 'SEAWAY');
  assert.equal(blChoice('S'), 'SURRENDER');
  assert.equal(blChoice('Surrendered'), 'SURRENDER');
  assert.equal(blChoice('OBL'), null);
  assert.equal(blChoice(null), null);

  const base = {
    shippingLine: 'EVERGREEN', blNo: 'EGLV300600019781', vessel: 'EVER LUCKY', voyage: '0012-084E',
    eta: '2026-10-01', portName: null, originName: null, blType: 'SWB',
  };
  const pages = async (data: Parameters<typeof renderDoLetterPdf>[0]) =>
    (await pdfLib.PDFDocument.load(await renderDoLetterPdf(data, defaultForm()))).getPageCount();

  // จดหมาย KOLA + MAESOT FREEZONE + ยืนยันค่ามัดจำ + ใบลากตู้ 4 แผ่น (เลขตู้ครบในแผ่นเดียว)
  assert.equal(await pages({ ...base, containers: ['TRHU6287406'] }), 7);
  assert.equal(await pages({ ...base, containers: ['TRHU6287406', 'TCLU1122336', 'SEGU9025014'] }), 7);
  // ยังไม่มีเลขตู้ก็ยังออกใบลากตู้ให้เขียนมือ
  assert.equal(await pages({ ...base, containers: [] }), 7);
  // ตู้เยอะก็ยังเป็น 7 หน้า
  const many = Array.from({ length: 24 }, (_, i) => `EGHU${String(1000000 + i)}`);
  assert.equal(await pages({ ...base, containers: many }), 7);

  // ค่ามัดจำ = ต่อตู้ × จำนวนตู้ · ไม่ได้ตั้งใช้ 8,000
  assert.equal(depositTotal('', 3), 24000);
  assert.equal(depositTotal('9,500', 2), 19000);
  assert.equal(depositTotal('abc', 1), 8000);
  // ยังไม่มีเลขตู้ใช้ยอดที่บันทึกไว้กับงาน ไม่มีก็เว้นว่างให้เขียนมือ
  assert.equal(depositTotal('8000', 0, '16000'), 16000);
  assert.equal(depositTotal('8000', 0, null), null);
  assert.equal(amountText(24000), '24,000');

  // แท็บ EVERGREEN มีชุดช่องและตำแหน่งของตัวเอง ไม่ปนกับจดหมายโครงกลาง
  assert.ok(blocksFor('EVERGREEN').every((b) => b.key.startsWith('eg.')));
  assert.ok(blocksFor('WAN HAI').every((b) => !b.key.startsWith('eg.')));
  assert.ok(fieldsFor('EVERGREEN').some((f) => f.key === 'eg.depositPerContainer'));
  assert.ok(!fieldsFor('EVERGREEN').some((f) => f.key === 'subject'));
  assert.ok(!fieldsFor('').some((f) => f.key === 'eg.depositPerContainer'));
  // สายอื่นยังเป็นจดหมายสองใบเหมือนเดิม
  assert.equal(await pages({ ...base, shippingLine: 'WAN HAI' }), 2);

  console.log('do-letter-evergreen ok');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
