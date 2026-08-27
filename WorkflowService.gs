/** อ่านค่าตั้งต้นที่ผู้ดูแลตั้งไว้ในหน้า Master Data */
function settingValue_(code, fallback) {
  var record = getTableSafe_(APP_CONFIG.SHEETS.MD_SETTINGS).filter(function (row) {
    return normalizeKey_(row.code) === normalizeKey_(code) && toBool_(row.isActive);
  })[0];
  var value = record ? cleanText_(record.value) : '';
  return value === '' ? fallback : value;
}

/** ช่องว่างให้ถือว่าไม่ได้กรอก แล้วใช้ค่าตั้งต้นแทน (toNumber_('') คืน 0 ซึ่งไม่ใช่สิ่งที่ต้องการ) */
function numberOrSetting_(value, settingCode, fallback) {
  if (cleanText_(value) !== '') return toNumber_(value, fallback);
  return toNumber_(settingValue_(settingCode, fallback), fallback);
}

function getBootstrapData(token) {
  var session = requireSession_(token, null, true);
  if (toBool_(session.user.mustChangePassword)) {
    return {
      app: { name: APP_CONFIG.APP_NAME, version: APP_CONFIG.VERSION },
      user: publicUser_(session.user),
      jobs: [],
      masters: {},
      dashboard: {},
      fileCategories: APP_CONFIG.FILE_CATEGORIES,
      roles: APP_CONFIG.ROLES
    };
  }
  var jobs = listJobs_({ includeArchived: false });
  var result = {
    app: { name: APP_CONFIG.APP_NAME, version: APP_CONFIG.VERSION },
    user: publicUser_(session.user),
    jobs: jobs,
    masters: getAllMasterData_(),
    dashboard: dashboardCounts_(jobs),
    fileCategories: APP_CONFIG.FILE_CATEGORIES,
    roles: APP_CONFIG.ROLES
  };
  if (session.user.role === APP_CONFIG.ROLES.ADMIN) result.users = adminListUsers(token);
  return result;
}

function listJobs(token, filters) {
  requireSession_(token);
  return listJobs_(filters || {});
}

function listJobs_(filters) {
  filters = filters || {};
  var files = getTable_(APP_CONFIG.SHEETS.FILES);
  var approvals = getTable_(APP_CONFIG.SHEETS.APPROVALS);
  var customsEntries = getTable_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES);
  var query = normalizeKey_(filters.query);
  var status = cleanText_(filters.status);
  var rows = getTable_(APP_CONFIG.SHEETS.JOBS).filter(function (job) {
    if (!toBool_(filters.includeArchived) && toBool_(job.isArchived)) return false;
    if (status && job.status !== status) return false;
    if (query) {
      var haystack = normalizeKey_([job.jobNo, job.blNo, job.vessel, job.voyage, job.customerNote].join(' '));
      if (haystack.indexOf(query) === -1) return false;
    }
    return true;
  });
  return rows.map(function (job) {
    return decorateJob_(job, files, approvals, customsEntries);
  }).sort(function (a, b) {
    if (a.hasInvoiceAlert !== b.hasInvoiceAlert) return a.hasInvoiceAlert ? -1 : 1;
    return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  });
}

function getJobDetail(token, jobId) {
  requireSession_(token);
  var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
  assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
  return {
    job: decorateJob_(job, getTable_(APP_CONFIG.SHEETS.FILES), getTable_(APP_CONFIG.SHEETS.APPROVALS),
      getTable_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES)),
    bls: recordsForJob_(APP_CONFIG.SHEETS.BLS, jobId),
    containers: recordsForJob_(APP_CONFIG.SHEETS.CONTAINERS, jobId),
    files: recordsForJob_(APP_CONFIG.SHEETS.FILES, jobId).map(publicFileRecord_),
    approvals: recordsForJob_(APP_CONFIG.SHEETS.APPROVALS, jobId),
    doHandoff: recordsForJob_(APP_CONFIG.SHEETS.DO_HANDOFFS, jobId)[0] || null,
    customsEntry: recordsForJob_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, jobId)[0] || null,
    release: recordsForJob_(APP_CONFIG.SHEETS.INSPECTION_RELEASES, jobId)[0] || null,
    history: recordsForJob_(APP_CONFIG.SHEETS.STATUS_HISTORY, jobId).sort(function (a, b) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    })
  };
}

