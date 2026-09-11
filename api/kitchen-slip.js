// Vercel Serverless Function — render a Thai kitchen slip to a 1-bit ESC/POS
// raster (GS v 0). Lets the print agent print perfect Thai (correct vowel/tone
// stacking via the Sarabun font) on printers whose firmware can't compose Thai
// from a code page. The agent POSTs {table, time, items:[{qty,name,options,note}]}
// and prints the returned bytes as-is. On any failure it returns 500 and the
// agent falls back to plain ESC/POS text.

const FONT_URL = "https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/sarabun/Sarabun-Regular.ttf";
let fontReg = null; // null = untried, true = registered, false = failed

async function ensureFont(GlobalFonts) {
  if (fontReg === true) return;
  if (fontReg === false) throw new Error("font unavailable");
  const r = await fetch(FONT_URL);
  if (!r.ok) { fontReg = false; throw new Error("font http " + r.status); }
  GlobalFonts.register(Buffer.from(await r.arrayBuffer()), "Sarabun");
  fontReg = true;
}

function buildLines(body) {
  // ป้ายบอกชนิดใบ — ครัวต้องแยกออกทันทีว่าใบนี้ไม่ใช่ออเดอร์ใหม่
  // พิมพ์ซ้ำแล้วครัวทำอีกจาน = ของทิ้งเปล่า · ย้ายโต๊ะแล้วเสิร์ฟที่เดิม = ลูกค้าไม่ได้กิน
  // ห้ามใช้อีโมจิในข้อความที่พิมพ์ — ฟอนต์ Sarabun ไม่มีตัวนั้น จะออกมาเป็นกล่องสี่เหลี่ยม
  const kind = String(body.kind || "");
  const time = body.time ? { t: String(body.time), size: 20, align: "center" } : null;
  // เลขบิลคือตัวอ้างอิงเดียวที่ตามกลับไปหาบิลในระบบได้ — ครัวถือกระดาษมาถามได้ตรงใบ
  // ผู้สั่งไว้ตรวจย้อนหลังตอนมีปัญหาว่าใครเป็นคนรับออเดอร์ หรือลูกค้าสแกนสั่งเอง
  const foot = [body.bill ? `บิล #${body.bill}` : "", body.by ? (String(body.by) === "customer" ? "ลูกค้าสแกนสั่งเอง" : String(body.by)) : ""].filter(Boolean).join("  ·  ");
  // ใบย้ายโต๊ะ: บอกแค่ "จากโต๊ะไหน ไปโต๊ะไหน" ใบเดียว ไม่มีรายการอาหาร (ครัวไม่ต้องทำอะไรใหม่)
  if (kind === "move") {
    const lines = [
      { box: "ย้ายโต๊ะ", size: 52 },
      { t: "จากโต๊ะ", size: 26, align: "center" },
      { t: String(body.from || "-"), size: 76, bold: true, align: "center" },
      { t: "ย้ายไปโต๊ะ", size: 26, align: "center" },
      { t: String(body.table || "-"), size: 76, bold: true, align: "center" },
      { t: "ไม่ต้องทำอาหารใหม่ - เสิร์ฟที่โต๊ะใหม่", size: 24, bold: true, align: "center" },
    ];
    if (time) lines.push(time);
    if (foot) lines.push({ t: foot, size: 20, align: "center" });
    return lines;
  }
  const mark = kind === "reprint" ? "พิมพ์ซ้ำ - ไม่ใช่ออเดอร์ใหม่" : kind === "void" ? "ยกเลิกแล้ว - ไม่ต้องทำ" : "";
  const lines = [
    // ใบยกเลิก: หัวเป็นกล่องดำทึบตัวขาว "ยกเลิก" — ครัวต้องไม่มีทางอ่านเป็นออเดอร์ใหม่
    kind === "void" ? { box: "ยกเลิก", size: 60 } : { t: "ใบสั่งอาหาร", size: 28, bold: true, align: "center" },
    { t: String(body.table || ""), size: 76, bold: true, align: "center" },   // เบอร์โต๊ะตัวใหญ่มาก ครัวเห็นชัด
  ];
  if (mark) lines.push({ t: mark, size: 26, bold: true, align: "center" });
  if (time) lines.push(time);
  if (foot) lines.push({ t: foot, size: 20, align: "center" });
  lines.push({ rule: true });
  (body.items || []).forEach(it => {
    lines.push({ c1: String(it.qty), c2: String(it.name || ""), size: 46, bold: true, mb: 3 });   // จำนวน+ชื่อเมนูตัวใหญ่
    // ตัวเลือกที่เลือกซ้ำ (เตาหมูกระทะ 2 เตา) รวมเป็นบรรทัดเดียว "×2" — ครัวนับผิดง่ายถ้าเห็นชื่อเดิมซ้ำสองบรรทัด
    { const m = new Map(); (it.options || []).forEach(o => { const n = o && o.name; if (n) m.set(n, (m.get(n) || 0) + 1); });
      for (const [n, k] of m) lines.push({ t: "- " + n + (k > 1 ? " ×" + k : ""), size: 30, indent: true }); }  // ตัวเลือกแสดงทีละบรรทัด
    if (it.note) lines.push({ t: "* " + it.note, size: 30, bold: true, indent: true });
  });
  return lines;
}

