import assert from 'node:assert/strict';
import {
  blKey, decodeCsv, readSheet, sheetDate, sheetNumber,
  splitBlNo, splitContainers, splitCsvLine, splitVessel, toDrafts,
} from '../src/lib/shipment-import';
import { candidateNumbers, matchBl, type BlChoice } from '../src/lib/match-bl';
import { TEMPLATE_COLUMNS } from '../src/lib/template-columns';

/**
 * ตรวจการอ่านไฟล์ตารางงานและการจับคู่ไฟล์ AN/BL กับ BL ในระบบ
 *
 * ใช้ข้อมูลจริงจากไฟล์ที่ผู้ใช้ส่งมา ไม่ใช่ข้อมูลที่แต่งขึ้น
 * เพราะจุดที่พลาดง่ายคือรายละเอียดของไฟล์จริง — คอลัมน์ลำดับแถวที่นำหน้ามา
 * ตัวเลขที่มีลูกน้ำ วันที่แบบ d/m/yy และเลข BL ที่มีเลข Waybill อยู่ในวงเล็บ
 */

/** แถวจริงจากไฟล์ของผู้ใช้ — ไม่มีหัวคอลัมน์ มีเลขลำดับแถวนำหน้า */
const REAL = [
  '1834,AMIN JP,22/9/26,MSFZ - รถยนต์เก่า,Y,S,,,,FUJI STAR,1,KG1222026-70107(ONEYTYOGF5133300),ONEU5972378,4,"17,145",KNOT GOLBAL,BANGKOK BRIDGE V.0518W,,5527,,MSFZ,KOLA,1,-,,,,,,',
  '1835,SALIM,22/9/26,MSFZ - รถยนต์เก่า,Y,,,,,ANISA TRADING,1,KG1222026-69979(ONEYTYOGF5134400),TRHU5857910,3,"12,920",KNOT GOLBAL,BANGKOK BRIDGE V.0518W,,5532,,MSFZ,KOLA,1,-,,,,,,',
  '1837,R NO,22/9/26,MSFZ - รถยนต์เก่า,Y,S,,,,JAPAN BRIDGE TRADING,1,KG0832026-70357(ONEYTYOGF9271300),ONEU5543748,4,"5,692",KNOT GOLBAL,BANGKOK BRIDGE V.0518W,,,,MSFZ,KOLA,1,-,,,,,,',
].join('\n');

