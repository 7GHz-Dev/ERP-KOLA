/**
 * คำร้อง E-Office: ตัวเลขคั่นหลักพัน · เรียน คุณ<ชื่อ> · เจ้าหน้าที่ในช่องซ้ายล่าง · ฝศ,สบศ ตามท่าเรือ
 *   npx tsx --tsconfig tsconfig.json tests/eoffice-officer.ts [ไฟล์ PDF ตัวอย่าง]
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { formatAmount, officerLine, routeLine, sectionForTerminal } from '../src/lib/eoffice-officer';
import { readForm } from '../src/lib/eoffice-form';
import { renderEofficeRequestPdf } from '../src/lib/eoffice-pdf';

async function main() {
  assert.equal(formatAmount('5311490'), '5,311,490');
  assert.equal(formatAmount('5,311,490'), '5,311,490');
  assert.equal(formatAmount(13360), '13,360');
  assert.equal(formatAmount('13360.5'), '13,360.5');
  assert.equal(formatAmount('4'), '4');
  assert.equal(formatAmount('ไม่ระบุ'), 'ไม่ระบุ');

  assert.equal(routeLine('เรียน คุณ', 'ฐานวีร์'), 'เรียน คุณฐานวีร์');
  assert.equal(routeLine('เรียน เรือตรี', 'ชุมพล'), 'เรียน เรือตรี ชุมพล');
  assert.equal(routeLine('เรียน คุณ', ''), 'เรียน คุณ');
  assert.equal(officerLine('นาย', 'ฐานวีร์', 'จิโรชอภิวรรธน์'), '(นายฐานวีร์ จิโรชอภิวรรธน์)');
  assert.equal(officerLine('นาย', '', 'x'), '');

  // ตามตารางฝ่ายที่ส่ง E ของด่าน
  assert.equal(sectionForTerminal({ code: '2835', name: 'A0' }), '3,1');
  assert.equal(sectionForTerminal({ code: '2812', name: 'B2' }), '1,1');
  assert.equal(sectionForTerminal({ code: '2820', name: 'C3' }), '1,1');
  assert.equal(sectionForTerminal({ code: '2836', name: 'C1C2' }), '2,1');
  assert.equal(sectionForTerminal({ code: '2840', name: 'D1' }), '2,1');
  assert.equal(sectionForTerminal({ code: 'D1D2', name: 'D1D2' }), '2,1');
  assert.equal(sectionForTerminal({ code: '2839', name: 'KERRY' }), '1,2');
  assert.equal(sectionForTerminal({ code: '2816', name: 'KERRY 2' }), '1,2');
  assert.equal(sectionForTerminal({ code: '2826', name: 'DG' }), '');
  assert.equal(sectionForTerminal({ code: '', name: 'เชียงแสน' }), 'เชียงแสน');
  assert.equal(sectionForTerminal({ code: '18', name: 'ท่า 18' }), '');
  console.log('✓ ตัวเลขคั่นหลักพัน · เรียน คุณ · เจ้าหน้าที่ · ฝศ,สบศ');

  const pdf = await renderEofficeRequestPdf({
    requestNo: '1069/0185', bookNo: '1069', runningNo: '0185', requestDate: '2026-10-28',
    entryNo: 'A0280691002378', packageCount: '4 UNITS', netWeight: '13,360 KGM', goodsValue: '5,311,490 JPY',
    goodsType: 'รถบรรทุกเก่าใช้แล้ว (รายละเอียดตามใบขนฯ แนบ)', attentionName: 'ฐานวีร์',
    officerPrefix: 'นาย', officerSurname: 'จิโรชอภิวรรธน์', officerPosition: 'นักวิชาการศุลกากรชำนาญการ', sectionCode: '2,1',
  }, readForm({ routeTo: 'เรียน คุณ' }));
  assert.equal(pdf.subarray(0, 5).toString('latin1'), '%PDF-');
  if (process.argv[2]) writeFileSync(process.argv[2], pdf);
  console.log('✓ วาดคำร้อง PDF ได้');
}

main().catch((e) => { console.error(e); process.exit(1); });
