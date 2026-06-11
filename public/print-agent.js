#!/usr/bin/env node
/* ════════════════════════════════════════════════════════════════════════
 * FOODCOST — ตัวพิมพ์ผ่านคลาวด์ (Cloud Print Agent)
 *
 * รันบน Termux (Android) หรือเครื่องที่มี Node.js ใดๆ ที่อยู่วง LAN เดียวกับ
 * เครื่องพิมพ์ — ดึงออเดอร์จาก Supabase แล้วส่ง ESC/POS เข้าเครื่องพิมพ์ IP
 * ตรงๆ ผ่าน raw TCP (ไม่ผ่านเบราว์เซอร์ → ไม่มีปัญหา mixed content เลย)
 *
 * วิธีใช้:   node print-agent.js <branchId>
 * ตัวอย่าง:  node print-agent.js 6
 * ════════════════════════════════════════════════════════════════════════ */
const net = require("net");
const fs = require("fs");
const path = require("path");
const os = require("os");

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const AGENT_VERSION = 22;   // ⬆️ เลขเวอร์ชัน — เพิ่มทุกครั้งที่แก้ไฟล์นี้ (ใช้เช็คอัปเดตอัตโนมัติ)
const AGENT_URL = "https://foodcost-eta.vercel.app/print-agent.js";
const BRANCH = process.argv[2];
const POLL_MS = 5000;
const STATE_FILE = path.join(process.env.HOME || ".", ".foodcost-printed.json");

if (!BRANCH) { console.error("❌ ต้องใส่ branch id ด้วย เช่น:  node print-agent.js 6"); process.exit(1); }

// กันรัน agent ซ้อนกันหลายตัว (เคยทำให้พิมพ์ออกซ้ำ 2 ใบ) — จองพอร์ต local เป็นตัวล็อก · ถ้ามีตัวอื่นจองอยู่แล้วให้ปิด instance ซ้ำนี้
const _lock = net.createServer();
_lock.on("error", () => { console.log("⛔ มี Print Agent ทำงานอยู่แล้ว — ปิด instance ซ้ำนี้ (กันพิมพ์ซ้ำ)"); process.exit(3); });
_lock.listen(48191, "127.0.0.1");

// ── Supabase REST ────────────────────────────────────────────────────────
async function sb(query) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${query}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) throw new Error(await res.text());
  const txt = await res.text();
  return txt ? JSON.parse(txt) : [];
}
// เช็คเวอร์ชันใหม่จากเซิร์ฟเวอร์ทุก 20 นาที — ถ้ามีใหม่กว่า → ออก (ตัว launcher จะโหลดใหม่+รันใหม่เอง)
async function checkUpdate() {
  try {
    const txt = await (await fetch(`${AGENT_URL}?_=${Date.now()}`)).text();
    const m = txt.match(/AGENT_VERSION\s*=\s*(\d+)/);
    if (m && +m[1] > AGENT_VERSION) { console.log(`⬆️  พบเวอร์ชันใหม่ (v${m[1]}) — อัปเดต+รีสตาร์ทอัตโนมัติ...`); process.exit(0); }
  } catch {}
}
const getActiveOrders = () => sb(`orders?status=neq.paid&status=neq.cancelled&order=created_at.desc&branch_id=eq.${BRANCH}`);
const getPrinters = () => sb(`printers?order=id.asc`);
const addPrinter = (d) => fetch(`${SUPA_URL}/rest/v1/printers`, { method: "POST", headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(d) });
const patchPrinter = (id, d) => fetch(`${SUPA_URL}/rest/v1/printers?id=eq.${id}`, { method: "PATCH", headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(d) });

