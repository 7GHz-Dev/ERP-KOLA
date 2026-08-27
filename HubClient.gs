/**
 * ตัวเชื่อมกับ KOLA Automation Hub
 *
 * ERP ไม่ได้คุยกับโปรแกรม Python โดยตรง แต่ฝากงานไว้ที่ Hub แล้วมาดึงผลทีหลัง
 * ทำให้ทั้งสองฝั่งไม่ต้องออนไลน์พร้อมกัน และ ERP ไม่ต้องเปิดช่องให้ใครยิงเข้ามา
 *
 * URL และ API key ตั้งที่หน้า Master Data -> ค่าตั้งต้น (HUB_URL / HUB_API_KEY)
 */

function hubConfigured_() {
  return Boolean(cleanText_(settingValue_(SETTING_KEYS.HUB_URL, '')) &&
    cleanText_(settingValue_(SETTING_KEYS.HUB_API_KEY, '')));
}

function hubCall_(fn, args) {
  var url = cleanText_(settingValue_(SETTING_KEYS.HUB_URL, ''));
  var key = cleanText_(settingValue_(SETTING_KEYS.HUB_API_KEY, ''));
  assert_(url && key, 'HUB_NOT_CONFIGURED',
    'ยังไม่ได้ตั้งค่า Hub กรุณาใส่ HUB_URL และ HUB_API_KEY ที่ Master Data → ค่าตั้งต้น');

  var response = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ key: key, fn: fn, args: args || {} }),
    muteHttpExceptions: true,
    followRedirects: true
  });

  var text = response.getContentText();
  var code = response.getResponseCode();
  assert_(code === 200, 'HUB_HTTP_' + code, 'เรียก Hub ไม่สำเร็จ (HTTP ' + code + ') ' + text.slice(0, 200));

  var body;
  try {
    body = JSON.parse(text);
  } catch (error) {
    appError_('HUB_BAD_RESPONSE', 'Hub ตอบกลับไม่ใช่ JSON: ' + text.slice(0, 200));
  }
  assert_(body.ok, 'HUB_ERROR', String(body.error || 'Hub แจ้งข้อผิดพลาด'));
  return body.data;
}

/** ส่งไฟล์ Final Invoice ขึ้น Hub เพื่อให้ automate สร้าง Draft ใบขน */
function sendDraftToHub(token, jobId) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');

  var file = currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.FINAL_INVOICE);
  assert_(file, 'FILE_REQUIRED', 'ต้องมีไฟล์ Final Invoice ก่อนส่งสร้าง Draft');

  var driveFile = DriveApp.getFileById(file.driveFileId);
  var blob = driveFile.getBlob();

  var result = hubCall_('submitTask', {
    type: 'DRAFT_ENTRY',
    jobRef: job.id,
    jobNo: job.jobNo,
    data: { blNo: job.blNo, jobNo: job.jobNo },
    file: {
      name: file.fileName || driveFile.getName(),
      mimeType: blob.getContentType() || 'application/octet-stream',
      base64: Utilities.base64Encode(blob.getBytes())
    }
  });

  updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
    draftTaskId: result.taskId,
    draftStatus: 'SENT_TO_HUB',
    updatedBy: session.user.id,
    updatedAt: nowIso_()
  });
  logActivity_(session.user.id, 'SEND_DRAFT_TO_HUB', 'JOB', job.id, { taskId: result.taskId });
  return { taskId: result.taskId, reused: Boolean(result.reused) };
}

/** ส่งเลข Ref No. ขึ้น Hub เพื่อให้ automate ทำใบขนสินค้า */
function sendCustomsToHub(token, jobId) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.FAH]);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');

  var refNo = cleanText_(job.draftRefNo, 120);
  assert_(refNo, 'REF_REQUIRED', 'ยังไม่มีเลข Ref No. ของงานนี้');

  var result = hubCall_('submitTask', {
    type: 'CUSTOMS_ENTRY',
    jobRef: job.id,
    jobNo: job.jobNo,
    data: { refNo: refNo, blNo: job.blNo }
  });

  updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
    customsTaskId: result.taskId,
    updatedBy: session.user.id,
    updatedAt: nowIso_()
  });
  logActivity_(session.user.id, 'SEND_CUSTOMS_TO_HUB', 'JOB', job.id, { taskId: result.taskId, refNo: refNo });
  return { taskId: result.taskId, reused: Boolean(result.reused) };
}

/**
 * ดึงผลลัพธ์จาก Hub มาลงระบบ
 *
 * เรียกซ้ำได้ปลอดภัย งานที่ผลถูกนำเข้าแล้วจะถูกข้าม โดยดูจากค่าที่บันทึกไว้ใน Job
 * ไม่ได้ลบงานฝั่ง Hub ทิ้ง เพื่อให้ยังย้อนดูประวัติได้
 */
