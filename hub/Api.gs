/**
 * REST-ish API ของ Hub
 *
 * ทุกคำขอเป็น POST body JSON: { "key": "<api key>", "fn": "<ชื่อคำสั่ง>", "args": { ... } }
 * ตอบกลับ { ok: true, data: ... } หรือ { ok: false, error: "CODE|ข้อความ" }
 *
 * มี API key สองใบแยกบทบาท ใบของ ERP เรียกคำสั่งของ worker ไม่ได้ และกลับกัน
 * เพื่อไม่ให้เครื่องที่รัน Python มีสิทธิ์ยัดงานเข้าคิวเอง
 */
var HUB_ERP_FUNCTIONS = Object.freeze({
  submitTask: hubSubmitTask,
  getTasks: hubGetTasks,
  downloadResultFile: hubDownloadResultFile,
  retryTask: hubRetryTask
});

var HUB_WORKER_FUNCTIONS = Object.freeze({
  claimNext: hubClaimNext,
  downloadInputFile: hubDownloadInputFile,
  completeTask: hubCompleteTask,
  failTask: hubFailTask,
  getTasks: hubGetTasks
});

function doPost(e) {
  try {
    var raw = e && e.postData && e.postData.contents ? e.postData.contents : '';
    hubAssert_(raw, 'VALIDATION', 'ไม่พบข้อมูลที่ส่งมา');

    var body = JSON.parse(raw);
    var fn = hubText_(body.fn, 60);
    var key = hubText_(body.key, 200);
    hubAssert_(fn, 'VALIDATION', 'ต้องระบุ fn');

    var role = hubRoleForKey_(key);
    hubAssert_(role, 'UNAUTHORIZED', 'API key ไม่ถูกต้อง');

    var table = role === 'ERP' ? HUB_ERP_FUNCTIONS : HUB_WORKER_FUNCTIONS;
    var target = table[fn];
    hubAssert_(typeof target === 'function', 'FORBIDDEN',
      'บทบาท ' + role + ' เรียกคำสั่ง ' + fn + ' ไม่ได้');

    var data = target(body.args || {});
    return hubJson_({ ok: true, data: data === undefined ? null : data });
  } catch (error) {
    return hubJson_({ ok: false, error: String(error && error.message ? error.message : error) });
  }
}

function hubRoleForKey_(key) {
  if (!key) return '';
  if (hubConstantEquals_(key, hubProp_(HUB_CONFIG.PROP.API_KEY_ERP))) return 'ERP';
  if (hubConstantEquals_(key, hubProp_(HUB_CONFIG.PROP.API_KEY_WORKER))) return 'WORKER';
  return '';
}

function hubJson_(payload) {
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/** หน้าเว็บสรุปคิวงาน ข้อมูลโหลดผ่าน google.script.run ไม่ใช่ template scriptlet */
function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(HUB_CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}
