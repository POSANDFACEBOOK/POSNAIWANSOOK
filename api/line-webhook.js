// LINE webhook — the "bot" side of each branch's Official Account.
//
// One serverless endpoint serves EVERY branch OA; each OA points its webhook at
//   https://<host>/api/line-webhook?b=<branchId>
// so we know which channel (token + secret) to use. Set that URL in each OA's
// LINE Developers console (Messaging API → Webhook URL) and turn "Use webhook" on.
//
// SECRETS (Vercel → Environment Variables, JSON maps keyed by branchId):
//   LINE_TOKENS  = { "6": "<channel access token>", ... }   (already used by broadcast — for replying)
//   LINE_SECRETS = { "6": "<channel secret>", ... }          (NEW — to verify the x-line-signature)
// Never put these in the repo/DB.
//
// What it does now (v1): verifies the signature, captures the customer's userId
// (best-effort, for future push), and on follow / a menu keyword / a postback it
// replies with a Flex "menu" card whose buttons deep-link to the existing ?join= web
// pages (จองโต๊ะ / สมัคร-สะสมแต้ม / ข้อมูลสาขา). More cards can be added later.
import crypto from "crypto";

export const config = { api: { bodyParser: false } }; // need the RAW body for signature verification

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const PUBLIC_BASE = "https://foodcost-eta.vercel.app";

const jmap = (v) => { try { return JSON.parse(v || "{}"); } catch { return {}; } };
const tokens = () => jmap(process.env.LINE_TOKENS);
const secrets = () => jmap(process.env.LINE_SECRETS);

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
  try { const b = await sb(`branches?id=eq.${encodeURIComponent(bid)}&select=name`); return (b[0] && b[0].name) || "ร้านเรา"; }
  catch { return "ร้านเรา"; }
}

// Best-effort: remember this follower's userId so we can push cards to them later.
// Silently no-ops if the crm_line_users table doesn't exist yet.
async function storeUser(bid, userId) {
  if (!userId) return;
  try {
    await sb(`crm_line_users?on_conflict=branch_id,line_user_id`, {
      method: "POST",
      headers: { Prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify({ branch_id: Number(bid) || null, line_user_id: userId, created_at: new Date().toISOString() }),
    });
  } catch { /* table not created / already exists — ignore */ }
}

function menuFlex(bid, branchName) {
  const join = `${PUBLIC_BASE}/?join=1&branch=${encodeURIComponent(bid)}`;
  return {
    type: "flex",
    altText: `เมนูบริการ — ${branchName}`,
    contents: {
      type: "bubble",
      body: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "text", text: branchName, weight: "bold", size: "lg", wrap: true, color: "#0F172A" },
          { type: "text", text: "เลือกบริการที่ต้องการได้เลยค่ะ 😊", size: "sm", color: "#94A3B8", wrap: true, margin: "sm" },
        ],
      },
      footer: {
        type: "box", layout: "vertical", spacing: "sm", contents: [
          { type: "button", style: "primary", height: "sm", color: "#FF6B35", action: { type: "uri", label: "📅 จองโต๊ะ", uri: `${join}&go=book` } },
          { type: "button", style: "primary", height: "sm", color: "#10B981", action: { type: "uri", label: "⭐ สมัคร / สะสมแต้ม", uri: `${join}&go=join` } },
          { type: "button", style: "secondary", height: "sm", action: { type: "uri", label: "📍 ข้อมูลสาขา", uri: join } },
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

// Reply the menu only on a follow, a postback, or a menu-ish keyword — so the bot never
// talks over a human admin who is chatting with the customer.
const MENU_RE = /(เมนู|menu|จอง|สมัคร|แต้ม|สะสม|สาขา|ข้อมูล|สวัสดี|hello|hi)/i;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).end("POST only"); }
  const bid = String((req.query && (req.query.b || req.query.branch)) || "").trim();
  const raw = await readRaw(req);

  // Verify the LINE signature with THIS branch's channel secret. If no secret is configured
  // we still 200 (so the webhook "verify" button passes) but do nothing — configure LINE_SECRETS.
  const secret = secrets()[bid];
  if (secret) {
    const expected = crypto.createHmac("sha256", secret).update(raw).digest("base64");
    if (expected !== (req.headers["x-line-signature"] || "")) return res.status(401).end("bad signature");
  }

  let body = {}; try { body = JSON.parse(raw || "{}"); } catch {}
  const events = Array.isArray(body.events) ? body.events : []; // empty on LINE's webhook-verify ping
  const token = tokens()[bid];
  let branchName = null;

  for (const ev of events) {
    try {
      const uid = ev.source && ev.source.userId;
      if (uid) storeUser(bid, uid).catch(() => {});
      const isFollow = ev.type === "follow";
      const isPostback = ev.type === "postback";
      const isMenuText = ev.type === "message" && ev.message && ev.message.type === "text" && MENU_RE.test(ev.message.text || "");
      if ((isFollow || isPostback || isMenuText) && ev.replyToken && token) {
        if (branchName == null) branchName = await branchNameOf(bid);
        await reply(token, ev.replyToken, [menuFlex(bid, branchName)]);
      }
    } catch (e) { console.error("event error", e && e.message); }
  }
  return res.status(200).json({ ok: true });
}
