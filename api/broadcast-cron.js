// Dispatches scheduled LINE broadcasts whose time has come. Triggered by:
//  • Vercel cron (vercel.json) — sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set
//  • an external cron / the app heartbeat — pass ?key=<BROADCAST_KEY>
// Claims each row (status scheduled → sending) before sending so overlapping runs never double-send.
const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";

async function sbFetch(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(await r.text());
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}
function tokenMap() { try { return JSON.parse(process.env.LINE_TOKENS || "{}"); } catch { return {}; } }
function buildMessages(text, imageUrl) {
  const m = [];
  if (imageUrl) m.push({ type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl });
  if (text) m.push({ type: "text", text });
  return m.slice(0, 5);
}
async function sendToBranches(branches, messages, tokens) {
  const results = [];
  for (const bid of branches) {
    const token = tokens[String(bid)];
    if (!token) { results.push({ branch_id: bid, ok: false, error: "no token" }); continue; }
    try {
      const r = await fetch("https://api.line.me/v2/bot/message/broadcast", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ messages }),
      });
      if (r.ok) results.push({ branch_id: bid, ok: true });
      else { const t = await r.text(); results.push({ branch_id: bid, ok: false, error: (t || `HTTP ${r.status}`).slice(0, 300) }); }
    } catch (e) { results.push({ branch_id: bid, ok: false, error: String((e && e.message) || e) }); }
  }
  return results;
}

export default async function handler(req, res) {
  // Auth: Vercel cron header OR ?key=BROADCAST_KEY
  const CRON = process.env.CRON_SECRET || "";
  const KEY = process.env.BROADCAST_KEY || "";
  const auth = req.headers.authorization || "";
  const qkey = (req.query && req.query.key) || "";
  const ok = (CRON && auth === `Bearer ${CRON}`) || (KEY && qkey === KEY);
  if (!ok) return res.status(401).json({ error: "unauthorized" });

  try {
    const nowIso = new Date().toISOString();
    const due = await sbFetch(`crm_broadcasts?status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(nowIso)}&order=scheduled_at.asc&limit=20`);
    const tokens = tokenMap();
    let processed = 0;
    for (const b of (due || [])) {
      // claim: scheduled → sending (skip if another run already took it)
      let claimed;
      try { claimed = await sbFetch(`crm_broadcasts?id=eq.${b.id}&status=eq.scheduled`, { method: "PATCH", headers: { Prefer: "return=representation" }, body: JSON.stringify({ status: "sending" }) }); }
      catch { continue; }
      if (!Array.isArray(claimed) || !claimed.length) continue;

      const branches = Array.isArray(b.branch_ids) ? b.branch_ids.map(Number).filter(Boolean) : [];
      const messages = buildMessages((b.message || "").trim(), b.image_url || null);
      const results = messages.length && branches.length ? await sendToBranches(branches, messages, tokens) : [];
      try { await sbFetch(`crm_broadcasts?id=eq.${b.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "sent", results, sent_at: nowIso }) }); } catch {}
      processed++;
    }
    return res.status(200).json({ ok: true, processed });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
