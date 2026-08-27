function uploadJobFile(formObject) {
  formObject = formObject || {};
  var category = cleanText_(formObject.category).toUpperCase();
  var allowedRoles = uploadRolesForCategory_(category);
  var session = requireSession_(formObject.token, allowedRoles);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, formObject.jobId);
  assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job ที่ต้องการอัปโหลดไฟล์');

  var blob = formObject.fileBlob;
  assert_(blob && typeof blob.getBytes === 'function', 'VALIDATION', 'กรุณาเลือกไฟล์');
  var bytes = blob.getBytes();
  assert_(bytes.length > 0, 'VALIDATION', 'ไฟล์ไม่มีข้อมูล');
  assert_(bytes.length <= APP_CONFIG.MAX_FILE_BYTES, 'FILE_TOO_LARGE', 'ไฟล์ต้องมีขนาดไม่เกิน 8 MB');

  var originalName = sanitizeFileName_(blob.getName());
  assert_(!/\.(exe|cmd|bat|com|js|vbs|ps1|sh)$/i.test(originalName),
    'FILE_TYPE_NOT_ALLOWED', 'ไม่อนุญาตไฟล์ชนิดนี้');
  var changeReason = cleanText_(formObject.changeReason, 500);
  var note = cleanText_(formObject.note, 500);

  return withScriptLock_(function () {
    var current = currentFile_(job.id, category);
    if (category === APP_CONFIG.FILE_CATEGORIES.INVOICE_GOODS && current) {
      assert_(changeReason, 'CHANGE_REASON_REQUIRED', 'การเปลี่ยนไฟล์ Invoice ต้องระบุเหตุผล');
    }

    var version = current ? toNumber_(current.version, 0) + 1 : 1;
    var folder = getJobCategoryFolder_(job, category);
    var storedName = sanitizeFileName_(job.jobNo + '_' + category + '_v' + version + '_' + originalName);
    blob.setName(storedName);
    var driveFile = folder.createFile(blob);
    var fileRecord = {
      id: newId_('FIL'),
      jobId: job.id,
      category: category,
      version: version,
      driveFileId: driveFile.getId(),
      driveFolderId: folder.getId(),
      fileName: originalName,
      mimeType: blob.getContentType() || 'application/octet-stream',
      sizeBytes: bytes.length,
      note: note,
      changeReason: current ? changeReason : '',
      isCurrent: true,
      isAcknowledged: category !== APP_CONFIG.FILE_CATEGORIES.INVOICE_GOODS || !current,
      acknowledgedBy: '',
      acknowledgedAt: '',
      supersededBy: '',
      uploadedBy: session.user.id,
      uploadedAt: nowIso_()
    };

    try {
      appendRecord_(APP_CONFIG.SHEETS.FILES, fileRecord);
      if (current) {
        updateRecord_(APP_CONFIG.SHEETS.FILES, current.id, {
          isCurrent: false,
          supersededBy: fileRecord.id
        });
      }
      if (category === APP_CONFIG.FILE_CATEGORIES.INVOICE_GOODS && current) {
        updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
          hasInvoiceAlert: true,
          updatedBy: session.user.id,
          updatedAt: nowIso_()
        });
      }
      logActivity_(session.user.id, current ? 'REPLACE_FILE' : 'UPLOAD_FILE', 'FILE', fileRecord.id, {
        jobId: job.id,
        category: category,
        version: version,
        changeReason: fileRecord.changeReason
      });
      if (category === APP_CONFIG.FILE_CATEGORIES.FINAL_INVOICE &&
          latestApprovalStatus_(job.id, APP_CONFIG.APPROVAL_TYPES.AN) === 'APPROVED') {
        autoRequestApproval_(session, job, APP_CONFIG.APPROVAL_TYPES.FN);
      }
    } catch (error) {
      driveFile.setTrashed(true);
      throw error;
    }
    return serializeRecord_(fileRecord);
  });
}

/**
 * เก็บไฟล์ที่ระบบสร้างเอง (คำร้อง, ชุด E-Office ที่ merge แล้ว, ใบขนที่ได้จาก Hub)
 * ลงช่องทางเดียวกับไฟล์ที่ผู้ใช้อัปโหลด เพื่อให้ขึ้นในรายการไฟล์ของ Job และดาวน์โหลดได้ตามปกติ
 *
 * ต่างจาก uploadJobFile() ตรงที่ผู้เรียกตรวจสิทธิ์มาแล้ว และไม่ต้องเช็คนามสกุลไฟล์
 * เพราะต้นทางเป็นระบบเองไม่ใช่ไฟล์จากภายนอก
 */
