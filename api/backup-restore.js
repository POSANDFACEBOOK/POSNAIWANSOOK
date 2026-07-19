// Owner-facing RESTORE from a Drive backup — the safe, self-serve half of disaster recovery.
//
// HARD SAFETY CONTRACT (this endpoint can only ever ADD rows to EMPTY tables):
//   • Never DELETEs or TRUNCATEs anything, ever.
//   • Writes a table ONLY when its LIVE row count is 0 (empty-only, enforced server-side inside
//     the restore_table RPC transaction). A table that already has data is left untouched.
//   • A table that is PARTIALLY filled (0 < live < backup) is NOT written and NOT called done —
//     it is flagged for manual repair, so a half-finished prior restore can never be mistaken
//     for complete (no silent stock/ledger loss).
//   • Each table is restored by ONE atomic RPC call (all-or-nothing) that preserves original ids
//     via OVERRIDING SYSTEM VALUE — required because several tables use GENERATED ALWAYS identity
//     and PostgREST alone cannot restore their ids (which every foreign key depends on).
//   • Dry-run by default; applying requires a typed confirm token exactly === `RESTORE <fileName>`.
//   • Refuses any backup not marked status:"success"; skips tables stored as null (not read).
//   • Inserts in FK parent-first order. `backups` (audit) is never restored.
//
// DORMANT until armed: returns 501 unless RESTORE_ADMIN_KEY is set. Force/replace/merge live ONLY
// in the local scripts/restore.mjs break-glass tool, never here.
import { JWT } from "google-auth-library";
import { gunzipSync } from "zlib";

export const config = { maxDuration: 60 };

const SUPA = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const SA_B64 = process.env.GOOGLE_SA_KEY_B64 || "";
const RKEY = process.env.RESTORE_ADMIN_KEY || "";
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };
const TOO_LARGE = 50000; // tables bigger than this go through the local script (body/time safety)

// FK parent-first insert order. `backups` (audit history) is deliberately excluded — it uses a
// GENERATED ALWAYS id and is not business data. Tables absent from a backup are simply skipped.
const RESTORE_ORDER = [
  "branches", "app_users", "suppliers", "categories", "expense_categories", "table_zones",
  "printers", "pos_settings", "ingredients", "menus", "assets", "tables", "pos_shifts",
  "purchase_orders", "purchase_requisitions", "order_requests", "stock_count_sessions",
  "orders", "external_sales", "cash_movements", "stock_logs", "waste_logs", "approval_log",
  "action_history", "cost_history", "cost_snapshots", "crm_customers", "crm_promotions",
  "crm_vouchers", "crm_transactions", "crm_point_claims", "crm_reservations",
  "crm_booking_requests", "crm_feedback", "crm_broadcasts", "crm_events", "promotions",
  "push_subscriptions",
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
async function driveDownload(id) {
  const tok = await bearer();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`drive download failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function liveCount(t) {
  const r = await fetch(`${SUPA}/rest/v1/${t}?select=*&limit=1`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) throw new Error(`count ${t}: HTTP ${r.status}`);
  const total = (r.headers.get("content-range") || "").split("/")[1]; // "0-0/<total>" or "*/0"
  return total === "*" || total == null ? 0 : Number(total);
}
async function restoreRpc(table, rows, mode) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/restore_table`, {
    method: "POST", headers: { ...H, "Content-Type": "application/json" },
    body: JSON.stringify({ p_table: table, p_rows: rows, p_mode: mode || "insert" }),
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`restore ${table}: HTTP ${r.status} ${txt.slice(0, 180)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}

export default async function handler(req, res) {
  if (!RKEY) return res.status(501).json({ error: "restore not enabled — set RESTORE_ADMIN_KEY in Vercel to arm it" });
  const q = req.query || {};
  let body = req.body || {};
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const key = q.key || body.key || "";
  if (key !== RKEY) return res.status(401).json({ error: "รหัสไม่ถูกต้อง" });

  const driveId = (q.driveId || body.driveId || "").toString().trim();
  const apply = (q.apply || body.apply || "0").toString() === "1";
  const confirm = (q.confirm || body.confirm || "").toString();
  if (!driveId) return res.status(400).json({ error: "missing driveId" });

  try {
    const payload = JSON.parse(gunzipSync(await driveDownload(driveId)).toString());
    if (payload.status !== "success") return res.status(400).json({ error: `backup is not marked success (status=${payload.status}) — refusing to restore` });
    const fileName = payload.file_name || `backup-${payload.generated_at || ""}`;
    const tablesInBackup = payload.tables || {};

    // Plan (READ only). Classify every table; only truly-empty tables are eligible to insert.
    const plan = [];
    for (const t of RESTORE_ORDER) {
      if (!(t in tablesInBackup)) continue;
      const rows = tablesInBackup[t];
      if (rows === null) { plan.push({ table: t, action: "skip-unknown", reason: "not captured (rows:null)", backupRows: 0 }); continue; }
      const backupRows = Array.isArray(rows) ? rows.length : 0;
      const live = await liveCount(t);
      let action;
      if (live === 0) action = backupRows === 0 ? "noop-empty" : backupRows > TOO_LARGE ? "too-large" : "insert";
      else if (live >= backupRows) action = "skip-nonempty";        // already has ≥ backup — leave it
      else action = "skip-partial";                                  // 0<live<backup — needs manual repair
      plan.push({ table: t, action, backupRows, liveRows: live });
    }
    const willInsert = plan.filter((p) => p.action === "insert");
    const partials = plan.filter((p) => p.action === "skip-partial");
    const tooLarge = plan.filter((p) => p.action === "too-large");
    const summary = {
      tablesToInsert: willInsert.length, rowsToInsert: willInsert.reduce((a, p) => a + p.backupRows, 0),
      skippedNonEmpty: plan.filter((p) => p.action === "skip-nonempty").length,
      partialNeedsRepair: partials.map((p) => `${p.table} (มี ${p.liveRows}/${p.backupRows})`),
      tooLargeUseLocalScript: tooLarge.map((p) => `${p.table} (${p.backupRows})`),
    };

    if (!apply) return res.status(200).json({ mode: "dry-run", file: fileName, confirmToken: `RESTORE ${fileName}`, summary, plan });

    if (confirm !== `RESTORE ${fileName}`) return res.status(400).json({ error: `confirm token mismatch — must type exactly: RESTORE ${fileName}` });

    const written = {}, applySkipped = [];
    for (const p of willInsert) {
      try {
        const r = await restoreRpc(p.table, tablesInBackup[p.table], "insert");
        if (r.skipped) { written[p.table] = `skipped (${r.reason || "nonempty"} — live ${r.live})`; applySkipped.push(`${p.table} (${r.reason || "nonempty"}, live ${r.live})`); }
        else { const ins = r.inserted ?? 0; written[p.table] = ins; if (ins < p.backupRows) applySkipped.push(`${p.table} (เขียน ${ins}/${p.backupRows})`); }
      } catch (e) {
        return res.status(500).json({ status: "aborted", file: fileName, written, failedTable: p.table, error: String((e && e.message) || e) });
      }
    }
    // Not "done" if any table still needs manual attention — never let a partial recovery look complete.
    const incomplete = partials.length > 0 || tooLarge.length > 0 || applySkipped.length > 0;
    return res.status(200).json({ status: incomplete ? "incomplete" : "done", file: fileName, written, needsAttention: { partial: summary.partialNeedsRepair, tooLarge: summary.tooLargeUseLocalScript, appliedSkipped: applySkipped } });
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
