function setupSystem() {
  var activeEmail = cleanText_(Session.getActiveUser().getEmail()).toLocaleLowerCase();
  var effectiveEmail = cleanText_(Session.getEffectiveUser().getEmail()).toLocaleLowerCase();
  assert_(activeEmail && effectiveEmail && activeEmail === effectiveEmail,
    'FORBIDDEN', 'setupSystem ต้องรันจาก Apps Script editor โดยบัญชีเจ้าของโปรเจกต์เท่านั้น');
  return setupSystem_();
}

function setupSystem_() {
  return withScriptLock_(function () {
    DriveApp.getFolderById(APP_CONFIG.DRIVE_FOLDER_ID).getName();
    Object.keys(SHEET_SCHEMAS).forEach(function (sheetName) {
      ensureSheet_(sheetName, SHEET_SCHEMAS[sheetName]);
    });

    var properties = PropertiesService.getScriptProperties();
    if (!properties.getProperty('PASSWORD_PEPPER')) {
      properties.setProperty('PASSWORD_PEPPER', randomToken_() + randomToken_());
    }

    seedMasterData_();
    var adminResult = ensureInitialAdmin_();
    properties.setProperty('KOLA_SETUP_VERSION', APP_CONFIG.VERSION);
    properties.setProperty('KOLA_SETUP_AT', nowIso_());

    var result = {
      ok: true,
      appName: APP_CONFIG.APP_NAME,
      version: APP_CONFIG.VERSION,
      spreadsheetId: APP_CONFIG.SPREADSHEET_ID,
      driveFolderId: APP_CONFIG.DRIVE_FOLDER_ID,
      adminUsername: adminResult.username,
      temporaryPassword: adminResult.temporaryPassword,
      message: adminResult.temporaryPassword
        ? 'สร้างระบบและผู้ดูแลเริ่มต้นแล้ว กรุณาเก็บรหัสชั่วคราวจาก Execution log'
        : 'ตรวจสอบและอัปเดตโครงสร้างระบบเรียบร้อยแล้ว'
    };
    Logger.log(JSON.stringify(result));
    return result;
  });
}

