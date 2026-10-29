// Dispatches scheduled LINE broadcasts whose time has come. Triggered by:
//  • Vercel cron (vercel.json) — sends Authorization: Bearer <CRON_SECRET> when CRON_SECRET is set
//  • an external cron / the app heartbeat — pass ?key=<BROADCAST_KEY>
// Claims each row (status scheduled → sending) before sending so overlapping runs never double-send.
import crypto from "crypto";

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
// 28 ต.ค. 69: สำเนาของ broadcastSig ใน api/line-broadcast.js (ต้องตรงกันทุกตัวอักษร — มีด่านตรวจ)
// แถว scheduled ที่ไม่มีลายเซ็นที่ลงด้วย BROADCAST_KEY = ไม่ได้มาจากปุ่มตั้งเวลาในระบบ (เพิ่ม/แก้ตรงในตาราง) → ไม่ส่ง
function broadcastSig(key, row) {
  const r = row || {};
  const ms = r.scheduled_at ? new Date(r.scheduled_at).getTime() : NaN;
  const ids = (Array.isArray(r.branch_ids) ? r.branch_ids : []).map(Number).join(",");
  const msg = [r.id, r.message || "", r.image_url || "", ids, Number.isFinite(ms) ? new Date(ms).toISOString() : ""].join("|");
  return crypto.createHmac("sha256", String(key)).update(msg, "utf8").digest("hex");
}
function sigOk(key, row) {
  if (!key || !row) return false;
  const want = Buffer.from(broadcastSig(key, row)), got = Buffer.from(String(row.sig || ""));
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}
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
    const dueQ = `status=eq.scheduled&scheduled_at=lte.${encodeURIComponent(nowIso)}&order=scheduled_at.asc&limit=20`;
    // 29 ต.ค. 69: แยกช่องส่ง (มีลายเซ็น) ออกจากช่องปิดแถวไม่มีลายเซ็น — เดิม limit=20 ช่องเดียว
    // แถวตายที่ปิดเป็น rejected ไม่ได้ (เช่น CHECK ของ status) 20 แถว = รอบไหนก็หยิบได้แต่แถวตาย แถวที่ลงชื่อถูกไม่มีวันถึงคิว
    // ยังไม่ได้รัน sql/broadcast-sig.sql = ไม่มีคอลัมน์ sig ⟹ กรองด้วย sig แล้วได้ 42703 → ใช้คำค้นเดิม
    // (ตอนนั้นไม่มีแถวไหนมีลายเซ็นอยู่แล้ว ทุกแถวถูกปิดเป็น rejected ไม่ส่ง เหมือนเดิม) · error อื่นโยนต่อตามเดิม
    let due, dead = [];
    try { due = await sbFetch(`crm_broadcasts?sig=not.is.null&${dueQ}`); }
    catch (e) { if (!/42703/.test(String((e && e.message) || e))) throw e; due = null; }
    if (due) { try { dead = await sbFetch(`crm_broadcasts?sig=is.null&select=id,branch_ids&${dueQ}`); } catch {} }
    else due = await sbFetch(`crm_broadcasts?${dueQ}`);
    const tokens = tokenMap();
    let processed = 0, rejected = 0;
    for (const b of [...(due || []), ...(dead || [])]) {
      // ลายเซ็นไม่ตรง → ปิดแถวเป็น rejected ไม่ส่ง (ตัวกรอง status=eq.scheduled = จองแบบเดียวกับข้างล่าง)
      // ไม่ปล่อยค้างเป็น scheduled ให้ทุกรอบหยิบซ้ำ · ไม่มี BROADCAST_KEY = ตรวจไม่ได้ = ไม่ส่ง
      if (!sigOk(KEY, b)) {
        const bids = Array.isArray(b.branch_ids) ? b.branch_ids.map(Number).filter(Boolean) : [];
        const why = "ไม่ส่ง — ลายเซ็นไม่ตรง (ไม่ได้ตั้งเวลาจากระบบ หรือถูกแก้หลังตั้ง)";
        try { await sbFetch(`crm_broadcasts?id=eq.${b.id}&status=eq.scheduled`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ status: "rejected", results: bids.map((bid) => ({ branch_id: bid, ok: false, error: why })) }) }); } catch {}
        rejected++;
        continue;
      }
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
    return res.status(200).json({ ok: true, processed, rejected });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