function createJobFromArrival(formObject) {
  formObject = formObject || {};
  requireSession_(formObject.token, [APP_CONFIG.ROLES.PAINT]);
  assert_(formObject.fileBlob && typeof formObject.fileBlob.getBytes === 'function',
    'VALIDATION', 'กรุณาเลือกไฟล์ AN หรือ BL');
  var sourceBytes = formObject.fileBlob.getBytes();
  assert_(sourceBytes.length > 0, 'VALIDATION', 'ไฟล์ AN/BL ไม่มีข้อมูล');
  assert_(sourceBytes.length <= APP_CONFIG.MAX_FILE_BYTES,
    'FILE_TOO_LARGE', 'ไฟล์ AN/BL ต้องมีขนาดไม่เกิน 8 MB');
  assert_(/\.pdf$/i.test(cleanText_(formObject.fileBlob.getName())) ||
    formObject.fileBlob.getContentType() === 'application/pdf',
    'FILE_TYPE_NOT_ALLOWED', 'ไฟล์ AN/BL ต้องเป็น PDF เท่านั้น');
  var payload;
  try {
    payload = JSON.parse(cleanText_(formObject.payloadJson, 30000));
  } catch (error) {
    appError_('VALIDATION', 'ข้อมูลจากฟอร์มไม่ถูกต้อง');
  }
  var sourceType = cleanText_(payload.sourceType).toUpperCase();
  assert_(['AN', 'BL'].indexOf(sourceType) !== -1, 'VALIDATION', 'กรุณาเลือกชนิดเอกสาร AN หรือ BL');
  var job = createJob(formObject.token, payload);
  formObject.jobId = job.id;
  formObject.category = sourceType === 'AN'
    ? APP_CONFIG.FILE_CATEGORIES.ARRIVAL_NOTICE
    : APP_CONFIG.FILE_CATEGORIES.BL;
  formObject.note = 'ไฟล์ต้นทางสำหรับสร้าง Job';
  try {
    var file = uploadJobFile(formObject);
    return { job: job, file: file };
  } catch (error) {
    withScriptLock_(function () {
      updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
        isArchived: true,
        updatedAt: nowIso_()
      });
    });
    throw error;
  }
}

