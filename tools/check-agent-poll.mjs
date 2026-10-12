// ════════════════════════════════════════════════════════════════════════
// ตรวจตรรกะ "ดึงเฉพาะบิลที่เปลี่ยน" ของตัวพิมพ์ (print-agent.js)
//
// ไม่ได้เขียนตรรกะเลียนแบบไว้ในนี้ — แต่ "ดึงบล็อกตัดสินใจจริง" ออกจากไฟล์
// มารัน ถ้าวันหลังใครแก้ไฟล์จนเงื่อนไขเพี้ยน เทสต์นี้จะพังทันที
//
// เดิมพัน: พลาด = ครัวไม่ได้ใบ ลูกค้าไม่ได้กิน · ซ้ำ = ทำอาหารสองรอบ
//
// ⚠️ ข้อ 12-13 คือบั๊กจริงที่ตรวจเจอตอนรีวิว (บิลที่เกิดคาบเกี่ยวสองคำขอ
//    ถูกพิมพ์ซ้ำ) — ถ้าใครเผลอเอา `for (const o of orders) live.add(...)`
//    ออกจาก print-agent.js สองข้อนี้จะแดงทันที
// ════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

const SRC = fs.readFileSync(process.env.AGENT_SRC || new URL("../public/print-agent.js", import.meta.url), "utf8");
let pass = 0, fail = 0;
const ok_ = (label, cond) => { if (cond) { pass++; console.log("  OK   " + label); } else { fail++; console.log("  FAIL " + label); } };

// ── ดึงนิพจน์/บล็อกตัดสินใจจริงออกมาจากไฟล์ ───────────────────────────────
const grabLine = (needle) => {
  const ln = SRC.split("\n").find(l => l.includes(needle));
  if (!ln) throw new Error("ไม่พบบรรทัด: " + needle);
  return ln.trim();
};
const grabBetween = (from, to) => {
  const a = SRC.indexOf(from);
  if (a < 0) throw new Error("ไม่พบจุดเริ่ม: " + from);
  const b = SRC.indexOf(to, a);
  if (b < 0) throw new Error("ไม่พบจุดจบ: " + to);
  return SRC.slice(a, b);
};

const changedSrc = grabLine("const changed = heads.filter(");
const wantFullSrc = grabLine("const wantFull =");
const pruneSrc = grabBetween("const live = new Set(", "saveState();");

const changedOf = new Function("heads", "state", changedSrc + " return changed;");
const wantFullOf = new Function("primed", "fullTick", "changed", "FULL_EVERY",
  wantFullSrc.replace("const wantFull =", "return"));
// รันบล็อก prune ตัวจริง — รวมทั้งการรวม orders และตัวกันคำตอบว่างชั่วคราว
const pruneWith = new Function("heads", "orders", "state", pruneSrc + " return live;");

// ── ตรวจว่านิพจน์อ้างของถูกตัว ────────────────────────────────────────────
ok_("prune อิง heads (ไม่ใช่ orders อย่างเดียว)", pruneSrc.includes("heads.map"));
ok_("prune รวม orders เข้าไปด้วย (กันบิลที่เกิดคาบเกี่ยวสองคำขอถูกล้าง)",
  pruneSrc.includes("for (const o of orders) live.add(String(o.id));"));
ok_("ล้างสถานะเฉพาะรอบที่รู้จริงว่ามีบิลเปิดอยู่ (ไม่เชื่อคำตอบว่าง)",
  pruneSrc.includes("if (heads.length > 0) {"));
ok_("ไม่มีตัวนับ emptyHeads ที่ค้างค่าได้แล้ว", !SRC.includes("emptyHeads"));
// จำว่าพิมพ์อะไรไปแล้วสองชั้น: ในเครื่อง (state) และบนตัวบิล (printed_sig)
// บนตัวบิลคือชั้นที่กันเคส "ปิดบิลผิดแล้วเปิดคืน" ไม่ให้พิมพ์อาหารทั้งโต๊ะซ้ำ (12 ก.ย. 69)
ok_("มาร์ค uat พร้อม sig เฉพาะตอนพิมพ์ผ่าน (และจดลงบิลด้วย)",
  SRC.includes("if (ok) { state.sig[o.id] = sig; state.uat[o.id] = uatOf.get(String(o.id)) || null; if (!_noPrintedSig && o.printed_sig !== sig) rememberPrinted(o.id, sig); }"));
ok_("คำขอรายการคงตัวกรองสถานะไว้ (บิลที่จ่ายแล้วต้องไม่ถูกพิมพ์)",
  SRC.includes('status=neq.paid&status=neq.cancelled`, "id,table_number,items,ordered_by"')
  && SRC.includes('sbCols("orders?status=neq.paid&status=neq.cancelled", "id,table_number,items"'));
ok_("หัวบิลไม่ลาก items มาด้วย",
  SRC.includes("getActiveOrderHeads") && SRC.includes("select=id,updated_at"));

// ── ตัวจำลอง tick — โครงเดียวกับของจริง ใช้บล็อกที่ดึงมา ──────────────────
const FULL_EVERY = 60;
function makeWorld() {
  return {
    state: { sig: {}, init: {}, uat: {}, done: {}, tries: {} },
    primed: true,
    fullTick: 0,
    printed: [],            // ทุกใบที่สั่งพิมพ์ [โต๊ะ, จำนวนรายการ]
    fetchedItemsFor: [],    // บิลที่ต้องเปิดดูรายการในรอบนั้น
  };
}
const sigOf = o => JSON.stringify((o.items || []).map(i => [i.menu_id, i.qty]));
const deltaItems = (lastSig, items) => {
  const sum = rows => { const m = new Map(); for (const [k, q] of rows) m.set(k, (m.get(k) || 0) + q); return m; };
  const old = sum(JSON.parse(lastSig).map(([mid, q]) => [String(mid), q]));
  const cur = sum(items.map(i => [String(i.menu_id), i.qty]));
  const out = [];
  for (const [k, q] of cur) { const d = q - (old.get(k) || 0); if (d > 0) out.push({ menu_id: +k, qty: d }); }
  return out;
};
const openOf = db => db.filter(o => o.status !== "paid" && o.status !== "cancelled");

// opts.printOk       — จำลองกระดาษหมด/เครื่องหลุด
// opts.insertBetween — บิลที่ลูกค้ากดส่ง "คั่นกลาง" ระหว่างคำขอหัวบิลกับคำขอรายการ
// opts.headsEmpty    — จำลองคำขอหัวบิลคืนตัวเปล่าชั่วคราว (แต่บิลยังเปิดอยู่จริง)
// opts.itemsFail     — จำลองคำขอรายการล้ม (tick ออกก่อนถึงขั้นล้างสถานะ)
function tick(w, db, opts) {
  const o_ = opts || {};
  const printOk = o_.printOk !== false;

  // ── คำขอที่ 1: หัวบิล (ถ่ายภาพ ณ เวลา T0)
  const heads = o_.headsEmpty ? [] : openOf(db).map(o => ({ id: o.id, updated_at: o.updated_at }));
  const uatOf = new Map(heads.map(h => [String(h.id), h.updated_at || null]));

  const changed = changedOf(heads, w.state);
  w.fullTick++;
  const wantFull = wantFullOf(w.primed, w.fullTick, changed, FULL_EVERY);

  // ── ช่องว่างระหว่างสองคำขอ: บิลใหม่เกิดขึ้นตรงนี้
  if (o_.insertBetween) db.push(o_.insertBetween);

  // ── คำขอที่ 2: รายการในบิล (ณ เวลา T0+Δ)
  let orders;
  if (wantFull) { orders = openOf(db); w.fullTick = 0; }
  else if (changed.length) orders = openOf(db).filter(o => changed.some(h => h.id === o.id));
  else orders = [];
  // คำขอรายการล้ม = ของจริง return ออกไปเลย ยังไม่ถึงขั้นล้างสถานะ
  if (o_.itemsFail) return;
  w.fetchedItemsFor.push(orders.map(o => o.id));

  for (const o of orders) {
    if (!o || !o.items || !o.items.length) continue;
    const sig = sigOf(o), last = w.state.sig[o.id], first = !w.state.init[o.id];
    let okFlag = true;
    if (first) {
      const items = last ? deltaItems(last, o.items) : o.items;
      if (items.length) { okFlag = printOk; if (okFlag) w.printed.push([o.table_number, items.reduce((s, i) => s + i.qty, 0)]); }
      if (okFlag) w.state.init[o.id] = 1;
    } else if (last && last !== sig) {
      const items = deltaItems(last, o.items);
      if (items.length) { okFlag = printOk; if (okFlag) w.printed.push([o.table_number, items.reduce((s, i) => s + i.qty, 0)]); }
    }
    if (okFlag) { w.state.sig[o.id] = sig; w.state.uat[o.id] = uatOf.get(String(o.id)) || null; }
  }

  pruneWith(heads, orders, w.state);
}