// ── ค้นหาเครื่องพิมพ์อัตโนมัติในวงเครือข่าย (เหมือนสแกน WiFi) ──────────────
function localSubnet() {
  const ifs = os.networkInterfaces();
  for (const name in ifs) for (const i of ifs[name]) {
    if (i.family === "IPv4" && !i.internal) { const p = i.address.split("."); if (p.length === 4) return p.slice(0, 3).join("."); }
  }
  return null;
}
function probePort(ip, port, timeout) {
  return new Promise(resolve => {
    const s = net.createConnection({ host: ip, port }); let done = false;
    const fin = open => { if (!done) { done = true; try { s.destroy(); } catch {} resolve(open); } };
    s.setTimeout(timeout);
    s.on("connect", () => fin(true)); s.on("timeout", () => fin(false)); s.on("error", () => fin(false));
  });
}
let scanning = false;   // กันการสแกนซ้อนกัน (ถ้ารอบก่อนยังไม่เสร็จ ข้ามรอบใหม่ไปก่อน)
async function discoverPrinters(existing) {
  if (scanning) { console.log("⏭️  ข้ามการสแกน (รอบก่อนยังทำงานอยู่)"); return; }
  scanning = true;
  try {
    const sub = localSubnet();
    if (!sub) { console.log("⚠️  หา subnet ไม่ได้ — ข้ามการค้นหาอัตโนมัติ"); return; }
    console.log(`🔍 ค้นหาเครื่องพิมพ์ในเครือข่าย ${sub}.x (port 9100)...`);
    const have = new Set((existing || []).map(p => p.ip).filter(Boolean));
    const ips = []; for (let i = 1; i <= 254; i++) ips.push(`${sub}.${i}`);
    const found = [];
    for (let i = 0; i < ips.length; i += 40) {
      const r = await Promise.all(ips.slice(i, i + 40).map(ip => probePort(ip, 9100, 1500).then(o => o ? ip : null)));
      r.forEach(ip => { if (ip) found.push(ip); });
    }
    console.log(`🔍 พบอุปกรณ์เปิด port 9100: ${found.length ? found.join(", ") : "(ไม่พบ)"}`);
    for (const ip of found) {
      if (have.has(ip)) continue;
      have.add(ip);   // กันเพิ่มซ้ำภายในรอบเดียวกัน
      // เพิ่มเป็น "รอเพิ่ม" (active:false) — ยังไม่พิมพ์งาน จนกว่าผู้ใช้จะกด "เพิ่มใช้งาน" ในแอป
      try { await addPrinter({ name: `เครื่องพิมพ์ ${ip}`, ip, port: 9100, type: "kitchen", branch_id: +BRANCH, active: false, description: JSON.stringify({ d: 1 }) }); console.log(`  🔍 พบเครื่องพิมพ์ใหม่: ${ip} → ไปกด "เพิ่มใช้งาน" ในแอปถ้าต้องการใช้`); }
      catch (e) { console.log(`  ⚠️ บันทึก ${ip} ไม่สำเร็จ: ${e.message}`); }
    }
  } finally { scanning = false; }
}

