/**
 * ชุดเอกสาร E-Office
 *
 * ประกอบไฟล์ตามลำดับเดียวกับชุดที่ยื่นจริง:
 *   1. คำร้อง  2. ใบขนสินค้า  3. Final Invoice  4. Arrival Notice หรือ BL
 *
 * ฝั่งนี้ทำหน้าที่เตรียม "ชิ้นส่วน" ให้เป็น PDF ทุกไฟล์แล้วส่งกลับไปให้เบราว์เซอร์ต่อกัน
 * เพราะ Apps Script ไม่มี API รวมไฟล์ PDF ส่วนการรวมจริงใช้ pdf-lib ฝั่งหน้าเว็บ
 */

var BUNDLE_PARTS = [
  { key: 'REQUEST', label: 'คำร้อง', category: 'EOFFICE_REQUEST' },
  { key: 'CUSTOMS', label: 'ใบขนสินค้า', category: 'CUSTOMS_ENTRY_DOC' },
  { key: 'INVOICE', label: 'Final Invoice', category: 'FINAL_INVOICE' },
  { key: 'SHIPPING', label: 'Arrival Notice / BL', category: '' }
];

function getEofficeBundle(token, jobId) {
  requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job, 'NOT_FOUND', 'ไม่พบ Job');

  var parts = [];
  var missing = [];

  BUNDLE_PARTS.forEach(function (part) {
    var record = part.key === 'SHIPPING'
      ? (currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.ARRIVAL_NOTICE) ||
         currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.BL))
      : currentFile_(job.id, part.category);

    if (!record) {
      missing.push(part.label);
      return;
    }
    try {
      var blob = bundlePartPdf_(record);
      parts.push({
        key: part.key,
        label: part.label,
        fileName: record.fileName,
        base64: Utilities.base64Encode(blob.getBytes())
      });
    } catch (error) {
      missing.push(part.label + ' (' + (error && error.message ? error.message : error) + ')');
    }
  });

  return {
    jobId: job.id,
    jobNo: job.jobNo,
    parts: parts,
    missing: missing,
    suggestedName: sanitizeFileName_(job.jobNo + ' [รวมชุด E-Office].pdf')
  };
}

/** เก็บชุดที่รวมเสร็จแล้วกลับเข้า Drive ของงาน */
function saveEofficeBundle(token, jobId, base64) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
  var data = cleanText_(base64);
  assert_(data, 'VALIDATION', 'ไม่พบข้อมูลไฟล์');

  var bytes = Utilities.base64Decode(data);
  assert_(bytes.length <= APP_CONFIG.MAX_FILE_BYTES, 'FILE_TOO_LARGE', 'ไฟล์ชุดใหญ่เกิน 8 MB');

  var blob = Utilities.newBlob(bytes, 'application/pdf',
    sanitizeFileName_(job.jobNo + ' [รวมชุด E-Office].pdf'));
  var record = storeGeneratedJobFile_(session, job, APP_CONFIG.FILE_CATEGORIES.EOFFICE_MERGED, blob,
    'ชุด E-Office รวมไฟล์');
  return record;
}

/** แปลงไฟล์แต่ละชิ้นให้เป็น PDF ตามชนิดของมัน */
function bundlePartPdf_(record) {
  var driveFile = DriveApp.getFileById(record.driveFileId);
  var mimeType = driveFile.getMimeType();

  if (mimeType === MimeType.PDF) return driveFile.getBlob();
  if (mimeType === MimeType.GOOGLE_SHEETS) return exportSheetPdf_(driveFile.getId());

  // Excel: ต้องแปลงเป็น Google Sheets ก่อน จึงจะ export ตามขอบเขตการพิมพ์ที่ตั้งไว้ในไฟล์ได้
  if (mimeType === MimeType.MICROSOFT_EXCEL || mimeType === MimeType.MICROSOFT_EXCEL_LEGACY) {
    var convertedId = convertToGoogleSheet_(driveFile.getId(), 'tmp-' + record.id);
    try {
      return exportSheetPdf_(convertedId);
    } finally {
      try { DriveApp.getFileById(convertedId).setTrashed(true); } catch (ignore) { /* ทิ้งไม่ได้ก็ข้าม */ }
    }
  }

  if (String(mimeType).indexOf('image/') === 0) {
    return Utilities.newBlob(
      '<html><body style="margin:0"><img src="data:' + mimeType + ';base64,' +
      Utilities.base64Encode(driveFile.getBlob().getBytes()) + '" style="width:100%"></body></html>',
      MimeType.HTML, 'image.html').getAs(MimeType.PDF);
  }

  appError_('UNSUPPORTED_TYPE', 'แปลงไฟล์ชนิด ' + mimeType + ' เป็น PDF ไม่ได้');
}

function convertToGoogleSheet_(fileId, name) {
  var response = UrlFetchApp.fetch(
    'https://www.googleapis.com/drive/v3/files/' + fileId + '/copy?supportsAllDrives=true&fields=id',
    {
      method: 'post',
      contentType: 'application/json',
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
      payload: JSON.stringify({ name: name, mimeType: MimeType.GOOGLE_SHEETS }),
      muteHttpExceptions: true
    });
  var code = response.getResponseCode();
  assert_(code === 200, 'CONVERT_FAILED',
    'แปลงไฟล์ Excel เป็น Google Sheets ไม่สำเร็จ (HTTP ' + code + ') ' + response.getContentText().slice(0, 200));
  return JSON.parse(response.getContentText()).id;
}

/**
 * export เป็น PDF โดยยึดขอบเขตการพิมพ์ที่ตั้งไว้ในไฟล์
 *
 * ตอนแปลง .xlsx เข้ามา ขอบเขตที่ตั้งไว้ใน Page Break Preview จะกลายเป็น named range ชื่อ Print_Area
 * ถ้าเจอก็ส่งช่วงนั้นให้ export ตรง ๆ ถ้าไม่เจอค่อยถอยไป export ทั้งชีตแรก
 */
function exportSheetPdf_(spreadsheetId) {
  var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  var area = printAreaOf_(spreadsheet);

  var params = [
    'format=pdf', 'size=A4', 'portrait=true', 'fitw=true',
    'gridlines=false', 'printtitle=false', 'sheetnames=false', 'pagenumbers=false',
    'top_margin=0.30', 'bottom_margin=0.30', 'left_margin=0.30', 'right_margin=0.30'
  ];
  if (area) {
    params.push('gid=' + area.gid);
    params.push('range=' + encodeURIComponent(area.a1));
  } else {
    params.push('gid=' + spreadsheet.getSheets()[0].getSheetId());
  }

  var response = UrlFetchApp.fetch(
    'https://docs.google.com/spreadsheets/d/' + spreadsheetId + '/export?' + params.join('&'),
    { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });

  var code = response.getResponseCode();
  assert_(code === 200, 'EXPORT_FAILED', 'export เป็น PDF ไม่สำเร็จ (HTTP ' + code + ')');
  return response.getBlob().setContentType('application/pdf');
}

function printAreaOf_(spreadsheet) {
  var named = spreadsheet.getNamedRanges();
  for (var i = 0; i < named.length; i += 1) {
    if (/print[_ ]?area/i.test(named[i].getName())) {
      var range = named[i].getRange();
      return { gid: range.getSheet().getSheetId(), a1: range.getA1Notation() };
    }
  }
  return null;
}
