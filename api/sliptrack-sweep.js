// Vercel Serverless Function — GUARANTEED server-side sweep of unsynced POs → SlipTrack.
//
// Why this exists: the client pushes each PO to accounting the moment it's received/paid/cancelled,
// but that push is best-effort — a network blip or a closed tab could drop it silently, and the
// client self-heal only runs while someone has the app open. This endpoint is the safety net that
// needs NO client: it finds every received PO that hasn't confirmed-synced and (re)posts it — a
// bill for awaiting_payment/paid, a VOID for cancelled — re-reading each PO's live status right
// before pushing so a cancel can never be resurrected as a bill.
//
// Triggered by Supabase pg_cron (every ~1–2 min) via pg_net, or manually with ?key=.
// Idempotent: SlipTrack upserts by external_id, so re-pushing an already-synced PO is a no-op.
//
// Required env (Vercel → Settings → Environment Variables):
//   SLIPTRACK_API_KEY    — bearer token for the SlipTrack ingest API (already set)
//   SLIPTRACK_SWEEP_KEY  — shared secret; the pg_cron/manual caller passes ?key=<this>
//   (CRON_SECRET also accepted as Authorization: Bearer, mirroring the other crons)
//
// CORRECTNESS: the payload built here MUST match the client's pushPOToSlipTrack byte-for-byte
// (branch alias, received-qty amount + proportional VAT, two-stage), so whichever path pushes a
// given PO, accounting sees the identical row. Keep the two in lock-step.

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const SLIPTRACK_URL = "https://sliptrack-pro.vercel.app/api/ingest";

// How many POs to process per invocation (keeps a single run well under the function timeout).
const BATCH = 25;
// Only sweep POs untouched for at least this long, so we don't race the client's own in-flight
// push (its flag write lands within a second or two of the receive/pay). The client owns the
// first ~2 min; the server owns everything after.
const MIN_AGE_MS = 120 * 1000;
// Upper bound on how far back the AUTO sweep reaches. Its job is the ongoing guarantee + recent
// gaps — NOT a one-time reconcile of the whole history (that's the manual "ส่งทั้งหมด" button,
// which the operator runs deliberately). Every flag is null before this feature existed, so an
// unbounded cron would churn months of already-synced/reconciled rows every minute. 90 days
// comfortably covers recent incidents while leaving deep history to the manual, controlled path.
const MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

const round2 = (n) => Math.round((+n || 0) * 100) / 100;

// ── Branch-name canonicalisation (ported from FoodCostApp sliptrackBranchName) ──────────────
const SLIPTRACK_BRANCH_ALIAS = {
  "คุณนายตื่นสาย/แจ่วฮ้อน": "คุณนายตื่นสาย",
  "คุณนายแจ่วฮ้อน": "คุณนายตื่นสาย",
};
function sliptrackBranchName(name) {
  const n = String(name || "").trim();
  return SLIPTRACK_BRANCH_ALIAS[n] || n;
}

// ── Payload builder (ported EXACTLY from client pushPOToSlipTrack lines 566-617) ─────────────
// Returns {skip:'reason'} for a non-billable PO, else {payload, amount}. `paidCtx` (optional)
// carries {paidAt, slipUrl, note} for the Stage-2 (paid) push.
function buildPushPayload(po, branchById, paidCtx) {
  const fromB = branchById[+po.from_branch_id];
  const toB = branchById[+po.branch_id];
  if (!fromB || !toB) return { skip: "unknown-branch" };
  const fromName = sliptrackBranchName(fromB.name);
  const toName = sliptrackBranchName(toB.name);
  if (!fromName || !toName || fromName === toName) return { skip: "same-branch" };

  const recvLines = (po.items || []).map((it) => {
    const orig = +it.qty || 0;
    const recv = it.received_qty != null ? Math.max(0, Math.min(orig, +it.received_qty || 0)) : orig;
    return { name: String(it.name || "").trim(), qty: recv, unit: String(it.unit || "หน่วย"), unit_price: +it.price_per_unit || 0 };
  });
  const recvSubtotal = round2(recvLines.reduce((s, l) => s + l.qty * l.unit_price, 0));
  const vatRate = (+po.subtotal || 0) > 0 ? (+po.vat || 0) / +po.subtotal : 0;
  const recvVat = round2(recvSubtotal * vatRate);
  const recvAmount = round2(recvSubtotal + recvVat);
  const amount = (recvLines.some((l) => l.unit_price > 0) && recvSubtotal > 0) ? recvAmount : Number(po.total || 0);
  if (!(amount > 0)) return { skip: "zero-amount" };

  const externalId = `PO-${po.po_number || po.id}`;
  const isPaid = !!paidCtx;
  const datetime = po.received_at || new Date().toISOString();
  const payload = {
    source: "food_cost",
    kind: "food_cost_po",
    external_id: externalId,
    datetime,
    amount,
    from_branch: fromName,
    to_branch: toName,
    paid: isPaid,
  };
  if (isPaid) {
    payload.paid_at = paidCtx.paidAt || new Date().toISOString();
    if (paidCtx.slipUrl) payload.slip_url = paidCtx.slipUrl;
    if (paidCtx.note) payload.payment_note = paidCtx.note;
  } else {
    payload.description = po.notes ? `ซื้อวัตถุดิบ — ${po.notes}` : `ซื้อวัตถุดิบ ${externalId}`;
    payload.reference_no = po.po_number || externalId;
    const items = recvLines.filter((x) => x.name && x.qty > 0);
    if (items.length) payload.items = items;
  }
  return { payload, amount };
}

