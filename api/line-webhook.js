// LINE webhook — the "bot" side of the ONE main LINE Official Account.
//
// Single-OA setup (what the owner uses): set the OA's Webhook URL to
//   https://<host>/api/line-webhook
// and provide its credentials as Vercel env:
//   LINE_BOT_TOKEN  = <channel access token>   (to reply / push)
//   LINE_BOT_SECRET = <channel secret>          (to verify the x-line-signature)
// Also turn "Use webhook" ON and turn the OA's auto-reply OFF (Official Account Manager),
// so the bot's replies aren't blocked.
//
// (Optional per-branch mode is still supported: append ?b=<branchId> and set the JSON maps
//  LINE_TOKENS / LINE_SECRETS keyed by branchId — the single-OA path above takes precedence
//  whenever ?b= is absent.)
//
// v1 behaviour: verify signature, remember the follower's userId (crm_line_users, best-effort,
// for future push), and on follow / a menu keyword / a postback reply with a Flex "menu" card
// whose buttons deep-link to the existing ?join= web pages. With one OA there is no branch
// context, so the card sends the customer to the branch picker first (or straight to the
// booking/points screen once they pick a branch).
import crypto from "crypto";

export const config = { api: { bodyParser: false } }; // need the RAW body for signature verification

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const PUBLIC_BASE = "https://foodcost-eta.vercel.app";
const BRAND = "NAIWANSOOK 🍲 ชาบู · หมูกระทะ";

const jmap = (v) => { try { return JSON.parse(v || "{}"); } catch { return {}; } };

function readRaw(req) {
  return new Promise((resolve, reject) => {
    let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => resolve(d)); req.on("error", reject);
  });
}

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : [];
}

async function branchNameOf(bid) {
  try { const b = await sb(`branches?id=eq.${encodeURIComponent(bid)}&select=name`); return (b[0] && b[0].name) || BRAND; }
  catch { return BRAND; }
}

