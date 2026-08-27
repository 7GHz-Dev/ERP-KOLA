function appError_(code, message) {
  throw new Error(String(code || 'ERROR') + '|' + String(message || 'เกิดข้อผิดพลาด'));
}

function assert_(condition, code, message) {
  if (!condition) appError_(code, message);
}

function nowIso_() {
  return new Date().toISOString();
}

function newId_(prefix) {
  return String(prefix || 'ID') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
}

function cleanText_(value, maxLength) {
  var text = value === null || value === undefined ? '' : String(value).trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

function requiredText_(value, fieldName, maxLength) {
  var text = cleanText_(value, maxLength);
  assert_(text, 'VALIDATION', 'กรุณาระบุ ' + fieldName);
  return text;
}

function normalizeKey_(value) {
  return cleanText_(value).toLocaleLowerCase().replace(/\s+/g, ' ').replace(/[^a-z0-9\u0E00-\u0E7F ]/g, '');
}

function safeCell_(value) {
  if (typeof value !== 'string') return value;
  return /^[=+\-@]/.test(value) ? "'" + value : value;
}

function toBool_(value) {
  return value === true || value === 'true' || value === 1 || value === '1';
}

function toNumber_(value, fallback) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
}

function sha256Hex_(value) {
  var digest = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(value),
    Utilities.Charset.UTF_8
  );
  return digest.map(function (byte) {
    var normalized = byte < 0 ? byte + 256 : byte;
    return ('0' + normalized.toString(16)).slice(-2);
  }).join('');
}

function randomToken_() {
  return Utilities.base64EncodeWebSafe(
    Utilities.getUuid() + '|' + Utilities.getUuid() + '|' + new Date().getTime()
  ).replace(/=+$/g, '');
}

function constantTimeEquals_(left, right) {
  left = String(left || '');
  right = String(right || '');
  if (left.length !== right.length) return false;
  var mismatch = 0;
  for (var i = 0; i < left.length; i += 1) {
    mismatch |= left.charCodeAt(i) ^ right.charCodeAt(i);
  }
  return mismatch === 0;
}

function withScriptLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function serializeValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
  return value === undefined ? '' : value;
}

function serializeRecord_(record) {
  var output = {};
  Object.keys(record || {}).forEach(function (key) {
    if (key !== '_rowNumber') output[key] = serializeValue_(record[key]);
  });
  return output;
}

function sanitizeFileName_(fileName) {
  var safe = cleanText_(fileName, 180).replace(/[\\/:*?"<>|#%{}~&]/g, '_');
  return safe || 'document';
}

function isValidDateText_(value) {
  return !value || !isNaN(new Date(value).getTime());
}

function logActivity_(userId, action, entityType, entityId, detail) {
  appendRecord_(APP_CONFIG.SHEETS.ACTIVITY_LOG, {
    id: newId_('LOG'),
    userId: userId || 'SYSTEM',
    action: action,
    entityType: entityType,
    entityId: entityId,
    detail: typeof detail === 'string' ? detail : JSON.stringify(detail || {}),
    createdAt: nowIso_()
  });
}

function roleAllowed_(role, allowedRoles) {
  return role === APP_CONFIG.ROLES.ADMIN || !allowedRoles || allowedRoles.indexOf(role) !== -1;
}