// ── ESC/POS (พอร์ตมาจากแอป buildKitchenESC) ──────────────────────────────
// แปลงข้อความเป็น TIS-620 (CP874) สำหรับเครื่องพิมพ์ไทย — Unicode ไทย U+0E01..U+0E5B → ไบต์ 0xA1..0xFB
// (ส่ง UTF-8 ตรงๆ เครื่องจะอ่านเป็นภาษาจีนมั่ว — ต้องส่งเป็น TIS-620 + เลือก code page ไทยด้วย ESC t)
function thaiBytes(s) {
  const out = [];
  for (const ch of String(s)) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) out.push(cp);                                       // ASCII
    else if (cp >= 0x0e01 && cp <= 0x0e5b) out.push(cp - 0x0e00 + 0xa0); // ไทย → TIS-620
    else out.push(0x3f);                                              // อื่นๆ → '?'
  }
  return Buffer.from(out);
}
const THAI_CP = 27;                              // เลขโค้ดเพจไทยของ Xprinter C300H (ยืนยันจากการทดสอบจริง — รุ่นนี้ใช้ 27 ไม่ใช่ 21)
const SET_THAI = [0x1c, 0x2e, 0x1b, 0x74, THAI_CP];   // FS . (ยกเลิกโหมดตัวอักษรจีน 2 ไบต์) + ESC t = เลือกโค้ดเพจไทย (TIS-620/CP874)
function optionsText(opts) { return (opts || []).map(o => o && o.name).filter(Boolean).join(", "); }
function isBluetooth(p) { try { return JSON.parse(p.description || "{}").c === "bt"; } catch { return false; } }
function resolvePrinter(item, printers) {
  if (!printers || !printers.length) return null;
  if (item.printer_id) { const p = printers.find(x => x.id === +item.printer_id); if (p) return p; }
  if (item.category) { const c = String(item.category).trim(); const byCat = printers.find(p => Array.isArray(p.categories) && p.categories.some(x => String(x).trim() === c)); if (byCat) return byCat; }
  return printers.find(p => p.categories === null || p.categories === undefined) || null;
}
function buildKitchenESC(item, tableNum) {
  const bufs = []; const b = (...x) => bufs.push(Buffer.from(x)); const t = s => bufs.push(thaiBytes(s));
  b(0x1b, 0x40); b(...SET_THAI); b(0x1b, 0x61, 0x01);
  b(0x1d, 0x21, 0x00); b(0x1b, 0x45, 0x01); t("ใบสั่งอาหาร\n"); b(0x1b, 0x45, 0x00);
  b(0x1d, 0x21, 0x11); b(0x1b, 0x45, 0x01); t(`${tableNum}\n`); b(0x1b, 0x45, 0x00);   // เลขโต๊ะตัวใหญ่ (ไม่มีคำว่า "โต๊ะ")
  b(0x1d, 0x21, 0x00); t(new Date().toLocaleString("th-TH") + "\n");
  t("--------------------------------\n");
  b(0x1b, 0x61, 0x00);   // ชิดซ้าย
  // ชื่อเมนู: ขนาดปกติ + ตัวหนา → สระ/วรรณยุกต์ไทยเรียงถูกตำแหน่ง (ตัวใหญ่พิเศษทำให้เพี้ยน)
  b(0x1b, 0x45, 0x01); t(`${item.qty}x ${item.name}\n`); b(0x1b, 0x45, 0x00);
  if (item.options && item.options.length) t(`   + ${optionsText(item.options)}\n`);
  if (item.note) { b(0x1b, 0x45, 0x01); t(`   * ${item.note}\n`); b(0x1b, 0x45, 0x00); }
  t("--------------------------------\n"); b(0x1b, 0x64, 0x05); b(0x1d, 0x56, 0x41, 0x00);
  return Buffer.concat(bufs);
}
function testPageESC() {
  const bufs = []; const b = (...x) => bufs.push(Buffer.from(x)); const t = s => bufs.push(thaiBytes(s));
  b(0x1b, 0x40); b(...SET_THAI); b(0x1b, 0x61, 0x01);
  b(0x1b, 0x45, 0x01); t("ทดสอบพิมพ์\n"); b(0x1b, 0x45, 0x00);
  t(`PRINT AGENT v${AGENT_VERSION}\n`);
  t("ภาษาไทยใช้งานได้แล้ว\n");
  t("ชาบูจัมโบ้ กุ้งเผา ผัดไทย\n");   // คำที่มีสระ/วรรณยุกต์ — ดูว่าเรียงบนล่างถูกไหม
  t(new Date().toLocaleString("th-TH") + "\n");
  b(0x1b, 0x64, 0x03); b(0x1d, 0x56, 0x41, 0x00);
  return Buffer.concat(bufs);
}
// QR โต๊ะลูกค้า — ESC/POS GS ( k (พอร์ตจาก buildTableQRESC ในแอป)
function buildQRESC(qr) {
  const bufs = []; const b = (...x) => bufs.push(Buffer.from(x)); const t = s => bufs.push(thaiBytes(s));
  b(0x1b, 0x40); b(...SET_THAI); b(0x1b, 0x61, 0x01);
  if (qr.branch) { b(0x1d, 0x21, 0x00); t(qr.branch + "\n"); }
  b(0x1d, 0x21, 0x11); t("โต๊ะ " + (qr.table || "") + "\n"); b(0x1d, 0x21, 0x00);
  if (qr.label) t(qr.label + "\n");
  t("\n");
  const data = Buffer.from(qr.url || "", "utf8");
  b(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);       // model 2
  b(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x06);            // module size 6
  b(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);            // error correction M
  const sl = data.length + 3;
  b(0x1d, 0x28, 0x6b, sl & 0xff, (sl >> 8) & 0xff, 0x31, 0x50, 0x30); // store data
  bufs.push(data);
  b(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);            // print
  t("\n"); t("สแกนเพื่อดูเมนูและสั่งอาหาร\n"); t("Scan to order\n");
  b(0x1b, 0x64, 0x04); b(0x1d, 0x56, 0x41, 0x00);
  return Buffer.concat(bufs);
}
function sendToPrinter(ip, port, buf) {
  return new Promise((resolve, reject) => {
    const s = net.createConnection({ host: ip, port: +port || 9100 });
    let done = false;
    s.setTimeout(8000);
    s.on("connect", () => s.write(buf, () => s.end()));
    s.on("close", () => { if (!done) { done = true; resolve(); } });
    s.on("timeout", () => { if (!done) { done = true; s.destroy(); reject(new Error("หมดเวลา (เครื่องไม่ตอบ)")); } });
    s.on("error", e => { if (!done) { done = true; reject(e); } });
  });
}