function seedMasterData_() {
  var now = nowIso_();
  var seeds = [
    { sheet: APP_CONFIG.SHEETS.MD_SHIPPERS, record: { code: 'SHP0001', name: 'AE TRADING COMPANY' } },
    { sheet: APP_CONFIG.SHEETS.MD_CONSIGNEES, record: { code: 'CNE0001', name: 'MAESOT FREEZONE CO.,LTD.' } },
    { sheet: APP_CONFIG.SHEETS.MD_NOTIFY, record: { code: 'NTP0001', name: 'KOLA SHIPPING CO.,LTD.' } },
    { sheet: APP_CONFIG.SHEETS.MD_PEOPLE, record: { code: 'PIC0001', name: 'FAISAL', roleName: 'Client in charge' } },
    { sheet: APP_CONFIG.SHEETS.MD_LOADING_TYPES, record: { code: '20GP', name: '20 FT General Purpose Container', description: '20 GP' } },
    { sheet: APP_CONFIG.SHEETS.MD_LOADING_TYPES, record: { code: '40HC', name: '40 FT High Cube Container', description: '40 HC' } },
    { sheet: APP_CONFIG.SHEETS.MD_LOADING_TYPES, record: { code: 'LCL', name: 'Less than Container Load', description: 'ไม่เต็มตู้' } },
    { sheet: APP_CONFIG.SHEETS.MD_PORTS, record: { code: 'THLCH', name: 'ท่าเรือแหลมฉบัง (Laem Chabang Port)', country: 'Thailand' } },
    { sheet: APP_CONFIG.SHEETS.MD_TERMINALS, record: { code: 'A2', name: 'A2', description: 'Laem Chabang Terminal' } },
    { sheet: APP_CONFIG.SHEETS.MD_JOB_TYPES, record: { code: 'MU', name: 'MSFZ - USED CAR', description: 'งานนำเข้ารถยนต์เก่า' } },
    { sheet: APP_CONFIG.SHEETS.MD_JOB_TYPES, record: { code: 'MO', name: 'MSFZ - OTHERS', description: 'งานนำเข้าสินค้าทั่วไป' } },
    { sheet: APP_CONFIG.SHEETS.MD_JOB_TYPES, record: { code: 'TU', name: 'TRANSIT - USED CAR', description: 'งานผ่านแดนรถยนต์เก่า' } },
    { sheet: APP_CONFIG.SHEETS.MD_JOB_TYPES, record: { code: 'TO', name: 'TRANSIT - OTHERS', description: 'งานผ่านแดนสินค้าทั่วไป' } },
    { sheet: APP_CONFIG.SHEETS.MD_CONTAINER_TYPES, record: { code: '40', name: '40"', description: 'ตู้ 40 ฟุต (ค่าตั้งต้น)' } },
    { sheet: APP_CONFIG.SHEETS.MD_CONTAINER_TYPES, record: { code: '20', name: '20"', description: 'ตู้ 20 ฟุต' } },
    { sheet: APP_CONFIG.SHEETS.MD_CONTAINER_TYPES, record: { code: 'RORO', name: 'RORO', description: 'Roll-on / Roll-off' } },
    { sheet: APP_CONFIG.SHEETS.MD_PACKAGE_TYPES, record: { code: 'UNIT', name: 'UNIT', description: 'หน่วย' } },
    { sheet: APP_CONFIG.SHEETS.MD_PACKAGE_TYPES, record: { code: 'PK', name: 'PK', description: 'Package' } },
    { sheet: APP_CONFIG.SHEETS.MD_PACKAGE_TYPES, record: { code: 'PP', name: 'PP', description: 'Pallet / Pack' } },
    { sheet: APP_CONFIG.SHEETS.MD_SETTINGS, record: { code: SETTING_KEYS.DEM_FREE_DAYS, name: 'DEM FREE (วัน)', value: '5', description: 'ค่าตั้งต้นช่อง DEM FREE ในหน้ารับงาน' } },
    { sheet: APP_CONFIG.SHEETS.MD_SETTINGS, record: { code: SETTING_KEYS.DET_FREE_DAYS, name: 'DET FREE (วัน)', value: '3', description: 'ค่าตั้งต้นช่อง DET FREE ในหน้ารับงาน' } },
    { sheet: APP_CONFIG.SHEETS.MD_SETTINGS, record: { code: SETTING_KEYS.REQUEST_BOOK_NO, name: 'เล่มที่คำร้อง E-Office', value: '0869', description: 'เลขชุดหน้าของช่อง "เลขที่" ในคำร้อง ส่วนเลขท้ายระบบรันต่อเอง' } },
    { sheet: APP_CONFIG.SHEETS.MD_SETTINGS, record: { code: SETTING_KEYS.HUB_URL, name: 'URL ของ Automation Hub', value: '', description: 'ลิงก์ /exec ของเว็บพักข้อมูล' } },
    { sheet: APP_CONFIG.SHEETS.MD_SETTINGS, record: { code: SETTING_KEYS.HUB_API_KEY, name: 'API key ของ Hub (ฝั่ง ERP)', value: '', description: 'คีย์ apiKeyErp ที่ได้จาก hubSetup()' } }
  ];
  seeds.forEach(function (seed) {
    var existing = findOne_(seed.sheet, function (row) {
      return normalizeKey_(row.code) === normalizeKey_(seed.record.code);
    });
    if (!existing) {
      var record = Object.assign({
        id: newId_('MD'),
        isActive: true,
        createdAt: now,
        updatedAt: now
      }, seed.record);
      appendRecord_(seed.sheet, record);
    }
  });
}

function ensureInitialAdmin_() {
  var users = getTable_(APP_CONFIG.SHEETS.USERS);
  if (users.length) return { username: '', temporaryPassword: '' };

  var password = 'Kola!' + randomToken_().replace(/[^A-Za-z0-9]/g, '').slice(0, 10);
  var salt = randomToken_().slice(0, 32);
  appendRecord_(APP_CONFIG.SHEETS.USERS, {
    id: newId_('USR'),
    username: 'admin',
    passwordHash: passwordHash_(password, salt),
    salt: salt,
    displayName: 'System Administrator',
    role: APP_CONFIG.ROLES.ADMIN,
    isActive: true,
    mustChangePassword: true,
    failedAttempts: 0,
    lockedUntil: '',
    createdAt: nowIso_(),
    updatedAt: nowIso_(),
    lastLoginAt: ''
  });
  return { username: 'admin', temporaryPassword: password };
}

function getSystemInfo_() {
  return {
    name: APP_CONFIG.APP_NAME,
    version: APP_CONFIG.VERSION,
    configured: Boolean(PropertiesService.getScriptProperties().getProperty('KOLA_SETUP_VERSION'))
  };
}
