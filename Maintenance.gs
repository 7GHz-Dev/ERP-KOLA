/**
 * เครื่องมือย้ายการอ้างอิงไฟล์ให้ตัดขาดจากโฟลเดอร์/บัญชีเดิม
 *
 * ใช้เมื่อเปลี่ยน APP_CONFIG.DRIVE_FOLDER_ID ไปยังโฟลเดอร์ใหม่ที่มีสำเนาไฟล์ครบแล้ว
 * ชีต FILES จะยังเก็บ driveFileId ที่ชี้ไปยังไฟล์ในโฟลเดอร์เดิมอยู่
 * ฟังก์ชันนี้จะจับคู่ไฟล์ในโฟลเดอร์ใหม่แล้วอัปเดต driveFileId / driveFolderId ให้
 *
 * วิธีใช้ (รันจาก Apps Script editor เท่านั้น ไม่เปิดผ่าน API):
 *   1) previewDriveFileRemap()  - ดูผลก่อน ไม่แก้ข้อมูลใด ๆ
 *   2) applyDriveFileRemap()    - แก้จริง หลังจากตรวจผลข้อ 1 แล้วพอใจ
 *
 * การจับคู่ใช้ path เดียวกับตอนอัปโหลด:
 *   โฟลเดอร์ใหม่ / {jobNo}_{jobId} / {CATEGORY} / {jobNo}_{CATEGORY}_v{version}_{fileName}
 * และตรวจขนาดไฟล์ซ้ำอีกชั้นก่อนยอมอัปเดต
 */

function driveFileRemapPlan_() {
  var root = DriveApp.getFolderById(APP_CONFIG.DRIVE_FOLDER_ID);
  var jobsById = {};
  getTable_(APP_CONFIG.SHEETS.JOBS).forEach(function (job) {
    jobsById[job.id] = job;
  });

  var plan = { alreadyOk: [], toUpdate: [], missing: [], sizeMismatch: [] };

  getTable_(APP_CONFIG.SHEETS.FILES).forEach(function (record) {
    var job = jobsById[record.jobId];
    if (!job) {
      plan.missing.push({ recordId: record.id, fileName: record.fileName, reason: 'ไม่พบ Job ' + record.jobId });
      return;
    }

    var version = toNumber_(record.version, 1);
    var folderName = sanitizeFileName_(job.jobNo + '_' + job.id);
    var storedName = sanitizeFileName_(job.jobNo + '_' + record.category + '_v' + version + '_' + record.fileName);
    var label = job.jobNo + ' / ' + record.category + ' v' + version;

    var jobIterator = root.getFoldersByName(folderName);
    if (!jobIterator.hasNext()) {
      plan.missing.push({ recordId: record.id, fileName: storedName, reason: 'ไม่พบโฟลเดอร์ ' + folderName, label: label });
      return;
    }
    var jobFolder = jobIterator.next();

    var categoryIterator = jobFolder.getFoldersByName(record.category);
    if (!categoryIterator.hasNext()) {
      plan.missing.push({ recordId: record.id, fileName: storedName, reason: 'ไม่พบโฟลเดอร์หมวด ' + record.category, label: label });
      return;
    }
    var categoryFolder = categoryIterator.next();

    var fileIterator = categoryFolder.getFilesByName(storedName);
    if (!fileIterator.hasNext()) {
      plan.missing.push({ recordId: record.id, fileName: storedName, reason: 'ไม่พบไฟล์ในโฟลเดอร์ใหม่', label: label });
      return;
    }
    var target = fileIterator.next();

    if (String(target.getId()) === String(record.driveFileId)) {
      plan.alreadyOk.push({ recordId: record.id, fileName: storedName, label: label });
      return;
    }

    var expectedSize = toNumber_(record.sizeBytes, 0);
    var actualSize = target.getSize();
    if (expectedSize && actualSize !== expectedSize) {
      plan.sizeMismatch.push({
        recordId: record.id, fileName: storedName, label: label,
        reason: 'ขนาดไม่ตรง คาด ' + expectedSize + ' แต่พบ ' + actualSize
      });
      return;
    }

    plan.toUpdate.push({
      recordId: record.id,
      label: label,
      fileName: storedName,
      oldFileId: record.driveFileId,
      newFileId: target.getId(),
      newFolderId: categoryFolder.getId()
    });
  });

  return plan;
}

