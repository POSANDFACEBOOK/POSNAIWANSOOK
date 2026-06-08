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
const BRANCH = process.argv[2];
const POLL_MS = 5000;
const STATE_FILE = path.join(process.env.HOME || ".", ".foodcost-printed.json");

if (!BRANCH) { console.error("❌ ต้องใส่ branch id ด้วย เช่น:  node print-agent.js 6"); process.exit(1); }

// ── Supabase REST ────────────────────────────────────────────────────────
async function sb(query) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${query}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) throw new Error(await res.text());
  const txt = await res.text();
  return txt ? JSON.parse(txt) : [];
}
const getActiveOrders = () => sb(`orders?status=neq.paid&status=neq.cancelled&order=created_at.desc&branch_id=eq.${BRANCH}`);
const getPrinters = () => sb(`printers?order=id.asc`);
const addPrinter = (d) => fetch(`${SUPA_URL}/rest/v1/printers`, { method: "POST", headers: { apikey: SUPA_KEY, Authorization: "Bearer " + SUPA_KEY, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(d) });

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
async function discoverPrinters(existing) {
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
    try { await addPrinter({ name: `เครื่องพิมพ์ ${ip}`, ip, port: 9100, type: "kitchen", branch_id: +BRANCH, active: true, description: "" }); console.log(`  ➕ เพิ่มเครื่องพิมพ์ใหม่อัตโนมัติ: ${ip} (ไปตั้งชื่อ/หมวดในแอปได้)`); }
    catch (e) { console.log(`  ⚠️ เพิ่ม ${ip} ไม่สำเร็จ: ${e.message}`); }
  }
}

