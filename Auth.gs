function getPasswordPepper_() {
  var pepper = PropertiesService.getScriptProperties().getProperty('PASSWORD_PEPPER');
  assert_(pepper, 'SETUP_REQUIRED', 'กรุณารัน setupSystem() ก่อนใช้งาน');
  return pepper;
}

function passwordHash_(password, salt) {
  var current = String(salt) + '|' + String(password) + '|' + getPasswordPepper_();
  for (var i = 0; i < APP_CONFIG.PASSWORD_ROUNDS; i += 1) {
    current = sha256Hex_(current + '|' + salt + '|' + i);
  }
  return current;
}

function validatePassword_(password) {
  var value = String(password || '');
  assert_(value.length >= 10, 'WEAK_PASSWORD', 'รหัสผ่านต้องยาวอย่างน้อย 10 ตัวอักษร');
  assert_(/[A-Za-z\u0E00-\u0E7F]/.test(value) && /[0-9]/.test(value),
    'WEAK_PASSWORD', 'รหัสผ่านต้องมีตัวอักษรและตัวเลข');
  return value;
}

function publicUser_(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    role: user.role,
    mustChangePassword: toBool_(user.mustChangePassword)
  };
}

function authLogin(username, password) {
  return withScriptLock_(function () {
    var normalized = normalizeKey_(username);
    var user = findOne_(APP_CONFIG.SHEETS.USERS, function (row) {
      return normalizeKey_(row.username) === normalized;
    });
    var genericMessage = 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง';

    if (!user || !toBool_(user.isActive)) {
      Utilities.sleep(250);
      appError_('INVALID_LOGIN', genericMessage);
    }

    var lockedUntil = user.lockedUntil ? new Date(user.lockedUntil).getTime() : 0;
    if (lockedUntil && lockedUntil > Date.now()) {
      appError_('ACCOUNT_LOCKED', 'บัญชีถูกล็อกชั่วคราว กรุณาลองใหม่ภายหลัง');
    }

    var submittedHash = passwordHash_(String(password || ''), user.salt);
    if (!constantTimeEquals_(submittedHash, user.passwordHash)) {
      var failed = toNumber_(user.failedAttempts, 0) + 1;
      var patch = { failedAttempts: failed, updatedAt: nowIso_() };
      if (failed >= APP_CONFIG.MAX_FAILED_LOGINS) {
        patch.lockedUntil = new Date(Date.now() + APP_CONFIG.LOCK_MINUTES * 60000).toISOString();
        patch.failedAttempts = 0;
      }
      updateRecord_(APP_CONFIG.SHEETS.USERS, user.id, patch);
      Utilities.sleep(250);
      appError_('INVALID_LOGIN', genericMessage);
    }

    var rawToken = randomToken_();
    var now = nowIso_();
    var expiresAt = new Date(Date.now() + APP_CONFIG.SESSION_HOURS * 3600000).toISOString();
    appendRecord_(APP_CONFIG.SHEETS.SESSIONS, {
      id: newId_('SES'),
      tokenHash: sha256Hex_(rawToken),
      userId: user.id,
      expiresAt: expiresAt,
      lastSeenAt: now,
      createdAt: now
    });
    updateRecord_(APP_CONFIG.SHEETS.USERS, user.id, {
      failedAttempts: 0,
      lockedUntil: '',
      lastLoginAt: now,
      updatedAt: now
    });
    purgeExpiredSessions_();
    logActivity_(user.id, 'LOGIN', 'USER', user.id, { username: user.username });

    return {
      token: rawToken,
      expiresAt: expiresAt,
      user: publicUser_(user)
    };
  });
}

function authLogout(token) {
  var session = requireSession_(token, null, true);
  return withScriptLock_(function () {
    updateRecord_(APP_CONFIG.SHEETS.SESSIONS, session.session.id, {
      expiresAt: nowIso_(),
      lastSeenAt: nowIso_()
    });
    logActivity_(session.user.id, 'LOGOUT', 'USER', session.user.id, {});
    return { ok: true };
  });
}

function authGetSession(token) {
  var session = requireSession_(token, null, true);
  return {
    user: publicUser_(session.user),
    expiresAt: session.session.expiresAt
  };
}

