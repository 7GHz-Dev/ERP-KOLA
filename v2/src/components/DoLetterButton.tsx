/**
 * ปุ่มออกจดหมายแลก D/O
 *
 * เปิดในแท็บใหม่เพราะเป็นไฟล์ PDF ระบบเก็บไฟล์ไว้กับงานให้ด้วยตอนกด
 * ไม่มีสายเรือที่ตรงกับแบบฟอร์มก็กดไม่ได้ และบอกว่าให้ไปตั้งที่ไหน
 */
export function DoLetterButton({
  jobId, ready, done,
}: { jobId: string; ready: boolean; done: boolean }) {
  if (!ready) return <span className="badge pending">ไม่มีแบบฟอร์มของสายเรือนี้</span>;
  return (
    <a
      className={`button tiny ${done ? '' : 'primary'}`}
      href={`/api/do-letter/${jobId}`}
      target="_blank"
      rel="noreferrer"
    >
      {done ? 'ออกใหม่' : 'ออกจดหมาย'}
    </a>
  );
}