function createJob(token, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  payload = payload || {};
  return withScriptLock_(function () {
    var sourceType = cleanText_(payload.sourceType || 'AN').toUpperCase();
    assert_(['AN', 'BL'].indexOf(sourceType) !== -1, 'VALIDATION', 'ชนิดเอกสารต้องเป็น AN หรือ BL');
    var submittedBls = Array.isArray(payload.bls) ? payload.bls : [];
    if (!submittedBls.length && payload.blNo) {
      submittedBls = [{ blNo: payload.blNo, shipperId: payload.shipperId, shipperName: payload.shipperName }];
    }
    submittedBls = submittedBls.map(function (bl) {
      return {
        blNo: requiredText_(bl.blNo, 'BL No.', 80).toUpperCase(),
        shipperId: cleanText_(bl.shipperId, 60),
        shipperName: cleanText_(bl.shipperName, 180)
      };
    });
    assert_(submittedBls.length, 'VALIDATION', 'กรุณาระบุ BL อย่างน้อย 1 รายการ');
    var submittedBlKeys = {};
    submittedBls.forEach(function (bl) {
      var key = normalizeKey_(bl.blNo);
      assert_(!submittedBlKeys[key], 'DUPLICATE_BL', 'BL No. ' + bl.blNo + ' ซ้ำกันในฟอร์ม');
      submittedBlKeys[key] = true;
      var duplicateBl = findOne_(APP_CONFIG.SHEETS.BLS, function (row) {
        return normalizeKey_(row.blNo) === key;
      });
      assert_(!duplicateBl, 'DUPLICATE_BL', 'BL No. ' + bl.blNo + ' มีอยู่ในระบบแล้ว');
    });
    var blNo = submittedBls[0].blNo;
    assert_(isValidDateText_(payload.eta) && isValidDateText_(payload.etd), 'VALIDATION', 'รูปแบบวันที่ไม่ถูกต้อง');

    var now = nowIso_();
    var job = {
      id: newId_('JOB'),
      jobNo: nextJobNumber_(),
      blNo: blNo,
      vessel: requiredText_(payload.vessel, 'Vessel', 120),
      voyage: cleanText_(payload.voyage, 80),
      eta: cleanText_(payload.eta, 40),
      etd: cleanText_(payload.etd, 40),
      shipperId: cleanText_(submittedBls[0].shipperId || payload.shipperId, 60),
      consigneeId: cleanText_(payload.consigneeId, 60),
      notifyPartyId: cleanText_(payload.notifyPartyId, 60),
      loadingTypeId: cleanText_(payload.loadingTypeId, 60),
      portId: cleanText_(payload.portId, 60),
      terminalId: cleanText_(payload.terminalId, 60),
      personId: cleanText_(payload.personId, 60),
      jobTypeId: cleanText_(payload.jobTypeId, 60),
      status: sourceType === 'BL' ? 'WAITING_ARRIVAL_NOTICE_BL' : 'WAITING_ENTER_BL',
      surrenderStatus: 'PENDING',
      customsStatus: 'NOT_STARTED',
      releaseStatus: 'PENDING',
      hasInvoiceAlert: false,
      customerNote: cleanText_(payload.customerNote, 1000),
      createdBy: session.user.id,
      createdAt: now,
      updatedBy: session.user.id,
      updatedAt: now,
      isArchived: false,
      sourceType: sourceType,
      blType: cleanText_(payload.blType, 40),
      product: cleanText_(payload.product || payload.description, 1000),
      unitAmount: toNumber_(payload.unitAmount || payload.packageCount, 0),
      packageType: cleanText_(payload.packageType, 40),
      goodsValue: toNumber_(String(payload.goodsValue || '').replace(/,/g, ''), 0),
      goodsCurrency: cleanText_(payload.goodsCurrency, 10).toUpperCase() || 'USD',
      draftTaskId: '',
      customsTaskId: '',
      grossWeight: toNumber_(String(payload.grossWeight || '').replace(/,/g, ''), 0),
      shipline: cleanText_(payload.shipline, 180),
      demDays: numberOrSetting_(payload.demDays, SETTING_KEYS.DEM_FREE_DAYS, 5),
      detDays: numberOrSetting_(payload.detDays, SETTING_KEYS.DET_FREE_DAYS, 3),
      etaOfficial: '',
      etaIsOfficial: false,
      transportDate: '',
      releasePartner: '',
      draftRefNo: '',
      draftStatus: 'NOT_STARTED'
    };
    appendRecord_(APP_CONFIG.SHEETS.JOBS, job);
    submittedBls.forEach(function (submittedBl) {
      appendRecord_(APP_CONFIG.SHEETS.BLS, {
        id: newId_('BL'),
        jobId: job.id,
        blNo: submittedBl.blNo,
        blType: cleanText_(payload.blType || 'MASTER', 40),
        marks: cleanText_(payload.marks, 500),
        description: cleanText_(payload.product || payload.description, 1000),
        packageCount: toNumber_(payload.unitAmount || payload.packageCount, 0),
        grossWeight: toNumber_(String(payload.grossWeight || '').replace(/,/g, ''), 0),
        measurement: toNumber_(payload.measurement, 0),
        createdAt: now,
        updatedAt: now,
        shipperId: submittedBl.shipperId,
        shipperName: submittedBl.shipperName
      });
    });
    var containers = Array.isArray(payload.containers) ? payload.containers : [];
    containers.forEach(function (container) {
      if (!cleanText_(container.containerNo)) return;
      appendRecord_(APP_CONFIG.SHEETS.CONTAINERS, {
        id: newId_('CTR'),
        jobId: job.id,
        containerNo: cleanText_(container.containerNo, 30).toUpperCase(),
        containerType: cleanText_(container.containerType, 30),
        sealNo: cleanText_(container.sealNo, 40),
        weight: toNumber_(container.weight, 0),
        packageCount: toNumber_(container.packageCount, 0),
        createdAt: now,
        updatedAt: now,
        jobNo: job.jobNo
      });
    });
    recordStatusChange_(job.id, '', job.status, 'อ่านข้อมูลจาก ' + sourceType + ' และส่งเข้า Draft', session.user.id);
    logActivity_(session.user.id, 'CREATE_JOB_FROM_' + sourceType, 'JOB', job.id, {
      jobNo: job.jobNo,
      blCount: submittedBls.length,
      containerCount: containers.length
    });
    return serializeRecord_(job);
  });
}

