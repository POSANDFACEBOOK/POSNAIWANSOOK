// ─────────────────────────────────────────────────────────────────────────────
// One-time: consolidate ownership of every supplier under the central kitchen.
// For each branch-owned supplier it sets branch_id = central, and adds the ORIGINAL
// branch into visible_branches so the supplier still shows at that branch (no loss).
// After this, central manages/opens all suppliers from one place.
//
// SAFE BY DEFAULT: no flag = dry run (prints the plan, changes nothing). Add --live.
// Idempotent: suppliers already owned by central are skipped, so re-running is safe.
//   node scripts/consolidate-suppliers-to-central.mjs           # preview
//   node scripts/consolidate-suppliers-to-central.mjs --live    # apply
// Requires Node 18+. Anon key is publishable; RLS is off on suppliers.
// ─────────────────────────────────────────────────────────────────────────────
const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const LIVE = process.argv.includes("--live");

async function sb(path, opts = {}) {
  const r = await fetch(`${SUPA_URL}/rest/v1/${path}`, { ...opts, headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", ...(opts.headers || {}) } });
  if (!r.ok) throw new Error(`${r.status} ${await r.text()}`);
  const t = await r.text(); return t ? JSON.parse(t) : [];
}

(async () => {
  console.log(LIVE ? "🚀 LIVE — reassigning suppliers to central" : "🔎 DRY RUN — preview only (add --live to apply)");
  const branches = await sb("branches?select=id,name,type&order=id.asc");
  const central = branches.find(b => b.type === "central");
  if (!central) { console.error("⛔ ไม่พบสาขาครัวกลาง (type=central) — ยกเลิก"); process.exit(1); }
  const centralId = +central.id;
  const bName = id => { const b = branches.find(x => +x.id === +id); return b ? b.name : `#${id}`; };
  console.log(`ครัวกลาง = ${central.name} (id ${centralId})\n`);

  const suppliers = await sb("suppliers?select=id,name,branch_id,visible_branches&order=id.asc");
  const legacy = suppliers.filter(s => +s.branch_id !== centralId);
  console.log(`ซัพพลายทั้งหมด ${suppliers.length} · ครัวกลางอยู่แล้ว ${suppliers.length - legacy.length} · ต้องย้าย ${legacy.length}\n`);

  // Heads-up on duplicate names (all become central-owned; user may want to merge manually)
  const byName = new Map();
  for (const s of suppliers) { const k = (s.name || "").trim().toLowerCase(); if (!byName.has(k)) byName.set(k, []); byName.get(k).push(s); }
  const dups = [...byName.values()].filter(a => a.length > 1);
  if (dups.length) {
    console.log(`⚠️  ชื่อซ้ำ ${dups.length} กลุ่ม (ย้ายได้ปกติ แต่จะเป็นคนละการ์ด — รวมเองทีหลังถ้าต้องการ):`);
    dups.slice(0, 20).forEach(a => console.log(`   "${a[0].name}" ×${a.length}`));
    console.log("");
  }

  let done = 0, failed = 0;
  for (const s of legacy) {
    const orig = +s.branch_id;
    const vb = Array.isArray(s.visible_branches) ? s.visible_branches.map(Number) : [];
    if (!vb.includes(orig)) vb.push(orig);
    if (!LIVE) { console.log(`  [dry] #${s.id} "${s.name}" : ${bName(orig)} → ครัวกลาง · เปิดให้[${vb.map(bName).join(", ")}]`); continue; }
    try { await sb(`suppliers?id=eq.${s.id}`, { method: "PATCH", headers: { Prefer: "return=minimal" }, body: JSON.stringify({ branch_id: centralId, visible_branches: vb }) }); done++; console.log(`  ✓ #${s.id} "${s.name}" → ครัวกลาง · เปิดให้[${vb.map(bName).join(", ")}]`); }
    catch (e) { failed++; console.log(`  ✗ #${s.id} "${s.name}": ${e.message}`); }
  }

  console.log(`\n──────────────────────────────`);
  if (LIVE) { console.log(`DONE. ย้าย ${done} · ล้มเหลว ${failed}`); if (failed) process.exit(1); }
  else console.log(`DRY DONE. จะย้าย ${legacy.length} ตัว (re-run ด้วย --live เพื่อทำจริง)`);
})().catch(e => { console.error("FATAL:", e.message); process.exit(1); });
