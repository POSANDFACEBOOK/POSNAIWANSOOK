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
const AGENT_VERSION = 38;   // ⬆️ เลขเวอร์ชัน — เพิ่มทุกครั้งที่แก้ไฟล์นี้ (ใช้เช็คอัปเดตอัตโนมัติ)
const AGENT_URL = "https://foodcost-eta.vercel.app/print-agent.js";
const BRANCH = process.argv[2];
const POLL_MS = 5000;
// ทุกกี่รอบจึงจะดึงบิล "เต็ม" หนึ่งครั้ง (60 รอบ x 5 วิ = 5 นาที)
// เป็นตาข่ายนิรภัย เผื่อวันหลังมีทางเขียนไหนแก้รายการในบิลโดยไม่ขยับ updated_at
// ถ้าไม่มีตาข่ายนี้ ใบครัวที่พลาดจะพลาดถาวร — ครัวไม่มีทางรู้เลย
const FULL_EVERY = 60;
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
// รอบปกติดึงแค่ "หัวบิล" (id + เวลาแก้ล่าสุด) ~55 ไบต์/บิล
// เดิมลากรายการในบิลทั้งร้านมาทุก 5 วินาที = หลายสิบ GB ต่อเดือน
const getActiveOrderHeads = () => sb(`orders?status=neq.paid&status=neq.cancelled&select=id,updated_at&branch_id=eq.${BRANCH}`);
// ดึงรายการเฉพาะบิลที่เปลี่ยนจริง — คงตัวกรองสถานะไว้ด้วย เผื่อบิลถูกปิดคั่นระหว่างสองคำขอ
// (ถ้าถูกปิดไปแล้วจะไม่ถูกส่งกลับมา = ไม่พิมพ์ใบของบิลที่จ่ายเงินไปแล้ว)
const getOrdersByIds = (ids) => sb(`orders?id=in.(${ids.join(",")})&status=neq.paid&status=neq.cancelled&select=id,table_number,items,ordered_by&branch_id=eq.${BRANCH}`);
// ดึงเต็ม — ใช้ตอน prime และตอนตาข่ายนิรภัยเท่านั้น
const getActiveOrders = () => sb(`orders?status=neq.paid&status=neq.cancelled&select=id,table_number,items&order=created_at.desc&branch_id=eq.${BRANCH}`);
// ดึงเฉพาะเครื่องพิมพ์ของสาขานี้ (+ที่ใช้ร่วมทุกสาขา branch_id=null) — ไม่ดึงข้ามสาขา (ทุก caller กรองแบบนี้อยู่แล้ว)
const getPrinters = () => sb(`printers?or=(branch_id.is.null,branch_id.eq.${BRANCH})&order=id.asc`);
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
    for (let i = 0; i < ips.length; i += 60) {   // สแกนทีละ 60 IP (เร็วขึ้น)
      const r = await Promise.all(ips.slice(i, i + 60).map(ip => probePort(ip, 9100, 1500).then(o => o ? ip : null)));
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
// ตัวเลือกซ้ำ = "ชื่อ ×N" — ต้องเหมือน optionsText ในแอปทุกตัวอักษร (ใช้ทั้งพิมพ์และทำลายเซ็นตรวจรายการใหม่)
function optionsText(opts) { const m = new Map(); for (const o of (opts || [])) { const n = o && o.name; if (n) m.set(n, (m.get(n) || 0) + 1); } return [...m].map(([n, k]) => k > 1 ? `${n} ×${k}` : n).join(", "); }
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
// อ่านสำเร็จจริงไหม ไม่ใช่แค่ "ไฟล์มีอยู่" — ไฟดับกลางเขียนทำให้ไฟล์พังได้
let stateLoaded = false;
try { if (fs.existsSync(STATE_FILE)) { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); stateLoaded = true; } } catch { console.log("⚠️  ไฟล์ความจำเสียหาย (ไฟดับกลางเขียน?) — เริ่มจำใหม่ ไม่พิมพ์ย้อนหลัง"); }
if (!state.sig) state.sig = {}; if (!state.init) state.init = {}; if (!state.uat) state.uat = {}; if (!state.done) state.done = {}; if (!state.greeted) state.greeted = {}; if (!state.tested) state.tested = {}; if (!state.reprinted) state.reprinted = {}; if (!state.qrPrinted) state.qrPrinted = {}; if (!state.printed) state.printed = {}; if (!state.pinged) state.pinged = {}; if (state.lastScanReq == null) state.lastScanReq = 0;
// ⚠️ ต้องดู "อ่านความจำได้ไหม" ไม่ใช่ "ไฟล์มีอยู่ไหม"
// ไฟล์พังแต่ยังอยู่ = ความจำว่างเปล่าแต่คิดว่าจำได้ → ทุกบิลที่เปิดอยู่กลายเป็น
// บิลใหม่หมด แล้วพิมพ์ซ้ำทั้งร้าน (เกิดได้จริงตอนแบตหมดกลางจังหวะเขียนไฟล์)
// อ่านไม่ได้ = ถือว่ายังไม่เคยจำ → prime ใหม่ (บันทึกว่าเห็นแล้ว ไม่พิมพ์)
// ยอมเสี่ยงว่าบิลที่เพิ่งสั่งตอนนั้นอาจไม่ได้ใบ ดีกว่าพิมพ์ซ้ำทั้งร้าน
// (พนักงานกดพิมพ์ซ้ำรายรายการได้ แต่กระดาษที่ทะลักออกมาเอาคืนไม่ได้)
let primed = stateLoaded;
// เขียนแบบปลอดภัยต่อไฟดับ: เขียนลงไฟล์ชั่วคราวให้เสร็จก่อน แล้วค่อยสลับชื่อ
// การสลับชื่อเป็นการกระทำที่สำเร็จหรือไม่สำเร็จอย่างเดียว ไม่มีครึ่งๆ กลางๆ
// เขียนทับตรงๆ แล้วไฟดับกลางทาง = ได้ไฟล์ที่พังและอ่านไม่ออก
function saveState() {
  try {
    const tmp = STATE_FILE + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, STATE_FILE);
  } catch {}
}
const sigOf = o => JSON.stringify((o.items || []).map(i => [i.menu_id, i.qty, i.note || "", optionsText(i.options)]));
// รวมจำนวนตามคีย์ก่อนเทียบเสมอ — ห้ามใช้ new Map(entries) ตรงๆ เพราะคีย์ซ้ำจะ "ทับกัน"
// ไม่ใช่บวกกัน (posAppendItems ต่อเมนูเดิมเป็นแถวใหม่ ไม่รวมแถว) ถ้าทับกันแล้ว
// การสั่งเมนูเดิมซ้ำจะไม่มีวันถูกนับเป็นรายการใหม่ → ครัวไม่ได้ใบสั่งเลย
function sumByKey(rows) {
  const m = new Map();
  for (const [k, q] of rows) m.set(k, (m.get(k) || 0) + (+q || 0));
  return m;
}
function newItemsVs(oldSig, items) {
  try {
    const key = i => `${i.menu_id}|${i.note || ""}|${optionsText(i.options)}`;
    const old = sumByKey(JSON.parse(oldSig).map(([mid, q, n, opt]) => [`${mid}|${n}|${opt || ""}`, q]));
    const cur = sumByKey((items || []).map(i => [key(i), i.qty]));
    const out = [], seen = new Set();
    for (const i of items || []) {
      const k = key(i);
      if (seen.has(k)) continue;
      seen.add(k);
      const delta = (cur.get(k) || 0) - (old.get(k) || 0);
      if (delta > 0) out.push({ ...i, qty: delta });
    }
    return out;
  } catch { return items; }
}

