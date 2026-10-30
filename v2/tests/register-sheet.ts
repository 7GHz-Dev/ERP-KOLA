/**
 * ทะเบียนงานแบบตารางเดิม · สีแถว · งาน MUO · ข้อความส่งชุดปล่อยให้ Partner — ตรรกะล้วน
 *   npm run test:register
 */
import assert from 'node:assert/strict';
import { isByTruck, isPartnerRelease } from '../src/lib/job-types';
import { isShipmePartner, partnerLineMessage, partnerMail, parseEmails } from '../src/lib/partner-message';
import { SHEET_COLUMNS, sheetCells, sheetRowClass, type SheetSource } from '../src/lib/register-sheet';
import { TEMPLATE_COLUMNS } from '../src/lib/template-columns';

/* ---------- หัวคอลัมน์ตามตารางเดิม ---------- */

// ลำดับเดียวกับไฟล์ export/import (ยกเว้น K · O ที่ไม่แสดง · REF -> REF NO · REMARK -> DECLARATION NO. + STATUS ท้ายตาราง)
const renamed: Record<string, string> = { REF: 'REF NO', REMARK: 'DECLARATION NO.' };
const fromTemplate = TEMPLATE_COLUMNS.filter((c) => c !== 'K' && c !== 'O').map((c) => renamed[c] ?? c);
assert.deepEqual([...SHEET_COLUMNS], [...fromTemplate, 'STATUS'], 'คอลัมน์ตามตาราง Excel ของทีม');

/* ---------- ค่าในช่อง ---------- */

const base: SheetSource = {
  personName: 'FAISAL', eta: '2026-01-03', jobTypeName: 'MSFZ - USED CAR', jobTypeShort: 'MSFZ - รถยนต์เก่า',
  jobTypeCode: 'MU', currentFiles: { INVOICE_GOODS: { id: 'F1', fileName: 'inv.pdf' } }, surrenderStatus: 'CLEARED',
  transportDate: '2026-01-08', shipperName: 'AE TRADING COMPANY', containerCount: 2, blNo: 'OOLU2315365610',
  containerNos: 'TLLU6866880,TEMU6284893', unitAmount: '17.000', grossWeight: '24610.000', shipline: 'OOCL',
  vessel: 'GSL MAREN', voyage: '023S', terminalName: 'C1C2', draftRefNo: 'QNEX423503',
  declarationNo: 'A0030690102077', consigneeName: 'MAESOT FREEZONE CO.,LTD.',
  consigneeShort: 'MSFZ', notifyName: 'KOLA SHIPPING CO.,LTD.', notifyShort: 'KOLA',
  demDays: 5, detDays: 14, status: 'DO_SENT',
};

const kola = sheetCells(base);
assert.equal(kola.CUSTOMER, 'FAISAL');
assert.equal(kola.ETA, '03/01/2026');
assert.equal(kola['ประเภท'], 'MSFZ - รถยนต์เก่า', 'ใช้ชื่อย่อของ Job Type');
assert.equal(kola['INV.'], 'Y');
assert.equal(kola.SUR, 'เคลียร์แล้ว', 'SUR = สถานะ Surrender');
assert.equal(kola.TRANSPORT, '08/01/2026');
assert.equal(kola['AT-MAESOT'], '-', 'ยังไม่เก็บข้อมูล');
assert.equal(kola.OPEN, '-');
assert.equal(kola.CON, '2');
assert.equal(kola['CONTAINER NO.'], 'TLLU6866880, TEMU6284893');
assert.equal(kola.UNIT, '17');
assert.equal(kola.WEIGHT, '24,610');
assert.equal(kola.VESSEL, 'GSL MAREN V.023S');
assert.equal(kola.PORT, 'C1C2');
assert.equal(kola['REF NO'], 'QNEX423503');
assert.equal(kola['DECLARATION NO.'], 'A0030690102077');
assert.equal(kola.CONSIGNEE, 'MSFZ');
assert.equal(kola.NOTIFY, 'KOLA');
// ตัวอย่างจากตารางจริง: ETA 3/1 + DEM 5 = 8/1 · TRANSPORT 8/1 + DET 14 = 22/1
assert.equal(kola.DEM, '5');
assert.equal(kola['DEM DATE'], '08/01/2026');
assert.equal(kola.DET, '14');
assert.equal(kola['DET DATE'], '22/01/2026');
assert.notEqual(kola.STATUS, 'DO_SENT', 'สถานะเป็นคำอธิบาย ไม่ใช่รหัส');

