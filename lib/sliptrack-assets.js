// ══════════════════════════════════════════════════════════════════════════
// FoodCost → SlipTrack: ตัวสร้าง payload ทะเบียนทรัพย์สิน (kind: fixed_asset)
// ใช้ร่วมกันโดย api/sliptrack-daily.js (cron กวาดรายวัน) และ api/sliptrack-push.js
// (ยิงทันทีตอนหน้าเว็บบันทึก/ลบ) — มีชุดเดียวเพื่อไม่ให้ payload สองทางต่างกัน
// ══════════════════════════════════════════════════════════════════════════
import { branchNameForAccounting } from "./sliptrack-map.js";

const round2 = (n) => Math.round((+n || 0) * 100) / 100;
export const bkkToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const SLIPTRACK_URL = "https://sliptrack-pro.vercel.app/api/ingest";

// ══ ผูกทะเบียนทรัพย์สินกับบิลใบส่งอุปกรณ์ (31 ต.ค. 69) ════════════════════════════
// เจ้าของตัดสิน: สาขาจ่ายเงินครัวกลางค่าอุปกรณ์จริงเหมือนวัตถุดิบ ⟹ ใบส่งอุปกรณ์ที่มีราคา = บิล PO-<เลขใบ> (po_kind:"asset")
// ฝั่งบัญชี (59b2288) ผูกทรัพย์สินที่ได้มาจากใบนั้นเข้ากับบิลของสาขาที่รับ ด้วย po_external_id — จะได้ไม่นับเป็นการซื้อแยกอีกก้อน
// ตัวผูกต้องติดไป "ทุกครั้ง" ที่ส่งทรัพย์สินตัวนั้น: ตอนรับของ · แก้ในแท็บสินทรัพย์ · โอนย้าย · cron รายคืน
//   ถ้าติดไปแค่ตอนรับ cron คืนนั้นส่งซ้ำแบบไม่มีตัวผูก — เราไม่รู้ว่าฝั่งบัญชีอ่าน "ไม่ส่ง" เป็นคงเดิมหรือล้างตัวผูก
//   (ราคาซากเคยเจอแบบเดียวกัน: upsert แยก "ไม่ส่ง" กับ "คงเดิม" ไม่ออก) ⟹ คิดตัวผูกที่เซิร์ฟเวอร์จากแถวในฐานทุกครั้ง ชุดเดียว
// แหล่งความจริง = หมายเหตุของแถว: receiveAssetPO เขียน "รับตาม <เลขใบ>" ทุกแถวที่สร้าง (โอนย้ายต่อท้าย ไม่ลบ) ไม่ต้องเพิ่มคอลัมน์
// ผูกเฉพาะใบที่ "มีบิลจริง" ตัดสินด้วยตัวสร้างบิลตัวจริง (buildPushPayload ของตัวกวาด) ไม่คิดสูตรยอดชุดที่สาม:
//   รับแล้ว + รอชำระ/จ่ายแล้ว + ตัวสร้างไม่ข้าม · ใบ ฿0 / ซื้อใช้เอง (ต้นทาง=ปลายทาง) / ยกเลิกแล้ว = ไม่มีบิลให้ผูก → ไม่ส่ง
export const assetPONumber = (a) => {
  const m = /รับตาม (PO-[A-Za-z0-9-]+)/.exec(String((a && a.note) || ""));
  return m ? m[1] : null;
};
export const PO_LINK_COLS = "id,po_number,status,from_branch_id,branch_id,received_at,items,subtotal,vat,total,notes";
const ASSET_COLS = "id,name,category,branch_id,acquired_date,cost,quantity,salvage_value,useful_life_years,status,note";

export async function poBillRef(po, branchById) {
  if (!po || !po.received_at || !["awaiting_payment", "paid"].includes(String(po.status || ""))) return null;
  // import ตอนเรียก (ไม่ใช่บนหัวไฟล์) — ตัวกวาด import ไฟล์นี้อยู่ ถ้า import กลับตอนโหลดจะวนกัน
  const { buildPushPayload } = await import("../api/sliptrack-sweep.js");
  const b = buildPushPayload(po, branchById || {}, null);
  return b && b.payload ? b.payload.external_id : null;
}

async function loadBranches(sbGet) {
  const out = {};
  for (const b of (await sbGet("branches?select=id,name,type")) || []) out[+b.id] = b;
  return out;
}