function logRemapPlan_(plan, title) {
  var lines = [];
  lines.push('===== ' + title + ' =====');
  lines.push('โฟลเดอร์ปลายทาง: ' + APP_CONFIG.DRIVE_FOLDER_ID);
  lines.push('ชี้ถูกอยู่แล้ว : ' + plan.alreadyOk.length);
  lines.push('ต้องอัปเดต     : ' + plan.toUpdate.length);
  lines.push('หาไฟล์ไม่เจอ   : ' + plan.missing.length);
  lines.push('ขนาดไม่ตรง     : ' + plan.sizeMismatch.length);

  if (plan.toUpdate.length) {
    lines.push('');
    lines.push('-- รายการที่จะอัปเดต --');
    plan.toUpdate.forEach(function (item) {
      lines.push('  ' + item.label + ' | ' + item.fileName);
      lines.push('      ' + item.oldFileId + '  ->  ' + item.newFileId);
    });
  }
  if (plan.missing.length) {
    lines.push('');
    lines.push('-- หาไฟล์ในโฟลเดอร์ใหม่ไม่เจอ (ไม่ถูกแตะต้อง) --');
    plan.missing.forEach(function (item) {
      lines.push('  ' + (item.label || item.recordId) + ' | ' + item.fileName + ' | ' + item.reason);
    });
  }
  if (plan.sizeMismatch.length) {
    lines.push('');
    lines.push('-- ขนาดไฟล์ไม่ตรง (ไม่ถูกแตะต้อง) --');
    plan.sizeMismatch.forEach(function (item) {
      lines.push('  ' + item.label + ' | ' + item.fileName + ' | ' + item.reason);
    });
  }

  var text = lines.join('\n');
  Logger.log(text);
  return text;
}

/** ดูผลก่อน ไม่แก้ข้อมูลใด ๆ */
function previewDriveFileRemap() {
  var plan = driveFileRemapPlan_();
  logRemapPlan_(plan, 'ตรวจสอบก่อนย้าย (ยังไม่แก้ข้อมูล)');
  return {
    alreadyOk: plan.alreadyOk.length,
    toUpdate: plan.toUpdate.length,
    missing: plan.missing.length,
    sizeMismatch: plan.sizeMismatch.length
  };
}

/** แก้จริง อัปเดต driveFileId / driveFolderId ในชีต FILES */
function applyDriveFileRemap() {
  return withScriptLock_(function () {
    var plan = driveFileRemapPlan_();
    logRemapPlan_(plan, 'เริ่มย้ายจริง');

    var updated = 0;
    var failed = [];
    plan.toUpdate.forEach(function (item) {
      try {
        updateRecord_(APP_CONFIG.SHEETS.FILES, item.recordId, {
          driveFileId: item.newFileId,
          driveFolderId: item.newFolderId
        });
        updated += 1;
      } catch (error) {
        failed.push(item.label + ' | ' + (error && error.message ? error.message : error));
      }
    });

    var summary = {
      updated: updated,
      skippedAlreadyOk: plan.alreadyOk.length,
      stillMissing: plan.missing.length,
      sizeMismatch: plan.sizeMismatch.length,
      failed: failed
    };
    Logger.log('ผลการย้าย: ' + JSON.stringify(summary));
    return summary;
  });
}

/**
 * ตรวจว่ายังมี record ไหนชี้ออกนอกโฟลเดอร์ปลายทางอีกหรือไม่
 * ใช้ยืนยันหลังรัน applyDriveFileRemap() ว่าตัดขาดสมบูรณ์แล้ว
 */
function auditDriveFileLocations() {
  var rootId = String(APP_CONFIG.DRIVE_FOLDER_ID);
  var outside = [];
  var unreadable = [];
  var inside = 0;

  getTable_(APP_CONFIG.SHEETS.FILES).forEach(function (record) {
    var fileId = cleanText_(record.driveFileId);
    if (!fileId) return;
    try {
      var file = DriveApp.getFileById(fileId);
      if (isUnderRoot_(file, rootId)) inside += 1;
      else outside.push(record.id + ' | ' + record.fileName + ' | ' + fileId);
    } catch (error) {
      unreadable.push(record.id + ' | ' + record.fileName + ' | ' + fileId);
    }
  });

  var result = { insideNewRoot: inside, outsideNewRoot: outside, unreadable: unreadable };
  Logger.log(JSON.stringify(result, null, 2));
  return result;
}