// ── สถานะ: ออเดอร์/รายการที่พิมพ์ไปแล้ว (กันพิมพ์ซ้ำ) ──────────────────────
let state = { sig: {}, init: {}, greeted: {} };
try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
if (!state.sig) state.sig = {}; if (!state.init) state.init = {}; if (!state.greeted) state.greeted = {}; if (!state.tested) state.tested = {}; if (!state.reprinted) state.reprinted = {}; if (!state.qrPrinted) state.qrPrinted = {}; if (!state.printed) state.printed = {}; if (!state.pinged) state.pinged = {};
let primed = fs.existsSync(STATE_FILE);   // มีไฟล์อยู่แล้ว = ไม่ต้อง prime ใหม่
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }
const sigOf = o => JSON.stringify((o.items || []).map(i => [i.menu_id, i.qty, i.note || "", optionsText(i.options)]));
function newItemsVs(oldSig, items) {
  try {
    const m = new Map(JSON.parse(oldSig).map(([mid, q, n]) => [`${mid}|${n}`, q]));
    return items.filter(i => { const k = `${i.menu_id}|${i.note || ""}`; return !m.has(k) || m.get(k) < i.qty; })
      .map(i => { const k = `${i.menu_id}|${i.note || ""}`; return { ...i, qty: i.qty - (m.get(k) || 0) }; });
  } catch { return items; }
}