// ใส่ _poExternalId ให้แถวที่มาจากใบส่งอุปกรณ์ (อ่านใบจากฐานทีเดียวทั้งชุด) · อ่านไม่ได้ = โยน
// ผู้เรียกต้องไม่ส่งแถวพวกนี้ออกไปแบบไม่มีตัวผูกเพราะฐานสะดุดชั่วคราว (ไม่รู้ว่าฝั่งบัญชีจะล้างตัวผูกไหม)
export async function attachPOLinks(rows, sbGet, branchById) {
  const nos = [...new Set((rows || []).map(assetPONumber).filter(Boolean))];
  if (!nos.length) return;
  const pos = [];
  for (let i = 0; i < nos.length; i += 40) {
    const part = nos.slice(i, i + 40).map((n) => `"${n}"`).join(",");
    const got = await sbGet(`purchase_orders?select=${PO_LINK_COLS}&po_number=in.(${encodeURIComponent(part)})`);
    if (Array.isArray(got)) pos.push(...got);
  }
  const brs = branchById || (pos.length ? await loadBranches(sbGet) : {});
  const refOf = {};
  for (const p of pos) refOf[p.po_number] = await poBillRef(p, brs);
  for (const a of rows) {
    const no = assetPONumber(a);
    if (no && refOf[no]) a._poExternalId = refOf[no];
  }
}

// ส่งทรัพย์สินของใบเดียวกันซ้ำทั้งชุด หลังบิลของใบนั้นเพิ่งเข้าบัญชีสำเร็จ (ตัวซ่อมบนหน้าเว็บ / ตัวกวาดบนเซิร์ฟเวอร์)
// ตอนสาขากดรับ บิลอาจส่งไม่ผ่านแต่ทรัพย์สินออกไปแล้ว ฝั่งบัญชีเก็บแบบ "ยังไม่ผูก" + เตือน · ส่งซ้ำหลังบิลเข้า = ผูกให้
// ปลอดภัยต่อการส่งซ้ำ: ทรัพย์สินคีย์ ASSET-<id> (ฝั่งบัญชี upsert) · ไม่แตะบิล · ไม่มีบิล = ไม่ส่งอะไรเลย
export async function relinkPOAssets(po, { sbGet, push, branchById }) {
  const out = { po: (po && po.po_number) || null, link: null, sent: 0, failed: 0, skipped: 0, warnings: [], errors: [] };
  if (!po || !po.po_number) return out;
  const brs = branchById || await loadBranches(sbGet);
  out.link = await poBillRef(po, brs);
  if (!out.link) return out;
  const rows = await sbGet(`assets?select=${ASSET_COLS}&note=like.*${encodeURIComponent(`รับตาม ${po.po_number}`)}*&order=id.asc`);
  for (const a of Array.isArray(rows) ? rows : []) {
    // like จับเลขใบที่ขึ้นต้นเหมือนกันได้ด้วย — เทียบเลขใบเต็มอีกชั้น · จำหน่ายแล้วห้ามส่งทับ (จะล้างสถานะจำหน่ายฝั่งบัญชี)
    if (assetPONumber(a) !== po.po_number || a.status === "disposed") { out.skipped++; continue; }
    a._branchName = branchNameForAccounting((brs[+a.branch_id] || {}).name || "");
    a._poExternalId = out.link;
    const built = assetPayload(a);
    if (built.skip) { out.skipped++; continue; }   // ไม่มีทุน/วันที่ = ไม่เคยอยู่ในทะเบียนบัญชี ไม่มีอะไรให้ผูก
    const r = await push(built.payload);
    if (r && r.ok) { out.sent++; if (r.warnings && r.warnings.length) out.warnings.push(...r.warnings.map((w) => `ASSET-${a.id}: ${w}`)); }
    else { out.failed++; out.errors.push({ id: `ASSET-${a.id}`, error: (r && r.error) || "ส่งไม่สำเร็จ" }); }
  }
  return out;
}

