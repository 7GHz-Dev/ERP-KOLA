/**
 * รันครั้งเดียวจาก Apps Script editor
 *
 * สร้าง Spreadsheet และโฟลเดอร์ Drive ของ Hub เอง แล้วจำ id ไว้ใน Script Properties
 * พร้อมออก API key สองใบ (ERP / worker) — คีย์จะแสดงใน Execution log ครั้งเดียว
 * เรียกซ้ำได้ ของเดิมจะไม่ถูกสร้างใหม่และคีย์เดิมไม่เปลี่ยน
 */
function hubSetup() {
  var activeEmail = hubText_(Session.getActiveUser().getEmail()).toLowerCase();
  var effectiveEmail = hubText_(Session.getEffectiveUser().getEmail()).toLowerCase();
  hubAssert_(activeEmail && effectiveEmail && activeEmail === effectiveEmail,
    'FORBIDDEN', 'hubSetup ต้องรันจาก Apps Script editor โดยบัญชีเจ้าของโปรเจกต์เท่านั้น');

  return hubLock_(function () {
    var props = hubProps_();

    var folderId = hubProp_(HUB_CONFIG.PROP.FOLDER_ID);
    if (!folderId) {
      folderId = DriveApp.createFolder('KOLA Automation Hub').getId();
      props.setProperty(HUB_CONFIG.PROP.FOLDER_ID, folderId);
    }

    var spreadsheetId = hubProp_(HUB_CONFIG.PROP.SPREADSHEET_ID);
    if (!spreadsheetId) {
      var created = SpreadsheetApp.create('KOLA Automation Hub — TASKS');
      spreadsheetId = created.getId();
      props.setProperty(HUB_CONFIG.PROP.SPREADSHEET_ID, spreadsheetId);
      // ย้ายไฟล์ไปไว้ในโฟลเดอร์ของ Hub ให้เป็นระเบียบ
      var file = DriveApp.getFileById(spreadsheetId);
      DriveApp.getFolderById(folderId).addFile(file);
      DriveApp.getRootFolder().removeFile(file);
    }

    var spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    Object.keys(HUB_SCHEMAS).forEach(function (name) {
      hubEnsureSheet_(spreadsheet, name, HUB_SCHEMAS[name]);
    });
    var blank = spreadsheet.getSheetByName('Sheet1') || spreadsheet.getSheetByName('ชีต1');
    if (blank && spreadsheet.getSheets().length > 1) spreadsheet.deleteSheet(blank);

    var erpKey = hubProp_(HUB_CONFIG.PROP.API_KEY_ERP);
    if (!erpKey) {
      erpKey = hubToken_();
      props.setProperty(HUB_CONFIG.PROP.API_KEY_ERP, erpKey);
    }
    var workerKey = hubProp_(HUB_CONFIG.PROP.API_KEY_WORKER);
    if (!workerKey) {
      workerKey = hubToken_();
      props.setProperty(HUB_CONFIG.PROP.API_KEY_WORKER, workerKey);
    }
    props.setProperty(HUB_CONFIG.PROP.SETUP_AT, hubNow_());

    var result = {
      ok: true,
      spreadsheetId: spreadsheetId,
      spreadsheetUrl: spreadsheet.getUrl(),
      folderId: folderId,
      folderUrl: 'https://drive.google.com/drive/folders/' + folderId,
      apiKeyErp: erpKey,
      apiKeyWorker: workerKey
    };
    Logger.log('===== KOLA Automation Hub พร้อมใช้งาน =====');
    Logger.log(JSON.stringify(result, null, 2));
    Logger.log('เก็บ apiKeyErp และ apiKeyWorker ไว้ให้ดี จะไม่แสดงซ้ำที่อื่น');
    return result;
  });
}

/** เรียกดู API key อีกครั้งถ้าลืม (รันจาก editor เท่านั้น) */
function hubShowKeys() {
  var activeEmail = hubText_(Session.getActiveUser().getEmail()).toLowerCase();
  hubAssert_(activeEmail, 'FORBIDDEN', 'ต้องรันจาก Apps Script editor');
  var result = {
    apiKeyErp: hubProp_(HUB_CONFIG.PROP.API_KEY_ERP),
    apiKeyWorker: hubProp_(HUB_CONFIG.PROP.API_KEY_WORKER),
    spreadsheetId: hubProp_(HUB_CONFIG.PROP.SPREADSHEET_ID),
    folderId: hubProp_(HUB_CONFIG.PROP.FOLDER_ID)
  };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

/** ออก API key ใหม่ทั้งสองใบ ใช้เมื่อสงสัยว่าคีย์รั่ว (ของเดิมจะใช้ไม่ได้ทันที) */
function hubRotateKeys() {
  var activeEmail = hubText_(Session.getActiveUser().getEmail()).toLowerCase();
  hubAssert_(activeEmail, 'FORBIDDEN', 'ต้องรันจาก Apps Script editor');
  var props = hubProps_();
  var erpKey = hubToken_();
  var workerKey = hubToken_();
  props.setProperty(HUB_CONFIG.PROP.API_KEY_ERP, erpKey);
  props.setProperty(HUB_CONFIG.PROP.API_KEY_WORKER, workerKey);
  Logger.log(JSON.stringify({ apiKeyErp: erpKey, apiKeyWorker: workerKey }, null, 2));
  return { ok: true };
}
