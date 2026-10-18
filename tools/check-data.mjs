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
    gAll("menus?select=id,name,price,category,visible_branches,ingredients,printer_id&order=id.asc"),
    gAll("order_requests?select=id,branch_id,supplier_id,supplier_name,status,requested_at,items,stock_pending&order=id.asc"),
    gAll("purchase_orders?select=id,po_number,branch_id,from_branch_id,status,items,stock_pending,vat,total,created_at&order=id.asc"),
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
      const cutoff = new Date(Date.now() - 7 * 864e5).toISOString();
      const recent = bad.filter((m) => String(m.created_at) > cutoff);
      const last = String(bad.map((m) => m.created_at).sort().pop() || "").slice(0, 10);
      const docs = [...new Set(bad.map((m) => m.ref_id))];
      if (!recent.length) {
        ok(`ไม่มีของใหม่ใน 7 วัน — แถวเก่า ${bad.length} แถว ครั้งสุดท้าย ${last}`);
      } else {
        const rdocs = [...new Set(recent.map((m) => m.ref_id))];
        warn(`⛔ ${recent.length} แถวเกิดใน 7 วันล่าสุด = บั๊คกลับมาแล้ว (ของเก่ารวม ${bad.length} แถว)`,
          rdocs.slice(0, 6).map((d) => `${d} · ${recent.filter((m) => m.ref_id === d).length} แถว`));
      }
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
    // assets ถูกแก้ให้แบ่งหน้าด้วย sbAll() แล้ว (commit 6332a49) จึงไม่อยู่ในรายการเฝ้าอีก
    const WHOLE_TABLE = ["ingredients", "menus", "suppliers", "categories", "branches"];
    const bad = [];
    for (const t of WHOLE_TABLE) {
      try {
        const n = await countOf(t);
        if (n > 900) bad.push(`${t} = ${n} แถว${n > 1000 ? " ⛔ เกินเพดานแล้ว — ต้องใช้ sbAll() แบ่งหน้า" : " ⚠️ ใกล้เพดาน"}`);
      } catch { /* อ่านไม่ได้ก็ข้าม */ }
    }
    bad.length ? warn(`${bad.length} ตาราง`, bad) : ok("ทุกตารางที่ดึงทั้งก้อนยังต่ำกว่า 900 แถว");
  }

  // ── 11) หมวดเมนูที่เมนูใช้อยู่ แต่ไม่มีแถวในตาราง categories ──
  // หมวดเมนูมีสองแหล่ง: แถวในตาราง (ใช้ทำชิป/แก้ชื่อ/ลบ) กับข้อความบน menus.category (ตัวจริงที่ลูกค้าเห็น)
  // หมวดที่ไม่มีแถว = จอเมนูแก้ชื่อไม่ได้ ลบไม่ได้ เพราะไม่มีแถวให้แก้
  // เคสจริง 24/09/2569: 7 หมวด (เมนูใช้อยู่ 43 ตัว) ไม่มีแถวเลย — สร้างแถวให้แล้ว
  // และเจอหมวดความหมายเดียวกันแยกกันอยู่สองชื่อ ("รีฟิล" 4 เมนู กับ "Refill" 7 เมนู) — รวมเป็นชื่อเดียวแล้ว
  section("11) หมวดเมนู: แถวในตารางกับหมวดที่เมนูใช้จริง ต้องตรงกัน");
  {
    const cats = await gAll("categories?select=id,name,type,branch_id&type=eq.menu");
    const menus = await gAll("menus?select=id,category");
    const rows = new Map();
    for (const c of cats) { if (c.branch_id) continue; const n = String(c.name || "").trim(); if (n) rows.set(n, (rows.get(n) || 0) + 1); }
    const used = new Map();
    for (const m of menus) { const n = String(m.category || "").trim(); if (n) used.set(n, (used.get(n) || 0) + 1); }
    const ghosts = [...used].filter(([n]) => !rows.has(n)).map(([n, c]) => `${n} (เมนูใช้อยู่ ${c} ตัว) — แก้ชื่อ/ลบไม่ได้`);
    const dups = [...rows].filter(([, c]) => c > 1).map(([n, c]) => `${n} มี ${c} แถว — ชิปจะขึ้นซ้ำ`);
    const none = menus.filter((m) => !String(m.category || "").trim()).length;
    const bad = [...ghosts, ...dups];
    if (none) bad.push(`เมนูที่ไม่ได้ระบุหมวดเลย ${none} ตัว`);
    bad.length ? warn(`${bad.length} เรื่อง`, bad) : ok(`หมวดที่ใช้งานอยู่ ${used.size} หมวด มีแถวครบทุกหมวด ไม่มีแถวซ้ำ`);
  }

  // ── 12) บรรทัดสูตรรุ่นเก่าที่เก็บ "เลขที่พิมพ์ + หน่วยที่ไม่ใช่กรัม" (ก่อน 43e8ce2) ──
  // ตัวเลือกวัตถุดิบเดิมบันทึก {amountGram:2, unit:"ฟอง"} แต่ทุกจุด (menuCost/ต้นทุน SOP/ตัดสต๊อกตอนผลิต)
  // อ่าน amountGram เป็นกรัมเสมอ → "2 ฟอง" ถูกคิดเป็น 2 กรัม ต้นทุนต่ำกว่าจริงมาก (เคสจริง: ไข่ไก่ 10 บรรทัด)
  // แก้ข้อมูลต้องให้เจ้าของตัดสินใจ (ต้นทุน/food cost % จะขึ้น) — ตัวนี้แค่นับให้เห็น
  section("12) สูตรรุ่นเก่า: หน่วยไม่ใช่กรัม แต่ระบบคิดเป็นกรัม (ต้นทุนต่ำกว่าจริง)");
  {
    const GRAM_ALIAS = new Set(["กรัม", "ก.", "g", "มล.", "ml", "มิลลิลิตร"]);
    const byId = new Map(ings.map((i) => [+i.id, i]));
    const legacy = (l) => { const u = String(l.unit || "").trim(); return !!u && l.displayAmount == null && !GRAM_ALIAS.has(u); };
    const line = (owner, l) => {
      const g = byId.get(+l.ingredientId) || {};
      const cost = (+g.price_per_gram || 0) * (+l.amountGram || 0);
      return `${owner} → ${String(g.name || "#" + l.ingredientId).trim()} ${l.amountGram} ${l.unit} (คิดเป็น ${l.amountGram} กรัม ≈ ฿${cost.toFixed(2)} · ซื้อเป็น ${g.buy_unit || "-"})`;
    };
    const bad = [];
    for (const m of menus) for (const l of m.ingredients || []) if (legacy(l)) bad.push(line(`เมนู "${String(m.name).trim()}"`, l));
    for (const i of ings) if (i.has_sop) for (const l of i.ingredients || []) if (legacy(l)) bad.push(line(`SOP "${String(i.name).trim()}"`, l));
    bad.length ? warn(`${bad.length} บรรทัด — ครัวกลางต้องเปิดแก้ไข SOP แล้วเลือกวัตถุดิบนั้นใหม่ (จอ SOP ขึ้นป้าย ⚠️ ให้คนแก้ได้เห็น)`, bad) : ok("ไม่มี");
  }

  // ══ 13–19) จอขาย POS / หน้าลูกค้า / ตัวพิมพ์ ══════════════════════════════
  // เพิ่มตอนตรวจความพร้อมก่อนสาขา 5 ย้ายจาก FoodStory (12/10/2569) — ทุกข้อเจอจริง:
  // กะค้าง บิลค้างตั้งแต่ มิ.ย. คำสั่งพิมพ์ค้างหลายเดือน ชาบูปักหมุดเครื่องของสาขาอื่น ชื่อเมนูซ้ำคนละราคา
  const HOUR = 3600e3, now = Date.now();
  const ageTxt = (ms) => ms >= 48 * HOUR ? `${Math.floor(ms / 864e5)} วัน` : ms >= HOUR ? `${Math.floor(ms / HOUR)} ชม.` : `${Math.max(1, Math.round(ms / 60000))} นาที`;
  const p2 = (n) => String(n).padStart(2, "0");
  const thTime = (iso) => { const d = new Date(new Date(iso).getTime() + 7 * HOUR); return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth() + 1)}/${d.getUTCFullYear() + 543} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}`; };
  const bnP = (id) => id == null ? "ทุกสาขา" : bn(id);
  const [shifts, openBills, printers, tables] = await Promise.all([
    gAll("pos_shifts?select=id,branch_id,username,opened_at&status=eq.open&order=opened_at.asc"),
    gAll("orders?select=id,branch_id,table_id,table_number,status,total,created_at&or=(status.is.null,status.not.in.(paid,cancelled))&order=created_at.asc"),
    gAll("printers?select=id,name,branch_id,active,description&order=id.asc"),
    gAll("tables?select=id,branch_id&order=id.asc"),
  ]);
  // กติกาเดียวกับ menuVisibleAt ในแอป: null = เปิดหมด · [] = ปิดหมด · [ids] = เฉพาะที่ระบุ
  const visM = (m, b) => { const vb = m.visible_branches; if (vb == null || !Array.isArray(vb)) return true; if (!vb.length) return false; return vb.map(Number).includes(+b); };
  const posBranch = new Set(tables.map((t) => +t.branch_id));   // สาขาที่มีผังโต๊ะ = ใช้จอขายนี้จริง
  // สาขาที่ขายของ (ไม่นับครัวกลาง) — สาขาที่ใช้จอขายขึ้นก่อน
  const sellers = branches.filter((b) => b.type !== "central" && b.active !== false)
    .sort((a, b) => (posBranch.has(+b.id) - posBranch.has(+a.id)) || (+a.id - +b.id));

  section("13) POS: กะที่เปิดค้างเกิน 24 ชม.");
  {
    const bad = shifts.filter((s) => now - new Date(s.opened_at).getTime() > 24 * HOUR)
      .map((s) => `${bn(s.branch_id)} กะ #${s.id} เปิด ${thTime(s.opened_at)} โดย ${s.username || "-"} (ค้าง ${ageTxt(now - new Date(s.opened_at).getTime())})`);
    bad.length ? warn(`${bad.length} กะ — ยอดขายยังไม่ถูกส่งเข้าบัญชีจนกว่าจะปิดกะ และยอดหลายวันไปกองอยู่ในกะเดียว`, bad) : ok(`ไม่มี (กะที่เปิดอยู่ตอนนี้ ${shifts.length} กะ)`);
  }

  section("14) POS: บิลที่ยังไม่ปิดเกิน 24 ชม.");
  {
    const bad = openBills.filter((o) => now - new Date(o.created_at).getTime() > 24 * HOUR)
      .map((o) => `${bn(o.branch_id)} บิล #${o.id} โต๊ะ ${o.table_number || "-"} [${o.status || "ไม่มีสถานะ"}] ฿${(+o.total || 0).toLocaleString()} เปิด ${thTime(o.created_at)} (ค้าง ${ageTxt(now - new Date(o.created_at).getTime())})`);
    bad.length ? warn(`${bad.length} บิล — โต๊ะขึ้นว่ามีลูกค้าตลอด ปิดกะทุกครั้งจะเตือนโต๊ะค้าง ต้องเก็บเงินหรือยกเลิกบิล`, bad) : ok(`ไม่มี (บิลเปิดอยู่ตอนนี้ ${openBills.length} ใบ)`);
  }

  section("15) POS: โต๊ะที่มีบิลเปิดพร้อมกันมากกว่า 1 ใบ");
  {
    const by = new Map();
    for (const o of openBills) { if (o.table_id == null) continue; const k = +o.table_id; if (!by.has(k)) by.set(k, []); by.get(k).push(o); }
    const bad = [...by.values()].filter((a) => a.length > 1)
      .map((a) => `${bn(a[0].branch_id)} โต๊ะ ${a[0].table_number || "#" + a[0].table_id}: ` + a.map((o) => `บิล #${o.id} ฿${(+o.total || 0).toLocaleString()}`).join(" + "));
    bad.length ? warn(`${bad.length} โต๊ะ — ตัวกัน 1 โต๊ะ 1 บิล (sql/orders-open-per-table.sql) อาจหายไป ใบหนึ่งออกใบครัวแต่ไม่มีใครเก็บเงิน`, bad) : ok("ไม่มี — ทุกโต๊ะมีบิลเปิดไม่เกิน 1 ใบ");
  }

  section("16) เครื่องพิมพ์ที่ไม่ได้ผูกสาขา (branch_id ว่าง)");
  {
    const bad = printers.filter((p) => p.branch_id == null).map((p) => `เครื่อง #${p.id} "${String(p.name || "").trim()}"${p.active === false ? " (ปิดใช้งาน)" : ""}`);
    bad.length ? warn(`${bad.length} เครื่อง — ทุกสาขาเห็นเครื่องนี้ และตัวพิมพ์ทุกสาขาจะส่งงานเข้าเครื่องนี้ ต้องเลือกสาขาให้`, bad) : ok("ไม่มี — ทุกเครื่องผูกสาขาแล้ว");
  }

  section("17) คำสั่งพิมพ์/เปิดลิ้นชัก ที่ค้างเกิน 3 นาที (ตัวพิมพ์ไม่ได้หยิบไปทำ)");
  {
    // คำสั่งเก็บใน printers.description = {at,...} — ตรวจเฉพาะคีย์ที่ตัวพิมพ์ลบเองเมื่อทำเสร็จ (rp/qr/dk/pj)
    // ไม่ตรวจ tp (ทดสอบพิมพ์แบบเก่า): ตัวพิมพ์จำไว้ในเครื่องแต่ไม่เคยลบออกจากแถว ค้างอยู่จนแอปเขียนคำสั่งถัดไป
    // = ค้างแม้กระดาษออกแล้ว ถ้านับจะเตือนผิดให้ไปตามเครื่องที่ปกติ (ทดสอบพิมพ์ตอนนี้ส่งเป็น pj อยู่แล้ว)
    const CMD = { rp: "ใบครัว/พิมพ์ซ้ำ", qr: "QR โต๊ะ", pj: "ใบเสร็จ/รูปภาพ", dk: "เปิดลิ้นชัก" };
    const bad = [];
    for (const p of printers) {
      let d = {};
      try { d = JSON.parse(p.description || "{}") || {}; } catch { continue; }
      for (const [k, label] of Object.entries(CMD)) {
        const v = d[k];
        if (v == null) continue;
        const at = (v && typeof v === "object") ? +v.at : +v;
        const age = at > 0 ? now - at : Infinity;
        if (age > 3 * 60e3) bad.push(`${bnP(p.branch_id)} เครื่อง "${String(p.name || "").trim()}" #${p.id}: ${label} (${k}) ค้าง ${at > 0 ? ageTxt(age) : "ไม่มีเวลา"}`);
      }
    }
    bad.length ? warn(`${bad.length} คำสั่ง — ไม่มีกระดาษออก (ตัวพิมพ์ดับ หรือไม่มีตัวพิมพ์ของสาขานั้น)`, bad) : ok("ไม่มี");
  }

  section("18) เมนูปักหมุดเครื่องพิมพ์ที่สาขาซึ่งขายเมนูนั้นใช้ไม่ได้ (ใบครัวไม่ออก)");
  {
    // printer_id มีช่องเดียวทั้งเครือ: ปักหมุดแล้วเมนูนั้นออก "เครื่องนั้นเครื่องเดียว" ไม่มีทางสำรอง
    // ตัวพิมพ์แต่ละสาขาเห็นเฉพาะเครื่องของสาขาตัวเอง ⟹ สาขาอื่นที่ขายเมนูนี้ สั่งแล้วใบครัวไม่ออก
    // เคสจริง 12/10/2569: ชาบู 4 เมนูปักหมุดเครื่อง "ครัว" ของสาขา 6 แต่เปิดให้เห็นเฉพาะสาขา 2,3,4,5
    const prById = new Map(printers.map((p) => [+p.id, p]));
    const bad = [];
    for (const m of menus) {
      if (m.printer_id == null || m.printer_id === "" || !(+m.price > 0)) continue;
      const see = sellers.filter((b) => visM(m, b.id)).map((b) => +b.id);
      if (!see.length) continue;   // ไม่มีสาขาไหนขาย
      const nm = `#${m.id} "${String(m.name).trim()}"`;
      const p = prById.get(+m.printer_id);
      if (!p) { bad.push(`${nm} ปักหมุดเครื่อง #${m.printer_id} ที่ถูกลบไปแล้ว — ไม่มีสาขาไหนได้ใบครัว`); continue; }
      if (p.active === false) { bad.push(`${nm} ปักหมุดเครื่อง "${String(p.name || "").trim()}" ที่ปิดใช้งานอยู่ — ไม่มีสาขาไหนได้ใบครัว`); continue; }
      if (p.branch_id == null) continue;   // เครื่องทุกสาขา — ข้อ 16 ดูแลอยู่
      const miss = see.filter((b) => b !== +p.branch_id);
      if (!miss.length) continue;
      bad.push(`${nm} ปักหมุด "${String(p.name || "").trim()}" ของ${bn(p.branch_id)}${see.includes(+p.branch_id) ? "" : " (สาขานั้นไม่เห็นเมนูนี้เลย)"} — ใบครัวไม่ออกที่: ${miss.map((b) => bn(b) + (posBranch.has(b) ? " (ใช้จอขาย)" : "")).join(", ")}`);
    }
    bad.length ? warn(`${bad.length} เมนู — เอาหมุดออกให้ไปตามหมวด หรือเปิดให้เห็นเฉพาะสาขาของเครื่องนั้น`, bad) : ok("ไม่มี");
  }

  section("19) ชื่อเมนูซ้ำกันแต่ราคาไม่เท่ากัน ในเมนูที่สาขาเดียวกันเห็น");
  {
    // พนักงาน/ลูกค้าเห็นสองปุ่มชื่อเดียวกัน กดผิดตัว = เก็บเงินผิดราคา (เคสจริง: ข้าวกะเพรา ฿109 กับ ฿89)
    const bad = [];
    for (const b of sellers) {
      const by = new Map();
      for (const m of menus) {
        if (!(+m.price > 0) || !visM(m, b.id)) continue;
        const k = String(m.name || "").trim().replace(/\s+/g, " ").toLowerCase();
        if (!k) continue;
        if (!by.has(k)) by.set(k, []);
        by.get(k).push(m);
      }
      for (const g of by.values()) if (new Set(g.map((m) => +m.price)).size > 1) bad.push(`${bn(b.id)}: "${String(g[0].name).trim()}" ` + g.map((m) => `฿${+m.price} (#${m.id})`).join(" / "));
    }
    bad.length ? warn(`${bad.length} คู่ — ถ้าตั้งใจ (เช่นราคาโปร) ให้ตั้งชื่อต่างกัน ไม่งั้นพนักงาน/ลูกค้ากดผิดตัว`, bad) : ok("ไม่มี");
  }

  section("20) ใบโอนวัตถุดิบคิดเงิน: ยอด/สถานะ/บัญชี ต้องไปด้วยกัน");
  {
    // ใบโอนคิดเงินตั้งแต่ 13 ต.ค. 69 · ใบเก่า (ยอด 0) ต้องจบที่ transfer_done และห้ามถูกตั้งหนี้ย้อนหลัง
    // ใบโอนดูจากเลขใบ TR- ด้วย เพราะใบที่รับแล้วไปอยู่ awaiting_payment/paid เหมือน PO
    const isXfer = (p) => /^transfer_/.test(String(p.status || "")) || /^TR-/.test(String(p.po_number || ""));
    const r2 = (n) => Math.round((+n || 0) * 100) / 100;
    const ms = (t) => { const v = t ? new Date(t).getTime() : NaN; return Number.isFinite(v) ? v : null; };
    // วันเปิดคิดเงิน = เวลาสร้างใบโอนคิดเงินใบแรกในฐาน (ไม่ต้องจำวัน deploy) · ยังไม่มีใบคิดเงิน = ยังไม่เปิด
    const goLive = pos.filter((p) => isXfer(p) && +p.total > 0).map((p) => ms(p.created_at)).filter((v) => v != null).sort((a, b) => a - b)[0] ?? null;
    const bad = [];
    for (const p of pos) {
      if (!isXfer(p) || p.status === "cancelled") continue;
      const tag = `${p.po_number || "#" + p.id} [${p.status}] ${bn(p.from_branch_id)}→${bn(p.branch_id)}`;
      const total = +p.total || 0;
      const items = Array.isArray(p.items) ? p.items : [];
      // มียอดแต่จบที่ transfer_done = รับของแล้วแต่ไม่เคยตั้งหนี้ (เงินหายเงียบ) — หน้า PO ของเวอร์ชันใหม่ซ่อมให้เองตอนเปิดดู
      if (p.status === "transfer_done" && total > 0) bad.push(`${tag} — มียอด ฿${total} แต่จบที่ "โอนเสร็จ" ไม่ได้ตั้งหนี้`);
      // ฿0 แต่รอชำระ/จ่ายแล้ว = หนี้ผี ไม่มีใครจ่ายได้ บัญชีก็ข้าม
      if ((p.status === "awaiting_payment" || p.status === "paid") && !(total > 0)) bad.push(`${tag} — ยอด ฿0 แต่อยู่สถานะ ${p.status}`);
      // ใบ ฿0 ที่สร้างหลังเปิดคิดเงิน = มาจากเครื่องที่ยังไม่รีโหลดแอป · ห้ามตั้งราคาย้อนหลัง แต่ต้องมีคนรู้ (ตามเก็บเงินเอง)
      if (!(total > 0) && goLive != null && (ms(p.created_at) ?? 0) > goLive) bad.push(`${tag} — ใบโอน ฿0 สร้างหลังเปิดคิดเงิน (เครื่องที่ยังไม่รีโหลดแอป) ไม่ได้คิดเงิน`);
      // ยอดหัวใบต้อง = ยอดที่บัญชีเรียกเก็บ (รับจริง×ราคา ปัดครั้งเดียว) — เพี้ยน = จอ/สลิป/บัญชีเห็นคนละเลข
      // รายบรรทัดปัดทีละบรรทัด ⟹ ผลรวมรายบรรทัดต่างจากยอดหัวใบได้ไม่เกินครึ่งสตางค์ต่อบรรทัด
      if (total > 0) {
        const qOf = (it) => (it.received_qty != null ? Math.max(0, Math.min(+it.qty || 0, +it.received_qty || 0)) : +it.qty || 0);
        const billed = r2(r2(items.reduce((s, it) => s + qOf(it) * (+it.price_per_unit || 0), 0)) + (+p.vat || 0));
        if (Math.abs(billed - total) > 0.001) bad.push(`${tag} — ยอดหัวใบ ฿${total} ≠ ยอดที่บัญชีเรียกเก็บ (จำนวน×ราคา) ฿${billed}`);
        const sum = r2(items.reduce((s, it) => s + (+it.line_total || 0), 0) + (+p.vat || 0));
        if (Math.abs(sum - total) > 0.005 * (items.length + 1) + 1e-9) bad.push(`${tag} — ยอดหัวใบ ฿${total} ≠ รวมรายบรรทัด ฿${sum}`);
        const noPrice = items.filter((it) => !(+it.price_per_unit > 0)).map((it) => it.name);
        if (noPrice.length) bad.push(`${tag} — มีรายการไม่มีราคา: ${noPrice.slice(0, 3).join(", ")}`);
      }
    }
    bad.length ? warn(`${bad.length} ใบ — ตรวจเส้นทางเงินของใบโอน`, bad) : ok("ไม่มี");
  }

  // ══ 21) แพ็คเกจบุฟเฟต์ (สาขา 5) ═══════════════════════════════════════════
  // เงินของแพ็คเกจเป็นบรรทัดใน orders.items (kind:"pkg") — ยอดรวมของบิลต้อง = Σ ราคา×จำนวน เสมอ
  // ไม่งั้น VAT/ใบเสร็จ/ใบปิดกะ/ท่อบัญชี (ซึ่งอ่านคนละที่) จะเห็นตัวเลขไม่ตรงกัน
  // บิลล่าสุด 7 วัน + บิลที่ยังเปิดทุกใบ (อ่านอย่างเดียว) · คลังแพ็คเกจอ่านจาก pos_settings.buffet_packages
  const sinceISO = new Date(now - 7 * 24 * HOUR).toISOString();
  const [recentBills, openWithItems] = await Promise.all([
    gAll(`orders?select=id,branch_id,table_id,table_number,status,items,subtotal,created_at&created_at=gte.${encodeURIComponent(sinceISO)}&order=id.asc`),
    gAll("orders?select=id,branch_id,table_id,table_number,status,items,subtotal,created_at&or=(status.is.null,status.not.in.(paid,cancelled))&order=id.asc"),
  ]);
  const billsById = new Map();
  for (const o of [...recentBills, ...openWithItems]) billsById.set(+o.id, o);
  const pkgBills = [...billsById.values()];
  let pkgLib = null;   // null = อ่านคลังไม่ได้ (ยังไม่ได้รัน sql/buffet-packages.sql)
  try { pkgLib = await gAll("pos_settings?select=branch_id,buffet_packages"); } catch { pkgLib = null; }

  section("21) แพ็คเกจบุฟเฟต์: ยอดบิล · บรรทัดแพ็คเกจ · คลังของสาขา");
  {
    const isPkg = (it) => !!it && it.kind === "pkg";
    const r2 = (n) => Math.round((+n || 0) * 100) / 100;
    const tag = (o) => `${bn(o.branch_id)} บิล #${o.id} โต๊ะ ${o.table_number || "-"} [${o.status || "-"}]`;
    const bad = [];
    for (const o of pkgBills) {
      const its = Array.isArray(o.items) ? o.items : [];
      const sum = r2(its.reduce((s, i) => s + (+(i && i.price) || 0) * (+(i && i.qty) || 0), 0));
      if (Math.abs(sum - r2(o.subtotal)) > 0.01) bad.push(`${tag(o)} — ยอด subtotal ฿${r2(o.subtotal)} ≠ Σ ราคา×จำนวน ฿${sum}`);
      const pl = its.filter(isPkg);
      for (const l of pl) if (!((+l.qty || 0) > 0) || (+l.price || 0) < 0 || !Number.isFinite(+l.price)) bad.push(`${tag(o)} — บรรทัดแพ็คเกจ "${l.name}" จำนวน ${l.qty} ราคา ${l.price} (ต้องจำนวน ≥ 1 และราคาไม่ติดลบ)`);
      const ids = [...new Set(pl.map((l) => String((l.pkg && l.pkg.id) ?? "")))];
      if (ids.length > 1) bad.push(`${tag(o)} — มีแพ็คเกจมากกว่า 1 แบบในบิลเดียว (${ids.join(", ")})`);
      if (pl.length && !pl.some((l) => l.pkg && l.pkg.guest && (+l.qty || 0) >= 1)) bad.push(`${tag(o)} — บิลแพ็คเกจไม่มีลูกค้าเลย (ผู้ใหญ่/เด็ก = 0)`);
    }
    if (pkgLib === null) {
      const nPkg = pkgBills.filter((o) => (o.items || []).some(isPkg)).length;
      (nPkg ? warn : ok)(`อ่านคลังแพ็คเกจไม่ได้ — ยังไม่ได้รัน sql/buffet-packages.sql (บิลที่มีแพ็คเกจ ${nPkg} ใบ)`);
    } else {
      const libOf = (b) => { const row = pkgLib.find((r) => +r.branch_id === +b); return Array.isArray(row && row.buffet_packages) ? row.buffet_packages.filter((p) => p && p.id != null) : []; };
      // บิลที่ยังเปิดอยู่ ต้องหาแพ็คเกจเจอ — ไม่เจอ = จอพนักงาน/หน้าลูกค้าสั่งได้แค่เมนูที่อยู่ในบิลแล้ว
      // ลบจากคลัง (active:false) หลังเปิดโต๊ะ = โต๊ะนั้นยังสั่งเมนูของแพ็คเกจได้จนปิดบิล (แจ้งไว้ให้รู้ ไม่ใช่ของเสีย)
      for (const o of pkgBills) {
        if (o.status === "paid" || o.status === "cancelled") continue;
        const l = (o.items || []).find(isPkg);
        if (!l || !l.pkg) continue;
        const def = libOf(o.branch_id).find((p) => String(p.id) === String(l.pkg.id));
        if (!def) bad.push(`${tag(o)} — แพ็คเกจ "${l.pkg.name}" (${l.pkg.id}) ไม่มีในคลังของสาขาแล้ว`);
        else if (def.active === false) bad.push(`${tag(o)} — แพ็คเกจ "${def.name}" ถูกลบจากคลังแล้ว แต่โต๊ะยังเปิดอยู่ (ยังสั่งเมนูเดิมได้จนปิดบิล)`);
      }
      // เมนูในแพ็คเกจที่สาขาไม่ได้ติ๊กเปิดขาย/ถูกลบ = ลูกค้าไม่เห็นทั้งที่อยู่ในแพ็คเกจ (ปุ่มติ๊กชนะเสมอ ห้ามผ่อน)
      const mById = new Map(menus.map((m) => [+m.id, m]));
      for (const row of pkgLib) for (const p of (Array.isArray(row.buffet_packages) ? row.buffet_packages : [])) {
        if (!p || p.active === false) continue;
        const gone = [], hidden = [];
        for (const id of (Array.isArray(p.menu_ids) ? p.menu_ids : [])) {
          const m = mById.get(+id);
          if (!m) gone.push(`#${id}`); else if (!visM(m, row.branch_id)) hidden.push(`"${String(m.name).trim()}" #${m.id}`);
        }
        if (gone.length) bad.push(`${bn(row.branch_id)} แพ็คเกจ "${p.name}" — เมนูถูกลบไปแล้ว: ${gone.slice(0, 5).join(", ")}${gone.length > 5 ? " …" : ""}`);
        if (hidden.length) bad.push(`${bn(row.branch_id)} แพ็คเกจ "${p.name}" — สาขาไม่ได้ติ๊กเปิดขาย: ${hidden.slice(0, 5).join(", ")}${hidden.length > 5 ? " …" : ""}`);
      }
    }
    bad.length ? warn(`${bad.length} จุด — ตรวจบิลแพ็คเกจ/คลังแพ็คเกจ`, bad) : ok(`ไม่มี (ตรวจ ${pkgBills.length} บิล)`);
  }

  console.log(`\n${"═".repeat(50)}`);
  console.log(warns === 0 ? "✅ สะอาดทุกข้อ" : `⚠️ พบ ${warns} เรื่องที่ควรจัดการ (รายละเอียดด้านบน)`);
};

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
