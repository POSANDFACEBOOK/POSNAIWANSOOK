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

function optName(opts) { return (opts || []).map(o => o && o.name).filter(Boolean).join(", "); }

function buildLines(body) {
  const lines = [
    { t: "ใบสั่งอาหาร", size: 30, bold: true, align: "center" },
    { t: String(body.table || ""), size: 64, bold: true, align: "center" },
  ];
  if (body.time) lines.push({ t: String(body.time), size: 20, align: "center" });
  lines.push({ rule: true });
  (body.items || []).forEach(it => {
    lines.push({ t: `${it.qty}x ${it.name}`, size: 42, bold: true, align: "left" });
    const opt = optName(it.options);
    if (opt) lines.push({ t: "   + " + opt, size: 26, align: "left" });
    if (it.note) lines.push({ t: "   * " + it.note, size: 26, bold: true, align: "left" });
  });
  lines.push({ rule: true });
  return lines;
}

function render(createCanvas, lines, W) {
  const lineH = l => l.rule ? 20 : Math.round((l.size || 28) * 1.45) + 6;
  const pad = 16;
  let h = pad * 2; lines.forEach(l => { h += lineH(l); });
  const cv = createCanvas(W, h);
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, h);
  ctx.fillStyle = "#000"; ctx.textBaseline = "top";
  let y = pad;
  for (const l of lines) {
    if (l.rule) { ctx.fillRect(pad, y + 9, W - pad * 2, 2); y += lineH(l); continue; }
    ctx.font = `${l.bold ? "bold " : ""}${l.size || 28}px Sarabun, sans-serif`;
    const txt = l.t || ""; let x = pad;
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
  const tail = Buffer.from([0x0a, 0x0a, 0x0a, 0x1d, 0x56, 0x41, 0x00]);
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
