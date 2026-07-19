// Daily data backup → one gzipped JSON snapshot in the company Google Shared Drive.
//
// Dumps EVERY row of EVERY business table (paginated past PostgREST's 1000-row cap),
// verifies completeness against an exact row-count oracle, re-downloads the upload to
// prove it is readable, logs the run to the `backups` audit table, and rotates old
// backups (GFS). A run is reported `success` ONLY when every table was fully captured
// AND the readback matched — an incomplete or unreadable dump is written under a
// `FAILED-` name and reported failed, never mistaken for a good backup.
//
// Triggers:
//   • Vercel Cron (daily, see vercel.json)  → Authorization: Bearer <CRON_SECRET>
//   • Manual "backup now" from the admin UI  → POST /api/backup?key=<BACKUP_ADMIN_KEY>
// Rotation (deletes) runs on the cron+success path ONLY, so a leaked manual key cannot
// delete anything. Reuses the slip service account (GOOGLE_SA_KEY_B64 + DRIVE_FOLDER_ID).
//
// Requires (Vercel env): CRON_SECRET, BACKUP_ADMIN_KEY, GOOGLE_SA_KEY_B64, DRIVE_FOLDER_ID.
// Requires (SQL, run once): the `backups` table + `backup_manifest()` RPC.
import { JWT } from "google-auth-library";
import { gzipSync, gunzipSync } from "zlib";

export const config = { maxDuration: 60 };

