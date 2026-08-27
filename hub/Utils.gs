function hubError_(code, message) {
  throw new Error(String(code || 'ERROR') + '|' + String(message || 'เกิดข้อผิดพลาด'));
}

function hubAssert_(condition, code, message) {
  if (!condition) hubError_(code, message);
}

function hubText_(value, maxLength) {
  var text = value === null || value === undefined ? '' : String(value).trim();
  if (maxLength && text.length > maxLength) text = text.slice(0, maxLength);
  return text;
}

function hubNumber_(value, fallback) {
  var parsed = Number(value);
  return isFinite(parsed) ? parsed : (fallback === undefined ? 0 : fallback);
}

function hubNow_() {
  return new Date().toISOString();
}

function hubId_(prefix) {
  return String(prefix || 'ID') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 20).toUpperCase();
}

function hubToken_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

/** เทียบความลับแบบเวลาคงที่ ไม่ให้เดา API key จากเวลาตอบกลับได้ */
function hubConstantEquals_(left, right) {
  var a = String(left || '');
  var b = String(right || '');
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function hubProps_() {
  return PropertiesService.getScriptProperties();
}

function hubProp_(key) {
  return hubText_(hubProps_().getProperty(key));
}

function hubLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function hubSafeCell_(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean' || typeof value === 'number') return value;
  var text = String(value);
  // กัน formula injection เวลามีคนเปิดชีตดูด้วยมือ
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}