const totalQty = w => w.printed.reduce((s, r) => s + r[1], 0);
const billOf = (id, table, uat, items) => ({ id, table_number: table, status: "open", updated_at: uat, items });

// ── สถานการณ์จริงในร้าน ──────────────────────────────────────────────────
{ // 1) บิลใหม่ พิมพ์ครั้งเดียว แล้วเงียบ
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  for (let i = 0; i < 10; i++) tick(w, db);
  ok_("บิลใหม่ พิมพ์ใบเดียว แล้ว 10 รอบถัดมาเงียบ", w.printed.length === 1 && totalQty(w) === 2);
  ok_("รอบที่ไม่มีอะไรเปลี่ยน ไม่เปิดดูรายการเลย", w.fetchedItemsFor.slice(1, 10).every(a => a.length === 0));
}
{ // 2) ลูกค้าสั่งเพิ่ม — พิมพ์เฉพาะส่วนต่าง
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  tick(w, db); tick(w, db);
  db[0].items = [{ menu_id: 10, qty: 2 }, { menu_id: 11, qty: 3 }]; db[0].updated_at = "T2";
  tick(w, db); tick(w, db); tick(w, db);
  ok_("สั่งเพิ่ม พิมพ์เฉพาะของใหม่ 3 ชิ้น ไม่พิมพ์ซ้ำของเดิม", w.printed.length === 2 && totalQty(w) === 5);
}
{ // 3) สั่งเมนูเดิมซ้ำ — ต้องนับเป็นของใหม่
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  tick(w, db);
  db[0].items = [{ menu_id: 10, qty: 2 }, { menu_id: 10, qty: 2 }]; db[0].updated_at = "T2";
  tick(w, db);
  ok_("สั่งเมนูเดิมซ้ำ ครัวได้ใบเพิ่มอีก 2 ชิ้น", totalQty(w) === 4);
}
{ // 4) กระดาษหมด/เครื่องหลุด — รอบหน้าต้องลองใหม่ ไม่ใช่เงียบถาวร
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  tick(w, db, { printOk: false });
  ok_("พิมพ์ไม่ผ่าน = ยังไม่มาร์ค uat", w.state.uat[1] === undefined);
  tick(w, db, { printOk: false });
  ok_("รอบถัดมายังเปิดดูรายการซ้ำ (ไม่ตัดทิ้ง)", w.fetchedItemsFor[1].length === 1);
  tick(w, db, { printOk: true });
  ok_("พอเครื่องกลับมา พิมพ์ได้ครบใบเดียว ไม่ซ้ำ", w.printed.length === 1 && totalQty(w) === 2);
  tick(w, db); tick(w, db);
  ok_("หลังพิมพ์ผ่านแล้ว ไม่พิมพ์ซ้ำอีก", w.printed.length === 1);
}
{ // 5) ตาข่ายนิรภัยครบรอบ ต้องไม่ทำให้พิมพ์ซ้ำ
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  for (let i = 0; i < 200; i++) tick(w, db);
  ok_("ผ่าน 200 รอบ (มีตาข่ายนิรภัยคั่น) ยังพิมพ์ใบเดียว", w.printed.length === 1);
  const fulls = w.fetchedItemsFor.filter(a => a.length === 1).length;
  ok_("ตาข่ายนิรภัยทำงานจริง (ดึงเต็มเป็นระยะ)", fulls >= 3 && fulls <= 6);
}
{ // 6) ตาข่ายนิรภัยจับของที่หลุด — แก้ items โดยไม่ขยับ updated_at
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  tick(w, db);
  db[0].items = [{ menu_id: 10, qty: 2 }, { menu_id: 99, qty: 1 }];   // ไม่ขยับ updated_at โดยตั้งใจ
  for (let i = 0; i < 58; i++) tick(w, db);
  const beforeNet = w.printed.length;
  tick(w, db); tick(w, db);
  ok_("ถ้ามีทางเขียนไหนลืมขยับ updated_at ตาข่ายนิรภัยยังจับได้ภายใน 5 นาที",
    beforeNet === 1 && w.printed.length === 2);
}
{ // 7) บิลถูกปิดขณะที่โต๊ะอื่นยังเปิดอยู่ — ต้องล้างเฉพาะใบที่ปิด
  const w = makeWorld();
  const db = [
    billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }]),
    billOf(2, "A2", "T1", [{ menu_id: 11, qty: 1 }]),
  ];
  tick(w, db);
  ok_("สองโต๊ะ พิมพ์สองใบ", w.printed.length === 2);
  db[0].status = "paid"; db[0].updated_at = "T2";
  tick(w, db); tick(w, db);
  ok_("บิลที่จ่ายแล้วถูกล้างสถานะ",
    w.state.sig[1] === undefined && w.state.uat[1] === undefined && w.state.init[1] === undefined);
  ok_("โต๊ะที่ยังเปิดอยู่ สถานะไม่ถูกแตะ", w.state.init[2] === 1 && w.state.uat[2] === "T1");
  ok_("บิลจ่ายแล้ว ไม่มีใบเพิ่ม", w.printed.length === 2);
}
{ // 8) โต๊ะเดิมเปิดบิลใหม่หลังปิดบิลเก่า
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  tick(w, db);
  db[0].status = "paid"; tick(w, db);
  db.push(billOf(2, "A1", "T9", [{ menu_id: 10, qty: 1 }]));
  tick(w, db);
  ok_("โต๊ะเดิมเปิดบิลใหม่ ได้ใบใหม่ 1 ใบ (ไม่ปนกับบิลเก่า)", w.printed.length === 2 && totalQty(w) === 3);
}
{ // 9) อัปเกรดจาก v27 — ไฟล์สถานะเดิมมี sig/init แต่ไม่มี uat
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  w.state.sig[1] = sigOf(db[0]); w.state.init[1] = 1;
  tick(w, db); tick(w, db);
  ok_("อัปเกรดจาก v27 ไม่พิมพ์ซ้ำบิลที่ค้างอยู่", w.printed.length === 0);
  ok_("อัปเกรดแล้วเติม uat ให้เอง รอบถัดมาเงียบ",
    w.state.uat[1] === "T1" && w.fetchedItemsFor[1].length === 0);
}
{ // 10) บิลไม่มี updated_at (ข้อมูลเก่า) — ต้องถือว่าเปลี่ยนเสมอ
  const w = makeWorld();
  const db = [billOf(1, "A1", null, [{ menu_id: 10, qty: 2 }])];
  tick(w, db); tick(w, db); tick(w, db);
  ok_("บิลไม่มี updated_at ยังเปิดดูรายการทุกรอบ (ไม่เสี่ยงพลาด)",
    w.fetchedItemsFor.every(a => a.length === 1) && w.printed.length === 1);
}
{ // 11) พีค 40 บิลเปลี่ยนพร้อมกัน
  const w = makeWorld();
  const db = Array.from({ length: 40 }, (_, i) => billOf(i + 1, "T" + i, "T1", [{ menu_id: 10, qty: 1 }]));
  tick(w, db);
  ok_("บิลเปลี่ยนพร้อมกัน 40 ใบ พิมพ์ครบ 40 ใบ", w.printed.length === 40);
  ok_("changed เกิน 30 ตกไปทางดึงเต็ม (กัน URL ยาวเกิน)", wantFullOf(true, 1, new Array(31), FULL_EVERY) === true);
  ok_("changed 5 ใบ ไม่ต้องดึงเต็ม", wantFullOf(true, 1, new Array(5), FULL_EVERY) === false);
}
{ // 12) ⚠️ บั๊กที่รีวิวเจอ: บิลเกิดคาบเกี่ยวสองคำขอในรอบตาข่ายนิรภัย
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 1 }])];
  for (let i = 0; i < 59; i++) tick(w, db);           // เดินไปจ่อรอบตาข่ายนิรภัย
  const before = w.printed.length;
  // รอบถัดไปเป็นรอบดึงเต็ม — โต๊ะ 7 กดส่งคั่นระหว่างคำขอหัวบิลกับคำขอรายการ
  tick(w, db, { insertBetween: billOf(7, "B7", "T5", [{ menu_id: 20, qty: 3 }]) });
  ok_("บิลที่เกิดคาบเกี่ยว พิมพ์ออกทันทีในรอบนั้น", w.printed.length === before + 1);
  ok_("สถานะของบิลที่เพิ่งพิมพ์ ต้องไม่ถูกล้างทิ้ง", w.state.init[7] === 1);
  tick(w, db); tick(w, db); tick(w, db);
  ok_("รอบถัดมาต้องไม่พิมพ์ซ้ำ (ครัวไม่ทำอาหารสองรอบ)",
    w.printed.length === before + 1 && w.printed.filter(r => r[0] === "B7").length === 1);
}
{ // 13) คำขอหัวบิลคืนตัวเปล่าชั่วคราว ทั้งที่บิลยังเปิดอยู่
  const w = makeWorld();
  const db = Array.from({ length: 9 }, (_, i) => billOf(i + 1, "T" + (i + 1), "T1", [{ menu_id: 10, qty: 2 }]));
  tick(w, db);
  const before = w.printed.length;
  ok_("รอบแรกพิมพ์ครบ 9 โต๊ะ", before === 9);
  for (let i = 0; i < 5; i++) tick(w, db, { headsEmpty: true });   // สะดุดยาว 5 รอบติด
  ok_("คำตอบว่างติดกัน 5 รอบ ยังไม่ล้างสถานะ", w.state.init[1] === 1 && w.state.init[9] === 1);
  tick(w, db);
  ok_("พอกลับมาปกติ ไม่พิมพ์ซ้ำ 9 โต๊ะ", w.printed.length === before);
}
{ // 14) ลำดับที่ผู้ตรวจพิสูจน์: ว่าง -> ดึงรายการล้ม (แต่หัวบิลเห็นบิลเต็มมือ) -> ว่าง
  const w = makeWorld();
  const db = Array.from({ length: 9 }, (_, i) => billOf(i + 1, "T" + (i + 1), "T1", [{ menu_id: 10, qty: 2 }]));
  tick(w, db);
  const before = w.printed.length;
  tick(w, db, { headsEmpty: true });                 // ว่างครั้งที่ 1
  tick(w, db, { itemsFail: true });                  // หัวบิลเห็น 9 ใบ แต่ดึงรายการล้ม
  tick(w, db, { headsEmpty: true });                 // ว่างครั้งที่ 2
  ok_("รอบที่ดึงข้อมูลล้มคั่นกลาง ต้องไม่ทำให้สถานะถูกล้าง", w.state.init[1] === 1 && w.state.init[9] === 1);
  tick(w, db);
  ok_("ไม่พิมพ์ซ้ำทั้งร้านหลังเน็ตสะดุดสลับกับคำตอบว่าง", w.printed.length === before);
}
{ // 15) ปิดร้านจริง แล้วเปิดบิลใหม่ — ของเก่าถูกล้างตอนมีบิลจริง
  const w = makeWorld();
  const db = [billOf(1, "A1", "T1", [{ menu_id: 10, qty: 2 }])];
  tick(w, db);
  db[0].status = "paid";
  tick(w, db); tick(w, db);
  ok_("ร้านว่าง สถานะค้างไว้ก่อน (ไม่เสียหาย คีย์เป็นเลขบิล)", w.state.init[1] === 1);
  db.push(billOf(2, "A2", "T9", [{ menu_id: 11, qty: 1 }]));
  tick(w, db);
  ok_("พอมีบิลใหม่จริง ของเก่าถูกล้าง เหลือแต่บิลที่เปิดอยู่",
    w.state.init[1] === undefined && w.state.init[2] === 1);
  ok_("บิลใหม่พิมพ์ใบเดียว ไม่ปนกับบิลเก่า", w.printed.length === 2);
}