function sheetTests() {
  /* ---- แยกช่อง CSV ---- */
  assert.deepEqual(splitCsvLine('a,"b,c",d'), ['a', 'b,c', 'd']);
  assert.deepEqual(splitCsvLine('a,"he said ""hi""",b'), ['a', 'he said "hi"', 'b']);

  /* ---- ไฟล์ที่ไม่มีหัวคอลัมน์ ---- */
  const { rows, hasHeader } = readSheet(REAL);
  assert.equal(hasHeader, false, 'ไฟล์ของผู้ใช้ไม่มีหัวคอลัมน์');
  assert.equal(rows.length, 3);

  // เลขลำดับแถว 1834 ต้องถูกตัดทิ้ง ไม่ใช่เลื่อนไปเป็น CUSTOMER
  assert.equal(rows[0].cell.CUSTOMER, 'AMIN JP');
  assert.equal(rows[0].cell.SHIPPER, 'FUJI STAR');
  assert.equal(rows[0].cell['BILL OF LADING'], 'KG1222026-70107(ONEYTYOGF5133300)');
  assert.equal(rows[0].cell['CONTAINER NO.'], 'ONEU5972378');
  assert.equal(rows[0].cell.WEIGHT, '17,145');
  assert.equal(rows[0].cell.VESSEL, 'BANGKOK BRIDGE V.0518W');
  assert.equal(rows[0].cell.CONSIGNEE, 'MSFZ');
  assert.equal(rows[0].cell.NOTIFY, 'KOLA');
  assert.equal(rows[0].cell['ประเภท'], 'MSFZ - รถยนต์เก่า');
  // เลขบรรทัดต้องเป็นบรรทัดจริงในไฟล์ ไม่ใช่ลำดับหลังกรอง
  assert.equal(rows[2].lineNo, 3);

  /* ---- ไฟล์ที่มีหัวคอลัมน์ (ไฟล์ที่ระบบ export ออกไป) ---- */
  const withHead = readSheet([
    TEMPLATE_COLUMNS.join(','),
    'AMIN JP,22/9/26,MSFZ - รถยนต์เก่า,Y,S,,,,FUJI STAR,1,KG1222026-70107,ONEU5972378,4,"17,145",KNOT,BANGKOK BRIDGE V.0518W,,5527,,MSFZ,KOLA,,,5,,3,',
  ].join('\n'));
  assert.equal(withHead.hasHeader, true);
  assert.equal(withHead.rows[0].cell.SHIPPER, 'FUJI STAR');
  assert.equal(withHead.rows[0].cell.DEM, '5');
  assert.equal(withHead.rows[0].cell.DET, '3');
  // แถวแรกหลังหัวคอลัมน์คือบรรทัดที่ 2 ของไฟล์
  assert.equal(withHead.rows[0].lineNo, 2);

  /* ---- หัวคอลัมน์ที่สลับลำดับ ต้องจับตามชื่อ ไม่ใช่ตามตำแหน่ง ---- */
  const swapped = readSheet('SHIPPER,BILL OF LADING,ETA\nFUJI STAR,KG-1,22/9/26');
  assert.equal(swapped.hasHeader, false, 'หัวคอลัมน์ 3 ช่องยังไม่พอให้ถือว่าเป็นหัวตาราง');

  /* ---- ค่าที่มีขึ้นบรรทัดใหม่ในเครื่องหมายคำพูด ---- */
  const multi = readSheet('1,A,22/9/26,T,,,,,,S,1,BL-1,CU1,1,1,L,V V.1,,,"หมายเหตุ\nบรรทัดสอง",MSFZ,KOLA,,,,,,');
  assert.equal(multi.rows.length, 1, 'ค่าหลายบรรทัดต้องไม่ถูกตัดเป็นสองแถว');
  assert.equal(multi.rows[0].cell.REMARK, 'หมายเหตุ\nบรรทัดสอง');

  console.log('PASS: อ่านไฟล์ตาราง — ตัดเลขลำดับแถว จับหัวคอลัมน์ และค่าหลายบรรทัด');
}

function valueTests() {
  /* ---- วันที่แบบ d/m/yy ตามที่ทีมเขียน ---- */
  assert.equal(sheetDate('22/9/26'), '2026-09-22');
  assert.equal(sheetDate('7/9/26'), '2026-09-07');
  // ยึด d/m/y ไม่ใช่ m/d/y แบบอเมริกัน
  assert.equal(sheetDate('3/12/26'), '2026-12-03');
  assert.equal(sheetDate('2026-09-22'), '2026-09-22');
  // ปี พ.ศ. ที่หลุดมา แปลงกลับเป็น ค.ศ.
  assert.equal(sheetDate('22/9/2569'), '2026-09-22');
  assert.equal(sheetDate(''), null);
  assert.equal(sheetDate('-'), null);
  assert.equal(sheetDate('22/13/26'), null, 'เดือน 13 ต้องไม่ผ่าน');

  /* ---- ตัวเลขที่มีลูกน้ำคั่นหลักพัน ---- */
  assert.equal(sheetNumber('17,145'), '17145');
  assert.equal(sheetNumber('4'), '4');
  assert.equal(sheetNumber('-'), null);
  assert.equal(sheetNumber(''), null);

  /* ---- ชื่อเรือกับเที่ยวเรือที่เขียนรวมกัน ---- */
  assert.deepEqual(splitVessel('BANGKOK BRIDGE V.0518W'), { vessel: 'BANGKOK BRIDGE', voyage: '0518W' });
  assert.deepEqual(splitVessel('SHUN LONG'), { vessel: 'SHUN LONG', voyage: '' });
  // ไม่มีตัวคั่น ต้องไม่เดาว่าคำท้ายคือเที่ยวเรือ
  assert.deepEqual(splitVessel('MAERSK NAMSOS 620S'), { vessel: 'MAERSK NAMSOS 620S', voyage: '' });

  /* ---- เลขตู้หลายตู้ในช่องเดียว ---- */
  assert.deepEqual(splitContainers('ONEU5972378'), ['ONEU5972378']);
  assert.deepEqual(splitContainers('AAAU1,BBBU2'), ['AAAU1', 'BBBU2']);
  // ช่องว่างที่แทรกกลางเลขตู้จากการแก้มือ
  assert.deepEqual(splitContainers('ONEU 5972378'), ['ONEU5972378']);
  assert.deepEqual(splitContainers(''), []);

  /* ---- เลข BL ที่มีเลข Waybill อยู่ในวงเล็บ ---- */
  assert.deepEqual(splitBlNo('KG1222026-70107(ONEYTYOGF5133300)'), {
    blNo: 'KG1222026-70107(ONEYTYOGF5133300)',
    waybillNo: 'ONEYTYOGF5133300',
  });
  // ไม่มีวงเล็บก็ใช้ทั้งก้อนเป็นเลข BL
  assert.deepEqual(splitBlNo('AMP0548880'), { blNo: 'AMP0548880', waybillNo: '' });

  console.log('PASS: แปลงค่าในช่อง — วันที่ ตัวเลข ชื่อเรือ เลขตู้ และเลข BL');
}

