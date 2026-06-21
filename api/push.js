// Web Push sender — called when a branch submits an order, to notify the Area Managers
// who cover that branch. Subscriptions live in the `push_subscriptions` table.
import webpush from "web-push";

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
// Public key is safe to expose; private MUST come from a Vercel env var.
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC || "BILnJiPdqZ_-7I0uwEoYHWWwPoi_FL1NDG4GRXpv7OzG1edCFdxFgGzLQVkJ4hDisWr4nEgG_i9gRLSgMqS22JY";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || "";

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  if (!VAPID_PRIVATE) return res.status(500).json({ error: "VAPID_PRIVATE not configured — set it in Vercel → Settings → Environment Variables" });
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const branchId = +body.branch_id || null;
    const branchName = body.branchName || "สาขา";

    webpush.setVapidDetails("mailto:naiwansook@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

    const subs = await sbFetch("push_subscriptions?select=*");
    // notify subscribers whose scope is "all" (allowed_branches null) or includes this branch
    const targets = (subs || []).filter(s => {
      const ab = s.allowed_branches;
      if (ab == null) return true;
      try { const arr = Array.isArray(ab) ? ab : JSON.parse(ab); return arr.map(Number).includes(branchId); } catch { return true; }
    });
    const payload = JSON.stringify({
      title: "🔔 คำสั่งซื้อรออนุมัติ",
      body: `${branchName} ส่งคำสั่งซื้อมารออนุมัติ`,
      url: "/?approve=1",
    });
    let sent = 0, removed = 0;
    await Promise.allSettled(targets.map(async s => {
      try {
        const sub = typeof s.subscription === "string" ? JSON.parse(s.subscription) : s.subscription;
        await webpush.sendNotification(sub, payload);
        sent++;
      } catch (e) {
        const code = e && e.statusCode;
        if (code === 404 || code === 410) {  // subscription expired → prune
          try { await sbFetch(`push_subscriptions?endpoint=eq.${encodeURIComponent(s.endpoint)}`, { method: "DELETE", headers: { Prefer: "return=minimal" } }); removed++; } catch {}
        }
      }
    }));
    return res.status(200).json({ ok: true, targets: targets.length, sent, removed });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