function updateJobDetails(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT, APP_CONFIG.ROLES.NAMKANG]);
  payload = payload || {};
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');
    var blNo = requiredText_(payload.blNo || job.blNo, 'BL No.', 80).toUpperCase();
    var duplicate = findOne_(APP_CONFIG.SHEETS.JOBS, function (row) {
      return row.id !== job.id && normalizeKey_(row.blNo) === normalizeKey_(blNo) && !toBool_(row.isArchived);
    });
    assert_(!duplicate, 'DUPLICATE_BL', 'BL No. นี้มีอยู่ในระบบแล้ว');
    var patch = {
      blNo: blNo,
      vessel: requiredText_(payload.vessel || job.vessel, 'Vessel', 120),
      voyage: cleanText_(payload.voyage, 80),
      eta: cleanText_(payload.eta, 40),
      etd: cleanText_(payload.etd, 40),
      shipperId: cleanText_(payload.shipperId, 60),
      consigneeId: cleanText_(payload.consigneeId, 60),
      notifyPartyId: cleanText_(payload.notifyPartyId, 60),
      loadingTypeId: cleanText_(payload.loadingTypeId, 60),
      portId: cleanText_(payload.portId, 60),
      terminalId: cleanText_(payload.terminalId, 60),
      personId: cleanText_(payload.personId, 60),
      jobTypeId: cleanText_(payload.jobTypeId, 60),
      blType: cleanText_(payload.blType || job.blType, 40),
      product: cleanText_(payload.product || job.product, 1000),
      unitAmount: toNumber_(payload.unitAmount, job.unitAmount),
      packageType: cleanText_(payload.packageType || job.packageType, 40),
      goodsValue: toNumber_(String(payload.goodsValue === undefined || payload.goodsValue === '' ? job.goodsValue : payload.goodsValue).replace(/,/g, ''), 0),
      goodsCurrency: cleanText_(payload.goodsCurrency || job.goodsCurrency, 10).toUpperCase() || 'USD',
      grossWeight: toNumber_(String(payload.grossWeight || job.grossWeight || '').replace(/,/g, ''), 0),
      shipline: cleanText_(payload.shipline || job.shipline, 180),
      demDays: toNumber_(payload.demDays, job.demDays),
      detDays: toNumber_(payload.detDays, job.detDays),
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    };
    var updated = updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, patch);
    var bl = recordsForJob_(APP_CONFIG.SHEETS.BLS, job.id)[0];
    if (bl) updateRecord_(APP_CONFIG.SHEETS.BLS, bl.id, {
      blNo: blNo,
      shipperId: cleanText_(payload.shipperId || bl.shipperId, 60),
      shipperName: cleanText_(payload.shipperName || bl.shipperName, 180),
      description: cleanText_(payload.product || bl.description, 1000),
      packageCount: toNumber_(payload.unitAmount, bl.packageCount),
      grossWeight: toNumber_(String(payload.grossWeight || bl.grossWeight || '').replace(/,/g, ''), 0),
      updatedAt: nowIso_()
    });
    logActivity_(session.user.id, 'UPDATE_JOB', 'JOB', job.id, patch);
    return serializeRecord_(updated);
  });
}

function saveCustomerInfo(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.NAMKANG]);
  payload = payload || {};
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');
    var updated = updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      consigneeId: cleanText_(payload.consigneeId, 60),
      notifyPartyId: cleanText_(payload.notifyPartyId, 60),
      customerNote: cleanText_(payload.customerNote, 1000),
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    });
    logActivity_(session.user.id, 'SAVE_CUSTOMER', 'JOB', job.id, {});
    return serializeRecord_(updated);
  });
}

function requestApproval(token, jobId, approvalType) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  var type = cleanText_(approvalType).toUpperCase();
  assert_([APP_CONFIG.APPROVAL_TYPES.AN, APP_CONFIG.APPROVAL_TYPES.FN].indexOf(type) !== -1,
    'VALIDATION', 'ประเภทการอนุมัติไม่ถูกต้อง');
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');
    var pending = latestApprovalForJob_(job.id, type);
    assert_(!pending || pending.status !== 'PENDING', 'ALREADY_PENDING', 'รายการนี้รออนุมัติอยู่แล้ว');
    if (type === APP_CONFIG.APPROVAL_TYPES.AN) {
      assert_(currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.ARRIVAL_NOTICE) ||
        currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.BL),
        'FILE_REQUIRED', 'ต้องมีไฟล์ Arrival Notice หรือ BL ก่อนส่งอนุมัติ');
    } else if (type === APP_CONFIG.APPROVAL_TYPES.FN) {
      assert_(latestApprovalStatus_(job.id, APP_CONFIG.APPROVAL_TYPES.AN) === 'APPROVED',
        'AN_NOT_APPROVED', 'ต้องผ่านการอนุมัติ AN ก่อน');
      assert_(currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.FINAL_INVOICE),
        'FILE_REQUIRED', 'กรุณาอัปโหลด Final Invoice ก่อนส่งอนุมัติ FN');
    }
    var approval = {
      id: newId_('APR'),
      jobId: job.id,
      approvalType: type,
      status: 'PENDING',
      reason: '',
      requestedBy: session.user.id,
      requestedAt: nowIso_(),
      decidedBy: '',
      decidedAt: ''
    };
    appendRecord_(APP_CONFIG.SHEETS.APPROVALS, approval);
    setJobStatus_(job, type === 'AN' ? 'WAITING_AN_APPROVAL' : 'WAITING_FN_APPROVAL',
      'ส่งอนุมัติ ' + type, session.user.id);
    logActivity_(session.user.id, 'REQUEST_' + type, 'APPROVAL', approval.id, { jobId: job.id });
    return serializeRecord_(approval);
  });
}

