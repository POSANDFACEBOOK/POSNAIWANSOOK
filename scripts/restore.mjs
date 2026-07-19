#!/usr/bin/env node
// Break-glass RESTORE tool — run LOCALLY by a developer during disaster recovery.
// Restores through the restore_table() RPC (SECURITY DEFINER) so it preserves original ids
// via OVERRIDING SYSTEM VALUE — mandatory because several tables use GENERATED ALWAYS identity
// and every foreign key depends on the original ids. Each RPC call is one atomic transaction.
//
// Usage:  node scripts/restore.mjs <backup.json.gz> [options]
//
// Modes (pick at most one; default = empty-only):
//   (default)   empty-only — writes a table only if it is currently empty (safe; never touches
//               tables that already hold data). Uses ON CONFLICT DO NOTHING so it is resumable.
//   --merge     append missing rows into existing tables (ON CONFLICT DO NOTHING). Never deletes.
//   --force     REPLACE everything: delete all rows (reverse-FK) then re-insert (forward-FK).
//               DESTRUCTIVE. Requires --yes AND --confirm "RESTORE <fileName>".
//
// Flags:  --only a,b,c   --apply (without it: DRY-RUN)   --yes   --confirm "..."   --allow-nonsuccess
//
// Uses the publishable key (RLS off). Requires Node 18+.
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";

const SUPA = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" };
const CHUNK = 5000;

// FK parent-first order. `backups` (audit) is intentionally NOT restored.
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

function arg(name) { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; }
const has = (name) => process.argv.includes(name);

const file = process.argv[2];
if (!file || file.startsWith("--")) { console.error('usage: node scripts/restore.mjs <backup.json.gz> [--merge|--force] [--apply] [--only a,b] [--yes --confirm "RESTORE <file>"]'); process.exit(1); }