// ส่งทรัพย์สินหนึ่งรายการ — แบบเดียวกับทางเดิมของพร็อกซี/cron รายคืน (ไม่ต่อ ?upsert=1: ทรัพย์สินฝั่งบัญชี upsert ด้วย external_id เอง)
export async function postAsset(payload, apiKey) {
  try {
    const r = await fetch(SLIPTRACK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: (data && (data.error || data.message)) || `HTTP ${r.status}` };
    const warnings = Array.isArray(data && data.warnings) ? data.warnings.filter(Boolean) : [];
    return { ok: true, status: r.status, ...(warnings.length ? { warnings } : {}) };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// สำคัญ: ในตาราง assets ช่อง `cost` คือ "ราคาต่อชิ้น" — ราคาทุนของแถว = cost × quantity
// (ตรงกับ assetDeprec ในแอป: gross = unit × qty) ฝั่งบัญชีคิดค่าเสื่อมจากราคาทุนรวมของแถว
export function assetPayload(a) {
  const qty = +a.quantity || 1;
  const gross = round2((+a.cost || 0) * qty);
  if (!(gross > 0)) return { skip: "no-cost" };               // บัญชีบังคับ cost > 0
  if (!a.acquired_date) return { skip: "no-acquired-date" };  // บังคับ + เป็นจุดเริ่มคิดค่าเสื่อม
  const p = {
    source: "food_cost",
    kind: "fixed_asset",
    external_id: `ASSET-${a.id}`,
    name: String(a.name || "").trim() || `สินทรัพย์ #${a.id}`,
    acquired_date: String(a.acquired_date).slice(0, 10),
    cost: gross,
  };
  if (+a.useful_life_years > 0) p.life_years = +a.useful_life_years;    // ไม่ส่ง = บัญชีใช้ 5 ปี (ค่าปกติของอุปกรณ์)
  // ส่งราคาซากเสมอแม้เป็น 0 — การส่งแบบ upsert ถ้า "ไม่ส่งช่องนี้" จะแยกไม่ออกระหว่าง
  // "ให้ใช้ค่าเริ่มต้น" กับ "คงค่าเดิมไว้" ทำให้แก้ราคาซากจาก 20,000 เหลือ 0 แล้วไม่มีผล
  p.salvage_value = round2(+a.salvage_value || 0);
  if (a.category) p.asset_type = String(a.category);
  if (a._branchName) p.branch = a._branchName;
  const extra = qty > 1 ? `${qty} ชิ้น (ราคาต่อชิ้น ฿${round2(+a.cost || 0)})` : "";
  const note = [extra, a.note ? String(a.note) : ""].filter(Boolean).join(" · ");
  if (note) p.note = note;
  // 31 ต.ค. 69: มาจากใบส่งอุปกรณ์ที่มีบิล = ผูกกับบิลนั้น (ผู้เรียกคิดให้ด้วย attachPOLinks / relinkPOAssets — ดูหัวไฟล์)
  if (a._poExternalId) p.po_external_id = String(a._poExternalId);
  return { payload: p, gross };
}

// ถอนออกจากทะเบียน — ใช้เมื่อทรัพย์สินที่เคยลงทะเบียนไว้ "ไม่มีราคาทุน/วันที่ได้มา" อีกต่อไป
// (เช่น ถูกแก้ราคาเป็น 0 เพราะลงซ้ำ) บัญชีจะซ่อนออกจากทะเบียนและหยุดคิดค่าเสื่อม แต่เก็บแถวไว้
//
// ⚠️ ห้ามใช้ disposed:true แทนเด็ดขาด — "จำหน่าย" จะสร้างผลขาดทุนจากการจำหน่ายเท่ากับมูลค่า
// คงเหลือ กลายเป็นตัวเลขปลอมในงบกำไรขาดทุน ทั้งที่ของยังอยู่ เป็นแค่ข้อมูลต้นทางไม่ครบ
export function removedPayload(a, reason) {
  return {
    source: "food_cost",
    kind: "fixed_asset",
    external_id: `ASSET-${a.id}`,
    removed: true,
    note: reason || "ถอนออกจากทะเบียน — ข้อมูลราคาทุนที่ต้นทางไม่ครบ",
  };
}

// จำหน่าย/เลิกใช้ — บัญชีเก็บไว้เป็นประวัติ ไม่ลบทิ้ง (idempotent: ถ้าไม่เคยส่งมาก่อน
// จะได้ updated:0 ซึ่งถือว่าสำเร็จ)
//
// ⚠️ ต้องยิง "ครั้งเดียวตอนจำหน่ายจริง" เท่านั้น ห้ามให้ cron ยิงซ้ำทุกคืน เพราะ:
//   • disposed_date เป็นวันที่ ณ ตอนยิง — ยิงซ้ำทุกคืน = วันที่จำหน่ายเลื่อนไปวันละวันไม่รู้จบ
//     ทำให้ค่าเสื่อม ม.65 ทวิ ถูกคิดเกินไปหลายเดือน และกำไร/ขาดทุนจากการขายไปตกผิดงวด
//   • ไม่ส่ง disposed_amount เลย เพื่อไม่ให้ไปทับยอดขายซากที่นักบัญชีกรอกเอง
//     (ถ้ามีการขายซาก ให้นักบัญชีกรอกฝั่งบัญชี หรือส่งมาครั้งเดียวพร้อมกันตอนจำหน่าย)
export function disposePayload(a, opts = {}) {
  const p = {
    source: "food_cost",
    kind: "fixed_asset",
    external_id: `ASSET-${a.id}`,
    disposed: true,
    disposed_date: opts.disposedDate || bkkToday(),
  };
  if (opts.disposedAmount != null) p.disposed_amount = Number(opts.disposedAmount) || 0;
  return p;
}