function isUnderRoot_(file, rootId) {
  var seen = {};
  var queue = [];
  var parents = file.getParents();
  while (parents.hasNext()) queue.push(parents.next());

  while (queue.length) {
    var folder = queue.shift();
    var id = folder.getId();
    if (id === rootId) return true;
    if (seen[id]) continue;
    seen[id] = true;
    var up = folder.getParents();
    while (up.hasNext()) queue.push(up.next());
  }
  return false;
}

/* ============================================================
 * ลบ Job ออกจากฐานข้อมูลแบบถาวร — เครื่องมือใช้ครั้งคราว
 *
 * ใช้เมื่อมีรายการทดสอบหรือรายการผิดที่ต้องเอาออกจริง ๆ
 * รันจาก Apps Script editor เท่านั้น ไม่เปิดผ่าน API เด็ดขาด
 *
 * ขั้นตอน:
 *   1) previewJobDeletion()   ดูว่าจะลบอะไรบ้าง ไม่แตะข้อมูล
 *   2) deleteJobsPermanently() ลบจริง
 *
 * ไม่ลบ ACTIVITY_LOG เพราะเป็นร่องรอยการใช้งานที่ควรเก็บไว้ตรวจย้อนหลัง
 * โฟลเดอร์ Drive ของงานจะถูกย้ายลงถังขยะ (กู้คืนได้ 30 วัน) ไม่ได้ลบถาวร
 * ============================================================ */

var JOBS_TO_DELETE = ['KOLA-2026-0004', 'KOLA-2026-0006'];

var JOB_CHILD_SHEETS = [
  APP_CONFIG.SHEETS.BLS,
  APP_CONFIG.SHEETS.CONTAINERS,
  APP_CONFIG.SHEETS.FILES,
  APP_CONFIG.SHEETS.APPROVALS,
  APP_CONFIG.SHEETS.STATUS_HISTORY,
  APP_CONFIG.SHEETS.DO_HANDOFFS,
  APP_CONFIG.SHEETS.CUSTOMS_ENTRIES,
  APP_CONFIG.SHEETS.INSPECTION_RELEASES,
  APP_CONFIG.SHEETS.EOFFICE_REQUESTS
];

function jobDeletionPlan_() {
  var wanted = JOBS_TO_DELETE.map(function (value) { return normalizeKey_(value); });
  var allJobs = getTable_(APP_CONFIG.SHEETS.JOBS);
  var targets = allJobs.filter(function (row) {
    return wanted.indexOf(normalizeKey_(row.jobNo)) !== -1;
  });

  var found = targets.map(function (row) { return normalizeKey_(row.jobNo); });
  var notFound = JOBS_TO_DELETE.filter(function (value) {
    return found.indexOf(normalizeKey_(value)) === -1;
  });

  return {
    targets: targets.map(function (job) {
      var related = {};
      JOB_CHILD_SHEETS.forEach(function (sheetName) {
        related[sheetName] = getTableSafe_(sheetName).filter(function (row) {
          return String(row.jobId) === String(job.id);
        });
      });
      return { job: job, related: related };
    }),
    notFound: notFound
  };
}

function previewJobDeletion() {
  var plan = jobDeletionPlan_();
  var lines = ['===== ตรวจก่อนลบ (ยังไม่แตะข้อมูล) ====='];
  if (plan.notFound.length) lines.push('หาไม่เจอ: ' + plan.notFound.join(', '));

  plan.targets.forEach(function (target) {
    lines.push('');
    lines.push('Job ' + target.job.jobNo + '  (' + target.job.id + ')');
    lines.push('   BL No.   : ' + (target.job.blNo || '-'));
    lines.push('   สถานะ    : ' + (target.job.status || '-'));
    var total = 0;
    JOB_CHILD_SHEETS.forEach(function (sheetName) {
      var count = target.related[sheetName].length;
      total += count;
      if (count) lines.push('   ' + sheetName + ': ' + count + ' แถว');
    });
    lines.push('   รวมข้อมูลลูก: ' + total + ' แถว');
    var fileCount = target.related[APP_CONFIG.SHEETS.FILES].length;
    if (fileCount) lines.push('   ไฟล์ใน Drive ที่จะถูกย้ายลงถังขยะ: ' + fileCount + ' ไฟล์ (พร้อมโฟลเดอร์ของงาน)');
  });

  if (!plan.targets.length) lines.push('ไม่พบงานที่ตรงกับ JOBS_TO_DELETE');
  var text = lines.join('\n');
  Logger.log(text);
  return text;
}