function storeGeneratedJobFile_(session, job, category, blob, note) {
  var current = currentFile_(job.id, category);
  var version = current ? toNumber_(current.version, 0) + 1 : 1;
  var folder = getJobCategoryFolder_(job, category);
  var originalName = sanitizeFileName_(blob.getName() || (category + '.pdf'));
  var storedName = sanitizeFileName_(job.jobNo + '_' + category + '_v' + version + '_' + originalName);
  blob.setName(storedName);

  var bytes = blob.getBytes();
  assert_(bytes.length > 0, 'VALIDATION', 'ไฟล์ที่สร้างว่างเปล่า');
  var driveFile = folder.createFile(blob);

  var fileRecord = {
    id: newId_('FIL'),
    jobId: job.id,
    category: category,
    version: version,
    driveFileId: driveFile.getId(),
    driveFolderId: folder.getId(),
    fileName: originalName,
    mimeType: blob.getContentType() || 'application/pdf',
    sizeBytes: bytes.length,
    note: cleanText_(note, 500),
    changeReason: '',
    isCurrent: true,
    isAcknowledged: true,
    acknowledgedBy: '',
    acknowledgedAt: '',
    supersededBy: '',
    uploadedBy: session.user.id,
    uploadedAt: nowIso_()
  };

  try {
    appendRecord_(APP_CONFIG.SHEETS.FILES, fileRecord);
    if (current) {
      updateRecord_(APP_CONFIG.SHEETS.FILES, current.id, { isCurrent: false, supersededBy: fileRecord.id });
    }
    logActivity_(session.user.id, 'GENERATE_FILE', 'FILE', fileRecord.id, {
      jobId: job.id, category: category, version: version
    });
  } catch (error) {
    driveFile.setTrashed(true);
    throw error;
  }
  return serializeRecord_(fileRecord);
}

function listJobFiles(token, jobId) {
  requireSession_(token);
  assert_(findById_(APP_CONFIG.SHEETS.JOBS, jobId), 'NOT_FOUND', 'ไม่พบ Job');
  return getTable_(APP_CONFIG.SHEETS.FILES).filter(function (row) {
    return String(row.jobId) === String(jobId);
  }).sort(function (a, b) {
    return new Date(b.uploadedAt).getTime() - new Date(a.uploadedAt).getTime();
  }).map(publicFileRecord_);
}

function downloadJobFile(token, fileRecordId) {
  var session = requireSession_(token);
  var record = findById_(APP_CONFIG.SHEETS.FILES, fileRecordId);
  assert_(record, 'NOT_FOUND', 'ไม่พบไฟล์');
  var driveFile;
  try {
    driveFile = DriveApp.getFileById(record.driveFileId);
  } catch (error) {
    appError_('FILE_NOT_FOUND', 'ไม่พบไฟล์ใน Google Drive');
  }
  var blob = driveFile.getBlob();
  var bytes = blob.getBytes();
  assert_(bytes.length <= APP_CONFIG.MAX_FILE_BYTES, 'FILE_TOO_LARGE', 'ไฟล์มีขนาดใหญ่เกินกว่าจะดาวน์โหลดผ่านหน้าเว็บ');
  logActivity_(session.user.id, 'DOWNLOAD_FILE', 'FILE', record.id, { jobId: record.jobId });
  return {
    fileName: record.fileName,
    mimeType: record.mimeType || blob.getContentType(),
    base64: Utilities.base64Encode(bytes)
  };
}

