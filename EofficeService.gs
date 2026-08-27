/**
 * คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร
 *
 * สร้างเป็น HTML ขนาด A4 แล้วให้ Apps Script แปลงเป็น PDF ฝั่งเซิร์ฟเวอร์
 * เพื่อให้ไฟล์ที่ได้เอาไป merge รวมชุดต่อได้เลย โดยไม่ต้องพึ่งการสั่งพิมพ์จากเบราว์เซอร์
 *
 * เนื้อหาส่วนที่เป็นแบบฟอร์มตายตัวถูกฝังไว้ในโค้ด ดึงมากรอกเฉพาะ 7 ช่อง:
 * เลขที่ / วันที่ / เลขใบขนสินค้าขาเข้า / จำนวนหีบห่อ / น้ำหนักสุทธิ / ราคาของ / ชนิดของ
 */

var THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
  'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** เลขที่คำร้องถัดไป เล่มที่มาจาก Master Data ส่วนเลขท้ายรันต่อรายปี */
function nextRequestNo_() {
  var bookNo = cleanText_(settingValue_(SETTING_KEYS.REQUEST_BOOK_NO, '0869'), 20) || '0869';
  var year = Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy');
  var prefix = 'EOFFICE-' + bookNo;

  var sequence = findOne_(APP_CONFIG.SHEETS.JOB_SEQUENCES, function (row) {
    return String(row.year) === year && String(row.prefix) === prefix;
  });
  var next = sequence ? toNumber_(sequence.lastNumber, 0) + 1 : 1;
  if (sequence) {
    updateRecord_(APP_CONFIG.SHEETS.JOB_SEQUENCES, sequence.id, { lastNumber: next, updatedAt: nowIso_() });
  } else {
    appendRecord_(APP_CONFIG.SHEETS.JOB_SEQUENCES, {
      id: newId_('SEQ'), year: year, prefix: prefix, lastNumber: next, updatedAt: nowIso_()
    });
  }

  var running = String(next);
  while (running.length < 4) running = '0' + running;
  return { bookNo: bookNo, runningNo: running, requestNo: bookNo + ' / ' + running };
}

/** ค่าเริ่มต้นที่จะเติมให้ในฟอร์ม ดึงจาก Job แล้วให้ผู้ใช้แก้ได้ก่อนยืนยัน */
function getEofficeRequestDefaults(token, jobId) {
  requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job, 'NOT_FOUND', 'ไม่พบ Job');

  var existing = findOne_(APP_CONFIG.SHEETS.EOFFICE_REQUESTS, function (row) {
    return String(row.jobId) === String(jobId);
  });
  var entry = findOne_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, function (row) {
    return String(row.jobId) === String(jobId);
  });

  var packageType = cleanText_(job.packageType) || 'UNITS';
  var currency = cleanText_(job.goodsCurrency) || 'USD';

  return {
    jobId: job.id,
    jobNo: job.jobNo,
    alreadyIssued: Boolean(existing),
    requestNo: existing ? existing.requestNo : '',
    requestDate: existing ? existing.requestDate : todayIsoDate_(),
    entryNo: existing ? existing.entryNo : cleanText_(entry && entry.declarationNo),
    packageCount: existing ? existing.packageCount : (toNumber_(job.unitAmount, 0) + ' ' + packageType),
    netWeight: existing ? existing.netWeight : (formatThousands_(job.grossWeight) + ' KGM'),
    goodsValue: existing ? existing.goodsValue : (formatThousands_(job.goodsValue) + ' ' + currency),
    goodsType: existing ? existing.goodsType : (cleanText_(job.product) || 'รถยนต์เก่าใช้แล้ว') + ' (รายละเอียดตามใบขนฯ แนบ)'
  };
}

/**
 * ออกคำร้อง สร้าง PDF เก็บเข้า Drive ของ Job และบันทึกลงชีต
 * ออกซ้ำได้ เลขที่เดิมจะถูกใช้ต่อ ไม่กินเลขใหม่ เพราะเลขคำร้องต้องผูกกับงานหนึ่งใบเท่านั้น
 */
