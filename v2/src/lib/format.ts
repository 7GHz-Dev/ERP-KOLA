/** วันที่ทั้งระบบเป็น dd/mm/yyyy ค.ศ. ให้ตรงกับที่ตกลงไว้ในระบบเดิม */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC',
  }).format(d);
}

/** วันสุดท้ายของ DEM/DET = วันตั้งต้น + จำนวนวัน */
export function addDays(value: string | null | undefined, days: number | null | undefined): string | null {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + (Number(days) || 0));
  return d.toISOString().slice(0, 10);
}

/** วันที่พร้อมเวลา สำหรับประวัติการทำงาน */
export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '-';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: false,
    timeZone: 'Asia/Bangkok',
  }).format(d);
}

/** ตัวเลขจาก numeric ของ Postgres มาเป็นสตริง เช่น "40.000" — ตัดศูนย์ท้ายทิ้ง */
export function num(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '-';
  const n = Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString('en-US', { maximumFractionDigits: 3 });
}

/** ขนาดไฟล์ให้อ่านง่าย */
export function fileSize(bytes: number | null | undefined): string {
  if (!bytes) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