/**
 * ส่งอนุมัติให้อัตโนมัติหลังอัปโหลดไฟล์
 *
 * หน้าจอไม่มีปุ่ม "ส่งอนุมัติ FAH" แล้ว งานจึงต้องเข้าคิวของ FAH เองตอนอัปโหลด Final Invoice
 * มิฉะนั้นสถานะ FN จะไม่มีวันเป็น PENDING และงานจะค้างอยู่เฉย ๆ
 */
function autoRequestApproval_(session, job, type) {
  var pending = latestApprovalForJob_(job.id, type);
  if (pending && pending.status === 'PENDING') return null;
  var approval = {
    id: newId_('APR'),
    jobId: job.id,
    approvalType: type,
    status: 'PENDING',
    reason: '',
    requestedBy: session.user.id,
    requestedAt: nowIso_(),
    decidedBy: '',
    decidedAt: ''
  };
  appendRecord_(APP_CONFIG.SHEETS.APPROVALS, approval);
  setJobStatus_(job, type === 'AN' ? 'WAITING_AN_APPROVAL' : 'WAITING_FN_APPROVAL',
    'ส่งอนุมัติ ' + type + ' อัตโนมัติหลังอัปโหลดไฟล์', session.user.id);
  logActivity_(session.user.id, 'AUTO_REQUEST_' + type, 'APPROVAL', approval.id, { jobId: job.id });
  return approval;
}

/** FAH ตีกลับ Draft ใบขนให้ PAINT แก้แล้วส่งใหม่ */
function rejectCustomsDraft(token, jobId, reason) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.FAH]);
  var text = requiredText_(reason, 'เหตุผล', 1000);
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job && !toBool_(job.isArchived), 'NOT_FOUND', 'ไม่พบ Job');
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      draftStatus: 'REJECTED',
      draftRejectReason: text,
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    });
    setJobStatus_(job, 'DRAFT_REJECTED', 'FAH ตีกลับ Draft: ' + text, session.user.id);
    logActivity_(session.user.id, 'REJECT_DRAFT', 'JOB', job.id, { reason: text });
    return { ok: true };
  });
}

