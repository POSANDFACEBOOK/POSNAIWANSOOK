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
          { type: "button", style: "primary", height: "sm", color: "#FF6B35", action: { type: "uri", label: "📅 จองโต๊ะ", uri: `${base}&go=book` } },
          { type: "button", style: "primary", height: "sm", color: "#10B981", action: { type: "uri", label: "⭐ สมัคร / สะสมแต้ม", uri: `${base}&go=join` } },
          { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "📍 ข้อมูลสาขา", uri: base } },
        ],
      },
    },
  };
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
  const token = (bid && jmap(process.env.LINE_TOKENS)[bid]) || process.env.LINE_BOT_TOKEN || "";

  // Verify the LINE signature. If no secret is configured we still 200 (so the console's
  // "Verify" passes) but do nothing — set LINE_BOT_SECRET to activate.
  if (secret) {
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    if (expected !== (req.headers["x-line-signature"] || "")) return res.status(401).end("bad signature");
  }

  let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
  const events = Array.isArray(body.events) ? body.events : []; // empty on LINE's webhook-verify ping
  let title = null;

  for (const ev of events) {
    try {
      const uid = ev.source && ev.source.userId;
      if (uid) storeUser(bid, uid).catch(() => {});
      const isFollow = ev.type === "follow";
      const isPostback = ev.type === "postback";
      const isMenuText = ev.type === "message" && ev.message && ev.message.type === "text" && MENU_RE.test((ev.message.text || "").trim());
      if ((isFollow || isPostback || isMenuText) && ev.replyToken && token) {
        if (title == null) title = bid ? await branchNameOf(bid) : BRAND;
        await reply(token, ev.replyToken, [menuFlex(bid, title)]);
      }
    } catch (e) { console.error("event error", e && e.message); }
  }
  return res.status(200).json({ ok: true });
}
