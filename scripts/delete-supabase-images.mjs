// ─────────────────────────────────────────────────────────────────────────────
// One-time cleanup: permanently DELETE every file in the Supabase Storage bucket
// `foodcost-images` to reclaim the free-tier space. These files are orphaned after
// migrate-images-to-drive.mjs rewrote all DB refs to Drive.
//
// PRE-FLIGHT SAFETY: before deleting anything it re-scans ingredients/menus/assets
// and ABORTS if ANY row still points at the bucket (i.e. migration not finished).
//
// SAFE BY DEFAULT: no flag = dry run (counts files, deletes nothing). Add --live.
//   node scripts/delete-supabase-images.mjs           # dry run (count only)
//   node scripts/delete-supabase-images.mjs --live     # delete for real
//
// Requires Node 18+. Anon key is publishable; delete permission on this bucket was
// verified. THIS IS IRREVERSIBLE — run only after confirming images load from Drive.
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const BUCKET   = "foodcost-images";
const LIVE = process.argv.includes("--live");

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : [];
}
function refsBucket(u) { return typeof u === "string" && u.includes(BUCKET) && !u.startsWith("drive:"); }

async function preflight() {
  let refs = 0;
  for (const [t, hasSop] of [["ingredients", true], ["menus", true], ["assets", false]]) {
    const rows = await sb(`${t}?select=id,image${hasSop ? ",sop" : ""}`);
    for (const r of rows) {
      if (refsBucket(r.image)) refs++;
      if (hasSop && Array.isArray(r.sop)) for (const s of r.sop) if (s && refsBucket(s.image)) refs++;
    }
  }
  return refs;
}

async function listFirst(limit = 1000) {
  const r = await fetch(`${SUPA_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST", headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit, offset: 0, sortBy: { column: "name", order: "asc" } }),
  });
  if (!r.ok) throw new Error(`list ${r.status} ${await r.text()}`);
  return r.json();
}
async function listPage(offset, limit = 1000) {
  const r = await fetch(`${SUPA_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST", headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix: "", limit, offset, sortBy: { column: "name", order: "asc" } }),
  });
  if (!r.ok) throw new Error(`list ${r.status} ${await r.text()}`);
  return r.json();
}
async function del(names) {
  const r = await fetch(`${SUPA_URL}/storage/v1/object/${BUCKET}`, {
    method: "DELETE", headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefixes: names }),
  });
  if (!r.ok) throw new Error(`delete ${r.status} ${await r.text()}`);
  return r.json();
}

(async () => {
  console.log(LIVE ? "🗑️  LIVE — deleting all files in foodcost-images" : "🔎 DRY RUN — counting only (add --live to delete)");
  const refs = await preflight();
  if (refs > 0) {
    console.error(`\n⛔ ABORT: ${refs} DB row(s) still reference ${BUCKET}. Run migrate-images-to-drive.mjs --live first.`);
    process.exit(1);
  }
  console.log("✓ pre-flight ok — 0 DB references to the bucket, files are orphaned.\n");

  let total = 0;
  if (!LIVE) {
    // paginate (nothing is deleted, so use offset)
    for (let offset = 0; ; offset += 1000) {
      const page = await listPage(offset, 1000);
      if (!Array.isArray(page) || page.length === 0) break;
      total += page.filter(f => f && f.name).length;
      console.log(`[dry] page @${offset}: ${page.length}`);
      if (page.length < 1000) break;
    }
    console.log(`\nDRY DONE. files that WOULD be deleted: ${total}  (re-run with --live)`);
    return;
  }
  // live: repeatedly take the first page and delete it until the bucket is empty
  while (true) {
    const page = await listFirst(1000);
    if (!Array.isArray(page) || page.length === 0) break;
    const names = page.map(f => f && f.name).filter(Boolean);
    if (!names.length) break;
    await del(names);
    total += names.length;
    console.log(`deleted ${names.length}  (total ${total})`);
    if (page.length < 1000) break;
  }
  // final sweep in case a partial last page remained
  const left = await listFirst(1000);
  if (Array.isArray(left) && left.length) {
    const names = left.map(f => f && f.name).filter(Boolean);
    if (names.length) { await del(names); total += names.length; console.log(`deleted ${names.length}  (total ${total})`); }
  }
  console.log(`\n✅ DONE. deleted ${total} files from ${BUCKET}. Space will free up shortly.`);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