const partner = sheetCells({
  ...base, jobTypeShort: null, jobTypeName: 'MSFZ - USED CAR OTHER SHIPPINGS', jobTypeCode: 'MUO',
  currentFiles: null, declarationNo: null, surrenderStatus: 'PENDING', notifyShort: null,
  notifyName: 'KMW GROUP SHIPMENT (THAILAND) CO.,LTD.', demDays: 0, detDays: 0, transportDate: null,
  containerNos: null, containerCount: 0,
});
assert.equal(partner['ประเภท'], 'MSFZ - USED CAR OTHER SHIPPINGS', 'ไม่มีชื่อย่อ = ชื่อเต็ม');
assert.equal(partner['INV.'], '-');
assert.equal(partner['DECLARATION NO.'], '-', 'ยังไม่มีเลขใบขน');
assert.equal(partner.SUR, 'รอตรวจ', 'ยังไม่ได้ตรวจ Surrender');
assert.equal(partner.NOTIFY, 'KMW GROUP SHIPMENT (THAILAND) CO.,LTD.');
assert.equal(partner.DEM, '-');
assert.equal(partner['DEM DATE'], '-');
assert.equal(partner['DET DATE'], '-');
assert.equal(partner.TRANSPORT, '-');
assert.equal(partner.CON, '-');
assert.equal(partner['CONTAINER NO.'], '-');

/* ---------- สีแถว / งาน MUO ---------- */

assert.equal(sheetRowClass({ jobTypeCode: 'MU', shipline: 'OOCL', vessel: 'GSL MAREN' }), 'row-kola');
assert.equal(sheetRowClass({ jobTypeCode: 'MUO', shipline: 'ONE', vessel: 'AS CARLOTTA' }), 'row-muo');
assert.equal(sheetRowClass({ jobTypeCode: 'MU', shipline: 'BY TRUCK', vessel: 'BY TRUCK' }), 'row-truck');
assert.equal(sheetRowClass({ jobTypeCode: 'MUO', shipline: 'BY TRUCK', vessel: null }), 'row-muo', 'MUO มาก่อนขนทางรถ');
assert.equal(isPartnerRelease(' muo '), true);
assert.equal(isPartnerRelease('MU'), false);
assert.equal(isPartnerRelease(null), false);
assert.equal(isByTruck(null, 'by  truck'), true);
assert.equal(isByTruck('TRUCKING CO', null), false);

/* ---------- ช่องทางแจ้ง Partner ---------- */

assert.deepEqual(parseEmails('Ops@KMW.com, docs@kmw.com;ops@kmw.com\nbad-address  x@y.co'),
  ['ops@kmw.com', 'docs@kmw.com', 'x@y.co'], 'คั่นได้หลายแบบ · ตัดซ้ำ · ทิ้งตัวที่ไม่ใช่อีเมล');
assert.deepEqual(parseEmails(null), []);
assert.equal(isShipmePartner('SHIPME LOGISTICS CO.,LTD.'), true, 'SHIPME = Partner พื้นฐาน ช่องทางคือ ERP SHIPME');
assert.equal(isShipmePartner('KMW GROUP SHIPMENT (THAILAND) CO.,LTD.'), false);

const job = {
  jobNo: 'MU2026010001', blNo: 'KG1222025-50617(ONEYTYOFM5232700)', declarationNo: 'A0050690119913',
  consigneeName: 'MAESOT FREEZONE CO.,LTD.', vessel: 'AS CARLOTTA V.522S',
  containerNos: ['TLLU5471904', 'FFAU1477881'],
};
const mail = partnerMail(job);
assert.match(mail.subject, /KG1222025-50617/);
assert.match(mail.text, /A0050690119913/);
assert.match(mail.text, /TLLU5471904, FFAU1477881/);
const line = partnerLineMessage(job, 'https://example.test/file', 7);
assert.match(line, /https:\/\/example\.test\/file/);
assert.match(line, /7 วัน/);
assert.match(partnerLineMessage(job, null, 7), /ติดต่อ KOLA/, 'สร้างลิงก์ไม่ได้ก็ยังส่งข้อความได้');
assert.ok(!partnerMail({ ...job, declarationNo: null }).text.includes('Declaration'), 'ไม่มีเลขใบขนไม่ต้องมีบรรทัดนั้น');

console.log('register-sheet: ผ่านทั้งหมด');
