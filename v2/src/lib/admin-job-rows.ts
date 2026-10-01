/**
 * อ่านแถว BL และตู้จากฟอร์มแก้ไข JOB ของ ADMIN
 *
 * ช่องของแต่ละแถวส่งมาเป็นชื่อซ้ำกัน (bl_no, bl_no, …) เรียงตามลำดับแถว
 * ส่วนช่องติ๊ก "ลบ" ส่งมาเฉพาะแถวที่ติ๊ก จึงใช้ id ของแถวเป็นค่า ไม่ใช้ลำดับ
 * (ถ้าใช้ลำดับ ติ๊กแถวที่สามจะไปลบแถวแรกแทน)
 *
 * แยกออกมาเป็นตรรกะล้วนเพื่อทดสอบได้โดยไม่ต้องมีฐานข้อมูล
 */
const clean = (v: FormDataEntryValue | undefined, max: number) => String(v ?? '').trim().slice(0, max);

export type BlInput = { id: string; blNo: string; shipperId: string | null };
export type ContainerInput = {
  id: string; containerNo: string; containerType: string; sealNo: string; weight: string | null;
};

export function readBlRows(formData: FormData): BlInput[] {
  const remove = new Set(formData.getAll('bl_remove').map(String));
  const ids = formData.getAll('bl_id').map(String);
  const nos = formData.getAll('bl_no');
  const shippers = formData.getAll('bl_shipper');
  const rows = ids.map((id, i) => ({
    id, blNo: clean(nos[i], 120), shipperId: clean(shippers[i], 80) || null,
  }))
    // แถวเดิมที่ติ๊กลบ และแถวใหม่ที่เพิ่มแล้วไม่ได้กรอกอะไร ไม่นับ
    .filter((r) => !(r.id && remove.has(r.id)) && (r.id || r.blNo || r.shipperId));
  if (rows.some((r) => !r.blNo)) throw new Error('BL ทุกใบต้องมีเลข BL (ไม่ใช้ใบไหนให้ติ๊ก "ลบ")');
  return rows;
}

export function readContainerRows(formData: FormData): ContainerInput[] {
  const remove = new Set(formData.getAll('ct_remove').map(String));
  const ids = formData.getAll('ct_id').map(String);
  const nos = formData.getAll('ct_no');
  const types = formData.getAll('ct_type');
  const seals = formData.getAll('ct_seal');
  const weights = formData.getAll('ct_weight');
  const rows = ids.map((id, i) => ({
    id,
    containerNo: clean(nos[i], 40).toUpperCase(),
    containerType: clean(types[i], 40),
    sealNo: clean(seals[i], 60),
    weight: clean(weights[i], 40).replace(/,/g, '') || null,
  })).filter((r) => !(r.id && remove.has(r.id)) && (r.id || r.containerNo || r.sealNo || r.weight));
  if (rows.some((r) => !r.containerNo)) throw new Error('ตู้ทุกแถวต้องมีเลขตู้ (ไม่ใช้แถวไหนให้ติ๊ก "ลบ")');
  if (rows.some((r) => r.weight !== null && !Number.isFinite(Number(r.weight)))) {
    throw new Error('น้ำหนักตู้ต้องเป็นตัวเลข');
  }
  return rows;
}
