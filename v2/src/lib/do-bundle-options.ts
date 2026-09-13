export type DoBundleKind = 'do' | 'doPlain' | 'doUploaded';

export function doBundleFileName(blNo: string, kind: DoBundleKind): string {
  const bl = blNo.trim().replace(/[\\/:*?"<>|\r\n]/g, '-');
  if (!bl) throw new Error('กรุณาระบุ BL No. ก่อนรวมชุดแลก DO');
  return `${bl} ${kind === 'do' ? 'stamp' : kind === 'doPlain' ? 'no stamp' : 'uploaded'}.pdf`;
}

export function isDoBundleKind(value: unknown): value is DoBundleKind {
  return value === 'do' || value === 'doPlain' || value === 'doUploaded';
}
