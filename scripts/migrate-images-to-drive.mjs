// ─────────────────────────────────────────────────────────────────────────────
// One-time migration: move legacy images from the Supabase Storage bucket
// `foodcost-images` into Google Drive, and rewrite the DB references to drive:<id>.
//
// Covers every field the old ImgUp uploader wrote to:
//   ingredients.image + ingredients.sop[].image
//   menus.image       + menus.sop[].image
//   assets.image
//
// SAFE BY DEFAULT: with no flag it does a DRY RUN (reads only, no Drive upload, no
// DB write) and prints what it *would* migrate. Add --live to actually migrate.
// Idempotent: already-migrated (drive:) or non-bucket URLs are skipped, so re-running
// after an interruption only finishes the leftovers.
//
//   node scripts/migrate-images-to-drive.mjs            # dry run (preview)
//   node scripts/migrate-images-to-drive.mjs --live     # do it
//
// Requires Node 18+ (global fetch/Buffer). No secrets: the anon key is publishable
// and /api/drive-upload is the same public proxy the app already uses.
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const APP_BASE = "https://foodcost-eta.vercel.app"; // deployed app — serves /api/drive-upload
const BUCKET   = "foodcost-images";                  // the Supabase bucket to drain

const LIVE = process.argv.includes("--live");

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) },
  });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const t = await r.text();
  return t ? JSON.parse(t) : [];
}

// A URL is a migration target only if it points at the Supabase bucket and isn't already a Drive ref.
function isBucketImg(u) { return typeof u === "string" && u.includes(BUCKET) && !u.startsWith("drive:"); }

// Download from Supabase (public) → upload to the Drive proxy → return "drive:<id>".
async function toDrive(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const ct = res.headers.get("content-type") || "image/jpeg";
  const ext = ct.includes("png") ? "png" : ct.includes("webp") ? "webp" : "jpg";
  const up = await fetch(`${APP_BASE}/api/drive-upload?name=${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`, {
    method: "POST", headers: { "Content-Type": ct }, body: buf,
  });
  if (!up.ok) throw new Error(`upload ${await up.text()}`);
  const j = await up.json().catch(() => ({}));
  if (!j.id) throw new Error("no id from drive-upload");
  return `drive:${j.id}`;
}

let migrated = 0, skipped = 0, failed = 0, wouldMigrate = 0;
const cache = new Map(); // dedupe identical URLs within a run

async function conv(url) {
  if (!isBucketImg(url)) return null;
  if (!LIVE) { wouldMigrate++; return "drive:__DRY__"; }
  if (cache.has(url)) return cache.get(url);
  const ref = await toDrive(url);
  cache.set(url, ref);
  return ref;
}

async function migrateTable(table, hasSop) {
  const rows = await sb(`${table}?select=id,image${hasSop ? ",sop" : ""}`);
  console.log(`\n== ${table}: ${rows.length} rows ==`);
  for (const row of rows) {
    const patch = {};
    if (isBucketImg(row.image)) {
      try { const ref = await conv(row.image); if (ref) { patch.image = ref; if (LIVE) migrated++; } }
      catch (e) { failed++; console.log(`  ✗ ${table}#${row.id} image: ${e.message}`); }
    }
    if (hasSop && Array.isArray(row.sop) && row.sop.some(s => s && isBucketImg(s.image))) {
      const newSop = [];
      let changed = false;
      for (const step of row.sop) {
        if (step && isBucketImg(step.image)) {
          try { const ref = await conv(step.image); if (ref) { newSop.push({ ...step, image: ref }); changed = true; if (LIVE) migrated++; continue; } }
          catch (e) { failed++; console.log(`  ✗ ${table}#${row.id} sop image: ${e.message}`); }
        }
        newSop.push(step);
      }
      if (changed) patch.sop = newSop;
    }
    if (Object.keys(patch).length) {
      if (!LIVE) { console.log(`  [dry] ${table}#${row.id} would migrate: ${Object.keys(patch).join(", ")}`); }
      else {
        try { await sb(`${table}?id=eq.${row.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify(patch) }); console.log(`  ✓ ${table}#${row.id} migrated (${Object.keys(patch).join(", ")})`); }
        catch (e) { failed++; console.log(`  ✗ PATCH ${table}#${row.id}: ${e.message}`); }
      }
    } else skipped++;
  }
}

(async () => {
  console.log(LIVE ? "🚀 LIVE — uploading to Drive + rewriting DB" : "🔎 DRY RUN — reading only, no changes (add --live to migrate)");
  try {
    await migrateTable("ingredients", true);
    await migrateTable("menus", true);
    await migrateTable("assets", false);
    console.log(`\n──────────────────────────────`);
    if (LIVE) console.log(`DONE.  migrated images: ${migrated}   rows unchanged: ${skipped}   failed: ${failed}`);
    else console.log(`DRY DONE.  images that WOULD migrate: ${wouldMigrate}   rows unchanged: ${skipped}   (re-run with --live to do it)`);
    if (failed) { console.log(`\n⚠️  ${failed} item(s) failed — safe to re-run; only leftovers are retried.`); process.exit(1); }
  } catch (e) {
    console.error("FATAL:", e.message);
    process.exit(1);
  }
})();