function draftTests() {
  const { rows } = readSheet(REAL);
  const { drafts, skipped } = toDrafts(rows);
  assert.equal(drafts.length, 3);
  assert.equal(skipped, 0);

  const first = drafts[0];
  assert.equal(first.blNo, 'KG1222026-70107(ONEYTYOGF5133300)', 'เก็บทั้งก้อนเป็น BL No. ตามที่ทีมใช้');
  assert.equal(first.waybillNo, 'ONEYTYOGF5133300', 'แยกเลข Waybill ไว้จับคู่ไฟล์ทีหลัง');
  assert.equal(first.vessel, 'BANGKOK BRIDGE');
  assert.equal(first.voyage, '0518W');
  assert.equal(first.eta, '2026-09-22');
  assert.equal(first.grossWeight, '17145');
  assert.equal(first.unitAmount, '4');
  assert.deepEqual(first.containers, ['ONEU5972378']);
  assert.equal(first.draftRefNo, '5527');
  assert.equal(first.names.shipper, 'FUJI STAR');
  assert.equal(first.names.consignee, 'MSFZ');
  assert.equal(first.names.notify, 'KOLA');
  assert.equal(first.names.person, 'AMIN JP');
  assert.equal(first.names.jobType, 'MSFZ - รถยนต์เก่า');
  // แถวนี้ช่อง REF ว่าง ต้องไม่ไปหยิบค่าจากช่องข้างเคียง
  assert.equal(drafts[2].draftRefNo, '');

  /* ---- บรรทัดว่างและบรรทัดรวมยอดท้ายตาราง ---- */
  const tail = toDrafts(readSheet([REAL, '9999,,,,,,,,,,,,,,,,,,,,,,,,,,,,,', '9998,,,,,,,,,,,,,ยอดรวม,"30,065",,,,,,,,,,,,,,,'].join('\n')).rows);
  assert.equal(tail.drafts.length, 3, 'บรรทัดที่ไม่มีทั้งเลข BL และชื่อเรือต้องถูกข้าม');
  assert.equal(tail.skipped, 2);

  console.log('PASS: แปลงแถวเป็นงาน — ค่าครบตามไฟล์จริง และข้ามบรรทัดรวมยอด');
}

