// Vercel Serverless Function — proxies PO sync events to SlipTrack ingest API.
// Keeps SLIPTRACK_API_KEY server-side only (never shipped to the browser bundle).
//
// Required env var (set in Vercel → Settings → Environment Variables):
//   SLIPTRACK_API_KEY = <bearer token>
//
// Two-stage flow per the SlipTrack INTEGRATION_FOOD_COST spec:
//   • Stage 1 (รับของ):    paid omitted/false → server creates pending_payment rows
//   • Stage 2 (ชำระเงิน):  paid:true + paid_at + slip_url → server flips to confirmed
// The same external_id MUST be used in both stages — server updates by external_id,
// no ?upsert=1 query parameter is needed.

const SLIPTRACK_URL = "https://sliptrack-pro.vercel.app/api/ingest";

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.SLIPTRACK_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "SLIPTRACK_API_KEY not configured on the server" });
  }

  const body = req.body || {};

  // ── ทรัพย์สิน (fixed_asset) ───────────────────────────────────────────────
  // หน้าเว็บส่งมาแค่ { kind:'fixed_asset', asset_id } (หรือ + dispose:true) — เซิร์ฟเวอร์
  // อ่านแถวจริงจาก DB แล้วสร้าง payload เอง เพื่อให้มีโค้ดสร้าง payload "ชุดเดียว"
  // (บทเรียนจาก PO: มี 2 ชุดแล้วต้องคอยไล่ให้ตรงกัน พลาดง่าย)
  if (String(body.kind || "") === "fixed_asset") {
    const id = +body.asset_id;
    if (!(id > 0)) return res.status(400).json({ error: "Missing asset_id" });
    const { assetPayload, disposePayload, removedPayload } = await import("../lib/sliptrack-assets.js");
    let row;
    try {
      const r = await fetch(`${SUPA_URL}/rest/v1/assets?id=eq.${id}&select=id,name,category,branch_id,acquired_date,cost,quantity,salvage_value,useful_life_years,status,note`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      });
      const rows = await r.json();
      row = Array.isArray(rows) ? rows[0] : null;
    } catch (err) {
      return res.status(502).json({ error: "read asset failed", message: err && err.message });
    }
    // ลบไปแล้ว/ไม่พบ + สั่ง dispose → ยังต้องแจ้งบัญชีให้ตัดออกด้วย external_id
    if (!row && !body.dispose) return res.status(404).json({ error: "asset not found" });

    let payload;
    if (body.dispose) {
      payload = disposePayload(row || { id });
      if (body.disposed_amount != null) payload.disposed_amount = Number(body.disposed_amount) || 0;
    } else {
      // สถานะ "จำหน่ายแล้ว" ในแอป = แจ้งตัดออกจากทะเบียนบัญชี
      if (row.status === "disposed") payload = disposePayload(row);
      else {
        try {
          const bres = await fetch(`${SUPA_URL}/rest/v1/branches?id=eq.${+row.branch_id}&select=name`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
          const brows = await bres.json();
          const { branchNameForAccounting } = await import("../lib/sliptrack-map.js");
          row._branchName = branchNameForAccounting((Array.isArray(brows) && brows[0] && brows[0].name) || "");
        } catch { /* ไม่มีชื่อสาขาก็ยังส่งได้ (branch เป็น optional) */ }
        const built = assetPayload(row);
        // ไม่มีราคาทุน/วันที่ได้มา → ส่ง removed:true แทนการเงียบ
        // ถ้าเคยลงทะเบียนไว้แล้วแล้วราคาถูกลบทีหลัง การเงียบจะทำให้บัญชีค้างมูลค่าเดิมและ
        // คิดค่าเสื่อมต่อไปเรื่อยๆ. removed เป็น idempotent — ถ้าไม่เคยส่งมาก่อนก็ไม่มีผลอะไร
        // (ห้ามใช้ disposed:true เพราะจะสร้างผลขาดทุนจากการจำหน่ายปลอมๆ ในงบ)
        payload = built.skip
          ? removedPayload(row, built.skip === "no-cost" ? "ยังไม่ได้กรอกราคาทุนที่ระบบอาหาร" : "ยังไม่ได้ระบุวันที่ได้มาที่ระบบอาหาร")
          : built.payload;
      }
    }
    try {
      const r = await fetch(SLIPTRACK_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    } catch (err) {
      return res.status(502).json({ error: "Upstream fetch failed", message: err && err.message });
    }
  }


  // ── ปิดกะ → ใบปิดยอดขาย (pos_closing) ────────────────────────────────────
  // หน้าเว็บส่งมาแค่ { kind:'pos_closing', shift_id } — เซิร์ฟเวอร์อ่านบิลจริงจาก DB
  // แล้วคำนวณเอง ไม่เชื่อตัวเลขที่ส่งมาจากเบราว์เซอร์ เพราะนี่คือยอดที่จะลงสมุดบัญชี
  //
  // กติกาที่ตกลงกับฝั่งบัญชี (SlipTrack) 10 ก.ย. 69:
  //   · pos_closings มี UNIQUE (business_date, branch) → วันละ 1 ใบต่อสาขา
  //     กะที่คร่อมวันต้องแตกเป็นหลายใบ ไม่งั้นใบที่สองชนคีย์แล้วยอดหายทั้งกะ
  //   · exclude_vat = "จำนวนเงินภาษี" ไม่ใช่ฐานภาษี (เขาพิสูจน์จากข้อมูลจริง 3 สาขา)
  //     ระบบเขาไม่ได้สมมติว่า VAT = 7% ของยอดทั้งวัน ส่งเท่าที่เก็บได้จริงตรงๆ
  //   · payment เป็น array ชื่อมาตรฐาน และผลรวม "ชั้นหลัก" ต้องเท่ากับ total_sales
  //     พร้อมเพย์เป็นชั้นย่อยของบัตรเครดิต ห้ามบวกซ้ำเข้าผลรวม
  //   · ฝั่งเขากันลงซ้ำให้แล้วสองชั้น (409 day_already_closed / income.status exists)
  if (String(body.kind || "") === "pos_closing") {
    const POS_CLOSING_BRANCHES = [8];   // เฉพาะ The River ตามที่เจ้าของสั่ง สาขาอื่นยังใช้สแกนรูป
    const shiftId = Number(body.shift_id);
    if (!Number.isFinite(shiftId) || shiftId <= 0) {
      return res.status(400).json({ error: "Missing or invalid shift_id" });
    }
    const sbGet = async (path) => {
      const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
        headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` },
      });
      if (!r.ok) throw new Error(`supabase ${r.status}: ${(await r.text()).slice(0, 200)}`);
      return r.json();
    };
    try {
      const shiftRows = await sbGet(`pos_shifts?id=eq.${shiftId}&select=id,branch_id,opened_at,closed_at`);
      const shift = Array.isArray(shiftRows) && shiftRows[0];
      if (!shift) return res.status(404).json({ error: `ไม่พบกะ #${shiftId}` });
      if (!POS_CLOSING_BRANCHES.includes(Number(shift.branch_id))) {
        return res.status(200).json({ skipped: true, reason: "สาขานี้ยังไม่เปิดใช้ท่อลงบัญชีอัตโนมัติ", branch_id: shift.branch_id });
      }
      const brRows = await sbGet(`branches?id=eq.${Number(shift.branch_id)}&select=name`);
      const branchName = (Array.isArray(brRows) && brRows[0] && brRows[0].name) || "";
      if (!branchName) return res.status(500).json({ error: "ไม่พบชื่อสาขา" });

      // บิลที่ปิดแล้วในช่วงกะ — ขอบบนใช้เวลาปิดกะ ถ้ายังไม่ปิดใช้เวลาปัจจุบัน
      const from = encodeURIComponent(shift.opened_at);
      const to = encodeURIComponent(shift.closed_at || new Date().toISOString());
      const orders = await sbGet(
        `orders?branch_id=eq.${Number(shift.branch_id)}&status=eq.paid` +
        `&created_at=gte.${from}&created_at=lt.${to}` +
        `&select=id,total,subtotal,discount,promo_amount,service_charge,vat,round_adj,payment_method,created_at,updated_at` +
        `&order=id.asc&limit=2000`
      );

      const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
      // วันที่ทำการ = วันที่ "ปิดบิล" ตามเวลาไทย (โต๊ะเปิด 4 ทุ่มจ่ายตีหนึ่ง = รายได้ของวันที่จ่าย)
      const bizDate = (o) => new Date(o.updated_at || o.created_at)
        .toLocaleDateString("sv-SE", { timeZone: "Asia/Bangkok" });

      const byDay = new Map();
      for (const o of orders || []) {
        const d = bizDate(o);
        if (!byDay.has(d)) byDay.set(d, []);
        byDay.get(d).push(o);
      }
      if (byDay.size === 0) {
        return res.status(200).json({ skipped: true, reason: "กะนี้ไม่มีบิลที่ปิดแล้ว ไม่มียอดให้ลงบัญชี", shift_id: shiftId });
      }

      const sum = (list, k) => r2(list.reduce((t, x) => t + (Number(x[k]) || 0), 0));
      const results = [];
      for (const [business_date, list] of [...byDay.entries()].sort()) {
        const total_sales = sum(list, "total");
        // ส่วนลดที่ให้ไปจริง (รวมโปรโมชั่น) — ตัวเลขนี้ต้องตรงกับความจริงเสมอ
        const discount = r2(sum(list, "discount") + sum(list, "promo_amount"));
        // sub_total หามาจาก total_sales + discount เพื่อให้สมการของฝั่งบัญชีเป็นจริงเสมอ
        // (ค่าบริการ/ปัดเศษ/VAT แบบบวกเพิ่ม จะถูกซึมอยู่ในตัวนี้ — ตั้งใจ ไม่ใช่ความบังเอิญ)
        const sub_total = r2(total_sales + discount);
        const exclude_vat = sum(list, "vat");

        const cash = list.filter((x) => x.payment_method === "cash");
        const pp = list.filter((x) => x.payment_method === "promptpay" || x.payment_method === "transfer");
        const card = list.filter((x) => x.payment_method === "credit" || x.payment_method === "debit");
        const other = list.filter((x) => !["cash", "promptpay", "transfer", "credit", "debit"].includes(x.payment_method));
        const cardMain = r2(sum(pp, "total") + sum(card, "total"));   // พร้อมเพย์เป็นชั้นย่อยของบัตรเครดิต
        const payment = [];
        if (cash.length) payment.push({ name_th: "เงินสด", name_en: "Cash", count: cash.length, amount: sum(cash, "total") });
        if (cardMain > 0) payment.push({ name_th: "บัตรเครดิต (กรอกเอง)", name_en: "Credit Card (Manual input)", count: pp.length + card.length, amount: cardMain });
        if (pp.length) payment.push({ name_th: "พร้อมเพย์", name_en: "PromptPay", count: pp.length, amount: sum(pp, "total") });
        if (other.length) payment.push({ name_th: "Custom Payment", name_en: "Custom Payment", count: other.length, amount: sum(other, "total") });

        // ── ด่านกันยอดเพี้ยน — ไม่ลงตัวถึงสตางค์ = ไม่ยิง ──
        // ยอดที่ลงสมุดบัญชีผิด แก้ยากกว่าไม่ลงเลยมาก ถ้าเลขไม่ตรงต้องให้คนมาดูก่อน
        const mainSum = r2(sum(cash, "total") + cardMain + sum(other, "total"));
        const problems = [];
        if (Math.abs(r2(sub_total - discount) - total_sales) > 0.005)
          problems.push(`sub_total - discount (${r2(sub_total - discount)}) ไม่เท่า total_sales (${total_sales})`);
        if (Math.abs(mainSum - total_sales) > 0.005)
          problems.push(`ผลรวมวิธีจ่ายชั้นหลัก (${mainSum}) ไม่เท่า total_sales (${total_sales})`);
        if (!(total_sales > 0)) problems.push(`total_sales ต้องมากกว่า 0 (ได้ ${total_sales})`);
        if (exclude_vat > total_sales) problems.push(`VAT (${exclude_vat}) มากกว่ายอดขาย (${total_sales})`);
        if (problems.length) {
          results.push({ business_date, ok: false, blocked: true, problems, total_sales, bills: list.length });
          continue;   // วันที่มีปัญหาไม่ส่ง แต่วันอื่นในกะเดียวกันยังส่งได้
        }

        const payload = {
          source: "pos",
          kind: "pos_closing",
          external_id: `pos-${business_date}-${branchName}`,
          branch: branchName,
          business_date,
          total_sales,
          sub_total,
          discount,
          exclude_vat,
          number_of_guests: list.length,   // POS ไม่ได้เก็บจำนวนคน ส่งจำนวนบิลตามที่บัญชีแมปมา
          payment,
        };
        try {
          const r = await fetch(SLIPTRACK_URL, {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify(payload),
          });
          const data = await r.json().catch(() => ({}));
          results.push({ business_date, ok: r.ok, status: r.status, bills: list.length, total_sales, sent: payload, reply: data });
        } catch (err) {
          results.push({ business_date, ok: false, error: String((err && err.message) || err), total_sales, bills: list.length });
        }
      }
      const allOk = results.every((x) => x.ok);
      return res.status(allOk ? 200 : 207).json({ shift_id: shiftId, branch: branchName, days: results.length, results });
    } catch (err) {
      return res.status(502).json({ error: "pos_closing failed", message: String((err && err.message) || err) });
    }
  }

  // ── Void path ─────────────────────────────────────────────────────────────
  // A PO already synced here is cancelled/deleted in Food Cost. SlipTrack catches
  // `voided` BEFORE its own validation, so we forward only source/kind/external_id
  // (no amount/branch). It soft-cancels both the _in and _out rows and is
  // idempotent (voiding a never-synced or already-void PO returns cancelled:0).
  const isVoid =
    body.voided === true ||
    body.void === true ||
    String(body.status || "").toLowerCase() === "cancelled";
  if (isVoid) {
    if (!body.external_id) {
      return res.status(400).json({ error: "Missing required field: external_id" });
    }
    try {
      const r = await fetch(SLIPTRACK_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "food_cost",
          kind: "food_cost_po",
          external_id: String(body.external_id),
          voided: true,
        }),
      });
      const data = await r.json().catch(() => ({}));
      return res.status(r.status).json(data);
    } catch (err) {
      return res.status(502).json({ error: "Upstream fetch failed", message: err && err.message });
    }
  }

  // Hard-required fields per SlipTrack spec (both stages)
  const required = ["external_id", "datetime", "amount", "from_branch", "to_branch"];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") {
      return res.status(400).json({ error: `Missing required field: ${k}` });
    }
  }
  if (!(Number(body.amount) > 0)) {
    return res.status(400).json({ error: "amount must be > 0" });
  }
  if (String(body.from_branch).trim() === String(body.to_branch).trim()) {
    return res.status(400).json({ error: "from_branch must differ from to_branch" });
  }

  const isPaid = body.paid === true;
  const payload = {
    source: "food_cost",
    kind: "food_cost_po",
    external_id: String(body.external_id),
    datetime: String(body.datetime),
    amount: Number(body.amount),
    from_branch: String(body.from_branch).trim(),
    to_branch: String(body.to_branch).trim(),
    paid: isPaid,
  };
  if (isPaid) {
    if (body.paid_at) payload.paid_at = String(body.paid_at);
    if (body.slip_url) payload.slip_url = String(body.slip_url);
    if (body.payment_note) payload.payment_note = String(body.payment_note);
  } else {
    if (body.description) payload.description = String(body.description);
    if (body.category) payload.category = String(body.category);
    if (body.reference_no) payload.reference_no = String(body.reference_no);
    if (Array.isArray(body.items) && body.items.length) payload.items = body.items;
  }

  try {
    // ?upsert=1 → SlipTrack updates the existing row by external_id instead of
    // inserting a duplicate. Required for re-pushes (bulk re-sync, Stage-1 retry);
    // harmless on first insert. (paid:true also auto-upserts, but we send it always.)
    const r = await fetch(`${SLIPTRACK_URL}?upsert=1`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    // Mirror upstream status so client can decide whether to retry.
    return res.status(r.status).json(data);
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Upstream fetch failed", message: err && err.message });
  }
}
