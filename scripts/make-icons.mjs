// ═══════════════════════════════════════════════════════════════════════════
// สร้างชุดไอคอนทั้งหมด — รันซ้ำได้ ผลลัพธ์เหมือนเดิมทุกครั้ง
//   node scripts/make-icons.mjs
//
// ⚠️ การตัดสินใจของเจ้าของ (6 ส.ค. 69): "ไอคอนแอปไม่ใช้โลโก้ร้าน" — โลโก้ลายเส้น
// ในวันสุขใช้เฉพาะในแอป (หน้าล็อกอิน/แถบเมนู) ส่วนไอคอนติดตั้งทุกแพลตฟอร์มเป็น
// สัญลักษณ์วาดใหม่: "ชาม + กราฟขั้นบันได + เหรียญ" บนพื้นส้มไล่เฉด (เลือกจาก 22 แบบ)
// เหตุผล: ลายเส้นโลโก้เบลอที่ขนาดเล็ก และต้องการสีเฉพาะที่มองปุ๊บรู้ว่าระบบอาหาร
// ห้ามเรียงแท่งกราฟแบบ "กลางสูงสุดสมมาตร" — ดูเป็นการชูนิ้วกลาง ให้เรียงขั้นบันไดเสมอ
//
// กฎต่อแพลตฟอร์มที่ห้ามลืม: iOS ห้ามพื้นโปร่ง (จะถูกถมดำ) และ iOS ครอปมุมเอง —
// ส่งเต็มจัตุรัสทึบ · Android maskable ครอปวงกลม ต้องย่อสัญลักษณ์เหลือ ~66% ·
// favicon/PWA "any" ใส่มุมมนโปร่งได้ ดูเป็นแอปบนทาสก์บาร์
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

// ── ไอคอนแอป: ชาม + กราฟขั้นบันได + เหรียญ (วาดเป็นเวกเตอร์ คมทุกขนาด) ──────
// rounded  = รัศมีมุมมนเป็นสัดส่วนของด้าน (0 = เต็มจัตุรัส สำหรับ iOS/maskable)
// glyphK   = สัดส่วนขนาดสัญลักษณ์ (maskable ต้องย่อเหลือ ~0.66 กัน Android ครอปวงกลมแหว่ง)
function drawAppIcon(size, { rounded = 0, glyphK = 0.86 } = {}) {
  const c = createCanvas(size, size);
  const x = c.getContext("2d");
  x.imageSmoothingEnabled = true; x.imageSmoothingQuality = "high";
  const rr = (bx, by, w, h, r) => { x.beginPath(); x.roundRect(bx, by, w, h, r); };
  if (rounded > 0) { rr(0, 0, size, size, size * rounded); x.clip(); }
  // พื้นส้มไล่เฉด — สีประจำระบบอาหาร (จงใจไม่ใช้เขียว กันสับสนกับระบบบัญชี SlipTrack)
  const g = x.createLinearGradient(0, 0, 0, size);
  g.addColorStop(0, "#FF8A3D"); g.addColorStop(1, "#F0560A");
  x.fillStyle = g; x.fillRect(0, 0, size, size);

  const s = size * glyphK, cx = size / 2, cy = size * 0.52;
  // แท่งกราฟ "ขั้นบันได" เตี้ย→สูง — ห้ามกลับไปแบบกลางสูงสุด (ดูเป็นการชูนิ้วกลาง)
  x.fillStyle = "#FFFFFF";
  const bars = [[-0.17, 0.26], [0, 0.36], [0.17, 0.48]];
  for (const [dx, h] of bars) { rr(cx + dx * s - s * .055, cy + s * .06 - h * s, s * .11, h * s, s * .04); x.fill(); }
  // เหรียญทองบนยอดแท่งสูงสุด — ใบ้ความเป็น "ต้นทุน/มูลค่า"
  x.fillStyle = "#FFD08A";
  x.beginPath(); x.arc(cx + 0.17 * s, cy + s * .06 - 0.48 * s - s * .075, s * .062, 0, Math.PI * 2); x.fill();
  // ชามทับโคนแท่ง + ฐานชาม
  x.fillStyle = "#FFFFFF";
  x.beginPath(); x.arc(cx, cy + s * .08, s * .34, 0, Math.PI); x.closePath(); x.fill();
  rr(cx - s * .11, cy + s * .40, s * .22, s * .08, s * .04); x.fill();
  return c.toBuffer("image/png");
}

const files = [
  // โลโก้ร้าน — ใช้ "ในแอป" เท่านั้น (ผู้ใช้สั่ง 6 ส.ค. 69: ไอคอนไม่เอาโลโก้ร้าน)
  // ขนาดเนื้อหาจริง ไม่ขยายเกินต้นฉบับ: ขยายไม่ได้เพิ่มรายละเอียด มีแต่ไฟล์บวม
  ["logo.png",              render(Math.max(box.w, box.h), { pad: 0 })],
  // favicon + PWA "any" — มุมมนโปร่ง ดูเป็นแอปบนแท็บ/ทาสก์บาร์ (เบราว์เซอร์ไม่ครอปให้)
  ["favicon-16.png",        drawAppIcon(16,  { rounded: 0.22 })],
  ["favicon-32.png",        drawAppIcon(32,  { rounded: 0.22 })],
  ["icon-192.png",          drawAppIcon(192, { rounded: 0.22 })],
  ["icon-512.png",          drawAppIcon(512, { rounded: 0.22 })],
  // iOS: ต้องเต็มจัตุรัสทึบ — พื้นโปร่งถูกถมดำ และ iOS ครอปมุมเองอยู่แล้ว
  ["apple-touch-icon.png",  drawAppIcon(180, { rounded: 0 })],
  // Android adaptive: ระบบครอปวงกลม/มน — พื้นเต็มขอบ สัญลักษณ์ย่ออยู่ในเขตปลอดภัย
  ["icon-maskable-512.png", drawAppIcon(512, { rounded: 0, glyphK: 0.62 })],
];

fs.mkdirSync(OUT, { recursive: true });
for (const [name, buf] of files) {
  fs.writeFileSync(path.join(OUT, name), buf);
  console.log(`  ${name.padEnd(24)} ${(buf.length / 1024).toFixed(1)} KB`);
}
const icoBuf = ico(drawAppIcon(48, { rounded: 0.22 }));
fs.writeFileSync(path.join(OUT, "favicon.ico"), icoBuf);
console.log(`  ${"favicon.ico".padEnd(24)} ${(icoBuf.length / 1024).toFixed(1)} KB`);
console.log(`\nโลโก้ร้าน (ในแอป) ${img.width}×${img.height} · เนื้อหาจริง ${box.w}×${box.h} ที่ (${box.x},${box.y})`);
