// ══════════════════════════════════════════════════════════════════════════
// FoodCost → SlipTrack: ตัวสร้าง payload ทะเบียนทรัพย์สิน (kind: fixed_asset)
// ใช้ร่วมกันโดย api/sliptrack-daily.js (cron กวาดรายวัน) และ api/sliptrack-push.js
// (ยิงทันทีตอนหน้าเว็บบันทึก/ลบ) — มีชุดเดียวเพื่อไม่ให้ payload สองทางต่างกัน
// ══════════════════════════════════════════════════════════════════════════
const round2 = (n) => Math.round((+n || 0) * 100) / 100;
export const bkkToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });

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
