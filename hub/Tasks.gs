/**
 * งานฝั่ง KOLA ERP
 */

/** ERP เรียกเพื่อส่งงานเข้าคิว คืน taskId กลับไปให้เก็บไว้อ้างอิง */
function hubSubmitTask(payload) {
  payload = payload || {};
  var type = hubText_(payload.type, 40).toUpperCase();
  hubAssert_(HUB_CONFIG.TASK_TYPES[type], 'VALIDATION', 'ประเภทงานไม่ถูกต้อง: ' + type);

  var jobRef = hubText_(payload.jobRef, 80);
  hubAssert_(jobRef, 'VALIDATION', 'ต้องระบุ jobRef');

  return hubLock_(function () {
    // งานเดิมที่ยังไม่จบของ job เดียวกันและประเภทเดียวกัน ให้ใช้ตัวเดิม กันกดซ้ำแล้วคิวบาน
    var existing = hubTable_(HUB_CONFIG.SHEETS.TASKS).filter(function (row) {
      return String(row.jobRef) === jobRef &&
        String(row.type) === type &&
        (row.status === HUB_CONFIG.STATUS.QUEUED || row.status === HUB_CONFIG.STATUS.PROCESSING);
    })[0];
    if (existing) {
      return { taskId: existing.id, status: existing.status, reused: true };
    }

    var stored = payload.file ? hubStoreInputFile_(payload.file) : null;
    var now = hubNow_();
    var task = {
      id: hubId_('TASK'),
      type: type,
      status: HUB_CONFIG.STATUS.QUEUED,
      jobRef: jobRef,
      jobNo: hubText_(payload.jobNo, 60),
      payload: JSON.stringify(payload.data || {}),
      inputFileId: stored ? stored.id : '',
      inputFileName: stored ? stored.name : '',
      inputMimeType: stored ? stored.mimeType : '',
      resultRefNo: '',
      resultEntryNo: '',
      resultFileId: '',
      resultFileName: '',
      resultMimeType: '',
      error: '',
      attempts: 0,
      claimedBy: '',
      claimedAt: '',
      createdAt: now,
      updatedAt: now,
      completedAt: ''
    };
    hubAppend_(HUB_CONFIG.SHEETS.TASKS, task);
    hubLog_(task.id, 'ERP', 'SUBMIT', { type: type, jobRef: jobRef, file: task.inputFileName });
    return { taskId: task.id, status: task.status, reused: false };
  });
}

/** ERP เรียกเพื่อดูสถานะ/ผลลัพธ์ ทีละงานหรือหลาย jobRef พร้อมกัน */
function hubGetTasks(payload) {
  payload = payload || {};
  var taskId = hubText_(payload.taskId, 80);
  var jobRefs = Array.isArray(payload.jobRefs) ? payload.jobRefs.map(function (v) { return hubText_(v, 80); }) : [];
  var rows = hubTable_(HUB_CONFIG.SHEETS.TASKS);

  var matched = rows.filter(function (row) {
    if (taskId) return String(row.id) === taskId;
    if (jobRefs.length) return jobRefs.indexOf(String(row.jobRef)) >= 0;
    return true;
  });

  return { tasks: matched.map(hubPublicTask_) };
}

/** ERP เรียกเพื่อดึงไฟล์ผลลัพธ์ (เช่น ใบขนสินค้าขาเข้า) กลับไปเก็บใน Drive ของตัวเอง */
function hubDownloadResultFile(payload) {
  payload = payload || {};
  var task = hubFindById_(HUB_CONFIG.SHEETS.TASKS, hubText_(payload.taskId, 80));
  hubAssert_(task, 'NOT_FOUND', 'ไม่พบงาน');
  hubAssert_(hubText_(task.resultFileId), 'NOT_FOUND', 'งานนี้ยังไม่มีไฟล์ผลลัพธ์');
  var file = DriveApp.getFileById(task.resultFileId);
  var bytes = file.getBlob().getBytes();
  hubAssert_(bytes.length <= HUB_CONFIG.MAX_FILE_BYTES, 'FILE_TOO_LARGE', 'ไฟล์ใหญ่เกินกว่าจะส่งผ่าน API');
  return {
    fileName: task.resultFileName || file.getName(),
    mimeType: task.resultMimeType || file.getBlob().getContentType(),
    base64: Utilities.base64Encode(bytes)
  };
}

/**
 * งานฝั่ง Python worker
 */