// เรนเดอร์ใบครัวเป็นรูปภาพ (ไทยคมชัด) ผ่านบริการบน Vercel — ถ้าล้มเหลวคืน null แล้วถอยไปใช้ตัวอักษร ESC/POS
const SLIP_RENDER_URL = "https://foodcost-eta.vercel.app/api/kitchen-slip";
async function fetchSlipRaster(items, tableNum) {
  try {
    const res = await fetch(SLIP_RENDER_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: String(tableNum || ""), time: new Date().toLocaleString("th-TH"), items: (items || []).map(it => ({ qty: it.qty, name: it.name, options: it.options || [], note: it.note || "" })) }),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 30 ? buf : null;
  } catch (e) { return null; }
}
// รวมรายการเป็นบัฟเฟอร์พิมพ์ — หนึ่งใบต่อหนึ่งรายการเมนู (ลองรูปภาพไทยคมชัดก่อน · ถ้าล้มเหลวถอยไปตัวอักษร ESC/POS เป็นรายตัว → พิมพ์ไม่มีวันพัง)
async function itemsToBuffer(items, tableNum) {
  const parts = []; let raster = 0, text = 0;
  for (const it of items) {
    let b = await fetchSlipRaster([it], tableNum);
    if (b) raster++; else { b = buildKitchenESC(it, tableNum); text++; }
    parts.push(b);
  }
  const mode = text === 0 ? "รูปภาพ" : (raster === 0 ? "ตัวอักษร(สำรอง)" : "ผสม รูปภาพ+ตัวอักษร");
  return { buf: Buffer.concat(parts), mode };
}
// เครื่องนี้ต้องพิมพ์รายการนี้ไหม — ตาม "กำหนดการพิมพ์" เป๊ะๆ: ปักหมุดเมนู(printer_id)→เฉพาะเครื่องนั้น · ไม่งั้น categories=null(พิมพ์ทุกหมวด) หรือมีหมวดนั้นในลิสต์
function printerHandles(p, it) {
  if (it.printer_id != null && it.printer_id !== "") return +p.id === +it.printer_id;
  if (p.categories === null || p.categories === undefined) return true;
  if (!Array.isArray(p.categories) || it.category == null) return false;
  const c = String(it.category).trim();
  return p.categories.some(x => String(x).trim() === c);
}
async function printItems(items, tableNum, printers) {
  // ส่งรายการไป "ทุกเครื่องที่ตั้งค่าให้รับ" (ไม่ใช่เครื่องเดียว) — ตั้งทุกเครื่องพิมพ์ทุกหมวด = ออกทุกเครื่อง · ตั้งคนละหมวด = แยกกัน · ตรงตามที่ตั้งใน "กำหนดการพิมพ์"
  const usable = (printers || []).filter(p => !isBluetooth(p) && p.ip);
  for (const p of usable) {
    const mine = items.filter(it => printerHandles(p, it));
    if (!mine.length) continue;
    const { buf, mode } = await itemsToBuffer(mine, tableNum);
    try { await sendToPrinter(p.ip, p.port, buf); console.log(`  ✅ พิมพ์ ${mine.length} รายการ [${mode}] → ${p.name} (${p.ip})`); }
    catch (e) { console.log(`  ❌ ไม่สำเร็จ → ${p.name} (${p.ip}): ${e.message}`); }
  }
  const orphan = items.filter(it => !usable.some(p => printerHandles(p, it)));
  if (orphan.length) console.log("  ⚠️  ไม่มีเครื่องพิมพ์สำหรับ (ยังไม่ได้กำหนดหมวด):", orphan.map(i => i.name).join(", "));
}

// ทดสอบพิมพ์ตามคำสั่งจากแอป: แอปเขียน description.tp = เวลาที่กด → agent พิมพ์หน้าทดสอบให้เครื่องนั้นภายใน ~5 วินาที
function tpOf(p) { try { return +(JSON.parse(p.description || "{}").tp) || 0; } catch { return 0; } }
async function handleTestRequests(printers) {
  for (const p of printers) {
    if (isBluetooth(p) || !p.ip) continue;
    const tp = tpOf(p);
    if (tp && String(state.tested[p.id]) !== String(tp)) {
      state.tested[p.id] = tp; saveState();   // มาร์คก่อนส่ง กันรอบ tick ซ้อนยิงซ้ำ (กดใหม่ = tp ใหม่ = ลองใหม่)
      try { await sendToPrinter(p.ip, p.port, testPageESC()); console.log(`  🧾 ทดสอบพิมพ์ (สั่งจากแอป) → ${p.name} (${p.ip}) — ดูว่ามีกระดาษออกไหม`); }
      catch (e) { console.log(`  ❌ ทดสอบพิมพ์ → ${p.name} (${p.ip}): ${e.message}`); }
    }
  }
}

// พิมพ์ซ้ำตามคำสั่งจากแอป: แอปเขียน description.rp = {at, items, table} บนเครื่องที่ต้องพิมพ์ → agent พิมพ์ใบครัวซ้ำให้
function rpOf(p) { try { const r = JSON.parse(p.description || "{}").rp; return (r && r.at) ? r : null; } catch { return null; } }
async function handleReprintRequests(printers) {
  for (const p of printers) {
    if (isBluetooth(p) || !p.ip) continue;
    const rp = rpOf(p);
    if (rp && String(state.reprinted[p.id]) !== String(rp.at)) {
      state.reprinted[p.id] = rp.at; saveState();   // มาร์คก่อนส่ง กันยิงซ้ำจาก tick ซ้อน
      const its = Array.isArray(rp.items) ? rp.items : [];
      if (!its.length) continue;
      const { buf, mode } = await itemsToBuffer(its, rp.table || "-");   // พิมพ์ซ้ำเป็นรูปภาพไทยคมชัด (ถอยไปตัวอักษรถ้าล้มเหลว)
      try { await sendToPrinter(p.ip, p.port, buf); console.log(`  🔁 พิมพ์ซ้ำ ${its.length} รายการ [${mode}] → ${p.name} (${p.ip})`); }
      catch (e) { console.log(`  ❌ พิมพ์ซ้ำ → ${p.name} (${p.ip}): ${e.message}`); }
    }
  }
}

