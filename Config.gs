var APP_CONFIG = Object.freeze({
  APP_NAME: 'KOLA Import ERP',
  VERSION: '1.1.0',
  TIME_ZONE: 'Asia/Bangkok',
  SPREADSHEET_ID: '1OlGfGpTLvRK7BzX1Gpp3d8qDlRin4DNeFxImeJBHV7k',
  DRIVE_FOLDER_ID: '1WImX_A2jPtp4OYL80pigVogzUhh_oIOX',
  SESSION_HOURS: 8,
  MAX_FAILED_LOGINS: 5,
  LOCK_MINUTES: 15,
  PASSWORD_ROUNDS: 600,
  MAX_FILE_BYTES: 8 * 1024 * 1024,
  ROLES: Object.freeze({
    ADMIN: 'ADMIN',
    PAINT: 'PAINT',
    FAH: 'FAH',
    NAMKANG: 'NAMKANG'
  }),
  APPROVAL_TYPES: Object.freeze({
    AN: 'AN',
    FN: 'FN'
  }),
  FILE_CATEGORIES: Object.freeze({
    ARRIVAL_NOTICE: 'ARRIVAL_NOTICE',
    BL: 'BL',
    INVOICE_GOODS: 'INVOICE_GOODS',
    SURRENDER: 'SURRENDER',
    FINAL_INVOICE: 'FINAL_INVOICE',
    EOFFICE: 'EOFFICE',
    INVOICE_DO: 'INVOICE_DO',
    EOFFICE_REQUEST: 'EOFFICE_REQUEST',
    CUSTOMS_ENTRY_DOC: 'CUSTOMS_ENTRY_DOC',
    EOFFICE_MERGED: 'EOFFICE_MERGED',
    OTHER: 'OTHER'
  }),
  SHEETS: Object.freeze({
    USERS: '_USERS',
    SESSIONS: '_SESSIONS',
    JOBS: 'JOBS',
    BLS: 'BLS',
    CONTAINERS: 'CONTAINERS',
    FILES: 'FILES',
    APPROVALS: 'APPROVALS',
    STATUS_HISTORY: 'STATUS_HISTORY',
    ACTIVITY_LOG: 'ACTIVITY_LOG',
    JOB_SEQUENCES: 'JOB_SEQUENCES',
    DO_HANDOFFS: 'DO_HANDOFFS',
    CUSTOMS_ENTRIES: 'CUSTOMS_ENTRIES',
    INSPECTION_RELEASES: 'INSPECTION_RELEASES',
    MD_SHIPPERS: 'MD_SHIPPERS',
    MD_PEOPLE: 'MD_PEOPLE',
    MD_CONSIGNEES: 'MD_CONSIGNEES',
    MD_NOTIFY: 'MD_NOTIFY',
    MD_LOADING_TYPES: 'MD_LOADING_TYPES',
    MD_PORTS: 'MD_PORTS',
    MD_TERMINALS: 'MD_TERMINALS',
    MD_JOB_TYPES: 'MD_JOB_TYPES',
    MD_CONTAINER_TYPES: 'MD_CONTAINER_TYPES',
    MD_PACKAGE_TYPES: 'MD_PACKAGE_TYPES',
    MD_SETTINGS: 'MD_SETTINGS',
    EOFFICE_REQUESTS: 'EOFFICE_REQUESTS'
  })
});

var SHEET_SCHEMAS = {};

