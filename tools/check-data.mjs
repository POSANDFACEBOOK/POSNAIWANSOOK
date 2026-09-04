#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// NAIWANSOOK FOODCOST — หมอตรวจข้อมูล (อ่านอย่างเดียว ไม่แก้อะไรทั้งสิ้น)
//
//   node tools/check-data.mjs
//
// รวมตัวตรวจทุกตัวที่เคยใช้จับบั๊คจริงมาแล้ว ให้รันซ้ำได้ทุกเมื่อ
// เป้าหมาย: เจอความเพี้ยนของข้อมูลก่อนพนักงานเจอ ทุกข้อที่ตรวจคือบั๊คที่เคยเกิดจริง
// ══════════════════════════════════════════════════════════════════════════
const U = "https://niplvsfxynrufiyvbwme.supabase.co/rest/v1";
const K = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";
const H = { apikey: K, Authorization: `Bearer ${K}` };
const gAll = async (p, pg = 1000) => {
  const out = [];
  for (let f = 0; ; f += pg) {
    const r = await fetch(`${U}/${p}`, { headers: { ...H, Range: `${f}-${f + pg - 1}` } });
    if (!r.ok) throw new Error(`${p} → ${r.status}`);
    const c = await r.json(); out.push(...c);
    if (c.length < pg) break;
  }
  return out;
};

let warns = 0;
const section = (t) => console.log(`\n═══ ${t} ═══`);
const ok = (t) => console.log(`  ✅ ${t}`);
const warn = (t, rows = []) => {
  warns++;
  console.log(`  ⚠️ ${t}`);
  for (const r of rows.slice(0, 8)) console.log(`       · ${r}`);
  if (rows.length > 8) console.log(`       · … อีก ${rows.length - 8} รายการ`);
};

const OPEN_ORD = new Set(["pending_approval", "pending", "approved"]);
const OPEN_PO = new Set(["requested", "open", "shipped", "transfer_pending", "transfer_shipped"]);
// ตัวย่อหน่วยที่เคยทำให้หน่วยแตกจนรวมยอดไม่ได้ (แปลงหมดแล้ว 15/08/2569 — เฝ้าไม่ให้กลับมา)
const BAD_UNITS = new Set(["กก.", "กิโล", "กส.", "แพ็ึค", "แพ็ค.", "กิโลกรัม.", "kg", "KG"]);