function createEofficeRequest(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  payload = payload || {};
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');

  var entryNo = requiredText_(payload.entryNo, 'เลขที่ใบขนสินค้าขาเข้า', 60);
  var packageCount = requiredText_(payload.packageCount, 'จำนวนหีบห่อ', 60);
  var netWeight = requiredText_(payload.netWeight, 'น้ำหนักสุทธิ', 60);
  var goodsValue = requiredText_(payload.goodsValue, 'ราคาของ', 60);
  var goodsType = requiredText_(payload.goodsType, 'ชนิดของ', 300);
  var requestDate = cleanText_(payload.requestDate, 40) || todayIsoDate_();

  return withScriptLock_(function () {
    var existing = findOne_(APP_CONFIG.SHEETS.EOFFICE_REQUESTS, function (row) {
      return String(row.jobId) === String(job.id);
    });
    var numbering = existing
      ? { bookNo: existing.bookNo, runningNo: existing.runningNo, requestNo: existing.requestNo }
      : nextRequestNo_();

    var view = {
      requestNo: numbering.requestNo,
      bookNo: numbering.bookNo,
      runningNo: numbering.runningNo,
      requestDate: requestDate,
      entryNo: entryNo,
      packageCount: packageCount,
      netWeight: netWeight,
      goodsValue: goodsValue,
      goodsType: goodsType
    };

    var pdf = Utilities
      .newBlob(eofficeRequestHtml_(view), MimeType.HTML, 'request.html')
      .getAs(MimeType.PDF)
      .setName(sanitizeFileName_(job.jobNo + '_คำร้อง_' + numbering.bookNo + '-' + numbering.runningNo + '.pdf'));

    // เก็บผ่านช่องทางไฟล์ปกติของระบบ เพื่อให้ขึ้นในรายการไฟล์ของ Job และ merge หยิบไปใช้ได้
    var fileRecord = storeGeneratedJobFile_(session, job, APP_CONFIG.FILE_CATEGORIES.EOFFICE_REQUEST, pdf,
      'คำร้องเลขที่ ' + numbering.requestNo);

    var now = nowIso_();
    var record = {
      id: existing ? existing.id : newId_('EOR'),
      jobId: job.id,
      jobNo: job.jobNo,
      requestNo: numbering.requestNo,
      bookNo: numbering.bookNo,
      runningNo: numbering.runningNo,
      requestDate: requestDate,
      entryNo: entryNo,
      packageCount: packageCount,
      netWeight: netWeight,
      goodsValue: goodsValue,
      goodsType: goodsType,
      driveFileId: fileRecord.driveFileId,
      fileRecordId: fileRecord.id,
      createdBy: existing ? existing.createdBy : session.user.id,
      createdAt: existing ? existing.createdAt : now,
      updatedAt: now
    };
    if (existing) {
      updateRecord_(APP_CONFIG.SHEETS.EOFFICE_REQUESTS, existing.id, record);
    } else {
      appendRecord_(APP_CONFIG.SHEETS.EOFFICE_REQUESTS, record);
    }

    logActivity_(session.user.id, 'CREATE_EOFFICE_REQUEST', 'JOB', job.id, { requestNo: numbering.requestNo });
    return { request: serializeRecord_(record), file: fileRecord };
  });
}

function todayIsoDate_() {
  return Utilities.formatDate(new Date(), APP_CONFIG.TIME_ZONE, 'yyyy-MM-dd');
}

function formatThousands_(value) {
  var number = toNumber_(String(value === null || value === undefined ? '' : value).replace(/,/g, ''), 0);
  if (!number) return cleanText_(value) || '0';
  var parts = String(number).split('.');
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return parts.join('.');
}

/** แยกวันที่ ISO เป็น วัน / เดือนไทย / พ.ศ. ตามที่แบบฟอร์มราชการต้องการ */
function thaiDateParts_(isoDate) {
  var date = new Date(isoDate);
  if (isNaN(date.getTime())) date = new Date();
  var day = Number(Utilities.formatDate(date, APP_CONFIG.TIME_ZONE, 'd'));
  var monthIndex = Number(Utilities.formatDate(date, APP_CONFIG.TIME_ZONE, 'M')) - 1;
  var year = Number(Utilities.formatDate(date, APP_CONFIG.TIME_ZONE, 'yyyy')) + 543;
  return { day: String(day), month: THAI_MONTHS[monthIndex] || '', year: String(year) };
}