// พิมพ์ QR โต๊ะตามคำสั่งจากแอป: แอปเขียน description.qr = {at, url, table, branch, label}
function qrOf(p) { try { const q = JSON.parse(p.description || "{}").qr; return (q && q.at) ? q : null; } catch { return null; } }
async function handleQRRequests(printers) {
  for (const p of printers) {
    if (isBluetooth(p) || !p.ip) continue;
    const q = qrOf(p);
    if (q && String(state.qrPrinted[p.id]) !== String(q.at)) {
      state.qrPrinted[p.id] = q.at; saveState();   // มาร์คก่อนส่ง กันยิงซ้ำ
      try { await sendToPrinter(p.ip, p.port, buildQRESC(q)); console.log(`  🔳 พิมพ์ QR โต๊ะ ${q.table} → ${p.name} (${p.ip})`); }
      catch (e) { console.log(`  ❌ พิมพ์ QR → ${p.name} (${p.ip}): ${e.message}`); }
    }
  }
}

// พิมพ์รูปภาพ (raster ESC/POS ที่แอปเรนเดอร์ไทยคมชัดมาให้แล้ว) ตามคำสั่ง: description.pj = {at, b64}
function pjOf(p) { try { const j = JSON.parse(p.description || "{}").pj; return (j && j.at && j.b64) ? j : null; } catch { return null; } }
async function handlePJRequests(printers) {
  for (const p of printers) {
    if (isBluetooth(p) || !p.ip) continue;
    const j = pjOf(p);
    if (j && String(state.printed[p.id]) !== String(j.at)) {
      state.printed[p.id] = j.at; saveState();   // มาร์คก่อนส่ง กันยิงซ้ำ
      try { await sendToPrinter(p.ip, p.port, Buffer.from(j.b64, "base64")); console.log(`  🖼️ พิมพ์รูปภาพ (ไทยคมชัด) → ${p.name} (${p.ip})`); }
      catch (e) { console.log(`  ❌ พิมพ์รูปภาพ → ${p.name} (${p.ip}): ${e.message}`); }
    }
  }
}

// ปุ่ม "เช็คสถานะใหม่" ในแอปเขียน description.pingReq = เวลาที่กด → agent เช็คสถานะเครื่องทันที (ไม่ต้องรอรอบ 30 วิ)
async function handlePingRequests(printers) {
  let need = false;
  for (const p of printers) {
    let d = {}; try { d = JSON.parse(p.description || "{}"); } catch {}
    const pr = +d.pingReq || 0;
    if (pr && String(state.pinged[p.id]) !== String(pr)) { state.pinged[p.id] = pr; need = true; }
  }
  if (need) { saveState(); await pingPrinters(); }
}

