function getMasterData(token) {
  requireSession_(token);
  return getAllMasterData_();
}

function getAllMasterData_() {
  var output = {};
  Object.keys(MASTER_SHEET_MAP).forEach(function (type) {
    output[type] = getTableSafe_(MASTER_SHEET_MAP[type]).map(function (row) {
      return serializeRecord_(row);
    });
  });
  return output;
}

var MASTER_CODE_PREFIX = Object.freeze({
  shippers: 'SHP',
  consignees: 'CNE',
  notify: 'NTP',
  people: 'PIC'
});

/**
 * สร้างรหัสถัดไปต่อจากรหัสล่าสุดที่มีอยู่ เช่น SHP0001 -> SHP0002
 * ไล่หาเลขสูงสุดที่ใช้แล้วแทนการนับจำนวนแถว เพื่อไม่ให้ซ้ำเมื่อมีการลบหรือแก้รหัสด้วยมือ
 */
function nextMasterCode_(type, sheetName) {
  var prefix = MASTER_CODE_PREFIX[cleanText_(type)];
  if (!prefix) return '';
  var highest = 0;
  getTableSafe_(sheetName).forEach(function (row) {
    var code = cleanText_(row.code).toUpperCase();
    if (code.indexOf(prefix) !== 0) return;
    var digits = code.slice(prefix.length);
    if (!/^[0-9]+$/.test(digits)) return;
    var value = toNumber_(digits, 0);
    if (value > highest) highest = value;
  });
  var next = String(highest + 1);
  while (next.length < 4) next = '0' + next;
  return prefix + next;
}

function saveMasterRecord(token, type, payload) {
  payload = payload || {};
  // ผู้ทำงานหน้ารับงาน (PAINT) เพิ่ม Shipper ใหม่จากปุ่ม + ในฟอร์มได้
  // แต่การแก้ไข/ปิดใช้ของเดิม และ Master Data ประเภทอื่น ยังสงวนไว้ให้ ADMIN เท่านั้น
  var isQuickAddShipper = cleanText_(type) === 'shippers' && !cleanText_(payload.id);
  var session = requireSession_(token,
    isQuickAddShipper ? [APP_CONFIG.ROLES.ADMIN, APP_CONFIG.ROLES.PAINT] : [APP_CONFIG.ROLES.ADMIN]);
  var sheetName = masterSheetForType_(type);
  return withScriptLock_(function () {
    var now = nowIso_();
    var existing = payload.id ? findById_(sheetName, payload.id) : null;
    var name = requiredText_(payload.name, 'ชื่อ', 180);
    var code = cleanText_(payload.code, 60).toUpperCase();
    if (!code && !existing) code = nextMasterCode_(type, sheetName);
    var duplicate = findOne_(sheetName, function (row) {
      if (existing && String(row.id) === String(existing.id)) return false;
      return normalizeKey_(row.name) === normalizeKey_(name) ||
        Boolean(code && normalizeKey_(row.code) === normalizeKey_(code));
    });
    assert_(!duplicate, 'DUPLICATE', 'ชื่อหรือรหัสนี้มีอยู่ใน Master Data แล้ว');

    var headers = SHEET_SCHEMAS[sheetName];
    var record = existing ? serializeRecord_(existing) : {
      id: newId_('MD'),
      isActive: true,
      createdAt: now
    };
    headers.forEach(function (header) {
      if (['id', 'createdAt', 'updatedAt'].indexOf(header) !== -1) return;
      if (Object.prototype.hasOwnProperty.call(payload, header)) {
        record[header] = header === 'isActive' ? toBool_(payload[header]) : cleanText_(payload[header], 1000);
      }
    });
    record.name = name;
    record.code = code;
    record.updatedAt = now;
    if (record.isActive === undefined || record.isActive === '') record.isActive = true;

    var saved = existing
      ? updateRecord_(sheetName, existing.id, record)
      : appendRecord_(sheetName, record);
    logActivity_(session.user.id, existing ? 'UPDATE_MASTER' : 'CREATE_MASTER', type, record.id, {
      code: code,
      name: name
    });
    return serializeRecord_(saved);
  });
}

function setMasterRecordActive(token, type, recordId, isActive) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  var sheetName = masterSheetForType_(type);
  return withScriptLock_(function () {
    var record = findById_(sheetName, recordId);
    assert_(record, 'NOT_FOUND', 'ไม่พบ Master Data');
    var updated = updateRecord_(sheetName, record.id, {
      isActive: toBool_(isActive),
      updatedAt: nowIso_()
    });
    logActivity_(session.user.id, 'SET_MASTER_ACTIVE', type, record.id, { isActive: toBool_(isActive) });
    return serializeRecord_(updated);
  });
}

function checkMasterDuplicate(token, type, name, excludeId) {
  requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  var sheetName = masterSheetForType_(type);
  var needle = normalizeKey_(name);
  if (!needle) return { exact: null, suggestions: [] };
  var rows = getTable_(sheetName).filter(function (row) {
    return String(row.id) !== String(excludeId || '');
  });
  var exact = rows.filter(function (row) {
    return normalizeKey_(row.name) === needle;
  })[0] || null;
  var suggestions = rows.map(function (row) {
    var candidate = normalizeKey_(row.name);
    var distance = levenshtein_(needle, candidate);
    var denominator = Math.max(needle.length, candidate.length, 1);
    return { id: row.id, code: row.code, name: row.name, score: 1 - distance / denominator };
  }).filter(function (item) {
    return item.score >= 0.62;
  }).sort(function (a, b) {
    return b.score - a.score;
  }).slice(0, 5);
  return { exact: exact ? serializeRecord_(exact) : null, suggestions: suggestions };
}

function masterSheetForType_(type) {
  var key = cleanText_(type);
  var sheetName = MASTER_SHEET_MAP[key];
  assert_(sheetName, 'VALIDATION', 'ประเภท Master Data ไม่ถูกต้อง');
  return sheetName;
}

function levenshtein_(left, right) {
  var a = String(left || '');
  var b = String(right || '');
  var previous = [];
  var current = [];
  var i;
  var j;
  for (j = 0; j <= b.length; j += 1) previous[j] = j;
  for (i = 1; i <= a.length; i += 1) {
    current[0] = i;
    for (j = 1; j <= b.length; j += 1) {
      var cost = a.charAt(i - 1) === b.charAt(j - 1) ? 0 : 1;
      current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost);
    }
    previous = current.slice();
  }
  return previous[b.length] || 0;
}