const SUPA = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const SA_B64 = process.env.GOOGLE_SA_KEY_B64 || "";
const FOLDER_ID = process.env.DRIVE_FOLDER_ID || "";
const CRON = process.env.CRON_SECRET || "";
const BKEY = process.env.BACKUP_ADMIN_KEY || "";
const H = { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` };

// CANONICAL BACKUP SET — 38 real tables + the `backups` audit table itself (39).
// Any table that exists in the DB but is NOT here is flagged (missing_tables → run fails),
// so a newly-added table can never be silently skipped. pk = the orderable key for keyset
// pagination (defaults to "id"; pos_settings is keyed by branch_id).
const TABLES = [
  "branches", "app_users", "suppliers", "categories", "expense_categories", "ingredients",
  "menus", "assets", "table_zones", "tables", "printers", { name: "pos_settings", pk: "branch_id" },
  "pos_shifts", "cash_movements", "purchase_orders", "purchase_requisitions", "order_requests",
  "orders", "order_items", "external_sales", "stock_count_sessions", "stock_logs", "waste_logs",
  "approval_log", "action_history", "cost_history", "cost_snapshots", "crm_customers",
  "crm_transactions", "crm_vouchers", "crm_reservations", "crm_booking_requests", "crm_feedback",
  "crm_point_claims", "crm_promotions", "crm_broadcasts", "crm_events", "crm_line_users",
  "promotions", "push_subscriptions", "backups",
].map((t) => (typeof t === "string" ? { name: t, pk: "id" } : { name: t.name, pk: t.pk || "id" }));

// Postgres system/internal tables that legitimately live in `public` but are not app data.
const IGNORE_DRIFT = /^(pg_|_|spatial_ref_sys$|geometry_columns$|geography_columns$)/;

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

// Exact per-table row counts straight from Postgres (SECURITY DEFINER → bypasses RLS, so a
// future RLS change that silently filtered reads would be caught by fetched<count).
async function manifest() {
  const r = await fetch(`${SUPA}/rest/v1/rpc/backup_manifest`, { method: "POST", headers: { ...H, "Content-Type": "application/json" }, body: "{}" });
  if (!r.ok) throw new Error(`backup_manifest RPC failed: ${r.status} ${(await r.text()).slice(0, 140)}`);
  const rows = await r.json();
  if (!Array.isArray(rows)) throw new Error("backup_manifest returned non-array");
  const m = {};
  for (const row of rows) m[row.table_name] = Number(row.row_count);
  return m;
}

// Fetch ALL rows of a table via keyset pagination (id > lastId). Keyset — not offset — so
// concurrent inserts during the scan can never make us skip an existing row. Dedupe on pk.
// Throws (→ table marked incomplete → run fails) on any HTTP error, non-array body, or if
// fewer rows come back than the count oracle says exist.
async function fetchAll(name, pk, count) {
  const byId = new Map();
  let last = null, guard = 0;
  for (;;) {
    if (++guard > 5000) throw new Error(`${name}: runaway pagination`);
    let url = `${SUPA}/rest/v1/${name}?select=*&order=${pk}.asc&limit=1000`;
    if (last !== null) url += `&${pk}=gt.${encodeURIComponent(last)}`;
    const r = await fetch(url, { headers: H });
    if (!r.ok) throw new Error(`${name}: HTTP ${r.status} ${(await r.text()).slice(0, 120)}`);
    const page = await r.json();
    if (!Array.isArray(page)) throw new Error(`${name}: non-array body`);
    for (const row of page) byId.set(row[pk], row);
    if (page.length < 1000) break;
    last = page[page.length - 1][pk];
    if (last == null) throw new Error(`${name}: null ${pk} — cannot keyset-paginate`);
  }
  const fetched = byId.size;
  if (fetched < count) throw new Error(`${name}: incomplete — fetched ${fetched} < db ${count}`);
  return { rows: [...byId.values()], fetched };
}

// Run async fn over items with a bounded concurrency pool.
async function mapPool(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  });
  await Promise.all(workers);
  return out;
}

async function auditInsert(row) {
  try {
    const r = await fetch(`${SUPA}/rest/v1/backups`, { method: "POST", headers: { ...H, "Content-Type": "application/json", Prefer: "return=representation" }, body: JSON.stringify(row) });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) && j[0] ? j[0].id : null;
  } catch { return null; }
}
async function auditPatch(id, patch) {
  if (id == null) return;
  try { await fetch(`${SUPA}/rest/v1/backups?id=eq.${id}`, { method: "PATCH", headers: { ...H, "Content-Type": "application/json", Prefer: "return=minimal" }, body: JSON.stringify(patch) }); } catch {}
}

async function driveUpload(name, gz) {
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
  if (!up.ok) throw new Error(`drive upload failed: ${up.status} ${JSON.stringify(ud).slice(0, 160)}`);
  return ud.id;
}
async function driveDownload(id) {
  const tok = await bearer();
  const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${tok}` } });
  if (!r.ok) throw new Error(`drive download failed: ${r.status}`);
  return Buffer.from(await r.arrayBuffer());
}
async function driveDelete(id) {
  try { const tok = await bearer(); const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } }); return r.ok || r.status === 204; }
  catch { return false; }
}
async function driveRename(id, name) {
  try { const tok = await bearer(); const r = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?supportsAllDrives=true`, { method: "PATCH", headers: { Authorization: `Bearer ${tok}`, "Content-Type": "application/json" }, body: JSON.stringify({ name }) }); return r.ok; }
  catch { return false; }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// GFS rotation — delete OLD backups. Runs ONLY on cron+success+verified. Ultra-defensive:
// skips entirely on a bad/empty listing, only ever touches files matching the strict backup
// name pattern (FAILED- files never match), always keeps the newest 14, and refuses a plan
// that would delete an implausible number of files.
const KEEP_DAILY = 14, KEEP_MONTHLY = 12, KEEP_YEARLY = 3, MAX_DELETE = 40;
const NAME_RE = /^foodcost-backup-(\d{4})-(\d{2})-(\d{2})(T\d{6}Z)?\.json\.gz$/;
async function rotate(todayId) {
  const tok = await bearer();
  const q = `'${FOLDER_ID}' in parents and name contains 'foodcost-backup-' and trashed=false`;
  let files = [], pageToken = "";
  do {
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,createdTime)&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=drive&driveId=${FOLDER_ID}&pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { Authorization: `Bearer ${tok}` } });
    if (!r.ok) return { deleted: [], kept: 0, error: `list failed ${r.status} — rotation skipped` };
    const j = await r.json();
    files = files.concat(j.files || []);
    pageToken = j.nextPageToken || "";
  } while (pageToken);
  if (!files.length) return { deleted: [], kept: 0, error: "empty listing — rotation skipped" };

  const cand = files.map((f) => { const m = NAME_RE.exec(f.name); return m ? { ...f, ym: `${m[1]}-${m[2]}`, y: m[1], date: `${m[1]}-${m[2]}-${m[3]}`, dateOnly: !m[4] } : null; })
    .filter(Boolean).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first
  const keep = new Set([todayId]);
  cand.slice(0, KEEP_DAILY).forEach((f) => keep.add(f.id));              // hard floor: newest 14
  // monthly: earliest date-only file of each of the most recent KEEP_MONTHLY months
  const byMonth = {}; for (const f of cand) if (f.dateOnly) (byMonth[f.ym] ||= []).push(f);
  Object.keys(byMonth).sort().reverse().slice(0, KEEP_MONTHLY).forEach((ym) => {
    const earliest = byMonth[ym].reduce((a, b) => (a.date < b.date ? a : b)); keep.add(earliest.id);
  });
  // yearly: earliest date-only file of each of the most recent KEEP_YEARLY years
  const byYear = {}; for (const f of cand) if (f.dateOnly) (byYear[f.y] ||= []).push(f);
  Object.keys(byYear).sort().reverse().slice(0, KEEP_YEARLY).forEach((y) => {
    const earliest = byYear[y].reduce((a, b) => (a.date < b.date ? a : b)); keep.add(earliest.id);
  });

  const toDelete = cand.filter((f) => !keep.has(f.id));
  if (toDelete.length > MAX_DELETE) return { deleted: [], kept: cand.length, error: `refused: plan would delete ${toDelete.length} (>${MAX_DELETE})` };
  const deleted = [];
  for (const f of toDelete) {
    try { const d = await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}?supportsAllDrives=true`, { method: "DELETE", headers: { Authorization: `Bearer ${tok}` } }); if (d.ok || d.status === 204) deleted.push(f.name); } catch {}
  }
  return { deleted, kept: cand.length - deleted.length, error: null };
}