SHEET_SCHEMAS[APP_CONFIG.SHEETS.USERS] = [
  'id', 'username', 'passwordHash', 'salt', 'displayName', 'role', 'isActive',
  'mustChangePassword', 'failedAttempts', 'lockedUntil', 'createdAt', 'updatedAt',
  'lastLoginAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.SESSIONS] = [
  'id', 'tokenHash', 'userId', 'expiresAt', 'lastSeenAt', 'createdAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.JOBS] = [
  'id', 'jobNo', 'blNo', 'vessel', 'voyage', 'eta', 'etd', 'shipperId',
  'consigneeId', 'notifyPartyId', 'loadingTypeId', 'portId', 'terminalId',
  'personId', 'jobTypeId', 'status', 'surrenderStatus', 'customsStatus',
  'releaseStatus', 'hasInvoiceAlert', 'customerNote', 'createdBy', 'createdAt',
  'updatedBy', 'updatedAt', 'isArchived', 'sourceType', 'blType', 'product',
  'unitAmount', 'grossWeight', 'shipline', 'demDays', 'detDays', 'etaOfficial',
  'releasePartner', 'draftRefNo', 'draftStatus', 'packageType',
  'goodsValue', 'goodsCurrency', 'draftTaskId', 'customsTaskId',
  'etaIsOfficial', 'transportDate', 'draftRejectReason'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.BLS] = [
  'id', 'jobId', 'blNo', 'blType', 'marks', 'description', 'packageCount',
  'grossWeight', 'measurement', 'createdAt', 'updatedAt', 'shipperId', 'shipperName'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.CONTAINERS] = [
  'id', 'jobId', 'containerNo', 'containerType', 'sealNo', 'weight',
  'packageCount', 'createdAt', 'updatedAt', 'jobNo'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.FILES] = [
  'id', 'jobId', 'category', 'version', 'driveFileId', 'driveFolderId',
  'fileName', 'mimeType', 'sizeBytes', 'note', 'changeReason', 'isCurrent',
  'isAcknowledged', 'acknowledgedBy', 'acknowledgedAt', 'supersededBy',
  'uploadedBy', 'uploadedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.APPROVALS] = [
  'id', 'jobId', 'approvalType', 'status', 'reason', 'requestedBy',
  'requestedAt', 'decidedBy', 'decidedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.STATUS_HISTORY] = [
  'id', 'jobId', 'fromStatus', 'toStatus', 'note', 'actorId', 'createdAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.ACTIVITY_LOG] = [
  'id', 'userId', 'action', 'entityType', 'entityId', 'detail', 'createdAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.JOB_SEQUENCES] = [
  'id', 'year', 'prefix', 'lastNumber', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.DO_HANDOFFS] = [
  'id', 'jobId', 'etaOfficial', 'portId', 'terminalId', 'partnerName',
  'invoiceDoFileId', 'note', 'sentBy', 'sentAt', 'updatedAt', 'transportDate'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.CUSTOMS_ENTRIES] = [
  'id', 'jobId', 'entryNo', 'status', 'declarationNo', 'amount', 'note',
  'createdBy', 'createdAt', 'filedBy', 'filedAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.INSPECTION_RELEASES] = [
  'id', 'jobId', 'inspectionRequired', 'inspectionResult', 'releaseNote',
  'releasedBy', 'releasedAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_SHIPPERS] = [
  'id', 'code', 'name', 'taxId', 'address', 'contactName', 'phone', 'email',
  'isActive', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_PEOPLE] = [
  'id', 'code', 'name', 'roleName', 'phone', 'email', 'isActive', 'createdAt',
  'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_CONSIGNEES] = [
  'id', 'code', 'name', 'taxId', 'address', 'contactName', 'phone', 'email',
  'isActive', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_NOTIFY] = [
  'id', 'code', 'name', 'address', 'contactName', 'phone', 'email', 'isActive',
  'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_LOADING_TYPES] = [
  'id', 'code', 'name', 'description', 'isActive', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_PORTS] = [
  'id', 'code', 'name', 'country', 'isActive', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_TERMINALS] = [
  'id', 'code', 'name', 'portId', 'description', 'isActive', 'createdAt',
  'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_JOB_TYPES] = [
  'id', 'code', 'name', 'description', 'isActive', 'createdAt', 'updatedAt'
];

SHEET_SCHEMAS[APP_CONFIG.SHEETS.EOFFICE_REQUESTS] = [
  'id', 'jobId', 'jobNo', 'requestNo', 'bookNo', 'runningNo', 'requestDate',
  'entryNo', 'packageCount', 'netWeight', 'goodsValue', 'goodsType',
  'driveFileId', 'fileRecordId', 'createdBy', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_CONTAINER_TYPES] = [
  'id', 'code', 'name', 'description', 'isActive', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_PACKAGE_TYPES] = [
  'id', 'code', 'name', 'description', 'isActive', 'createdAt', 'updatedAt'
];
SHEET_SCHEMAS[APP_CONFIG.SHEETS.MD_SETTINGS] = [
  'id', 'code', 'name', 'value', 'description', 'isActive', 'createdAt', 'updatedAt'
];

var MASTER_SHEET_MAP = Object.freeze({
  shippers: APP_CONFIG.SHEETS.MD_SHIPPERS,
  people: APP_CONFIG.SHEETS.MD_PEOPLE,
  consignees: APP_CONFIG.SHEETS.MD_CONSIGNEES,
  notify: APP_CONFIG.SHEETS.MD_NOTIFY,
  loadingTypes: APP_CONFIG.SHEETS.MD_LOADING_TYPES,
  ports: APP_CONFIG.SHEETS.MD_PORTS,
  terminals: APP_CONFIG.SHEETS.MD_TERMINALS,
  jobTypes: APP_CONFIG.SHEETS.MD_JOB_TYPES,
  containerTypes: APP_CONFIG.SHEETS.MD_CONTAINER_TYPES,
  packageTypes: APP_CONFIG.SHEETS.MD_PACKAGE_TYPES,
  settings: APP_CONFIG.SHEETS.MD_SETTINGS
});

// รหัสค่าตั้งต้นที่แก้ได้จากหน้า Master Data
var SETTING_KEYS = Object.freeze({
  DEM_FREE_DAYS: 'DEM_FREE_DAYS',
  DET_FREE_DAYS: 'DET_FREE_DAYS',
  REQUEST_BOOK_NO: 'REQUEST_BOOK_NO',
  HUB_URL: 'HUB_URL',
  HUB_API_KEY: 'HUB_API_KEY'
});
