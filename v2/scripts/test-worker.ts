/** ทดสอบ REST ที่โปรแกรม Python จะใช้ — รวมถึงการกันคีย์ผิด */
import { loadEnv } from '../src/lib/env';
loadEnv();

const URL = 'http://localhost:3000/api/worker';
const KEY = process.env.WORKER_API_KEY!;

async function call(key: string, fn: string, args: unknown = {}) {
  const res = await fetch(URL, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, fn, args }),
  });
  return { status: res.status, body: await res.json() };
}

async function main() {
  let failed = 0;
  const check = (label: string, ok: boolean, detail = '') => {
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ผ่าน' : 'พัง '} ${label}${detail ? ` — ${detail}` : ''}`);
  };

  const wrongKey = await call('wrong-key', 'queueStatus');
  check('คีย์ผิดถูกปฏิเสธ', wrongKey.status === 401);

  const noKey = await call('', 'queueStatus');
  check('ไม่ส่งคีย์ถูกปฏิเสธ', noKey.status === 401);

  const badFn = await call(KEY, 'submitDraftTask', {});
  check('worker ยัดงานเข้าคิวเองไม่ได้', badFn.status === 403,
    String(badFn.body?.error ?? '').slice(0, 60));

  const status = await call(KEY, 'queueStatus');
  check('queueStatus ใช้ได้', status.status === 200 && status.body?.ok === true,
    JSON.stringify(status.body?.data?.queue ?? []));

  const claim = await call(KEY, 'claimNext', { worker: 'test-runner' });
  check('claimNext ใช้ได้', claim.status === 200 && claim.body?.ok === true,
    claim.body?.data?.task ? `ได้งาน ${claim.body.data.task.type}` : 'คิวว่าง');

  console.log(failed ? `\nมี ${failed} เคสไม่ผ่าน` : '\nPASS: REST ของ worker ทำงานถูกต้องและกันสิทธิ์ได้');
  if (failed) process.exit(1);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