function deleteJobsPermanently() {
  var activeEmail = cleanText_(Session.getActiveUser().getEmail());
  assert_(activeEmail, 'FORBIDDEN', 'ต้องรันจาก Apps Script editor เท่านั้น');

  return withScriptLock_(function () {
    var plan = jobDeletionPlan_();
    assert_(plan.targets.length, 'NOT_FOUND', 'ไม่พบงานที่ตรงกับ JOBS_TO_DELETE');

    var summary = { deletedJobs: [], deletedRows: 0, trashedFolders: 0, notFound: plan.notFound };

    plan.targets.forEach(function (target) {
      // ย้ายโฟลเดอร์ของงานลงถังขยะก่อน ถ้าพลาดจะได้ยังไม่เสียข้อมูลในชีต
      try {
        var folderName = sanitizeFileName_(target.job.jobNo + '_' + target.job.id);
        var iterator = DriveApp.getFolderById(APP_CONFIG.DRIVE_FOLDER_ID).getFoldersByName(folderName);
        while (iterator.hasNext()) {
          iterator.next().setTrashed(true);
          summary.trashedFolders += 1;
        }
      } catch (error) {
        Logger.log('ย้ายโฟลเดอร์ของ ' + target.job.jobNo + ' ลงถังขยะไม่สำเร็จ: ' + error.message);
      }

      JOB_CHILD_SHEETS.forEach(function (sheetName) {
        var ids = target.related[sheetName].map(function (row) { return String(row.id); });
        summary.deletedRows += deleteRowsByIds_(sheetName, ids);
      });
      summary.deletedRows += deleteRowsByIds_(APP_CONFIG.SHEETS.JOBS, [String(target.job.id)]);
      summary.deletedJobs.push(target.job.jobNo);
    });

    Logger.log('ผลการลบ: ' + JSON.stringify(summary, null, 2));
    return summary;
  });
}

/** ลบแถวตาม id โดยไล่จากแถวล่างขึ้นบน มิฉะนั้นเลขแถวที่เหลือจะเลื่อนแล้วลบผิดแถว */
function deleteRowsByIds_(sheetName, ids) {
  if (!ids.length || !sheetExists_(sheetName)) return 0;
  var sheet = getSheet_(sheetName);
  var rowNumbers = getTable_(sheetName).filter(function (row) {
    return ids.indexOf(String(row.id)) !== -1;
  }).map(function (row) {
    return row._rowNumber;
  }).sort(function (a, b) {
    return b - a;
  });
  rowNumbers.forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });
  return rowNumbers.length;
}

/* ============================================================
 * ส่งออกข้อมูลทั้งหมดเพื่อย้ายไประบบใหม่ (v2 บน Postgres)
 *
 * อ่านอย่างเดียว ไม่แก้อะไรทั้งสิ้น จำกัดสิทธิ์ไว้ที่ ADMIN
 * เรียกผ่าน API ได้เพื่อให้สคริปต์ฝั่ง v2 ดึงไปได้โดยไม่ต้องเปิดสเปรดชีตให้ใคร
 * ============================================================ */
function exportAllData(token, sheetNames) {
  requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  var names = Array.isArray(sheetNames) && sheetNames.length
    ? sheetNames
    : Object.keys(SHEET_SCHEMAS);

  var output = { exportedAt: nowIso_(), version: APP_CONFIG.VERSION, tables: {} };
  names.forEach(function (sheetName) {
    if (!SHEET_SCHEMAS[sheetName]) return;
    output.tables[sheetName] = getTableSafe_(sheetName).map(function (row) {
      var copy = serializeRecord_(row);
      delete copy._rowNumber;
      return copy;
    });
  });
  return output;
}

/** นับจำนวนแถวแต่ละชีต ใช้ตรวจว่าย้ายข้อมูลครบไหม */
function exportRowCounts(token) {
  requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  var counts = {};
  Object.keys(SHEET_SCHEMAS).forEach(function (sheetName) {
    counts[sheetName] = getTableSafe_(sheetName).length;
  });
  return counts;
}