function syncHubResults(token) {
  var session = requireSession_(token);
  if (!hubConfigured_()) return { applied: 0, skipped: 0, configured: false };

  var jobs = getTable_(APP_CONFIG.SHEETS.JOBS).filter(function (job) {
    if (toBool_(job.isArchived)) return false;
    var waitingDraft = cleanText_(job.draftTaskId) && !cleanText_(job.draftRefNo);
    var waitingCustoms = cleanText_(job.customsTaskId) && job.customsStatus !== 'FILED';
    return waitingDraft || waitingCustoms;
  });
  if (!jobs.length) return { applied: 0, skipped: 0, configured: true };

  var data = hubCall_('getTasks', { jobRefs: jobs.map(function (job) { return job.id; }) });
  var byId = {};
  (data.tasks || []).forEach(function (task) { byId[task.id] = task; });

  var applied = 0;
  var errors = [];
  jobs.forEach(function (job) {
    try {
      var draftTask = byId[cleanText_(job.draftTaskId)];
      if (draftTask && draftTask.status === 'DONE' && cleanText_(draftTask.refNo) && !cleanText_(job.draftRefNo)) {
        applyHubDraftResult_(session, job, draftTask);
        applied += 1;
      }
      var customsTask = byId[cleanText_(job.customsTaskId)];
      if (customsTask && customsTask.status === 'DONE' && cleanText_(customsTask.entryNo) && job.customsStatus !== 'FILED') {
        applyHubCustomsResult_(session, job, customsTask);
        applied += 1;
      }
    } catch (error) {
      errors.push(job.jobNo + ': ' + (error && error.message ? error.message : error));
    }
  });

  return { applied: applied, skipped: jobs.length - applied, configured: true, errors: errors };
}

function applyHubDraftResult_(session, job, task) {
  withScriptLock_(function () {
    var now = nowIso_();
    var existing = recordsForJob_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, job.id)[0];
    var record = {
      id: existing ? existing.id : newId_('CUS'),
      jobId: job.id,
      entryNo: task.refNo,
      status: 'DRAFT',
      declarationNo: existing ? existing.declarationNo : '',
      amount: existing ? existing.amount : 0,
      note: 'สร้างโดย Automation Hub',
      createdBy: existing ? existing.createdBy : session.user.id,
      createdAt: existing ? existing.createdAt : now,
      filedBy: existing ? existing.filedBy : '',
      filedAt: existing ? existing.filedAt : '',
      updatedAt: now
    };
    if (existing) {
      updateRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, existing.id, record);
    } else {
      appendRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, record);
    }
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      draftRefNo: task.refNo,
      draftStatus: 'CREATED',
      customsStatus: 'DRAFT',
      updatedBy: session.user.id,
      updatedAt: now
    });
    logActivity_(session.user.id, 'HUB_DRAFT_RESULT', 'JOB', job.id, { refNo: task.refNo, taskId: task.id });
  });
}

function applyHubCustomsResult_(session, job, task) {
  withScriptLock_(function () {
    var now = nowIso_();

    // ดึงไฟล์ใบขนที่ Hub ทำเสร็จมาเก็บใน Drive ของงานนี้ ไม่พึ่งไฟล์ที่ค้างอยู่ฝั่ง Hub
    if (task.hasResultFile) {
      var payload = hubCall_('downloadResultFile', { taskId: task.id });
      var blob = Utilities.newBlob(
        Utilities.base64Decode(payload.base64),
        payload.mimeType || 'application/pdf',
        payload.fileName || (task.entryNo + '.pdf')
      );
      storeGeneratedJobFile_(session, job, APP_CONFIG.FILE_CATEGORIES.CUSTOMS_ENTRY_DOC, blob,
        'ใบขนสินค้าขาเข้าเลขที่ ' + task.entryNo);
    }

    var existing = recordsForJob_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, job.id)[0];
    if (existing) {
      updateRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, existing.id, {
        declarationNo: task.entryNo,
        status: 'FILED',
        filedBy: session.user.id,
        filedAt: now,
        updatedAt: now
      });
    } else {
      appendRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, {
        id: newId_('CUS'), jobId: job.id, entryNo: cleanText_(job.draftRefNo), status: 'FILED',
        declarationNo: task.entryNo, amount: 0, note: 'สร้างโดย Automation Hub',
        createdBy: session.user.id, createdAt: now, filedBy: session.user.id, filedAt: now, updatedAt: now
      });
    }

    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      customsStatus: 'FILED',
      updatedBy: session.user.id,
      updatedAt: now
    });
    setJobStatus_(job, job.releaseStatus === 'RELEASED' ? 'RELEASED' : 'CUSTOMS_FILED',
      'ได้เลขใบขนจาก Automation Hub', session.user.id);
    logActivity_(session.user.id, 'HUB_CUSTOMS_RESULT', 'JOB', job.id, { entryNo: task.entryNo, taskId: task.id });
  });
}