// เรนเดอร์ใบครัวเป็นรูปภาพ (ไทยคมชัด) ผ่านบริการบน Vercel — ถ้าล้มเหลวคืน null แล้วถอยไปใช้ตัวอักษร ESC/POS
const SLIP_RENDER_URL = "https://foodcost-eta.vercel.app/api/kitchen-slip";
async function fetchSlipRaster(items, tableNum, meta) {
  // กันค้าง: ถ้าเรนเดอร์เกิน 9 วิ (serverless cold-start/ช้า) ยกเลิกแล้วถอยไปตัวอักษร — ไม่ให้บล็อกทั้งคิวพิมพ์
  const ctrl = (typeof AbortController !== "undefined") ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), 9000) : null;
  try {
    const res = await fetch(SLIP_RENDER_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ table: String(tableNum || ""), time: new Date().toLocaleString("th-TH"),
        bill: (meta && meta.bill != null) ? String(meta.bill) : "", by: (meta && meta.by) ? String(meta.by) : "",
        kind: (meta && meta.kind) ? String(meta.kind) : "", from: (meta && meta.from) ? String(meta.from) : "",
        items: (items || []).map(it => ({ qty: it.qty, name: it.name, options: it.options || [], note: it.note || "" })) }),
      ...(ctrl ? { signal: ctrl.signal } : {}),
    });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 30 ? buf : null;
  } catch (e) { return null; }
  finally { if (timer) clearTimeout(timer); }
}
// map แบบจำกัดจำนวนที่ทำพร้อมกัน (รักษาลำดับผลลัพธ์) — เรนเดอร์ใบครัวหลายใบพร้อมกันโดยไม่ยิง serverless ถล่มทีเดียว
async function mapLimit(arr, limit, fn) {
  const out = new Array(arr.length); let i = 0;
  async function worker() { while (i < arr.length) { const idx = i++; out[idx] = await fn(arr[idx], idx); } }
  await Promise.all(Array.from({ length: Math.min(limit, arr.length || 1) }, worker));
  return out;
}
// เรนเดอร์ "หนึ่งใบต่อหนึ่งรายการ" พร้อมกัน (cap 6) — ลองรูปภาพไทยคมชัดก่อน ถอยไปตัวอักษร ESC/POS ถ้าล้มเหลว (พิมพ์ไม่มีวันพัง)
async function renderItemBufs(items, tableNum, meta) {
  return mapLimit(items || [], 6, async it => {
    const b = await fetchSlipRaster([it], tableNum, meta);
    return b ? { buf: b, raster: true } : { buf: buildKitchenESC(it, tableNum), raster: false };
  });
}
function bufsMode(parts) {
  const raster = parts.filter(r => r.raster).length, text = parts.length - raster;
  return text === 0 ? "รูปภาพ" : (raster === 0 ? "ตัวอักษร(สำรอง)" : "ผสม รูปภาพ+ตัวอักษร");
}
// รวมรายการเป็นบัฟเฟอร์พิมพ์ (เรนเดอร์ทุกใบพร้อมกัน) — ใช้โดยเส้นทางพิมพ์ซ้ำ (rp)
async function itemsToBuffer(items, tableNum, meta) {
  const parts = await renderItemBufs(items, tableNum, meta);
  return { buf: Buffer.concat(parts.map(p => p.buf)), mode: bufsMode(parts) };
}
// เครื่องนี้ต้องพิมพ์รายการนี้ไหม — ตาม "กำหนดการพิมพ์" เป๊ะๆ: ปักหมุดเมนู(printer_id)→เฉพาะเครื่องนั้น · ไม่งั้น categories=null(พิมพ์ทุกหมวด) หรือมีหมวดนั้นในลิสต์
function printerHandles(p, it) {
  if (it.printer_id != null && it.printer_id !== "") return +p.id === +it.printer_id;
  if (p.categories === null || p.categories === undefined) return true;
  if (!Array.isArray(p.categories) || it.category == null) return false;
  const c = String(it.category).trim();
  return p.categories.some(x => String(x).trim() === c);
}
// alreadyDone = { [printerId]: 1 } เครื่องที่พิมพ์ "ใบชุดนี้" สำเร็จไปแล้วในรอบก่อน
// คืนค่า { ok, okIds } — okIds คือเครื่องที่เพิ่งส่งผ่าน
//
// ⚠️ หัวใจของการกันพิมพ์ท่วม: ถ้าเครื่องหนึ่งล่ม อีกเครื่องต้องไม่โดนส่งซ้ำ
// เดิมส่งไปทุกเครื่องทุกรอบ เครื่องที่ดีจึงพิมพ์ใบเดิมทุก 5 วินาทีไม่หยุด
// ถึงจะปิดต้นเหตุที่แอปแล้ว ใบครัวก็ต้องไม่มีทางออกมาโดยไม่บอกว่าโต๊ะไหน
// ไม่มีชื่อโต๊ะ = พิมพ์เลขบิลแทน ครัวยังตามหาได้ ดีกว่ากระดาษที่บอกแค่ชื่ออาหาร
function tableLabel(o) {
  const t = o && o.table_number;
  return (t == null || String(t).trim() === "") ? `ไม่ระบุโต๊ะ · บิล #${o && o.id}` : String(t);
}