// เรนเดอร์เป็นรูปภาพ 1-bit แล้วแปลงเป็น ESC/POS raster (GS v 0)
// รองรับ: {box} กล่องดำทึบตัวขาวเต็มความกว้าง · {rule} เส้นคั่น · {t,size,bold,align,indent} ข้อความ · {c1,c2,size,bold} สองคอลัมน์ (จำนวน|ชื่อเมนู)
// ชิดขอบบน/ล่างให้มากสุด (pad น้อย) ประหยัดกระดาษ · ตัดบรรทัดชื่อยาวโดยไม่แยกสระ/วรรณยุกต์ไทย
function render(createCanvas, lines, W) {
  const pad = 8, QCOL = 96, RPAD = 8;
  const meas = createCanvas(8, 8).getContext("2d");
  const PRE = /[เแโใไ]/;        // สระหน้า — ต้องอยู่กับพยัญชนะที่ตามมา (ห้ามค้างท้ายบรรทัด)
  const COMB = /[ัำิ-ฺ็-๎]/;    // สระบน/ล่าง/ำ + วรรณยุกต์ — อยู่กับพยัญชนะที่นำหน้า
  const clusters = s => { const out = []; let pre = ""; for (const ch of s) { if (PRE.test(ch)) { pre += ch; continue; } if (out.length && !pre && COMB.test(ch)) { out[out.length - 1] += ch; continue; } out.push(pre + ch); pre = ""; } if (pre) out.push(pre); return out; };
  function wrap(text, size, bold, maxW) {
    meas.font = `${bold ? "bold " : ""}${size}px Sarabun, sans-serif`;
    const s = String(text); if (meas.measureText(s).width <= maxW) return [s];
    const out = []; let cur = "";
    for (const c of clusters(s)) { if (meas.measureText(cur + c).width <= maxW || cur === "") cur += c; else { out.push(cur); cur = c; } }
    if (cur) out.push(cur); return out.length ? out : [s];
  }
  const nameMaxW = W - pad - QCOL - RPAD, fullMaxW = W - pad * 2;
  const rows = [];   // ขยายบรรทัดที่ยาวเกินเป็นหลายบรรทัด
  for (const l of lines) {
    if (l.rule || l.box) { rows.push(l); continue; }
    if (l.c1 != null || l.c2 != null) {
      const nl = l.c2 != null ? wrap(l.c2, l.size, l.bold, nameMaxW) : [""];
      nl.forEach((t, i) => rows.push({ c1: i === 0 ? l.c1 : "", c2: t, size: l.size, bold: l.bold, mb: i === nl.length - 1 ? (l.mb || 0) : 0 }));
      continue;
    }
    if (l.align === "center") { rows.push(l); continue; }   // หัว/กึ่งกลาง: สั้น ไม่ต้อง wrap
    const tl = wrap(l.t || "", l.size, l.bold, l.indent ? nameMaxW : fullMaxW);
    tl.forEach((t, i) => rows.push({ t, size: l.size, bold: l.bold, indent: l.indent, mb: i === tl.length - 1 ? (l.mb || 0) : 0 }));
  }
  const lineH = l => l.rule ? 12 : l.box ? Math.round(l.size * 1.3) + 18 : Math.round((l.size || 28) * 1.3) + (l.mb != null ? l.mb : 3);
  let h = pad * 2; rows.forEach(l => { h += lineH(l); });
  const cv = createCanvas(W, h);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = "#000"; ctx.textBaseline = "top";
  let y = pad;
  for (const l of rows) {
    if (l.rule) { ctx.fillRect(pad, y + 5, W - pad * 2, 2); y += lineH(l); continue; }
    if (l.box) {   // กล่องดำทึบ ตัวอักษรขาวกลางกล่อง (สีขาว = ไม่พิมพ์ = เนื้อกระดาษ)
      const bh = lineH(l) - 8;
      ctx.fillRect(pad, y, W - pad * 2, bh);
      ctx.font = `bold ${l.size}px Sarabun, sans-serif`;
      ctx.fillStyle = "#fff";
      const bw = ctx.measureText(l.box).width;
      ctx.fillText(l.box, Math.max(pad, Math.round((W - bw) / 2)), y + Math.round((bh - l.size * 1.3) / 2) + 2);
      ctx.fillStyle = "#000";
      y += lineH(l); continue;
    }
    ctx.font = `${l.bold ? "bold " : ""}${l.size || 28}px Sarabun, sans-serif`;
    if (l.c1 != null || l.c2 != null) {
      if (l.c1) ctx.fillText(String(l.c1), pad, y);
      if (l.c2) ctx.fillText(String(l.c2), pad + QCOL, y);
      y += lineH(l); continue;
    }
    const txt = l.t || ""; let x = l.indent ? pad + QCOL : pad;
    if (l.align === "center") { const w = ctx.measureText(txt).width; x = Math.max(pad, Math.round((W - w) / 2)); }
    ctx.fillText(txt, x, y);
    y += lineH(l);
  }
  const img = ctx.getImageData(0, 0, W, h).data;
  const bpr = Math.ceil(W / 8);
  const ras = Buffer.alloc(bpr * h);
  for (let yy = 0; yy < h; yy++) for (let xx = 0; xx < W; xx++) {
    const i = (yy * W + xx) * 4;
    const lum = img[i] * 0.299 + img[i + 1] * 0.587 + img[i + 2] * 0.114;
    if (img[i + 3] > 40 && lum < 128) ras[yy * bpr + (xx >> 3)] |= (0x80 >> (xx & 7));
  }
  const head = Buffer.from([0x1b, 0x40, 0x1b, 0x61, 0x00, 0x1d, 0x76, 0x30, 0x00, bpr & 0xff, (bpr >> 8) & 0xff, h & 0xff, (h >> 8) & 0xff]);
  const tail = Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x41, 0x00]);   // feed ~3 บรรทัดให้พ้นใบมีดก่อนตัด (น้อยกว่านี้ใบมีดจะตัดโดนตัวอักษร)
  return Buffer.concat([head, ras, tail]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  try {
    const { createCanvas, GlobalFonts } = await import("@napi-rs/canvas");
    await ensureFont(GlobalFonts);
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const width = Math.max(256, Math.min(832, +body.width || 576));   // 576=80mm, 384=58mm
    const out = render(createCanvas, buildLines(body), width);
    res.setHeader("Content-Type", "application/octet-stream");
    return res.status(200).send(out);
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