/** worker เรียกเพื่อขอรับงานถัดไป ถ้าไม่มีงานคืน task = null */
function hubClaimNext(payload) {
  payload = payload || {};
  var type = hubText_(payload.type, 40).toUpperCase();
  var workerName = hubText_(payload.worker, 80) || 'worker';

  return hubLock_(function () {
    var staleBefore = Date.now() - HUB_CONFIG.CLAIM_TIMEOUT_MINUTES * 60 * 1000;
    var candidate = hubTable_(HUB_CONFIG.SHEETS.TASKS).filter(function (row) {
      if (type && String(row.type) !== type) return false;
      if (row.status === HUB_CONFIG.STATUS.QUEUED) return true;
      // งานที่ค้างสถานะ PROCESSING เกินเวลา ถือว่า worker เดิมตายไปแล้ว
      if (row.status === HUB_CONFIG.STATUS.PROCESSING) {
        var claimed = new Date(row.claimedAt).getTime();
        return isNaN(claimed) || claimed < staleBefore;
      }
      return false;
    }).sort(function (a, b) {
      return String(a.createdAt).localeCompare(String(b.createdAt));
    })[0];

    if (!candidate) return { task: null };

    var now = hubNow_();
    hubUpdate_(HUB_CONFIG.SHEETS.TASKS, candidate.id, {
      status: HUB_CONFIG.STATUS.PROCESSING,
      claimedBy: workerName,
      claimedAt: now,
      attempts: hubNumber_(candidate.attempts, 0) + 1,
      updatedAt: now
    });
    hubLog_(candidate.id, workerName, 'CLAIM', { type: candidate.type });

    var task = hubPublicTask_(candidate);
    task.status = HUB_CONFIG.STATUS.PROCESSING;
    return { task: task };
  });
}

/** worker เรียกเพื่อดึงไฟล์ input (เช่น Final Invoice xlsx) ไปประมวลผล */
function hubDownloadInputFile(payload) {
  payload = payload || {};
  var task = hubFindById_(HUB_CONFIG.SHEETS.TASKS, hubText_(payload.taskId, 80));
  hubAssert_(task, 'NOT_FOUND', 'ไม่พบงาน');
  hubAssert_(hubText_(task.inputFileId), 'NOT_FOUND', 'งานนี้ไม่มีไฟล์แนบ');
  var file = DriveApp.getFileById(task.inputFileId);
  var bytes = file.getBlob().getBytes();
  hubAssert_(bytes.length <= HUB_CONFIG.MAX_FILE_BYTES, 'FILE_TOO_LARGE', 'ไฟล์ใหญ่เกินกว่าจะส่งผ่าน API');
  return {
    fileName: task.inputFileName || file.getName(),
    mimeType: task.inputMimeType || file.getBlob().getContentType(),
    base64: Utilities.base64Encode(bytes)
  };
}

/** worker เรียกเมื่อทำงานเสร็จ ส่งผลลัพธ์กลับมาพักไว้ให้ ERP มาดึง */
function hubCompleteTask(payload) {
  payload = payload || {};
  var taskId = hubText_(payload.taskId, 80);
  var task = hubFindById_(HUB_CONFIG.SHEETS.TASKS, taskId);
  hubAssert_(task, 'NOT_FOUND', 'ไม่พบงาน');

  return hubLock_(function () {
    var stored = payload.file ? hubStoreResultFile_(payload.file) : null;
    var now = hubNow_();
    var patch = {
      status: HUB_CONFIG.STATUS.DONE,
      resultRefNo: hubText_(payload.refNo, 120),
      resultEntryNo: hubText_(payload.entryNo, 120),
      error: '',
      updatedAt: now,
      completedAt: now
    };
    if (stored) {
      patch.resultFileId = stored.id;
      patch.resultFileName = stored.name;
      patch.resultMimeType = stored.mimeType;
    }

    if (task.type === HUB_CONFIG.TASK_TYPES.DRAFT_ENTRY) {
      hubAssert_(patch.resultRefNo, 'VALIDATION', 'งาน DRAFT_ENTRY ต้องส่ง refNo กลับมา');
    } else if (task.type === HUB_CONFIG.TASK_TYPES.CUSTOMS_ENTRY) {
      hubAssert_(patch.resultEntryNo, 'VALIDATION', 'งาน CUSTOMS_ENTRY ต้องส่ง entryNo กลับมา');
    }

    hubUpdate_(HUB_CONFIG.SHEETS.TASKS, taskId, patch);
    hubLog_(taskId, hubText_(payload.worker, 80) || 'worker', 'COMPLETE', {
      refNo: patch.resultRefNo, entryNo: patch.resultEntryNo, file: patch.resultFileName || ''
    });
    return { ok: true, taskId: taskId, status: HUB_CONFIG.STATUS.DONE };
  });
}

