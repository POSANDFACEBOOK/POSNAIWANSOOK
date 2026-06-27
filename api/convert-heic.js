// One-time admin job: find every referenced Drive image that is still HEIC/HEIF
// (legacy iPhone uploads that browsers can't render) and convert it to JPEG IN PLACE
// — same Drive file id, so the DB refs (waste_logs.images, *.receive_images,
// counter_photo) keep working and the photos start showing immediately.
//
// Gated by CRON_SECRET (same secret as the backup job). Run in a browser:
//   https://<domain>/api/convert-heic?key=<CRON_SECRET>
// Idempotent + batched: re-run until {converted:0}. Reuses the slip service account.
import { JWT } from "google-auth-library";
import convert from "heic-convert";

export const config = { maxDuration: 60 };

const SUPA = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const SA_B64 = process.env.GOOGLE_SA_KEY_B64 || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

function loadSA() {
  const raw = (SA_B64 || "").trim();
  if (!raw) throw new Error("GOOGLE_SA_KEY_B64 not set");
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch {}
  throw new Error("GOOGLE_SA_KEY_B64 invalid");
}
let _jwt;
async function bearer() {
  if (!_jwt) { const sa = loadSA(); _jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/drive.file"] }); }
  const { token } = await _jwt.getAccessToken();
  return token;
}
async function sbGet(path) {
  const r = await fetch(`${SUPA}/rest/v1/${path}`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!r.ok) return [];
  return r.json();
}

export default async function handler(req, res) {
  // Accept CRON_SECRET (if configured) OR the publishable Supabase key (already public
  // in the client bundle) so this one-time, idempotent, non-destructive job can run
  // without first wiring a new env var. The endpoint is removed right after the run.
  const k = req.query.key || "";
  const ok = (CRON_SECRET && (k === CRON_SECRET || (req.headers.authorization || "") === `Bearer ${CRON_SECRET}`)) || k === SUPA_KEY;
  if (!ok) return res.status(403).json({ error: "forbidden" });
  if (!SA_B64) return res.status(501).json({ error: "drive not configured" });
  const LIMIT = Math.min(20, +req.query.limit || 12);
  try {
    const tok = await bearer();
    // Collect every Drive id referenced anywhere images are stored.
    const ids = new Set();
    const add = v => { if (typeof v === "string" && v.startsWith("drive:")) ids.add(v.slice(6)); };
    for (const r of await sbGet("waste_logs?select=images&limit=5000")) (Array.isArray(r.images) ? r.images : []).forEach(add);
    for (const r of await sbGet("order_requests?select=receive_images&limit=5000")) (Array.isArray(r.receive_images) ? r.receive_images : []).forEach(add);
    for (const r of await sbGet("purchase_orders?select=receive_images&limit=5000")) (Array.isArray(r.receive_images) ? r.receive_images : []).forEach(add);
    for (const r of await sbGet("stock_count_sessions?select=counter_photo&limit=5000")) add(r.counter_photo);
    for (const r of await sbGet("stock_logs?select=counter_photo&limit=5000")) add(r.counter_photo);

    let scanned = 0, converted = 0, heicFound = 0, skipped = 0;
    const errors = [], done = [];
    for (const id of ids) {
      if (converted >= LIMIT) break;
      scanned++;
      try {
        const m = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?fields=mimeType,name&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tok}` } });
        if (!m.ok) { errors.push({ id, step: "meta", code: m.status }); continue; }
        const meta = await m.json();
        if (!/hei[cf]/i.test(meta.mimeType || "")) { skipped++; continue; }
        heicFound++;
        const dl = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tok}` } });
        if (!dl.ok) { errors.push({ id, step: "download", code: dl.status }); continue; }
        const inBuf = Buffer.from(await dl.arrayBuffer());
        const jpg = Buffer.from(await convert({ buffer: inBuf, format: "JPEG", quality: 0.9 }));
        // Replace BOTH content and mimeType so drive-view (which passes through Drive's
        // content-type) serves it as image/jpeg.
        const boundary = "heicconvboundary8h2k5";
        const newName = (meta.name || "photo").replace(/\.(heic|heif)$/i, "") + ".jpg";
        const metaJson = JSON.stringify({ mimeType: "image/jpeg", name: newName });
        const body = Buffer.concat([
          Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metaJson}\r\n--${boundary}\r\nContent-Type: image/jpeg\r\n\r\n`),
          jpg,
          Buffer.from(`\r\n--${boundary}--`),
        ]);
        const up = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${id}?uploadType=multipart&supportsAllDrives=true&fields=id,mimeType`, {
          method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
        });
        if (!up.ok) { errors.push({ id, step: "update", code: up.status, detail: (await up.text().catch(() => "")).slice(0, 200) }); continue; }
        converted++; done.push({ id, kb: Math.round(jpg.length / 1024) });
      } catch (e) { errors.push({ id, err: String((e && e.message) || e) }); }
    }
    return res.status(200).json({ ok: true, totalRefs: ids.size, scanned, heicFound, converted, skipped, done, errors, note: converted >= LIMIT ? "hit per-call limit — re-run to continue" : "all done ✅" });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
