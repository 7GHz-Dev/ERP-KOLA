/** ทดสอบว่าคุกกี้ session ปลอมแปลงไม่ได้ */
import assert from 'node:assert/strict';
import { loadEnv } from '../src/lib/env';

loadEnv();

async function main() {
  const { encodeSession, decodeSession } = await import('../src/lib/session-token');

  const valid = {
    sid: 'SES-TEST', uid: 'USR-1', username: 'admin', name: 'ผู้ดูแล',
    role: 'PAINT', mcp: false, exp: Date.now() + 600_000,
  };
  const token = encodeSession(valid);

  const cases: Array<[string, string | undefined, boolean]> = [
    ['คุกกี้ถูกต้อง', token, true],
    ['ไม่มีคุกกี้', undefined, false],
    ['ลายเซ็นถูกตัดออก', token.split('.')[0], false],
    ['ลายเซ็นถูกแก้ 1 ตัวอักษร', token.slice(0, -1) + (token.at(-1) === 'A' ? 'B' : 'A'), false],
    ['เนื้อหาถูกแก้แต่ใช้ลายเซ็นเดิม',
      Buffer.from(JSON.stringify({ ...valid, role: 'ADMIN' }), 'utf8').toString('base64url') +
        '.' + token.split('.')[1], false],
    ['หมดอายุแล้ว', encodeSession({ ...valid, exp: Date.now() - 1000 }), false],
    ['ข้อความมั่ว', 'not-a-token', false],
  ];

  let failed = 0;
  for (const [label, input, shouldPass] of cases) {
    const result = decodeSession(input);
    const ok = shouldPass ? result !== null : result === null;
    if (!ok) failed += 1;
    console.log(`  ${ok ? 'ผ่าน  ' : 'ไม่ผ่าน'} ${label}`);
  }

  // ยกระดับสิทธิ์ด้วยการแก้ role ต้องไม่สำเร็จ
  const escalated = decodeSession(
    Buffer.from(JSON.stringify({ ...valid, role: 'ADMIN' }), 'utf8').toString('base64url') +
      '.' + token.split('.')[1],
  );
  assert.equal(escalated, null, 'แก้ role เป็น ADMIN แล้วยังใช้ได้ = รูโหว่ร้ายแรง');

  assert.equal(failed, 0, `มี ${failed} เคสไม่ผ่าน`);
  console.log('\nPASS: คุกกี้ปลอมแปลงไม่ได้ แก้ role ไม่ได้ และหมดอายุแล้วใช้ไม่ได้');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
