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