// Best-effort: remember this follower's userId so we can push cards to them later.
// Silently no-ops if the crm_line_users table doesn't exist yet.
async function storeUser(bid, userId) {
  if (!userId) return;
  try {
    await sb(`crm_line_users?on_conflict=branch_id,line_user_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ branch_id: bid ? Number(bid) : null, line_user_id: userId, created_at: new Date().toISOString() }),
    });
  } catch { /* table missing / duplicate — ignore */ }
}

// Fetch the customer's LINE display name (for the booking request + confirmation card).
async function getProfile(token, userId) {
  try {
    const r = await fetch(`https://api.line.me/v2/bot/profile/${encodeURIComponent(userId)}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!r.ok) return null;
    return await r.json(); // { displayName, pictureUrl, ... }
  } catch { return null; }
}

async function getBranches() {
  try { return await sb(`branches?type=neq.central&select=id,name,active,address,map_url,open_hours,phone,line_url&order=id.asc`); }
  catch { return []; }
}

// Build a safe URI-action button, or null if the URI can't be made valid. LINE rejects the
// ENTIRE message (HTTP 400) if any one button's uri is malformed, so a bad field must drop only
// its own button — never the whole carousel. Callers pass a `tel:`-prefixed string for phones
// and raw links (with or without scheme) for maps / LINE.
function uriButton(label, rawUri, style, color) {
  let uri = String(rawUri || "").trim();
  if (!uri) return null;
  if (/^tel:/i.test(uri)) {
    const digits = uri.replace(/[^0-9+]/g, "");
    if (!/\d/.test(digits)) return null;        // "-" / "ไม่มี" → no digits → drop button
    uri = "tel:" + digits;
  } else if (!/^(https?|line):/i.test(uri)) {
    uri = "https://" + uri.replace(/^\/+/, ""); // scheme-less link (maps.app.goo.gl/…) → https
  }
  if (!/^(https?|tel|line):.+/i.test(uri)) return null;
  const btn = { type: "button", height: "sm", style: style || "secondary", action: { type: "uri", label, uri } };
  if (color) btn.color = color;
  return btn;
}

// A customer tapped "จองโต๊ะ": record a lightweight request (admin fills branch/date & confirms
// later, then pushes the confirmation card). Silent no-op if the table isn't created yet.
async function createBookingRequest(userId, name) {
  try {
    await sb(`crm_booking_requests`, {
      method: "POST", headers: { Prefer: "return=minimal" },
      body: JSON.stringify({ line_user_id: userId, customer_name: name || null, status: "requested", created_at: new Date().toISOString() }),
    });
    return true;
  } catch (e) { console.error("booking request insert failed", e && e.message); return false; }
}

function branchesCarousel(branches) {
  const bubbles = (branches || []).filter((b) => b && b.active !== false).slice(0, 11).map((b) => {
    const body = [{ type: "text", text: b.name || "สาขา", weight: "bold", size: "lg", wrap: true, color: "#0F172A" }];
    if (b.address) body.push({ type: "text", text: `📍 ${b.address}`, size: "sm", color: "#64748B", wrap: true, margin: "sm" });
    if (b.open_hours) body.push({ type: "text", text: `🕒 ${b.open_hours}`, size: "sm", color: "#64748B", wrap: true });
    if (b.phone) body.push({ type: "text", text: `📞 ${b.phone}`, size: "sm", color: "#64748B", wrap: true });
    const footer = [
      uriButton("🗺️ ดูแผนที่", b.map_url, "primary", "#FF6B35"),
      uriButton("📞 โทร", b.phone ? `tel:${b.phone}` : "", "secondary"),
      uriButton("➕ แอดไลน์สาขา", b.line_url, "secondary"),
    ].filter(Boolean);
    return { type: "bubble", size: "kilo", body: { type: "box", layout: "vertical", spacing: "sm", contents: body }, ...(footer.length ? { footer: { type: "box", layout: "vertical", spacing: "sm", contents: footer } } : {}) };
  });
  if (!bubbles.length) return { type: "text", text: "ยังไม่มีข้อมูลสาขาในระบบค่ะ 🙏 (แอดมินยังไม่ได้กรอก)" };
  return { type: "flex", altText: "ข้อมูลสาขา", contents: { type: "carousel", contents: bubbles } };
}

function menuFlex(bid, title) {
  // With one OA (no branch) the base has no &branch, so the web page shows the branch picker
  // first; ?go=book|join is honoured the moment the customer picks a branch.
  const base = `${PUBLIC_BASE}/?join=1${bid ? `&branch=${encodeURIComponent(bid)}` : ""}`;
  return {
    type: "flex",
    altText: `เมนูบริการ — ${title}`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "text", text: title, weight: "bold", size: "lg", wrap: true, color: "#0F172A" },
          { type: "text", text: "เลือกบริการที่ต้องการได้เลยค่ะ 😊", size: "sm", color: "#94A3B8", wrap: true, margin: "sm" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "button", style: "primary", height: "sm", color: "#FF6B35", action: { type: "postback", label: "📅 จองโต๊ะ", data: "action=book", displayText: "ขอจองโต๊ะค่ะ" } },
          { type: "button", style: "primary", height: "sm", color: "#10B981", action: { type: "uri", label: "⭐ สมัคร / สะสมแต้ม", uri: `${base}&go=join` } },
          { type: "button", style: "secondary", height: "sm", action: { type: "postback", label: "📍 ข้อมูลสาขา", data: "action=branches", displayText: "ขอดูข้อมูลสาขา" } },
        ],
      },
    },
  };
}