const main = async () => {
  console.log(`หมอตรวจข้อมูล FOODCOST · ${new Date().toISOString()}`);
  const [ings, menus, ords, pos, branches, sups] = await Promise.all([
    gAll("ingredients?select=id,name,buy_unit,sub_unit,sub_per_buy,buy_price,convert_to_gram,price_per_gram,stock_by_branch,has_sop,ingredients,supplier_id,supplier_by_branch,visible_branches&order=id.asc"),
    gAll("menus?select=id,name,price,category,visible_branches,ingredients&order=id.asc"),
    gAll("order_requests?select=id,branch_id,supplier_id,supplier_name,status,requested_at,items,stock_pending&order=id.asc"),
    gAll("purchase_orders?select=id,po_number,branch_id,from_branch_id,status,items,stock_pending&order=id.asc"),
    gAll("branches?select=id,name,type,active"),
    gAll("suppliers?select=id,name,visible_branches,active"),
  ]);
  const live = new Set(ings.map((i) => +i.id));
  const liveBranch = new Set(branches.map((b) => String(b.id)));
  const bn = (id) => (branches.find((b) => +b.id === +id) || {}).name || `#${id}`;
  console.log(`วัตถุดิบ ${ings.length} · เมนู ${menus.length} · ใบซัพนอก ${ords.length} · PO ${pos.length}`);

  // ── 1) อ้างถึงวัตถุดิบที่ถูกลบ (เคสจริง: #847 ไอติมช็อกชิพ → ใบรับของค้างถาวร) ──
  section("1) อ้างถึงวัตถุดิบที่ถูกลบไปแล้ว");
  {
    const bad = [];
    for (const m of menus) for (const l of m.ingredients || []) if (+l.ingredientId > 0 && !live.has(+l.ingredientId)) bad.push(`เมนู "${String(m.name).trim()}" → #${l.ingredientId}`);
    for (const i of ings) if (i.has_sop) for (const l of i.ingredients || []) if (+l.ingredientId > 0 && !live.has(+l.ingredientId)) bad.push(`SOP "${String(i.name).trim()}" → #${l.ingredientId}`);
    for (const o of ords) {
      if (OPEN_ORD.has(o.status)) for (const it of o.items || []) { const id = +(it.ingId ?? it.ingredient_id); if (id > 0 && !live.has(id)) bad.push(`ORD-${o.id} [${o.status}] → #${id}`); }
      for (const g of (Array.isArray(o.stock_pending) ? o.stock_pending : [])) for (const it of g.items || []) if (!live.has(+it.ingredient_id)) bad.push(`ORD-${o.id} สต๊อกค้าง → #${it.ingredient_id} (เพิ่มสต๊อกไม่ได้ถาวร)`);
    }
    for (const p of pos) {
      if (OPEN_PO.has(p.status)) for (const it of p.items || []) { const id = +(it.ingredient_id ?? it.ingId); if (id > 0 && !live.has(id)) bad.push(`${p.po_number || "PO#" + p.id} [${p.status}] → #${id}`); }
      for (const g of (Array.isArray(p.stock_pending) ? p.stock_pending : [])) for (const it of g.items || []) if (!live.has(+it.ingredient_id)) bad.push(`${p.po_number || "PO#" + p.id} สต๊อกค้าง → #${it.ingredient_id}`);
    }
    bad.length ? warn(`${bad.length} จุด`, bad) : ok("ไม่มี");
  }

  // ── 2) หน่วยแตก/ตัวย่อ (เคสจริง: กก. 172 รายการ ทำให้ตัวหักของที่สั่งแล้วพลาด) ──
  section("2) หน่วยตัวย่อ/สะกดผิด ที่ทำให้หน่วยเดียวกันแตกเป็นหลายชื่อ");
  {
    const bad = [];
    for (const i of ings) { if (BAD_UNITS.has(String(i.buy_unit || "").trim())) bad.push(`#${i.id} ${String(i.name).trim()} buy_unit="${i.buy_unit}"`); if (BAD_UNITS.has(String(i.sub_unit || "").trim())) bad.push(`#${i.id} sub_unit="${i.sub_unit}"`); }
    for (const o of ords) if (OPEN_ORD.has(o.status)) for (const it of o.items || []) if (BAD_UNITS.has(String(it.unit || "").trim())) bad.push(`ORD-${o.id} "${String(it.name || "").slice(0, 20)}" unit="${it.unit}"`);
    bad.length ? warn(`${bad.length} จุด — จะทำให้ตัวหักของที่สั่งแล้ว/การรวมยอดพลาด`, bad) : ok("ไม่มี");
  }

  // ── 3) หน่วยย่อยตั้งครึ่งเดียว (มีชื่อไม่มีจำนวน หรือกลับกัน) ──
  section("3) หน่วยย่อย (ซื้อลัง-หยิบขวด) ตั้งค่าไม่ครบ");
  {
    const bad = ings.filter((i) => {
      const su = String(i.sub_unit || "").trim(), sp = +i.sub_per_buy || 0;
      return (su && !(sp > 0)) || (!su && sp > 0);
    }).map((i) => `#${i.id} ${String(i.name).trim()} sub_unit="${i.sub_unit}" sub_per_buy=${i.sub_per_buy}`);
    bad.length ? warn(`${bad.length} รายการ — สูตรที่ใช้หน่วยย่อยจะถูกนับเป็นกรัมตรงๆ`, bad) : ok("ไม่มี");
  }

  // ── 4) price_per_gram ไม่ตรงกับ ราคา ÷ กรัม (เคสจริง: 29 รายการถูกปัดตั้งแต่ 29/06) ──
  section("4) ราคาต่อกรัม ไม่ตรงกับ ราคาซื้อ ÷ กรัมต่อหน่วย");
  {
    const bad = ings.filter((i) => {
      const per = +i.convert_to_gram || 0, bp = +i.buy_price || 0, ppg = +i.price_per_gram || 0;
      return per > 0 && bp > 0 && Math.abs(bp / per - ppg) > 1e-6;
    }).map((i) => `#${i.id} ${String(i.name).trim()} เก็บ ${i.price_per_gram} ควร ${(+i.buy_price / +i.convert_to_gram).toFixed(6)}`);
    bad.length ? warn(`${bad.length} รายการ (แก้: update ingredients set price_per_gram=buy_price/convert_to_gram where ...)`, bad) : ok("ไม่มี");
  }

  // ── 5) ใบเปิดที่หน่วยไม่ตรงกับวัตถุดิบ → ตัวหักของที่สั่งแล้วเมิน = เสี่ยงสั่งซ้ำ ──
  section("5) ใบเปิดอยู่ที่หน่วยไม่ตรงกับหน่วยซื้อ/หน่วยย่อยของวัตถุดิบ");
  {
    const ingById = new Map(ings.map((i) => [+i.id, i]));
    const bad = [];
    for (const o of ords) {
      if (!OPEN_ORD.has(o.status)) continue;
      for (const it of o.items || []) {
        const ing = ingById.get(+(it.ingId ?? it.ingredient_id));
        if (!ing) continue;
        const u = String(it.unit || "").trim(), bu = String(ing.buy_unit || "").trim(), su = String(ing.sub_unit || "").trim();
        if (u && bu && u !== bu && u !== su) bad.push(`ORD-${o.id} "${String(it.name || "").slice(0, 22)}" ใบ="${u}" วัตถุดิบ="${bu}"${su ? `/"${su}"` : ""}`);
      }
    }
    bad.length ? warn(`${bad.length} บรรทัด — ไม่ถูกหักจากยอดต้องซื้อ`, bad) : ok("ไม่มี");
  }

  // ── 5.5) ส่วนผสม SOP ถูกตัดนอกการผลิต (เคสจริง: cascade ตัดซ้ำ ฿134,443) ──
  // กติกา: ส่วนผสมย่อยถูกใช้ตอนกด "ผลิต" เท่านั้น (ref_type=production)
  // ถ้ามีแถวที่บอกว่า "ใช้ผลิต X" แต่มาจากการส่ง/รับ PO = ตัดซ้ำกลับมาแล้ว
  section("5.5) ส่วนผสม SOP ถูกตัด/เพิ่ม นอกเส้นทางการผลิต");
  {
    const mv = await gAll("stock_movements?select=id,created_at,branch_id,ingredient_name,delta,reason,ref_type,ref_id&order=id.desc", 1000).catch(() => []);
    const bad = mv.filter((m) => m.ref_type === "sop" || (/^SOP: ผลิต/.test(m.reason || "") && m.ref_type !== "production"));
    if (!bad.length) { ok("ไม่มี — ส่วนผสมถูกตัดที่การผลิตอย่างเดียว"); }
    else {
      const recent = bad.filter((m) => String(m.created_at) > "2026-08-18T12:00");
      const docs = [...new Set(bad.map((m) => m.ref_id))];
      warn(`${bad.length} แถว จาก ${docs.length} เอกสาร${recent.length ? ` · ⛔ ${recent.length} แถวเกิดหลังแก้บั๊ค = กลับมาแล้ว` : " (ของเก่าก่อนแก้ 18/08/2569 — ไม่ใช่ของใหม่)"}`,
        docs.slice(0, 6).map((d) => `${d} · ${bad.filter((m) => m.ref_id === d).length} แถว`));
    }
  }

  // ── 6) ใบเปิดที่เนื้อหาซ้ำกันเป๊ะ (เคสจริง: #2199/#2255 ฿2,656 คู่แฝด) ──
  section("6) ใบเปิดที่สั่งของชุดเดียวกันซ้ำ");
  {
    const fp = (o) => `${+o.branch_id || 0}|${+o.supplier_id || 0}|` + JSON.stringify((o.items || []).map((i) => [+(i.ingId ?? i.ingredient_id) || 0, +(i.qtyNeeded ?? i.qty) || 0]).sort((a, b) => a[0] - b[0] || a[1] - b[1]));
    const m = new Map();
    for (const o of ords) { if (!OPEN_ORD.has(o.status)) continue; const k = fp(o); if (!m.has(k)) m.set(k, []); m.get(k).push(o); }
    const dup = [...m.values()].filter((a) => a.length > 1 && (a[0].items || []).length > 0);
    dup.length ? warn(`${dup.length} กลุ่ม`, dup.map((a) => a.map((o) => `ORD-${o.id}(${o.status})`).join(" = ") + ` · ${bn(a[0].branch_id)} "${String(a[0].supplier_name || "").trim()}"`)) : ok("ไม่มี");
  }

  // ── 7) สต๊อกติดลบ + สต๊อกค้างใต้สาขาที่ไม่มีอยู่ (เคสจริง: สาขา 7 ฿33,239) ──
  section("7) สต๊อกรายสาขา: ติดลบ / ค้างใต้สาขาที่ถูกลบ");
  {
    const ghost = [], neg = [];
    for (const i of ings) for (const [b, v] of Object.entries(i.stock_by_branch || {})) {
      if (v == null || v === "" || +v === 0) continue;
      if (!liveBranch.has(String(b))) ghost.push(`#${i.id} ${String(i.name).trim()} สาขา ${b} = ${v}`);
      else if (+v < 0) neg.push(`#${i.id} ${String(i.name).trim()} ${bn(b)} = ${v}`);
    }
    ghost.length ? warn(`ค้างใต้สาขาที่ไม่มีอยู่ ${ghost.length} จุด — มูลค่านับเข้าบัญชีแต่มองไม่เห็นในแอป`, ghost) : ok("ไม่มีสต๊อกค้างใต้สาขาที่ถูกลบ");
    neg.length ? warn(`ติดลบ ${neg.length} จุด — นับ/ตัดเพี้ยน ควรให้สาขาไปนับใหม่`, neg.slice(0, 8)) : ok("ไม่มีสต๊อกติดลบ");
  }

  // ── 8) เมนูมีราคาแต่ไม่มีสูตร (ต้นทุน=ไม่รู้ ไม่ใช่ 0) ──
  section("8) เมนูที่ขายได้แต่ไม่มีสูตร (กำไรบนรายงานดูดีเกินจริง)");
  {
    const bad = menus.filter((m) => +m.price > 0 && !(Array.isArray(m.ingredients) && m.ingredients.length));
    bad.length ? warn(`${bad.length} เมนู`, bad.map((m) => `#${m.id} "${String(m.name).trim()}" ฿${m.price}`)) : ok("ไม่มี");
  }

  // ── 9) สต๊อกค้างรอเพิ่ม (stock_pending) ทุกใบ — ต้องกดลองใหม่ให้จบ ──
  section("9) สต๊อกค้างรอเพิ่มเข้าระบบ (ใบที่รับของแล้วแต่สต๊อกยังไม่เข้า)");
  {
    const bad = [];
    for (const o of ords) if (Array.isArray(o.stock_pending) && o.stock_pending.length) bad.push(`ORD-${o.id} [${o.status}]`);
    for (const p of pos) if (Array.isArray(p.stock_pending) && p.stock_pending.length) bad.push(`${p.po_number || "PO#" + p.id} [${p.status}]`);
    bad.length ? warn(`${bad.length} ใบ — เปิดใบแล้วกดปุ่ม 🔁 ลองเพิ่มสต๊อกใหม่`, bad) : ok("ไม่มี");
  }

  // ── 11) สาขาถือสต๊อกของที่ "ไม่ได้ติ๊กเปิดให้เห็น" (เคสจริง 27/08/2569: 816 คู่) ──
  // ปุ่มติ๊กเป็นตัวตัดสินว่าสาขาเห็นอะไร — ของที่ไม่ได้ติ๊กจะไม่โผล่ที่สาขานั้น
  // ถ้าสาขายังถือสต๊อกค้างอยู่ = ข้อมูลไม่สอดคล้อง นับก็ไม่ได้ ทิ้งก็บันทึกไม่ได้
  // ครัวกลางต้องเลือก: ติ๊กเปิดให้ หรือย้าย/ล้างสต๊อกออก
  section("11) สาขาถือสต๊อกของที่ไม่ได้ติ๊กเปิดให้เห็น");
  {
    const vis = (i, b) => {
      const vb = i.visible_branches;
      if (vb == null || !Array.isArray(vb)) return true;
      if (!vb.length) return false;
      return vb.map(Number).includes(+b);
    };
    const bad = [];
    for (const i of ings) {
      for (const [b, v] of Object.entries(i.stock_by_branch || {})) {
        if (v == null || v === "") continue;
        if (!liveBranch.has(String(b))) continue;          // ข้อ 7 ดูสาขาที่ถูกลบอยู่แล้ว
        if (bn(b) === "ครัวกลาง") continue;                 // ครัวกลางเห็นทุกอย่างเสมอ
        if (vis(i, b)) continue;
        bad.push(`#${i.id} ${String(i.name).trim().slice(0, 26)} @ ${bn(b)} = ${v}`);
      }
    }
    bad.length
      ? warn(`${bad.length} คู่ — สาขาเหล่านี้นับ/ทิ้งของพวกนี้ไม่ได้เลย`, bad)
      : ok("ไม่มี");
  }

  // ── 10) ตารางโตเกินเพดาน 1000 แถวของ PostgREST → ข้อมูลหายเงียบ ──
  // เคสจริง 22/08/2569: assets 1,187 แถว แต่ดึง limit=1000 → บางใหญ่เห็นสินทรัพย์
  // 82 จาก 188 (หาย 106) ไม่มี error ไม่มีอะไรบอกว่าโดนตัด
  section("10) ตารางที่โตจนใกล้/เกินเพดาน 1000 แถวต่อคำขอ");
  {
    const countOf = async (t) => {
      const r = await fetch(`${U}/${t}?select=id&limit=1`, { headers: { ...H, Prefer: "count=exact" } });
      return +(String(r.headers.get("content-range") || "").split("/")[1] || 0);
    };
    // ตารางที่แอปดึง "ทั้งตาราง" ในคำขอเดียว — ถ้าโตเกิน 1000 ต้องแบ่งหน้า
    const WHOLE_TABLE = ["assets", "ingredients", "menus", "suppliers", "categories", "branches"];
    const bad = [];
    for (const t of WHOLE_TABLE) {
      try {
        const n = await countOf(t);
        if (n > 900) bad.push(`${t} = ${n} แถว${n > 1000 ? " ⛔ เกินเพดานแล้ว — ต้องใช้ sbAll() แบ่งหน้า" : " ⚠️ ใกล้เพดาน"}`);
      } catch { /* อ่านไม่ได้ก็ข้าม */ }
    }
    bad.length ? warn(`${bad.length} ตาราง`, bad) : ok("ทุกตารางที่ดึงทั้งก้อนยังต่ำกว่า 900 แถว");
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(warns === 0 ? "✅ สะอาดทุกข้อ" : `⚠️ พบ ${warns} เรื่องที่ควรจัดการ (รายละเอียดด้านบน)`);
};

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
