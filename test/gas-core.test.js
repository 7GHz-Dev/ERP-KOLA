'use strict';

const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MockRange {
  constructor(sheet, row, column, rowCount, columnCount) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rowCount = rowCount;
    this.columnCount = columnCount;
  }
  getValues() {
    const output = [];
    for (let r = 0; r < this.rowCount; r += 1) {
      const row = [];
      for (let c = 0; c < this.columnCount; c += 1) {
        row.push(this.sheet.valueAt(this.row + r, this.column + c));
      }
      output.push(row);
    }
    return output;
  }
  getDisplayValues() {
    return this.getValues().map((row) => row.map((value) => value === null || value === undefined ? '' : String(value)));
  }
  setValues(values) {
    values.forEach((row, r) => row.forEach((value, c) => {
      this.sheet.setValue(this.row + r, this.column + c, value);
    }));
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setWrap() { return this; }
  createFilter() { this.sheet.filter = {}; return this.sheet.filter; }
}

class MockSheet {
  constructor(name) {
    this.name = name;
    this.rows = [];
    this.filter = null;
  }
  valueAt(row, column) {
    return this.rows[row - 1] && this.rows[row - 1][column - 1] !== undefined
      ? this.rows[row - 1][column - 1]
      : '';
  }
  setValue(row, column, value) {
    while (this.rows.length < row) this.rows.push([]);
    while (this.rows[row - 1].length < column) this.rows[row - 1].push('');
    this.rows[row - 1][column - 1] = value;
  }
  getLastRow() { return this.rows.length; }
  getLastColumn() { return this.rows.reduce((max, row) => Math.max(max, row.length), 0); }
  getRange(row, column, rowCount, columnCount) { return new MockRange(this, row, column, rowCount, columnCount); }
  appendRow(row) { this.rows.push(row.slice()); return this; }
  deleteRow(rowNumber) { this.rows.splice(rowNumber - 1, 1); return this; }
  setFrozenRows() { return this; }
  autoResizeColumns() { return this; }
  getFilter() { return this.filter; }
  deleteRow(row) { this.rows.splice(row - 1, 1); }
}

class MockSpreadsheet {
  constructor() { this.sheets = new Map(); }
  getSheetByName(name) { return this.sheets.get(name) || null; }
  insertSheet(name) {
    const sheet = new MockSheet(name);
    this.sheets.set(name, sheet);
    return sheet;
  }
}

class MockBlob {
  constructor(name, contentType, bytes) {
    this.name = name;
    this.contentType = contentType;
    this.bytes = Array.from(bytes);
  }
  getName() { return this.name; }
  setName(name) { this.name = name; return this; }
  getContentType() { return this.contentType; }
  getBytes() { return this.bytes.slice(); }
}

class MockDriveFile {
  constructor(id, blob) {
    this.id = id;
    this.blob = blob;
    this.trashed = false;
  }
  getId() { return this.id; }
  getBlob() { return this.blob; }
  setTrashed(value) { this.trashed = value; }
}

