export type MergeProgress = {
  index: number; total: number; label: string;
  status: 'reading' | 'added' | 'skipped' | 'saving' | 'done' | 'error';
  detail?: string; fileId?: string;
};

/** Read NDJSON even when a network chunk splits a Thai character or the last line has no newline. */
export async function readMergeProgress(response: Response, onStep: (step: MergeProgress) => void) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.detail ?? 'รวมชุดไม่สำเร็จ');
  }
  if (!response.body) throw new Error('เซิร์ฟเวอร์ไม่ส่งข้อมูลกลับ');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: MergeProgress | undefined;
  const readLine = (line: string) => {
    if (!line.trim()) return;
    const step = JSON.parse(line) as MergeProgress;
    if (step.status === 'error') throw new Error(step.detail ?? 'รวมชุดไม่สำเร็จ');
    onStep(step);
    if (step.status === 'done') result = step;
  };
  try {
    for (;;) {
      const chunk = await reader.read();
      buffer += decoder.decode(chunk.value, { stream: !chunk.done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      lines.forEach(readLine);
      if (chunk.done) break;
    }
    readLine(buffer);
    if (!result?.fileId) throw new Error('การรวมชุดยังไม่เสร็จ กรุณาลองใหม่');
    return result;
  } finally { reader.releaseLock(); }
}
