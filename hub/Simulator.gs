/**
 * ตัวแทนโปรแกรม Python ชั่วคราว
 *
 * ปุ่ม "เริ่มสร้าง" บนหน้าเว็บ Hub เรียกฟังก์ชันในไฟล์นี้ เพื่อให้ทดสอบ flow ทั้งเส้นได้
 * ก่อนที่โปรแกรม automate ตัวจริงจะพร้อม
 *
 * เมื่อ Python พร้อมแล้วให้เลิกใช้ปุ่มนี้ แล้วให้ worker เรียก claimNext/completeTask ผ่าน API แทน
 * ผลลัพธ์ที่ได้อยู่ในรูปแบบเดียวกันทั้งสองทาง ฝั่ง ERP จึงไม่ต้องแก้อะไร
 */

/** เรียกจากหน้าเว็บ Hub ผ่าน google.script.run */
function hubStartTask(taskId) {
  var task = hubFindById_(HUB_CONFIG.SHEETS.TASKS, hubText_(taskId, 80));
  hubAssert_(task, 'NOT_FOUND', 'ไม่พบงาน');
  hubAssert_(task.status === HUB_CONFIG.STATUS.QUEUED || task.status === HUB_CONFIG.STATUS.ERROR,
    'INVALID_STATE', 'งานนี้ไม่ได้อยู่ในสถานะที่เริ่มได้ (' + task.status + ')');

  hubUpdate_(HUB_CONFIG.SHEETS.TASKS, task.id, {
    status: HUB_CONFIG.STATUS.PROCESSING,
    claimedBy: 'simulator',
    claimedAt: hubNow_(),
    attempts: hubNumber_(task.attempts, 0) + 1,
    updatedAt: hubNow_()
  });
  hubLog_(task.id, 'simulator', 'CLAIM', { type: task.type });

  try {
    if (task.type === HUB_CONFIG.TASK_TYPES.DRAFT_ENTRY) {
      return hubCompleteTask({ taskId: task.id, refNo: hubMockRefNo_(), worker: 'simulator' });
    }
    return hubCompleteCustoms_(task);
  } catch (error) {
    var message = String(error && error.message ? error.message : error);
    hubFailTask({ taskId: task.id, error: message, worker: 'simulator' });
    throw error;
  }
}

function hubCompleteCustoms_(task) {
  var data = {};
  try {
    data = JSON.parse(task.payload || '{}');
  } catch (ignore) {
    data = {};
  }
  var entryNo = hubMockEntryNo_();
  var pdf = Utilities
    .newBlob(hubMockEntryHtml_(task, data, entryNo), MimeType.HTML, 'entry.html')
    .getAs(MimeType.PDF);
  return hubCompleteTask({
    taskId: task.id,
    entryNo: entryNo,
    worker: 'simulator',
    file: {
      name: entryNo + '.pdf',
      mimeType: 'application/pdf',
      base64: Utilities.base64Encode(pdf.getBytes())
    }
  });
}

/** เลข Ref No. รูปแบบเดียวกับที่ระบบจริงคืนมา เช่น QELS100015338 */
function hubMockRefNo_() {
  return 'QELS' + hubRunningNumber_('REF', 9);
}

/** เลขใบขนสินค้าขาเข้า เช่น A0180690802150 */
function hubMockEntryNo_() {
  return 'A' + hubRunningNumber_('ENTRY', 13);
}

function hubRunningNumber_(key, width) {
  var props = hubProps_();
  var propKey = 'HUB_SEQ_' + key;
  var next = hubNumber_(props.getProperty(propKey), 0) + 1;
  props.setProperty(propKey, String(next));
  var text = String(next);
  var stamp = Utilities.formatDate(new Date(), HUB_CONFIG.TIME_ZONE, 'yyMMdd');
  var body = stamp + text;
  while (body.length < width) body = body + '0';
  return body.slice(0, width);
}