// ── ESC/POS (พอร์ตมาจากแอป buildKitchenESC) ──────────────────────────────
function optionsText(opts) { return (opts || []).map(o => o && o.name).filter(Boolean).join(", "); }
function isBluetooth(p) { try { return JSON.parse(p.description || "{}").c === "bt"; } catch { return false; } }
function resolvePrinter(item, printers) {
  if (!printers || !printers.length) return null;
  if (item.printer_id) { const p = printers.find(x => x.id === +item.printer_id); if (p) return p; }
  if (item.category) { const byCat = printers.find(p => Array.isArray(p.categories) && p.categories.includes(item.category)); if (byCat) return byCat; }
  return printers.find(p => p.categories === null || p.categories === undefined) || null;
}
function buildKitchenESC(item, tableNum) {
  const bufs = []; const b = (...x) => bufs.push(Buffer.from(x)); const t = s => bufs.push(Buffer.from(s, "utf8"));
  b(0x1b, 0x40); b(0x1b, 0x61, 0x01);
  b(0x1d, 0x21, 0x00); t("ใบสั่งอาหาร\n");
  b(0x1d, 0x21, 0x33); t(`โต๊ะ ${tableNum}\n`);
  b(0x1d, 0x21, 0x00); t(new Date().toLocaleString("th-TH") + "\n");
  t("================================\n");
  b(0x1d, 0x21, 0x11); b(0x1b, 0x45, 0x01); t(`${item.qty}x ${item.name}\n`); b(0x1b, 0x45, 0x00);
  b(0x1d, 0x21, 0x00);
  if (item.options && item.options.length) { b(0x1d, 0x21, 0x01); t(`+ ${optionsText(item.options)}\n`); b(0x1d, 0x21, 0x00); }
  if (item.note) { t("\n"); b(0x1b, 0x45, 0x01); t(`★ ${item.note}\n`); b(0x1b, 0x45, 0x00); }
  t("================================\n"); b(0x1b, 0x64, 0x05); b(0x1d, 0x56, 0x41, 0x00);
  return Buffer.concat(bufs);
}
function testPageESC() {
  const bufs = []; const b = (...x) => bufs.push(Buffer.from(x)); const t = s => bufs.push(Buffer.from(s, "utf8"));
  b(0x1b, 0x40); b(0x1b, 0x61, 0x01); b(0x1d, 0x21, 0x11); t("PRINT AGENT OK\n"); b(0x1d, 0x21, 0x00);
  t(new Date().toLocaleString() + "\n"); t("FOODCOST CLOUD AGENT\n");
  b(0x1b, 0x64, 0x03); b(0x1d, 0x56, 0x41, 0x00);
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
let state = { sig: {}, init: {} };
try { if (fs.existsSync(STATE_FILE)) state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
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

async function printItems(items, tableNum, printers) {
  const groups = new Map();
  for (const it of items) { const p = resolvePrinter(it, printers); const key = p ? p.id : "_none"; if (!groups.has(key)) groups.set(key, { p, items: [] }); groups.get(key).items.push(it); }
  for (const { p, items: gItems } of groups.values()) {
    if (!p) { console.log("  ⚠️  ไม่มีเครื่องพิมพ์สำหรับ:", gItems.map(i => i.name).join(", ")); continue; }
    if (isBluetooth(p)) { console.log("  ⚠️  ข้ามเครื่องบลูทูธ:", p.name); continue; }
    if (!p.ip) { console.log("  ⚠️  ยังไม่ตั้ง IP:", p.name); continue; }
    const buf = Buffer.concat(gItems.map(it => buildKitchenESC(it, tableNum)));
    try { await sendToPrinter(p.ip, p.port, buf); console.log(`  ✅ พิมพ์ ${gItems.length} รายการ → ${p.name} (${p.ip})`); }
    catch (e) { console.log(`  ❌ ไม่สำเร็จ → ${p.name} (${p.ip}): ${e.message}`); }
  }
}

async function tick() {
  let orders, printers;
  try { [orders, printers] = await Promise.all([getActiveOrders(), getPrinters()]); }
  catch (e) { console.log("⚠️  ดึงข้อมูลไม่ได้ (เช็คเน็ต):", e.message); return; }
  printers = (printers || []).filter(p => p.branch_id == null || +p.branch_id === +BRANCH);

  if (!primed) {
    for (const o of orders) if (o && o.items) { state.sig[o.id] = sigOf(o); state.init[o.id] = 1; }
    primed = true; saveState();
    console.log(`🔰 บันทึกออเดอร์ค้าง ${orders.length} รายการ (ไม่พิมพ์ซ้ำ) — พร้อมพิมพ์ออเดอร์ใหม่`);
    return;
  }
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

(async () => {
  console.log("════════════════════════════════════════");
  console.log(" FOODCOST — ตัวพิมพ์ผ่านคลาวด์ (Print Agent)");
  console.log(" สาขา (branch):", BRANCH);
  console.log("════════════════════════════════════════");
  try {
    let printers = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH);
    await discoverPrinters(printers);                       // สแกนวง → เพิ่มเครื่องพิมพ์ใหม่อัตโนมัติ
    printers = (await getPrinters()).filter(p => p.branch_id == null || +p.branch_id === +BRANCH);  // โหลดใหม่รวมที่เพิ่ง add
    console.log(`พบเครื่องพิมพ์ ${printers.length} เครื่อง:`);
    for (const p of printers) console.log(`  • ${p.name} — ${isBluetooth(p) ? "บลูทูธ (ข้าม)" : (p.ip || "ไม่มี IP") + ":" + (p.port || 9100)}`);
    console.log("— ทดสอบพิมพ์ตอนเริ่ม —");
    for (const p of printers) if (!isBluetooth(p) && p.ip) {
      try { await sendToPrinter(p.ip, p.port, testPageESC()); console.log(`  🧾 ส่งทดสอบ → ${p.name} (${p.ip}) — ดูว่ามีกระดาษออกไหม`); }
      catch (e) { console.log(`  ❌ ทดสอบ → ${p.name} (${p.ip}): ${e.message}`); }
    }
  } catch (e) { console.log("⚠️ โหลดเครื่องพิมพ์ไม่ได้:", e.message); }
  console.log("\n⏳ เริ่มเฝ้าออเดอร์... (Ctrl+C เพื่อหยุด)\n");
  await tick();
  setInterval(tick, POLL_MS);
})();
