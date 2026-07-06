// LINE broadcast sender — pushes a text and/or image message to ALL friends of each
// selected branch's LINE Official Account via the Messaging API /message/broadcast.
//
// SECURITY:
//  • Channel access tokens are secrets → Vercel env LINE_TOKENS = JSON map
//    { "<branchId>": "<channelAccessToken>", ... }. Never in the repo/DB.
//  • Public endpoint → requires the shared secret BROADCAST_KEY (env), typed once in the app.
//
// Supports scheduling: if scheduled_at is in the future, the message is stored in
// crm_broadcasts with status 'scheduled' and sent later by /api/broadcast-cron.
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

// Build the LINE message array from text + optional image URL.
export function buildMessages(text, imageUrl) {
  const messages = [];
  if (imageUrl) messages.push({ type: "image", originalContentUrl: imageUrl, previewImageUrl: imageUrl });
  if (text) messages.push({ type: "text", text });
  return messages.slice(0, 5);
}

// Send one message-set to each branch's OA. Returns per-branch results.
export async function sendToBranches(branches, messages, tokens) {
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
  return results;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

    const KEY = process.env.BROADCAST_KEY || "";
    if (!KEY) return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า BROADCAST_KEY ใน Vercel → Environment Variables" });
    if ((body.key || "") !== KEY) return res.status(401).json({ error: "รหัสบรอดแคสต์ไม่ถูกต้อง" });

    const branches = Array.isArray(body.branches) ? body.branches.map(Number).filter(Boolean) : [];
    const text = (body.text || "").toString().trim();
    const imageUrl = (body.image_url || "").toString().trim() || null;
    const sentBy = body.sent_by || "";
    if (!branches.length) return res.status(400).json({ error: "ยังไม่ได้เลือกสาขา" });
    if (!text && !imageUrl) return res.status(400).json({ error: "ยังไม่ได้ใส่ข้อความหรือรูป" });
    if (text.length > 4900) return res.status(400).json({ error: "ข้อความยาวเกิน (สูงสุด ~5000 ตัวอักษร)" });

    // Scheduled for the future → store and let the cron send it later.
    const schedMs = body.scheduled_at ? Date.parse(body.scheduled_at) : NaN;
    if (schedMs && schedMs > Date.now() + 30000) {
      const row = await sbFetch("crm_broadcasts", {
        method: "POST", headers: { Prefer: "return=representation" },
        body: JSON.stringify({ branch_ids: branches, message: text, image_url: imageUrl, status: "scheduled", scheduled_at: new Date(schedMs).toISOString(), sent_by: sentBy, created_at: new Date().toISOString() }),
      });
      return res.status(200).json({ ok: true, scheduled: true, id: Array.isArray(row) ? row[0] && row[0].id : null });
    }

    // Send now.
    const messages = buildMessages(text, imageUrl);
    const results = await sendToBranches(branches, messages, tokenMap());
    try {
      await sbFetch("crm_broadcasts", {
        method: "POST", headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ branch_ids: branches, message: text, image_url: imageUrl, results, status: "sent", sent_by: sentBy, created_at: new Date().toISOString() }),
      });
    } catch {}
    const okCount = results.filter(r => r.ok).length;
    return res.status(200).json({ ok: okCount > 0, okCount, total: branches.length, results });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
