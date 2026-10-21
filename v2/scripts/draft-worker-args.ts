/**
 * งานที่ระบุมา (เครื่องที่กด "สร้าง Draft") — รับทั้ง --task TASK-… และลิงก์ kola-worker://draft?task=TASK-…
 * ตรวจรูปแบบเข้มงวด เพราะค่ามาจากลิงก์ที่เบราว์เซอร์ส่งต่อมา
 */
export function taskFromArgs(argv: string[]): string | null {
  const i = argv.indexOf('--task');
  let raw = i >= 0 ? argv[i + 1] ?? '' : argv.find((a) => a.startsWith('kola-worker:')) ?? '';
  if (raw.includes('://')) {
    try { raw = new URL(raw).searchParams.get('task') ?? ''; } catch { raw = ''; }
  }
  raw = raw.trim();
  if (!raw) return null;
  if (!/^TASK-[A-F0-9]{8,40}$/.test(raw)) throw new Error(`เลขงานไม่ถูกต้อง: '${raw}'`);
  return raw;
}