function decideApproval(token, approvalId, decision, reason) {
  var session = requireSession_(token);
  var approval = findById_(APP_CONFIG.SHEETS.APPROVALS, approvalId);
  assert_(approval, 'NOT_FOUND', 'ไม่พบรายการอนุมัติ');
  var allowedRoles = approval.approvalType === APP_CONFIG.APPROVAL_TYPES.AN
    ? [APP_CONFIG.ROLES.NAMKANG]
    : [APP_CONFIG.ROLES.FAH];
  assert_(roleAllowed_(session.user.role, allowedRoles), 'FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  var nextDecision = cleanText_(decision).toUpperCase();
  assert_(['APPROVED', 'REJECTED'].indexOf(nextDecision) !== -1, 'VALIDATION', 'ผลการอนุมัติไม่ถูกต้อง');
  var note = cleanText_(reason, 500);
  if (nextDecision === 'REJECTED') assert_(note, 'REASON_REQUIRED', 'กรุณาระบุเหตุผลที่ไม่อนุมัติ');

  return withScriptLock_(function () {
    approval = findById_(APP_CONFIG.SHEETS.APPROVALS, approval.id);
    assert_(approval.status === 'PENDING', 'ALREADY_DECIDED', 'รายการนี้ได้รับการพิจารณาแล้ว');
    updateRecord_(APP_CONFIG.SHEETS.APPROVALS, approval.id, {
      status: nextDecision,
      reason: note,
      decidedBy: session.user.id,
      decidedAt: nowIso_()
    });
    var job = findById_(APP_CONFIG.SHEETS.JOBS, approval.jobId);
    var newStatus;
    if (approval.approvalType === APP_CONFIG.APPROVAL_TYPES.AN) {
      newStatus = nextDecision === 'APPROVED' ? 'WAITING_INVOICE_DO' : 'AN_REJECTED';
    } else {
      newStatus = nextDecision === 'APPROVED' ? 'FN_APPROVED' : 'FN_REJECTED';
    }
    setJobStatus_(job, newStatus, (nextDecision === 'APPROVED' ? 'อนุมัติ ' : 'ไม่อนุมัติ ') + approval.approvalType, session.user.id);
    logActivity_(session.user.id, 'DECIDE_' + approval.approvalType, 'APPROVAL', approval.id, {
      decision: nextDecision,
      reason: note
    });
    return { ok: true, jobId: approval.jobId, status: nextDecision };
  });
}

function saveDoHandoff(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.FAH]);
  payload = payload || {};
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
    assert_(isValidDateText_(payload.etaOfficial), 'VALIDATION', 'วันที่ ETA ไม่ถูกต้อง');
    assert_(isValidDateText_(payload.transportDate), 'VALIDATION', 'วันที่ขนย้ายไม่ถูกต้อง');
    var existing = recordsForJob_(APP_CONFIG.SHEETS.DO_HANDOFFS, jobId)[0];
    var now = nowIso_();
    var record = {
      id: existing ? existing.id : newId_('DO'),
      jobId: job.id,
      etaOfficial: cleanText_(payload.etaOfficial, 40),
      portId: cleanText_(payload.portId, 60),
      terminalId: cleanText_(payload.terminalId, 60),
      partnerName: cleanText_(payload.partnerName, 180),
      invoiceDoFileId: currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.INVOICE_DO)
        ? currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.INVOICE_DO).id : '',
      note: cleanText_(payload.note, 1000),
      transportDate: cleanText_(payload.transportDate, 40),
      sentBy: session.user.id,
      sentAt: existing ? existing.sentAt : now,
      updatedAt: now
    };
    var saved = existing
      ? updateRecord_(APP_CONFIG.SHEETS.DO_HANDOFFS, existing.id, record)
      : appendRecord_(APP_CONFIG.SHEETS.DO_HANDOFFS, record);
    // ETA ที่ PAINT กรอกตอนรับงานเป็นค่าเบื้องต้น พอ FAH ยืนยันตรงนี้จึงถือเป็นตัวจริง
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      eta: record.etaOfficial || job.eta,
      etaIsOfficial: true,
      transportDate: record.transportDate,
      etaOfficial: record.etaOfficial,
      portId: record.portId || job.portId,
      terminalId: record.terminalId || job.terminalId,
      releasePartner: record.partnerName,
      updatedBy: session.user.id,
      updatedAt: now
    });
    if (['WAITING_INVOICE_DO', 'AN_APPROVED'].indexOf(job.status) !== -1) {
      setJobStatus_(job, 'DO_SENT', 'ส่ง Invoice DO ให้ Port Release Partner', session.user.id);
    } else {
      recordStatusChange_(job.id, job.status, job.status, 'ส่ง Invoice DO ให้ Port Release Partner', session.user.id);
    }
    logActivity_(session.user.id, 'SAVE_DO_HANDOFF', 'JOB', job.id, {});
    return serializeRecord_(saved);
  });
}

function saveCustomsDraft(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  payload = payload || {};
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
    assert_(latestApprovalStatus_(job.id, APP_CONFIG.APPROVAL_TYPES.FN) === 'APPROVED',
      'FN_NOT_APPROVED', 'ต้องผ่านการอนุมัติ FN ก่อนสร้าง Draft ใบขน');
    var existing = recordsForJob_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, jobId)[0];
    var now = nowIso_();
    var record = {
      id: existing ? existing.id : newId_('CUS'),
      jobId: job.id,
      entryNo: cleanText_(payload.entryNo, 80) || ('QELS' + String(new Date().getTime()).slice(-9)),
      status: 'DRAFT',
      declarationNo: cleanText_(payload.declarationNo, 80),
      amount: toNumber_(payload.amount, 0),
      note: cleanText_(payload.note, 1000),
      createdBy: existing ? existing.createdBy : session.user.id,
      createdAt: existing ? existing.createdAt : now,
      filedBy: existing ? existing.filedBy : '',
      filedAt: existing ? existing.filedAt : '',
      updatedAt: now
    };
    var saved = existing
      ? updateRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, existing.id, record)
      : appendRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, record);
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      customsStatus: 'DRAFT',
      draftRefNo: record.entryNo,
      draftStatus: 'CREATED',
      updatedBy: session.user.id,
      updatedAt: now
    });
    logActivity_(session.user.id, 'SAVE_CUSTOMS_DRAFT', 'JOB', job.id, { entryNo: record.entryNo });
    return serializeRecord_(saved);
  });
}