class MockFolder {
  constructor(id, name, drive) {
    this.id = id;
    this.name = name;
    this.drive = drive;
    this.folders = [];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getFoldersByName(name) {
    const matches = this.folders.filter((folder) => folder.name === name);
    let index = 0;
    return { hasNext: () => index < matches.length, next: () => matches[index++] };
  }
  createFolder(name) {
    const folder = new MockFolder(`folder-${this.drive.nextId++}`, name, this.drive);
    this.folders.push(folder);
    this.drive.folders.set(folder.id, folder);
    return folder;
  }
  createFile(blob) {
    const file = new MockDriveFile(`file-${this.drive.nextId++}`, blob);
    this.drive.files.set(file.id, file);
    return file;
  }
}

const hubMock = { calls: [], responses: {} };

function buildContext() {
  const spreadsheet = new MockSpreadsheet();
  const properties = new Map();
  const drive = { nextId: 1, folders: new Map(), files: new Map() };
  // อ่าน id จาก Config.gs ตรง ๆ เพื่อไม่ให้ test พังทุกครั้งที่ย้ายโฟลเดอร์ Drive
  const configSource = fs.readFileSync(path.resolve(__dirname, '..', 'Config.gs'), 'utf8');
  const idMarker = "DRIVE_FOLDER_ID: '";
  const idStart = configSource.indexOf(idMarker) + idMarker.length;
  const driveFolderId = configSource.slice(idStart, configSource.indexOf("'", idStart));
  const rootFolder = new MockFolder(driveFolderId, 'KOLA', drive);
  drive.folders.set(rootFolder.id, rootFolder);

  const context = {
    console,
    Date,
    JSON,
    Math,
    Object,
    Array,
    String,
    Number,
    Boolean,
    RegExp,
    Error,
    isFinite,
    isNaN,
    SpreadsheetApp: { openById: () => spreadsheet },
    // Hub จำลอง: เก็บคำขอที่ ERP ยิงออกไป และตอบตามสคริปต์ที่เทสต์ตั้งไว้
    UrlFetchApp: {
      fetch: (url, options) => {
        const body = JSON.parse(options.payload);
        hubMock.calls.push(body);
        const handler = hubMock.responses[body.fn];
        const data = typeof handler === 'function' ? handler(body.args) : handler;
        return {
          getResponseCode: () => 200,
          getContentText: () => JSON.stringify({ ok: true, data: data === undefined ? null : data })
        };
      }
    },
    ScriptApp: { getOAuthToken: () => 'mock-token' },
    Session: { getActiveUser: () => ({ getEmail: () => 'owner@example.com' }), getEffectiveUser: () => ({ getEmail: () => 'owner@example.com' }) },
    DriveApp: {
      getFolderById: (id) => {
        if (!drive.folders.has(id)) throw new Error('Folder not found');
        return drive.folders.get(id);
      },
      getFileById: (id) => {
        if (!drive.files.has(id)) throw new Error('File not found');
        return drive.files.get(id);
      }
    },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperty: (key) => properties.get(key) || null,
        setProperty: (key, value) => { properties.set(key, String(value)); },
        setProperties: (values) => Object.keys(values).forEach((key) => properties.set(key, String(values[key])))
      })
    },
    LockService: {
      getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} })
    },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'SHA_256' },
      Charset: { UTF_8: 'UTF_8' },
      computeDigest: (_algorithm, value) => Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest()),
      getUuid: () => crypto.randomUUID(),
      base64EncodeWebSafe: (value) => Buffer.from(String(value), 'utf8').toString('base64url'),
      base64Encode: (bytes) => Buffer.from(bytes).toString('base64'),
      base64Decode: (value) => Array.from(Buffer.from(String(value), 'base64')),
      newBlob: (bytes, contentType, name) => new MockBlob(name || 'blob', contentType || 'application/octet-stream', Buffer.from(bytes)),
      sleep: () => {},
      formatDate: (date, _timeZone, pattern) => pattern === 'yyyy' ? String(date.getFullYear()) : date.toISOString()
    },
    Logger: { log: () => {} }
  };
  context.global = context;
  return { context: vm.createContext(context), spreadsheet, drive };
}

function loadApplication(context) {
  const root = path.resolve(__dirname, '..');
  [
    'Config.gs', 'Utils.gs', 'Database.gs', 'Auth.gs', 'DriveService.gs',
    'Setup.gs', 'MasterDataService.gs', 'WorkflowService.gs', 'EofficeService.gs', 'HubClient.gs', 'BundleService.gs', 'Maintenance.gs'
  ].forEach((fileName) => {
    const source = fs.readFileSync(path.join(root, fileName), 'utf8');
    vm.runInContext(source, context, { filename: fileName });
  });
}

function expectAppError(callback, code) {
  assert.throws(callback, (error) => String(error.message).includes(`${code}|`));
}

function loginAndChangePassword(context, username, temporaryPassword, newPassword) {
  const login = context.authLogin(username, temporaryPassword);
  context.authChangePassword(login.token, temporaryPassword, newPassword);
  return login.token;
}