async function tick() {
  let orders, printers;
  try { [orders, printers] = await Promise.all([getActiveOrders(), getPrinters()]); }
  catch (e) { console.log("⚠️  ดึงข้อมูลไม่ได้ (เช็คเน็ต):", e.message); return; }
  printers = (printers || []).filter(p => (p.branch_id == null || +p.branch_id === +BRANCH) && p.active !== false);

  if (!primed) {
    for (const o of orders) if (o && o.items) { state.sig[o.id] = sigOf(o); state.init[o.id] = 1; }
    for (const p of printers) { const tp = tpOf(p); if (tp) state.tested[p.id] = tp; const rp = rpOf(p); if (rp) state.reprinted[p.id] = rp.at; const q = qrOf(p); if (q) state.qrPrinted[p.id] = q.at; const j = pjOf(p); if (j) state.printed[p.id] = j.at; }   // กันพิมพ์ย้อนหลังตอน prime ครั้งแรก
    primed = true; saveState();
    console.log(`🔰 บันทึกออเดอร์ค้าง ${orders.length} รายการ (ไม่พิมพ์ซ้ำ) — พร้อมพิมพ์ออเดอร์ใหม่`);
    return;
  }
  await handleTestRequests(printers);   // ทดสอบพิมพ์ตามคำสั่งที่กดจากแอป
  await handleReprintRequests(printers);   // พิมพ์ใบครัวซ้ำตามคำสั่งที่กดจากแอป
  await handleQRRequests(printers);   // พิมพ์ QR โต๊ะตามคำสั่งที่กดจากแอป
  await handlePJRequests(printers);   // พิมพ์รูปภาพ (ไทยคมชัด) ตามคำสั่งที่กดจากแอป
  await handlePingRequests(printers);   // เช็คสถานะเครื่องทันทีเมื่อกด "เช็คสถานะใหม่" ในแอป
  for (const o of orders) {
    if (!o || !o.items || !o.items.length) continue;
    const sig = sigOf(o), last = state.sig[o.id], first = !state.init[o.id];
    if (first) {
      console.log(`🆕 ออเดอร์ใหม่ โต๊ะ ${o.table_number} (${new Date().toLocaleTimeString("th-TH")})`);
      const items = last ? newItemsVs(last, o.items) : o.items;
      if (items.length) await printItems(items, o.table_number, printers);
      state.init[o.id] = 1;
    } else if (last && last !== sig) {
      console.log(`➕ เพิ่มรายการ โต๊ะ ${o.table_number}`);
      const items = newItemsVs(last, o.items);
      if (items.length) await printItems(items, o.table_number, printers);
    }
    state.sig[o.id] = sig;
  }
  // prune state ให้เหลือเฉพาะออเดอร์ที่ยัง active
  const live = new Set(orders.map(o => String(o.id)));
  for (const k of Object.keys(state.sig)) if (!live.has(String(k))) delete state.sig[k];
  for (const k of Object.keys(state.init)) if (!live.has(String(k))) delete state.init[k];
  saveState();
}

// พิมพ์หน้าทดสอบให้ "เครื่องที่เพิ่งเปิดใช้งาน" อัตโนมัติ — กด "เพิ่มใช้งาน" ในแอปแล้วมีกระดาษออกเองภายในไม่กี่วินาที
// จำว่าเครื่องไหนทดสอบไปแล้ว (state.greeted) เพื่อไม่พิมพ์ซ้ำทุกครั้งที่รีสตาร์ท · เครื่องที่ถูกนำออกแล้วเพิ่มกลับ จะทดสอบใหม่
async function greetNewPrinters() {
  try {
    const all = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH);
    if (!state.greeted) state.greeted = {};
    const activeIds = new Set(all.filter(p => p.active !== false).map(p => String(p.id)));
    for (const k of Object.keys(state.greeted)) if (!activeIds.has(String(k))) delete state.greeted[k];
    for (const p of all) {
      if (p.active === false || isBluetooth(p) || !p.ip || state.greeted[p.id]) continue;
      try {
        await sendToPrinter(p.ip, p.port, testPageESC());
        state.greeted[p.id] = 1; saveState();
        console.log(`  🧾 หน้าทดสอบ → ${p.name} (${p.ip}) [เครื่องที่เพิ่งเพิ่ม] — ดูว่ามีกระดาษออกไหม`);
      } catch (e) { /* ออฟไลน์/ติดต่อไม่ได้ — ลองใหม่รอบหน้า (ยังไม่ทำเครื่องหมายว่าทดสอบแล้ว) */ }
    }
    saveState();
  } catch {}
}