// ── กันพิมพ์ท่วมเมื่อเครื่องหนึ่งล่ม (บั๊กจริง 8 ก.ย. 69) ────────────────
// เครื่อง "ครัว" ต่อไม่ติด → ส่งไม่ผ่าน → ตัวพิมพ์วนส่งใหม่ทั้งชุดทุก 5 วินาที
// เครื่องแคชเชียร์ที่ปกติดีจึงพิมพ์ใบเดิมซ้ำไม่หยุด กระดาษหมดม้วน
{
  const ln = SRC.split("\n").find(l => l.includes("const usable = all.filter("));
  ok_("printItems กรองเครื่องที่พิมพ์ผ่านแล้วออก", !!ln);
  if (ln) {
    const pick = new Function("all", "alreadyDone", ln.trim() + String.fromCharCode(10) + "return usable;");
    const A = { id: 1, name: "ครัว" }, B = { id: 2, name: "แคชเชียร์" };
    ok_("รอบแรกส่งครบทุกเครื่อง", pick([A, B], {}).length === 2);
    ok_("รอบลองใหม่ ข้ามเครื่องที่ผ่านแล้ว (ไม่พิมพ์ซ้ำ)",
      pick([A, B], { 2: 1 }).map(p => p.id).join(",") === "1");
    ok_("ผ่านครบแล้วไม่ส่งอะไรอีก", pick([A, B], { 1: 1, 2: 1 }).length === 0);
  }
  ok_("orphan ดูจากเครื่องทั้งหมด ไม่ใช่เฉพาะที่ยังไม่ส่ง",
    SRC.includes("const orphan = items.filter(it => !all.some(p => printerHandles(p, it, printers)));"));
  ok_("printItems คืนรายชื่อเครื่องที่ผ่าน + รายการที่ไม่ได้พิมพ์", SRC.includes("return { ok: !anyFail, okIds, failedItems, errs };"));
  ok_("tick จำเครื่องที่ผ่านไว้ใน state.done", SRC.includes("const done = state.done[dk] || {};"));
  ok_("ไม่ลองพิมพ์ใหม่เองเลย (เจ้าของสั่ง: ให้แจ้งเตือนแล้วรอพนักงานกด)", !SRC.includes("state.tries"));
  ok_("พิมพ์ไม่สำเร็จต้องบันทึกไว้ให้แอปแจ้งเตือนที่โต๊ะ",
    SRC.includes("async function recordPrintFail(") && SRC.includes("await recordPrintFail(printers, o,"));
  ok_("บันทึกแล้วมาร์คว่าจัดการแล้ว จะได้ไม่วนพิมพ์", SRC.includes("await recordPrintFail(printers, o, (lastResult && lastResult.failedItems) || [], { errs: (lastResult && lastResult.errs) || [] });"));
  ok_("เก็บรายการล้มเหลวไม่ให้บวม (เก็บล่าสุดพอ)", SRC.includes("d.failed = kept.slice(-FAIL_CAP);"));
  ok_("สถานะ done/tries ถูกเก็บกวาดตามบิลที่ปิดไป",
    SRC.includes("Object.keys(state.done)") && SRC.includes("delete state.done[k];"));
  ok_("orphan ไม่นับเป็นความล้มเหลว (ลองใหม่ก็ไม่หาย)", !SRC.includes("orphan.length === 0"));
}