// Push one payload to SlipTrack (upsert by external_id). Returns {ok, status, error?}.
async function pushToSlipTrack(payload, apiKey) {
  try {
    const r = await fetch(`${SLIPTRACK_URL}?upsert=1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!r.ok) { const d = await r.json().catch(() => ({})); return { ok: false, status: r.status, error: (d && d.error) || `HTTP ${r.status}` }; }
    return { ok: true, status: r.status };
  } catch (err) {
    return { ok: false, error: (err && err.message) || String(err) };
  }
}

// Soft-cancel a PO's accounting rows (both _in and _out) by external_id. SlipTrack catches
// `voided` before validation, so no amount/branch is needed; idempotent (a never-synced or
// already-void PO returns cancelled:0). Mirrors the client void path exactly.
async function voidInSlipTrack(po, apiKey) {
  return pushToSlipTrack({ source: "food_cost", kind: "food_cost_po", external_id: `PO-${po.po_number || po.id}`, voided: true }, apiKey);
}

// Sign a stored slip path the same way the client's api.getSlipSignedUrl does, so accounting
// can open it. Returns an absolute URL or null.
async function signSlipUrl(pathOrUrl, base) {
  if (!pathOrUrl) return null;
  if (/^drive:/.test(pathOrUrl)) return `${base}/api/drive-view?id=${encodeURIComponent(pathOrUrl.slice(6))}`;
  if (/^https?:\/\//.test(pathOrUrl)) return pathOrUrl;
  try {
    const res = await fetch(`${SUPA_URL}/storage/v1/object/sign/po-slips-private/${pathOrUrl}`, {
      method: "POST", headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ expiresIn: 31536000 }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const signed = data.signedURL || data.signedUrl;
    if (!signed) return null;
    return signed.startsWith("http") ? signed : `${SUPA_URL}/storage/v1${signed}`;
  } catch { return null; }
}

async function recordFlag(poId, flag) {
  try { await sbFetch(`purchase_orders?id=eq.${poId}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ sliptrack_sync: flag }) }); } catch { /* column may not exist yet */ }
}

