// Monthly data backup → gzipped JSON in the company Google Shared Drive.
// Dumps the core Supabase tables, gzips them, and uploads as
// foodcost-backup-YYYY-MM-DD.json.gz into the same Shared Drive as the slips.
//
// Triggered by Vercel Cron (monthly, see vercel.json) which sends
// Authorization: Bearer <CRON_SECRET>. Can also be run manually in a browser:
//   https://<domain>/api/backup?key=<CRON_SECRET>
// Reuses the slip service account (GOOGLE_SA_KEY_B64 + DRIVE_FOLDER_ID). Add a
// CRON_SECRET env var in Vercel so the endpoint can't be triggered by outsiders.
import { JWT } from "google-auth-library";
import { gzipSync } from "zlib";

export const config = { maxDuration: 60 };

const SUPA = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const SA_B64 = process.env.GOOGLE_SA_KEY_B64 || "";
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

// Core business tables (names taken from the app's actual queries). push_subscriptions
// is intentionally excluded (ephemeral device tokens, regenerable).
const TABLES = [
  "branches", "app_users", "suppliers", "categories", "ingredients", "menus", "assets",
  "order_requests", "purchase_orders", "orders", "external_sales", "cost_snapshots",
  "cost_history", "action_history", "crm_customers", "crm_transactions", "crm_vouchers",
  "crm_feedback", "crm_reservations", "pos_shifts", "cash_movements", "expense_categories",
  "table_zones", "tables", "pos_settings", "promotions", "printers", "approval_log",
];

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
async function fetchTable(t) {
  try {
    const r = await fetch(`${SUPA}/rest/v1/${t}?select=*&limit=100000`, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
    if (!r.ok) return { t, rows: [], err: `${r.status}` };
    const rows = await r.json();
    return { t, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) { return { t, rows: [], err: String(e.message || e) }; }
}

export default async function handler(req, res) {
  if (!CRON_SECRET) return res.status(501).json({ error: "CRON_SECRET not configured — add it in Vercel env" });
  const auth = req.headers.authorization || "";
  if (auth !== `Bearer ${CRON_SECRET}` && req.query.key !== CRON_SECRET) return res.status(403).json({ error: "forbidden" });
  if (!SA_B64 || !FOLDER_ID) return res.status(501).json({ error: "drive not configured" });
  try {
    const results = await Promise.all(TABLES.map(fetchTable));
    const data = { generated_at: new Date().toISOString(), source: "naiwansook-foodcost", tables: {} };
    const summary = {}; let totalRows = 0;
    for (const r of results) { data.tables[r.t] = r.rows; summary[r.t] = r.err ? `ERR ${r.err}` : r.rows.length; totalRows += r.rows.length; }
    const gz = gzipSync(Buffer.from(JSON.stringify(data)));
    const date = new Date().toISOString().slice(0, 10);
    const name = `foodcost-backup-${date}.json.gz`;
    const tok = await bearer();
    const boundary = "fcbackupboundary8h2k5";
    const meta = JSON.stringify({ name, parents: [FOLDER_ID] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`),
      gz,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const up = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
      method: "POST", headers: { Authorization: `Bearer ${tok}`, "Content-Type": `multipart/related; boundary=${boundary}` }, body,
    });
    const ud = await up.json().catch(() => ({}));
    if (!up.ok) return res.status(up.status).json({ error: "drive upload failed", detail: ud, summary });
    return res.status(200).json({ ok: true, file: name, driveId: ud.id, sizeKB: Math.round(gz.length / 1024), totalRows, summary });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