// ── ไฟดับจนแบตหมด แล้วไฟล์ความจำพัง (บั๊กจริง หาเจอ 8 ก.ย. 69) ──────────
// เดิม primed ดูแค่ "ไฟล์มีอยู่ไหม" ไม่ได้ดูว่า "อ่านได้ไหม"
// ไฟล์พังแต่ยังอยู่ = ความจำว่างแต่คิดว่าจำได้ → ทุกบิลกลายเป็นบิลใหม่ → พิมพ์ซ้ำทั้งร้าน
{
  ok_("ไฟล์ความจำพังต้องไม่ทำให้พิมพ์ซ้ำทั้งร้าน", SRC.includes("let primed = stateLoaded;"));
  ok_("แยก 'อ่านได้จริง' ออกจาก 'ไฟล์มีอยู่'",
    SRC.includes("let stateLoaded = false;") && SRC.includes("stateLoaded = true;"));
  ok_("ไม่เหลือการเช็คแบบเก่าที่ดูแค่ไฟล์มีอยู่", !SRC.includes("let primed = fs.existsSync(STATE_FILE)"));
  ok_("เขียนไฟล์แบบทนไฟดับ (เขียนชั่วคราวแล้วสลับชื่อ)",
    SRC.includes("const tmp = STATE_FILE") && SRC.includes("fs.renameSync(tmp, STATE_FILE)"));
  ok_("ไม่เขียนทับไฟล์จริงตรงๆ อีกแล้ว", !SRC.includes("fs.writeFileSync(STATE_FILE, JSON.stringify(state))"));

  // จำลองพฤติกรรม: ไฟล์อ่านได้ = ไม่ prime · อ่านไม่ได้ = prime (ไม่พิมพ์ย้อนหลัง)
  const primedOf = (canRead) => {
    let stateLoaded = false;
    try { if (true) { if (!canRead) throw new Error("พัง"); stateLoaded = true; } } catch {}
    return stateLoaded;
  };
  ok_("ไฟล์ดี = ไม่ prime ใหม่ (ไม่พิมพ์ซ้ำของเก่า)", primedOf(true) === true);
  ok_("ไฟล์พัง = prime ใหม่ (บันทึกว่าเห็นแล้ว ไม่พิมพ์)", primedOf(false) === false);
}