/** worker เรียกเมื่อทำงานไม่สำเร็จ */
function hubFailTask(payload) {
  payload = payload || {};
  var taskId = hubText_(payload.taskId, 80);
  hubAssert_(hubFindById_(HUB_CONFIG.SHEETS.TASKS, taskId), 'NOT_FOUND', 'ไม่พบงาน');
  var now = hubNow_();
  hubUpdate_(HUB_CONFIG.SHEETS.TASKS, taskId, {
    status: HUB_CONFIG.STATUS.ERROR,
    error: hubText_(payload.error, 1000) || 'ไม่ระบุสาเหตุ',
    updatedAt: now,
    completedAt: now
  });
  hubLog_(taskId, hubText_(payload.worker, 80) || 'worker', 'FAIL', hubText_(payload.error, 500));
  return { ok: true, taskId: taskId, status: HUB_CONFIG.STATUS.ERROR };
}

/** เอางานที่ ERROR กลับเข้าคิวใหม่ */
function hubRetryTask(payload) {
  payload = payload || {};
  var taskId = hubText_(payload.taskId, 80);
  hubAssert_(hubFindById_(HUB_CONFIG.SHEETS.TASKS, taskId), 'NOT_FOUND', 'ไม่พบงาน');
  hubUpdate_(HUB_CONFIG.SHEETS.TASKS, taskId, {
    status: HUB_CONFIG.STATUS.QUEUED,
    error: '',
    claimedBy: '',
    claimedAt: '',
    updatedAt: hubNow_(),
    completedAt: ''
  });
  hubLog_(taskId, 'ERP', 'RETRY', {});
  return { ok: true, taskId: taskId, status: HUB_CONFIG.STATUS.QUEUED };
}

/**
 * ตัวช่วยภายใน
 */

function hubStoreFile_(file, folderName) {
  var base64 = hubText_(file.base64);
  hubAssert_(base64, 'VALIDATION', 'ไม่พบข้อมูลไฟล์');
  var bytes = Utilities.base64Decode(base64);
  hubAssert_(bytes.length > 0, 'VALIDATION', 'ไฟล์ว่าง');
  hubAssert_(bytes.length <= HUB_CONFIG.MAX_FILE_BYTES, 'FILE_TOO_LARGE',
    'ไฟล์ต้องไม่เกิน ' + Math.round(HUB_CONFIG.MAX_FILE_BYTES / 1024 / 1024) + ' MB');

  var name = hubText_(file.name, 180).replace(/[\\\/:*?"<>|]/g, '_') || 'upload';
  var mimeType = hubText_(file.mimeType) || 'application/octet-stream';

  var root = hubFolder_();
  var iterator = root.getFoldersByName(folderName);
  var folder = iterator.hasNext() ? iterator.next() : root.createFolder(folderName);
  var created = folder.createFile(Utilities.newBlob(bytes, mimeType, name));
  return { id: created.getId(), name: name, mimeType: mimeType };
}

function hubStoreInputFile_(file) {
  return hubStoreFile_(file, 'input');
}

function hubStoreResultFile_(file) {
  return hubStoreFile_(file, 'result');
}

/** ตัดฟิลด์ภายในออก ไม่ส่ง id ของไฟล์ Drive ให้ผู้เรียกเห็นโดยไม่จำเป็น */
function hubPublicTask_(row) {
  var parsedPayload = {};
  try {
    parsedPayload = JSON.parse(row.payload || '{}');
  } catch (ignore) {
    parsedPayload = {};
  }
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    jobRef: row.jobRef,
    jobNo: row.jobNo,
    data: parsedPayload,
    hasInputFile: Boolean(hubText_(row.inputFileId)),
    inputFileName: row.inputFileName,
    refNo: row.resultRefNo,
    entryNo: row.resultEntryNo,
    hasResultFile: Boolean(hubText_(row.resultFileId)),
    resultFileName: row.resultFileName,
    error: row.error,
    attempts: hubNumber_(row.attempts, 0),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt
  };
}