const merge = has("--merge"), force = has("--force"), apply = has("--apply");
if (merge && force) { console.error("choose --merge OR --force, not both"); process.exit(1); }
const only = (arg("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const mode = force ? "force-replace" : merge ? "merge-append" : "empty-only";

const payload = JSON.parse(gunzipSync(readFileSync(file)).toString());
const fileName = payload.file_name || `backup-${payload.generated_at || ""}`;
if (payload.status !== "success" && !has("--allow-nonsuccess")) { console.error(`Refusing: backup status is "${payload.status}", not "success". Pass --allow-nonsuccess to override.`); process.exit(1); }
if (force && (!has("--yes") || arg("--confirm") !== `RESTORE ${fileName}`)) { console.error(`--force is destructive. Re-run with:  --yes --confirm "RESTORE ${fileName}"`); process.exit(1); }

async function liveCount(t) {
  const r = await fetch(`${SUPA}/rest/v1/${t}?select=*&limit=1`, { headers: { ...H, Prefer: "count=exact", Range: "0-0" } });
  if (!r.ok) throw new Error(`count ${t}: HTTP ${r.status}`);
  const total = (r.headers.get("content-range") || "").split("/")[1];
  return total === "*" || total == null ? 0 : Number(total);
}
async function rpc(table, rows, m) {
  const r = await fetch(`${SUPA}/rest/v1/rpc/restore_table`, { method: "POST", headers: H, body: JSON.stringify({ p_table: table, p_rows: rows, p_mode: m }) });
  const txt = await r.text();
  if (!r.ok) throw new Error(`rpc ${table} (${m}): HTTP ${r.status} ${txt.slice(0, 200)}`);
  try { return JSON.parse(txt); } catch { return {}; }
}
async function appendChunks(t, rows) { for (let i = 0; i < rows.length; i += CHUNK) await rpc(t, rows.slice(i, i + CHUNK), "append"); }

const tables = RESTORE_ORDER.filter((t) => t in (payload.tables || {}) && (!only.length || only.includes(t)));

(async () => {
  console.log(`\nRestore ${fileName}  •  mode=${mode}  •  ${apply ? "APPLY" : "DRY-RUN"}${only.length ? "  • only=" + only.join(",") : ""}\n`);
  const plan = [];
  for (const t of tables) {
    const rows = payload.tables[t];
    if (rows === null) { plan.push([t, "skip-unknown", 0, "-"]); continue; }
    const backupRows = rows.length; const live = await liveCount(t);
    let action;
    if (force) action = "replace";
    else if (merge) action = backupRows ? "append" : "noop-empty";
    else action = live === 0 ? (backupRows ? "insert" : "noop-empty") : (live >= backupRows ? "skip-nonempty" : "skip-partial");
    plan.push([t, action, backupRows, live]);
  }
  console.log("table".padEnd(24), "action".padEnd(14), "backup".padStart(7), "live".padStart(7));
  for (const [t, a, b, l] of plan) console.log(t.padEnd(24), String(a).padEnd(14), String(b).padStart(7), String(l).padStart(7));
  const partials = plan.filter((p) => p[1] === "skip-partial");
  if (partials.length) console.log(`\n⚠️  ${partials.length} table(s) are PARTIALLY filled (0 < live < backup) and were NOT touched: ${partials.map((p) => p[0]).join(", ")}\n   Use --force to rebuild them, or repair manually — they are NOT complete.`);
  const acts = plan.filter((p) => ["insert", "append", "replace"].includes(p[1]));
  console.log(`\n${acts.length} table(s) would be written, ${acts.reduce((a, p) => a + p[2], 0)} rows total.`);
  if (!apply) { console.log("\nDRY-RUN only — re-run with --apply to write.\n"); return; }

  const written = {}, shortTables = []; let failed = null;
  try {
    if (force) {
      // Delete everything first, REVERSE FK order (children before parents), via replace+empty.
      for (const [t] of [...acts].reverse()) { process.stdout.write(`  wipe ${t} ... `); await rpc(t, [], "replace"); console.log("ok"); }
    }
    // Insert forward FK order. 'append' (ON CONFLICT DO NOTHING) is id-preserving and resumable.
    for (const [t, a] of acts) {
      if (a === "insert") { const live = await liveCount(t); if (live > 0) { written[t] = `skip (now ${live})`; console.log(`  ${t}: skip (now ${live})`); continue; } }
      const want = payload.tables[t].length;
      process.stdout.write(`  ${force ? "insert" : a} ${t} (${want}) ... `);
      await appendChunks(t, payload.tables[t]);
      const live = await liveCount(t); written[t] = live;
      const short = live < want;
      if (short) shortTables.push({ t, live, want });
      console.log(short ? `⚠️ ${live}/${want} (SHORT)` : `${live} ✓`);
    }
  } catch (e) { failed = e.message; }

  if (failed) {
    console.error(`\n⛔ FAILED: ${failed}\n   The DB may be in a PARTIAL state. Re-run the SAME command to resume (append is idempotent);` +
      `${force ? " with --force it will re-wipe and rebuild." : ""}\n`);
    process.exit(1);
  }
  // Fewer rows written than the backup held (a secondary UNIQUE/constraint dropped rows, or a dup):
  // this is silent data loss — never let it exit 0 as "Done".
  if (shortTables.length) {
    console.error(`\n⛔ INCOMPLETE: ${shortTables.length} table(s) wrote FEWER rows than the backup — rows were dropped:`);
    for (const s of shortTables) console.error(`   ${s.t}: ${s.live}/${s.want}`);
    console.error(`   Investigate before trusting this restore (check for duplicate ids / secondary unique constraints).\n`);
    process.exit(1);
  }
  console.log("\nDone. Written:", written);
  if (partials.length) console.log(`\n‼️  Reminder: ${partials.length} partial table(s) still need repair: ${partials.map((p) => p[0]).join(", ")}`);
  console.log("");
})().catch((e) => { console.error("\nFAILED:", e.message, "\n"); process.exit(1); });
