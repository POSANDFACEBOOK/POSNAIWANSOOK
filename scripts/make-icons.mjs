// ═══════════════════════════════════════════════════════════════════════════
// สร้างชุดไอคอนทั้งหมดจากโลโก้ต้นฉบับไฟล์เดียว — รันซ้ำได้ ผลลัพธ์เหมือนเดิมทุกครั้ง
//   node scripts/make-icons.mjs
//
// ทำไมต้องเป็นสคริปต์ ไม่ใช่ลากไฟล์ใส่เอง: ไอคอนมี 8 ขนาดและมีกฎต่างกันต่อแพลตฟอร์ม
// (iOS ห้ามพื้นโปร่ง · Android ต้องเผื่อขอบให้ระบบครอปวงกลม) ถ้าทำมือครั้งหน้าจะลืมกฎ
// พอเปลี่ยนโลโก้ก็แค่ทับ src/assets/logo.png แล้วรันใหม่
// ═══════════════════════════════════════════════════════════════════════════
import { createCanvas, loadImage } from "@napi-rs/canvas";
import fs from "node:fs";
import path from "node:path";

const SRC = "src/assets/logo.png";
const OUT = "public";
// ครีมอุ่นให้เข้ากับเส้นสีน้ำตาลของโลโก้ — ไอคอนแอปต้องทึบ ใช้ขาวจัดจะแข็งเกินไป
const BG = "#FFFBF6";

const img = await loadImage(SRC);

// หากรอบเนื้อหาจริง แล้วจัดกึ่งกลางใหม่ — ต้นฉบับมีขอบใสข้างซ้าย 18px ข้างขวา 0
// ถ้าไม่ตัดออกก่อน โลโก้จะเยื้องไปทางขวาในทุกไอคอนที่สร้าง
function contentBox() {
  const c = createCanvas(img.width, img.height);
  const x = c.getContext("2d");
  x.drawImage(img, 0, 0);
  const d = x.getImageData(0, 0, img.width, img.height).data;
  let x0 = img.width, y0 = img.height, x1 = -1, y1 = -1;
  for (let py = 0; py < img.height; py++) {
    for (let px = 0; px < img.width; px++) {
      if (d[(py * img.width + px) * 4 + 3] > 8) {
        if (px < x0) x0 = px; if (px > x1) x1 = px;
        if (py < y0) y0 = py; if (py > y1) y1 = py;
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}
const box = contentBox();

// ย่อทีละครึ่งจนใกล้ขนาดเป้าหมาย — ย่อรวดเดียวจากภาพใหญ่ทำให้เส้นบางแตกเป็นหยัก
function scaled(w, h) {
  let cur = createCanvas(img.width, img.height);
  cur.getContext("2d").drawImage(img, 0, 0);
  let cw = img.width, ch = img.height;
  while (cw / 2 > w && ch / 2 > h) {
    const n = createCanvas(Math.round(cw / 2), Math.round(ch / 2));
    const nx = n.getContext("2d");
    nx.imageSmoothingEnabled = true; nx.imageSmoothingQuality = "high";
    nx.drawImage(cur, 0, 0, n.width, n.height);
    cur = n; cw = n.width; ch = n.height;
  }
  return { cur, cw, ch };
}

// pad = สัดส่วนขอบว่างรอบโลโก้ (0.1 = เว้น 10% ของด้าน)
function render(size, { bg = null, pad = 0.08 } = {}) {
  const c = createCanvas(size, size);
  const x = c.getContext("2d");
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, size, size); }
  const avail = size * (1 - pad * 2);
  const k = Math.min(avail / box.w, avail / box.h);
  const dw = box.w * k, dh = box.h * k;
  const { cur, cw, ch } = scaled(dw * (img.width / box.w), dh * (img.height / box.h));
  const sx = cw / img.width, sy = ch / img.height;
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  x.drawImage(cur, box.x * sx, box.y * sy, box.w * sx, box.h * sy,
    (size - dw) / 2, (size - dh) / 2, dw, dh);
  return c.toBuffer("image/png");
}

// .ico ที่ห่อ PNG ไว้ข้างใน — รูปแบบนี้เบราว์เซอร์ยุคใหม่อ่านได้หมด และเลี่ยงการ
// เขียน bitmap แบบเก่าเองซึ่งพลาดง่าย (ต้องมี AND mask + แถวเรียงกลับหัว)
function ico(png) {
  const h = Buffer.alloc(6); h.writeUInt16LE(0, 0); h.writeUInt16LE(1, 2); h.writeUInt16LE(1, 4);
  const e = Buffer.alloc(16);
  e[0] = 48; e[1] = 48; e[2] = 0; e[3] = 0;
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6);
  e.writeUInt32LE(png.length, 8); e.writeUInt32LE(22, 12);
  return Buffer.concat([h, e, png]);
}

const files = [
  // ในแอป — พื้นโปร่ง วางบนพื้นสีอะไรก็ได้
  // ใช้ "ขนาดเนื้อหาจริง" ไม่ขยายเกินต้นฉบับ: การขยายไม่ได้เพิ่มรายละเอียดสักพิกเซล
  // มีแต่ทำให้ไฟล์บวม (512 = 293KB เทียบกับ ~90KB) และหน้าเว็บโหลดช้าลงทุกครั้ง
  ["logo.png",              render(Math.max(box.w, box.h), { pad: 0 })],
  // favicon — พื้นโปร่ง เบราว์เซอร์จัดการเอง
  ["favicon-16.png",        render(16,  { pad: 0.02 })],
  ["favicon-32.png",        render(32,  { pad: 0.02 })],
  // iOS: พื้นโปร่งจะถูกแทนด้วยสีดำ จึงต้องใส่พื้นทึบเสมอ
  ["apple-touch-icon.png",  render(180, { bg: BG, pad: 0.10 })],
  // PWA ปกติ
  ["icon-192.png",          render(192, { bg: BG, pad: 0.10 })],
  ["icon-512.png",          render(512, { bg: BG, pad: 0.10 })],
  // Android adaptive: ระบบครอปเป็นวงกลม/สี่เหลี่ยมมน ต้องเผื่อขอบ 20% ไม่งั้นโดนตัด
  ["icon-maskable-512.png", render(512, { bg: BG, pad: 0.22 })],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, buf] of files) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} KB`);
}
const icoBuf = ico(render(48, { pad: 0.02 }));
fs.writeFileSync(path.join(OUT, "favicon.ico"), icoBuf);
console.log(`  ${"favicon.ico".padEnd(24)} ${(icoBuf.length / 1024).toFixed(1)} KB`);
console.log(`\nต้นฉบับ ${img.width}×${img.height} · เนื้อหาจริง ${box.w}×${box.h} ที่ (${box.x},${box.y})`);