// Resolve a channel access token for replying. Priority:
//   1) per-branch LINE_TOKENS[bid] (multi-OA mode)
//   2) a static long-lived LINE_BOT_TOKEN (if you issued one in the Developers Console)
//   3) issue a short-lived v2.0 token from LINE_BOT_ID + LINE_BOT_SECRET on the fly — so you
//      only need the Channel ID + Channel secret shown right in OA Manager, NO Developers
//      Console access required. Cached ~25 min across warm invocations.
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
    if (!r.ok) { console.error("token issue failed", r.status, (await r.text()).slice(0, 200)); return ""; }
    const j = await r.json();
    _tok = j.access_token; _tokExp = now + 25 * 60 * 1000;
    return _tok;
  } catch (e) { console.error("token issue error", e && e.message); return ""; }
}
async function resolveToken(bid) {
  const perBranch = bid && jmap(process.env.LINE_TOKENS)[bid];
  if (perBranch) return perBranch;
  if (process.env.LINE_BOT_TOKEN) return process.env.LINE_BOT_TOKEN;
  const id = process.env.LINE_BOT_ID, secret = process.env.LINE_BOT_SECRET;
  if (id && secret) return await issueToken(id, secret);
  return "";
}
async function reply(token, replyToken, messages) {
  const r = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ replyToken, messages }),
  });
  if (!r.ok) console.error("LINE reply failed", r.status, (await r.text()).slice(0, 300));
}

// Reply ONLY when the whole message is the trigger word (with an optional polite particle) —
// on a LIVE OA with human admins we must NOT interject when a customer types "จอง"/"สวัสดี"
// etc. inside a normal conversation. Only follow / postback / an exact "เมนู" trigger the card.
const MENU_RE = /^(เมนู|เมนูบริการ|menu|เริ่ม|เริ่มต้น|start)\s*(ค่ะ|คะ|ครับ|คับ|จ้า|จ้ะ|ๆ|!|\.)*$/i;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end("POST only"); }
  const bid = String((req.query && (req.query.b || req.query.branch)) || "").trim();
  const raw = await readRaw(req);

  // Single main OA by default (LINE_BOT_*). Per-branch only if ?b= maps to a configured channel.
  const secret = (bid && jmap(process.env.LINE_SECRETS)[bid]) || process.env.LINE_BOT_SECRET || "";

  // Verify the LINE signature. If no secret is configured we still 200 (so the console's
  // "Verify" passes) but do nothing — set LINE_BOT_SECRET to activate.
  if (secret) {
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    if (expected !== (req.headers["x-line-signature"] || "")) return res.status(401).end("bad signature");
  }

  let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
  const events = Array.isArray(body.events) ? body.events : []; // empty on LINE's webhook-verify ping
  let title = null, token = null;

  const menu = async (rt) => { if (title == null) title = bid ? await branchNameOf(bid) : BRAND; await reply(token, rt, [menuFlex(bid, title)]); };

  for (const ev of events) {
    try {
      const uid = ev.source && ev.source.userId;
      if (uid) storeUser(bid, uid).catch(() => {});
      const rt = ev.replyToken;
      if (!rt) continue;
      const isMenuText = ev.type === "message" && ev.message && ev.message.type === "text" && MENU_RE.test((ev.message.text || "").trim());
      if (!(ev.type === "follow" || ev.type === "postback" || isMenuText)) continue; // ignore everything else (admin chats etc.)
      if (token === null) token = await resolveToken(bid);
      if (!token) continue;
      if (ev.type === "postback") {
        const data = (ev.postback && ev.postback.data) || "";
        if (/(^|&)action=book(&|$)/.test(data)) {
          const prof = uid ? await getProfile(token, uid) : null;
          const name = (prof && prof.displayName) || null;
          const ok = uid ? await createBookingRequest(uid, name) : false;
          await reply(token, rt, [{ type: "text", text: ok
            ? `รับเรื่องจองโต๊ะแล้วค่ะ 🙏\nแอดมินจะติดต่อยืนยัน (สาขา / วันเวลา) ให้เร็ว ๆ นี้นะคะ`
            : `ขออภัยค่ะ ระบบจองยังไม่พร้อมชั่วคราว 🙏\nรบกวนพิมพ์แชทแจ้งแอดมินได้เลย หรือกดเมนู "ข้อมูลสาขา" เพื่อโทรจองกับสาขาโดยตรงนะคะ` }]);
        } else if (/(^|&)action=branches(&|$)/.test(data)) {
          await reply(token, rt, [branchesCarousel(await getBranches())]);
        } else {
          await menu(rt);
        }
      } else {
        await menu(rt); // follow or "เมนู"
      }
    } catch (e) { console.error("event error", e && e.message); }
  }
  return res.status(200).json({ ok: true });
}