function authChangePassword(token, currentPassword, newPassword) {
  var session = requireSession_(token, null, true);
  var nextPassword = validatePassword_(newPassword);
  return withScriptLock_(function () {
    var user = findById_(APP_CONFIG.SHEETS.USERS, session.user.id);
    var currentHash = passwordHash_(String(currentPassword || ''), user.salt);
    assert_(constantTimeEquals_(currentHash, user.passwordHash), 'INVALID_PASSWORD', 'รหัสผ่านปัจจุบันไม่ถูกต้อง');
    assert_(!constantTimeEquals_(passwordHash_(nextPassword, user.salt), user.passwordHash),
      'SAME_PASSWORD', 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสเดิม');

    var salt = randomToken_().slice(0, 32);
    updateRecord_(APP_CONFIG.SHEETS.USERS, user.id, {
      passwordHash: passwordHash_(nextPassword, salt),
      salt: salt,
      mustChangePassword: false,
      updatedAt: nowIso_()
    });
    expireUserSessions_(user.id, session.session.id);
    logActivity_(user.id, 'CHANGE_PASSWORD', 'USER', user.id, {});
    return { ok: true };
  });
}

function requireSession_(token, allowedRoles, allowPasswordChange) {
  var rawToken = cleanText_(token, 500);
  assert_(rawToken, 'UNAUTHENTICATED', 'กรุณาเข้าสู่ระบบ');
  var tokenHash = sha256Hex_(rawToken);
  var session = findOne_(APP_CONFIG.SHEETS.SESSIONS, function (row) {
    return constantTimeEquals_(String(row.tokenHash), tokenHash);
  });
  assert_(session, 'UNAUTHENTICATED', 'Session ไม่ถูกต้อง กรุณาเข้าสู่ระบบใหม่');
  assert_(new Date(session.expiresAt).getTime() > Date.now(), 'SESSION_EXPIRED', 'Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');

  var user = findById_(APP_CONFIG.SHEETS.USERS, session.userId);
  assert_(user && toBool_(user.isActive), 'ACCOUNT_DISABLED', 'บัญชีนี้ถูกระงับการใช้งาน');
  assert_(allowPasswordChange || !toBool_(user.mustChangePassword),
    'PASSWORD_CHANGE_REQUIRED', 'กรุณาเปลี่ยนรหัสผ่านชั่วคราวก่อนใช้งาน');
  assert_(roleAllowed_(user.role, allowedRoles), 'FORBIDDEN', 'คุณไม่มีสิทธิ์ดำเนินการนี้');
  return { session: session, user: user };
}

function adminListUsers(token) {
  requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  return getTable_(APP_CONFIG.SHEETS.USERS).map(function (row) {
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      role: row.role,
      isActive: toBool_(row.isActive),
      mustChangePassword: toBool_(row.mustChangePassword),
      lockedUntil: row.lockedUntil,
      lastLoginAt: row.lastLoginAt,
      createdAt: row.createdAt
    };
  });
}

function adminCreateUser(token, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  payload = payload || {};
  return withScriptLock_(function () {
    var username = requiredText_(payload.username, 'ชื่อผู้ใช้', 60).toLocaleLowerCase();
    assert_(/^[a-z0-9._-]+$/.test(username), 'VALIDATION', 'ชื่อผู้ใช้ใช้ได้เฉพาะ a-z, 0-9, จุด, ขีดกลาง และขีดล่าง');
    assert_(!findOne_(APP_CONFIG.SHEETS.USERS, function (row) {
      return normalizeKey_(row.username) === normalizeKey_(username);
    }), 'DUPLICATE', 'ชื่อผู้ใช้นี้มีอยู่แล้ว');

    var roles = Object.keys(APP_CONFIG.ROLES).map(function (key) { return APP_CONFIG.ROLES[key]; });
    var role = cleanText_(payload.role).toUpperCase();
    assert_(roles.indexOf(role) !== -1, 'VALIDATION', 'Role ไม่ถูกต้อง');
    var generated = !payload.password;
    var password = generated
      ? 'Kola!' + randomToken_().replace(/[^A-Za-z0-9]/g, '').slice(0, 10)
      : validatePassword_(payload.password);
    var salt = randomToken_().slice(0, 32);
    var user = {
      id: newId_('USR'),
      username: username,
      passwordHash: passwordHash_(password, salt),
      salt: salt,
      displayName: requiredText_(payload.displayName, 'ชื่อที่แสดง', 120),
      role: role,
      isActive: true,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: '',
      createdAt: nowIso_(),
      updatedAt: nowIso_(),
      lastLoginAt: ''
    };
    appendRecord_(APP_CONFIG.SHEETS.USERS, user);
    logActivity_(session.user.id, 'CREATE_USER', 'USER', user.id, { username: username, role: role });
    return { user: publicUser_(user), temporaryPassword: generated ? password : '' };
  });
}