function submitCustomsDraft(token, jobId) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.PAINT]);
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    var entry = recordsForJob_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, jobId)[0];
    assert_(job && entry && entry.status === 'DRAFT', 'DRAFT_REQUIRED', 'กรุณาสร้าง Draft ใบขนก่อนส่งตรวจ');
    updateRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, entry.id, {
      status: 'SUBMITTED',
      updatedAt: nowIso_()
    });
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      customsStatus: 'SUBMITTED',
      draftStatus: 'SUBMITTED',
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    });
    setJobStatus_(job, 'ENTRY_DRAFTED', 'PAINT ส่ง Draft ให้ FAH ตรวจ', session.user.id);
    logActivity_(session.user.id, 'SUBMIT_CUSTOMS_DRAFT', 'JOB', job.id, { refNo: entry.entryNo });
    return { ok: true, jobId: job.id, refNo: entry.entryNo };
  });
}

function fileCustomsEntry(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.FAH]);
  payload = payload || {};
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    var entry = recordsForJob_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, jobId)[0];
    assert_(job && entry && entry.status === 'SUBMITTED',
      'DRAFT_REQUIRED', 'Draft ต้องถูกส่งจาก PAINT ก่อนยืนยันทำใบขน');
    var declarationNo = requiredText_(payload.declarationNo || entry.declarationNo, 'เลขที่ใบขน', 80);
    updateRecord_(APP_CONFIG.SHEETS.CUSTOMS_ENTRIES, entry.id, {
      status: 'FILED',
      declarationNo: declarationNo,
      filedBy: session.user.id,
      filedAt: nowIso_(),
      updatedAt: nowIso_()
    });
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      customsStatus: 'FILED',
      draftStatus: 'FILED',
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    });
    setJobStatus_(job, job.releaseStatus === 'RELEASED' ? 'RELEASED' : 'CUSTOMS_FILED',
      'ยื่นใบขนแล้ว', session.user.id);
    logActivity_(session.user.id, 'FILE_CUSTOMS_ENTRY', 'JOB', job.id, { declarationNo: declarationNo });
    return { ok: true, jobId: job.id };
  });
}

function updateSurrenderStatus(token, jobId, status, note) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.NAMKANG]);
  var nextStatus = cleanText_(status).toUpperCase();
  assert_(['PENDING', 'CLEARED', 'ISSUE'].indexOf(nextStatus) !== -1, 'VALIDATION', 'สถานะ Surrender ไม่ถูกต้อง');
  if (nextStatus === 'ISSUE') assert_(cleanText_(note), 'REASON_REQUIRED', 'กรุณาระบุปัญหา Surrender');
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
    if (nextStatus === 'CLEARED') {
      assert_(currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.SURRENDER),
        'SURRENDER_FILE_REQUIRED', 'ต้องอัปโหลด Surrender BL ก่อนตั้งสถานะเคลียร์แล้ว');
    }
    var updated = updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      surrenderStatus: nextStatus,
      customerNote: cleanText_(note, 1000) || job.customerNote,
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    });
    logActivity_(session.user.id, 'UPDATE_SURRENDER', 'JOB', job.id, { status: nextStatus, note: note });
    return serializeRecord_(updated);
  });
}

function releaseJob(token, jobId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.NAMKANG]);
  payload = payload || {};
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
    assert_(job.surrenderStatus === 'CLEARED', 'SURRENDER_REQUIRED', 'ต้องตรวจ Surrender ผ่านก่อนปล่อยงาน');
    assert_(currentFile_(job.id, APP_CONFIG.FILE_CATEGORIES.EOFFICE),
      'EOFFICE_REQUIRED', 'ต้องมีไฟล์ E-Office ก่อนปล่อยงาน');
    var existing = recordsForJob_(APP_CONFIG.SHEETS.INSPECTION_RELEASES, job.id)[0];
    var now = nowIso_();
    var record = {
      id: existing ? existing.id : newId_('REL'),
      jobId: job.id,
      inspectionRequired: toBool_(payload.inspectionRequired),
      inspectionResult: cleanText_(payload.inspectionResult, 500),
      releaseNote: cleanText_(payload.releaseNote, 1000),
      releasedBy: session.user.id,
      releasedAt: now,
      updatedAt: now
    };
    if (existing) updateRecord_(APP_CONFIG.SHEETS.INSPECTION_RELEASES, existing.id, record);
    else appendRecord_(APP_CONFIG.SHEETS.INSPECTION_RELEASES, record);
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      releaseStatus: 'RELEASED',
      updatedBy: session.user.id,
      updatedAt: now
    });
    setJobStatus_(job, job.customsStatus === 'FILED' ? 'RELEASED' : 'PORT_RELEASED',
      'Port Release ผ่านแล้ว', session.user.id);
    logActivity_(session.user.id, 'RELEASE_JOB', 'JOB', job.id, record);
    return { ok: true, jobId: job.id };
  });
}