async function printItems(items, tableNum, printers, alreadyDone, meta) {
  // ส่งรายการไป "ทุกเครื่องที่ตั้งค่าให้รับ" (ไม่ใช่เครื่องเดียว) — ตั้งทุกเครื่องพิมพ์ทุกหมวด = ออกทุกเครื่อง · ตั้งคนละหมวด = แยกกัน · ตรงตามที่ตั้งใน "กำหนดการพิมพ์"
  const all = (printers || []).filter(p => !isBluetooth(p) && p.ip);
  const usable = all.filter(p => !(alreadyDone && alreadyDone[p.id]));   // ข้ามเครื่องที่ผ่านแล้ว
  // เรนเดอร์ทุกใบ "ครั้งเดียว พร้อมกัน" แล้วใช้ซ้ำกับทุกเครื่องที่รับรายการนั้น (ไม่เรนเดอร์ซ้ำต่อเครื่อง, ไม่เรียงทีละใบ)
  const bufs = await renderItemBufs(items, tableNum, meta);
  // ส่งไปทุกเครื่องพร้อมกัน (คนละเครื่อง = ไม่ชนกัน) — เครื่องเดียวกันไม่ถูกยิงซ้อน เพราะ tick พิมพ์ทีละออเดอร์
  const jobs = usable.map(p => {
    const idxs = [];
    items.forEach((it, i) => { if (printerHandles(p, it)) idxs.push(i); });
    if (!idxs.length) return null;
    const parts = idxs.map(i => bufs[i]);
    return { p, buf: Buffer.concat(parts.map(x => x.buf)), mode: bufsMode(parts), n: idxs.length };
  }).filter(Boolean);
  let anyFail = false;
  const okIds = [];
  await Promise.all(jobs.map(({ p, buf, mode, n }) =>
    sendToPrinter(p.ip, p.port, buf)
      .then(() => { okIds.push(p.id); console.log(`  ✅ พิมพ์ ${n} รายการ [${mode}] → ${p.name} (${p.ip})`); })
      .catch(e => { anyFail = true; console.log(`  ❌ ไม่สำเร็จ → ${p.name} (${p.ip}): ${e.message}`); })
  ));
  // orphan ดูจากเครื่องทั้งหมด ไม่ใช่เฉพาะที่ยังไม่ได้พิมพ์ — ไม่งั้นพอเครื่องที่รับ
  // หมวดนั้นพิมพ์ผ่านแล้ว รอบถัดไปจะหลงคิดว่าไม่มีเครื่องรับ แล้วรายงานผิด
  const orphan = items.filter(it => !all.some(p => printerHandles(p, it)));
  if (orphan.length) {
    console.log("  ⚠️  ไม่มีเครื่องพิมพ์สำหรับ (ยังไม่ได้กำหนดหมวด):", orphan.map(i => i.name).join(", "));
    // เขียนกลับให้แอปเห็น — ไม่งั้นรู้อยู่คนเดียวบนจอ Termux ครัวไม่ได้ใบแล้วไม่มีใครรู้
    try {
      const p0 = usable[0] || (printers || [])[0];
      if (p0) {
        let d = {}; try { d = JSON.parse(p0.description || "{}"); } catch {}
        d.orphan = { at: Date.now(), names: [...new Set(orphan.map(i => i.name))].slice(0, 12), n: orphan.length };
        await patchPrinter(p0.id, { description: JSON.stringify(d) });
      }
    } catch {}
  }
  // สำเร็จ = ไม่มีเครื่องไหน "ส่งไม่ผ่าน"
  //
  // ⚠️ ห้ามนับ orphan (ไม่มีเครื่องไหนรับหมวดนั้น) เป็นความล้มเหลว และห้ามนับ
  // "ไม่มีงานส่งเลย" เป็นความล้มเหลวด้วย — สองอย่างนี้คือเรื่องการตั้งค่า
  // ลองใหม่กี่รอบก็ไม่หาย รอบหน้าก็ยังไม่มีเครื่องรับอยู่ดี
  //
  // เคยเขียนแบบนั้นตอนที่ยังมี catch-all คอยรับทุกหมวด orphan จึงไม่เคยเกิดจริง
  // พอเลิกใช้ catch-all (8 ก.ย. 69) หมวดที่ยังไม่ได้ติ๊กกลายเป็น orphan ทันที
  // ผู้เรียกไม่มาร์ค sig → รายการที่พิมพ์ได้ถูกพิมพ์ซ้ำทุก 5 วินาทีไม่หยุด
  //
  // ลองใหม่เฉพาะกรณีที่ส่งไปแล้วไม่ผ่าน (กระดาษหมด/หลุดแลน) ซึ่งรอบหน้าอาจหายเอง
  // รายการที่ "ไม่มีเครื่องไหนพิมพ์ให้สำเร็จเลย" — เอาไปแจ้งเตือนที่โต๊ะ
  // เครื่องที่พิมพ์ผ่านไปแล้วรอบก่อน (alreadyDone) ถือว่าส่งถึงแล้ว ไม่นับว่าพลาด
  const delivered = new Set([...okIds, ...Object.keys(alreadyDone || {}).map(Number)]);
  const failedItems = items.filter(it => {
    const hs = all.filter(p => printerHandles(p, it));
    return hs.length > 0 && !hs.some(p => delivered.has(+p.id));
  });
  return { ok: !anyFail, okIds, failedItems };
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
      // การเรนเดอร์ต้องอยู่ในกันชนเดียวกับการส่ง — เดิมอยู่นอกกันชน พอมันโยน
      // คำสั่งก็ถูกกินไปแล้วจากบรรทัดบน (มาร์คก่อนส่ง) และ tick ทั้งรอบตายกลางทาง
      // = กดปุ่มพิมพ์ซ้ำแล้วเงียบสนิท ไม่มีอะไรเกิดขึ้น และออเดอร์ปกติในรอบนั้นก็ไม่ได้พิมพ์ด้วย
      try {
        const { buf, mode } = await itemsToBuffer(its, rp.table || "-", { bill: rp.bill, by: rp.by, kind: rp.kind, from: rp.from });
        await sendToPrinter(p.ip, p.port, buf);
        console.log(`  🔁 พิมพ์ซ้ำ ${its.length} รายการ [${mode}] → ${p.name} (${p.ip})`);
      } catch (e) { console.log(`  ❌ พิมพ์ซ้ำ → ${p.name} (${p.ip}): ${e.message}`); }
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
// ลบงานพิมพ์ที่จัดการเสร็จแล้วออกจากแถว — อ่านของสดก่อนเขียนเสมอ เพื่อไม่ทับคำสั่งอื่น
// ลบเฉพาะงานที่มี at ตรงกับที่เราเพิ่งจัดการ ถ้าแอปเพิ่งส่งงานใหม่เข้ามาคาบเกี่ยว จะไม่ไปลบของใหม่ทิ้ง
async function clearPJ(id, at) {
  try {
    const r = await sb(`printers?id=eq.${id}&select=description`);
    let d = {};
    try { d = JSON.parse((r && r[0] && r[0].description) || "{}"); } catch { return; }
    if (!d.pj || String(d.pj.at) !== String(at)) return;   // ไม่ใช่งานเดิม = มีคนส่งงานใหม่มาแล้ว ปล่อยไว้
    delete d.pj;
    await patchPrinter(id, { description: JSON.stringify(d) });
    console.log(`  🧹 ล้างงานพิมพ์ที่เสร็จแล้วออกจากแถว #${id}`);
  } catch { /* ล้างไม่สำเร็จก็ไม่เป็นไร รอบหน้าลองใหม่ */ }
}

async function handlePJRequests(printers) {
  for (const p of printers) {
    if (isBluetooth(p) || !p.ip) continue;
    const j = pjOf(p);
    if (!j) continue;
    if (String(state.printed[p.id]) !== String(j.at)) {
      state.printed[p.id] = j.at; saveState();   // มาร์คก่อนส่ง กันยิงซ้ำ
      try { await sendToPrinter(p.ip, p.port, Buffer.from(j.b64, "base64")); console.log(`  🖼️ พิมพ์รูปภาพ (ไทยคมชัด) → ${p.name} (${p.ip})`); }
      catch (e) { console.log(`  ❌ พิมพ์รูปภาพ → ${p.name} (${p.ip}): ${e.message}`); }
    }
    // งานพิมพ์เป็นคำสั่งครั้งเดียวจบ — พิมพ์แล้ว (หรือพยายามแล้ว) ต้องลบทิ้งทันที
    // ปล่อยค้างไว้คือรูปใบเสร็จ base64 ~24KB นอนอยู่ในแถว แล้วถูกอ่านซ้ำทุก 5 วินาที
    // ตลอด 24 ชม. (getPrinters ดึงทุกคอลัมน์) และถูกเขียนกลับทั้งก้อนทุก 45 วินาที
    // (heartbeat merge ทั้ง description) — นี่คือสิ่งที่ทำให้ Disk IO หมดจนฐานข้อมูลล่ม 9 ก.ย. 69
    // ไม่ลองพิมพ์ใหม่อยู่แล้วตามกติกา (ล้มเหลว = แจ้งเตือนที่โต๊ะ) การลบจึงไม่ทำให้ใบหาย
    await clearPJ(p.id, j.at);
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
  if (need) { saveState(); await pingPrinters(true); }   // force เขียน onAt เสมอ → แอปรู้ว่าเช็คเสร็จ หยุดหมุน
}

// ปุ่ม "ค้นหาเครื่องพิมพ์" ในแอปเขียน description.scanReq → agent สแกนหาเครื่องใหม่ในวง LAN ทันที (ไม่รอรอบ 2 นาที)
async function handleScanRequests(printers) {
  let maxReq = 0;
  for (const p of printers) { let d = {}; try { d = JSON.parse(p.description || "{}"); } catch {} const sr = +d.scanReq || 0; if (sr > maxReq) maxReq = sr; }
  if (maxReq && maxReq > (state.lastScanReq || 0)) {
    state.lastScanReq = maxReq; saveState();
    console.log("🔍 รับคำสั่งค้นหาเครื่องพิมพ์จากแอป — สแกนทันที");
    try { const ps = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH); await discoverPrinters(ps); } catch {}
  }
}

// บันทึก "ใบครัวที่ไม่ออก" กลับเข้าระบบ ให้แอปเอาไปแจ้งเตือนที่โต๊ะนั้น
// เจ้าของสั่งไว้ (8 ก.ย. 69): ห้ามลองพิมพ์ใหม่เอง แม้เน็ตกลับมาแล้วก็ห้าม
// ให้พนักงานเป็นคนกดเองเมื่อมั่นใจว่าพร้อม — กระดาษที่ออกมาเองตอนไม่มีคนดู
// คือใบที่ครัวอาจไม่เห็น หรือเห็นแล้วทำซ้ำกับที่ทำไปแล้ว
async function recordPrintFail(printers, order, items) {
  const target = (printers || []).find(p => p.ip) || (printers || [])[0];
  if (!target || !items || !items.length) return;
  try {
    let d = {};
    try { const r = await sb(`printers?id=eq.${target.id}&select=description`); if (r && r[0]) d = JSON.parse(r[0].description || "{}"); } catch {}
    const list = Array.isArray(d.failed) ? d.failed : [];
    // ทับรายการเดิมของบิลนี้ ไม่สะสมซ้ำทุกรอบ
    const kept = list.filter(f => String(f.orderId) !== String(order.id));
    kept.push({
      at: Date.now(),
      orderId: order.id,
      table: tableLabel(order),
      names: [...new Set(items.map(i => i.name))].slice(0, 20),
      n: items.reduce((a, i) => a + (+i.qty || 0), 0),
    });
    d.failed = kept.slice(-30);   // เก็บล่าสุดพอ ไม่ให้ description บวม
    await patchPrinter(target.id, { description: JSON.stringify(d) });
    console.log(`  📌 บันทึกไว้ให้พนักงานกดพิมพ์เอง — โต๊ะ ${order.table_number}: ${d.failed[d.failed.length-1].names.join(", ")}`);
  } catch (e) { console.log("  ⚠️ บันทึกรายการที่พิมพ์ไม่ผ่านไม่สำเร็จ:", e.message); }
}

let fullTick = 0;   // นับรอบไปหาตาข่ายนิรภัย
async function tick() {
  let heads, printers;
  try { [heads, printers] = await Promise.all([getActiveOrderHeads(), getPrinters()]); }
  catch (e) { console.log("⚠️  ดึงข้อมูลไม่ได้ (เช็คเน็ต):", e.message); return; }
  printers = (printers || []).filter(p => (p.branch_id == null || +p.branch_id === +BRANCH) && p.active !== false);
  heads = heads || [];
  const uatOf = new Map(heads.map(h => [String(h.id), h.updated_at || null]));

  // บิลที่ต้องเปิดดูรายการ: ยังไม่เคยเห็น / เวลาแก้ขยับ / ไม่มีเวลาแก้ให้เทียบ
  // (ไม่มี updated_at = เทียบไม่ได้ ต้องถือว่าเปลี่ยน ห้ามเดาว่าเหมือนเดิม)
  const changed = heads.filter(h => !state.init[h.id] || !h.updated_at || state.uat[h.id] !== h.updated_at);
  fullTick++;
  const wantFull = !primed || fullTick >= FULL_EVERY || changed.length > 30;
  let orders;
  try {
    if (wantFull) { orders = await getActiveOrders(); fullTick = 0; }
    else if (changed.length) orders = await getOrdersByIds(changed.map(h => h.id));
    else orders = [];
  } catch (e) { console.log("⚠️  ดึงรายการในบิลไม่ได้ (เช็คเน็ต):", e.message); return; }
  orders = orders || [];

  if (!primed) {
    for (const o of orders) if (o && o.items) { state.sig[o.id] = sigOf(o); state.init[o.id] = 1; state.uat[o.id] = uatOf.get(String(o.id)) || null; }
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
  await handleScanRequests(printers);   // สแกนหาเครื่องพิมพ์ใหม่ทันทีเมื่อกด "ค้นหาเครื่องพิมพ์" ในแอป
  for (const o of orders) {
    if (!o || !o.items || !o.items.length) continue;
    const sig = sigOf(o), last = state.sig[o.id], first = !state.init[o.id];
    // มาร์คว่า "จัดการแล้ว" เฉพาะเมื่อพิมพ์ผ่านจริง — ถ้ากระดาษหมด/หลุดแลน
    // ต้องปล่อยให้ sig เดิมค้างไว้ รอบถัดไป (5 วิ) จะลองพิมพ์ให้ใหม่เอง
    let ok = true;
    // คีย์ของ "ใบชุดนี้" = ออเดอร์ + สถานะรายการ ณ ตอนนี้
    // ใช้จำว่าเครื่องไหนพิมพ์ใบชุดนี้ผ่านไปแล้ว จะได้ไม่ส่งซ้ำตอนลองใหม่
    const dk = o.id + "|" + sig;
    const done = state.done[dk] || {};
    let lastResult = null;
    const mark = r => {
      lastResult = r;
      if (r && r.okIds && r.okIds.length) {
        state.done[dk] = { ...done };
        r.okIds.forEach(id => { state.done[dk][id] = 1; });
      }
      return r ? r.ok : true;
    };
    if (first) {
      console.log(`🆕 ออเดอร์ใหม่ โต๊ะ ${o.table_number} (${new Date().toLocaleTimeString("th-TH")})`);
      const items = last ? newItemsVs(last, o.items) : o.items;
      if (items.length) ok = mark(await printItems(items, tableLabel(o), printers, done, { bill: o.id, by: o.ordered_by }));
      if (ok) state.init[o.id] = 1;
    } else if (last && last !== sig) {
      console.log(`➕ เพิ่มรายการ โต๊ะ ${o.table_number}`);
      const items = newItemsVs(last, o.items);
      if (items.length) ok = mark(await printItems(items, tableLabel(o), printers, done, { bill: o.id, by: o.ordered_by }));
    }
    // ── ไม่ลองพิมพ์ใหม่เองเด็ดขาด ────────────────────────────────────────
    // เจ้าของสั่งไว้: พิมพ์ไม่สำเร็จให้ "แจ้งเตือนที่โต๊ะ" แล้วรอพนักงานกดเอง
    // แม้เน็ตกลับมาปกติแล้วก็ห้ามส่งเอง — คนต้องเป็นคนตัดสินใจว่าพร้อมแล้ว
    // มาร์คว่าจัดการแล้วทุกกรณี จะได้ไม่วนพิมพ์ (เคยทำกระดาษหมดม้วนมาแล้ว)
    if (!ok) {
      await recordPrintFail(printers, o, (lastResult && lastResult.failedItems) || []);
      ok = true;
    }
    // มาร์ค uat พร้อม sig เท่านั้น — ถ้าพิมพ์ไม่ผ่านแล้วเผลอมาร์ค uat ไว้
    // รอบหน้าจะเห็นว่า "ไม่เปลี่ยน" แล้วไม่เปิดดูรายการอีกเลย = ใบครัวหายถาวร
    if (ok) { state.sig[o.id] = sig; state.uat[o.id] = uatOf.get(String(o.id)) || null; }
    else console.log(`  🔁 จะลองพิมพ์ใหม่รอบหน้า — โต๊ะ ${o.table_number}`);
  }
  // prune state ให้เหลือเฉพาะออเดอร์ที่ยัง active
  // ⚠️ ต้องอิง heads (บิลที่เปิดอยู่ "ทั้งหมด") ไม่ใช่ orders (เฉพาะบิลที่เปลี่ยน)
  // ถ้าอิง orders รอบที่ไม่มีอะไรเปลี่ยนจะล้างสถานะทิ้งทั้งร้าน แล้วพิมพ์ซ้ำทุกใบ
  //
  // ⚠️⚠️ และต้องรวม orders เข้าไปด้วย: heads กับ orders มาจากคนละคำขอ คนละเวลา
  // บิลที่ลูกค้ากดส่งคั่นระหว่างสองคำขอ จะอยู่ใน orders (พิมพ์ไปแล้ว) แต่ไม่อยู่ใน
  // heads (ถ่ายภาพไว้ก่อนหน้า) ถ้าไม่รวม จะล้างสถานะของใบที่เพิ่งพิมพ์ทิ้ง
  // แล้วรอบหน้าพิมพ์ซ้ำทั้งใบ — ครัวทำอาหารสองรอบ
  const live = new Set(heads.map(h => String(h.id)));
  for (const o of orders) live.add(String(o.id));
  // ล้างได้ต่อเมื่อ "รู้จริง" ว่าบิลไหนเปิดอยู่บ้างเท่านั้น
  //
  // คำขอที่คืน 200 พร้อมตัวเปล่าชั่วคราวเคยเกิดกับระบบนี้มาแล้ว (commit 1b6f529)
  // และ sb() แปลง body ว่างเป็น [] — แยกจาก "ร้านไม่มีบิลเปิดจริงๆ" ไม่ได้เลย
  // ถ้าเชื่อแล้วล้างทิ้ง รอบหน้าทุกบิลจะกลายเป็น "บิลใหม่" แล้วพิมพ์ใหม่ทั้งร้าน
  //
  // เคยเขียนเป็นตัวนับ "ว่างติดกัน 2 รอบค่อยล้าง" แต่ใช้ไม่ได้จริง เพราะรอบที่
  // ดึงข้อมูลไม่ผ่านจะ return ออกไปก่อนถึงตัวนับ — จังหวะที่ดึงหัวบิลสำเร็จและ
  // เห็นบิลเปิดอยู่เต็มมือ แต่ดึงรายการไม่ผ่าน ก็ไม่รีเซ็ต ทั้งที่นั่นคือหลักฐาน
  // ชัดที่สุดว่าร้านไม่ได้ว่าง
  //
  // สถานะที่ค้างอยู่ไม่เสียหายอะไรเลย — คีย์เป็นเลขบิลซึ่งไม่ถูกใช้ซ้ำ
  // รอบไหนที่มีบิลเปิดจริงก็ล้างของเก่าทิ้งเองอยู่แล้ว
  if (heads.length > 0) {
    for (const k of Object.keys(state.sig)) if (!live.has(String(k))) delete state.sig[k];
    for (const k of Object.keys(state.init)) if (!live.has(String(k))) delete state.init[k];
    for (const k of Object.keys(state.uat)) if (!live.has(String(k))) delete state.uat[k];
    // done/tries คีย์เป็น "เลขบิล|สถานะรายการ" — ตัดเอาเลขบิลมาเทียบ
    for (const k of Object.keys(state.done)) if (!live.has(String(k).split("|")[0])) delete state.done[k];
  }
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
// force=true (สั่งจากปุ่ม "เช็คสถานะใหม่") → เขียน onAt เสมอแม้สถานะไม่เปลี่ยน เพื่อให้แอปรู้ว่าเช็คเสร็จแล้ว (หยุดหมุนทันที)
async function pingPrinters(force) {
  if (pinging) return; pinging = true;
  try {
    const ps = (await getPrinters()).filter(p => (p.branch_id == null || +p.branch_id === +BRANCH) && p.active !== false && !isBluetooth(p) && p.ip);
    const res = await Promise.all(ps.map(async p => ({ p, open: await probePort(p.ip, p.port || 9100, 2500) })));
    for (const { p, open } of res) {
      const v = open ? 1 : 0;
      let d = {}; try { d = JSON.parse(p.description || "{}"); } catch {}
      if (!force && d.on === v) continue;   // ปกติ: สถานะเดิม ไม่ต้องเขียน (ลด writes)
      try { const r = await sb(`printers?id=eq.${p.id}&select=description`); if (r && r[0]) { try { d = JSON.parse(r[0].description || "{}"); } catch {} } } catch {}   // อ่านล่าสุดก่อนเขียน กันทับคำสั่ง
      if (!force && d.on === v) continue;
      try { await patchPrinter(p.id, { description: JSON.stringify({ ...d, on: v, onAt: Date.now() }) }); console.log(`  📡 ${p.name} (${p.ip}) → ${v ? "ออนไลน์ 🟢" : "ออฟไลน์ 🔴"}`); } catch {}
    }
  } catch {} finally { pinging = false; }
}

// ── HEARTBEAT ──────────────────────────────────────────────────────────────
// The agent proves it is ALIVE by stamping agentSeen/agentVer onto ONE printer row of the branch
// (the lowest id) every ~45s. The app reads it: if agentSeen is stale the kitchen is silently
// getting nothing, and staff see a "เปิดโปรแกรมตัวพิมพ์ที่ PC" banner. No new table needed — this
// piggybacks on printers.description, read-latest-before-write so it can't clobber app commands.
let hbBusy = false;
async function heartbeat() {
  if (hbBusy) return; hbBusy = true;
  try {
    const ps = (await getPrinters()).filter(p => (p.branch_id == null || +p.branch_id === +BRANCH) && p.active !== false);
    if (!ps.length) return;                       // no printer configured → nowhere to beat (and nothing to print)
    const target = ps.slice().sort((a, b) => +a.id - +b.id)[0];
    const online = ps.filter(p => !isBluetooth(p) && p.ip).length;
    // read the freshest description right before writing so we merge, not clobber, live commands
    let d = {}; try { const r = await sb(`printers?id=eq.${target.id}&select=description`); if (r && r[0]) { try { d = JSON.parse(r[0].description || "{}"); } catch {} } }
    catch { try { d = JSON.parse(target.description || "{}"); } catch {} }
    d.agentSeen = Date.now(); d.agentVer = AGENT_VERSION; d.agentPrinters = online;
    try { await patchPrinter(target.id, { description: JSON.stringify(d) }); } catch {}
  } catch {} finally { hbBusy = false; }
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
  // กัน tick ซ้อน — ถ้ารอบก่อนยังไม่จบ (พีค: render ใบ 9 วิ + ส่งเครื่อง 8 วิ)
  // ต้องข้ามรอบนี้ ไม่งั้นรอบใหม่เห็น state.sig เดิมแล้วสั่งพิมพ์ใบเดิมซ้ำ
  let tickBusy = false;
  const tickSafe = async () => {
    if (tickBusy) { console.log("⏭️  ข้ามรอบ — รอบก่อนยังทำงานอยู่ (กันพิมพ์ซ้ำ)"); return; }
    tickBusy = true;
    try { await tick(); } catch (e) { console.log("⚠️ tick ผิดพลาด:", e.message); }
    finally { tickBusy = false; }
  };
  await tickSafe();
  setInterval(tickSafe, POLL_MS);
  // พิมพ์หน้าทดสอบให้เครื่องที่ "เพิ่งกดเพิ่มใช้งาน" อัตโนมัติ ทุก 30 วินาที
  setInterval(greetNewPrinters, 30 * 1000);
  await pingPrinters();                       // เช็คออนไลน์/ออฟไลน์ครั้งแรก
  setInterval(pingPrinters, 30 * 1000);       // แล้วเช็คทุก 30 วิ → แอปโชว์จุดเขียว/แดง
  await heartbeat();                           // บอกแอปว่า agent ยังมีชีวิต (ครั้งแรกทันที)
  setInterval(heartbeat, 45 * 1000);          // แล้วเต้นทุก 45 วิ → แอปเตือนถ้า agent/PC ดับ
  // สแกนหาเครื่องพิมพ์ใหม่ในวง LAN ทุก 2 นาที (เครื่องที่เสียบเพิ่มทีหลังจะถูกเพิ่มเองอัตโนมัติ — เร็วพอให้ปุ่ม "ค้นหาเครื่องพิมพ์" ในแอปเห็นผลไว)
  setInterval(async () => { try { const ps = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH); await discoverPrinters(ps); } catch {} }, 2 * 60 * 1000);
  // เช็คเวอร์ชันใหม่ทุก 5 นาที → อัปเดตเองโดยไม่ต้องแตะ Termux (เช็คตอนเริ่มด้วย)
  checkUpdate();
  setInterval(checkUpdate, 5 * 60 * 1000);
  console.log(`(เวอร์ชัน agent: v${AGENT_VERSION} — จะอัปเดตเองอัตโนมัติเมื่อมีเวอร์ชันใหม่)`);
})();
