/**
 * KOLA Automation Hub — เว็บพักข้อมูลระหว่าง KOLA ERP กับโปรแกรม Python
 *
 * ตัว Hub ไม่รู้จัก business logic ของ ERP เลย หน้าที่เดียวคือรับงานเข้าคิว
 * เก็บไฟล์ แล้วส่งต่อให้ worker มารับไปทำ และรับผลลัพธ์กลับมาพักไว้ให้ ERP มาดึง
 *
 * ID ของ Spreadsheet และ Drive folder ไม่ได้ hardcode ไว้ที่นี่
 * แต่ถูกสร้างและจำไว้ใน Script Properties ตอนรัน hubSetup() ครั้งแรก
 */
var HUB_CONFIG = Object.freeze({
  APP_NAME: 'KOLA Automation Hub',
  VERSION: '1.0.0',
  TIME_ZONE: 'Asia/Bangkok',

  // ไฟล์ที่รับเข้า/ส่งออกผ่าน JSON เป็น base64 จึงเผื่อ overhead ไว้
  MAX_FILE_BYTES: 20 * 1024 * 1024,

  // งานที่ค้างในสถานะ PROCESSING นานเกินนี้ถือว่า worker ตาย ปล่อยให้ตัวอื่นมารับต่อได้
  CLAIM_TIMEOUT_MINUTES: 30,

  PROP: Object.freeze({
    SPREADSHEET_ID: 'HUB_SPREADSHEET_ID',
    FOLDER_ID: 'HUB_FOLDER_ID',
    API_KEY_ERP: 'HUB_API_KEY_ERP',
    API_KEY_WORKER: 'HUB_API_KEY_WORKER',
    SETUP_AT: 'HUB_SETUP_AT'
  }),

  TASK_TYPES: Object.freeze({
    // ERP ส่งไฟล์ Final Invoice (xlsx) มา -> worker คืนเลข Ref No.
    DRAFT_ENTRY: 'DRAFT_ENTRY',
    // ERP ส่งเลข Ref No. มา -> worker คืนเลขใบขน + ไฟล์ใบขนสินค้าขาเข้า
    CUSTOMS_ENTRY: 'CUSTOMS_ENTRY'
  }),

  STATUS: Object.freeze({
    QUEUED: 'QUEUED',
    PROCESSING: 'PROCESSING',
    DONE: 'DONE',
    ERROR: 'ERROR'
  }),

  SHEETS: Object.freeze({
    TASKS: 'TASKS',
    LOG: 'LOG'
  })
});

var HUB_SCHEMAS = {};

HUB_SCHEMAS[HUB_CONFIG.SHEETS.TASKS] = [
  'id',
  'type',
  'status',
  'jobRef',           // id ของ Job ฝั่ง KOLA ERP ใช้จับคู่ผลลัพธ์กลับ
  'jobNo',            // ไว้ให้คนอ่านตารางเข้าใจว่างานไหน
  'payload',          // JSON ที่ ERP แนบมา เช่น { refNo: '...' }
  'inputFileId',
  'inputFileName',
  'inputMimeType',
  'resultRefNo',      // ผลของ DRAFT_ENTRY
  'resultEntryNo',    // ผลของ CUSTOMS_ENTRY
  'resultFileId',
  'resultFileName',
  'resultMimeType',
  'error',
  'attempts',
  'claimedBy',
  'claimedAt',
  'createdAt',
  'updatedAt',
  'completedAt'
];

HUB_SCHEMAS[HUB_CONFIG.SHEETS.LOG] = [
  'id', 'taskId', 'actor', 'action', 'detail', 'createdAt'
];