function matchTests() {
  const choices: BlChoice[] = [
    { id: 'BL-1', jobId: 'J1', jobNo: 'KOLA-2026-0001', blNo: 'KG1222026-70107(ONEYTYOGF5133300)', vessel: 'BANGKOK BRIDGE', eta: '2026-09-22', shipperName: 'FUJI STAR', hasFile: false },
    { id: 'BL-2', jobId: 'J2', jobNo: 'KOLA-2026-0002', blNo: 'KG1222026-69979(ONEYTYOGF5134400)', vessel: 'BANGKOK BRIDGE', eta: '2026-09-22', shipperName: 'ANISA TRADING', hasFile: false },
    { id: 'BL-3', jobId: 'J3', jobNo: 'KOLA-2026-0003', blNo: 'AMP0548880', vessel: 'SHUN LONG', eta: '2026-09-07', shipperName: 'ALI', hasFile: true },
  ];

  /* ---- จับจากเลข Waybill ที่พิมพ์อยู่บนไฟล์ของสายเรือ ---- */
  const byWaybill = matchBl(['ONEYTYOGF5133300'], choices);
  assert.equal(byWaybill?.choice.id, 'BL-1');
  assert.equal(byWaybill?.by, 'waybill', 'ต้องบอกได้ว่าจับจากเลข Waybill');

  /* ---- จับจากเลข BL ของตัวแทนที่อยู่หน้าวงเล็บ ---- */
  const byBl = matchBl(['KG1222026-69979'], choices);
  assert.equal(byBl?.choice.id, 'BL-2');
  assert.equal(byBl?.by, 'blNo');

  /* ---- เลขที่เขียนต่างกันแต่เป็นเลขเดียวกัน ---- */
  assert.equal(matchBl(['ONEY TYOGF 5133300'], choices)?.choice.id, 'BL-1', 'ช่องว่างที่ pdf.js แทรกต้องไม่ทำให้จับไม่ได้');
  assert.equal(matchBl(['kg1222026 70107'], choices)?.choice.id, 'BL-1');

  /* ---- ไฟล์ที่ไม่ตรงกับใบไหน ต้องคืน null ให้คนเลือกเอง ---- */
  assert.equal(matchBl(['ZZZZ9999999'], choices), null);
  assert.equal(matchBl([''], choices), null);
  assert.equal(matchBl(['123'], choices), null, 'เลขสั้นเกินไปต้องไม่เดา');

  /* ---- เลขเดียวกันอยู่สองงาน ถือว่าไม่ชัดพอ ---- */
  const ambiguous: BlChoice[] = [
    ...choices,
    { id: 'BL-4', jobId: 'J4', jobNo: 'KOLA-2026-0004', blNo: 'AMP0548880', vessel: 'X', eta: null, shipperName: null, hasFile: false },
  ];
  assert.equal(matchBl(['AMP0548880'], ambiguous), null, 'เลขซ้ำสองงานต้องให้คนเลือกเอง');

  /* ---- ลองทีละเลขตามลำดับ เลขแรกไม่เจอต้องลองเลขถัดไป ---- */
  const ordered = matchBl(['NOTFOUND1234', 'ONEYTYOGF5134400'], choices);
  assert.equal(ordered?.choice.id, 'BL-2');

  /* ---- เลขที่ควรลองใช้จับคู่ จากผลอ่านไฟล์ ---- */
  const nums = candidateNumbers(
    { blNo: 'ONEYTYOGF5133300' },
    'ARRIVAL NOTICE WAYBILL NUMBER ONEYTYOGF5133300 CONTAINER ONEU5972378',
  );
  assert.equal(nums[0], 'ONEYTYOGF5133300', 'เลขจากช่องที่ระบุชัดต้องมาก่อน');
  assert.ok(nums.includes('ONEU5972378'), 'เลขอื่นในหน้าเก็บไว้เป็นตัวสำรอง');

  /* ---- เลขที่เทียบกันแล้วเหมือนกัน ---- */
  assert.equal(blKey('KG1222026-70107'), 'KG122202670107');
  assert.equal(blKey('kg1222026 70107'), 'KG122202670107');

  console.log('PASS: จับคู่ไฟล์กับ BL — ทั้งเลข BL และเลข Waybill และไม่เดาเมื่อกำกวม');
}

function decodeTests() {
  /* ---- UTF-8 ที่มี BOM (Excel บันทึกแบบ UTF-8) ---- */
  const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('รถยนต์เก่า')]);
  assert.equal(decodeCsv(bom), 'รถยนต์เก่า');

  /* ---- UTF-8 ธรรมดา ---- */
  assert.equal(decodeCsv(new TextEncoder().encode('FUJI STAR')), 'FUJI STAR');

  /*
   * Windows-874 ที่ Excel ภาษาไทยบันทึกออกมา
   * ไบต์ 0xC3 0xB6 0xC2 ในรหัสนี้คือ "รถย" ถ้าอ่านเป็น UTF-8 จะได้ตัวยึกยือ
   */
  const cp874 = new Uint8Array([0xc3, 0xb6, 0xc2]);
  assert.equal(decodeCsv(cp874), 'รถย', 'ไฟล์ Windows-874 ต้องถอดรหัสให้ถูก');

  console.log('PASS: ถอดรหัสไฟล์ — UTF-8 มี/ไม่มี BOM และ Windows-874 จาก Excel ภาษาไทย');
}

sheetTests();
valueTests();
draftTests();
matchTests();
decodeTests();
console.log('\nทั้งหมดผ่าน');