function escapeHtml_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function eofficeRequestHtml_(view) {
  var d = thaiDateParts_(view.requestDate);
  var e = escapeHtml_;
  return '' +
'<!DOCTYPE html><html lang="th"><head><meta charset="utf-8"><style>' +
'@page { size: A4; margin: 18mm 16mm; }' +
'body { font-family: "TH Sarabun New", "Sarabun", "Tahoma", sans-serif; font-size: 15pt; color: #000; line-height: 1.9; }' +
'.title { text-align: center; font-size: 17pt; font-weight: bold; margin: 0 0 18pt; }' +
'.right { text-align: right; }' +
'.indent { text-indent: 40pt; }' +
'table.detail { width: 100%; border-collapse: collapse; margin: 12pt 0 18pt; }' +
'table.detail th, table.detail td { border: 1px solid #000; padding: 6pt 8pt; text-align: center; font-size: 14pt; }' +
'table.detail th { font-weight: bold; }' +
'table.detail td.kind, table.detail th.kind { text-align: center; width: 42%; }' +
'table.sign { width: 100%; border-collapse: collapse; margin-top: 26pt; }' +
'table.sign th, table.sign td { border: 1px solid #000; padding: 8pt; vertical-align: top; font-size: 14pt; }' +
'table.sign th { text-align: center; font-weight: normal; }' +
'table.sign td.box { height: 150pt; text-align: center; }' +
'.row { display: block; margin: 0; }' +
'.sig { margin-top: 30pt; text-align: center; }' +
'.foot { text-align: right; font-size: 11pt; margin-top: 6pt; }' +
'.label { white-space: nowrap; }' +
'</style></head><body>' +

'<p class="title">คำร้องขอนำของที่นำเข้ามาในราชอาณาจักรเข้าไปในเขตปลอดอากร</p>' +

'<p class="right">เลขที่ ' + e(view.bookNo) + ' / ' + e(view.runningNo) + '</p>' +
'<p class="right">วันที่ ' + e(d.day) + ' เดือน ' + e(d.month) + ' พ.ศ. ' + e(d.year) + '</p>' +

'<p class="row"><span class="label">เรื่อง&nbsp;&nbsp;&nbsp;&nbsp;</span>ขอนำของที่นำเข้ามาในราชอาณาจักรเข้าเขตปลอดอากร</p>' +
'<p class="row"><span class="label">เรียน&nbsp;&nbsp;&nbsp;&nbsp;</span>นายด่านศุลกากรแม่สอด</p>' +

'<p class="indent">ด้วยข้าพเจ้า บริษัท แม่สอดฟรีโซน จำกัด ' +
'ถือใบรับรองเป็นผู้ประกอบกิจการในเขตปลอดอากร 97-2567 ตั้งอยู่เลขที่ 888/2 หมู่ที่ 7 ตำบลท่าสายลวด ' +
'อำเภอแม่สอด จังหวัดตาก รหัสไปรษณีย์ 63110</p>' +

'<p class="indent">มีความประสงค์จะนำของที่เข้ามาในราชอาณาจักรเข้าเขตปลอดอากร แม่สอดฟรีโซน ' +
'ตามใบขนสินค้าขาเข้า เลขที่ ' + e(view.entryNo) + ' เพื่อปรับสภาพก่อนส่งออกไปต่างประเทศ รายละเอียด ดังนี้</p>' +

'<table class="detail"><tr>' +
'<th>จำนวนหีบห่อ</th><th>น้ำหนักสุทธิ</th><th>ราคาของ</th><th class="kind">ชนิดของ</th>' +
'</tr><tr>' +
'<td>' + e(view.packageCount) + '</td>' +
'<td>' + e(view.netWeight) + '</td>' +
'<td>' + e(view.goodsValue) + '</td>' +
'<td class="kind">' + e(view.goodsType) + '</td>' +
'</tr></table>' +

'<p class="indent">จึงเรียนมาเพื่อโปรดพิจารณา</p>' +

'<table style="width:100%; border-collapse:collapse; margin-top:10pt;"><tr>' +
'<td style="width:50%; vertical-align:top; border:none;">' +
'<p class="row">เรียน เรือตรี ชุมพล</p>' +
'<p class="row" style="text-indent:20pt;">เพื่อดำเนินการตามระเบียบ</p>' +
'</td>' +
'<td style="width:50%; vertical-align:top; border:none; text-align:center;">' +
'<p class="row">ขอแสดงความนับถือ</p>' +
'<p class="sig">( ลงชื่อ ) ................................................ ตัวแทน/ผู้จัดการ</p>' +
'<p class="row">( นายอัครเดช ตาสะหลี ) ประทับตรา</p>' +
'</td>' +
'</tr></table>' +

'<table class="sign"><tr>' +
'<th>บันทึกการอนุญาตของพนักงานศุลกากร</th>' +
'<th>บันทึกการตรวจสอบพนักงานศุลกากร</th>' +
'</tr><tr>' +
'<td class="box"><div style="margin-top:105pt;">(เรือตรี ชุมพล อุดมโภชน์)<br>นักวิชาการศุลกากรปฏิบัติการ</div></td>' +
'<td class="box"></td>' +
'</tr></table>' +

'<p class="foot">3,1</p>' +
'</body></html>';
}
