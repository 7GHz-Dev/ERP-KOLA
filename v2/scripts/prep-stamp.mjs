/**
 * เตรียมรูปตราประทับ/ลายเซ็นจากภาพถ่าย ให้พื้นหลังโปร่งใสก่อนอัปโหลด
 *
 * ภาพถ่ายจากมือถือกระดาษไม่ได้ขาวจริง (สว่างราว 160-190) การตัดด้วยความสว่าง
 * อย่างเดียวจึงแยกหมึกออกจากกระดาษไม่ได้ สคริปต์นี้ใช้ "ความน้ำเงิน" (B - R)
 * ร่วมกับความเข้มเทียบกับกระดาษของรูปนั้น ๆ จึงทนต่อแสงถ่ายภาพที่ไม่สม่ำเสมอ
 *
 * ใช้:  node scripts/prep-stamp.mjs <ไฟล์เข้า> <ไฟล์ออก.png> [sign]
 *       ใส่ sign ต่อท้ายเมื่อเป็นลายเซ็น เพราะเส้นบางกว่าตรา ต้องผ่อนเกณฑ์ลง
 *
 * ผลลัพธ์เป็น PNG พื้นหลังโปร่งและตัดขอบว่างออกแล้ว เอาไปอัปที่
 * Master Data → ฟอร์มจดหมายแลก DO → ตราประทับและลายเซ็น ได้เลย
 */
import sharp from 'sharp';

const [input, output, kind] = process.argv.slice(2);
if (!input || !output) {
  console.error('ใช้: node scripts/prep-stamp.mjs <ไฟล์เข้า> <ไฟล์ออก.png> [sign]');
  process.exit(1);
}
const isSign = kind === 'sign';

const src = sharp(input);
const { width, height } = await src.metadata();
const { data } = await src.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

// หาความสว่างของกระดาษจากขอบภาพ ใช้เป็นฐานเทียบเฉพาะของรูปนี้
let sum = 0;
let count = 0;
for (let y = 0; y < height; y += 7) {
  for (let x = 0; x < width; x += 7) {
    if (x > width * 0.12 && x < width * 0.88 && y > height * 0.12 && y < height * 0.88) continue;
    const i = (y * width + x) * 4;
    sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    count += 1;
  }
}
const paper = sum / count;

// ลายเซ็นเส้นบางกว่าตรา ใช้เกณฑ์หลวมกว่าเพื่อไม่ให้เส้นจางหายไป
const minBlue = isSign ? 12 : 18;
const minDark = isSign ? 15 : 25;
const floor = isSign ? 0.6 : 0.35;

let ink = 0;
for (let i = 0; i < data.length; i += 4) {
  const r = data[i];
  const g = data[i + 1];
  const b = data[i + 2];
  const lum = 0.299 * r + 0.587 * g + 0.114 * b;
  const blue = b - r;

  if (blue > minBlue && lum < paper - minDark) {
    const strength = (blue - minBlue) / (isSign ? 25 : 30)
      + (paper - minDark - lum) / (isSign ? 45 : 60);
    data[i + 3] = Math.round(255 * Math.max(floor, Math.min(1, strength)));
    // ปรับหมึกให้เป็นน้ำเงินเข้มสม่ำเสมอ ลบคราบสีของกระดาษออก
    data[i] = 22;
    data[i + 1] = 38;
    data[i + 2] = 108;
    ink += 1;
  } else {
    data[i + 3] = 0;
  }
}

// ตัดขอบโปร่งรอบนอกทิ้ง ความกว้างที่ตั้งบนจดหมายจะได้หมายถึงตัวตราจริง
const png = await sharp(data, { raw: { width, height, channels: 4 } })
  .png()
  .toBuffer();
await sharp(png).trim({ threshold: 1 }).png().toFile(output);

const meta = await sharp(output).metadata();
console.log(
  `${output} — กระดาษสว่าง ${paper.toFixed(0)} · หมึก ${(ink / (width * height) * 100).toFixed(2)}%`
  + ` · ${meta.width}x${meta.height}`,
);
