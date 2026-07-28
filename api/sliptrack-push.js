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
