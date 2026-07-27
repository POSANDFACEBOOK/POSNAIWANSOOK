// ══════════════════════════════════════════════════════════════════════════
// FoodCost → SlipTrack: ส่งยอดตรวจนับสต๊อก (ม.87) + ทะเบียนทรัพย์สิน (ค่าเสื่อม ม.65 ทวิ)
//
// ทำไมทำที่เซิร์ฟเวอร์ล้วน: บทเรียนจากการเชื่อม PO คือ "โค้ดสร้าง payload 2 ชุด (client+server)
// ต้องตรงกันเป๊ะ" เป็นภาระและพลาดง่าย. รอบนี้ payload ถูกสร้างที่นี่ที่เดียว — ฝั่งหน้าเว็บแค่บอก
// id ของทรัพย์สินที่เพิ่งแก้ ผ่าน api/sliptrack-push.js แล้วเซิร์ฟเวอร์อ่าน DB สร้าง payload เอง
//
// เรียกโดย Supabase pg_cron วันละครั้ง (23:45 น. เวลาไทย = 16:45 UTC) หรือเรียกมือด้วย ?key=
// ทุกอย่าง idempotent — ยิงซ้ำได้ ฝั่งบัญชี upsert ให้ (สต๊อกคีย์ period+branch+category,
// ทรัพย์สินคีย์ external_id)
//
// env ที่ต้องมี: SLIPTRACK_API_KEY (คีย์เดิมที่ใช้ส่ง PO) · SLIPTRACK_SWEEP_KEY (คีย์เรียกมือ/cron)
// ══════════════════════════════════════════════════════════════════════════
import { accountFor, branchNameForAccounting, ALL_ACCOUNTS } from "./_sliptrack-map.js";
import { assetPayload, disposePayload } from "./_sliptrack-assets.js";

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const SLIPTRACK_URL = "https://sliptrack-pro.vercel.app/api/ingest";

const round2 = (n) => Math.round((+n || 0) * 100) / 100;
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" };

