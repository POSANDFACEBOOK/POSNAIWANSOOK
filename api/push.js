// Web Push sender — called when a branch submits an order, to notify the Area Managers
// who cover that branch. Subscriptions live in the `push_subscriptions` table.
import webpush from "web-push";

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
// Public key is safe to expose; private MUST come from a Vercel env var.
const VAPID_PUBLIC  = process.env.VAPID_PUBLIC || "BILnJiPdqZ_-7I0uwEoYHWWwPoi_FL1NDG4GRXpv7OzG1edCFdxFgGzLQVkJ4hDisWr4nEgG_i9gRLSgMqS22JY";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE || "";

async function sbFetch(path, opts = {}) {
  // Hard timeout. A database in trouble does not answer with an error — it stops answering
  // at all, and fetch has no timeout of its own. Without this, a health alert raised while
  // the database is hanging would sit here until Vercel killed the function, so the one
  // alert that mattered most would be the one that never went out.
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), +opts.timeoutMs || 6000);
  try {
    const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
      ...opts,
      signal: ac.signal,
      headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (!r.ok) throw new Error(await r.text());
    const t = await r.text();
    return t ? JSON.parse(t) : [];
  } finally { clearTimeout(timer); }
}

// Recipients live in the database — the very thing that is broken when a health alert
// needs to go out. Vercel keeps a warm instance alive for minutes between calls, so the
// list fetched during normal traffic is usually still here when the database goes quiet.
// Not a guarantee (a cold start has no cache), but it turns "silent for certain" into
// "delivered most of the time" for free, with no extra storage.
let SUBS_CACHE = { at: 0, rows: null };
const SUBS_CACHE_TTL = 30 * 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  if (!VAPID_PRIVATE) return res.status(500).json({ error: "VAPID_PRIVATE not configured — set it in Vercel → Settings → Environment Variables" });
  try {
    let body = req.body || {};
    if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
    const branchId = +body.branch_id || null;
    const branchName = body.branchName || "สาขา";
    // scope 'admin' → only subscribers who cover EVERY branch (allowed_branches null).
    // Used by the database health alert: an infrastructure problem is the owner's to act
    // on, so it must not spam the area managers who only watch one branch.
    const adminOnly = body.scope === "admin";

    webpush.setVapidDetails("mailto:naiwansook@gmail.com", VAPID_PUBLIC, VAPID_PRIVATE);

    let subs, staleList = false;
    try {
      subs = await sbFetch("push_subscriptions?select=*");
      SUBS_CACHE = { at: Date.now(), rows: subs };
    } catch (e) {
      const fresh = SUBS_CACHE.rows && (Date.now() - SUBS_CACHE.at) < SUBS_CACHE_TTL;
      if (!fresh) throw e;          // no usable cache — nothing we can do but report it
      subs = SUBS_CACHE.rows; staleList = true;
    }
    // notify subscribers whose scope is "all" (allowed_branches null) or includes this branch
    const pick = (strictAdmin) => (subs || []).filter(s => {
      const ab = s.allowed_branches;
      if (ab == null) return true;
      if (strictAdmin) return false;
      try { const arr = Array.isArray(ab) ? ab : JSON.parse(ab); return arr.map(Number).includes(branchId); } catch { return true; }
    });
    let targets = pick(adminOnly);
    // ⚠️ ห้ามให้การเตือนเรื่องระบบล่มจบลงที่ "ผู้รับ 0 คน" อย่างเงียบๆ
    // 9 ก.ย. 69: ระบบล่มทั้งวัน ตัวเฝ้าจับได้ตั้งแต่ 07:42 และยิงเข้ามาที่นี่จริง
    // แต่ผู้ติดตามทั้ง 2 คนผูกกับสาขา ตัวกรอง admin จึงคัดออกหมด = ไม่มีใครได้รับอะไรเลย
    // เจ้าของรู้อีกทีตอนพนักงานเปิดร้านไม่ได้ · เตือนถึงคนผิดกลุ่ม ยังดีกว่าไม่ถึงใครเลย
    let widened = false;
    if (adminOnly && targets.length === 0) { targets = subs || []; widened = targets.length > 0; }
    // Default text is the order-approval alert the two original callers rely on; a caller
    // may override all three fields (health alerts do). Kept as an override rather than a
    // separate endpoint because the Vercel plan caps this project at 12 functions.
    // ระบบอนุมัติถูกปิดที่แอป (APPROVAL_ON=false ใน src/FoodCostApp.jsx) — ต้องปิดที่ปลายทางด้วย
    // เพราะเครื่องที่เปิดแอปค้างไว้ยังรันโค้ดชุดเก่าและยิงแจ้งเตือนชนิดนี้ต่อได้อีกเป็นวัน
    // ค่าที่ไม่ได้ส่ง title มาเอง = ตัวแจ้งเตือน "คำสั่งซื้อรออนุมัติ" ของเดิมเท่านั้น (ตัวอื่นส่ง title มาครบ)
    // เปิดระบบอนุมัติกลับมาเมื่อไหร่ ให้เปลี่ยนบรรทัดล่างเป็น true พร้อมกับธงในแอป
    const APPROVAL_PUSH_ON = false;
    if (!APPROVAL_PUSH_ON && !body.title) {
      return res.status(200).json({ skipped: true, reason: "ปิดระบบอนุมัติแล้ว — ไม่ส่งแจ้งเตือนรออนุมัติ" });
    }
    const payload = JSON.stringify({
      title: body.title || "🔔 คำสั่งซื้อรออนุมัติ",
      body:  body.body  || `${branchName} ส่งคำสั่งซื้อมารออนุมัติ`,
      url:   body.url   || "/?approve=1",
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
    return res.status(200).json({ ok: true, targets: targets.length, sent, removed, staleList, widened });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