function uploadBlob(context, token, jobId, category, fileName, changeReason) {
  return context.uploadJobFile({
    token,
    jobId,
    category,
    changeReason: changeReason || '',
    note: '',
    fileBlob: new MockBlob(fileName, 'application/pdf', Buffer.from(`content-${fileName}`))
  });
}

(function run() {
  const { context, spreadsheet } = buildContext();
  loadApplication(context);

  const setup = context.setupSystem_();
  assert.equal(setup.ok, true);
  assert.ok(setup.temporaryPassword);
  assert.ok(spreadsheet.getSheetByName('JOBS'));
  assert.ok(spreadsheet.getSheetByName('_USERS'));

  const initialAdminLogin = context.authLogin('admin', setup.temporaryPassword);
  expectAppError(() => context.adminListUsers(initialAdminLogin.token), 'PASSWORD_CHANGE_REQUIRED');
  context.authChangePassword(initialAdminLogin.token, setup.temporaryPassword, 'AdminPass123!');
  const adminToken = initialAdminLogin.token;

  const paintUser = context.adminCreateUser(adminToken, { username: 'paint', displayName: 'Paint Team', role: 'PAINT' });
  const fahUser = context.adminCreateUser(adminToken, { username: 'fah', displayName: 'Fah Team', role: 'FAH' });
  const namUser = context.adminCreateUser(adminToken, { username: 'namkang', displayName: 'Namkang Team', role: 'NAMKANG' });

  const paintToken = loginAndChangePassword(context, 'paint', paintUser.temporaryPassword, 'PaintPass123!');
  const fahToken = loginAndChangePassword(context, 'fah', fahUser.temporaryPassword, 'FahPass123!');
  const namToken = loginAndChangePassword(context, 'namkang', namUser.temporaryPassword, 'NamPass123!');

  const job = context.createJob(paintToken, {
    blNo: 'BL-TEST-001',
    vessel: 'KOLA STAR',
    voyage: 'V001',
    eta: '2026-08-20',
    containers: [{ containerNo: 'MSFZ1234567', containerType: '40HQ', sealNo: 'SEAL-1' }]
  });
  assert.match(job.jobNo, /^KOLA-\d{4}-0001$/);

  uploadBlob(context, paintToken, job.id, 'ARRIVAL_NOTICE', 'arrival-notice.pdf');
  const an = context.requestApproval(paintToken, job.id, 'AN');
  expectAppError(() => context.decideApproval(paintToken, an.id, 'APPROVED', ''), 'FORBIDDEN');
  context.decideApproval(namToken, an.id, 'APPROVED', 'พร้อมดำเนินการ');

  const invoiceV1 = uploadBlob(context, namToken, job.id, 'INVOICE_GOODS', 'invoice-v1.pdf');
  assert.equal(invoiceV1.version, 1);
  assert.equal(context.findById_('JOBS', job.id).hasInvoiceAlert, false);
  expectAppError(
    () => uploadBlob(context, namToken, job.id, 'INVOICE_GOODS', 'invoice-v2.pdf'),
    'CHANGE_REASON_REQUIRED'
  );
  const invoiceV2 = uploadBlob(context, namToken, job.id, 'INVOICE_GOODS', 'invoice-v2.pdf', 'แก้ไขยอดสินค้า');
  assert.equal(invoiceV2.version, 2);
  assert.equal(context.findById_('JOBS', job.id).hasInvoiceAlert, true);
  expectAppError(() => context.acknowledgeInvoiceFile(namToken, invoiceV2.id), 'FORBIDDEN');
  context.acknowledgeInvoiceFile(paintToken, invoiceV2.id);
  assert.equal(context.findById_('JOBS', job.id).hasInvoiceAlert, false);

  // อัปโหลด Final Invoice แล้วต้องส่งอนุมัติ FN ให้เองอัตโนมัติ (หน้าจอไม่มีปุ่มส่งอนุมัติแล้ว)
  uploadBlob(context, paintToken, job.id, 'FINAL_INVOICE', 'final-invoice.pdf');
  const fn = context.getTable_('APPROVALS').filter((r) => r.jobId === job.id && r.approvalType === 'FN' && r.status === 'PENDING')[0];
  assert.ok(fn, 'อัปโหลด Final Invoice ต้องสร้างคำขออนุมัติ FN ให้อัตโนมัติ');
  assert.equal(context.findById_('JOBS', job.id).status, 'WAITING_FN_APPROVAL');
  // กดอัปโหลดซ้ำต้องไม่สร้างคำขอซ้อน
  uploadBlob(context, paintToken, job.id, 'FINAL_INVOICE', 'final-invoice-v2.pdf');
  assert.equal(context.getTable_('APPROVALS').filter((r) => r.jobId === job.id && r.approvalType === 'FN').length, 1);
  context.decideApproval(fahToken, fn.id, 'APPROVED', 'อนุมัติ');
  context.saveCustomsDraft(paintToken, job.id, { entryNo: 'ENTRY-001', amount: 1500 });
  context.submitCustomsDraft(paintToken, job.id);
  context.fileCustomsEntry(fahToken, job.id, { declarationNo: 'DEC-001' });
  uploadBlob(context, paintToken, job.id, 'EOFFICE', 'eoffice.pdf');
  expectAppError(() => context.updateSurrenderStatus(namToken, job.id, 'CLEARED', 'ตรวจแล้ว'), 'SURRENDER_FILE_REQUIRED');
  uploadBlob(context, namToken, job.id, 'SURRENDER', 'surrender-bl.pdf');
  context.updateSurrenderStatus(namToken, job.id, 'CLEARED', 'ตรวจแล้ว');
  context.releaseJob(namToken, job.id, { inspectionRequired: false, releaseNote: 'เรียบร้อย' });

  const finalJob = context.getJobDetail(paintToken, job.id).job;
  assert.equal(finalJob.status, 'RELEASED');
  assert.equal(finalJob.releaseStatus, 'RELEASED');
  assert.equal(finalJob.currentFiles.INVOICE_GOODS.version, 2);
  assert.equal(finalJob.currentFiles.INVOICE_GOODS.isAcknowledged, true);
  assert.ok(context.getTable_('ACTIVITY_LOG').length >= 20);

  const intake = context.createJobFromArrival({
    token: paintToken,
    payloadJson: JSON.stringify({
      sourceType: 'BL',
      blType: 'SWB',
      product: 'USED VEHICLE',
      vessel: 'OOCL TEST',
      voyage: '001S',
      eta: '2026-09-01',
      bls: [{ blNo: 'OOLU9999999999', shipperId: '', shipperName: 'AE TRADING COMPANY' }],
      packageType: 'PK',
      containers: [{ containerNo: 'OOLU1234567', containerType: '40"', sealNo: 'SEAL-2' }]
    }),
    fileBlob: new MockBlob('bill-of-lading.pdf', 'application/pdf', Buffer.from('BL PDF'))
  });
  assert.equal(intake.job.sourceType, 'BL');
  assert.equal(intake.job.status, 'WAITING_ARRIVAL_NOTICE_BL');
  assert.equal(intake.file.category, 'BL');
  assert.equal(intake.job.packageType, 'PK');
  // ไม่ได้ส่ง demDays/detDays มา ต้องหยิบค่าตั้งต้นจากชีต MD_SETTINGS
  assert.equal(intake.job.demDays, 5);
  assert.equal(intake.job.detDays, 3);

  // Master Data ชุดใหม่ต้องถูกสร้างและ seed ครบ
  assert.equal(context.getTable_('MD_CONTAINER_TYPES').length, 3);
  assert.equal(context.getTable_('MD_PACKAGE_TYPES').length, 3);
  // DEM/DET + เล่มที่คำร้อง + URL/คีย์ของ Hub
  assert.equal(context.getTable_('MD_SETTINGS').length, 5);
  const settingCodes = context.getTable_('MD_SETTINGS').map((r) => r.code).sort();
  assert.deepEqual(settingCodes, ['DEM_FREE_DAYS', 'DET_FREE_DAYS', 'HUB_API_KEY', 'HUB_URL', 'REQUEST_BOOK_NO']);
  const containerCodes = context.getTable_('MD_CONTAINER_TYPES').map((r) => r.code).sort();
  assert.deepEqual(containerCodes, ['20', '40', 'RORO']);
  const packageCodes = context.getTable_('MD_PACKAGE_TYPES').map((r) => r.code).sort();
  assert.deepEqual(packageCodes, ['PK', 'PP', 'UNIT']);

  // แก้ค่าตั้งต้นในหน้า Master Data แล้วงานถัดไปต้องใช้ค่าใหม่
  const demSetting = context.getTable_('MD_SETTINGS').filter((r) => r.code === 'DEM_FREE_DAYS')[0];
  context.saveMasterRecord(adminToken, 'settings', {
    id: demSetting.id, code: 'DEM_FREE_DAYS', name: 'DEM FREE (วัน)', value: '9'
  });
  const intakeAfterSetting = context.createJobFromArrival({
    token: paintToken,
    payloadJson: JSON.stringify({
      sourceType: 'BL', blType: 'SWB', product: 'USED VEHICLE', vessel: 'OOCL TEST 2', voyage: '002S',
      eta: '2026-09-05',
      bls: [{ blNo: 'OOLU8888888888', shipperId: '', shipperName: 'AE TRADING COMPANY' }],
      containers: [{ containerNo: 'OOLU7654321', containerType: '20"', sealNo: 'SEAL-3' }]
    }),
    fileBlob: new MockBlob('bl-2.pdf', 'application/pdf', Buffer.from('BL PDF 2'))
  });
  assert.equal(intakeAfterSetting.job.demDays, 9);
  assert.equal(intakeAfterSetting.job.detDays, 3);

  // PAINT เพิ่ม Shipper ใหม่จากปุ่ม + ได้ แต่แก้ของเดิมไม่ได้
  // เว้นรหัสว่าง ระบบต้องรันต่อจากรหัสล่าสุด (seed มี SHP0001 อยู่แล้ว)
  const autoShipper = context.saveMasterRecord(paintToken, 'shippers', { name: 'AUTO CODE CO.,LTD.' });
  assert.equal(autoShipper.code, 'SHP0002');
  const autoShipper2 = context.saveMasterRecord(paintToken, 'shippers', { name: 'AUTO CODE TWO CO.,LTD.' });
  assert.equal(autoShipper2.code, 'SHP0003');

  const quickShipper = context.saveMasterRecord(paintToken, 'shippers', { code: 'SHP9001', name: 'QUICK ADD CO.,LTD.' });
  assert.equal(quickShipper.name, 'QUICK ADD CO.,LTD.');
  expectAppError(() => context.saveMasterRecord(paintToken, 'shippers', {
    id: quickShipper.id, code: 'SHP9001', name: 'QUICK ADD RENAMED'
  }), 'FORBIDDEN');
  expectAppError(() => context.saveMasterRecord(paintToken, 'ports', { code: 'X1', name: 'ท่าเรือทดสอบ' }), 'FORBIDDEN');

  // ---- ส่ง Final Invoice ขึ้น Hub แล้วรับเลข Ref No. กลับมา ----
  const hubJob = intake.job;
  context.saveMasterRecord(adminToken, 'settings', {
    id: context.getTable_('MD_SETTINGS').filter((r) => r.code === 'HUB_URL')[0].id,
    code: 'HUB_URL', name: 'URL ของ Automation Hub', value: 'https://hub.example/exec'
  });
  context.saveMasterRecord(adminToken, 'settings', {
    id: context.getTable_('MD_SETTINGS').filter((r) => r.code === 'HUB_API_KEY')[0].id,
    code: 'HUB_API_KEY', name: 'API key ของ Hub (ฝั่ง ERP)', value: 'secret-key'
  });

  uploadBlob(context, paintToken, hubJob.id, 'FINAL_INVOICE', 'hub-invoice.xlsx');
  hubMock.calls.length = 0;
  hubMock.responses.submitTask = () => ({ taskId: 'TASK-1', status: 'QUEUED', reused: false });
  context.sendDraftToHub(paintToken, hubJob.id);

  const submitted = hubMock.calls.filter((c) => c.fn === 'submitTask')[0];
  assert.equal(submitted.key, 'secret-key');
  assert.equal(submitted.args.type, 'DRAFT_ENTRY');
  assert.equal(submitted.args.jobRef, hubJob.id);
  assert.ok(submitted.args.file && submitted.args.file.base64, 'ต้องแนบไฟล์ Final Invoice ไปด้วย');
  assert.equal(context.findById_('JOBS', hubJob.id).draftStatus, 'SENT_TO_HUB');

  // Hub ยังทำไม่เสร็จ ต้องยังไม่มีเลขมาลง
  hubMock.responses.getTasks = () => ({ tasks: [{ id: 'TASK-1', status: 'PROCESSING', refNo: '' }] });
  context.syncHubResults(paintToken);
  assert.equal(context.findById_('JOBS', hubJob.id).draftRefNo, '');

  // Hub ทำเสร็จแล้ว เลข Ref No. ต้องมาลงที่ Job ให้แท็บ 3 แสดงได้
  hubMock.responses.getTasks = () => ({ tasks: [{ id: 'TASK-1', status: 'DONE', refNo: 'QELS100015338' }] });
  const synced = context.syncHubResults(paintToken);
  assert.equal(synced.applied, 1);
  const afterSync = context.findById_('JOBS', hubJob.id);
  assert.equal(afterSync.draftRefNo, 'QELS100015338');
  assert.equal(afterSync.draftStatus, 'CREATED');
  assert.equal(afterSync.customsStatus, 'DRAFT');

  // ดึงซ้ำต้องไม่ทำงานซ้ำ
  assert.equal(context.syncHubResults(paintToken).applied, 0);

  // ---- สร้างใบขน: ต้องได้ทั้งเลขและไฟล์กลับมาเก็บใน Job ----
  context.submitCustomsDraft(paintToken, hubJob.id);
  hubMock.calls.length = 0;
  hubMock.responses.submitTask = () => ({ taskId: 'TASK-2', status: 'QUEUED', reused: false });
  context.sendCustomsToHub(fahToken, hubJob.id);

  const customsSubmit = hubMock.calls.filter((c) => c.fn === 'submitTask')[0];
  assert.equal(customsSubmit.args.type, 'CUSTOMS_ENTRY');
  assert.equal(customsSubmit.args.data.refNo, 'QELS100015338');
  assert.equal(context.findById_('JOBS', hubJob.id).customsTaskId, 'TASK-2');

  const entryPdf = Buffer.from('%PDF-1.4 mock customs entry');
  hubMock.responses.getTasks = () => ({
    tasks: [{ id: 'TASK-2', status: 'DONE', entryNo: 'A0180690802150', hasResultFile: true }]
  });
  hubMock.responses.downloadResultFile = () => ({
    fileName: 'A0180690802150.pdf',
    mimeType: 'application/pdf',
    base64: entryPdf.toString('base64')
  });

  const customsSync = context.syncHubResults(fahToken);
  assert.equal(customsSync.applied, 1);
  assert.equal(customsSync.errors.length, 0, JSON.stringify(customsSync.errors));

  const filedJob = context.findById_('JOBS', hubJob.id);
  assert.equal(filedJob.customsStatus, 'FILED');

  // ไฟล์ใบขนต้องถูกเก็บเป็นไฟล์ของ Job จริง ไม่ใช่ค้างอยู่ฝั่ง Hub
  const entryFile = context.getTable_('FILES').filter(
    (r) => r.jobId === hubJob.id && r.category === 'CUSTOMS_ENTRY_DOC' && r.isCurrent === true)[0];
  assert.ok(entryFile, 'ต้องมีไฟล์ใบขนสินค้าเก็บไว้ใน Job');
  assert.equal(entryFile.fileName, 'A0180690802150.pdf');
  assert.equal(entryFile.sizeBytes, entryPdf.length);

  // เลขใบขนต้องลงในรายการ CUSTOMS_ENTRIES ให้หน้าจอหยิบไปแสดงได้
  const entryRecord = context.getTable_('CUSTOMS_ENTRIES').filter((r) => r.jobId === hubJob.id)[0];
  assert.equal(entryRecord.declarationNo, 'A0180690802150');
  assert.equal(entryRecord.status, 'FILED');

  // ดึงซ้ำต้องไม่โหลดไฟล์ซ้ำ
  assert.equal(context.syncHubResults(fahToken).applied, 0);
  assert.equal(context.getTable_('FILES').filter(
    (r) => r.jobId === hubJob.id && r.category === 'CUSTOMS_ENTRY_DOC').length, 1);

  // ---- ลบ Job ต้องลบข้อมูลลูกครบและไม่แตะงานอื่น ----
  const keepJob = job;                 // งานหลักที่มีข้อมูลลูกเยอะ ต้องไม่ถูกแตะ
  const victim = context.createJobFromArrival({
    token: paintToken,
    payloadJson: JSON.stringify({
      sourceType: 'BL', blType: 'SWB', product: 'DELETE ME', vessel: 'V-DEL', voyage: '9S',
      eta: '2026-09-09',
      bls: [{ blNo: 'DELETE0001', shipperId: '', shipperName: 'AE TRADING COMPANY' }],
      containers: [{ containerNo: 'DELC0001', containerType: '40"', sealNo: 'S9' }]
    }),
    fileBlob: new MockBlob('to-delete.pdf', 'application/pdf', Buffer.from('bye'))
  }).job;

  const countFor = (sheet, jobId) => context.getTable_(sheet).filter((r) => r.jobId === jobId).length;
  assert.ok(countFor('BLS', victim.id) > 0);
  assert.ok(countFor('CONTAINERS', victim.id) > 0);
  assert.ok(countFor('FILES', victim.id) > 0);

  const jobsBefore = context.getTable_('JOBS').length;
  const keepBlsBefore = countFor('BLS', keepJob.id);
  const keepFilesBefore = countFor('FILES', keepJob.id);

  context.JOBS_TO_DELETE = [victim.jobNo];
  const preview = context.previewJobDeletion();
  assert.ok(String(preview).includes(victim.jobNo), 'preview ต้องเอ่ยถึงงานที่จะลบ');
  assert.equal(context.getTable_('JOBS').length, jobsBefore, 'preview ต้องไม่ลบอะไรเลย');

  const removed = context.deleteJobsPermanently();
  assert.equal(removed.deletedJobs.length, 1);
  assert.equal(context.getTable_('JOBS').length, jobsBefore - 1);
  assert.equal(context.findById_('JOBS', victim.id), null);
  ['BLS', 'CONTAINERS', 'FILES', 'APPROVALS', 'STATUS_HISTORY', 'CUSTOMS_ENTRIES'].forEach((sheet) => {
    assert.equal(countFor(sheet, victim.id), 0, sheet + ' ยังเหลือข้อมูลของงานที่ลบไปแล้ว');
  });

  // งานอื่นต้องไม่โดนหางเลข
  assert.ok(context.findById_('JOBS', keepJob.id));
  assert.equal(countFor('BLS', keepJob.id), keepBlsBefore);
  assert.equal(countFor('FILES', keepJob.id), keepFilesBefore);

  // ลบซ้ำต้องแจ้งว่าไม่พบ ไม่ใช่ลบมั่ว
  expectAppError(() => context.deleteJobsPermanently(), 'NOT_FOUND');

  const setupRerun = context.setupSystem_();
  assert.equal(setupRerun.ok, true);
  assert.equal(setupRerun.temporaryPassword, '');
  assert.ok(context.findById_('JOBS', job.id));
  assert.equal(context.getTable_('_USERS').length, 4);

  console.log('PASS gas-core: AN/BL intake, auth, approval gates, Draft sequence, Invoice alert/ack, release, setup rerun, master defaults, quick-add shipper, hub draft + customs round-trip, job deletion');
}());
