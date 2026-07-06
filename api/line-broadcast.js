// LINE broadcast sender — pushes a message to ALL friends of each selected branch's
// LINE Official Account via the Messaging API /message/broadcast endpoint.
//
// SECURITY:
//  • Channel access tokens are secrets → they live in the Vercel env var LINE_TOKENS
//    (a JSON map { "<branchId>": "<channelAccessToken>", ... }). Never in the repo/DB.
//  • The endpoint itself is public, so it requires a shared secret (BROADCAST_KEY env)
//    that the admin types into the app once — otherwise anyone could spam the OAs.
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

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

    // Gate: shared secret must be configured AND match.
    const KEY = process.env.BROADCAST_KEY || "";
    if (!KEY) return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า BROADCAST_KEY ใน Vercel → Settings → Environment Variables" });
    if ((body.key || "") !== KEY) return res.status(401).json({ error: "รหัสบรอดแคสต์ไม่ถูกต้อง" });

    const branches = Array.isArray(body.branches) ? body.branches.map(Number).filter(Boolean) : [];
    const text = (body.text || "").toString().trim();
    if (!branches.length) return res.status(400).json({ error: "ยังไม่ได้เลือกสาขา" });
    if (!text) return res.status(400).json({ error: "ยังไม่ได้พิมพ์ข้อความ" });
    if (text.length > 4900) return res.status(400).json({ error: "ข้อความยาวเกิน (สูงสุด ~5000 ตัวอักษร)" });

    const messages = [{ type: "text", text }];
    const tokens = tokenMap();
    const results = [];
    for (const bid of branches) {
      const token = tokens[String(bid)];
      if (!token) { results.push({ branch_id: bid, ok: false, error: "ยังไม่ได้ตั้งค่า token ของสาขานี้ (LINE_TOKENS)" }); continue; }
      try {
        const r = await fetch("https://api.line.me/v2/bot/message/broadcast", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
        if (r.ok) results.push({ branch_id: bid, ok: true });
        else { const t = await r.text(); results.push({ branch_id: bid, ok: false, error: (t || `HTTP ${r.status}`).slice(0, 300) }); }
      } catch (e) { results.push({ branch_id: bid, ok: false, error: String((e && e.message) || e) }); }
    }

    // Best-effort history log (won't fail the send if the table is missing).
    try {
      await sbFetch("crm_broadcasts", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ branch_ids: branches, message: text, results, sent_by: body.sent_by || "", created_at: new Date().toISOString() }),
      });
    } catch {}

    const okCount = results.filter(r => r.ok).length;
    return res.status(200).json({ ok: okCount > 0, okCount, total: branches.length, results });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