function adminUpdateUser(token, userId, payload) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  payload = payload || {};
  return withScriptLock_(function () {
    var target = findById_(APP_CONFIG.SHEETS.USERS, userId);
    assert_(target, 'NOT_FOUND', 'ไม่พบผู้ใช้');
    var roles = Object.keys(APP_CONFIG.ROLES).map(function (key) { return APP_CONFIG.ROLES[key]; });
    var role = cleanText_(payload.role || target.role).toUpperCase();
    assert_(roles.indexOf(role) !== -1, 'VALIDATION', 'Role ไม่ถูกต้อง');
    var isActive = payload.isActive === undefined ? toBool_(target.isActive) : toBool_(payload.isActive);
    assert_(target.id !== session.user.id || isActive, 'VALIDATION', 'ไม่สามารถปิดบัญชีที่กำลังใช้งานอยู่');
    var updated = updateRecord_(APP_CONFIG.SHEETS.USERS, target.id, {
      displayName: requiredText_(payload.displayName || target.displayName, 'ชื่อที่แสดง', 120),
      role: role,
      isActive: isActive,
      failedAttempts: payload.unlock ? 0 : target.failedAttempts,
      lockedUntil: payload.unlock ? '' : target.lockedUntil,
      updatedAt: nowIso_()
    });
    if (!isActive) expireUserSessions_(target.id, '');
    logActivity_(session.user.id, 'UPDATE_USER', 'USER', target.id, { role: role, isActive: isActive });
    return publicUser_(updated);
  });
}

function adminResetPassword(token, userId) {
  var session = requireSession_(token, [APP_CONFIG.ROLES.ADMIN]);
  return withScriptLock_(function () {
    var target = findById_(APP_CONFIG.SHEETS.USERS, userId);
    assert_(target, 'NOT_FOUND', 'ไม่พบผู้ใช้');
    var password = 'Kola!' + randomToken_().replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
    var salt = randomToken_().slice(0, 32);
    updateRecord_(APP_CONFIG.SHEETS.USERS, target.id, {
      passwordHash: passwordHash_(password, salt),
      salt: salt,
      mustChangePassword: true,
      failedAttempts: 0,
      lockedUntil: '',
      updatedAt: nowIso_()
    });
    expireUserSessions_(target.id, '');
    logActivity_(session.user.id, 'RESET_PASSWORD', 'USER', target.id, {});
    return { temporaryPassword: password };
  });
}

function expireUserSessions_(userId, exceptSessionId) {
  getTable_(APP_CONFIG.SHEETS.SESSIONS).forEach(function (row) {
    if (String(row.userId) === String(userId) && String(row.id) !== String(exceptSessionId || '')) {
      updateRecord_(APP_CONFIG.SHEETS.SESSIONS, row.id, { expiresAt: nowIso_() });
    }
  });
}

function purgeExpiredSessions_() {
  var sheet = getSheet_(APP_CONFIG.SHEETS.SESSIONS);
  var expiredRows = getTable_(APP_CONFIG.SHEETS.SESSIONS).filter(function (row) {
    return new Date(row.expiresAt).getTime() <= Date.now() - 24 * 3600000;
  }).map(function (row) { return row._rowNumber; }).sort(function (a, b) { return b - a; });
  expiredRows.forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });
}