function acknowledgeInvoiceFile(token, fileRecordId) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT, APP_CONFIG.ROLES.FAH]);
  return withScriptLock_(function () {
    var record = findById_(APP_CONFIG.SHEETS.FILES, fileRecordId);
    assert_(record && record.category === APP_CONFIG.FILE_CATEGORIES.INVOICE_GOODS,
      'NOT_FOUND', 'ไม่พบไฟล์ Invoice');
    assert_(toBool_(record.isCurrent), 'VALIDATION', 'ไฟล์นี้ไม่ใช่ Invoice เวอร์ชันปัจจุบัน');
    if (!toBool_(record.isAcknowledged)) {
      updateRecord_(APP_CONFIG.SHEETS.FILES, record.id, {
        isAcknowledged: true,
        acknowledgedBy: session.user.id,
        acknowledgedAt: nowIso_()
      });
      var stillPending = getTable_(APP_CONFIG.SHEETS.FILES).some(function (row) {
        return String(row.jobId) === String(record.jobId) &&
          row.category === APP_CONFIG.FILE_CATEGORIES.INVOICE_GOODS &&
          toBool_(row.isCurrent) && !toBool_(row.isAcknowledged) && row.id !== record.id;
      });
      updateRecord_(APP_CONFIG.SHEETS.JOBS, record.jobId, {
        hasInvoiceAlert: stillPending,
        updatedBy: session.user.id,
        updatedAt: nowIso_()
      });
      logActivity_(session.user.id, 'ACK_INVOICE_CHANGE', 'FILE', record.id, {
        jobId: record.jobId,
        changeReason: record.changeReason
      });
    }
    return { ok: true, jobId: record.jobId };
  });
}

function currentFile_(jobId, category) {
  return findOne_(APP_CONFIG.SHEETS.FILES, function (row) {
    return String(row.jobId) === String(jobId) && row.category === category && toBool_(row.isCurrent);
  });
}

function publicFileRecord_(row) {
  return {
    id: row.id,
    jobId: row.jobId,
    category: row.category,
    version: toNumber_(row.version, 1),
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: toNumber_(row.sizeBytes, 0),
    note: row.note,
    changeReason: row.changeReason,
    isCurrent: toBool_(row.isCurrent),
    isAcknowledged: toBool_(row.isAcknowledged),
    acknowledgedBy: row.acknowledgedBy,
    acknowledgedAt: row.acknowledgedAt,
    uploadedBy: row.uploadedBy,
    uploadedAt: row.uploadedAt
  };
}

function uploadRolesForCategory_(category) {
  var map = {};
  map[APP_CONFIG.FILE_CATEGORIES.ARRIVAL_NOTICE] = [APP_CONFIG.ROLES.PAINT];
  map[APP_CONFIG.FILE_CATEGORIES.BL] = [APP_CONFIG.ROLES.PAINT];
  map[APP_CONFIG.FILE_CATEGORIES.INVOICE_GOODS] = [APP_CONFIG.ROLES.NAMKANG];
  map[APP_CONFIG.FILE_CATEGORIES.SURRENDER] = [APP_CONFIG.ROLES.NAMKANG];
  map[APP_CONFIG.FILE_CATEGORIES.FINAL_INVOICE] = [APP_CONFIG.ROLES.PAINT];
  map[APP_CONFIG.FILE_CATEGORIES.EOFFICE] = [APP_CONFIG.ROLES.PAINT];
  map[APP_CONFIG.FILE_CATEGORIES.INVOICE_DO] = [APP_CONFIG.ROLES.FAH];
  map[APP_CONFIG.FILE_CATEGORIES.EOFFICE_REQUEST] = [APP_CONFIG.ROLES.PAINT];
  map[APP_CONFIG.FILE_CATEGORIES.CUSTOMS_ENTRY_DOC] = [APP_CONFIG.ROLES.PAINT, APP_CONFIG.ROLES.FAH];
  map[APP_CONFIG.FILE_CATEGORIES.EOFFICE_MERGED] = [APP_CONFIG.ROLES.PAINT];
  map[APP_CONFIG.FILE_CATEGORIES.OTHER] = [APP_CONFIG.ROLES.PAINT, APP_CONFIG.ROLES.FAH, APP_CONFIG.ROLES.NAMKANG];
  assert_(map[category], 'VALIDATION', 'ประเภทไฟล์ไม่ถูกต้อง');
  return map[category];
}

function getJobCategoryFolder_(job, category) {
  var root = DriveApp.getFolderById(APP_CONFIG.DRIVE_FOLDER_ID);
  var jobName = sanitizeFileName_(job.jobNo + '_' + job.id);
  var jobIterator = root.getFoldersByName(jobName);
  var jobFolder = jobIterator.hasNext() ? jobIterator.next() : root.createFolder(jobName);
  var categoryIterator = jobFolder.getFoldersByName(category);
  return categoryIterator.hasNext() ? categoryIterator.next() : jobFolder.createFolder(category);
}