function hubMockEntryHtml_(task, data, entryNo) {
  var esc = function (v) {
    return String(v === null || v === undefined ? '' : v)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  };
  return '<!DOCTYPE html><html><head><meta charset="utf-8"><style>' +
    '@page { size: A4; margin: 14mm; }' +
    'body { font-family: "TH Sarabun New","Sarabun",Tahoma,sans-serif; font-size: 13pt; }' +
    'h1 { font-size: 15pt; text-align: center; margin: 0 0 4pt; }' +
    '.sub { text-align: center; font-size: 11pt; color: #444; margin-bottom: 14pt; }' +
    'table { width: 100%; border-collapse: collapse; }' +
    'th, td { border: 1px solid #000; padding: 5pt 7pt; font-size: 12pt; text-align: left; }' +
    'th { width: 34%; background: #eee; }' +
    '.note { margin-top: 18pt; font-size: 11pt; color: #a00; text-align: center; }' +
    '</style></head><body>' +
    '<h1>ใบขนสินค้าขาเข้าพร้อมแบบแสดงรายการภาษีสรรพสามิตและภาษีมูลค่าเพิ่ม</h1>' +
    '<p class="sub">MOCK UP — เอกสารจำลองสำหรับทดสอบระบบ</p>' +
    '<table>' +
    '<tr><th>เลขที่ใบขนสินค้า</th><td>' + esc(entryNo) + '</td></tr>' +
    '<tr><th>เลขที่ใบขนบาน (Ref No.)</th><td>' + esc(data.refNo) + '</td></tr>' +
    '<tr><th>Job No.</th><td>' + esc(task.jobNo) + '</td></tr>' +
    '<tr><th>B/L No.</th><td>' + esc(data.blNo) + '</td></tr>' +
    '<tr><th>ผู้นำของเข้า</th><td>บริษัท แม่สอด ฟรีโซน จำกัด</td></tr>' +
    '<tr><th>ประเภทใบขน</th><td>610 ใบขนสินค้าขาเข้า เขตปลอดอากร</td></tr>' +
    '<tr><th>วันที่ออกเอกสาร</th><td>' + esc(Utilities.formatDate(new Date(), HUB_CONFIG.TIME_ZONE, 'dd/MM/yyyy HH:mm')) + '</td></tr>' +
    '</table>' +
    '<p class="note">เอกสารนี้สร้างโดยปุ่มจำลองบน Automation Hub<br>' +
    'เมื่อโปรแกรม Python ตัวจริงพร้อมใช้งาน ไฟล์นี้จะถูกแทนที่ด้วยใบขนจริง</p>' +
    '</body></html>';
}

/** ข้อมูลสำหรับหน้าเว็บ แยกตามแถบ */
function hubDashboardData() {
  if (!hubProp_(HUB_CONFIG.PROP.SPREADSHEET_ID)) return { configured: false, draft: [], customs: [] };
  var rows = hubTable_(HUB_CONFIG.SHEETS.TASKS).sort(function (a, b) {
    return String(b.createdAt).localeCompare(String(a.createdAt));
  });
  var toView = function (row) {
    var view = hubPublicTask_(row);
    view.inputFileUrl = hubText_(row.inputFileId) ? 'https://drive.google.com/file/d/' + row.inputFileId + '/view' : '';
    view.resultFileUrl = hubText_(row.resultFileId) ? 'https://drive.google.com/file/d/' + row.resultFileId + '/view' : '';
    view.canStart = row.status === HUB_CONFIG.STATUS.QUEUED || row.status === HUB_CONFIG.STATUS.ERROR;
    return view;
  };
  return {
    configured: true,
    draft: rows.filter(function (r) { return r.type === HUB_CONFIG.TASK_TYPES.DRAFT_ENTRY; }).slice(0, 60).map(toView),
    customs: rows.filter(function (r) { return r.type === HUB_CONFIG.TASK_TYPES.CUSTOMS_ENTRY; }).slice(0, 60).map(toView)
  };
}
