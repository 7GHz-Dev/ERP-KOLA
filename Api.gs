/**
 * JSON API สำหรับให้ dev server ที่ localhost เรียกใช้งานข้อมูลจริง
 *
 * ฝั่งเบราว์เซอร์จะ POST มาที่ /exec ด้วย body รูปแบบ:
 *   { "fn": "getBootstrapData", "args": ["<token>"] }
 *
 * ตอบกลับเป็น { ok: true, data: ... } หรือ { ok: false, error: "CODE|ข้อความ" }
 * ซึ่งเป็นรูปแบบเดียวกับที่ handleError() ฝั่งหน้าเว็บเข้าใจอยู่แล้ว
 *
 * ทุกฟังก์ชันในรายการยังบังคับ requireSession_(token) ด้วยตัวเองเหมือนเดิม
 * ยกเว้น authLogin ที่ต้องเรียกได้ก่อนมี token
 */
var API_ALLOWED_FUNCTIONS = Object.freeze([
  'authLogin', 'authLogout', 'authGetSession', 'authChangePassword',
  'getBootstrapData', 'getJobDetail', 'listJobs', 'listJobFiles', 'getMasterData',
  'createJob', 'createJobFromArrival', 'updateJobDetails', 'archiveJob',
  'requestApproval', 'decideApproval',
  'uploadJobFile', 'downloadJobFile', 'acknowledgeInvoiceFile',
  'saveCustomerInfo', 'saveCustomsDraft', 'submitCustomsDraft', 'fileCustomsEntry',
  'saveDoHandoff', 'updateSurrenderStatus', 'releaseJob',
  'saveMasterRecord', 'setMasterRecordActive', 'checkMasterDuplicate',
  'adminListUsers', 'adminCreateUser', 'adminUpdateUser', 'adminResetPassword',
  'getEofficeRequestDefaults', 'createEofficeRequest',
  'sendDraftToHub', 'sendCustomsToHub', 'syncHubResults', 'rejectCustomsDraft',
  'getEofficeBundle', 'saveEofficeBundle',
  'exportAllData', 'exportRowCounts'
]);

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    assert_(raw, 'VALIDATION', 'ไม่พบข้อมูลที่ส่งมา');

    var body = JSON.parse(raw);
    var fn = cleanText_(body.fn, 100);
    assert_(API_ALLOWED_FUNCTIONS.indexOf(fn) >= 0, 'FORBIDDEN',
      'ไม่อนุญาตให้เรียกฟังก์ชัน ' + fn + ' ผ่าน API');

    var target = globalThis[fn];
    assert_(typeof target === 'function', 'NOT_FOUND', 'ไม่พบฟังก์ชัน ' + fn);

    var args = reviveApiBlobs_(body.args || []);
    var data = target.apply(null, args);
    return apiJson_({ ok: true, data: data === undefined ? null : data });
  } catch (error) {
    var message = error && error.message ? String(error.message) : String(error);
    return apiJson_({ ok: false, error: message });
  }
}

/**
 * แปลง marker { __blob: true, base64, name, mimeType } ที่ส่งมาจากเบราว์เซอร์
 * ให้กลับเป็น Blob จริง เพราะ uploadJobFile() เรียก blob.getBytes()
 */
function reviveApiBlobs_(value) {
  if (value === null || typeof value !== 'object') return value;

  if (value.__blob === true) {
    return Utilities.newBlob(
      Utilities.base64Decode(String(value.base64 || '')),
      cleanText_(value.mimeType) || 'application/octet-stream',
      cleanText_(value.name) || 'upload'
    );
  }

  if (Object.prototype.toString.call(value) === '[object Array]') {
    return value.map(reviveApiBlobs_);
  }

  var result = {};
  Object.keys(value).forEach(function (key) {
    result[key] = reviveApiBlobs_(value[key]);
  });
  return result;
}

function apiJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}