// PostgREST ส่งกลับสูงสุด 1000 แถวต่อครั้ง (ไม่ว่าจะใส่ limit เท่าไร) — ต้องไล่ทีละหน้า
// ไม่งั้นแถวที่เกิน 1000 จะหายเงียบ (ทรัพย์สินตอนนี้ 1,120 แถว = หาย 120 แถวถ้าไม่ทำ)
// PostgREST ส่งกลับสูงสุด 1000 แถวต่อครั้ง — ต้องไล่ทีละหน้า ไม่งั้นแถวที่เกินหายเงียบ
// ใช้ keyset (id > ตัวสุดท้าย) ไม่ใช่ offset: ถ้าใช้ offset โดยไม่เรียงลำดับ Postgres ไม่รับประกัน
// ลำดับแถวข้ามคำขอ → แถวเดียวกันอาจถูกนับสองหน้า (มูลค่าซ้ำ) หรือหลุดทั้งคู่ (มูลค่าหาย)
async function sbFetchAll(path) {
  const PAGE = 1000;
  const out = [];
  let lastId = 0;
  for (let guard = 0; guard < 200; guard++) {
    const sep = path.includes("?") ? "&" : "?";
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}${sep}order=id.asc&limit=${PAGE}&id=gt.${lastId}`, { headers: H });
    if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
    const t = await r.text();
    const rows = t ? JSON.parse(t) : [];
    out.push(...rows);
    if (rows.length < PAGE) return out;
    const nextId = rows[rows.length - 1].id;
    // ต้อง select id มาด้วยเสมอ ไม่งั้นไล่หน้าถัดไปไม่ได้ — หยุดพร้อมบอกสาเหตุ ดีกว่าเงียบแล้วข้อมูลขาด
    if (nextId == null) throw new Error(`sbFetchAll: ต้องมี id ใน select (${path})`);
    lastId = nextId;
  }
  return out;
}

// ยิงพร้อมกันทีละไม่กี่ตัว — 108 ช่องยิงเรียงทีละอันจะเกินเวลาที่ Vercel ให้ (ฟังก์ชันถูกตัดกลางคัน)
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }));
  return out;
}

// วันนี้ตามเวลาไทย (กันเพี้ยนข้ามวันเพราะเซิร์ฟเวอร์เป็น UTC)
const bkkToday = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
const bkkPeriod = () => bkkToday().slice(0, 7);   // YYYY-MM

// วัตถุดิบตัวนี้ "มีอยู่" ที่สาขานี้ไหม — คัดลอกกติกาเดียวกับ ingVisibleAt ในแอป
function visibleAt(ing, branchId, isCentral) {
  if (isCentral) return true;
  const vb = ing && ing.visible_branches;
  if (vb == null || !Array.isArray(vb)) return true;
  if (vb.length === 0) return false;
  return vb.includes(branchId);
}

// จำนวนคงเหลือของสาขานั้น — ใช้ "คีย์ต่อสาขา" เท่านั้น ไม่ fallback ไป ings.stock (ค่ารวมยุคเก่า)
// เพราะ fallback จะทำให้ของก้อนเดียวถูกนับซ้ำที่ทุกสาขาที่มองเห็นวัตถุดิบนั้น
// (ต่างจากหน้าจอในแอปที่ยัง fallback อยู่ — ตัวเลขภาษีต้องไม่พองจากการนับซ้ำ)
function branchQty(ing, branchId) {
  const map = (ing && ing.stock_by_branch) || {};
  const v = map[String(branchId)];
  if (v == null || v === "") return 0;
  return +v || 0;
}

async function pushToSlipTrack(payload, apiKey) {
  try {
    const r = await fetch(SLIPTRACK_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return { ok: false, status: r.status, error: (data && (data.error || data.message)) || `HTTP ${r.status}` };
    return { ok: true, status: r.status, data };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// ── ต้นทุนต่อหน่วยแบบ "ถัวเฉลี่ยถ่วงน้ำหนัก" (weighted average cost) ─────────
// ตามหลักบัญชี ต้นทุนสินค้าคงเหลือต้องเป็นถัวเฉลี่ยถ่วงน้ำหนักหรือ FIFO — ห้ามใช้ราคาล่าสุด
// สูตร: Σ(ราคาต่อหน่วย × จำนวนที่รับจริง) ÷ Σ(จำนวนที่รับจริง) จากใบสั่งซื้อซัพนอกที่ "รับของแล้ว"
//
// ⚠️ กรองเฉพาะครั้งที่ "หน่วยตอนซื้อ" ตรงกับ "หน่วยในแคตตาล็อก" เท่านั้น
// เพราะบางตัวถูกซื้อคละหน่วย (เช่น ปลาดอลลี่ ซื้อทั้ง ฿45/กก. และ ฿700/ลัง) ถ้าเฉลี่ยรวมกัน
// จะได้ตัวเลขไร้ความหมาย (฿69/ลัง ทั้งที่จริง ฿112/ลัง) และสต๊อกนับเป็น "ลัง"
// ไม่มีประวัติซื้อที่หน่วยตรง → ใช้ราคาในแคตตาล็อก (buy_price) เป็นทางสำรอง
async function buildAvgCostMap(ings) {
  const byId = new Map(ings.map((i) => [+i.id, i]));
  const st = new Map();
  const orders = await sbFetchAll("order_requests?select=id,items&status=eq.delivered");
  for (const o of orders) {
    for (const it of (o.items || [])) {
      const id = +(it.ingId || it.ingredient_id);
      const ing = byId.get(id);
      if (!ing) continue;
      const price = +it.pricePerUnit || +it.buyPrice || 0;
      // "รับ 0" คือของไม่มาจริงๆ (หน้าจอรับของอนุญาตให้กด 0 ได้) ต้องแยกจาก "ไม่มีข้อมูล"
      // ถ้าใช้ || จะกลายเป็น 0 → falsy → ตกไปใช้ "จำนวนที่สั่ง" = เอาของที่ไม่เคยมาถ่วงน้ำหนักด้วย
      // (สั่ง 200 กก. ฿900 ไม่ได้มาเลย จะดันต้นทุนเฉลี่ยพุ่งทั้งที่ไม่ได้ซื้อ)
      const rq = it.receivedQty != null ? it.receivedQty : (it.received_qty != null ? it.received_qty : null);
      const qty = rq != null ? (+rq || 0) : (+it.qtyNeeded || 0);
      if (!(price > 0) || !(qty > 0)) continue;
      // หน่วยต้องตรงกันถึงเฉลี่ยรวมได้ — เทียบแบบตัดช่องว่างหัวท้าย (ข้อมูลเก่ามีเว้นวรรคปน)
      if (String(it.unit || "").trim() !== String(ing.buy_unit || "").trim()) continue;
      const s = st.get(id) || { w: 0, q: 0 };
      s.w += price * qty; s.q += qty;
      st.set(id, s);
    }
  }
  const avg = new Map();
  for (const [id, s] of st) if (s.q > 0) avg.set(id, s.w / s.q);
  return avg;
}

// ── ยอดตรวจนับสิ้นงวด (kind: inventory_count) ───────────────────────────────
// closing = Σ (จำนวนคงเหลือ × ต้นทุนถัวเฉลี่ยถ่วงน้ำหนัก) ต่อ สาขา × หมวดบัญชี — เป็น "มูลค่าบาท"
// ห้ามส่งยอดซื้อ (บัญชีคำนวณเองจากบิลรายจ่าย ส่งไปจะนับซ้ำ)
//
// หมายเหตุเรื่องกำไรภายใน: แคตตาล็อกวัตถุดิบเป็นชุดเดียวทั้งบริษัท และต้นทุนถัวเฉลี่ยคิดจาก
// "ราคาที่ซื้อจากซัพพลายเออร์ภายนอก" ไม่ใช่ราคาที่ครัวกลางตั้งให้สาขาในใบ PO
// → สต๊อกทุกสาขาถูกตีด้วยต้นทุนได้มาจริง ไม่มีกำไรภายในค้างอยู่ในมูลค่าสต๊อกรวมบริษัท
export async function buildInventoryPayloads() {
  const [branches, ings] = await Promise.all([
    sbFetchAll("branches?select=id,name,type"),
    sbFetchAll("ingredients?select=id,name,code,category,stock_by_branch,buy_price,buy_unit,visible_branches"),
  ]);
  const avgCost = await buildAvgCostMap(ings);
  const unitCostOf = (ing) => {
    const a = avgCost.get(+ing.id);
    return a != null ? a : (+ing.buy_price || 0);
  };
  const period = bkkPeriod(), countedAt = bkkToday();
  const buckets = new Map();          // "branch|account" → {branch, account, value}
  const negatives = [], unmapped = new Map();

  // ปูตารางเปล่าให้ครบทุกช่อง (สาขา × หมวดบัญชี) ก่อน — ถ้าสร้างช่องเฉพาะที่ "มีของตอนนี้"
  // หมวดที่ของหมดเกลี้ยงจะไม่มี payload ส่ง แล้วยอดเดิมที่เคยส่งไปจะค้างในบัญชีตลอดไป
  const canonBranches = [...new Set(branches.map((b) => branchNameForAccounting(b.name)).filter(Boolean))];
  for (const bn of canonBranches) for (const acc of ALL_ACCOUNTS) buckets.set(`${bn}|${acc}`, { branch: bn, account: acc, value: 0 });
  const addTo = (bName, account, amount) => {
    if (!bName || !account) return;
    const key = `${bName}|${account}`;
    if (!buckets.has(key)) buckets.set(key, { branch: bName, account, value: 0 });
    buckets.get(key).value += amount;
  };

  // หมวดที่จับคู่ไม่ได้ — นับ "ครั้งเดียวต่อวัตถุดิบ" (ไม่ใช่ต่อสาขา) พร้อมมูลค่าที่จะหายไป
  for (const ing of ings) {
    const { unmapped: u } = accountFor(ing);
    if (!u) continue;
    const k = ing.category || "(ไม่มีหมวด)";
    const prev = unmapped.get(k) || { count: 0, value: 0 };
    let q = 0; for (const b of branches) q += Math.max(0, branchQty(ing, b.id));
    unmapped.set(k, { count: prev.count + 1, value: round2(prev.value + q * unitCostOf(ing)) });
  }

  const hiddenWithStock = [];
  for (const b of branches) {
    const isCentral = b.type === "central";
    const bName = branchNameForAccounting(b.name);
    if (!bName) continue;
    for (const ing of ings) {
      const { account, unmapped: isUnmapped } = accountFor(ing);
      if (isUnmapped || !account) continue;         // จับคู่ไม่ได้ (นับไว้ข้างบนแล้ว) / ตั้งใจไม่ส่ง (E01–E03)
      const raw = branchQty(ing, b.id);
      // ⚠️ visible_branches เป็นแค่ "ธงโชว์ในเมนูของสาขา" ไม่ใช่คำตอบว่าของอยู่จริงไหม
      // ถ้าใช้มันกรองการตีมูลค่า ของจริงที่ค้างอยู่ในสาขาที่ไม่ได้ติ๊กจะหายจากรายงาน (~15% ของมูลค่ารวม)
      // → ตีมูลค่าตาม "จำนวนที่บันทึกไว้จริง" เสมอ ใช้ visible แค่ตัดสินว่าจะรายงานว่าผิดปกติไหม
      if (raw === 0) continue;
      if (raw < 0) { negatives.push({ code: ing.code, name: ing.name, branch: b.name, qty: raw }); continue; }
      if (!visibleAt(ing, b.id, isCentral) && hiddenWithStock.length < 50) hiddenWithStock.push({ code: ing.code, name: ing.name, branch: b.name, qty: raw });
      addTo(bName, account, raw * unitCostOf(ing));
    }
  }

  // ── ของที่ "ลอยอยู่ระหว่างทาง" ─────────────────────────────────────────────
  // ตอนครัวกลางกดจัดส่ง สต๊อกถูกหักจากผู้ส่งทันที แต่ผู้รับจะได้เพิ่มก็ต่อเมื่อกดรับ
  // ช่วงคาบนั้นของไม่อยู่ในสต๊อกของสาขาไหนเลย ถ้าไม่นับเข้ามา มูลค่าสินค้าคงเหลือจะขาดหายไป
  // (ยิ่งถ้าคาบเกี่ยววันสิ้นเดือน = ยอดปิดงวดต่ำกว่าจริง → ต้นทุนสูงเกิน → กำไรต่ำเกิน)
  // นับไว้ที่ "ผู้ส่ง" เพราะกรรมสิทธิ์ยังไม่โอน และถ้ายกเลิก/ตีกลับ ของจะคืนผู้ส่ง
  let inTransitValue = 0, inTransitLines = 0;
  try {
    const inTransit = await sbFetchAll("purchase_orders?select=id,from_branch_id,items,status&status=in.(shipped,disputed,transfer_shipped)");
    const ingById = new Map(ings.map((i) => [+i.id, i]));
    const bNameById = {};
    for (const b of branches) bNameById[+b.id] = branchNameForAccounting(b.name);
    for (const po of inTransit) {
      const items = Array.isArray(po.items) ? po.items : [];
      if (items.length > 0 && items.every((it) => it && (it.kind === "asset" || it.kind === "other"))) continue;  // ใบสินทรัพย์ ไม่ใช่วัตถุดิบ
      const senderName = bNameById[+po.from_branch_id];
      if (!senderName) continue;
      for (const it of items) {
        const ing = ingById.get(+it.ingredient_id);
        if (!ing) continue;
        const { account, unmapped: u } = accountFor(ing);
        if (u || !account) continue;
        // ใช้ "จำนวนที่สั่ง/ส่ง" เพราะนั่นคือจำนวนที่ถูกหักออกจากผู้ส่งตอนกดจัดส่ง
        const q = +it.qty || 0;
        if (!(q > 0)) continue;
        const v = q * unitCostOf(ing);
        addTo(senderName, account, v);
        inTransitValue += v; inTransitLines++;
      }
    }
  } catch (e) {
    // อ่านไม่ได้ = ยอมให้ขาดดีกว่าส่งตัวเลขมั่ว แต่ต้องรายงานออกไปว่าขาด
    inTransitValue = -1;
  }

  const payloads = [...buckets.values()].map((x) => ({
    source: "food_cost",
    kind: "inventory_count",
    external_id: `STOCK-${period}-${x.branch}-${x.account.split(" - ")[0]}`,
    period,
    branch: x.branch,
    category: x.account,
    closing: round2(x.value),
    counted_at: countedAt,
  }));
  return { payloads, negatives, unmapped: [...unmapped.entries()].map(([cat, v]) => ({ category: cat, ...v })), period, inTransitValue: round2(inTransitValue), inTransitLines, hiddenWithStock };
}

// งานนี้ยิงเข้าบัญชีเป็นร้อยครั้งต่อรอบ — ขอเวลาทำงานยาวกว่าค่าเริ่มต้น (Vercel ตัดที่ 10 วิ)
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const CRON = process.env.CRON_SECRET || "";
  const KEY = process.env.SLIPTRACK_SWEEP_KEY || "";
  const auth = req.headers.authorization || "";
  const qkey = (req.query && req.query.key) || "";
  if (!((CRON && auth === `Bearer ${CRON}`) || (KEY && qkey === KEY))) return res.status(401).json({ error: "unauthorized" });

  const apiKey = process.env.SLIPTRACK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "SLIPTRACK_API_KEY not configured" });

  // ?dry=1 → คำนวณอย่างเดียว ไม่ยิงเข้าบัญชี (ไว้ตรวจตัวเลขก่อนเปิดใช้จริง)
  const dry = String((req.query && req.query.dry) || "") === "1";
  // ?only=stock | assets → ทำเฉพาะส่วนนั้น
  const only = String((req.query && req.query.only) || "");

  const out = { ok: true, dry, stock: null, assets: null };

  try {
    // ── สต๊อก ──
    if (only !== "assets") {
      const st = await buildInventoryPayloads();
      const { payloads, negatives, unmapped, period } = st;
      let sent = 0, failed = 0, closed = 0;
      const errors = [];
      if (!dry) {
        // ยิงพร้อมกันทีละ 6 — ~110 ช่องถ้ายิงเรียงทีละอันจะเกินเวลาที่ Vercel ให้ แล้วถูกตัดกลางคัน
        const rs = await mapPool(payloads, 6, (p) => pushToSlipTrack(p, apiKey));
        rs.forEach((r, i) => {
          if (r.ok) sent++;
          else if (r.status === 409) closed++;                  // งวดปิดแล้ว — ข้าม ไม่ retry
          else { failed++; if (errors.length < 8) errors.push({ id: payloads[i].external_id, error: r.error }); }
        });
      }
      out.stock = {
        period, buckets: payloads.length, sent, failed, closedPeriod: closed,
        totalValue: round2(payloads.reduce((s, p) => s + p.closing, 0)),
        inTransitValue: st.inTransitValue, inTransitLines: st.inTransitLines,
        negativeCount: negatives.length,
        unmappedCategories: unmapped,
        hiddenWithStockCount: (st.hiddenWithStock || []).length,
        errors,
        ...(dry ? { preview: payloads, hiddenWithStock: st.hiddenWithStock } : {}),
      };
    }

    // ── ทรัพย์สิน ──
    if (only !== "stock") {
      const [branches, assets] = await Promise.all([
        sbFetchAll("branches?select=id,name,type"),
        sbFetchAll("assets?select=id,name,category,branch_id,acquired_date,cost,quantity,salvage_value,useful_life_years,status,note"),
      ]);
      const bMap = {};
      for (const b of branches) bMap[+b.id] = branchNameForAccounting(b.name);
      let sent = 0, failed = 0, closed = 0;
      const skipped = { "no-cost": 0, "no-acquired-date": 0, "disposed": 0 };
      const errors = [];
      const previews = [];
      // เตรียม payload ทั้งหมดก่อน แล้วค่อยยิงพร้อมกันทีละ 6 (กันเกินเวลาฟังก์ชัน)
      const jobs = [];
      for (const a of assets) {
        a._branchName = bMap[+a.branch_id] || "";
        // ทรัพย์สินที่จำหน่ายแล้ว: "ข้าม" ไม่ยิงซ้ำ — การแจ้งจำหน่ายทำครั้งเดียวตอนกดจำหน่าย/ลบ
        // (ถ้ายิงซ้ำทุกคืน วันที่จำหน่ายจะเลื่อนตามวันที่ยิง ทำให้ค่าเสื่อมและงวดที่รับรู้ผลขายผิด)
        if (a.status === "disposed") { skipped.disposed++; continue; }
        const built = assetPayload(a);
        if (built.skip) { skipped[built.skip] = (skipped[built.skip] || 0) + 1; continue; }
        jobs.push({ id: a.id, payload: built.payload });
      }
      if (dry) {
        jobs.forEach((j) => { sent++; previews.push(j.payload); });
      } else {
        const rs = await mapPool(jobs, 6, (j) => pushToSlipTrack(j.payload, apiKey));
        rs.forEach((r, i) => {
          if (r.ok) sent++;
          else if (r.status === 409) closed++;      // งวดปิดแล้ว — ข้าม ไม่ retry (เหมือนฝั่งสต๊อก)
          else { failed++; if (errors.length < 8) errors.push({ id: `ASSET-${jobs[i].id}`, error: r.error }); }
        });
      }
      out.assets = {
        total: assets.length, sent, failed, closedPeriod: closed, skipped, errors,
        ...(dry ? { preview: previews.slice(0, 20) } : {}),
      };
    }

    // ความล้มเหลวต้อง "ดัง" — ยอดปิดงวดถูกกำหนดโดยการรันครั้งสุดท้ายของเดือนเท่านั้น
    // ถ้าตอบ 200 ok ทั้งที่ยิงไม่สำเร็จบางช่อง จะไม่มีใครรู้ว่ายอดสิ้นเดือนไม่ครบ
    const bad = (out.stock && out.stock.failed > 0) || (out.assets && out.assets.failed > 0);
    if (bad) { out.ok = false; return res.status(502).json(out); }
    return res.status(200).json(out);
  } catch (e) {
    return res.status(500).json({ ok: false, error: (e && e.message) || String(e) });
  }
}