// เช็คว่าเครื่องพิมพ์ออนไลน์ไหม (ลองต่อ TCP 9100) แล้วบันทึกสถานะลง description.on ให้แอปโชว์จุดเขียว/แดง
// (iPad/https เช็คเองไม่ได้เพราะ mixed content — ต้องให้ agent เช็คแล้วรายงาน) · เขียนเฉพาะตอนสถานะเปลี่ยน (ลด writes + กันแย่งเขียนคำสั่ง)
let pinging = false;
async function pingPrinters() {
  if (pinging) return; pinging = true;
  try {
    const ps = (await getPrinters()).filter(p => (p.branch_id == null || +p.branch_id === +BRANCH) && p.active !== false && !isBluetooth(p) && p.ip);
    const res = await Promise.all(ps.map(async p => ({ p, open: await probePort(p.ip, p.port || 9100, 2500) })));
    for (const { p, open } of res) {
      const v = open ? 1 : 0;
      let d = {}; try { d = JSON.parse(p.description || "{}"); } catch {}
      if (d.on === v) continue;   // สถานะเดิม ไม่ต้องเขียน
      try { const r = await sb(`printers?id=eq.${p.id}&select=description`); if (r && r[0]) { try { d = JSON.parse(r[0].description || "{}"); } catch {} } } catch {}   // อ่านล่าสุดก่อนเขียน กันทับคำสั่ง
      if (d.on === v) continue;
      try { await patchPrinter(p.id, { description: JSON.stringify({ ...d, on: v, onAt: Date.now() }) }); console.log(`  📡 ${p.name} (${p.ip}) → ${v ? "ออนไลน์ 🟢" : "ออฟไลน์ 🔴"}`); } catch {}
    }
  } catch {} finally { pinging = false; }
}

(async () => {
  console.log("════════════════════════════════════════");
  console.log(" FOODCOST — ตัวพิมพ์ผ่านคลาวด์ (Print Agent)");
  console.log(" สาขา (branch):", BRANCH);
  console.log("════════════════════════════════════════");
  try {
    let printers = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH);
    await discoverPrinters(printers);                       // สแกนวง → บันทึกเครื่องใหม่เป็น "รอเพิ่ม"
    printers = (await getPrinters()).filter(p => (p.branch_id == null || +p.branch_id === +BRANCH) && p.active !== false);  // ใช้เฉพาะที่เปิดใช้งาน
    console.log(`เครื่องพิมพ์ที่ใช้งาน ${printers.length} เครื่อง:`);
    for (const p of printers) console.log(`  • ${p.name} — ${isBluetooth(p) ? "บลูทูธ (ข้าม)" : (p.ip || "ไม่มี IP") + ":" + (p.port || 9100)}`);
    console.log("— ทดสอบพิมพ์เครื่องที่เปิดใช้งาน (ครั้งเดียวต่อเครื่อง) —");
    await greetNewPrinters();
  } catch (e) { console.log("⚠️ โหลดเครื่องพิมพ์ไม่ได้:", e.message); }
  console.log("\n⏳ เริ่มเฝ้าออเดอร์... (Ctrl+C เพื่อหยุด)\n");
  await tick();
  setInterval(tick, POLL_MS);
  // พิมพ์หน้าทดสอบให้เครื่องที่ "เพิ่งกดเพิ่มใช้งาน" อัตโนมัติ ทุก 30 วินาที
  setInterval(greetNewPrinters, 30 * 1000);
  await pingPrinters();                       // เช็คออนไลน์/ออฟไลน์ครั้งแรก
  setInterval(pingPrinters, 30 * 1000);       // แล้วเช็คทุก 30 วิ → แอปโชว์จุดเขียว/แดง
  // สแกนหาเครื่องพิมพ์ใหม่ในวง LAN ทุก 2 นาที (เครื่องที่เสียบเพิ่มทีหลังจะถูกเพิ่มเองอัตโนมัติ — เร็วพอให้ปุ่ม "ค้นหาเครื่องพิมพ์" ในแอปเห็นผลไว)
  setInterval(async () => { try { const ps = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH); await discoverPrinters(ps); } catch {} }, 2 * 60 * 1000);
  // เช็คเวอร์ชันใหม่ทุก 5 นาที → อัปเดตเองโดยไม่ต้องแตะ Termux (เช็คตอนเริ่มด้วย)
  checkUpdate();
  setInterval(checkUpdate, 5 * 60 * 1000);
  console.log(`(เวอร์ชัน agent: v${AGENT_VERSION} — จะอัปเดตเองอัตโนมัติเมื่อมีเวอร์ชันใหม่)`);
})();