export default async function handler(req, res) {
  // Auth: Vercel cron bearer OR ?key=SLIPTRACK_SWEEP_KEY
  const CRON = process.env.CRON_SECRET || "";
  const KEY = process.env.SLIPTRACK_SWEEP_KEY || "";
  const auth = req.headers.authorization || "";
  const qkey = (req.query && req.query.key) || "";
  const authed = (CRON && auth === `Bearer ${CRON}`) || (KEY && qkey === KEY);
  if (!authed) return res.status(401).json({ error: "unauthorized" });

  const apiKey = process.env.SLIPTRACK_API_KEY;
  if (!apiKey) return res.status(500).json({ error: "SLIPTRACK_API_KEY not configured" });

  // ?job=daily → งานรายวันคนละชุด: ส่งยอดตรวจนับสต๊อก (ม.87) + ทะเบียนทรัพย์สิน (ค่าเสื่อม)
  // อยู่รวมกับ endpoint นี้เพราะแพลน Vercel จำกัดจำนวน serverless function ต่อ deployment
  if (String((req.query && req.query.job) || "") === "daily") {
    const { runDaily } = await import("../lib/sliptrack-daily.js");
    return runDaily(req, res, apiKey);
  }

  const base = process.env.PUBLIC_BASE_URL
    || (req.headers["x-forwarded-host"] ? `https://${req.headers["x-forwarded-host"]}` : "https://foodcost-eta.vercel.app");

  try {
    // Candidate POs that haven't confirmed-synced (null or 'failed'), received between (now-90d)
    // and (now-2min). received_at both restricts to POs that actually touched accounting (a null
    // received_at fails `lt`, so it's excluded — a never-received PO has no bill to post/void) AND
    // holds off long enough not to race the client's own push. NEWEST-first so a handful of
    // persistently-failing old rows can never starve fresh POs out of the limited batch. Includes
    // cancelled: a received-then-cancelled PO keeps its received_at, and its accounting row must be
    // VOIDED — leaving it out let a dropped void strand a phantom payable forever.
    const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
    const floor = new Date(Date.now() - MAX_AGE_MS).toISOString();
    const cols = "id,po_number,status,from_branch_id,branch_id,received_at,items,subtotal,vat,total,notes,payment_at,payment_note,payment_slip_url";
    // Order null (never-attempted) before 'failed', then newest-first. A row that keeps failing
    // (e.g. a branch name accounting rejects) writes 'failed' and sinks below every un-attempted
    // row, so it can never monopolise the batch and starve fresh POs out of the sync guarantee.
    const filter = `status=in.(awaiting_payment,paid,cancelled)&received_at=lt.${encodeURIComponent(cutoff)}&received_at=gt.${encodeURIComponent(floor)}&or=(sliptrack_sync.is.null,sliptrack_sync.eq.failed)&order=sliptrack_sync.asc.nullsfirst,received_at.desc&limit=${BATCH}`;
    const candidates = await sbFetch(`purchase_orders?select=${cols}&${filter}`);

    // ── ไม่มีงาน → จบตรงนี้เลย ────────────────────────────────────────────────
    // นี่คือเส้นทางของ "แทบทุกรอบ" ที่ cron ยิงมา (ตรวจจริง 12 ส.ค. 69: ค้าง 0 ใบ)
    // เดิมดึงตาราง branches มาก่อนเสมอ แม้ไม่มีใบให้ทำ = เสีย HTTP round-trip + CPU ฟรีๆ
    // ทุกรอบตลอด 24 ชม. ย้ายมาดึงหลังรู้ว่ามีงานจริง ทำให้รอบเปล่าเหลือคิวรีเดียว
    if (!Array.isArray(candidates) || !candidates.length) {
      return res.status(200).json({ ok: true, scanned: 0, synced: 0, failed: 0, skipped: 0, results: [] });
    }

    // ดึงชื่อสาขาเฉพาะตอนมีใบให้ผลักจริง — ใช้ทำ alias ที่ฝั่งบัญชีต้องเห็นตรงกับของเบราว์เซอร์
    const branches = await sbFetch(`branches?select=id,name`);
    const branchById = {};
    for (const b of branches) branchById[+b.id] = b;

    let ok = 0, failed = 0, skipped = 0;
    const results = [];
    for (const cand of candidates) {
      // Isolate each PO: an unexpected error on one row must never abort the batch (the rest of
      // this run, and every run after, would stall). Leave its flag untouched so the next run
      // retries it — never mark a row we didn't actually push.
      try {
        // Re-read the row's LIVE status right before pushing. The batch snapshot can be seconds
        // stale, and a cancel landing in that gap must turn into a VOID, never a bill — otherwise
        // we'd resurrect a just-voided payable and mark it 'ok' forever. Mirrors the client's
        // resyncPOToSlipTrack guard. A failed/empty re-read just skips this row (retried next run).
        let po;
        try { const fresh = await sbFetch(`purchase_orders?id=eq.${cand.id}&select=${cols}`); if (!Array.isArray(fresh) || !fresh.length) continue; po = fresh[0]; }
        catch { continue; }

        if (po.status === "cancelled") {
          // Its bill (if any) must be soft-cancelled. Idempotent — a never-billed PO returns cancelled:0.
          const rv = await voidInSlipTrack(po, apiKey);
          await recordFlag(po.id, rv.ok ? "ok" : "failed");
          rv.ok ? ok++ : failed++;
          results.push({ po: po.po_number, flag: rv.ok ? "ok" : "failed", action: "void", error: rv.error });
          continue;
        }
        if (po.status !== "awaiting_payment" && po.status !== "paid") {
          // Moved to a non-billable state (shipped/disputed/…) between query and now → leave it for
          // a later run in its proper state; don't record a flag on a row we didn't push.
          continue;
        }

        // Stage 1 (create/refresh the ค้างจ่าย row).
        const built = buildPushPayload(po, branchById, null);
        if (built.skip) { await recordFlag(po.id, "skip"); skipped++; results.push({ po: po.po_number, flag: "skip", reason: built.skip }); continue; }
        const s1 = await pushToSlipTrack(built.payload, apiKey);

        if (po.status !== "paid") {
          const flag = s1.ok ? "ok" : "failed";
          await recordFlag(po.id, flag);
          s1.ok ? ok++ : failed++;
          results.push({ po: po.po_number, flag, amount: built.amount, error: s1.error });
          continue;
        }
        // Paid PO → Stage 2 (flip to จ่ายแล้ว). Only 'ok' when Stage 2 lands, so a failed Stage 1
        // isn't masked. Same external_id + datetime, so it updates the same rows.
        const slipUrl = await signSlipUrl(po.payment_slip_url, base);
        const paidBuilt = buildPushPayload(po, branchById, { paidAt: po.payment_at || new Date().toISOString(), slipUrl, note: po.payment_note });
        if (paidBuilt.skip) { await recordFlag(po.id, "skip"); skipped++; results.push({ po: po.po_number, flag: "skip", reason: paidBuilt.skip }); continue; }
        const s2 = await pushToSlipTrack(paidBuilt.payload, apiKey);
        const flag = (s1.ok && s2.ok) ? "ok" : "failed";
        await recordFlag(po.id, flag);
        flag === "ok" ? ok++ : failed++;
        results.push({ po: po.po_number, flag, amount: paidBuilt.amount, error: s1.error || s2.error });
      } catch (e) {
        failed++;
        results.push({ po: cand.po_number, flag: "error", error: (e && e.message) || String(e) });
      }
    }

    return res.status(200).json({ ok: true, scanned: candidates.length, synced: ok, failed, skipped, results });
  } catch (err) {
    return res.status(502).json({ error: "sweep failed", message: (err && err.message) || String(err) });
  }
}