function archiveJob(token, jobId) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  return withScriptLock_(function () {
    var job = findById_(APP_CONFIG.SHEETS.JOBS, jobId);
    assert_(job, 'NOT_FOUND', 'ไม่พบ Job');
    updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
      isArchived: true,
      updatedBy: session.user.id,
      updatedAt: nowIso_()
    });
    logActivity_(session.user.id, 'ARCHIVE_JOB', 'JOB', job.id, {});
    return { ok: true };
  });
}

function recordsForJob_(sheetName, jobId) {
  return getTable_(sheetName).filter(function (row) {
    return String(row.jobId) === String(jobId);
  }).map(serializeRecord_);
}

function latestApprovalForJob_(jobId, type) {
  return getTable_(APP_CONFIG.SHEETS.APPROVALS).filter(function (row) {
    return String(row.jobId) === String(jobId) && row.approvalType === type;
  }).sort(function (a, b) {
    return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
  })[0] || null;
}

function latestApprovalStatus_(jobId, type) {
  var approval = latestApprovalForJob_(jobId, type);
  return approval ? approval.status : 'NOT_REQUESTED';
}

function decorateJob_(job, files, approvals, customsEntries) {
  var output = serializeRecord_(job);
  output.hasInvoiceAlert = toBool_(job.hasInvoiceAlert);
  output.isArchived = toBool_(job.isArchived);
  output.currentFiles = {};
  files.filter(function (row) {
    return String(row.jobId) === String(job.id) && toBool_(row.isCurrent);
  }).forEach(function (row) {
    output.currentFiles[row.category] = publicFileRecord_(row);
  });
  output.approvals = {};
  [APP_CONFIG.APPROVAL_TYPES.AN, APP_CONFIG.APPROVAL_TYPES.FN].forEach(function (type) {
    var latest = approvals.filter(function (row) {
      return String(row.jobId) === String(job.id) && row.approvalType === type;
    }).sort(function (a, b) {
      return new Date(b.requestedAt).getTime() - new Date(a.requestedAt).getTime();
    })[0];
    output.approvals[type] = latest ? serializeRecord_(latest) : null;
  });
  var entry = customsEntries.filter(function (row) {
    return String(row.jobId) === String(job.id);
  })[0];
  output.customsEntry = entry ? serializeRecord_(entry) : null;
  return output;
}

function dashboardCounts_(jobs) {
  return {
    total: jobs.length,
    invoiceAlerts: jobs.filter(function (job) { return job.hasInvoiceAlert; }).length,
    waitingAN: jobs.filter(function (job) {
      return job.approvals.AN && job.approvals.AN.status === 'PENDING';
    }).length,
    waitingFN: jobs.filter(function (job) {
      return job.approvals.FN && job.approvals.FN.status === 'PENDING';
    }).length,
    customsDraft: jobs.filter(function (job) { return job.customsStatus === 'DRAFT'; }).length,
    released: jobs.filter(function (job) { return job.releaseStatus === 'RELEASED'; }).length
  };
}

function setJobStatus_(job, nextStatus, note, actorId) {
  if (job.status === nextStatus) return;
  updateRecord_(APP_CONFIG.SHEETS.JOBS, job.id, {
    status: nextStatus,
    updatedBy: actorId,
    updatedAt: nowIso_()
  });
  recordStatusChange_(job.id, job.status, nextStatus, note, actorId);
}

function recordStatusChange_(jobId, fromStatus, toStatus, note, actorId) {
  appendRecord_(APP_CONFIG.SHEETS.STATUS_HISTORY, {
    id: newId_('HIS'),
    jobId: jobId,
    fromStatus: fromStatus,
    toStatus: toStatus,
    note: cleanText_(note, 500),
    actorId: actorId,
    createdAt: nowIso_()
  });
}