export default async function handler(req, res) {
  const auth = req.headers.authorization || "";
  const qkey = (req.query && req.query.key) || "";
  const isCron = CRON && auth === `Bearer ${CRON}`;
  const isManual = BKEY && qkey === BKEY;
  if (!isCron && !isManual) return res.status(401).json({ error: "unauthorized" });
  if (!SA_B64 || !FOLDER_ID) return res.status(501).json({ error: "drive not configured (GOOGLE_SA_KEY_B64 + DRIVE_FOLDER_ID)" });
  const trigger = isCron ? "cron" : "manual";

  // Manual rate-limit: refuse if a run started < 2 min ago (stops accidental / abusive spam).
  if (isManual) {
    try {
      const last = await (await fetch(`${SUPA}/rest/v1/backups?order=started_at.desc&limit=1`, { headers: H })).json();
      if (Array.isArray(last) && last[0] && Date.now() - new Date(last[0].started_at).getTime() < 120000)
        return res.status(429).json({ error: "มีการสำรองไปเมื่อไม่ถึง 2 นาทีที่แล้ว — รอสักครู่" });
    } catch {}
  }

  const started = new Date().toISOString();
  const auditId = await auditInsert({ started_at: started, status: "running", trigger });
  try {
    const countMap = await manifest();
    const known = new Set(TABLES.map((t) => t.name));
    const live = Object.keys(countMap).filter((n) => !IGNORE_DRIFT.test(n));
    const missing = live.filter((n) => !known.has(n));      // in DB, not in our list → we'd skip it
    const extra = TABLES.map((t) => t.name).filter((n) => !(n in countMap)); // in our list, not in DB

    const settled = await mapPool(TABLES, 5, async (t) => {
      const c = countMap[t.name];
      if (c == null) return { t: t.name, count: null, fetched: 0, rows: null, complete: false, error: "not in manifest (table missing?)" };
      try { const { rows, fetched } = await fetchAll(t.name, t.pk, c); return { t: t.name, count: c, fetched, rows, complete: true, error: null }; }
      catch (e) { return { t: t.name, count: c, fetched: 0, rows: null, complete: false, error: String((e && e.message) || e) }; }
    });

    const manifestOut = {}, tablesOut = {}; let totalRows = 0, allOk = true;
    for (const s of settled) {
      manifestOut[s.t] = { count: s.count, fetched: s.fetched, complete: s.complete, error: s.error };
      tablesOut[s.t] = s.complete ? s.rows : null;   // rows:null on failure — NEVER [] (see restore contract)
      if (!s.complete) allOk = false; else totalRows += s.fetched;
    }
    const driftClean = missing.length === 0 && extra.length === 0;
    const dataComplete = allOk && driftClean;

    const stamp = started.slice(0, 19).replace(/[:]/g, "");     // YYYY-MM-DDTHHMMSS
    const name = !dataComplete ? `foodcost-backup-FAILED-${started.replace(/[:.]/g, "-")}.json.gz`
      : isManual ? `foodcost-backup-${stamp}Z.json.gz`
        : `foodcost-backup-${started.slice(0, 10)}.json.gz`;
    const payload = {
      schema_version: 3, generated_at: started, finished_at: new Date().toISOString(),
      source: "naiwansook-foodcost", status: dataComplete ? "success" : "failed", file_name: name,
      table_count: TABLES.length, total_rows: totalRows,
      missing_tables: missing, extra_tables: extra, manifest: manifestOut, tables: tablesOut,
    };
    const raw = Buffer.from(JSON.stringify(payload));
    const gz = gzipSync(raw);
    const driveId = await driveUpload(name, gz);

    // Readback verify: only trust a backup we can re-download, gunzip, parse, and whose per-table
    // lengths match what we claim. Retry a few times first — a Shared Drive read right after upload
    // can be transiently inconsistent, and a false "unverified" would delete a genuinely-good file.
    let verified = false;
    if (dataComplete) {
      for (let attempt = 0; attempt < 3 && !verified; attempt++) {
        if (attempt) await sleep(1500 * attempt);
        try {
          const p = JSON.parse(gunzipSync(await driveDownload(driveId)).toString());
          verified = Object.keys(manifestOut).every((k) => {
            const m = manifestOut[k];
            return m.complete ? (Array.isArray(p.tables[k]) && p.tables[k].length === m.fetched) : (p.tables[k] === null);
          });
        } catch { verified = false; }
      }
    }

    // A complete-but-UNVERIFIED upload carries a canonical (non-FAILED) name and an embedded
    // status:"success" — if left in Drive it could be retained by rotation or accepted by restore.
    // Neutralize it so no untrustworthy artifact survives under a good name: delete it (retried);
    // if delete keeps failing, RENAME to a FAILED- name so it no longer matches NAME_RE (rotation
    // drops it) and a human sees the marker. Only if BOTH fail do we flag the danger in the audit.
    let storedName = name, storedDrive = driveId;
    if (dataComplete && !verified) {
      let neutralized = false;
      for (let a = 0; a < 3 && !neutralized; a++) { if (a) await sleep(1000 * a); neutralized = await driveDelete(driveId); }
      if (neutralized) { storedName = `(deleted unverified) ${name}`; storedDrive = null; }
      else {
        const failedName = `foodcost-backup-FAILED-${started.replace(/[:.]/g, "-")}.json.gz`;
        const renamed = await driveRename(driveId, failedName);
        storedName = renamed ? `(unverified→renamed) ${failedName}` : `(UNVERIFIED — DELETE+RENAME FAILED, do not restore) ${name}`;
        storedDrive = null;   // never surface an unverified artifact to the restore UI
      }
    }

    // Status + rotation. success requires dataComplete AND verified. Rotation is cron-only.
    let status, rotation = null;
    if (!dataComplete) status = "failed";
    else if (!verified) status = "failed";               // complete but unreadable → not trustworthy (file deleted above)
    else status = driftClean ? "success" : "degraded";
    if (status === "success" && isCron) {
      try { rotation = await rotate(driveId); if (rotation && rotation.error) status = "degraded"; }
      catch (e) { rotation = { error: String((e && e.message) || e) }; status = "degraded"; }
    }

    await auditPatch(auditId, {
      finished_at: new Date().toISOString(), status, file_name: storedName, drive_id: storedDrive,
      gz_size_bytes: gz.length, raw_size_bytes: raw.length, total_rows: totalRows, table_count: TABLES.length,
      complete: dataComplete, verified, tables: manifestOut, missing_tables: missing, extra_tables: extra,
      rotation, duration_ms: Date.now() - new Date(started).getTime(),
    });
    return res.status(200).json({
      ok: status === "success" || status === "degraded", status, file: storedName, driveId: storedDrive,
      gzKB: Math.round(gz.length / 1024), totalRows, verified, missing_tables: missing, extra_tables: extra,
      failures: settled.filter((s) => !s.complete).map((s) => ({ t: s.t, error: s.error, count: s.count, fetched: s.fetched })),
    });
  } catch (e) {
    await auditPatch(auditId, { finished_at: new Date().toISOString(), status: "failed", error: String((e && e.message) || e), duration_ms: Date.now() - new Date(started).getTime() });
    return res.status(500).json({ ok: false, status: "failed", error: String((e && e.message) || e) });
  }
}
