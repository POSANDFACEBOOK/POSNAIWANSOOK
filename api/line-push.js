// Push a Flex card to ONE customer's LINE userId — e.g. a booking-confirmation card sent
// after an admin confirms the reservation in the app. Uses the SAME main-OA credentials as
// the webhook (issues a token from LINE_BOT_ID + LINE_BOT_SECRET, no Developers Console).
//
// Gated by the shared BROADCAST_KEY (same secret the broadcast tool uses) so the public
// endpoint can't be abused. The app sends { key, userId, kind:"booking_confirm", data:{...} }.
const jmap = (v) => { try { return JSON.parse(v || "{}"); } catch { return {}; } };

let _tok = null, _tokExp = 0;
async function issueToken(id, secret) {
  const now = Date.now();
  if (_tok && now < _tokExp) return _tok;
  try {
    const r = await fetch("https://api.line.me/v2/oauth/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: `grant_type=client_credentials&client_id=${encodeURIComponent(id)}&client_secret=${encodeURIComponent(secret)}`,
    });
    if (!r.ok) { console.error("token issue failed", r.status); return ""; }
    const j = await r.json();
    _tok = j.access_token; _tokExp = now + 25 * 60 * 1000;
    return _tok;
  } catch { return ""; }
}
async function getToken(bid) {
  const perBranch = bid && jmap(process.env.LINE_TOKENS)[bid];
  if (perBranch) return perBranch;
  if (process.env.LINE_BOT_TOKEN) return process.env.LINE_BOT_TOKEN;
  const id = process.env.LINE_BOT_ID, secret = process.env.LINE_BOT_SECRET;
  if (id && secret) return await issueToken(id, secret);
  return "";
}

function field(label, value) {
  return {
    type: "box", layout: "vertical", spacing: "none", margin: "md", contents: [
      { type: "text", text: label, size: "xs", color: "#94A3B8" },
      { type: "text", text: String(value == null || value === "" ? "-" : value), size: "md", color: "#0F172A", weight: "bold", wrap: true },
    ],
  };
}
function bookingConfirmFlex(d) {
  d = d || {};
  const rows = [];
  if (d.name) rows.push(field("ผู้รับบริการ", d.name));
  if (d.branch_name) rows.push(field("สาขา", d.branch_name));
  if (d.when) rows.push(field("วันที่ - เวลา", d.when));
  if (d.party_size) rows.push(field("จำนวนที่นั่ง", `${d.party_size} ท่าน`));
  if (d.note) rows.push(field("หมายเหตุ", d.note));
  if (!rows.length) rows.push(field("รายละเอียด", "-"));
  return {
    type: "flex",
    altText: "ยืนยันการจองโต๊ะ",
    contents: {
      type: "bubble",
      header: {
        type: "box", layout: "vertical", backgroundColor: "#FF6B35", paddingAll: "18px", contents: [
          { type: "text", text: "✅ ยืนยันการจองโต๊ะ", color: "#ffffff", weight: "bold", size: "xl", align: "center", wrap: true },
          { type: "text", text: "NAIWANSOOK 🍲 ชาบู · หมูกระทะ", color: "#ffffff", size: "sm", align: "center", margin: "sm" },
        ],
      },
      body: { type: "box", layout: "vertical", contents: rows },
      footer: {
        type: "box", layout: "vertical", contents: [
          { type: "text", text: "ขอบคุณที่ใช้บริการค่ะ 🙏 แล้วพบกันนะคะ", size: "xs", color: "#94A3B8", align: "center", wrap: true },
        ],
      },
    },
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }

  const KEY = process.env.BROADCAST_KEY || "";
  if (!KEY) return res.status(500).json({ error: "ยังไม่ได้ตั้งค่า BROADCAST_KEY ใน Vercel" });
  if ((body.key || "") !== KEY) return res.status(401).json({ error: "รหัสไม่ถูกต้อง" });

  const userId = (body.userId || "").toString().trim();
  if (!userId) return res.status(400).json({ error: "ไม่มี userId ของลูกค้า (ลูกค้ายังไม่เคยทักบอท)" });

  const token = await getToken(String(body.branch_id || "").trim());
  if (!token) return res.status(500).json({ error: "ตั้งค่า LINE token ไม่ครบ (ต้องมี LINE_BOT_ID + LINE_BOT_SECRET)" });

  // Only the booking-confirmation card is allowed. The app never sends a free-text push through
  // this endpoint, so refusing everything else removes an abusable arbitrary-message path while
  // still being gated by BROADCAST_KEY.
  const kind = body.kind || "booking_confirm";
  if (kind !== "booking_confirm") return res.status(400).json({ error: "kind ไม่รองรับ (booking_confirm เท่านั้น)" });
  const messages = [bookingConfirmFlex(body.data)];

  try {
    const r = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ to: userId, messages }),
    });
    const t = await r.text();
    if (!r.ok) return res.status(r.status).json({ ok: false, error: (t || `HTTP ${r.status}`).slice(0, 300) });
    return res.status(200).json({ ok: true });
  } catch (e) {
    return res.status(502).json({ ok: false, error: String((e && e.message) || e) });
  }
}