// ── ล้างงานพิมพ์ที่เสร็จแล้วออกจากแถว (แก้เหตุ Disk IO หมด 9 ก.ย. 69) ──
// รูปใบเสร็จ base64 ~24KB ถูกฝากไว้ใน printers.description ให้ตัวพิมพ์มาอ่าน
// แต่ไม่เคยมีใครลบทิ้ง → ถูกอ่านซ้ำทุก 5 วิ และเขียนกลับทั้งก้อนทุก 45 วิ ตลอด 24 ชม.
// ดึง clearPJ ตัวจริงมารันกับ sb/patchPrinter ปลอม แล้วดูว่ามันแตะอะไรบ้าง
{
  const src = grabBetween("function jobStamp(", "// ล้างคำสั่งที่ทำเสร็จแล้วออกจากแถว") + grabBetween("async function clearPJ(", "async function handlePJRequests(");
  let stored = null, patched = null;
  const mk = (desc) => {
    stored = desc;
    const sb = async () => [{ description: stored }];
    const patchPrinter = async (id, d) => { patched = { id, ...d }; stored = d.description; };
    return new Function("sb", "patchPrinter", src + " return clearPJ;")(sb, patchPrinter);
  };

  // งานตรงกับที่เพิ่งพิมพ์ → ต้องลบ pj และเก็บคีย์อื่นไว้ครบ
  patched = null;
  let clearPJ = mk(JSON.stringify({ on: 1, onAt: 111, rcpt: 1, agentSeen: 222, pj: { at: 999, b64: "x".repeat(24000) } }));
  await clearPJ(10, 999);
  const after = JSON.parse(stored);
  ok_("พิมพ์เสร็จแล้ว → ลบงานพิมพ์ออกจากแถว", patched !== null && after.pj === undefined);
  ok_("ลบงานพิมพ์แล้วคีย์อื่นต้องอยู่ครบ",
    after.on === 1 && after.onAt === 111 && after.rcpt === 1 && after.agentSeen === 222);
  ok_("แถวเล็กลงจริง (ไม่ใช่แค่ตั้งเป็นค่าว่าง)", stored.length < 200 && !stored.includes("xxxx"));

  // มีงานใหม่เข้ามาคาบเกี่ยว → ห้ามลบของใหม่ทิ้ง ไม่งั้นใบครัวหายเงียบ
  patched = null;
  clearPJ = mk(JSON.stringify({ on: 1, pj: { at: 1000, b64: "ใหม่" } }));
  await clearPJ(10, 999);
  ok_("งานใหม่เข้ามาระหว่างนั้น → ต้องไม่ลบทิ้ง", patched === null && JSON.parse(stored).pj.at === 1000);

  // ไม่มีงานค้างอยู่แล้ว → ไม่ต้องเขียนอะไรเลย (อย่าเขียนฟรี)
  patched = null;
  clearPJ = mk(JSON.stringify({ on: 1, onAt: 5 }));
  await clearPJ(10, 999);
  ok_("ไม่มีงานค้าง → ไม่เขียนอะไรเลย", patched === null);

  // description พังอ่านไม่ออก → ต้องเงียบ ไม่ใช่ทำตัวพิมพ์ตาย
  patched = null;
  let threw = false;
  clearPJ = mk("{ไม่ใช่ JSON");
  try { await clearPJ(10, 999); } catch { threw = true; }
  ok_("description อ่านไม่ออก → ไม่ล้มทั้งตัวพิมพ์", !threw && patched === null);

  // ต้องถูกเรียกจริงจากขั้นตอนพิมพ์ ไม่ใช่เขียนฟังก์ชันทิ้งไว้เฉยๆ
  ok_("ขั้นตอนพิมพ์เรียกตัวล้างจริง", /await clearPJ\(p\.id, j\.at, ok, err, j\.what\);/.test(SRC));
  // ต้องล้างแม้รอบนี้ไม่ได้พิมพ์ (ของค้างจากเมื่อวานต้องหายด้วย)
  ok_("ของค้างเก่าที่พิมพ์ไปแล้วก็ต้องถูกล้าง",
    SRC.includes("if (!j) continue;") && !/if \(j && String\(state\.printed/.test(SRC));
}

// ── บันทึก "ไม่ออก" ห้ามเขียนทับค่าตั้งเครื่อง (รีวิว 10 ต.ค. 69) ──
// แถวเครื่องพิมพ์เก็บ rcpt (เครื่องใบเสร็จ) / dw (ลิ้นชัก) / สถานะ ไว้ใน description เดียวกับรายการไม่ออก
// เดิมอ่านแถวพลาดแล้วถือว่าว่าง {} เขียนทับทั้งแถว = ใบเสร็จไม่มีเครื่องรับ ลิ้นชักไม่เปิด รายการไม่ออกเดิมหาย
{
  const src = grabBetween("const PJ_FAIL_KEEP_MS", "async function recordPrintFail(");
  const run = async (sbImpl) => {
    let wrote = null;
    const fn = new Function("sb", "patchPrinter", "FAIL_CAP", "console", src + " return pushFail;")(sbImpl, async (id, d) => { wrote = d; }, 60, { log() {} });
    const r = await fn([{ id: 12, ip: "1.1.1.1" }], { id: "x", at: Date.now(), kind: "pj", items: [] });
    return { r, wrote };
  };
  const keep = JSON.stringify({ rcpt: 1, dw: 1, on: 1, failed: [{ id: "old" }] });
  const a = await run(async () => { throw new Error("504"); });
  ok_("อ่านแถวไม่ได้ (504/เน็ตสะดุด) → ไม่เขียนเลย", a.r === false && a.wrote === null);
  const b = await run(async () => []);
  ok_("ไม่เจอแถว → ไม่เขียน", b.r === false && b.wrote === null);
  const c = await run(async () => [{ description: "{พัง" }]);
  ok_("description อ่านไม่ออก → ไม่เขียนทับ", c.r === false && c.wrote === null);
  const d = await run(async () => [{ description: keep }]);
  const dd = d.wrote && JSON.parse(d.wrote.description);
  ok_("อ่านได้ → ต่อท้ายโดยค่าตั้งเครื่องอยู่ครบ", d.r === true && dd && dd.rcpt === 1 && dd.dw === 1 && dd.failed.length === 2);
}

// ── รอบหลัก + รอบเร็วเรียกงานรูป (pj) เดียวกันพร้อมกัน ต้องไม่ล้างงานทิ้งระหว่างอีกรอบรอเครื่อง (รีวิว 10 ต.ค. 69) ──
// เดิมรอบที่สองเห็นว่ามาร์คแล้ว → ล้างงานเป็น "ไม่รู้ผล" ทันที → ผล "ไม่ออก" ที่ตามมา 8 วิให้หลังเขียนไม่ได้
{
  const src = grabBetween("async function handlePJRequests(", "// ปุ่ม \"เช็คสถานะใหม่\"");
  const clears = [], fails = [];
  const state = { printed: {} };
  const fn = new Function("isBluetooth", "pjOf", "state", "saveState", "sendToPrinter", "errOf", "recordJobFail", "clearPJ", "pjInflight", "Buffer", "console",
    src + " return handlePJRequests;")(
    () => false, (p) => p.pj, state, () => {},
    () => new Promise((_, rej) => setTimeout(() => { const e = new Error("t"); e.code = "DRAIN_TIMEOUT"; rej(e); }, 60)),
    (p, e) => ({ pid: p.id, code: e.code }), async (...a) => { fails.push(a); },
    async (id, at, ok, err, what) => { clears.push({ id, at, ok, err, what }); }, new Set(), Buffer, { log() {} });
  const rows = [{ id: 12, ip: "1.1.1.1", pj: { at: 5, b64: "QQ==", what: "ใบเสร็จ" } }];
  await Promise.all([fn(rows), new Promise((r) => setTimeout(r, 10)).then(() => fn(rows))]);
  ok_("สองรอบชนกัน → ส่งครั้งเดียว ล้างครั้งเดียว", clears.length === 1 && fails.length === 1);
  ok_("ผล 'ไม่ออก' ถูกจดพร้อมเหตุ (ไม่ถูกล้างทิ้งเป็นไม่รู้ผล)", clears[0] && clears[0].ok === false && clears[0].err && clears[0].err.code === "DRAIN_TIMEOUT" && clears[0].what === "ใบเสร็จ");
}

// ── ใบครัวต้องบอกได้เสมอว่าไปโต๊ะไหน (เหตุจริง 9 ก.ย. 69) ──
// บิล #17 ออกใบครัวมาโดยไม่มีชื่อโต๊ะเลย ครัวทำเสร็จแล้วไม่รู้จะส่งใคร
// ต้นเหตุอยู่ที่แอป (แก้แล้ว) แต่ใบครัวเองก็ต้องไม่มีทางออกมาเป็นกระดาษไร้ปลายทาง
{
  const src = grabBetween("function tableLabel(o) {", "async function printItems(");
  const tableLabel = new Function(src + " return tableLabel;")();
  ok_("มีชื่อโต๊ะ = ใช้ชื่อโต๊ะตรงๆ", tableLabel({ id: 9, table_number: "C8" }) === "C8");
  ok_("ไม่มีชื่อโต๊ะ = พิมพ์เลขบิลแทน ไม่ใช่ปล่อยว่าง",
    tableLabel({ id: 17, table_number: null }).includes("17") && tableLabel({ id: 17, table_number: null }).includes("ไม่ระบุโต๊ะ"));
  ok_("ชื่อโต๊ะเป็นช่องว่างล้วนก็ถือว่าไม่มี", tableLabel({ id: 5, table_number: "   " }).includes("5"));
  ok_("เลข 0 เป็นชื่อโต๊ะที่ใช้ได้ ห้ามตีเป็นค่าว่าง", tableLabel({ id: 5, table_number: 0 }) === "0");
  ok_("สั่งพิมพ์ใช้ตัวนี้ ไม่ได้ส่งชื่อโต๊ะดิบ", SRC.includes("printItems(items, tableLabel(o), printers, done,"));
  ok_("ส่งเลขบิลและผู้สั่งไปกับใบด้วย", SRC.includes("{ bill: o.id, by: o.ordered_by }") && SRC.includes('"id,table_number,items,ordered_by"'));
  ok_("รายการที่พิมพ์ไม่ผ่านก็บันทึกชื่อโต๊ะแบบเดียวกัน", SRC.includes("table: tableLabel(order),"));
}

// ── พิมพ์ซ้ำต้องออกจริง (เหตุจริง 9 ก.ย. 69) ──────────────────────────────
// v35 เพิ่มพารามิเตอร์ meta ให้ renderItemBufs แล้วไล่แก้จุดเรียกทั้งหมด แต่ itemsToBuffer
// ถูกแก้ให้ "ส่ง meta ต่อ" โดยไม่ได้รับ meta เข้ามาเป็นพารามิเตอร์ → อ้างตัวแปรที่ไม่มีอยู่จริง
// ทุกครั้งที่กดปุ่มพิมพ์ซ้ำ ตัวพิมพ์จึงโยน ReferenceError: meta is not defined
// และเพราะคำสั่งถูกมาร์คว่า "เห็นแล้ว" ก่อนเรนเดอร์ มันจึงหายไปเลย ไม่ลองใหม่ ไม่มีร่องรอย
// ด่านแบบค้นข้อความจับไม่ได้เลย — ต้องดึงฟังก์ชันจริงมา "เรียก" ถึงจะเจอ
{
  const grab = (name) => {
    const st = SRC.indexOf(`function ${name}(`);
    if (st < 0) throw new Error(`ไม่เจอ ${name}`);
    let d = 0;
    for (let j = SRC.indexOf("{", st); j < SRC.length; j++) {
      if (SRC[j] === "{") d++;
      else if (SRC[j] === "}") { d--; if (!d) return SRC.slice(SRC.lastIndexOf("async", st) === st - 6 ? st - 6 : st, j + 1); }
    }
    throw new Error(`อ่าน ${name} ไม่จบ`);
  };

  // ① เรียกของจริง — ถ้ายังอ้างตัวแปรที่ไม่มี จะโยนตรงนี้
  let seen = null, threw = null;
  const itemsToBuffer = new Function("renderItemBufs", "Buffer", "bufsMode",
    grab("itemsToBuffer") + "\nreturn itemsToBuffer;")(
      async (items, tableNum, meta) => { seen = { items, tableNum, meta }; return [{ buf: Buffer.from([1]) }]; },
      Buffer, () => "รูปภาพ");
  let out = null;
  try { out = await itemsToBuffer([{ name: "ทดสอบ", qty: 1 }], "C7", { bill: 41, by: "customer" }); }
  catch (e) { threw = e; }
  ok_("พิมพ์ซ้ำ: เรียกตัวรวมบัฟเฟอร์แล้วไม่ระเบิด", !threw || !String(threw.message));
  ok_("พิมพ์ซ้ำ: ส่งชื่อโต๊ะและข้อมูลใบต่อไปให้ตัวเรนเดอร์ครบ",
    !!seen && seen.tableNum === "C7" && !!seen.meta && seen.meta.bill === 41 && seen.meta.by === "customer");
  ok_("พิมพ์ซ้ำ: ได้บัฟเฟอร์กลับมาจริง", !!out && Buffer.isBuffer(out.buf) && out.buf.length > 0);

  // ② ทุกฟังก์ชันที่ใช้ meta ต้องรับ meta เข้ามาเอง — กันบั๊คชนิดเดียวกันซ้ำอีก
  const bad = [];
  const re = /(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(([^)]*)\)\s*\{/g;
  let m;
  while ((m = re.exec(SRC))) {
    const [, name, params] = m;
    let d = 0, end = -1;
    for (let j = SRC.indexOf("{", m.index + m[0].length - 1); j < SRC.length; j++) {
      if (SRC[j] === "{") d++;
      else if (SRC[j] === "}") { d--; if (!d) { end = j; break; } }
    }
    const body = SRC.slice(m.index, end + 1);
    if (!/\bmeta\b/.test(body)) continue;
    const declared = params.split(",").some(p => p.trim().split("=")[0].trim() === "meta")
      || /\b(?:const|let|var)\s+meta\b/.test(body);
    if (!declared) bad.push(name);
  }
  ok_("ไม่มีฟังก์ชันไหนใช้ meta โดยไม่ได้รับเข้ามา (" + (bad.length ? bad.join(", ") : "ผ่านทุกตัว") + ")", bad.length === 0);

  // ③ เรนเดอร์ล้มต้องไม่กลืนคำสั่งพร้อมทำให้ทั้งรอบตาย — ต้องอยู่ในกันชนเดียวกับการส่ง
  // ดูโครงจริงแทนการเทียบข้อความเป๊ะๆ — ไม่งั้นพอเพิ่มข้อมูลที่ส่งไปกับใบ ด่านก็พังทั้งที่โค้ดถูก
  // ที่ต้องยืนยันคือ "การเรนเดอร์เกิดหลัง try และก่อน sendToPrinter" เท่านั้น
  ok_("พิมพ์ซ้ำ: เรนเดอร์อยู่ในกันชนเดียวกับการส่ง", (() => {
    const h = grab("handleReprintRequests");
    const t = h.indexOf("try {"), r = h.indexOf("itemsToBuffer("), sd = h.indexOf("sendToPrinter(");
    return t >= 0 && r > t && sd > r;
  })());
  // ป้าย "พิมพ์ซ้ำ" บนกระดาษจะขึ้นได้ก็ต่อเมื่อชนิดใบเดินทางครบสามต่อ:
  //   แอปเขียนลงคำสั่ง → ตัวพิมพ์ส่งต่อ → ตัวเรนเดอร์ได้รับ
  // ขาดต่อไหนก็เงียบเหมือนเดิม ครัวเห็นใบซ้ำแล้วทำอีกจาน = ของทิ้งเปล่า
  ok_("พิมพ์ซ้ำ: ส่งชนิดใบและโต๊ะเดิมต่อจากคำสั่งที่แอปฝากไว้", SRC.includes("kind: rp.kind, from: rp.from"));
  ok_("พิมพ์ซ้ำ: ตัวเรนเดอร์ได้รับชนิดใบไปด้วย (ป้ายบนกระดาษถึงจะขึ้น)",
    SRC.includes('kind: (meta && meta.kind) ? String(meta.kind) : ""') && SRC.includes('from: (meta && meta.from) ? String(meta.from) : ""'));
  ok_("พิมพ์ซ้ำ: ยังมาร์คก่อนส่งอยู่ (ห้ามตัวพิมพ์ลองพิมพ์ใหม่เอง)",
    SRC.includes("state.reprinted[p.id] = rp.at; saveState();"));
}

// ════════════════════════════════════════════════════════════════════════
// เตรียมสาขาที่ 2 ขึ้น POS (กาญจนบุรี สาขา 5) ขณะที่ The River (สาขา 8) ใช้จริงอยู่ — 12 ต.ค. 69
// ทุกข้อดึงโค้ดจริงจากตัวพิมพ์มารันกับของปลอม แล้วดูว่า "ส่งไปไหน / เขียนอะไร / ออกเมื่อไร"
// ════════════════════════════════════════════════════════════════════════
const S = SRC.split("\r\n").join("\n"), SL = S.split("\n");
// ดึงก้อนโค้ดระดับบนสุด: จากบรรทัดหัว ถึงบรรทัดปิดตัวแรกหลังบรรทัด until (บรรทัดที่เป็น "}" หรือ "};" ล้วน)
const grabTopBlock = (head, until) => {
  const a = SL.findIndex(l => l.startsWith(head));
  if (a < 0) throw new Error("ไม่พบ: " + head);
  const u = until ? SL.findIndex((l, i) => i >= a && l.startsWith(until)) : a;
  if (u < 0) throw new Error("ไม่พบ: " + until);
  const b = SL.findIndex((l, i) => i > u && (l === "}" || l === "};"));
  return SL.slice(a, b + 1).join("\n");
};
const handlesFn = new Function(grabTopBlock("function printerHandles(p, it, list) {") + "\nreturn printerHandles;")();
// ข้อมูลจริงจากฐาน (GET printers 12 ต.ค. 69): เครื่อง 8/9 ของสาขา 6 · 10/11/12 ของ River
const PR6 = [{ id: 8, name: "ครัว", ip: "10.6.0.111", branch_id: 6, categories: ["หมูกระทะ"] }, { id: 9, name: "แคชเชียร์", ip: "10.6.0.157", branch_id: 6, categories: ["ชาบู", "หมูกระทะ"] }];
const PR8 = [{ id: 10, name: "จานเดียว", ip: "10.8.0.111", branch_id: 8, categories: ["อาหารจานเดียว", "ของทอด"] }, { id: 11, name: "เซตหมู", ip: "10.8.0.157", branch_id: 8, categories: ["ชาบู", "ยำ"] }, { id: 12, name: "แคชเชียร์", ip: "10.8.0.147", branch_id: 8, categories: ["น้ำ"] }];
// ชาบู #95-98 ปักหมุดไว้เครื่อง #8 (ของสาขา 6) แต่เปิดขายหลายสาขา
const SHABU = { name: "ชาบูเล็ก", qty: 1, menu_id: 95, printer_id: 8, category: "ชาบู" };

// ── #2 หมุดเครื่องพิมพ์รายเมนูใช้ได้เฉพาะเครื่องของสาขาที่กำลังพิมพ์ ──
{
  const mk = (sendFails) => {
    const sent = [], orphans = [];
    const fn = new Function("isBluetooth", "renderItemBufs", "printerHandles", "bufsMode", "sendToPrinter", "errOf", "noteOrphan", "console",
      grabTopBlock("async function printItems(") + "\nreturn printItems;")(
      () => false, async (items) => items.map(() => ({ buf: Buffer.from("x"), raster: true })), handlesFn, () => "รูปภาพ",
      async (ip) => { sent.push(ip); if (sendFails && sendFails.includes(ip)) { const e = new Error("t"); e.code = "CONNECT_TIMEOUT"; throw e; } },
      (p, e) => ({ pid: p.id, code: e.code }), async (target, orphan) => { orphans.push({ target: target && target.id, names: orphan.map(i => i.name) }); }, { log() {} });
    return { fn, sent, orphans };
  };
  const a = mk();
  const ra = await a.fn([SHABU], "A1", PR8, {}, {});
  ok_("#2 หมุดชี้เครื่องสาขาอื่น → River ส่งตามหมวด (ชาบู → เซตหมู) ไม่หายเงียบ", a.sent.join() === "10.8.0.157" && a.orphans.length === 0 && ra.ok && ra.failedItems.length === 0);
  const b = mk();
  await b.fn([SHABU], "A1", PR6, {}, {});
  ok_("#2 หมุดชี้เครื่องของสาขาตัวเอง → ยังออกเครื่องนั้นเครื่องเดียว (ไม่ตกไปหาหมวด)", b.sent.join() === "10.6.0.111" && b.orphans.length === 0);
  const c = mk();
  await c.fn([{ ...SHABU, printer_id: "11" }], "A1", PR8, {}, {});
  ok_("#2 หมุดเป็นตัวอักษร '11' ก็ยังจับคู่เครื่อง 11 ได้", c.sent.join() === "10.8.0.157");
  const d = mk();
  await d.fn([{ name: "ของแปลก", qty: 1, printer_id: 99, category: "ไม่มีใครรับ" }], "A1", PR8, {}, {});
  ok_("#2 หมุดชี้เครื่องที่ไม่มี + หมวดไม่มีใครรับ → ไม่พิมพ์ และจดเป็นเมนูไม่มีเครื่องรับที่เครื่องแรกของสาขา", d.sent.length === 0 && d.orphans.length === 1 && d.orphans[0].target === 10);
  const e = mk(["10.8.0.157"]);
  const re = await e.fn([SHABU], "A1", PR8, {}, {});
  ok_("#2 ส่งตามหมวดแล้วเครื่องไม่ออก → รายการเข้ารายการพิมพ์ไม่สำเร็จ (ให้พนักงานกดเอง)", re.ok === false && re.failedItems.length === 1 && re.failedItems[0].name === "ชาบูเล็ก");
  // ไม่ส่งลิสต์มา (โค้ดเก่า) = เชื่อหมุดแบบเดิม — ของเดิมไม่พัง แต่ทุกจุดในตัวพิมพ์ต้องส่งลิสต์
  ok_("#2 printerHandles ไม่มีลิสต์ = เชื่อหมุดแบบเดิม", handlesFn(PR6[1], SHABU) === false && handlesFn({ id: 8, categories: [] }, SHABU) === true);
  const calls = S.match(/printerHandles\([^)]*\)/g) || [];
  const noList = calls.filter(c => !/^printerHandles\(p, it, list\)$/.test(c) && c.split(",").length < 3);
  ok_("#2 ทุกจุดที่ตัวพิมพ์ตัดสินเส้นทาง ส่งลิสต์เครื่องของสาขาไปด้วย (" + calls.length + " จุด)", calls.length >= 6 && noList.length === 0);
}

// ── #12 จด orphan: อ่านของล่าสุดก่อนเขียน · อ่านไม่ได้ไม่เขียน · ชุดเดิมไม่เขียน ──
{
  const block = grabTopBlock("let _orphanLast", "async function noteOrphan(");
  const mk = (sbImpl, patchRes) => {
    const io = { reads: 0, writes: [] };
    const fn = new Function("sb", "patchPrinter", block + "\nreturn noteOrphan;")(
      async (q) => { io.reads++; return sbImpl(q); }, async (id, body) => { io.writes.push({ id, d: JSON.parse(body.description) }); return patchRes; });
    return { fn, io };
  };
  const stale = { id: 10, description: JSON.stringify({ on: 1 }) };   // แคชอายุ 6 วิ — ยังไม่เห็นคำสั่งที่เพิ่งเข้ามา
  const live = { on: 1, rcpt: 1, dw: 1, failed: [{ id: "F1" }], pj: { at: 5, b64: "QQ==" } };
  const A = mk(async () => { throw new Error("504"); });
  ok_("#12 อ่านแถวไม่ได้ → ไม่เขียนเลย (ไม่ทับค่าตั้งเครื่อง)", (await A.fn(stale, [{ name: "น้ำเปล่า" }])) === false && A.io.writes.length === 0);
  const B = mk(async () => [{ description: "{พัง" }]);
  ok_("#12 description อ่านไม่ออก → ไม่เขียน", (await B.fn(stale, [{ name: "น้ำเปล่า" }])) === false && B.io.writes.length === 0);
  const C = mk(async () => []);
  ok_("#12 ไม่เจอแถว → ไม่เขียน", (await C.fn(stale, [{ name: "น้ำเปล่า" }])) === false && C.io.writes.length === 0);
  const D = mk(async () => [{ description: JSON.stringify(live) }]);
  await D.fn(stale, [{ name: "น้ำเปล่า" }, { name: "โค้ก" }, { name: "น้ำเปล่า" }]);
  const w = D.io.writes[0] && D.io.writes[0].d;
  ok_("#12 เขียนทับจากของล่าสุด: คำสั่งใบเสร็จ/ลิ้นชัก/ติ๊กใบเสร็จ/รายการไม่ออก อยู่ครบ",
    D.io.writes.length === 1 && !!w && w.rcpt === 1 && w.dw === 1 && w.failed.length === 1 && w.pj.at === 5 && w.orphan.names.join() === "น้ำเปล่า,โค้ก" && w.orphan.n === 3);
  await D.fn(stale, [{ name: "โค้ก" }, { name: "น้ำเปล่า" }]);
  ok_("#12 บิลถัดไปชุดเดิม (สลับลำดับ) → ไม่อ่าน ไม่เขียนซ้ำ", D.io.reads === 1 && D.io.writes.length === 1);
  await D.fn(stale, [{ name: "ยำ" }]);
  ok_("#12 ชุดเปลี่ยน → อ่านใหม่แล้วเขียน", D.io.reads === 2 && D.io.writes.length === 2 && D.io.writes[1].d.orphan.names.join() === "ยำ");
  const E = mk(async () => [{ description: JSON.stringify({ ...live, orphan: { at: 1, names: ["โค้ก", "น้ำเปล่า"], n: 2 } }) }]);
  await E.fn(stale, [{ name: "น้ำเปล่า" }, { name: "โค้ก" }]);
  ok_("#12 เพิ่งรีสตาร์ท แต่ในแถวเป็นชุดเดียวกันอยู่แล้ว → ไม่เขียน", E.io.reads === 1 && E.io.writes.length === 0);
  const F = mk(async () => [{ description: JSON.stringify(live) }], { ok: false });
  await F.fn(stale, [{ name: "น้ำเปล่า" }]); await F.fn(stale, [{ name: "น้ำเปล่า" }]);
  ok_("#12 เขียนไม่ผ่าน → รอบหน้าลองจดใหม่ (ไม่จำว่าจดแล้ว)", F.io.reads === 2 && F.io.writes.length === 2);
  ok_("#12 printItems ไม่เขียนแถวเครื่องพิมพ์เองอีก (ผ่าน noteOrphan ที่เดียว)",
    !grabTopBlock("async function printItems(").includes("patchPrinter(") && grabTopBlock("async function printItems(").includes("await noteOrphan("));
}

// ── #13 รอบเร็ว 0.8 วิ ต้องถามเฉพาะแถวของสาขานี้ (กรองที่ฐานข้อมูล) ──
{
  // ตัวประเมินเงื่อนไข PostgREST แบบย่อ — พอสำหรับ or=(...) · col.is.null · col.eq.x · col.like.*x* (หลาย or = "และ")
  const cond = (row, c) => {
    const m = c.match(/^([a-z_]+)\.(is|eq|like)\.(.*)$/);
    if (!m) throw new Error("อ่านเงื่อนไขไม่ออก: " + c);
    const v = row[m[1]];
    if (m[2] === "is") return m[3] === "null" ? v == null : false;
    if (m[2] === "eq") return v != null && String(v) === m[3];
    const re = new RegExp("^" + m[3].split("*").map(x => x.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return v != null && re.test(String(v));
  };
  const runQuery = (q, rows) => {
    const params = [...new URLSearchParams(q.slice(q.indexOf("?") + 1))].filter(([k]) => k !== "select" && k !== "order");
    return rows.filter(r => params.every(([k, v]) => k === "or" ? v.replace(/^\(|\)$/g, "").split(",").some(c => cond(r, c)) : cond(r, k + "." + v)));
  };
  const qOf = (branch) => { let q = null; new Function("sb", "BRANCH", grabLine("const getCmdRows = ") + "\nreturn getCmdRows;")(async (x) => { q = x; return []; }, branch)(); return q; };
  const ROWS = [
    { id: 1, branch_id: 5, description: JSON.stringify({ pj: { at: 1, b64: "x".repeat(24000) } }) },   // ใบเสร็จรูปค้างของสาขา 5 (ตัวพิมพ์ดับ)
    { id: 2, branch_id: 8, description: JSON.stringify({ dk: { at: 2 } }) },
    { id: 3, branch_id: null, description: JSON.stringify({ rp: { at: 3, items: [] } }) },
    { id: 4, branch_id: 8, description: JSON.stringify({ on: 1, agentSeen: 9 }) },
    { id: 5, branch_id: 6, description: JSON.stringify({ qr: { at: 4 } }) },
  ];
  const r8 = runQuery(qOf("8"), ROWS).map(r => r.id).join();
  const r5 = runQuery(qOf("5"), ROWS).map(r => r.id).join();
  ok_("#13 River ไม่ดาวน์โหลดใบเสร็จรูปที่ค้างของสาขาอื่น (ได้แค่แถวตัวเอง + ที่ใช้ร่วม)", r8 === "2,3");
  ok_("#13 สาขา 5 เห็นคำสั่งของตัวเองครบ", r5 === "1,3");
  ok_("#13 ยังกรองเฉพาะแถวที่มีคำสั่งค้าง (แถวสถานะล้วนไม่ถูกดึง)", !r8.split(",").includes("4"));
  ok_("#13 รอบเร็วใช้คิวรีที่กรองสาขานี้", S.includes("const rows = (await getCmdRows())") && !/await sb\("printers\?select=id,name,ip,port,branch_id,description/.test(S));
}

// ── #27 เจอเวอร์ชันใหม่: ตั้งธง ไม่เริ่มรอบใหม่ ออกเมื่อรอบหลัก+รอบเร็วจบและบันทึกความจำแล้ว ──
{
  const block = grabTopBlock("let updatePending = 0;", "const tickSafe = async () => {");
  const ka = SL.findIndex((l, i) => l === "  setInterval(async () => {" && SL[i + 1] === "    if (kickBusy) return;");
  const kb = SL.findIndex((l, i) => i > ka && l === "  }, DRAWER_POLL_MS);");
  const kickBody = ka >= 0 && kb > ka ? SL.slice(ka + 1, kb).join("\n") : null;
  ok_("#27 อ่านรอบเร็วตัวจริงได้", !!kickBody);
  const deferred = () => { let r; const p = new Promise(x => { r = x; }); return { p, r }; };
  const mk = (remoteVer, opts) => {
    const o = opts || {};
    const log = [];
    const env = { tickGate: null, kickGate: null, ticks: 0, cmdPolls: 0 };
    const api = new Function("saveState", "process", "console", "fetch", "AGENT_URL", "AGENT_VERSION", "tick", "getCmdRows", "BRANCH",
      "handleDrawerRequests", "handlePJRequests", "handleQRRequests", "handleReprintRequests",
      block + "\nconst kickRound = async () => {\n" + kickBody + "\n};\nreturn { checkUpdate, exitIfIdle, tickSafe, kickRound, st: () => ({ updatePending, tickBusy, kickBusy }) };")(
      () => log.push("save"), { exit: (c) => log.push("exit:" + c) }, { log() {} },
      async () => { if (o.netFail) throw new Error("offline"); return { text: async () => `const AGENT_VERSION = ${remoteVer};` }; }, "http://x", 47,
      async () => { env.ticks++; log.push("tick"); if (env.tickGate) await env.tickGate.p; },
      async () => { env.cmdPolls++; return [{ id: 10, branch_id: 8, description: "{}" }]; }, "8",
      async () => { log.push("kick"); if (env.kickGate) await env.kickGate.p; }, async () => {}, async () => {}, async () => {});
    return { api, log, env };
  };
  { const { api, log } = mk(48);
    await api.checkUpdate();
    ok_("#27 ว่างอยู่ → บันทึกความจำแล้วออกทันที", log.join() === "save,exit:0"); }
  { const { api, log, env } = mk(48);
    env.tickGate = deferred();
    const t = api.tickSafe();
    await api.checkUpdate();
    ok_("#27 กำลังพิมพ์รอบหลัก → ยังไม่ออก (ตั้งธงไว้)", !log.some(x => x.startsWith("exit")) && api.st().updatePending === 48);
    await api.tickSafe();
    ok_("#27 รอบหลักยังไม่จบ → ไม่เริ่มรอบซ้อน", env.ticks === 1);
    env.tickGate.r(); await t;
    ok_("#27 รอบหลักจบ → บันทึกความจำ แล้วออกครั้งเดียว", log.join() === "tick,save,exit:0"); }
  { const { api, log, env } = mk(48);
    env.kickGate = deferred();
    const k = api.kickRound();
    await new Promise(r => setTimeout(r, 0));
    await api.checkUpdate();
    await api.tickSafe();
    ok_("#27 รอบเร็ว (ลิ้นชัก/ใบเสร็จ) กำลังส่ง → ไม่ออก และไม่เริ่มรอบหลักใหม่", !log.some(x => x.startsWith("exit")) && env.ticks === 0);
    env.kickGate.r(); await k;
    ok_("#27 รอบเร็วจบ → บันทึกความจำ แล้วออก", log.join() === "kick,save,exit:0");
    const polls = env.cmdPolls;
    await api.kickRound();
    ok_("#27 รออัปเดตอยู่ → รอบเร็วไม่ถามคำสั่งใหม่", env.cmdPolls === polls); }
  { const { api, log } = mk(47); await api.checkUpdate();
    ok_("#27 เวอร์ชันเท่าเดิม → ไม่ตั้งธง ไม่ออก", log.length === 0 && api.st().updatePending === 0); }
  { const { api, log } = mk(48, { netFail: true }); await api.checkUpdate();
    ok_("#27 เช็คเวอร์ชันไม่ได้ (เน็ตสะดุด) → ทำงานต่อตามปกติ", log.length === 0); }
  ok_("#27 ไม่เหลือการออกทันทีตอนเจอเวอร์ชันใหม่", (S.match(/process\.exit\(0\)/g) || []).length === 1 && grabTopBlock("function exitIfIdle(").includes("process.exit(0)"));
}

console.log("\n" + "=".repeat(52));
console.log(fail === 0 ? "OK ผ่านทั้งหมด " + pass + " ข้อ" : "FAIL ล้มเหลว " + fail + " ข้อ (ผ่าน " + pass + ")");
process.exitCode = fail ? 1 : 0;
