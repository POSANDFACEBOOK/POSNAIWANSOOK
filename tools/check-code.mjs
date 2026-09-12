#!/usr/bin/env node
// ══════════════════════════════════════════════════════════════════════════
// NAIWANSOOK FOODCOST — ตัวตรวจโค้ด (ไม่แตะฐานข้อมูล รันได้ทุกเมื่อ)
//
//   node tools/check-code.mjs        (หรือ npm run check ซึ่งรันตัวนี้ด้วย)
//
// ทุกข้อในนี้กลั่นจากบั๊คที่เคยทำระบบพังจริง — มีไว้กันไม่ให้กลับมาอีก
// แบ่งสองแบบ:
//   ① ทดสอบพฤติกรรม — ดึงฟังก์ชันจริงจากไฟล์มารันด้วยข้อมูลจริง
//   ② ตรวจโครงสร้าง — เช็คว่าตัวกันที่ใส่ไว้ยังอยู่ (บางอย่างดึงมารันไม่ได้)
// ══════════════════════════════════════════════════════════════════════════
import fs from "node:fs";

// อ่านไฟล์แบบตัดตัวขึ้นบรรทัดให้เป็นแบบเดียวเสมอ — CRLF/LF ไม่ใช่ความหมายของด่านใดเลย
// (worktree บนวินโดวส์เช็คเอาต์เป็น CRLF ส่วน repo หลักเป็น LF ⟹ ด่านที่จุดยึด
//  คร่อมหลายบรรทัดจะตกทั้งที่โค้ดถูกต้องทุกอย่าง)
const rd = (p) => fs.readFileSync(p, "utf8").split("\r\n").join("\n");
const APP = rd("src/FoodCostApp.jsx");
const AGENT = rd("public/print-agent.js");
const HTML = rd(process.env.HTML_SRC || new URL("../index.html", import.meta.url));
const PUSH = rd(new URL("../api/push.js", import.meta.url));
const VERCEL = JSON.parse(fs.readFileSync(new URL("../vercel.json", import.meta.url), "utf8"));
const SLIP = rd(new URL("../api/kitchen-slip.js", import.meta.url));
const SLIPPUSH = rd(new URL("../api/sliptrack-push.js", import.meta.url));
const BACKUP = rd(new URL("../api/backup.js", import.meta.url));
const SWEEP = rd(new URL("../api/sliptrack-sweep.js", import.meta.url));
const WATCHDOG = rd(new URL("../.github/workflows/health-watchdog.yml", import.meta.url));

// ── ดึงสคริปต์เลือก manifest จาก index.html มา "รันจริง" ──────────────────
// ไม่ใช่แค่ค้นหาข้อความ — เคยพลาดมาแล้ว: แบ็กสแลชใน regex หายตอนเขียนไฟล์
// กลายเป็น /^d+$/ ซึ่งไม่แมตช์เลขสาขาเลย ทางลัดจึงยังพาไปหลังบ้านเหมือนเดิม
// ด่านที่ค้นแค่ข้อความมองไม่เห็นบั๊กแบบนั้น ต้องรันถึงจะจับได้

// ── ดึง printerHandles ตัวจริงจาก print-agent.js มารัน ────────────────────
// นี่คือกติกาที่ตัดสินว่าใบไหนออกเครื่องไหน ผิดแล้วครัวได้ใบผิด/ไม่ได้ใบ
// ตั้งแต่เลิกใช้ catch-all (categories:null) ยิ่งต้องพิสูจน์ว่ากติกายังตรง
// ── ประกอบสตรีม ESC/POS ของใบ QR: ดึงนิพจน์จริงมารัน ────────────────────
// ใบ QR ประกอบจาก 3 ชิ้น (หัวเป็นรูป → QR เนทีฟ → ท้ายเป็นรูป) ถ้า init/ตัดกระดาษ
// ไม่ตรงจังหวะ กระดาษจะตัดกลางใบหรือใบถัดไปเพี้ยน — ต้องพิสูจน์ ไม่ใช่ค้นข้อความ
// ── ดึงตัวคำนวณแบ่งจ่ายเท่ากันมารัน ──────────────────────────────────────
// เงินล้วนๆ — หารไม่ลงตัวแล้วปล่อยเศษหาย = ร้านเก็บเงินขาดทุกบิล
const splitEvenlyOf = (() => {
  const st = APP.indexOf("const splitEvenly=(total,n)=>{");
  if (st < 0) throw new Error("ไม่เจอ splitEvenly");
  let d = 0, started = false, en = -1;
  for (let i = st; i < APP.length; i++) {
    if (APP[i] === "{") { d++; started = true; }
    else if (APP[i] === "}") { d--; if (started && d === 0) { en = APP.indexOf(";", i) + 1; break; } }
  }
  return new Function(APP.slice(st, en) + " return splitEvenly;")();
})();
const sumOf = a => Math.round(a.reduce((x, y) => x + y, 0) * 100) / 100;

const escHead = (() => {
  const ln = APP.split("\n").find(l => l.includes("const head=[...(opts&&opts.noInit?[]"));
  if (!ln) throw new Error("ไม่เจอบรรทัดประกอบหัวสตรีม");
  return new Function("opts", "bpr", "h", ln.trim() + " return head;");
})();
const escTail = (() => {
  const ln = APP.split("\n").find(l => l.includes("const tail=opts&&opts.noCut?[]"));
  if (!ln) throw new Error("ไม่เจอบรรทัดประกอบท้ายสตรีม");
  return new Function("opts", ln.trim() + " return tail;");
})();
const qrBytesOf = (() => {
  const st = APP.indexOf("function escposQRBytes(payload){");
  if (st < 0) throw new Error("ไม่เจอ escposQRBytes");
  let d = 0, started = false, en = -1;
  for (let i = st; i < APP.length; i++) {
    if (APP[i] === "{") { d++; started = true; }
    else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
  }
  return new Function(APP.slice(st, en) + " return escposQRBytes;")();
})();

const handlesOf = (() => {
  const st = AGENT.indexOf("function printerHandles(p, it) {");
  if (st < 0) throw new Error("ไม่เจอ printerHandles");
  let d = 0, started = false, en = -1;
  for (let i = st; i < AGENT.length; i++) {
    if (AGENT[i] === "{") { d++; started = true; }
    else if (AGENT[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
  }
  return new Function(AGENT.slice(st, en) + " return printerHandles;")();
})();
function pickManifest(search) {
  const st = HTML.indexOf("(function () {");
  const en = HTML.indexOf("})();", st);
  if (st < 0 || en < 0) throw new Error("หาสคริปต์เลือก manifest ใน index.html ไม่เจอ");
  const body = HTML.slice(st, en + 5);
  let href = null, title = null;
  const doc = {
    querySelector: () => ({ setAttribute: (_k, v) => { title = v; } }),
    createElement: () => ({ set href(v) { href = v; }, get href() { return href; } }),
    head: { appendChild: () => {} },
  };
  new Function("location", "document", body)({ search }, doc);
  return { href, title };
}

// ── ดึงตัวสร้าง QR พร้อมเพย์ตัวจริงมารัน แล้วถอด TLV ออกมาตรวจทีละช่อง ────
// นี่คือกระดาษที่ลูกค้าเอาไปสแกนจ่ายเงินจริง ผิดแล้วเงินไม่เข้า/เข้าไม่ครบ
// และไม่มีใครรู้จนกว่าจะกระทบยอดสิ้นวัน — ค้นข้อความไม่พอ ต้องถอดรหัสออกมาดู
const ppGen = (() => {
  const st = APP.indexOf("function genPromptPayPayload(id,amount){");
  if (st < 0) throw new Error("ไม่เจอ genPromptPayPayload");
  let d = 0, started = false, en = -1;
  for (let i = st; i < APP.length; i++) {
    if (APP[i] === "{") { d++; started = true; }
    else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
  }
  return new Function(APP.slice(st, en) + " return genPromptPayPayload;")();
})();
// EMVCo TLV: [tag 2 หลัก][ความยาว 2 หลัก][ค่า] ต่อกันไปเรื่อยๆ
const tlvParse = (str) => {
  const o = {};
  let i = 0;
  while (i + 4 <= str.length) {
    const t = str.slice(i, i + 2), n = +str.slice(i + 2, i + 4);
    if (!Number.isFinite(n) || i + 4 + n > str.length) return null;   // ความยาวเพี้ยน = payload พัง
    o[t] = str.slice(i + 4, i + 4 + n);
    i += 4 + n;
  }
  return i === str.length ? o : null;
};
const crcOK = (p) => {
  if (p.length < 8 || p.slice(-8, -4) !== "6304") return false;
  let crc = 0xFFFF;
  const body = p.slice(0, -4);
  for (let i = 0; i < body.length; i++) {
    crc ^= body.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0") === p.slice(-4);
};
const pp = (id, amt) => { const p = ppGen(id, amt); return { p, t: p ? tlvParse(p) : null }; };

// ── ดึงตัวเทียบลำดับไทยตัวจริงมารัน ─────────────────────────────────────
// ค้นข้อความอย่างเดียวไม่พอ: เขียน .sort(thCmp) ไว้แต่ Collator ตั้ง locale ผิด
// ก็ยังผ่านด่านแบบค้นข้อความ ทั้งที่ลำดับบนจอผิดเหมือนเดิม ต้องเรียงจริงแล้วดูผล
const thCmpOf = (() => {
  const L = APP.split("\n");
  const a = L.find(l => l.startsWith("const _thColl="));
  const b = L.find(l => l.startsWith("const thCmp="));
  if (!a || !b) throw new Error("ไม่เจอตัวเทียบลำดับไทย");
  return new Function(a + "\n" + b + "\nreturn thCmp;")();
})();
const thSort = (arr) => [...arr].sort(thCmpOf);

// ── ดึงตัวจับ "คอลัมน์ยังไม่มี" ตัวจริงมารัน ─────────────────────────────
// ถ้าจับไม่ติด ยกเลิกบิลจะพังทั้งใบจนกว่าจะรัน SQL — ร้านปิดโต๊ะไม่ได้กลางวันเปิด
// ถ้าจับกว้างไป เน็ตหลุดก็จะถูกนับเป็น "คอลัมน์ไม่มี" แล้วยกเลิกแบบไร้ร่องรอยเงียบๆ
const schemaErrRe = (() => {
  const ln = APP.split("\n").find(l => l.includes("const schemaErr=/"));
  if (!ln) throw new Error("ไม่เจอตัวจับ schema error");
  return new Function("err", ln.trim() + " return schemaErr;");   // บรรทัดจริงอ้างตัวแปรชื่อ err
})();
// ── ดึงตัวเลือกรายการบิลในรายงานยอดขายมารัน ──────────────────────────────
const baseListOf = (() => {
  const ln = APP.split("\n").find(l => l.includes("const baseList=filter==="));
  if (!ln) throw new Error("ไม่เจอตัวเลือกรายการบิล");
  return new Function("filter", "paid", "unpaid", "cancelled", ln.trim() + " return baseList;");
})();

// ── รันสคริปต์ล็อกซูมของ index.html จริง แล้วนับว่าผูกตัวดักอะไรไว้บ้าง ──
// ถ้ามี touchmove แบบ passive:false ผูกค้างไว้ที่ document ตั้งแต่โหลดหน้า
// WebKit ต้องรอ JS ตอบก่อนทุกครั้งที่นิ้วขยับถึงจะยอมเลื่อนจอ = ลากนิ้วแล้วหนืดทั้งแอป
// ค้นข้อความไม่พอ ต้องรันแล้วดูว่าตอนโหลดหน้าผูกอะไรไว้จริง
const zoomLock = (() => {
  const st = HTML.indexOf("// ── Lock zoom");
  if (st < 0) throw new Error("ไม่เจอสคริปต์ล็อกซูมใน index.html");
  const b0 = HTML.indexOf("(function () {", st), b1 = HTML.indexOf("})();", b0);
  if (b0 < 0 || b1 < 0) throw new Error("ตัดสคริปต์ล็อกซูมไม่ได้");
  const reg = [];
  const doc = {
    addEventListener: (t, fn, o) => reg.push({ t, fn, o: o || {}, phase: "boot" }),
    removeEventListener: (t, fn) => reg.push({ t, fn, removed: true }),
  };
  const win = { addEventListener: (t, fn, o) => reg.push({ t, fn, o: o || {}, phase: "boot" }) };
  new Function("document", "window", HTML.slice(b0, b1 + 5))(doc, win);
  return { reg, doc };
})();
const bootListeners = (t) => zoomLock.reg.filter(r => r.t === t && r.phase === "boot" && !r.removed);

// ── ดึงตัวแบ่งหน้าตัวจริงมารันกับ sb ปลอมที่จำลองเพดาน 1000 แถวของ PostgREST ──
// PostgREST คืนสูงสุด 1000 แถวโดยไม่บอกอะไรเลย — ไม่ error ไม่เตือน แค่ได้ไม่ครบ
// วัตถุดิบตอนนี้ 931 รายการ อีก 69 รายการจะเริ่มหาย = สต๊อกและต้นทุนคิดจากของไม่ครบ
// เคยเกิดกับตารางสินทรัพย์มาแล้วจริง (1,383 แถว) จึงต้องมีด่านที่รันจริง ไม่ใช่ค้นข้อความ
const sbAllWith = (totalRows) => {
  const st = APP.indexOf("async function sbAll(");
  if (st < 0) throw new Error("ไม่เจอ sbAll");
  let d = 0, started = false, en = -1;
  for (let i = st; i < APP.length; i++) {
    if (APP[i] === "{") { d++; started = true; }
    else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
  }
  const calls = [];
  // sb ปลอม: อ่าน limit/offset จาก path แล้วตัดที่ 1000 แถวเหมือนของจริงเป๊ะ
  const sb = async (path) => {
    calls.push(path);
    const lim = Math.min(+(/limit=(\d+)/.exec(path) || [])[1] || 1000, 1000);
    const off = +(/offset=(\d+)/.exec(path) || [])[1] || 0;
    if (totalRows === "พัง") return { code: "PGRST", message: "ล่ม" };
    return Array.from({ length: Math.max(0, Math.min(lim, totalRows - off)) }, (_, i) => ({ id: off + i }));
  };
  const fn = new Function("sb", APP.slice(st, en) + " return sbAll;")(sb);
  return { fn, calls };
};

// ── ดึงตัวเลือกผู้รับแจ้งเตือนตัวจริงมารัน ────────────────────────────────
// 9 ก.ย. 69 ระบบล่มทั้งเช้า ตัวเฝ้าจับได้และยิงเข้ามาจริง แต่ไม่มีใครได้รับอะไรเลย
// เพราะผู้ติดตามทั้งสองคนผูกกับสาขา ตัวกรอง admin จึงคัดออกหมด = ผู้รับ 0 คน เงียบสนิท
const pickTargets = (subs, adminOnly, branchId) => {
  const st = PUSH.indexOf("const pick = (strictAdmin)");
  const en = PUSH.indexOf("widened = targets.length > 0; }", st);
  if (st < 0 || en < 0) throw new Error("ไม่เจอตัวเลือกผู้รับใน api/push.js");
  const body = PUSH.slice(st, en + 31);
  return new Function("subs", "adminOnly", "branchId", body + " return targets;")(subs, adminOnly, branchId);
};
// ── ดึงตัวกรอง drift ของการสำรองมารัน ────────────────────────────────────
const driftRe = (() => {
  const ln = BACKUP.split("\n").find(l => l.startsWith("const IGNORE_DRIFT"));
  if (!ln) throw new Error("ไม่เจอ IGNORE_DRIFT");
  return new Function(ln + " return IGNORE_DRIFT;")();
})();

// ── ดึงตรรกะการเลือกตัวเลือกเมนูตัวจริงมารัน ─────────────────────────────
// กลุ่ม "บังคับเลือก" เดิมล็อกไว้ที่ 1 อย่างเสมอ · เซตที่ให้เลือก 2 เตาจึงทำไม่ได้
// ร้านต้องไปเขียนบอกในชื่อกลุ่มแทน แล้วระบบก็ยังบังคับแค่ 1 = ลูกค้าจ่ายค่าสองเตาได้เตาเดียว
// ตรงนี้พลาดแล้วลูกค้าได้ของไม่ครบตามที่จ่าย จึงต้องรันจริง ไม่ใช่ค้นข้อความ
// ตรรกะใหม่ (11 ก.ย. 69): นับจำนวนต่อตัวเลือก · กลุ่มบังคับหลายตัวเลือกตัวเดิมซ้ำได้
// ตรรกะอยู่ในคอมโพเนนต์ React (ใช้ sel/setSel/useRef) — ดึงก้อนจริงจาก needOf ถึง pick()
// มาวางในสภาพแวดล้อมจำลองที่มี state แบบซิงค์ ⟹ ทดสอบโค้ดตัวจริง ไม่ใช่เขียนเลียนแบบ
const pickerSrc = (() => {
  const LL = APP.split("\n");
  const a = LL.findIndex(l => l.startsWith("  const needOf=(g)=>"));
  const b = LL.findIndex((l, i) => i > a && l.startsWith("  function pick(g,c){"));
  if (a < 0 || b < 0) throw new Error("ไม่เจอตรรกะตัวเลือกตัวเลือกเมนู");
  return LL.slice(a, b + 1).join("\n");
})();
const newPicker = () => new Function("orderRef", [
  "let sel = {};",
  "const setSel = (f) => { sel = typeof f === 'function' ? f(sel) : f; };",
  "const grps = [];",
  "const cnt = (c) => +sel[c.id] || 0;",
  pickerSrc,
  "return { pick, inc, dec, needOf, countIn, get sel() { return sel; } };",
].join("\n"))({ current: [] });
// แตะตามลำดับ (แตะแถว) แล้วดูว่าได้อะไร — ตัวที่เลือกซ้ำจะออกมาซ้ำตามจำนวน
const tap = (g, ids, P = newPicker()) => {
  for (const id of ids) P.pick(g, g.choices.find(x => x.id === id));
  return g.choices.flatMap(x => Array(+P.sel[x.id] || 0).fill(x.id));
};
const needOfFn = (g) => newPicker().needOf(g);
const G = (n, req, pick) => ({ required: req, pick, choices: Array.from({ length: n }, (_, i) => ({ id: "c" + (i + 1) })) });

// ── ดึงตัวเรียงลำดับหมวดตัวจริงมารัน ──────────────────────────────────────
// ลำดับนี้ใช้ 3 จอ (จอเมนู จอขาย หน้าลูกค้าสแกน) ถ้าเรียงไม่ตรงกัน ลูกค้าเห็นคนละอย่าง
// กับที่พนักงานจัดไว้ ซึ่งเป็นเหตุผลเดียวที่ทำฟีเจอร์นี้
const catSortWith = (() => {
  const L = APP.split("\n");
  const a = L.find(l => l.startsWith("const catOrderOf="));
  // catSorter กินหลายบรรทัด ต้องตัดตามวงเล็บปีกกา ไม่ใช่หยิบบรรทัดเดียว
  const bs = APP.indexOf("const catSorter=");
  let d = 0, started = false, be = -1;
  for (let i = bs; i < APP.length; i++) {
    if (APP[i] === "{") { d++; started = true; }
    else if (APP[i] === "}") { d--; if (started && d === 0) { be = APP.indexOf(";", i) + 1; break; } }
  }
  const b = bs < 0 ? null : APP.slice(bs, be);
  if (!a || !b) throw new Error("ไม่เจอตัวเรียงลำดับหมวด");
  const th1 = L.find(l => l.startsWith("const _thColl="));
  const th2 = L.find(l => l.startsWith("const thCmp="));
  const f = new Function(th1 + "\n" + th2 + "\n" + a + "\n" + b + "\nreturn {catOrderOf,catSorter};")();
  return (settings, names) => names.slice().sort(f.catSorter(f.catOrderOf(settings)));
})();

let pass = 0, fail = 0;
const section = (t) => console.log(`\n─── ${t} ───`);
const ck = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`  ${ok ? "✅" : "❌"} ${label}`);
  if (!ok) console.log(`       ได้ ${JSON.stringify(got)} · ต้องได้ ${JSON.stringify(want)}`);
};
const ok_ = (label, cond) => ck(label, !!cond, true);

// ดึงฟังก์ชันจริงออกจากไฟล์ (นับวงเล็บปีกกา)
const grab = (src, name) => {
  const st = src.indexOf(`function ${name}(`);
  if (st < 0) throw new Error(`ไม่พบฟังก์ชัน ${name}`);
  let d = 0;
  for (let j = src.indexOf("{", st); j < src.length; j++) {
    if (src[j] === "{") d++;
    else if (src[j] === "}") { d--; if (d === 0) return src.slice(st, j + 1); }
  }
  throw new Error(`อ่าน ${name} ไม่จบ`);
};
// ดึงตัวแปรที่เป็นฟังก์ชัน (const ชื่อ = ...) จนจบบล็อก — รองรับหลายบรรทัด
const grabConst = (src, name) => {
  const st = src.indexOf(`const ${name}=`);
  if (st < 0) throw new Error(`ไม่พบ ${name}`);
  let d = 0, started = false;
  for (let j = st; j < src.length; j++) {
    if (src[j] === "{") { d++; started = true; }
    else if (src[j] === "}") { d--; if (started && d === 0) return src.slice(st, src.indexOf(";", j) + 1); }
  }
  throw new Error(`อ่าน ${name} ไม่จบ`);
};

// ══════════════════════════════════════════════════════════════════════════
// ① ใครเห็นอะไร — ปุ่มติ๊ก "เปิด/ปิดให้สาขาเห็น"
//    บั๊คจริง 27/08/2569: เมนูที่ติ๊กออกหมดกลับไปโผล่ทุกสาขา
// ══════════════════════════════════════════════════════════════════════════
section("กติกา: สาขาไหนเห็นอะไร");
{
  const m = {};
  new Function("exports",
    grabConst(APP, "menuVisibleAt") + "\n" +
    grab(APP, "ingVisibleAt") + "\n" + grab(APP, "supVisibleAt") + "\n" +
    "exports.menu=menuVisibleAt;exports.ing=ingVisibleAt;exports.sup=supVisibleAt;")(m);

  for (const [name, f] of [["เมนู", (v, b) => m.menu({ visible_branches: v }, b)],
                           ["วัตถุดิบ", (v, b) => m.ing({ visible_branches: v }, b, false)]]) {
    ck(`${name}: ไม่เคยตั้ง = เปิดให้ทุกสาขา`, f(null, 6), true);
    ck(`${name}: ติ๊กออกหมด = ไม่มีสาขาไหนเห็น`, f([], 6), false);
    ck(`${name}: ระบุสาขา = เฉพาะสาขานั้น`, [f([6], 6), f([6], 3)], [true, false]);
    ck(`${name}: เก็บเป็นสตริงก็ต้องเห็น`, f(["6"], 6), true);
  }
  ck("ครัวกลางเห็นวัตถุดิบทุกอย่างเสมอ", m.ing({ visible_branches: [] }, 1, true), true);
  ck("ซัพ: สาขาเป็นเจ้าของ = เห็น", m.sup({ branch_id: 6, visible_branches: null }, 6), true);
  ck("ซัพ: ไม่ได้เปิดให้ = ไม่เห็น (opt-in)", m.sup({ branch_id: 1, visible_branches: [] }, 6), false);
  ok_("ไม่มีสำเนากติกาเมนูกระจายอยู่ตามจอ", !APP.includes("vb.length===0||vb.includes"));
}

// ══════════════════════════════════════════════════════════════════════════
// ② ใบสั่งครัว — สั่งเมนูเดิมซ้ำต้องออกใบทุกครั้ง
//    บั๊คจริง 04/09/2569: คีย์ซ้ำถูก "ทับ" แทนที่จะ "บวก" → ครัวไม่ได้ใบเลย
// ══════════════════════════════════════════════════════════════════════════
section("ใบสั่งครัว: สั่งเมนูเดิมซ้ำ");
{
  const ma = {};
  new Function("exports", 'const optionsText=()=>"";\n' + grab(AGENT, "sumByKey") + "\n" +
    grab(AGENT, "newItemsVs") + "\nexports.f=newItemsVs;")(ma);
  const st = APP.indexOf("const diffNew=(lastSig,items)=>{");
  const mb = {};
  new Function("exports", APP.slice(st, APP.indexOf("\n    };", st) + 7) + "\nexports.f=diffNew;")(mb);

  const sigA = (it) => JSON.stringify(it.map((i) => [i.menu_id, i.qty, i.note || "", ""]));
  const sigB = (it) => JSON.stringify(it.map((i) => [i.menu_id, i.qty, i.note || ""]));
  const P = (id, qty, note = "") => ({ menu_id: id, qty, note });
  const qty = (rows) => rows.reduce((s, i) => s + i.qty, 0);

  for (const [name, before, add, want] of [
    ["สั่ง 1 → ซ้ำอีก 1", [P(42, 1)], [P(42, 1)], 1],
    ["สั่ง 2 → ซ้ำอีก 2", [P(42, 2)], [P(42, 2)], 2],
    ["สั่ง 2 → ซ้ำอีก 3", [P(42, 2)], [P(42, 3)], 3],
    ["สั่งซ้ำรอบที่สาม", [P(42, 1), P(42, 1)], [P(42, 1)], 1],
    ["คนละเมนู", [P(42, 1)], [P(77, 1)], 1],
    ["เมนูเดิมแต่ใส่หมายเหตุ", [P(42, 1)], [P(42, 1, "ไม่เผ็ด")], 1],
  ]) {
    const after = [...before, ...add];
    ck(`ตัวพิมพ์ · ${name}`, qty(ma.f(sigA(before), after)), want);
    ck(`เบราว์เซอร์ · ${name}`, qty(mb.f(sigB(before), after)), want);
  }
  const same = [P(42, 2), P(77, 1)];
  ck("ไม่มีอะไรเปลี่ยน → ไม่พิมพ์ซ้ำ",
    [ma.f(sigA(same), same).length, mb.f(sigB(same), same).length], [0, 0]);
}

// ══════════════════════════════════════════════════════════════════════════
// ③ ส่วนผสม SOP — ตัดที่การผลิตที่เดียว
//    บั๊คจริง 18/08/2569: cascade ตัดซ้ำ ครัวกลางจ่ายซ้ำ ฿134,443
// ══════════════════════════════════════════════════════════════════════════
section("สูตร SOP: ตัดส่วนผสมตอนผลิต");
{
  const m = {};
  new Function("exports", grab(APP, "sopConsumption") + "\nexports.f=sopConsumption;")(m);
  const salt = { id: 2, name: "เกลือ", buy_unit: "กิโลกรัม", convert_to_gram: 1000 };
  const parent = { id: 1, convert_to_gram: 5000, ingredients: [{ ingredientId: 2, amountGram: 250 }] };
  const map = new Map([[2, salt]]);
  ck("หารด้วยกรัมของตัวลูก ไม่ใช่ตัวแม่", m.f(parent, 1, map)[0].use, 0.25);
  ck("ผลิต 4 หม้อ = 4 เท่า", m.f(parent, 4, map)[0].use, 1);
  ck("ส่วนผสมซ้ำในสูตร รวมก่อนเขียน",
    m.f({ convert_to_gram: 1000, ingredients: [{ ingredientId: 2, amountGram: 100 }, { ingredientId: 2, amountGram: 150 }] }, 1, map).map((r) => r.use), [0.25]);
  ck("สูตรว่าง = ไม่ตัดอะไร", m.f({ ingredients: [] }, 5, map).length, 0);
  ok_("ไม่มี SOP cascade กลับมา", !APP.includes("_cascadeSopChildren"));
}

// ══════════════════════════════════════════════════════════════════════════
// ④ ตัวกันที่ต้องอยู่ — ดึงมารันไม่ได้ ตรวจว่ายังอยู่ในโค้ด
// ══════════════════════════════════════════════════════════════════════════
section("ตัวกันความเสียหาย (ต้องไม่หายไป)");
const guards = [
  ["POS กันกดซ้ำแบบทันที (ไม่ใช่ state ที่ช้า 1 เฟรม)", APP.includes("const setSavingGuard=v=>{savingRef.current=!!v;setSaving(!!v);}")],
  ["เตือนก่อนเช็คบิลที่ยังไม่ส่งครัว", APP.includes('title:"ยังไม่ได้ส่งเข้าครัว"')],
  ["หน้านับสต็อก: ปุ่มปิดถามก่อนทิ้งตัวเลข", APP.includes('onClick={guardedClose} full')],
  ["modal รับของ: ถามก่อนทิ้งข้อมูล", APP.includes("async function closeReceiveGuarded()")],
  ["กล่องยืนยันที่ถูกแทนที่ ปลดล็อกคนที่รอ", APP.includes("if(prev&&prev.resolve){try{prev.resolve(false);}catch{}}")],
  ["Enter ไม่กดยืนยันกล่องลบให้เอง", APP.includes('if(!st||st.opts?.notice!==true)return;')],
  ["ตะกร้าลูกค้าว่าง ไม่ทับออเดอร์ที่ค้าง", APP.includes("if(!cart.length){")],
  ["บิลถูกปิดกลางทาง = แจ้ง ไม่แอบสร้างบิลใหม่", APP.includes('if(sawOpenBill)throw new Error("บิลของโต๊ะนี้เพิ่งถูกปิด')],
  ["เขียนบิลล็อกสถานะด้วย ไม่ใช่แค่ updated_at", APP.includes('&status=neq.paid&status=neq.cancelled`, { method:"PATCH"')],
  ["ยกเลิกรายการ แจ้งครัว", APP.includes("name:`ยกเลิก: ${target.name}`")],
  // เดิมเคยบังคับว่า "รับทุกหมวด" ต้องเก็บเป็น null — เลิกใช้แล้ว (8 ก.ย. 69)
  // เจ้าของสั่งให้ตัดตัวเลือกนั้นทิ้ง ให้ติ๊กหมวดเป็นตัวตัดสินอย่างเดียว
  ["ปิดกะดึงบิลครบทั้งกะ (ไม่ตัดที่ 200)", APP.includes("api.getPOSOrdersSince(currentBranch.id,shift.opened_at)")],
  ["บิลแยกเฉลี่ยส่วนลด", APP.includes("const splitDisc=round2(totalDiscount*ratio);")],
  ["เมนูในมือถือลูกค้ารีเฟรชระหว่างมื้อ", APP.includes("menuPollId=setInterval")],
  ["ยอดลูกค้าคิดสูตรเดียวกับ POS", APP.includes("const custBill=useMemo(()=>{")],
  ["ของค้างในมือถือหมดอายุ", APP.includes("const OUTBOX_MAX_AGE=")],
  ["ตัวพิมพ์: กัน tick ซ้อน", AGENT.includes("let tickBusy = false;")],
  ["ตัวพิมพ์: พิมพ์ไม่ผ่าน = ไม่มาร์คว่าพิมพ์แล้ว (ทั้งในเครื่องและบนบิล)",
    AGENT.includes("if (ok) { state.sig[o.id] = sig; state.uat[o.id] = uatOf.get(String(o.id)) || null; if (!_noPrintedSig && o.printed_sig !== sig) rememberPrinted(o.id, sig); }")],
  // ห้ามตัดสินจากอายุ onAt — ตัวพิมพ์เขียนเฉพาะตอนสถานะเปลี่ยน ค่าเก่าไม่ได้แปลว่าตาย
  ["ป้ายสถานะดูสัญญาณชีพตัวพิมพ์ ไม่ใช่อายุค่าเดิม", APP.includes("const agentOk=h.state===") && !APP.includes("const fresh=age<3*60*1000;")],
  // เจ้าของสั่ง: ให้มีแค่เขียว/แดง ไม่มีสีที่สาม
  ["สถานะเครื่องพิมพ์มีแค่ออนไลน์/ออฟไลน์", !APP.includes("ไม่ได้รายงาน (ตัวพิมพ์อาจหยุด)") && !APP.includes("[p.id]:!agentOk") && APP.includes("const stView=(st)=>st===")],
  ["ช่องตัวเลขไม่มี type=number ดิบ (iOS)", (APP.match(/<input[^>]*type="number"/g) || []).length === 0],
  // หน้าลูกค้าเปิดสาธารณะ (แค่สแกน QR ก็เข้าได้) — สูตรอาหารต้องไม่หลุดไปกับ JSON
  ["หน้าลูกค้าไม่ส่ง ingredients/sop ออกไป", (() => {
    const k = APP.indexOf("getMenusPublic:");
    if (k < 0) return false;
    const ln = APP.slice(k, k + 400);
    if (!ln) return false;
    return !ln.includes("ingredients") && !ln.includes("sop");
  })()],
  ["หน้าลูกค้าโหลดครั้งแรกใช้ getMenusPublic", APP.includes("await Promise.all([api.getMenusPublic(),api.getPOSSettings(branchId)])")],
  ["สถานะของหมดยังเช็คทุก 1 นาที", APP.includes("menuPollId=setInterval(()=>{if(!document.hidden)refreshAvail();},60000)")],
  ["ตัวจับเวลาเมนูเต็มถูกเคลียร์ตอนออกจากหน้า", APP.includes("if(fullPollId)clearInterval(fullPollId);")],
  // เครื่องพิมพ์: จอต้องเห็นเฉพาะของสาขาที่เปิดอยู่ (+ ที่ตั้งเป็นทุกสาขา)
  // ถ้าหลุดกติกานี้ จะเห็นเครื่องของสาขาอื่น กดสั่งพิมพ์แล้วไม่มีตัวไหนรับ
  ["มีตัวช่วยกลาง printersAt", APP.includes("const printersAt=(list,bid)=>")],
  ["กติกาตรงกับ print-agent (null = ทุกสาขา)",
    APP.includes("p.branch_id==null||+p.branch_id===+bid") && AGENT.includes("p.branch_id == null || +p.branch_id === +BRANCH")],
  ["โหลดเครื่องพิมพ์ครั้งแรก กรองตามสาขา", APP.includes("setPrinters(printersAt(pr,currentBranch.id))")],
  ["โหลดซ้ำ กรองตามสาขา", APP.includes("setPrinters(printersAt(d,currentBranch.id))")],
  ["เส้นทาง POS แยก กรองตามสาขา", APP.includes("setPrinters(printersAt(prs,branchId))")],
  // ทางลัดหน้าจอโฮม: iOS อ่าน start_url จาก manifest ไม่ใช่ URL ที่เปิดอยู่
  // Safari อ่าน manifest ครั้งเดียวตอนโหลดหน้า — ต้องตัดสินใน index.html
  // ไม่ใช่สลับทีหลังด้วย React (เคยทำแล้วไม่ทัน ทางลัดยังพาไปหลังบ้าน)
  ["ไม่มีลิงก์ manifest ตายตัวใน HTML แล้ว", !HTML.includes('<link rel="manifest"')],
  ["React ไม่ไปยุ่งกับ manifest อีก", !APP.includes('link[rel="manifest"]')],
  ["ทางลัดจอขายชี้ไป manifest ของสาขานั้น", pickManifest("?pos=1&branch=8").href === "/pos-8.webmanifest"],
  ["ชื่อบนหน้าจอโฮมเป็น 'ขายหน้าร้าน'", pickManifest("?pos=1&branch=8").title === "ขายหน้าร้าน"],
  ["หน้าแรกยังได้ manifest หลัก", pickManifest("").href === "/manifest.webmanifest"],
  ["pos=1 แต่ไม่มีเลขสาขา = ใช้ตัวหลัก", pickManifest("?pos=1").href === "/manifest.webmanifest"],
  ["เลขสาขาที่ไม่ใช่ตัวเลข ต้องไม่ถูกเอาไปต่อ path", pickManifest("?pos=1&branch=../evil").href === "/manifest.webmanifest"],
  ["หน้าลูกค้า (scan) ไม่ใช่ manifest ของจอขาย", pickManifest("?scan=1&branch=8&table=1").href === "/manifest.webmanifest"],
  ["ไฟล์ manifest ของทุกสาขาที่สร้างไว้ มีอยู่จริง", (() => {
    const dir = new URL("../public/", import.meta.url);
    const files = fs.readdirSync(dir).filter(f => /^pos-[0-9]+[.]webmanifest$/.test(f));
    if (!files.length) return false;
    return files.every(f => {
      const j = JSON.parse(fs.readFileSync(new URL(f, dir), "utf8"));
      const id = f.match(/[0-9]+/)[0];
      return j.start_url === "/?pos=1&branch=" + id;
    });
  })()],
  ["มีสคริปต์สร้าง manifest รายสาขา", fs.existsSync(new URL("./make-pos-manifests.mjs", new URL("../scripts/", import.meta.url)))],
  ["build เรียกสคริปต์สร้าง manifest", JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.build.includes("make-pos-manifests")],
  // ── กติกา "เครื่องไหนรับหมวดอะไร" (รันฟังก์ชันจริงจากตัวพิมพ์) ──
  ["ติ๊กหมวดไหน = รับเฉพาะหมวดนั้น",
    handlesOf({ id: 1, categories: ["ชาบู"] }, { category: "ชาบู" }) === true &&
    handlesOf({ id: 1, categories: ["ชาบู"] }, { category: "หมูกระทะ" }) === false],
  ["ล้างหมดแล้ว = ไม่รับอะไรเลย (ไม่ใช่รับทุกอย่าง)",
    handlesOf({ id: 1, categories: [] }, { category: "ชาบู" }) === false],
  ["ปักหมุดเมนูไว้ที่เครื่องไหน = ออกเครื่องนั้นเท่านั้น",
    handlesOf({ id: 7, categories: [] }, { printer_id: 7, category: "ชาบู" }) === true &&
    handlesOf({ id: 8, categories: ["ชาบู"] }, { printer_id: 7, category: "ชาบู" }) === false],
  ["เครื่องเก่าที่ยังเป็น null ยังรับทุกหมวดอยู่ (ของเดิมไม่พัง)",
    handlesOf({ id: 1, categories: null }, { category: "อะไรก็ได้" }) === true],
  // ── เลิกใช้ catch-all: ติ๊กคือตัวตัดสินอย่างเดียว ──
  ["แอปไม่มีการ์ด 'รับทุกหมวด' แล้ว", !APP.includes("รับทุกหมวด (พิมพ์ทุกเมนู)") && !APP.includes("sAllCats")],
  ["แอปไม่มีปุ่ม catch-all แล้ว", !APP.includes("ทุกหมวด (catch-all)")],
  ["บันทึกหมวดเป็นรายการเสมอ ไม่เขียน null",
    APP.includes("categories:sCats,description") && APP.includes("categories:catSel||[...allCategories]")],
  ["เปิดเครื่องเดิมที่เป็น null มาให้ติ๊กครบ (ตรงกับที่มันทำอยู่จริง)",
    APP.includes("setSCats(Array.isArray(p.categories)?[...p.categories]:[...branchCategories])")],
  ["ปุ่มเลือกทุกหมวด/ล้าง ยังทำงานตรงไปตรงมา",
    APP.includes("setSCats([...branchCategories])") && APP.includes("setSCats([])") &&
    APP.includes("setCatSel([...allCategories])") && APP.includes("setCatSel([])")],
  // ── ปุ่มส่งรายการต้องอยู่กับที่ ──
  ["จอสั่งอาหารใช้โมดัลแบบไม่เลื่อนทั้งก้อน", APP.includes(" wide noScroll>")],
  // loadAll เดิมตั้ง setLoading(true) เสมอ → ทั้งหน้ายุบเป็นสปินเนอร์ทุกครั้งที่ปิดโต๊ะ
  // ป๊อบอัพถูกถอดทิ้งกลางคัน ดูเหมือนเครื่องค้างทั้งที่แค่กำลังโหลดเบื้องหลัง
  ["ปิดโต๊ะ/บันทึกแล้วโหลดใหม่แบบเงียบ ไม่ล้างจอ",
    APP.includes("onDone={()=>loadAll({silent:true})}")
    && APP.includes("loadAll({silent:true});}} wide noScroll>")
    && !APP.includes("onDone={loadAll}")],
  ["ปุ่มรีเฟรชที่กดเองยังเห็นสปินเนอร์ตามเดิม",
    APP.includes("const silent=!!(o&&o.silent===true);") && APP.includes("onClick={loadAll} icon={I.refresh}")],
  ["แผงสั่งอาหารไม่ยืนกรานความสูง 75vh แล้ว", !APP.includes('minHeight:isMobile?"calc(100vh - 60px)":"75vh"')],
  // ── ใบ QR โต๊ะ: ภาษาไทยต้องออกเป็นรูป ไม่ใช่ข้อความ ──
  ["ชิ้นแรกสั่ง init (0x1b,0x40)", escHead({}, 8, 8).slice(0, 2).join(",") === "27,64"],
  ["ชิ้นถัดมาไม่ init ซ้ำ", escHead({ noInit: true }, 8, 8).slice(0, 2).join(",") === "27,97"],
  ["ชิ้นที่ยังไม่จบไม่ตัดกระดาษ", escTail({ noCut: true }).length === 0],
  ["ชิ้นสุดท้ายตัดกระดาษ (GS V A)", escTail({}).join(",").includes("29,86,65")],
  ["QR เนทีฟฝังลิงก์ที่ส่งไปจริง", (() => {
    const url = "https://foodcost-eta.vercel.app/?scan=1&branch=8&table=1";
    const b = qrBytesOf(url);
    const txt = b.map(x => String.fromCharCode(x)).join("");
    return txt.includes(url) && b.join(",").includes("29,40,107");
  })()],
  ["ใบ QR สร้างเป็นรูปแล้ว (ไทยไม่เพี้ยน)", APP.includes("async function buildTableQRB64(table,branch,url)")],
  ["ทาง LAN ส่งใบ QR เป็นคำสั่งรูป (pj) ไม่ใช่ข้อความ",
    APP.includes('cmdDesc(p,"pj",{at,b64})') && !APP.includes('cmdDesc(p,"qr",{at,url')],
  ["ทางบลูทูธส่งเป็นไบต์ ไม่ใช่ base64", APP.includes("btPrint(b64Bytes(await buildTableQRB64(table,branch,url))")],
  // ── แบ่งจ่าย: ยอดต้องบวกกลับได้เท่าเดิมเป๊ะทุกกรณี ──
  ["฿1000 หาร 3 คน บวกกลับได้ 1000 พอดี", sumOf(splitEvenlyOf(1000, 3)) === 1000],
  ["฿1000 หาร 3 คน = 333.34 + 333.33 + 333.33", splitEvenlyOf(1000, 3).join(",") === "333.34,333.33,333.33"],
  ["เศษ 1 สตางค์ไม่หาย", sumOf(splitEvenlyOf(0.01, 3)) === 0.01],
  ["หารลงตัวก็ต้องเท่ากันทุกคน", splitEvenlyOf(900, 3).join(",") === "300,300,300"],
  ["คนเดียวได้เต็มยอด", splitEvenlyOf(1234.56, 1).join(",") === "1234.56"],
  ["จำนวนคนเพี้ยน (0) ไม่ทำให้ยอดหาย", sumOf(splitEvenlyOf(500, 0)) === 500],
  ["สุ่ม 400 กรณี ยอดกระทบกันครบทุกกรณี", (() => {
    for (let t = 1; t <= 20; t++) for (let n = 1; n <= 20; n++) {
      const amt = Math.round((t * 137.77 + n * 3.19) * 100) / 100;
      const parts = splitEvenlyOf(amt, n);
      if (parts.length !== n) return false;
      if (sumOf(parts) !== amt) return false;
      if (parts.some(p => p < 0)) return false;
      // ต่างกันได้ไม่เกิน 1 สตางค์ ไม่งั้นไม่เรียกว่าแบ่งเท่ากัน
      if (Math.round((Math.max(...parts) - Math.min(...parts)) * 100) > 1) return false;
    }
    return true;
  })()],
  // ── ปุ่มในแถบจัดการบิล ──
  ["เอาปุ่มพิมพ์ครัวออกแล้ว", !APP.includes('title="พิมพ์ใบครัวซ้ำทั้งหมด (ผ่านตัวพิมพ์)"')],
  ["พิมพ์ซ้ำรายรายการยังอยู่", APP.includes("agentReprint([item])")],
  ["เรียกว่า 'แบ่งจ่าย' ไม่ใช่ 'แยกบิล' แล้ว", APP.includes("แบ่งจ่าย") && !APP.includes("แยกบิล")],
  ["แบ่งจ่ายมีครบสามแบบ",
    APP.includes('tabBtn("even","เท่ากัน")') && APP.includes('tabBtn("item","ตามรายการ")') && APP.includes('tabBtn("amount","ระบุยอด")')],
  ["โหมดระบุยอดกันใส่เกินยอดบิล", APP.includes("Math.max(0,Math.min(total,+String(splitAmt)")],
  ["แบ่งจ่ายไม่ปิดบิล (ปิดบิลยังทำที่เช็คบิลที่เดียว)", APP.includes('payment_method:"split"') && !APP.includes('setSplitDone(p=>({...p,[key]:true}));await saveOrder')],
  // ── หน้าขายกับหลังบ้านต้องเห็นข้อมูลชุดเดียวกัน ──
  ["หน้าขายดึงตั้งค่าใหม่เป็นระยะ (ไม่ใช่โหลดครั้งเดียว)",
    APP.includes("const light=()=>{loadPosSettings();loadPromotions();loadZones();")],
  ["หน้าขายดึงเมนูใหม่ด้วย (ราคาต้องตรงกับหลังบ้าน)", APP.includes("if(++n%5===0)heavy();")],
  ["สลับแท็บกลับมาแล้วดึงทันที", APP.includes('const onVis=()=>{if(!document.hidden){light();heavy();}};')],
  ["ตัวจับเวลาถูกเคลียร์ตอนออกจากหน้า", APP.includes("return()=>{clearInterval(t);document.removeEventListener(\"visibilitychange\",onVis);};")],
  ["ปุ่มรีเฟรชดึงตั้งค่า+เมนูด้วย ไม่ใช่แค่ออเดอร์",
    APP.includes("if(refreshTick){loadAll();try{reloadMenus&&reloadMenus();}catch{}try{reloadPosSettings&&reloadPosSettings();}catch{}}")],
  // ── QR จ่ายเงิน ──
  // ── ตั้งค่า POS ต้องเหมือนกันทั้งหลังบ้านและหน้าร้าน (เจ้าของสั่งไว้) ──
  // เดิมเป็นฟอร์มคนละชุด หลังบ้าน 11 ฟิลด์ หน้าร้าน 5 — ขาดค่าบริการกับ PromptPay
  ["ฟอร์มตั้งค่า POS มีชุดเดียว", APP.split("function POSSettingsFields").length - 1 === 1],
  ["ทั้งสองจอใช้ฟอร์มชุดเดียวกัน", APP.split("<POSSettingsFields ").length - 1 === 2],
  ["ช่องแนบรูป QR มีนิยามที่เดียว (ไม่ก๊อปสองชุด)", APP.split("promptpay_qr_image',v)").length - 1 === 1],
  ["ค่าบริการอยู่ในฟอร์มกลาง (หน้าร้านจึงเห็นด้วย)",
    APP.includes("service_charge_enabled") && APP.includes("service_charge_rate")],
  ["แนบรูป QR เองได้ (เก็บเป็น Drive ref ไม่ใช่ base64)",
    APP.includes("set('promptpay_qr_image',v)") && APP.includes("<ImgUp label=\"\" value={settings.promptpay_qr_image")],
  ["QR แบบรูปต้องพิมพ์ยอดกำกับ (รูปไม่มียอดฝัง)",
    APP.includes('lines.push({t:"ยอดที่ต้องชำระ ฿"+(+order.total||0).toFixed(2)')],
  ["ปุ่มในป็อปอัพชำระเงินเป็นพิมพ์ QR จ่ายเงิน", APP.includes("onClick={onPrintQR}") && APP.includes("พิมพ์ QR จ่ายเงิน")],
  // ปุ่มนี้ถูกกดทุกบิล (ลูกค้าตรวจยอดก่อนยืนยัน) — ต้องเด่น ไม่ใช่ปุ่มโปร่งตัวเล็ก
  ["ปุ่มพิมพ์ QR เป็นสีส้มเด่น ไม่ใช่ปุ่มโปร่ง",
    APP.includes('<Btn v="primary" onClick={onPrintQR}') && !APP.includes('<Btn v="ghost" onClick={onPrintQR}')],
  ["ปุ่มพิมพ์ QR ใหญ่พอๆ กับปุ่มยืนยัน",
    APP.split('padding:"15px 12px",fontSize:15.5,fontWeight:900,lineHeight:1.25}}').length - 1 >= 2],
  // แถบสามปุ่มบนจอสั่งอาหารถูกย้ายเข้าป็อปอัพเช็คบิล — ไม่ใช่ลบความสามารถทิ้ง
  // ยกเลิกบิล/พิมพ์ใบเสร็จซ้ำ ไม่มีทางเข้าอื่นเลย ถ้าหายไปคือทำไม่ได้อีกเลย
  ["แถบสามปุ่มออกจากจอสั่งอาหารแล้ว", !APP.includes("{/* Quick action bar */}")],
  ["แถบ 'ยอดนิยม' ออกจากจอสั่งอาหารแล้ว", !APP.includes("quickKeys")],
  // ปุ่ม "ใบเสร็จ" ถูกถอดออก (เจ้าของสั่ง — ไม่ได้ใช้) ป๊อบอัพนี้เปิดได้เฉพาะบิลที่ยังไม่ชำระ
  // มันจึงพิมพ์ "ใบแจ้งยอด" ซึ่งซ้ำกับที่ปุ่มพิมพ์ QR จ่ายเงินพิมพ์อยู่แล้ว ต่างแค่ไม่มี QR
  ["ปุ่มใบเสร็จออกจากป๊อบอัพเช็คบิลแล้ว", !APP.includes("<Ic d={I.bill} s={13} c={C.blue}/>ใบเสร็จ")],
  ["ไม่เหลือตัวจัดการที่ไม่มีใครเรียก", !APP.includes("onReprint") && !APP.includes("reprintReceipt")],
  // ถอดปุ่มนี้แล้วต้องไม่พลอยถอดงานอื่นในแถวเดียวกันไปด้วย
  ["ยกเลิกบิลยังอยู่ในแถวเดิม", APP.includes("onClick={onCancelOrder}") && APP.includes("onCancelOrder={cancelOrder}")],
  ["แบ่งจ่ายยังอยู่ในแถวเดิม", APP.includes("onClick={onSplit}") && APP.includes("onSplit={()=>setShowSplitBill(true)}")],
  ["ป็อปอัพแบ่งจ่ายซ้อนเหนือเช็คบิล (ไม่ไปโผล่ข้างหลัง)", APP.includes("zIndex:4500")],
  ["ใบ QR จ่ายเงินใช้ยอดสด ไม่ใช่ยอดจากแถวบิลที่ยังไม่ปิด",
    APP.includes("function printPayQR(){") && APP.includes("subtotal,discount:round2(manualDiscount),total,")],
  // ── ป็อปอัพเลื่อนแล้วพื้นหลังต้องอยู่นิ่ง ──
  ["กันเลื่อนทะลุไปพื้นหลัง", APP.includes("div{overscroll-behavior:contain}")],
  // เปิดจากไอคอนหน้าจอโฮม เนื้อหากินขึ้นไปใต้แถบสถานะ iOS — หัวจอต้องเผื่อไว้
  ["หัวจอขายไม่ทับเวลา/แบตของ iOS", APP.includes("calc(10px + env(safe-area-inset-top,0px))") && APP.includes("calc(12px + env(safe-area-inset-top,0px))")],
  ["ล็อกหน้าแบบที่ iOS ยอมรับ (ตรึง body ไม่ใช่ overflow:hidden)", APP.includes('b.position="fixed";b.top=') && APP.includes("window.scrollTo(0,_savedScrollY)")],
  ["นับป็อปอัพซ้อน ปลดล็อกเมื่อปิดตัวสุดท้าย", APP.includes("_modalDepth=Math.max(0,_modalDepth-1);") && APP.includes("if(_modalDepth===1){") && APP.includes("if(_modalDepth===0){")],
  ["Modal เรียกตัวล็อก", APP.includes("useScrollLock();") && APP.includes("function useScrollLock(){")],
  ["รูปจางยังพิมพ์ติด (ไม่หายเงียบ)", APP.includes("if(a>40&&lum<175)")],
  // ── ใบครัวไม่ออก ต้องเห็นในระบบ ไม่ใช่หายเงียบ ──
  // ระบบไม่พิมพ์ซ้ำเองแล้ว ถ้าไม่แสดงให้เห็น ครัวจะไม่รู้เลยว่ามีใบตกหล่น
  ["มีตัวอ่านรายการที่พิมพ์ไม่ออก", APP.includes("const printFailsOf=(printers)=>")],
  ["ผังโต๊ะขึ้นป้ายเตือนที่โต๊ะนั้น", APP.includes("⚠️ ใบครัวไม่ออก")],
  ["ผังโต๊ะได้รับข้อมูลเครื่องพิมพ์", APP.includes("<POSTableMap tables={tables} activeOrders={activeOrders} zones={zones} printers={printers}")],
  ["จอสั่งอาหารมีปุ่มให้พนักงานกดพิมพ์เอง", APP.includes("พิมพ์ใบครัวที่ไม่ออกอีกครั้ง")],
  // เดิมกดแล้วล้างเตือนทันที ทั้งที่เครื่องอาจยังดับอยู่ = ใบหายเงียบ · ตอนนี้ตัวพิมพ์เป็นคนลบเมื่อออกจริง
  ["ไม่ล้างเตือนตอนกด (ตัวพิมพ์ลบเองเมื่อออกจริง)", !APP.includes("clearPrintFail") && AGENT.includes("async function settleFail(")],
  // ── หมวดคุมจากครัวกลางที่เดียว สาขาแก้เองไม่ได้ ──
  ["จอขายไม่มีเมนูจัดการหมวดแล้ว", !APP.includes("เพิ่ม/แก้/ลบหมวด")],
  ["ไม่เหลือโค้ดเปิดจอจัดการหมวดที่ตายแล้ว", !APP.includes("active===\"cats\"")],
  // ── จอเมนูทั้งหมด: กดแยกดูตามหมวดได้ ──
  ["จอเมนูทั้งหมดมีแถบหมวด", APP.includes("const catList=(()=>{") && APP.includes("if(cat&&menuCatOf(m)!==cat)return false;")],
  // ── ติ๊กหมวดแล้วเมนูข้างในต้องขึ้นติ๊กตาม ไม่ให้สับสน ──
  ["ติ๊กหมวด = เมนูในหมวดขึ้นติ๊กตาม", APP.includes("checked={has||here} disabled={has}")],
  // ── เรียงชื่อไทยในป๊อบอัพกำหนดการพิมพ์ (26 หมวด/169 เมนู ไล่หาด้วยตาล้วนๆ) ──
  // .sort() เปล่าๆ เรียงตามรหัสตัวอักษร สระหน้ามีรหัสสูงกว่าพยัญชนะทุกตัว
  // "ไก่ทอด" เลยไปกองท้ายตารางแทนที่จะอยู่หมวด ก
  ["สระหน้า ไ ไปนับที่พยัญชนะถัดไป (ไก่ทอด อยู่หมวด ก)",
    thSort(["ขนม", "ไก่ทอด", "จิ้มจุ่ม"]).join("|") === "ไก่ทอด|ขนม|จิ้มจุ่ม"],
  ["สระหน้า เ ก็เหมือนกัน (เคลียมัทฉะ อยู่หมวด ค)",
    thSort(["มัทฉะลาเต้", "เคลียมัทฉะ", "ลาเต้"]).join("|") === "เคลียมัทฉะ|มัทฉะลาเต้|ลาเต้"],
  ["สระหน้า โ/ใ/แ ครบทุกตัว",
    thSort(["โอเลี้ยง", "ใบเตย", "แกงส้ม", "ชาเย็น"]).join("|") === "แกงส้ม|ชาเย็น|ใบเตย|โอเลี้ยง"],
  // ชุดเมนูจริงมี "เซต 1..10" ถ้าเรียงทีละอักษรจะได้ 1, 10, 2 ซึ่งอ่านแล้วสะดุด
  ["เลขในชื่อเรียงตามค่า ไม่ใช่ทีละอักษร",
    thSort(["เซต 10", "เซต 2", "เซต 1"]).join("|") === "เซต 1|เซต 2|เซต 10"],
  ["ชื่ออังกฤษปนอยู่ก็ไม่พัง (ไปต่อท้ายไทย)",
    thSort(["Refill", "กาแฟ", "ผัก"]).join("|") === "กาแฟ|ผัก|Refill"],
  ["ชื่อว่าง/หายไป ไม่ทำให้ทั้งจอล้ม",
    (() => { try { return thSort([undefined, "กาแฟ", null, ""]).length === 4; } catch { return false; } })()],
  // ถ้าข้อบนผ่านเพราะ .sort() ธรรมดาก็ให้ผลเดียวกัน ข้อทดสอบก็ไม่ได้พิสูจน์อะไร
  ["ชุดทดสอบนี้แยกผลจาก .sort() ธรรมดาได้จริง",
    thSort(["ขนม", "ไก่ทอด"]).join("|") !== ["ขนม", "ไก่ทอด"].sort().join("|")],
  ["หัวหมวดในกำหนดการพิมพ์เรียงแบบไทย", APP.includes("return [...s].sort(thCmp);")],
  ["เมนูในแต่ละหมวดเรียงแบบไทย",
    APP.includes(".filter(m=>effCat(m)===c).sort((a,b)=>thCmp(a.name,b.name))")],
  // .filter() คืนอาร์เรย์ใหม่ก่อนเสมอ ไม่งั้น .sort() จะไปสลับลำดับ menus ตัวจริง
  ["เรียงบนสำเนา ไม่ไปสลับ menus ตัวจริง",
    !APP.includes("menus.sort(") && !APP.includes("(menus||[]).sort(")],
  // สร้าง Collator ใหม่ทุกครั้งที่เทียบ = ช้ามากเมื่อรายการยาว
  ["สร้าง Collator ไว้ตัวเดียวใช้ซ้ำ", APP.split("new Intl.Collator").length - 1 === 1],
  // ── QR ท้ายใบเสร็จต้องล็อกยอด (เจ้าของสั่ง: กันพนักงานทุจริต/ลูกค้ากรอกยอดผิด) ──
  ["QR ฝังยอดจริงในช่อง 54 ตรงเป๊ะ", pp("0812345678", 2085).t?.["54"] === "2085.00"],
  ["ยอดมีทศนิยม 2 ตำแหน่งเสมอ", pp("0812345678", 2085.5).t?.["54"] === "2085.50" && pp("0812345678", 7).t?.["54"] === "7.00"],
  // tag 01 = 12 คือ "dynamic" บอกแอปธนาคารว่า QR ใบนี้มียอดกำหนดมาแล้ว
  ["มียอด → ประกาศเป็น QR แบบกำหนดยอด (tag 01 = 12)", pp("0812345678", 2085).t?.["01"] === "12"],
  ["ไม่มียอด → เป็น QR เปล่า (tag 01 = 11) และไม่มีช่อง 54", (() => {
    const r = pp("0812345678", 0);
    return r.t?.["01"] === "11" && r.t?.["54"] === undefined;
  })()],
  ["สกุลเงินบาทและประเทศไทยถูกต้อง", pp("0812345678", 100).t?.["53"] === "764" && pp("0812345678", 100).t?.["58"] === "TH"],
  // CRC เพี้ยนแค่หลักเดียว = แอปธนาคารปฏิเสธทั้งใบ ลูกค้าสแกนไม่ติดหน้าเคาน์เตอร์
  ["CRC ท้าย payload ถูกต้อง", crcOK(pp("0812345678", 2085).p) && crcOK(pp("1234567890123", 99.99).p)],
  ["โครงสร้าง TLV ถอดกลับได้ครบไม่มีเศษเหลือ", pp("0812345678", 2085).t !== null],
  // เบอร์มือถือต้องแปลงเป็นรูปแบบสากล 0066 + เบอร์ตัดศูนย์ = 13 หลัก
  ["เบอร์มือถือแปลงเป็น 0066 ครบ 13 หลัก",
    pp("0812345678", 100).t?.["29"] === "0016A00000067701011101130066812345678"],
  ["กรอกมาแบบ +66 ได้ QR เดียวกับกรอก 0 นำหน้า",
    ppGen("66812345678", 2085) === ppGen("0812345678", 2085)],
  ["ขีด/เว้นวรรคในเบอร์ไม่ทำให้เพี้ยน",
    ppGen("081-234-5678", 2085) === ppGen("0812345678", 2085) && ppGen("081 234 5678", 2085) === ppGen("0812345678", 2085)],
  ["เลขบัตรประชาชน 13 หลักใช้ช่อง 02",
    pp("1234567890123", 100).t?.["29"] === "0016A00000067701011102131234567890123"],
  ["e-Wallet 15 หลักใช้ช่อง 03",
    pp("123456789012345", 100).t?.["29"] === "0016A0000006770101110315123456789012345"],
  // ความยาวอื่นเคยถูกยัดลงช่องเบอร์โทรดื้อๆ ได้ QR ที่สแกนติดแต่ไม่ตรงบัญชีใคร
  // กระดาษออกปกติทุกอย่าง เงินไม่เข้า ไม่มีใครรู้จนกว่าจะกระทบยอด
  ["ความยาวมั่วต้องปฏิเสธ ไม่ใช่สร้าง QR ให้",
    ["081234567", "08123456789", "081234567890", "12345678901234", "1234567890123456", "abcdefghij", ""]
      .every(x => ppGen(x, 100) === "")],
  ["เบอร์ 10 หลักที่ไม่ขึ้นต้นด้วย 0 ก็ต้องปฏิเสธ", ppGen("8123456789", 100) === ""],
  // ── ลำดับ: QR ล็อกยอดต้องมาก่อนรูปที่แนบ ไม่งั้นล็อกยอดไม่มีผล ──
  // รูปที่แนบจากแอปธนาคารเป็น QR บัญชีเปล่า ไม่มียอด — ถ้ามันชนะ ลูกค้ากรอกยอดเองเหมือนเดิม
  ["ใบเสร็จฝั่งตัวพิมพ์: เบอร์ชนะรูป",
    APP.includes("const payload=posSettings.promptpay_id?genPromptPayPayload(posSettings.promptpay_id,order.total):\"\";")
    && APP.includes("}else if(posSettings.promptpay_qr_image){")],
  ["ใบเสร็จฝั่งเบราว์เซอร์: เบอร์ชนะรูป",
    APP.includes("const ppPayload=ppShow&&posSettings.promptpay_id?genPromptPayPayload(posSettings.promptpay_id,order.total):\"\";")
    && APP.includes("}else if(ppShow&&posSettings.promptpay_qr_image){")],
  // ยอด 0 จะได้ QR แบบไม่ล็อกยอด (tag 01 = 11) ซึ่งลูกค้ากรอกเองได้ตามใจ — ไม่พิมพ์เลยดีกว่า
  ["บิลยอด 0 ไม่พิมพ์ QR ออกมา", APP.split("posSettings.show_qr_promptpay&&(+order.total||0)>0").length - 1 === 1
    && APP.includes("posSettings.show_qr_promptpay&&!paid&&(+order.total||0)>0")],
  // ── ร่องรอยการยกเลิกบิล (เจ้าของสั่ง: กินเงินสดแล้วกดยกเลิกต้องมีร่องรอย) ──
  // ยกเลิกบิลคือทางที่เงินสดหายเงียบที่สุด กด OK เฉยๆ ไม่พอ ต้องบอกได้ว่าใครและทำไม
  ["ยกเลิกบิลต้องผ่านกล่องถามเหตุผล ไม่ใช่แค่กดยืนยัน",
    APP.includes("const reason=await reasonDlg({") && APP.includes("if(reason==null)return;")],
  ["ไม่มีเหตุผล = ปุ่มยืนยันกดไม่ได้", APP.includes("disabled={!val}") && APP.includes("onClick={()=>{if(val)close(val);}}")],
  ["บันทึกครบทั้งคนยกเลิก เวลา และเหตุผล",
    APP.includes("const full={...base,cancelled_by:who,cancelled_at:at,cancel_reason:reason};")],
  ["บันทึกว่าใครปิดบิล", APP.includes("cash_received:cashReceived,payments:paymentsCol,paid_by:currentUser?.username||currentUser?.name||null}")],
  // กล่องเหตุผลต้องขึ้นทุกจุดที่ mount <ConfirmDlg/> (มี 4 จุด) ถ้าลืมจุดใดจุดหนึ่ง
  // reasonDlg จะคืน null เงียบๆ = กดยกเลิกบิลแล้วไม่เกิดอะไรขึ้น ไม่มี error ให้เห็น
  ["กล่องเหตุผลผูกติดกล่องยืนยัน ไม่ต้องไล่ mount เอง",
    APP.includes("function ConfirmDlg(){return <><ConfirmBox/><ReasonBox/></>;}")
    && APP.split("<ConfirmDlg/>").length - 1 === 4
    && !APP.includes("<ReasonBox/>;")],
  // คอลัมน์ยังไม่มี = ต้องยอมให้ยกเลิกได้ (ร้านต้องเดินต่อ) แต่ต้องเตือนดังๆ ไม่ใช่เงียบ
  ["คอลัมน์ยังไม่มีก็ยังยกเลิกได้ แต่ต้องเตือน",
    APP.includes("row=await api.updatePOSOrderIfUnchanged(existingOrder.id,verRef.current,base);")
    && APP.includes("แต่ยังบันทึกผู้ยกเลิก/เหตุผลไม่ได้")],
  ["จับข้อความ 'คอลัมน์ยังไม่มี' ได้ทุกแบบที่ PostgREST ส่งมา",
    ["PGRST204",
     'column "cancelled_by" of relation "orders" does not exist',
     "Could not find the 'cancel_reason' column of 'orders' in the schema cache"]
      .every(m => schemaErrRe(m) === true)],
  // เน็ตหลุดต้องไม่ถูกนับเป็น "คอลัมน์ไม่มี" ไม่งั้นจะยกเลิกซ้ำแบบไร้ร่องรอย
  ["เน็ตหลุด/ผิดพลาดอื่นต้องไม่ถูกนับเป็นคอลัมน์ไม่มี",
    ["Failed to fetch", "Load failed", "NetworkError when attempting to fetch resource", "timeout of 15000ms exceeded"]
      .every(m => schemaErrRe(m) === false)],
  // ── บิลที่ยกเลิกต้องกดดูย้อนหลังได้ ──
  // เดิมถูกกรองทิ้งทุกตัวกรอง เหลือแค่ตัวเลขนับมุมขวา = มีร่องรอยแต่ไม่มีใครเห็น
  ["แท็บ 'ยกเลิก' เปิดดูบิลที่ยกเลิกได้จริง", (() => {
    const P_ = [{ id: 1 }], U_ = [{ id: 2 }], X_ = [{ id: 3 }, { id: 4 }];
    const got = baseListOf("cancelled", P_, U_, X_);
    return got.length === 2 && got.every(o => X_.includes(o));
  })()],
  ["แท็บ 'ทั้งหมด' รวมบิลที่ยกเลิกด้วย", (() => {
    const got = baseListOf("all", [{ id: 1 }], [{ id: 2 }], [{ id: 3 }]);
    return got.length === 3;
  })()],
  ["แท็บ 'ปิดบิลแล้ว' ยังไม่ปนบิลที่ยกเลิก", (() => {
    const P_ = [{ id: 1 }];
    const got = baseListOf("paid", P_, [{ id: 2 }], [{ id: 3 }]);
    return got.length === 1 && got[0] === P_[0];
  })()],
  ["รายงานยอดขายไม่นับบิลที่ยกเลิกเป็นรายได้",
    APP.includes("const rev=paid.reduce((s,o)=>s+(+o.total||0),0);")
    && APP.includes('const paid=all.filter(o=>o.status==="paid");')
    && APP.includes('const cancelled=all.filter(o=>o.status==="cancelled");')],
  ["บิลเก่าที่ไม่มีบันทึกต้องบอกตรงๆ ว่าไม่มี ไม่ใช่เว้นว่าง",
    APP.includes("— ไม่มีบันทึก (ยกเลิกก่อนเปิดระบบบันทึก) —")],
  // ── จอสั่งอาหารค้างตอนลากนิ้ว/กดรัว (เจ้าของแจ้ง 8 ก.ย. 69) ──
  // iOS ไม่สนใจ user-scalable=no จึงยังรอ "แตะสองทีเพื่อซูม" ก่อนยิง click ทุกครั้ง
  // globalStyle เดิมใส่ touch-action ไว้แค่ที่ button — การ์ดเมนูเป็น div เลยยังหน่วง
  ["ตัดหน่วงแตะสองทีทั้งแอป ไม่ใช่แค่ปุ่ม",
    APP.includes("-webkit-tap-highlight-color:transparent;touch-action:manipulation}")],
  // ลากนิ้วผ่านกริด 169 ใบ = Safari ยิง mouseenter ไล่ทีละใบ แต่ละครั้งเขียน style ตรงๆ
  // บวก transition:"all" ที่สั่งให้เฝ้าทุกคุณสมบัติ = งานวาดจอต่อเนื่องตลอดการลาก
  ["การ์ดเมนูไม่มีตัวจับเมาส์ที่เขียน style ระหว่างลากนิ้ว", (()=>{
    const i=APP.indexOf("const MenuCard=memo(function MenuCard(");
    if(i<0)return false;
    const card=APP.slice(i,APP.indexOf("\n});",i));
    return !card.includes("onMouseEnter") && !card.includes("onMouseLeave") && !card.includes('transition:"all');
  })()],
  // กริด 169 ใบ: เดิมเป็น JSX inline ในลูป กดเพิ่มเมนู 1 ครั้ง = สร้าง element ใหม่ทั้งกริด
  ["การ์ดเมนูแยกออกมาและ memo ไว้", APP.includes("const MenuCard=memo(function MenuCard(") && APP.includes("<MenuCard key={m.id}")],
  // memo จะไร้ผลทันทีถ้า prop ที่ส่งเข้าไปเป็นของใหม่ทุกรอบ
  ["ตัวช่วยที่ส่งให้การ์ดมี identity คงที่",
    APP.includes("const addItem=useCallback(") && APP.includes("const pickOrAdd=useCallback(") && APP.includes("onPick={pickOrAdd}")],
  ["ไม่คำนวณ 'เมนูนี้มีตัวเลือกไหม' ใหม่ทุกใบทุกรอบ",
    APP.includes("const optsSet=useMemo(") && APP.includes("hasOpts={optsSet.has(m.id)}")],
  ["คลังตัวเลือกไม่สร้างก้อนใหม่ทุกเรนเดอร์",
    APP.includes("const optionLib=useMemo(()=>posSettings?.option_library||[],[posSettings]);")],
  // backdrop-filter เต็มจอบังคับ GPU เบลอใหม่เมื่อเลเยอร์ข้างใต้ขยับ — จอสั่งอาหารอยู่ในโมดัลนี้
  ["ฉากหลังป๊อบอัพเบลอเฉพาะเครื่องที่มีเมาส์",
    APP.includes('className="mdl-ovl"') && APP.includes("@media(hover:hover){.mdl-ovl{")
    && !APP.includes('background:"rgba(15,23,42,.65)",backdropFilter:"blur(8px)",display:"flex",alignItems:mob')],
  // ── ตัวล็อกซูมใน index.html ต้องไม่ขวางการเลื่อนจอ ──
  ["ตอนโหลดหน้าไม่มี touchmove ผูกค้างไว้เลย", bootListeners("touchmove").length === 0],
  ["ยังดักนิ้วแตะไว้เพื่อรู้ว่ามีนิ้วที่สอง (แบบ passive)",
    bootListeners("touchstart").length === 1 && bootListeners("touchstart")[0].o.passive === true],
  ["สองนิ้วแตะลงมาแล้วค่อยผูกตัวบล็อกซูม (passive:false)", (()=>{
    const ts=bootListeners("touchstart")[0];
    if(!ts)return false;
    const before=zoomLock.reg.length;
    ts.fn({touches:{length:2}});
    const added=zoomLock.reg.slice(before).filter(r=>r.t==="touchmove"&&!r.removed);
    return added.length===1 && added[0].o.passive===false;
  })()],
  ["นิ้วเดียวแตะ ต้องไม่ผูกอะไรเพิ่ม", (()=>{
    const ts=bootListeners("touchstart")[0];
    if(!ts)return false;
    const before=zoomLock.reg.length;
    ts.fn({touches:{length:1}});
    return zoomLock.reg.length===before;
  })()],
  ["ยกนิ้วแล้วถอดตัวบล็อกออก", (()=>{
    const te=bootListeners("touchend")[0];
    if(!te)return false;
    const before=zoomLock.reg.length;
    te.fn({touches:{length:0}});
    const removed=zoomLock.reg.slice(before).filter(r=>r.t==="touchmove"&&r.removed);
    return removed.length===1;
  })()],
  ["ยังบล็อกท่าซูมสองนิ้วของ iOS ไว้ครบ", ["gesturestart","gesturechange","gestureend"].every(g=>bootListeners(g).length===1)],
  ["การ์ดเมนูใช้คลาส mcard (ยกเว้นเมนูที่วันนี้หมด)",
    APP.includes('className={soldOut?undefined:"mcard"}')],
  // hover บนจอสัมผัสไม่มีความหมาย และทำให้การ์ดค้างไฮไลต์หลังแตะ — ต้องกันไว้ที่ CSS
  ["hover ของการ์ดเมนูจำกัดเฉพาะเครื่องที่มีเมาส์จริง",
    APP.includes("@media(hover:hover){.mcard:hover{")],
  ["แตะแล้วต้องเห็นว่าติด (ตอบสนองด้วย CSS ไม่ใช่ JS)", APP.includes(".mcard:active{")],
  // ── เพดาน 1000 แถวของ PostgREST (ตัดเงียบ ไม่มี error) ──
  ["ข้อมูลเกิน 1000 แถวต้องได้ครบ ไม่ใช่ได้แค่ 1000", await (async () => {
    const { fn } = sbAllWith(2500);
    return (await fn("ingredients?order=id.asc")).length === 2500;
  })()],
  ["ครบพอดี 1000 แถวก็ต้องได้ 1000 และต้องหยุด ไม่วนไม่รู้จบ", await (async () => {
    const { fn, calls } = sbAllWith(1000);
    const r = await fn("ingredients?order=id.asc");
    return r.length === 1000 && calls.length === 2;   // หน้าแรกเต็ม → ขอต่ออีกหน้า ได้ว่าง → จบ
  })()],
  ["ต่ำกว่าเพดานยิงครั้งเดียวพอ ไม่ยิงเผื่อ", await (async () => {
    const { fn, calls } = sbAllWith(931);
    return (await fn("ingredients?order=id.asc")).length === 931 && calls.length === 1;
  })()],
  ["ไม่มีข้อมูลเลยต้องได้อาเรย์ว่าง ไม่ใช่พัง", await (async () => {
    const { fn } = sbAllWith(0);
    const r = await fn("ingredients?order=id.asc");
    return Array.isArray(r) && r.length === 0;
  })()],
  ["ฐานข้อมูลตอบผิดรูปต้องไม่ทำทั้งจอล้ม", await (async () => {
    try { const { fn } = sbAllWith("พัง"); return Array.isArray(await fn("ingredients?order=id.asc")); }
    catch { return false; }
  })()],
  ["ไม่มีแถวไหนซ้ำหรือหายระหว่างต่อหน้า", await (async () => {
    const { fn } = sbAllWith(2500);
    const r = await fn("ingredients?order=id.asc");
    return new Set(r.map(x => x.id)).size === 2500 && r[0].id === 0 && r[2499].id === 2499;
  })()],
  // ตารางที่โตทางเดียวต้องดึงแบบแบ่งหน้า — ถ้าใครเผลอเปลี่ยนกลับเป็น sb() ตรงๆ จะแดงทันที
  ["วัตถุดิบดึงแบบแบ่งหน้า", APP.includes('getIngs: () => sbAll("ingredients?order=id.asc")')],
  ["เมนูดึงแบบแบ่งหน้า", APP.includes('getMenus: () => sbAll("menus?order=id.asc")')],
  ["เมนูหน้าลูกค้าดึงแบบแบ่งหน้า", APP.includes('getMenusPublic: () => sbAll("menus?select=')],
  ["สินทรัพย์ยังดึงแบบแบ่งหน้าอยู่", APP.includes('getAssets: () => sbAll("assets?order=id.desc")')],
  // แบ่งหน้าโดยไม่เรียงลำดับ = ลำดับไม่คงที่ ข้อมูลข้ามหน้าซ้ำบ้างหายบ้าง
  ["ทุกจุดที่แบ่งหน้าต้องสั่งเรียงลำดับด้วย",
    APP.split("sbAll(").slice(1).filter(seg => !seg.startsWith("pathNoRange")).every(seg => /order=/.test(seg.slice(0, 220)))],   // ข้ามตัวนิยามฟังก์ชันเอง เอาเฉพาะจุดที่เรียกใช้
  // ออกรหัสจากรายการที่อ่านมาไม่ครบ = รหัสซ้ำกับวัตถุดิบที่มีอยู่แล้ว
  ["ตัวออกรหัสอ่านรหัสเดิมครบทุกหน้า",
    APP.includes("sbAll(`ingredients?select=code") && APP.includes("&order=code.asc")],
  // ── แจ้งเตือนต้องถึงคน (บทเรียน 9 ก.ย. 69) ──
  ["มีคนดูแลทุกสาขาอยู่ → ส่งเฉพาะคนนั้น", (() => {
    const subs = [{ id: 1, allowed_branches: null }, { id: 2, allowed_branches: [6] }];
    const t = pickTargets(subs, true, null);
    return t.length === 1 && t[0].id === 1;
  })()],
  // ถ้าไม่มีใครดูแลทุกสาขา ต้องกระจายให้ทุกคนแทน — เตือนถึงคนผิดกลุ่มยังดีกว่าไม่ถึงใครเลย
  ["ไม่มีใครดูแลทุกสาขา → ห้ามจบที่ผู้รับ 0 คน", (() => {
    const subs = [{ id: 1, allowed_branches: [6] }, { id: 2, allowed_branches: [8] }];
    return pickTargets(subs, true, null).length === 2;
  })()],
  ["ไม่มีผู้ติดตามเลยก็ต้องไม่พัง", (() => {
    try { return pickTargets([], true, null).length === 0; } catch { return false; }
  })()],
  ["แจ้งเตือนรายสาขายังส่งเฉพาะสาขานั้นเหมือนเดิม", (() => {
    const subs = [{ id: 1, allowed_branches: [6] }, { id: 2, allowed_branches: [8] }];
    const t = pickTargets(subs, false, 8);
    return t.length === 1 && t[0].id === 2;
  })()],
  // ── ช่องแจ้งเตือนที่ไม่พึ่งระบบตัวเอง ──
  // ปลายทางเดิมต้องอ่านรายชื่อผู้รับจากฐานข้อมูลที่กำลังตาย จึงส่งไม่ออกในวันที่ต้องใช้
  ["ตัวเฝ้ามีช่องแจ้งเตือนที่ยิงตรงไม่ผ่านระบบเรา",
    WATCHDOG.includes("api.line.me/v2/bot/message/push") && WATCHDOG.includes("secrets.LINE_ALERT_TOKEN")],
  ["ช่องนั้นทำงานเฉพาะตอนตรวจไม่ผ่าน และล้มแล้วไม่ลามไปขั้นอื่น", (() => {
    const i = WATCHDOG.indexOf("api.line.me");
    const seg = WATCHDOG.slice(Math.max(0, i - 900), i);
    return /if: failure\(\)/.test(seg) && /continue-on-error: true/.test(seg);
  })()],
  ["ยังไม่ได้ตั้ง secret ต้องข้ามเงียบๆ ไม่ทำให้ตัวเฝ้าพัง", WATCHDOG.includes("ข้ามช่องนี้") && WATCHDOG.includes("exit 0")],
  ["ยังมีช่องเดิมอยู่ด้วย ไม่ได้เอาออก", WATCHDOG.includes("foodcost-eta.vercel.app/api/push")],
  // ── การสำรองรายคืน ──
  // ขึ้น FAILED ติดกัน 38 คืนโดยไม่มีใครรู้ ทั้งที่ข้อมูลครบทุกตาราง
  ["ตารางเปล่าที่ค้างอยู่ไม่ตีตกการสำรองอีก",
    driftRe.test("branch7_backup") && driftRe.test("purchase_orders_branch7_backup")],
  ["ตารางจริงยังต้องถูกตรวจ drift เหมือนเดิม",
    !driftRe.test("orders") && !driftRe.test("ingredients") && !driftRe.test("stock_logs") && !driftRe.test("backups")],
  ["สำรองไม่ผ่านต้องมีคนรู้ ไม่ใช่เงียบ",
    // สำรองที่ข้อมูลมีความเสี่ยงต้องแจ้งเสมอ — ส่วนที่ไม่แจ้งมีแค่ "ครบ + อ่านกลับผ่าน + ไม่ข้ามตรวจ + ตารางตรง"
    BACKUP.includes("async function alertBackupProblem(") &&
    BACKUP.includes('if (status !== "success" && !dataSafe) await alertBackupProblem(') &&
    BACKUP.includes("const dataSafe = dataComplete && verified && !verifySkipped && driftClean;")],
  ["แจ้งเตือนสำรองต้องบอกสาเหตุที่ลงมือแก้ได้", BACKUP.includes("มีตารางใหม่ที่ยังไม่ได้สำรอง")],
  ["แจ้งเตือนพังต้องไม่ทำให้การสำรองพังตาม",
    /async function alertBackupProblem\([\s\S]{0,1600}catch \{ \/\* แจ้งไม่ได้/.test(BACKUP)],
  // ── ฟังก์ชันต้องรันใกล้ร้านและใกล้ฐานข้อมูล ──
  // ไม่ตั้ง regions = Vercel รันที่ค่าเริ่มต้น iad1 (วอชิงตัน) · ยืนยันจาก header จริง
  // x-vercel-id: sin1::iad1::... = เข้าที่สิงคโปร์ แต่ไปทำงานที่อเมริกา
  // ฐานข้อมูลอยู่โซล (ap-northeast-2) ทุกคำสั่งจึงอ้อมโลก และรูปเมนู/ใบครัวก็ช้าตาม
  ["ฟังก์ชันรันที่สิงคโปร์ ไม่ใช่อเมริกา",
    Array.isArray(VERCEL.regions) && VERCEL.regions.length === 1 && VERCEL.regions[0] === "sin1"],
  // ── ลบโต๊ะที่มีบิลเก่า ──
  // ฐานข้อมูลกันไว้ด้วย foreign key (ถูกแล้ว — ลบผ่านเมื่อไหร่ประวัติการขายพัง)
  // แต่เดิมโยนข้อความดิบ 23503 ใส่หน้าพนักงาน ซึ่งอ่านไม่รู้เรื่องและทำอะไรต่อไม่ได้
  ["ลบโต๊ะไม่ได้ต้องอธิบายเป็นภาษาคน ไม่ใช่โยน error ดิบ",
    APP.includes("const fk=/23503|foreign key|still referenced/i.test")],
  ["เสนอซ่อนออกจากผังแทน (บิลเก่าไม่หาย)",
    APP.includes("api.updatePOSTable(id,{active:false})") && APP.includes("โต๊ะนี้มีประวัติการขาย")],
  ["ถามก่อนซ่อน ไม่ตัดสินใจแทน", APP.includes('confirmLabel:"ซ่อนออกจากผัง"')],
  ["ผังโต๊ะยังกรองเฉพาะโต๊ะที่เปิดใช้อยู่", APP.includes("active=eq.true")],
  // ── กลุ่มตัวเลือกที่บังคับเลือกหลายอย่าง (เซต 2 เตา) ──
  ["ไม่เคยตั้งจำนวน = บังคับ 1 เหมือนเดิมทุกประการ", needOfFn(G(3, true, undefined)) === 1],
  ["บังคับ 1 → เลือกใบที่สองแทนที่ใบแรก (แบบวิทยุ)", tap(G(3, true, 1), ["c1", "c2"]).join() === "c2"],
  ["บังคับ 2 → เลือกได้สองใบพร้อมกัน", tap(G(3, true, 2), ["c1", "c2"]).join() === "c1,c2"],
  // ครบแล้วกดใบใหม่ ต้องได้ใบใหม่ ไม่ใช่กดไม่ติดเฉยๆ (ลูกค้าจะนึกว่าจอค้างแล้วกดรัว)
  // ครบแล้วกดใบที่สาม: ย้าย 1 จากตัวที่ไม่ได้แตะนานสุดมาให้ — กดแล้วต้องมีอะไรเกิดขึ้นเสมอ
  ["บังคับ 2 → ครบแล้วกดใบที่สาม ใบที่ไม่ได้แตะนานสุดหลุดออก", tap(G(3, true, 2), ["c1", "c2", "c3"]).join() === "c2,c3"],
  // เจ้าของสั่ง 11 ก.ย. 69: บังคับเลือกหลายตัว = เลือกตัวเดิมซ้ำได้ (เตาหมูกระทะ ×2)
  ["บังคับ 2 → กดตัวเดิมสองครั้ง = ได้ตัวนั้น ×2", tap(G(3, true, 2), ["c1", "c1"]).join() === "c1,c1"],
  ["บังคับ 2 → เต็มแล้วกดตัวเดิมอีก = ย้ายจากอีกตัวมา (รวมยังไม่เกิน 2)", tap(G(3, true, 2), ["c1", "c2", "c1"]).join() === "c1,c1"],
  ["บังคับ 2 → ตัวเดียวถือครบแล้วกดอีก = ไม่เกินจำนวนที่บังคับ", tap(G(3, true, 2), ["c1", "c1", "c1"]).join() === "c1,c1"],
  ["ไม่บังคับ = เลือกกี่อย่างก็ได้ ไม่มีเพดาน", tap(G(4, false, 1), ["c1", "c2", "c3", "c4"]).length === 4],
  // เดิมหั่นจำนวนลงให้ไม่เกินตัวเลือกที่มี (เลือกซ้ำไม่ได้ ตั้ง 5 ในกลุ่ม 3 ตัว = สั่งไม่ได้)
  // ตอนนี้เลือกซ้ำได้ จำนวนที่ตั้งไว้ใช้ได้ตรงตัว — ตั้ง 2 ในกลุ่มที่มีตัวเดียว ก็สั่ง ×2 ได้
  ["ตั้งจำนวนเกินตัวเลือกที่มี ใช้ได้ตรงตัว เพราะเลือกซ้ำได้แล้ว", needOfFn(G(3, true, 5)) === 5 && tap(G(1, true, 2), ["c1", "c1"]).join() === "c1,c1"],
  ["ตั้ง 0 หรือค่าติดลบ ต้องกลับเป็น 1", needOfFn(G(3, true, 0)) === 1 && needOfFn(G(3, true, -2)) === 1],
  // ปุ่มสั่งต้องปลดล็อกเมื่อครบพอดี ไม่ใช่แค่เลือกอะไรก็ได้สักอย่าง
  ["ต้องเลือกครบตามจำนวนถึงจะสั่งได้", APP.includes("const missingRequired=grps.some(g=>g.required&&countIn(g)!==needOf(g));")],
  ["ป้ายบอกจำนวนที่ต้องเลือกตามค่าจริง", APP.includes("* บังคับ · เลือก {needOf(g)}")],
  ["มีตัวนับความคืบหน้าให้เห็นว่าเลือกไปกี่อย่าง", APP.includes("เลือกแล้ว {countIn(g)}/{needOf(g)}")],
  // ตั้งค่าได้ทั้งตอนสร้างและตอนแก้ ไม่งั้นกลุ่มเก่าปรับไม่ได้
  ["ฟอร์มสร้างกลุ่มมีช่องกรอกจำนวน", APP.includes("ต้องเลือกกี่อย่าง") && APP.includes("setGPick(")],
  ["ฟอร์มแก้กลุ่มมีช่องกรอกจำนวน", APP.includes("setEg(s=>({...s,pick:")],
  ["บันทึกจำนวนลงกลุ่มจริงทั้งสร้างและแก้",
    APP.includes("pick:gReq?Math.max(1,+gPick||1):1") && APP.includes("pick:eg.required?Math.max(1,+eg.pick||1):1")],
  // เลือกซ้ำได้แล้ว: ตั้ง 2 ในกลุ่มที่มีตัวเดียวสั่งได้จริง — คำเตือน "ลูกค้าจะสั่งไม่ได้" กลายเป็นคำเตือนผิด
  ["ไม่เตือนผิดๆ เมื่อตั้งจำนวนเกินตัวเลือก (เลือกซ้ำได้แล้ว)", !APP.includes("ลูกค้าจะสั่งไม่ได้")],
  // ── ลำดับหมวดที่ร้านจัดเอง (ลากสลับได้) ──
  ["ยังไม่เคยจัดลำดับ = เรียงไทยเหมือนเดิมทุกประการ",
    catSortWith(null, ["ยำ", "กาแฟ", "ไก่ทอด"]).join("|") === "กาแฟ|ไก่ทอด|ยำ"],
  ["จัดลำดับแล้ว หมวดที่จัดไว้มาก่อนตามลำดับที่ตั้ง",
    catSortWith({ category_order: ["ยำ", "กาแฟ"] }, ["กาแฟ", "ไก่ทอด", "ยำ"]).join("|") === "ยำ|กาแฟ|ไก่ทอด"],
  // หมวดใหม่ที่ครัวกลางเพิ่งเพิ่ม ยังไม่มีในลำดับ ต้องไปต่อท้าย ไม่ใช่หายไปจากจอ
  ["หมวดที่ยังไม่ได้จัด ไปต่อท้ายและเรียงไทยกันเอง",
    catSortWith({ category_order: ["ยำ"] }, ["ไก่ทอด", "กาแฟ", "ยำ", "ขนม"]).join("|") === "ยำ|กาแฟ|ไก่ทอด|ขนม"],
  ["ลำดับที่อ้างถึงหมวดที่ถูกลบไปแล้ว ต้องไม่ทำให้เพี้ยน",
    catSortWith({ category_order: ["หมวดที่ไม่มีแล้ว", "กาแฟ"] }, ["ยำ", "กาแฟ"]).join("|") === "กาแฟ|ยำ"],
  ["ค่าที่เก็บไว้เพี้ยน (ไม่ใช่รายการ) ต้องถอยไปเรียงไทย ไม่ใช่จอพัง",
    catSortWith({ category_order: "มั่ว" }, ["ยำ", "กาแฟ"]).join("|") === "กาแฟ|ยำ" &&
    catSortWith({}, ["ยำ", "กาแฟ"]).join("|") === "กาแฟ|ยำ"],
  // ทั้งสามจอต้องเรียงด้วยตัวเดียวกัน ไม่งั้นพนักงานจัดแล้วลูกค้าเห็นคนละลำดับ
  ["ทั้งสามจอใช้ตัวเรียงเดียวกัน", APP.split("catSorter(").length - 1 >= 3],
  ["จอสั่งอาหารเรียงตามลำดับที่จัดไว้", APP.includes("seen.sort(catSorter(catOrderOf(posSettings)))")],
  ["หน้าลูกค้าสแกนเรียงตามลำดับเดียวกัน", APP.includes("].sort(catSorter(catOrderOf(posCfg)))")],
  ["จอเมนูทั้งหมดเรียงตามลำดับที่จัดไว้", APP.includes("catSorter(catOrder)(a[0],b[0])")],
  // เขียนทั้งแถวจะทับ VAT/ค่าบริการ/QR ที่เครื่องอื่นเพิ่งแก้ — เงินผิดเงียบ
  ["บันทึกลำดับแตะเฉพาะคอลัมน์ลำดับ ไม่ทับค่าอื่น",
    APP.includes('{method:"PATCH", body:JSON.stringify({category_order:order})}')],
  // ปัดเลื่อนแถบหมวดต้องยังทำได้ ไม่งั้นหมวดที่อยู่ท้ายๆ เข้าไม่ถึง
  ["ต้องกดค้างก่อนถึงจะลาก ไม่ใช่แตะแล้วลากทันที", APP.includes("const HOLD_MS=350;") && APP.includes("holdRef.current=setTimeout(")],
  ["ขยับก่อนครบเวลา = ตั้งใจปัดเลื่อน ต้องยกเลิกการลาก", APP.includes("if(Math.abs(ev.clientX-sx)>8||Math.abs(ev.clientY-sy)>8)clear();")],
  ["ลากอยู่ต้องไม่เผลอสั่งเปลี่ยนหมวดที่กรอง", APP.includes("onClick={()=>{if(!drag)setCat(v);}}")],
  ["บันทึกไม่สำเร็จต้องคืนลำดับเดิม ไม่ใช่ค้างที่ลำดับที่ยังไม่ได้บันทึก",
    APP.includes("catch(e){ setCatOrder(catOrder); alert(")],
  // ── ประวัติการขาย: ต้องตามหาบิลเก่าเจอ และพิมพ์ซ้ำเป็น PDF ได้ ──
  // เดิมเดินทีละวันอย่างเดียว ไม่มีค้นหา และหน้ารายละเอียดไม่มีปุ่มอะไรเลยนอกจากปุ่มย้อนกลับ
  ["ดูย้อนหลังเป็นช่วงได้ ไม่ใช่ทีละวัน", APP.includes("const[span,setSpan]=useState(1);")],
  ["ค้นหาบิลจากเลขบิล/โต๊ะ/เมนู/ยอดได้", APP.includes("const hit=(o)=>{") && APP.includes("const all=orders.filter(hit);")],
  ["มีปุ่มพิมพ์ใบเสร็จย้อนหลัง", APP.includes("function printBill(){") && APP.includes("พิมพ์ใบเสร็จ / บันทึก PDF")],
  // ต้องเปิดหน้าต่างพิมพ์ตรงจากการกด ถ้ามี await คั่น เบราว์เซอร์จะบล็อกเพราะไม่นับเป็นการกดของผู้ใช้
  ["โหลดตั้งค่าใบเสร็จไว้ก่อน ไม่ใช่ตอนกดพิมพ์", APP.includes("const[cfg,setCfg]=useState(null);")],
  ["ปุ่มพิมพ์ไม่มี await คั่นก่อนเปิดหน้าต่าง", (() => {
    const i = APP.indexOf("function printBill(){");
    if (i < 0) return false;
    const seg = APP.slice(i, i + 340), p = seg.indexOf("printReceipt(");
    return p > 0 && !seg.slice(0, p).includes("await ");
  })()],
  ["ใบเสร็จย้อนหลังใช้ข้อมูลของบิลใบนั้นจริง", APP.includes("printReceipt(o,o.table_number,branch?.name")],
  ["เห็นทั้งคนรับออเดอร์และคนปิดบิล", APP.includes("รับออเดอร์โดย") && APP.includes("ปิดบิลโดย")],
  ["ลูกค้าสแกนสั่งเองต้องอ่านออก ไม่ใช่คำว่า customer", APP.includes("ลูกค้าสแกนสั่งเอง")],
  ["ดึงบิลย้อนหลังแบบแบ่งหน้า (ช่วงเดือนเกิน 1000 บิลได้)", APP.includes("getPOSOrdersByDay: (bid, startISO, endISO) => sbAll(")],
  // iOS: touch-action ที่เปลี่ยนกลางท่าทางไม่มีผล ต้องห้ามเลื่อนด้วย preventDefault
  // และต้องกันเมนูกดค้างของระบบ ไม่งั้นมันแย่ง pointer ไป = กดค้างแล้วไม่มีอะไรเกิดขึ้น
  ["ห้ามจอเลื่อนระหว่างลากด้วย preventDefault ไม่ใช่ touch-action",
    APP.includes('el.addEventListener("touchmove",stop,{passive:false});')
    && APP.includes('el.removeEventListener("touchmove",stop,{passive:false});')],
  ["ผูกตัวห้ามเลื่อนเฉพาะตอนลาก ไม่ผูกค้างไว้", APP.includes("const dragging=!!drag;") && APP.includes("if(!dragging)return;")],
  ["กันเมนูกดค้างของ iOS ที่แย่ง pointer", APP.includes("WebkitTouchCallout:\"none\"") && APP.includes("onContextMenu:(e)=>e.preventDefault()")],
  // ── ลากแล้วต้องลื่น ไม่กระพริบ ──
  // รอบแรกสลับลำดับจริงทุกครั้งที่นิ้วขยับ = ทั้งแถวคำนวณผังใหม่รัวๆ ภาพกระพริบลายตา
  // ที่ถูกคือลำดับจริงอยู่นิ่ง ขยับแค่ภาพด้วย transform ซึ่งไม่ต้องคำนวณผังใหม่
  ["ระหว่างลากไม่จัดเรียงลำดับจริงใหม่",
    !APP.includes("const previewNames=") && APP.includes("// ลำดับนี้เปลี่ยนเฉพาะตอนปล่อยนิ้ว")],
  ["ขยับภาพด้วย transform ไม่ใช่สลับตำแหน่ง", APP.includes("el.style.transform=x?")],
  // อ่านตำแหน่งจาก DOM ทุกเฟรม = บังคับเบราว์เซอร์คำนวณผังใหม่ทุกเฟรม (ตัวการทำให้หนืด)
  ["วัดตำแหน่งชิปครั้งเดียวตอนเริ่มจับ ไม่วัดซ้ำทุกเฟรม",
    APP.includes("const rects=chips.map(c=>{const r=c.getBoundingClientRect();")],
  ["ไม่เรนเดอร์ใหม่ระหว่างลาก (เขียน DOM ตรงๆ)", APP.includes("if(!d.raf)d.raf=requestAnimationFrame(")],
  ["ใบที่จับตามนิ้วไม่มีหน่วง ใบอื่นไถลหลบ", APP.includes('el.style.transition=i===d.from?"none":"transform .18s')],
  ["ปล่อยนิ้วแล้วล้าง transform ทิ้งทั้งหมด", APP.includes('d.chips.forEach(el=>{el.style.transform="";')],
  // แถบหมวดเรียงตามที่ลากแล้ว แต่ถ้าตัวเมนูใน "ทั้งหมด" ไม่เรียงตาม การลากก็ไม่ได้ผลตามที่ตั้งใจ
  ["เมนูใน ทั้งหมด จัดกลุ่มตามลำดับหมวด (ทั้งสองฝั่ง)",
    APP.split(").sort(ms);").length - 1 === 2],
  ["ทั้งสองฝั่งอ่านลำดับจากที่เก็บเดียวกัน",
    APP.includes("menuSorter(catOrderOf(posCfg),menuOrderOf(posCfg))")
    && APP.includes("menuSorter(catOrderOf(posSettings),menuOrderOf(posSettings))")],
  // จอขายเคยลืมใส่ posSettings ใน deps — โหลดตั้งค่ามาทีหลังแล้วจอไม่เรียงใหม่ ลากแล้วเหมือนไม่มีอะไรเกิดขึ้น
  ["จอขายเรียงใหม่เมื่อตั้งค่ามาถึง", APP.includes("},[menus,selCat,search,bidSale,posSettings]);")],
  // ── บิลต้องมีชื่อโต๊ะเสมอ (เหตุจริง 9 ก.ย. 69: บิล #17 ไม่มีชื่อโต๊ะ ใบครัวเลยไร้ปลายทาง) ──
  // หน้าลูกค้าอ่านชื่อโต๊ะจากสถานะบนจอ ตอนส่งของค้างจากคิวออฟไลน์สถานะยังโหลดไม่เสร็จ
  // ปิดที่ posAppendItems จุดเดียว เพราะทุกทางที่สร้างบิลผ่านฟังก์ชันนี้หมด
  ["ไม่มีชื่อโต๊ะส่งมา ให้ไปหาจาก table_id ก่อนสร้างบิล",
    APP.includes('if((table_number==null||String(table_number).trim()==="")&&table_id!=null){')
    && APP.includes("if(Array.isArray(r)&&r[0]&&r[0].table_number)table_number=r[0].table_number;")],
  ["หาไม่เจอก็ยังต้องบันทึกบิลได้ ไม่ใช่ล้มทั้งออเดอร์", APP.includes("      }catch{}\n    }\n    const sum =")],
  // ใบครัวคือกระดาษใบเดียวที่ครัวมี ต้องมีทุกอย่างที่ต้องใช้
  ["ใบครัวพิมพ์เลขบิลและผู้สั่ง", SLIP.includes("const foot = [body.bill ?")],
  ["ลูกค้าสแกนสั่งเองต้องอ่านออกบนใบครัว", SLIP.includes('"ลูกค้าสแกนสั่งเอง"')],
  ["ชื่อโต๊ะยังเป็นตัวใหญ่สุดบนใบ", SLIP.includes('{ t: String(body.table || ""), size: 76, bold: true, align: "center" }')],
  ["ตัวเลือกและหมายเหตุยังพิมพ์ครบ", SLIP.includes('lines.push({ t: "- " + n + ') && SLIP.includes('lines.push({ t: "* " + it.note,')],
  ["ไม่มีจุดไหนใส่รายการดิบลง state อีก",
    !APP.includes("setPrinters(pr);") && !APP.includes("setPrinters(d);") && !APP.includes("setPrinters(prs||[]);")],
];
for (const [label, cond] of guards) ok_(label, cond);

// ══════════════════════════════════════════════════════════════════════════
// ลำดับเมนูที่ร้านจัดเอง — "จะเอาเมนูไหนขึ้นก่อน ลูกค้าจะได้เห็นเมนูนั้นก่อน"
// ค้นข้อความอย่างเดียวไม่พอ: เขียน .sort(ms) ไว้แต่ตัวเทียบคืนค่าผิด ลำดับบนจอก็ยังผิด
// ต้องดึงตัวเรียงตัวจริงมาเรียงจริงแล้วดูผล
// ══════════════════════════════════════════════════════════════════════════
section("ลำดับเมนูที่ร้านจัดเอง");
{
  const L = APP.split("\n");
  const src = [L.find(l => l.startsWith("const _thColl=")), L.find(l => l.startsWith("const thCmp=")),
    grabConst(APP, "menuCatOf"), grabConst(APP, "catOrderOf"), grabConst(APP, "catSorter"),
    grabConst(APP, "menuOrderOf"), grabConst(APP, "menuSorter")].join("\n");
  const f = new Function(src + "\nreturn {catOrderOf,menuOrderOf,menuSorter};")();
  const sortWith = (st, ms) => ms.slice().sort(f.menuSorter(f.catOrderOf(st), f.menuOrderOf(st))).map(m => m.name);

  const M = [
    { id: 1, name: "ข้าวผัด", category: "อาหารจานเดียว" },
    { id: 2, name: "หมูกระทะ", category: "หมูกระทะ" },
    { id: 3, name: "ข้าวไข่เจียว", category: "อาหารจานเดียว" },
    { id: 4, name: "เซตหมู", category: "หมูกระทะ" },
  ];
  ck("ยังไม่เคยจัดลำดับ = เรียงหมวดตามตัวอักษรไทย คงลำดับเมนูเดิมไว้",
    sortWith({}, M), ["หมูกระทะ", "เซตหมู", "ข้าวผัด", "ข้าวไข่เจียว"]);
  ck("จัดลำดับหมวดแล้ว หมวดนั้นมาก่อนทั้งก้อน",
    sortWith({ category_order: ["หมูกระทะ"] }, M), ["หมูกระทะ", "เซตหมู", "ข้าวผัด", "ข้าวไข่เจียว"]);
  ck("ดันเมนูขึ้นก่อนในหมวดเดียวกันได้",
    sortWith({ menu_order: [3, 1] }, M), ["หมูกระทะ", "เซตหมู", "ข้าวไข่เจียว", "ข้าวผัด"]);
  // ลำดับเมนูห้ามข้ามหมวด ไม่งั้นลากในจอจัดการแล้วปล่อย ของจะเด้งกลับที่เดิมให้งง
  ck("ลำดับเมนูไม่ข้ามหมวด — หมวดยังเป็นตัวตัดสินก่อนเสมอ",
    sortWith({ category_order: ["อาหารจานเดียว", "หมูกระทะ"], menu_order: [4, 2, 3, 1] }, M),
    ["ข้าวไข่เจียว", "ข้าวผัด", "เซตหมู", "หมูกระทะ"]);
  ck("เมนูที่ยังไม่เคยจัด ไปต่อท้ายหมวดโดยคงลำดับเดิม",
    sortWith({ menu_order: [4] }, M), ["เซตหมู", "หมูกระทะ", "ข้าวผัด", "ข้าวไข่เจียว"]);
  ck("id เป็นเลขหรือข้อความก็ต้องเจอเหมือนกัน (jsonb คืนมาเป็นได้ทั้งสองแบบ)",
    sortWith({ menu_order: ["3"] }, M), ["หมูกระทะ", "เซตหมู", "ข้าวไข่เจียว", "ข้าวผัด"]);
  ck("id ที่ไม่มีเมนูแล้ว (ลบทิ้งไป) ไม่ทำให้ลำดับเพี้ยน",
    sortWith({ menu_order: [999, 3] }, M), ["หมูกระทะ", "เซตหมู", "ข้าวไข่เจียว", "ข้าวผัด"]);

  ok_("บันทึกลำดับเมนูแตะเฉพาะคอลัมน์ลำดับ ไม่ทับ VAT/QR",
    APP.includes('{method:"PATCH", body:JSON.stringify({menu_order:order})}'));
  ok_("ทั้งสามจออ่านตัวเรียงตัวเดียวกัน", APP.split("menuSorter(").length - 1 >= 4);
}

// ══════════════════════════════════════════════════════════════════════════
// จอ "เมนูทั้งหมด" — การ์ดเหมือนหน้าลูกค้า + กดค้างลากจัดลำดับ ต้องลื่นไม่กระพริบ
// ══════════════════════════════════════════════════════════════════════════
section("จอเมนูทั้งหมด: ตารางการ์ด + ลากจัดลำดับ");
{
  ok_("เป็นการ์ดในตาราง ไม่ใช่รายการแถวยาว", APP.includes('gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))"'));
  ok_("การ์ดมีรูปแบบเดียวกับหน้าลูกค้าสแกน (โหลดรูปแบบไม่หน่วงจอ)",
    APP.includes("const MenuMgrCard=memo(function MenuMgrCard(") && APP.includes('driveImgSrc(m.image,160)'));
  // 250 ใบ: ถ้าไม่ครอบ memo กดสถานะทีเดียวเรนเดอร์ใหม่ทั้งจอ = สะดุด/รูปกระพริบ
  ok_("การ์ดจำผลไว้ ไม่เรนเดอร์ใหม่ทั้งจอเวลากดปุ่มใบเดียว", APP.includes("memo(function MenuMgrCard"));
  ok_("ฟังก์ชันที่ส่งให้การ์ดนิ่ง ไม่งั้น memo ไม่มีผลเลย",
    APP.includes("const setAvail=useCallback(async function setAvail(") &&
    APP.includes("const openBind=useCallback(function openBind(") &&
    APP.includes("const beginMHold=useCallback("));
  ok_("จอจัดการเรียงเหมือนที่ลูกค้าเห็น", APP.includes(".sort(menuSorter(catOrder,menuOrder))"));
  // ── ลากแล้วต้องลื่น: ใช้ท่าเดียวกับแถบหมวดที่พิสูจน์แล้ว ──
  ok_("ต้องกดค้างก่อนถึงจะลาก ไม่ใช่แตะแล้วลากทันที", APP.includes("const MHOLD_MS=350;"));
  ok_("วัดตำแหน่งการ์ดครั้งเดียวตอนเริ่มจับ ไม่วัดซ้ำทุกเฟรม",
    APP.includes("const rects=cards.map(c=>{const r=c.getBoundingClientRect();"));
  ok_("ระหว่างลากเขียน transform ลง DOM ตรงๆ ไม่เรนเดอร์ใหม่", APP.includes("d.cards[d.from].style.transform=") && APP.includes("translate3d(" + "$" + "{d.dx}px,"));
  ok_("ตารางต้องคิดทั้งซ้ายขวาและขึ้นลง ไม่ใช่แกนเดียว",
    APP.includes("x=d.rects[i-1].l-d.rects[i].l;y=d.rects[i-1].t-d.rects[i].t;"));
  ok_("ใบอื่นขยับเฉพาะตอนเป้าหมายเปลี่ยน ไม่ไล่เขียนทั้ง 250 ใบทุกเฟรม", APP.includes("if(!all)return;"));
  ok_("กันภาพสั่นสลับไปมาตรงกึ่งกลางระหว่างสองช่อง", APP.includes("if(bd<cd-900)"));
  ok_("ลากชิดขอบแล้วจอไถลตาม และค่าที่วัดไว้ขยับตามด้วย",
    APP.includes("if(mv){d.rects.forEach(r=>{r.t-=mv;r.cy-=mv;});d.sy-=mv;}"));
  ok_("ปล่อยนิ้วแล้วล้าง transform ทิ้งทั้งหมด",
    APP.includes('el.style.transform="";el.style.transition="";el.style.willChange="";'));
  ok_("กดปุ่มบนการ์ดต้องไม่กลายเป็นการลาก", APP.split("onPointerDown={(e)=>e.stopPropagation()}").length - 1 >= 2);
  ok_("iOS: กันจอเลื่อนด้วย touchmove ไม่ใช่ touch-action (เปลี่ยนกลางท่าทางไม่มีผล)",
    APP.includes("},[mDrag]);"));
  // ── หลายนิ้วบนจอเดียว (ไอแพดที่ร้านวางมือทับจอตลอด) ──
  // ตอนแรกตัวลากไม่ดูเลยว่า event มาจากนิ้วไหน: ฝ่ามือที่แตะแล้วยกขึ้น ก็จบการลางของนิ้วจริง
  // แล้ว "บันทึก" ตำแหน่งกลางคันลงฐานข้อมูลเลย ทั้งที่คนยังไม่ได้ปล่อย
  ok_("รับเฉพาะนิ้วที่จับการ์ดอยู่ ไม่ใช่นิ้วไหนก็ได้",
    APP.includes("if(!d||e.pointerId!==d.pid)return;") && APP.includes("if(e&&e.pointerId!=null&&e.pointerId!==d.pid)return;")),
  ok_("จับได้ทีละนิ้ว นิ้วที่สองไม่ไปทับการลากที่ค้างอยู่", APP.includes("if(mHoldRef.current||mDragRef.current)return;")),
  // ระบบยกเลิกท่าทางให้ = ยังไม่ได้ปล่อยตรงนั้น ถ้าไปบันทึกคือย้ายเมนูให้เองโดยไม่มีใครสั่ง
  ok_("ระบบยกเลิกท่าทางแล้วต้องคืนที่เดิม ไม่ใช่บันทึก",
    APP.includes("onPointerCancel={cancelMDrag}") && APP.includes("function cancelMDrag(e){ return finishMDrag(e,false); }")),
  ok_("บันทึกลำดับไม่สำเร็จต้องคืนลำดับเดิม", APP.includes("      setMenuOrder(st.menuOrder);"));
  // คอลัมน์ menu_order เป็นของใหม่ — ก่อนรัน SQL ต้องบอกเป็นภาษาคน ไม่ใช่โยนข้อความดิบใส่หน้าเจ้าของ
  ok_("ยังไม่ได้รัน SQL ต้องบอกเป็นภาษาคน", APP.includes("ต้องรัน SQL เพิ่มคอลัมน์ menu_order ครั้งเดียว"));
  // กรองด้วยคำค้นอยู่แล้วลาก: ถ้าบันทึกแค่ที่เห็นบนจอ เมนูที่เหลือจะหลุดลำดับไปกองท้ายทันที
  ok_("ลำดับที่บันทึกครอบคลุมเมนูทั้งสาขา ไม่ใช่เฉพาะที่กรองอยู่บนจอ",
    APP.includes("const all=st.menus.filter(m=>st.isCentral||menuVisibleAt(m,st.bid)).sort(menuSorter(st.catOrder,st.menuOrder)).map(m=>String(m.id));"));
}

// ══════════════════════════════════════════════════════════════════════════
// หมวดหมู่ต้องตรงกันทุกจอในสาขา
// ตรวจจริง 9 ก.ย. 69: หมวดของเมนูอยู่ที่ menus.category แต่ชิปในจอเมนูอ่านจากตาราง categories
// 7 หมวดที่เมนู 41 ตัวใช้อยู่ไม่มีแถวในตาราง → จอเมนูไม่มีชิปให้กด ทั้งที่หน้าลูกค้าเห็นอยู่
// อีก 4 หมวดมีแถวซ้ำ → ชิปขึ้นซ้ำสองใบ
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// หน้าลูกค้าสแกนต้องเลื่อนดูเมนูได้บนมือถือ
// เหตุจริง 9 ก.ย. 69: ลูกค้าเลื่อนดูเมนูขึ้นลงไม่ได้เลย
// กรอบหน้าใช้ min-height:100vh = สูงตามเนื้อหา (วัดของจริงบนสาขา 8 ได้ 11,499px)
// กล่องรายการเมนูข้างในจึงยืดเท่าเนื้อหา ไม่เคยล้น = ไม่เคยมีแถบเลื่อนของตัวเอง
// บน iOS นิ้วที่แตะอยู่ในกล่อง overflow:auto ที่เลื่อนไม่ได้ จะไม่ส่งต่อการเลื่อนขึ้นไปให้หน้าเว็บ
// และกล่องนั้นกินพื้นที่เต็มจอ = ทุกการปัดนิ้วตายหมด
// สองอย่างที่ต้องมีคู่กันเสมอ: กรอบมีความสูงแน่นอน + ช่องที่จะเลื่อนต้อง min-height:0
// (ค่าเริ่มต้น min-height:auto แปลว่า "อย่างน้อยเท่าเนื้อหา" ช่องจึงไม่ยอมหดและไม่มีวันเกิดแถบเลื่อน)
// ══════════════════════════════════════════════════════════════════════════
section("หน้าลูกค้าสแกน: เลื่อนดูเมนูได้");
{
  const st = APP.indexOf("function CustomerPage(");
  if (st < 0) throw new Error("ไม่เจอหน้าลูกค้า");
  let en = APP.indexOf("\nfunction ", st + 10);
  if (en < 0) en = APP.length;
  const CUST = APP.slice(st, en);

  ok_("กรอบหน้าลูกค้าใช้ความสูงแน่นอน ไม่ใช่ min-height ที่ยืดตามเนื้อหา",
    CUST.includes('return <div className="cust-shell"') && !CUST.includes('<div style={{minHeight:"100vh",background:C.bg,maxWidth:480'));
  ok_("ความสูงนั้นนิยามไว้จริงและเผื่อเบราว์เซอร์ที่ไม่รู้จัก dvh",
    HTML.includes(".cust-shell { height: 100vh; height: 100dvh; }"));

  // ทุกช่องที่ตั้งใจให้เลื่อนในหน้านี้ ต้องหดได้จริง — ไม่งั้นเป็นช่องเลื่อนแต่ในชื่อ
  const scrollers = CUST.split('flex:1,overflowY:"auto"').length - 1;
  const shrinkable = CUST.split('flex:1,overflowY:"auto",minHeight:0').length - 1;
  ck("ช่องที่ตั้งใจให้เลื่อนในหน้าลูกค้า หดได้จริงทุกช่อง", { scrollers, shrinkable }, { scrollers: 3, shrinkable: 3 });
  ok_("ปัดเลยขอบแล้วไม่ไปลากหน้าเว็บข้างหลัง", CUST.includes('overscrollBehavior:"contain"'));
  // ความสูงแน่นอน + ตาราง = กับดัก: แถวจะถูกบีบให้พอดีกรอบแทนที่จะสูงตามการ์ด
  // (การ์ดเป็น overflow:hidden ขนาดต่ำสุดอัตโนมัติจึงเป็น 0 ยุบได้ไม่จำกัด)
  // วัดของจริงหลังขึ้นระบบ: การ์ดเหลือ 2.49px ทั้ง 100 ใบ อ่านอะไรไม่ได้เลย
  ok_("แถวการ์ดสูงตามเนื้อหา ไม่ถูกความสูงของกรอบบีบจนแบน",
    CUST.includes('gridTemplateColumns:"repeat(2,1fr)",gridAutoRows:"max-content"'));
}

section("หมวดหมู่ตรงกันทุกจอ");
{
  const head = "const allMenuCats=useMemo(()=>{";
  const tail = "\n  },[allCats,menus]);";
  const a = APP.indexOf(head), b = APP.indexOf(tail, a);
  if (a < 0 || b < 0) throw new Error("อ่านชิปหมวดในจอเมนูไม่ได้");
  const body = APP.slice(a + head.length, b);
  const L2 = APP.split("\n");
  const dep = new Function(L2.find(l => l.startsWith("const _thColl=")) + "\n" +
    L2.find(l => l.startsWith("const thCmp=")) + "\n" + grabConst(APP, "menuCatOf") +
    "\nreturn (allCats,menus)=>{" + body + "};")();

  const ROWS = [
    { id: 1, name: "อาหารจานเดียว", type: "menu" },
    { id: 2, name: "กาแฟ", type: "menu" },
    { id: 3, name: "กาแฟ", type: "menu" },              // แถวซ้ำของจริงมี 4 หมวดแบบนี้
    { id: 4, name: "เครื่องดื่ม/แอล", type: "menu" },     // แถวที่ไม่มีเมนูไหนใช้เลย
    { id: 5, name: "ของสาขา", type: "menu", branch_id: 6 },
    { id: 6, name: "หมูสามชั้น", type: "ingredient" },
  ];
  const MS = [
    { id: 11, category: "อาหารจานเดียว" },
    { id: 12, category: "Refill" },                      // ไม่มีแถวในตาราง
    { id: 13, category: "ยำบุฟเฟต์" },                    // ไม่มีแถวในตาราง
    { id: 14, category: "  " },                          // ยังไม่จัดหมวด
    { id: 15, category: "Refill" },
  ];
  const got = dep(ROWS, MS);
  ck("แถวซ้ำชื่อเดียวกันเหลือชิปเดียว", got.filter(c => c.name === "กาแฟ").length, 1);
  ck("หมวดของสาขาอื่น/ชนิดอื่นไม่หลุดมา", got.some(c => c.name === "ของสาขา" || c.name === "หมูสามชั้น"), false);
  ck("แถวที่ไม่มีเมนูใช้ก็ยังอยู่ (ครัวกลางเพิ่งสร้างไว้รอ)", got.some(c => c.name === "เครื่องดื่ม/แอล"), true);
  ck("หมวดที่เมนูใช้จริงแต่ไม่มีแถว ต้องมีชิป", got.filter(c => c.name === "Refill").length, 1);
  ck("ลำดับชิปเดิมไม่ถูกสลับ ของใหม่ต่อท้าย",
    got.map(c => c.name), ["อาหารจานเดียว", "กาแฟ", "เครื่องดื่ม/แอล", "ยำบุฟเฟต์", "Refill"]);
  ck("หมวดที่ไม่มีแถวถูกทำเครื่องหมายไว้ (แก้ชื่อ/ลบไม่ได้)",
    got.filter(c => c.noRow).map(c => c.name), ["ยำบุฟเฟต์", "Refill"]);
  ck("เมนูที่ยังไม่จัดหมวดไม่กลายเป็นชิปว่าง", got.some(c => !String(c.name || "").trim()), false);
  ok_("ปุ่มแก้ชื่อไม่ขึ้นกับหมวดที่ไม่มีแถว", APP.includes("{isCentral&&!cat.noRow&&<button onClick={()=>{setEditingCatId(cat.id);"));
  ok_("ปุ่มลบไม่ขึ้นกับหมวดที่ไม่มีแถว", APP.includes("{isCentral&&!cat.noRow&&<button onClick={()=>delCat(cat)}"));
}

// ══════════════════════════════════════════════════════════════════════════
// จอสั่งอาหาร: ปุ่มพิมพ์ซ้ำ / ยกเลิกรายการ ต้องถึงครัวจริง
// เหตุจริง 9 ก.ย. 69: POSSaleMode ไม่เคยส่ง prop printers ให้ POSOrderPanel เลย
// ค่าที่ใช้จึงเป็นลิสต์ว่าง ([] ตาม default) ตลอด ผลคือ
//   · ยกเลิกรายการ → printKitchen หาเครื่องไม่เจอ ตกไปทางเปิดหน้าต่างพิมพ์
//     ซึ่งถูกเบราว์เซอร์บล็อก (มี await คั่นก่อน ไม่ใช่การกดโดยตรง) = ครัวไม่เคยรู้ว่ายกเลิก
//   · แถบเตือน "พิมพ์ไม่สำเร็จ" อ่านจากลิสต์ว่าง จึงไม่เคยขึ้นสักครั้ง
// ยิ่งกว่านั้น หน้าเว็บเป็น https จะยิง ESC/POS ตรงไป 192.168.x.x ไม่ได้อยู่แล้ว (mixed content)
// เส้นทางที่ใช้ได้จริงมีเส้นเดียวคือฝากคำสั่งให้ "ตัวพิมพ์ (agent)" ไปพิมพ์ให้
// ══════════════════════════════════════════════════════════════════════════
section("จอสั่งอาหาร: พิมพ์ซ้ำ/ยกเลิก ถึงครัวจริง");
{
  // ตัวตรวจ "ตัวแปรไม่มีอยู่จริง" ต้องกวาดตัวพิมพ์กับ api/* ด้วย ไม่ใช่แค่ไฟล์แอป
  // ถ้าตัดออก บั๊คแบบ v35 (อ้าง meta ที่ไม่มี → ปุ่มพิมพ์ซ้ำตายเงียบ) จะหลุดขึ้นระบบได้อีก
  {
    const U = fs.readFileSync(new URL("./check-undef.mjs", import.meta.url), "utf8");
    ok_("ตัวตรวจตัวแปรกวาดตัวพิมพ์ด้วย", U.includes('"public/print-agent.js",'));
    ok_("ตัวตรวจตัวแปรกวาดฟังก์ชันฝั่งเซิร์ฟเวอร์ด้วย", U.includes('fs.readdirSync("api")'));
    ok_("build เรียกตัวตรวจตัวแปรก่อนเสมอ",
      JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts.build.startsWith("node tools/check-undef.mjs"));
  }
  ok_("จอขายส่งรายชื่อเครื่องพิมพ์ให้จอสั่งอาหารจริง",
    APP.includes("<POSOrderPanel table={selTable}") && /<POSOrderPanel\b[^>]*\sprinters=\{printers\}/.test(APP));
  // ทุกที่ที่เรียก POSOrderPanel ต้องส่ง printers ไม่ใช่แค่ที่แรก
  ok_("ไม่มีจุดเรียก POSOrderPanel ที่ลืมส่งเครื่องพิมพ์",
    (APP.match(/<POSOrderPanel\b[^>]*>/g) || []).every(t => t.includes("printers={")));
  // ยกเลิกรายการต้องแจ้งครัวผ่านตัวพิมพ์ ไม่ใช่ยิงตรงจากเบราว์เซอร์ (https ยิงไม่ถึงอยู่แล้ว)
  ok_("ยกเลิกรายการแจ้งครัวผ่านตัวพิมพ์",
    APP.includes('await agentReprint([{...target,qty:target.qty,name:`ยกเลิก: ${target.name}`'));
  // ฟอนต์ที่ใช้เรนเดอร์ใบครัวไม่มีอีโมจิ ใส่ไปจะออกมาเป็นกล่องสี่เหลี่ยมบนกระดาษ
  ok_("ไม่มีอีโมจิในชื่อรายการที่ส่งไปพิมพ์", !APP.includes("name:`❌ ยกเลิก:"));
  ok_("ไม่เหลือการยิงตรงจากเบราว์เซอร์ในทางยกเลิกรายการ", (() => {
    const st = APP.indexOf("async function voidItem(idx){");
    if (st < 0) return false;
    let d = 0, en = -1;
    for (let j = APP.indexOf("{", st); j < APP.length; j++) {
      if (APP[j] === "{") d++;
      else if (APP[j] === "}") { d--; if (!d) { en = j; break; } }
    }
    return !APP.slice(st, en).includes("printKitchen(");
  })());
  ok_("ยกเลิกไม่สำเร็จต้องบอกให้ไปบอกครัวเอง ไม่ใช่เงียบ",
    APP.includes("กรุณาบอกครัวด้วยตัวเอง"));
  // ใบพิมพ์ซ้ำต้องมีข้อมูลเท่าใบแรก ไม่งั้นครัวได้กระดาษที่อ้างอิงอะไรไม่ได้
  ok_("คำสั่งพิมพ์ซ้ำพกเลขบิลและผู้สั่งไปด้วย",
    APP.includes("bill:existingOrder?.id??null,by:currentUser?.username||null"));
}

// ══════════════════════════════════════════════════════════════════════════
// ปิดกะ → ยอดขายเข้าระบบบัญชี (SlipTrack pos_closing)
// สเปกที่ตกลงกับฝั่งบัญชี 10 ก.ย. 69 — เป็นเงินที่จะลงสมุดบัญชีจริง ผิดไม่ได้
// ดึง handler ตัวจริงมา "เรียก" ด้วยข้อมูลจำลอง แล้วดักตอนจะยิงออก เพื่อดู payload จริง
// ══════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════
// กันแก้ VAT ระหว่างที่กะยังเปิดอยู่
// เหตุจริง 9 ก.ย. 69 สาขา 8: สวิตช์ VAT ถูกกดไป-กลับ 9 ครั้งในเย็นเดียว
// บิล 41 ใบเก็บภาษีแค่ 8 ใบ · ใบเสร็จอยู่กับลูกค้าแล้ว แก้ย้อนหลังไม่ได้
// ฝ่ายบัญชีประเมินว่ายอดที่ออกไปโดยไม่เก็บ VAT อาจต้องนำส่งเอง ~฿1,757 (วันเดียว)
// ══════════════════════════════════════════════════════════════════════════
// หมายเหตุการจ่าย PO เก็บมาตลอดแต่ไม่เคยแสดงที่ไหนเลยทั้งสองระบบ (ตรวจ 10 ก.ย. 69)
// ข้อความเป็นข้อเท็จจริงทางการเงิน เช่น "โอนเกิน 50 บาท โอนคืนแล้ว" · "โอนรวม 4 PO"
// = คำตอบว่าทำไมยอดโอนไม่ตรงยอดบิล สิ่งแรกที่คนกระทบยอดกับสเตทเมนต์ต้องการ
section("หมายเหตุการจ่าย PO ต้องมีคนเห็น");
{
  ok_("จอ PO แสดงหมายเหตุการจ่าย", APP.includes("{po.payment_note&&<div style={{marginTop:6,"));
  ok_("ยังส่งหมายเหตุไปให้ระบบบัญชีด้วย", APP.includes("paymentNote:po.payment_note"));
  ok_("ขึ้นบรรทัดในหมายเหตุไม่ถูกยุบ", APP.includes('whiteSpace:"pre-line",wordBreak:"break-word"'));
}

section("กันแก้ VAT ระหว่างกะเปิด");
{
  const VAT_LINE = "const VAT_KEYS=[\"vat_enabled\",\"vat_rate\",\"vat_included\"];";
  ok_("รายชื่อช่อง VAT ที่เฝ้าอยู่ ตรงกับที่ตั้งใจ", APP.includes(VAT_LINE));
  const f = new Function(VAT_LINE + " " + grabConst(APP, "vatFieldsChanged") + " return {VAT_KEYS,vatFieldsChanged};")();
  ck("จับได้ว่าเปิด/ปิด VAT", f.vatFieldsChanged({ vat_enabled: false }, { vat_enabled: true }), ["vat_enabled"]);
  ck("จับได้ว่าเปลี่ยนอัตรา", f.vatFieldsChanged({ vat_rate: 7 }, { vat_rate: 10 }), ["vat_rate"]);
  ck("จับได้ว่าเปลี่ยนวิธีคิด", f.vatFieldsChanged({ vat_included: true }, { vat_included: false }), ["vat_included"]);
  ck("แก้ของอื่นไม่ถือว่าแตะ VAT", f.vatFieldsChanged({ vat_rate: 7, rounding: "none" }, { vat_rate: 7, rounding: "up" }), []);
  ck("ค่าเท่าเดิมคนละชนิดไม่ถือว่าเปลี่ยน", f.vatFieldsChanged({ vat_rate: 7 }, { vat_rate: "7" }), []);
  ck("ดูครบทั้งสามช่อง", f.VAT_KEYS.length, 3);

  ok_("ไม่มีกะเปิดอยู่ = แก้ได้ตามปกติ ไม่กวน", APP.includes("if(!open)return true;"));
  ok_("เช็คกะไม่ได้ต้องไม่ขวางงาน", APP.includes("catch{return true;}"));
  // สองจอที่แก้ VAT ได้ ต้องกันทั้งคู่ ไม่งั้นเดินอ้อมอีกจอได้
  ok_("จอจัดการใบเสร็จกันแล้ว", APP.includes("if(!await okToChangeVatNow(currentBranch.id,orig,s))return;"));
  ok_("จอตั้งค่า POS หลังบ้านกันแล้ว", APP.includes("if(!await okToChangeVatNow(currentBranch.id,orig,settings))return;"));
  ok_("บอกผลกระทบให้เห็นก่อนกด ไม่ใช่ห้ามเฉยๆ",
    APP.includes("อาจต้องนำส่งเองภายหลัง") && APP.includes("แนะนำให้ปิดกะก่อน แล้วค่อยเปลี่ยน"));
}

section("ปิดกะ → ลงบัญชี (pos_closing)");
let _acctOk = false;
try {
  const realFetch = globalThis.fetch;
  const mkFetch = (shift, orders, branchName) => {
    const sent = [];
    globalThis.fetch = async (url, opt) => {
      const u = String(url);
      if (u.includes("sliptrack-pro.vercel.app")) { sent.push(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => ({ success: true, income: { status: "posted" } }) }; }
      if (u.includes("pos_shifts")) return { ok: true, json: async () => (shift ? [shift] : []) };
      if (u.includes("/branches?")) return { ok: true, json: async () => [{ name: branchName }] };
      if (u.includes("/orders?")) return { ok: true, json: async () => orders };
      if (u.includes("cash_movements")) return { ok: true, json: async () => (globalThis.__MOVES || []) };
      return { ok: false, status: 404, text: async () => "unexpected " + u };
    };
    return sent;
  };
  const run = async (shift, orders, branchName) => {
    const sent = mkFetch(shift, orders, branchName);
    process.env.SLIPTRACK_API_KEY = "TEST";
    const mod = await import(new URL("../api/sliptrack-push.js", import.meta.url).href + "?t=" + Math.random());
    let out = null, code = null;
    const res = { setHeader() {}, status(c) { code = c; return this; }, json(j) { out = j; return this; } };
    await mod.default({ method: "POST", body: { kind: "pos_closing", shift_id: shift ? shift.id : 1 } }, res);
    globalThis.fetch = realFetch;
    return { code, out, sent };
  };
  const SHIFT = { id: 8, branch_id: 8, opened_at: "2026-09-08T06:00:00Z", closed_at: "2026-09-09T17:00:00Z" };
  const bill = (id, total, pm, day, extra) => ({
    id, total, subtotal: total, discount: 0, promo_amount: 0, service_charge: 0, vat: 0, round_adj: 0,
    payment_method: pm, created_at: `2026-09-0${day}T12:00:00Z`, updated_at: `2026-09-0${day}T12:00:00Z`, ...(extra || {}),
  });

  // ① วันเดียว เงินสด+พร้อมเพย์ — พร้อมเพย์เป็นชั้นย่อย ห้ามบวกซ้ำ
  {
    const { sent } = await run(SHIFT, [
      bill(1, 1000, "cash", 9), bill(2, 500, "cash", 9), bill(3, 300, "promptpay", 9),
    ], "กาญจนบุรี The River");
    ck("วันเดียว = ใบเดียว", sent.length, 1);
    const p = sent[0];
    ck("ยอดขายรวมถูก", p.total_sales, 1800);
    ck("Σ ชั้นหลัก (ไม่นับพร้อมเพย์ซ้ำ) = ยอดขาย",
      Math.round(p.payment.filter(x => x.name_th !== "พร้อมเพย์").reduce((t, x) => t + x.amount, 0) * 100) / 100, 1800);
    ck("พร้อมเพย์อยู่เป็นชั้นย่อยด้วย", p.payment.some(x => x.name_th === "พร้อมเพย์" && x.amount === 300), true);
    ck("external_id เป็นรายวันต่อสาขา (ไม่ใช่รายกะ)", p.external_id, "pos-2026-09-09-กาญจนบุรี The River");
    // POS ไม่ได้เก็บจำนวนแขก ห้ามส่งจำนวนบิลไปแทน (แดชบอร์ดบัญชีนับเป็นคน)
    ck("ไม่ส่งจำนวนแขก เพราะ POS ไม่ได้เก็บ", p.number_of_guests === undefined, true);
    ck("ส่งยอดขายเฉลี่ยต่อบิลแทน", p.average_trans, 600);
  }
  // ①.5 เงินในลิ้นชัก — ตู้เซฟฝั่งบัญชีดึงจากบล็อกนี้ ไม่ใช่จาก payment
  {
    globalThis.__MOVES = [
      { type: "opening", amount: 500 }, { type: "sale", amount: 1500 },
      { type: "pay_out", amount: 200 }, { type: "closing", amount: 1700 },
    ];
    const { sent } = await run(SHIFT, [bill(1, 1000, "cash", 9), bill(2, 500, "cash", 9)], "กาญจนบุรี The River");
    const d = sent[0].drawer;
    ck("ส่งเงินลิ้นชักไปให้ตู้เซฟ", !!d, true);
    // ชื่อคีย์ต้องตรงกับ STD_DRAWER ของฝั่งบัญชีเป๊ะ ผิดชื่อ = ตู้เซฟไม่ได้เงิน
    ck("ใช้ชื่อคีย์ตามสเปกฝั่งบัญชีครบ 8 ตัว", Object.keys(d).sort().join(","),
      "actual_in_drawer,cash_sales,difference,expected_in_drawer,paid_in_out,refund,start_drawer,total_bills");
    ck("ยอดที่ควรมี = เริ่มต้น + ขายสด + เข้า/ออก - คืนเงิน", d.expected_in_drawer, 1800);
    ck("ส่งยอดนับจริงไปด้วย (ไว้เทียบหาเงินขาด ไม่เข้าสูตรเซฟ)", d.actual_in_drawer, 1700);
    ck("บอกส่วนต่างให้เห็น", d.difference, -100);
    ck("เงินเข้า/ออกลิ้นชักรวมเป็นตัวเดียว (บวก = เข้า)", d.paid_in_out, -200);
    // ใส่เงินทอนตั้งต้นปลอม = ฝากเข้าตู้เซฟขาดไปเท่าตัวเลขที่ปลอมทุกวัน
    // (สูตรเซฟของเขา = expected_in_drawer − start_drawer)
    ck("เงินทอนตั้งต้นเป็นค่าจริงจากลิ้นชัก ไม่ใช่ค่าที่ตั้งเอง", d.start_drawer, 500);
    ck("ยอดขายเงินสดเป็นค่าจริง", d.cash_sales, 1500);
    globalThis.__MOVES = [];
  }
  // ①.6 กะคร่อมวัน — เงินลิ้นชักต้องแนบวันเดียว ไม่งั้นตู้เซฟได้เงินซ้ำ
  {
    globalThis.__MOVES = [{ type: "sale", amount: 1700 }, { type: "closing", amount: 1700 }];
    const { sent } = await run(SHIFT, [bill(1, 1000, "cash", 8), bill(2, 700, "cash", 9)], "กาญจนบุรี The River");
    ck("กะคร่อมวัน: เงินลิ้นชักแนบใบเดียว (ไม่งั้นตู้เซฟได้เงินซ้ำ)",
      sent.filter(x => x.drawer).length, 1);
    ck("และแนบกับวันสุดท้ายของกะ (วันที่นับเงินจริง)",
      sent.find(x => x.drawer).business_date, "2026-09-09");
    globalThis.__MOVES = [];
  }
  // ② กะคร่อมวัน — ต้องแตกเป็นคนละใบ ไม่งั้นชนคีย์ UNIQUE(business_date,branch) แล้วยอดหายทั้งวัน
  {
    const { sent } = await run(SHIFT, [
      bill(1, 1000, "cash", 8), bill(2, 700, "cash", 9), bill(3, 300, "promptpay", 9),
    ], "กาญจนบุรี The River");
    ck("กะคร่อมวันแตกเป็นสองใบ", sent.length, 2);
    ck("แยกยอดตามวันถูกต้อง", sent.map(x => [x.business_date, x.total_sales]),
      [["2026-09-08", 1000], ["2026-09-09", 1000]]);
  }
  // ③ ส่วนลด/โปรโมชั่น — สมการของฝั่งบัญชีต้องเป็นจริงเสมอ
  {
    const { sent } = await run(SHIFT, [
      bill(1, 900, "cash", 9, { subtotal: 1000, discount: 100 }),
      bill(2, 450, "cash", 9, { subtotal: 500, promo_amount: 50 }),
    ], "กาญจนบุรี The River");
    const p = sent[0];
    ck("ส่วนลดรวมโปรโมชั่นด้วย", p.discount, 150);
    ck("sub_total - discount = total_sales เสมอ", Math.round((p.sub_total - p.discount) * 100) / 100, p.total_sales);
    ck("ยอดขายสุทธิถูก", p.total_sales, 1350);
  }
  // ④ VAT ส่งเท่าที่เก็บได้จริง ไม่สมมติ 7% ของยอดทั้งวัน (บิลที่ไม่มี VAT ปนอยู่ได้)
  {
    const { sent } = await run(SHIFT, [
      bill(1, 1000, "cash", 9, { vat: 65.42 }), bill(2, 500, "cash", 9),
    ], "กาญจนบุรี The River");
    ck("exclude_vat = ผลรวม VAT ที่เก็บได้จริง", sent[0].exclude_vat, 65.42);
    // ขาด sales_before_vat = ฝั่งบัญชีออกใบขายเงินสด CA- ไม่ได้ ⟹ ไม่มีเอกสารรองรับใน ภ.พ.30
    ck("ส่งยอดก่อนภาษี (ยอดขาย − ภาษี)", sent[0].sales_before_vat, 1434.58);
    // ต้องบอกยอดที่ไม่มีภาษีด้วย ไม่งั้นเขาคิดว่าทั้งวันมีภาษีแล้วด่านภาษีจะไม่ผ่าน
    ck("ส่งยอดที่ไม่มีภาษีแยกออกมา", sent[0].non_vat_sales, 500);
    ck("ส่งอัตราภาษี", sent[0].vat_rate, 7);
    ck("ส่งยอดรับชำระรวม", sent[0].total_revenue_payment, 1500);
    ck("ไม่ได้เอา 7% ของยอดทั้งวันมาคิด", sent[0].exclude_vat !== Math.round(1500 * 7 / 107 * 100) / 100, true);
  }
  // ⑤ ภาษีไม่ตรงกับฐาน × อัตรา = ฝั่งบัญชีจะบล็อกอยู่แล้ว เราต้องไม่ส่งไปตั้งแต่แรก
  {
    const { sent, out } = await run(SHIFT, [
      bill(1, 1000, "cash", 9, { vat: 300, vat_rate: 7 }),   // 300 บาทจากฐาน 700 = ไม่ใช่ 7%
    ], "กาญจนบุรี The River");
    ck("ภาษีไม่ตรงกับฐาน x อัตรา = ไม่ยิง", sent.length, 0);
    ck("และบอกว่าติดที่ภาษี", !!(out && (out.results || []).some(r => r.blocked && (r.problems || []).join(" ").includes("ภาษี"))), true);
  }
  // ⑥ สาขาที่ยังไม่เปิดใช้ ต้องไม่ยิง — เจ้าของสั่งให้เฉพาะ The River ก่อน
  {
    const { out, sent } = await run({ ...SHIFT, branch_id: 3 }, [bill(1, 100, "cash", 9)], "อยุธยา");
    ck("สาขาที่ยังไม่เปิดใช้ = ไม่ยิงเลย", sent.length, 0);
    ck("และบอกว่าข้ามเพราะอะไร", !!(out && out.skipped), true);
  }
  // ⑥ ไม่มีบิลที่ปิดแล้ว = ไม่มียอดให้ลง ห้ามยิงใบเปล่า
  {
    const { out, sent } = await run(SHIFT, [], "กาญจนบุรี The River");
    ck("กะที่ไม่มีบิลปิด = ไม่ยิงใบเปล่า", sent.length, 0);
    ck("และบอกเหตุผล", !!(out && out.skipped), true);
  }
  _acctOk = true;
} catch (e) {
  ok_("ดึง handler ลงบัญชีมารันได้ (" + String(e && e.message).slice(0, 70) + ")", false);
}
ok_("ด่านชุดลงบัญชีรันจนจบ", _acctOk);
{
  // เซิร์ฟเวอร์ต้องคำนวณเอง ห้ามเชื่อตัวเลขจากเบราว์เซอร์ — นี่คือยอดที่จะลงสมุดบัญชี
  ok_("หน้าเว็บส่งแค่เลขกะ ไม่ได้ส่งตัวเลขเงินมาเอง",
    APP.includes('body:JSON.stringify({kind:"pos_closing",shift_id:shift.id})'));
  ok_("เซิร์ฟเวอร์อ่านบิลจริงจากฐานข้อมูลมาคำนวณ", SLIPPUSH.includes("status=eq.paid") && SLIPPUSH.includes("const sum = (list, k) =>"));
  // ด่านกันยอดเพี้ยน — ยอดที่ลงบัญชีผิดแก้ยากกว่าไม่ลงเลย
  ok_("ตัวเลขไม่ลงตัวถึงสตางค์ = ไม่ยิง",
    SLIPPUSH.includes("if (problems.length) {") && SLIPPUSH.includes("blocked: true"));
  ok_("ปิดกะล้มไม่ได้เพราะท่อบัญชี (กะปิดไปแล้ว ยิงใหม่ทีหลังได้)",
    APP.includes("}catch(e){acctRes={error:String((e&&e.message)||e)};}"));
  ok_("ผลลงบัญชีต้องขึ้นให้กดรับทราบ ไม่ใช่ toast ที่หายเอง",
    APP.includes("ยอดขายยังไม่เข้าระบบบัญชี") && APP.includes("onClick={()=>{setAcct(null);onClosed();}}"));
}

// ══════════════════════════════════════════════════════════════════════════
// ปิดกะ + ใบปิดยอด (Z-Report) + รายงานยอดขาย
// เจ้าของสั่ง 9 ก.ย. 69: กดปิดกะแล้วถ้ายังมีโต๊ะค้างต้องเด้งเตือน · ใบปิดยอดต้องออกถูกต้อง
// ตรวจของจริงกะ #8 สาขา 8 แล้วเจอว่าจอปิดกะไม่เคยแสดงเลย: ส่วนลด ฿9,583 (21.6% ของยอดก่อนลด)
// VAT ฿522.98 · บิลที่ยกเลิก 9 ใบ ฿6,160 · โต๊ะที่ยังค้าง — ทั้งหมดเป็นตัวเลขที่ใช้ตรวจทุจริต
// ══════════════════════════════════════════════════════════════════════════
section("ปิดกะ · ใบปิดยอด · รายงานยอดขาย");
{
  // ── โต๊ะค้างต้องเตือนก่อนปิดกะ ──
  // ปิดกะทั้งที่บิลยังเปิด = เงินก้อนนั้นไม่เข้ากะนี้ Z-Report ขาด และไปโผล่กะถัดไป ยอดเพี้ยนสองกะ
  ok_("กดปิดกะแล้วเช็คโต๊ะค้างสดๆ ก่อนเสมอ",
    APP.includes("const fresh=await api.getActiveOrders(currentBranch.id);if(Array.isArray(fresh)){stuck=fresh;setOpenBills(fresh);}")
    && APP.includes("if(stuck.length){setBlockList(stuck);return;}"));
  ok_("มีป็อปอัพเตือนโต๊ะค้าง ไม่ใช่ปล่อยผ่านเงียบ",
    APP.includes("ยังมีโต๊ะที่ยังไม่ปิดบิล {blockList.length} โต๊ะ") && APP.includes("กลับไปเคลียร์โต๊ะก่อน"));
  ok_("ยังปิดได้ถ้าจำเป็น แต่ต้องกดยืนยันอีกชั้น", APP.includes("ปิดกะทั้งที่ยังมีโต๊ะค้าง (บันทึกไว้ในรายงาน)"));
  // ปิดทั้งที่ค้างต้องมีร่องรอย ไม่งั้นตรวจย้อนหลังไม่ได้ว่าใครปิดทิ้งไว้
  ok_("ปิดทั้งที่มีโต๊ะค้างต้องบันทึกลงกะและขึ้นบนใบ",
    APP.includes("⚠️ ปิดกะทั้งที่ยังมีโต๊ะค้าง ${forced.length} โต๊ะ")
    && APP.includes("order_count:totals.orderCount,notes:noteFull||null"));
  ok_("เห็นตั้งแต่เปิดจอปิดกะ ไม่ต้องรอกดปุ่ม", APP.includes("🪑 ยังมีโต๊ะที่ยังไม่ปิดบิล {openBills.length} โต๊ะ"));

  // ── ตัวเลขที่ใบปิดยอดต้องมี ──
  ok_("จอปิดกะกางโครงสร้างยอดให้เห็น (ไม่ใช่มีแต่ยอดสุทธิ)",
    APP.includes("🧾 โครงสร้างยอดขาย") && APP.includes('{l:"ยอดก่อนส่วนลด",v:totals.gross}'));
  ok_("ส่วนลดโชว์เป็น % ของยอดก่อนลดด้วย และเตือนเมื่อสูงผิดปกติ",
    APP.includes("discPct:gross>0?round2(disc/gross*100):0") && APP.includes("warn:totals.discPct>=15"));
  ok_("บิลที่ยกเลิกและโต๊ะค้างขึ้นเป็นหัวข้อ 'ต้องตรวจ'",
    APP.includes("⚠️ รายการที่ต้องตรวจ") && APP.includes("cancelCount:cancelled.length,cancelAmt"));
  ok_("บิลยกเลิกที่ไม่มีบันทึกผู้ยกเลิกต้องบอกให้รู้", APP.includes("(ไม่มีบันทึกผู้ยกเลิก)"));
  ok_("ใบ Z-Report มีโครงสร้างยอดครบ",
    APP.includes("<h3>🧾 โครงสร้างยอด</h3>") && APP.includes("= ยอดขายสุทธิ"));
  ok_("ใบ Z-Report มีหัวข้อรายการที่ต้องตรวจ", APP.includes("<h3>⚠️ รายการที่ต้องตรวจ</h3>"));
  ok_("ใบ Z-Report มีช่องเซ็นผู้ปิดกะและผู้ตรวจ", APP.includes(">ผู้ปิดกะ</div>") && APP.includes(">ผู้ตรวจ</div>"));
  // ป้ายมีเครื่องหมายลบอยู่แล้ว ค่าต้องเป็นบวก ไม่งั้นได้ "฿-0" แบบที่เห็นบนจอจริง
  ok_("เลิกโชว์ ฿-0 ในกล่องเงินลิ้นชัก",
    APP.includes('{l:"- จ่ายออก",v:totals.payOut,neg:true}') && !APP.includes('{l:"- จ่ายออก",v:-totals.payOut}'));

  // ── รายงานยอดขาย: การ์ดที่เจ้าของขอ ──
  ok_("มีการ์ดยอดขายทั้งหมดขณะนี้ (ปิดแล้ว + ยังไม่ปิด)",
    APP.includes("const grandRev=rev+openRev;") && APP.includes("🧮 ยอดขายทั้งหมดขณะนี้"));
  ok_("มีการ์ดยอดค้างในโต๊ะที่ยังไม่ปิด เป็นจำนวนเงิน ไม่ใช่แค่จำนวนใบ",
    APP.includes("const openRev=unpaid.reduce(") && APP.includes("⏳ ยอดค้างในโต๊ะ (ยังไม่ปิด)"));
  ok_("การ์ดยอดขายที่ปิดแล้วยังอยู่", APP.includes("💰 ยอดขาย (ปิดบิลแล้ว)"));
  ok_("มีการ์ดยอดก่อนส่วนลด / ค่าบริการ / VAT / ปัดเศษ",
    APP.includes("🧾 ยอดก่อนส่วนลด") && APP.includes("💼 ค่าบริการ") && APP.includes("📊 VAT") && APP.includes("🪙 ปัดเศษรวม"));
  ok_("การ์ดส่วนลดบอก % ของยอดก่อนลด", APP.includes("% ของยอดก่อนลด"));
  ok_("การ์ดบิลยกเลิกบอกจำนวนใบและใบที่ไม่รู้ว่าใครยกเลิก",
    APP.includes("const cancelNoWho=cancelled.filter(o=>!o.cancelled_by).length;") && APP.includes("ใบไม่รู้ว่าใครยกเลิก"));
  ok_("มีเมนูขายดีและช่วงเวลาที่ขายดี",
    APP.includes("🔥 เมนูขายดี (จากบิลที่ปิดแล้ว)") && APP.includes("⏰ ช่วงเวลาที่ขายดี"));
  // สตริงซ้อนสตริงจะพิมพ์ ${...} ออกมาดิบๆ บนจอ
  ok_("ไม่มีสตริงซ้อนที่จะพิมพ์ ${...} ออกมาดิบๆ", !APP.includes('" · ${cancelNoWho} ใบไม่รู้ว่าใครยกเลิก"'));
}

// ══════════════════════════════════════════════════════════════════════════
// ผลตรวจโค้ดหลายมุม 9 ก.ย. 69 — 11 ข้อที่ยืนยันแล้วว่าเป็นบั๊คจริง (แก้แล้วทั้งหมด)
// ทั้งหมดเป็นเรื่องเงินและเอกสารที่ยื่นให้ลูกค้า จึงต้องมีด่านกันไม่ให้กลับมาอีก
// ══════════════════════════════════════════════════════════════════════════
section("ผลตรวจเส้นทางเงิน: 11 ข้อที่ต้องไม่กลับมา");
{
  // ── ใบเสร็จต้องบวกลงตัวทุกทาง ──
  // ทางพิมพ์มีสองเส้น: ตัวพิมพ์ (raster) กับหน้าต่างพิมพ์ (HTML) — เดิมใส่บรรทัดปัดเศษแค่เส้นเดียว
  ok_("ใบเสร็จตอนปิดบิลพกส่วนต่างการปัดไปด้วย", APP.includes("total,round_adj:roundAdj,payment_method:pmCol,payments:paymentsCol,cash_received:cashReceived"));
  ok_("ใบทางหน้าต่างพิมพ์มีบรรทัดปัดเศษด้วย",
    APP.includes("const roundLine=order.round_adj?") && APP.includes("${promoLine}${scLine}${vatLine}${roundLine}<div style="));
  // ปุ่มพิมพ์ใบเสร็จย้อนหลังในรายงานก็เดินทางนี้ และส่งแถวจาก DB ที่มี round_adj อยู่แล้ว
  ok_("พิมพ์ใบเสร็จย้อนหลังก็ได้บรรทัดปัดเศษ (ใช้ตัวเดียวกัน)", APP.includes("printReceipt(o,o.table_number,branch?.name"));
  // ใบแบ่งจ่ายรวมกันต้องได้เท่ายอดที่เก็บจริง ไม่ใช่ยอดก่อนปัด
  ok_("ใบแบ่งจ่ายเฉลี่ยส่วนต่างการปัดตามสัดส่วน",
    APP.includes("const splitAdj=round2((+roundAdj||0)*ratio);") && APP.includes("total:splitTotal,round_adj:splitAdj,"));

  // ── ส่วนลดรายเมนูต้องเกาะเมนูของมัน ไม่ใช่เกาะเลขลำดับแถว ──
  // ยกเลิกแถวกลางบิล แถวหลังเลื่อนขึ้นมารับส่วนลดของแถวที่ถูกลบ = ของแถมกลายเป็นของขาย
  ok_("ส่วนลดรายเมนูผูกกับ line_uid ไม่ใช่เลขลำดับ",
    APP.includes("const discKey=(it,idx)=>String((it&&it.line_uid)||(\"#\"+idx));")
    && APP.split("itemDisc[discKey(").length - 1 >= 3
    && !APP.includes("const d=itemDisc[idx];"));
  ok_("ช่องกรอกส่วนลดรายเมนูก็เขียนด้วย line_uid", APP.includes("setItemDisc(p=>({...p,[discKey(it,idx)]:"));
  // ล็อกยอดแล้วแต่ช่องส่วนลดรายเมนูยังพิมพ์ได้ = ล็อกไม่จริง
  ok_("ล็อกยอดแล้วช่องส่วนลดรายเมนูต้องกดไม่ได้",
    // ปุ่ม % ฿ (เดิมเป็น select) ปิดปุ่ม และกันซ้ำในตัวจัดการ แบบเดียวกับช่องจำนวน
    APP.includes("type=\"button\" disabled={payWait} aria-label={t.v===\"percent\"?\"ลดเป็นเปอร์เซ็นต์\":\"ลดเป็นบาท\"} onClick={()=>{if(payWait)return;setItemDisc(")
    && APP.includes("<NumInput disabled={payWait} value={d?.v||\"\"}"));

  // ── กันจอที่ถือภาพเก่าไปทับของที่เครื่องอื่นเพิ่งเพิ่ม ──
  // ยกเลิกรอชำระเดิมไม่มีตัวกันชน แต่เอา updated_at ใหม่ไปใส่ verRef = ผ่านด่านของการเขียนครั้งถัดไป
  ok_("ยกเลิกรอชำระมีตัวกันชนเหมือนตอนล็อก",
    APP.includes("clearPayWaiting: async (id, seen) => {")
    && APP.includes("const r = await sb(`orders?id=eq.${id}&updated_at=${guard}&status=eq.awaiting_payment`,"));
  ok_("ยกเลิกไม่ผ่านกันชนต้องบอกให้เปิดโต๊ะใหม่ ไม่ใช่เดินต่อ",
    APP.includes("const row=await api.clearPayWaiting(existingOrder.id,verRef.current);")
    && APP.includes("if(!row){notifyDlg(\"⚠️ ยกเลิกไม่สำเร็จ"));

  // ── มือถือลูกค้าต้องเห็นเลขเดียวกับที่ต้องจ่าย ──
  ok_("ล็อกยอดแล้วมือถือลูกค้าโชว์ยอดบน QR ใบนั้น",
    APP.includes('if(myOrder&&myOrder.status==="awaiting_payment"&&lock&&lock.total!=null)due=+lock.total;'));
  ok_("สรุปยอดบนมือถือมีบรรทัดปัดเศษ/บอกว่าล็อกแล้ว",
    APP.includes("custBill.locked") && APP.includes("custBill.roundAdj!==0&&<div"));
}

// ══════════════════════════════════════════════════════════════════════════
// ปัดเศษท้ายบิล — เจ้าของสั่ง 9 ก.ย. 69: เลือกได้ว่าปัดขึ้นหรือปัดลง
// ให้ยอดที่ลูกค้าจ่ายเป็นจำนวนเต็ม ไม่มีทศนิยม
// เงินคือเรื่องที่ผิดไม่ได้ — ต้องดึงตัวปัดจริงมาปัดจริงแล้วดูผล ไม่ใช่ค้นข้อความ
// ══════════════════════════════════════════════════════════════════════════
section("ปัดเศษท้ายบิล");
{
  const L2 = APP.split("\n");
  const f = new Function(grabConst(APP, "roundModeOf") + "\n" + grabConst(APP, "roundBill") + "\nreturn {roundModeOf,roundBill};")();
  const R = (v, m) => f.roundBill(v, m);

  ck("ไม่ตั้งค่า = ไม่ปัด เหมือนเดิมทุกบาททุกสตางค์", [R(319.20,"none"), R(319.80,"none"), R(0,"none")], [319.2, 319.8, 0]);
  ck("ปัดขึ้นเป็นจำนวนเต็ม", [R(319.01,"up"), R(319.20,"up"), R(319.99,"up")], [320, 320, 320]);
  ck("ปัดลงเป็นจำนวนเต็ม", [R(319.01,"down"), R(319.80,"down"), R(319.99,"down")], [319, 319, 319]);
  // ยอดที่ลงตัวอยู่แล้วห้ามขยับ — ปัดขึ้นจาก 319.00 เป็น 320 คือเก็บเงินเกินทุกบิล
  ck("ยอดที่เป็นจำนวนเต็มอยู่แล้วห้ามขยับ", [R(319,"up"), R(319,"down"), R(0,"up"), R(0,"down")], [319, 319, 0, 0]);
  // ทศนิยมลอย: 0.1+0.2 = 0.30000000000000004 · 319.00 ที่เก็บมาอาจเป็น 318.99999999
  ck("ทศนิยมลอยต้องไม่ทำให้ปัดผิดไปทั้งบาท",
    [R(0.1+0.2+318.7,"up"), R(319.00000000001,"up"), R(318.99999999999,"down")], [319, 319, 319]);
  ck("ค่าที่ตั้งผิด/ว่าง ถือว่าไม่ปัด",
    [f.roundModeOf(null), f.roundModeOf({}), f.roundModeOf({rounding:"nearest"}), f.roundModeOf({rounding:"up"}), f.roundModeOf({rounding:"down"})],
    ["none","none","none","up","down"]);
  ck("ปัดแล้วต้องเป็นจำนวนเต็มเสมอ ไม่มีทศนิยมหลงเหลือ",
    [319.2,1597.55,0.01,99999.99].every(v => Number.isInteger(R(v,"up")) && Number.isInteger(R(v,"down"))), true);

  // ── ต่อเข้ากับของจริงครบทุกทาง ──
  // สูตรยอดบิลย้ายไปอยู่ที่ billTotalsOf ตัวเดียว (จอโต๊ะ + จอแก้บิลที่ปิดแล้วใช้ร่วมกัน)
  // ด่านที่รันสูตรจริงอยู่ในหมวด "แก้ไขบิลที่ปิดแล้ว" — ตรงนี้เหลือแค่ดูว่ายังต่อสายถูก
  ok_("จอสั่งอาหารปัดยอดสุดท้ายตามที่ตั้ง",
    APP.includes("const total=roundBill(rawTotal,roundModeOf(posSettings));") && APP.includes("const rawTotal=_T.rawTotal,total=_T.total;"));
  // ปัดแล้วไม่บอก = ตัวเลขบนใบบวกไม่ลง และยอดขายในระบบไม่ตรงกับเงินที่รับมา
  ok_("ส่วนต่างจากการปัดถูกคำนวณไว้", APP.includes("roundAdj:round2(total-rawTotal)") && APP.includes("const roundAdj=_T.roundAdj;"));
  ok_("ใบเสร็จพิมพ์บรรทัดปัดเศษ", APP.includes('if(order.round_adj)L.push({l:"ปัดเศษ"'));
  ok_("บิลที่ปิดเก็บส่วนต่างการปัดลงฐานข้อมูล", APP.includes("total,round_adj:roundAdj,payment_method:pm"));
  ok_("ใบแจ้งยอด/QR ก็พกส่วนต่างไปด้วย", APP.includes("promo_name:selectedPromo?.name||null,round_adj:roundAdj,"));
  // ยอดบนมือถือลูกค้ากับยอดที่พนักงานเก็บ ต้องเป็นเลขเดียวกัน
  ok_("หน้าลูกค้าสแกนเห็นยอดที่ปัดแล้วเหมือนกัน", APP.includes("let due=roundBill(rawDue,roundModeOf(posCfg));"));
  ok_("มีช่องให้เลือกปัดขึ้น/ปัดลง/ไม่ปัด ในจอจัดการใบเสร็จ",
    APP.includes('🪙 ปัดเศษท้ายบิล') && APP.includes('{v:"up",l:"ปัดขึ้น"') && APP.includes('{v:"down",l:"ปัดลง"') && APP.includes('{v:"none",l:"ไม่ปัด"'));
}

// ══════════════════════════════════════════════════════════════════════════
// พิมพ์ QR จ่ายเงินแล้ว = โต๊ะเข้าสถานะ "รอชำระเงิน"
// เจ้าของสั่ง 9 ก.ย. 69: โต๊ะต้องเปลี่ยนสีให้พนักงานรู้ว่าต้องมากดยืนยัน · ส่วนลดต้องล็อก
// (กลับมาแล้วกดยืนยันได้ทันที ยอดตรงกับ QR ที่ลูกค้าถืออยู่) · ลูกค้าสั่งเพิ่มไม่ได้
// แต่พนักงานยังเพิ่ม/ลบเมนูได้อยู่ เผื่อลูกค้ามาเช็คเมนูก่อนจ่าย
// ══════════════════════════════════════════════════════════════════════════
section("รอชำระเงิน: ล็อกยอด · โต๊ะเปลี่ยนสี · ลูกค้าสั่งเพิ่มไม่ได้");
let _payOk = false;
try {
  // ดึง posAppendItems ตัวจริงมารัน — กติกา "ใครถูกบล็อก" ต้องพิสูจน์ด้วยการเรียก ไม่ใช่ค้นข้อความ
  const head = "  posAppendItems: async ({";
  const st = APP.indexOf(head);
  if (st < 0) throw new Error("ไม่เจอ posAppendItems");
  let d = 0, en = -1;
  for (let j = APP.indexOf("{", APP.indexOf("=> {", st)); j < APP.length; j++) {
    if (APP[j] === "{") d++;
    else if (APP[j] === "}") { d--; if (!d) { en = j + 1; break; } }
  }
  const expr = APP.slice(st + "  posAppendItems: ".length, en);

  const mk = (order, menuRows) => {
    const calls = [];
    const sb = async (path, opt) => {
      calls.push({ path, method: (opt && opt.method) || "GET", body: opt && opt.body });
      if (/^tables\?/.test(path)) return [{ table_number: "C7" }];
      if (/^menus\?/.test(path)) { if (menuRows === "fail") throw new Error("network"); return menuRows || []; }
      if (!opt) return order ? [order] : [];                       // SELECT บิลที่เปิดอยู่
      if (opt.method === "PATCH") return [{ ...order, ...JSON.parse(opt.body) }];
      if (opt.method === "POST") return [{ id: 99, ...JSON.parse(opt.body) }];
      return [];
    };
    // ดึงตัวถอดธงหน้าจอ (_new) ตัวจริงมาด้วย — posAppendItems เรียกใช้มัน
    // ถ้าเอาแค่ค่าปลอมมาใส่ ด่านจะไม่ได้ทดสอบว่าธงถูกถอดจริงหรือเปล่า
    const stripLine = APP.split("\n").find((l) => l.startsWith("const stripNewFlags="));
    if (!stripLine) throw new Error("ไม่เจอ stripNewFlags");
    // กติกาสามปุ่มตัวจริง (ขาย/วันนี้หมด/ซ่อน) — posAppendItems ใช้มันตัดสินว่าจะรับรายการไหม
    const availLines = APP.split("\n").filter((l) => /^const (BIZ_DAY_CUT_H|bizDayBkk|soldOutMark|menuAvailAt|menuSoldOutAt|menuHiddenAt)=/.test(l));
    if (availLines.length !== 6) throw new Error("ไม่เจอกติกาสามปุ่มครบ");
    const fn = new Function("sb", stripLine + "\n" + availLines.join("\n") + "\nconst posAppendItems = " + expr + "; return posAppendItems;")(sb);
    return { fn, calls };
  };
  const LINE = [{ line_uid: "new1", menu_id: 5, name: "หมูสไลด์", price: 100, qty: 1, category: "หมูกระทะ" }];
  // ── ธง _new ห้ามหลุดลงฐานข้อมูลเด็ดขาด ────────────────────────────────
  // ของจริง 10 ก.ย. 69: ตอน "สร้างบิลใบแรก" จอส่ง items ดิบมาทั้งก้อนโดยไม่ถอดธง
  // แถวนั้นเลยถูกบันทึกพร้อม _new:true แล้วขึ้นสีส้ม "ยังไม่ส่ง" ค้างตลอดทุกครั้งที่เปิดโต๊ะ
  // พนักงานเห็นส้มก็กดส่งซ้ำ → ครัวได้ใบซ้ำ ลูกค้าได้อาหารซ้ำ (ตรวจฐานเจอค้างจริง 1 รายการ)
  // ด่านนี้เรียกฟังก์ชันตัวจริงแล้วอ่าน body ที่มันจะเขียนลงฐาน ไม่ใช่ค้นข้อความ
  {
    const strip = (() => {
      const ln = APP.split("\n").find((l) => l.startsWith("const stripNewFlags="));
      return ln ? new Function(ln + " return stripNewFlags;")() : null;
    })();
    ok_("ยังมีตัวถอดธงหน้าจอออกจากรายการอาหาร", !!strip);
    if (strip) {
      ck("ถอดธงแล้วต้องไม่เหลือ _new และข้อมูลอื่นต้องอยู่ครบ",
        strip([{ name: "หมู", qty: 2, _new: true }, { name: "น้ำแข็ง", qty: 1 }]),
        [{ name: "หมู", qty: 2 }, { name: "น้ำแข็ง", qty: 1 }]);
      ck("ค่าที่ไม่ใช่รายการ ต้องได้รายการว่าง ไม่ใช่พัง", [strip(null), strip(undefined), strip("x")], [[], [], []]);
    }
    const DIRTY = [{ line_uid: "u1", menu_id: 1, name: "หมูหมัก", price: 79, qty: 1, _new: true }];
    const hasNew = (body) => { try { return JSON.stringify(JSON.parse(body || "{}").items || []).includes('"_new"'); } catch { return false; } };
    // เส้นทางที่ทำให้เกิดบั๊ก: ยังไม่มีบิล → สร้างใบใหม่ (POST)
    {
      const { fn, calls } = mk(null);
      await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: DIRTY, ordered_by: "ผึ้ง" });
      const post = calls.find((x) => x.method === "POST");
      ok_("สร้างบิลใบแรกแล้วมีการเขียนลงฐานจริง", !!post);
      ck("บิลใบแรกต้องไม่มีธง _new ติดลงฐาน", post ? hasNew(post.body) : "ไม่ได้เขียน", false);
    }
    // เส้นทางต่อท้ายบิลเดิม (PATCH) ต้องสะอาดเหมือนกัน
    {
      const { fn, calls } = mk({ id: 7, items: [], status: "pending", updated_at: "t0" });
      await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: DIRTY, ordered_by: "ผึ้ง" });
      const patch = calls.find((x) => x.method === "PATCH");
      ok_("ต่อท้ายบิลเดิมแล้วมีการเขียนลงฐานจริง", !!patch);
      ck("ต่อท้ายบิลเดิมต้องไม่มีธง _new ติดลงฐาน", patch ? hasNew(patch.body) : "ไม่ได้เขียน", false);
    }
  }
  // ขาเข้า: อ่านบิลจากฐานมาแสดงต้องถอดธงทิ้งเสมอ — ตัวนี้ซ่อมบิลที่รั่วไปแล้วให้หายส้มทันที
  ok_("เปิดจอโต๊ะแล้วถอดธงที่ค้างในฐานทิ้ง",
    APP.includes("const[items,setItems]=useState(()=>stripNewFlags(existingOrder&&existingOrder.items));"));
  ok_("ปากทางแก้บิลก็กันธงหลุดด้วย",
    APP.includes("const body = (d && Array.isArray(d.items)) ? {...d, items:stripNewFlags(d.items)} : d;"));

  // ── flow สามปุ่มของเจ้าของ (11 ก.ย. 69): ขาย / วันนี้หมด / ซ่อน ───────────
  // วันนี้หมด = ห้ามทั้งพนักงานและลูกค้า · ซ่อน = ห้ามเฉพาะลูกค้า พนักงานยังสั่งให้ได้
  // ตรวจที่ปากทางเขียนบิล เพราะหน้าจอที่เปิดค้าง/ของค้างในตะกร้า เห็นสถานะช้ากว่าความจริง
  {
    const LINE1 = [{ line_uid: "a1", menu_id: 5, name: "หมูหมัก", price: 79, qty: 1 }];
    const tryOrder = async (who, avail, menuRowsOverride) => {
      const rows = menuRowsOverride !== undefined ? menuRowsOverride : [{ id: 5, name: "หมูหมัก", availability: avail }];
      const { fn, calls } = mk({ id: 7, items: [], status: "pending", updated_at: "t0" }, rows);
      try {
        await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: LINE1, ordered_by: who, ...(who === "customer" ? { blockIfAwaiting: true } : {}) });
        return calls.some((x) => x.method === "PATCH" || x.method === "POST") ? "รับ" : "ไม่ได้เขียน";
      } catch (e) {
        const wrote = calls.some((x) => x.method === "PATCH" || x.method === "POST");
        return wrote ? "เขียนไปแล้วทั้งที่ปฏิเสธ" : (e && e.unavailable ? "ปฏิเสธ" : "error อื่น:" + (e && e.message));
      }
    };
    ck("ขาย: ลูกค้าและพนักงานสั่งได้", [await tryOrder("customer", {}), await tryOrder("ผึ้ง", {})], ["รับ", "รับ"]);
    ck("วันนี้หมด: ลูกค้าและพนักงานสั่งไม่ได้", [await tryOrder("customer", { 8: "sold_out" }), await tryOrder("ผึ้ง", { 8: "sold_out" })], ["ปฏิเสธ", "ปฏิเสธ"]);
    ck("ซ่อน: ลูกค้าสั่งไม่ได้ แต่พนักงานสั่งให้ได้", [await tryOrder("customer", { 8: "hidden" }), await tryOrder("ผึ้ง", { 8: "hidden" })], ["ปฏิเสธ", "รับ"]);
    ck("หมดที่สาขาอื่น ไม่กระทบสาขานี้", await tryOrder("customer", { 3: "sold_out" }), "รับ");
    // วันนี้หมด = แค่วันเดียว: ของที่กดหมดไว้วันก่อน ต้องสั่งได้แล้วโดยไม่ต้องมีใครกดขายคืน
    ck("หมดไว้เมื่อวันก่อน สั่งได้แล้วทั้งลูกค้าและพนักงาน", [await tryOrder("customer", { 8: "sold_out@2000-01-01" }), await tryOrder("ผึ้ง", { 8: "sold_out@2000-01-01" })], ["รับ", "รับ"]);
    // อ่านสถานะเมนูไม่ได้ (เน็ตสะดุด) ต้องไม่หยุดการขาย
    ck("อ่านสถานะเมนูไม่ได้ ต้องไม่หยุดการขาย", await tryOrder("customer", {}, "fail"), "รับ");
    // ข้อความต้องบอกชื่อเมนูที่หมด — ลูกค้า/พนักงานต้องรู้ว่าต้องเอาอะไรออก
    {
      const { fn } = mk({ id: 7, items: [], status: "pending", updated_at: "t0" }, [{ id: 5, name: "หมูหมัก", availability: { 8: "sold_out" } }]);
      let err = null;
      try { await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: LINE1, ordered_by: "customer", blockIfAwaiting: true }); } catch (e) { err = e; }
      ok_("ปฏิเสธแล้วบอกชื่อเมนูและรหัสเมนูที่หมด", !!err && err.unavailable && (err.unavailableNames || []).includes("หมูหมัก") && (err.unavailableIds || []).includes(5));
    }
  }
  // ── "วันนี้หมด" = แค่วันนี้ วันต่อไปขายเอง (ตัดวันตีห้าเวลาไทย) ──────────
  {
    const L = APP.split("\n");
    const pick = (re) => L.find((l) => re.test(l));
    const src = [pick(/^const BIZ_DAY_CUT_H=/), pick(/^const bizDayBkk=/), pick(/^const soldOutMark=/), pick(/^const menuAvailAt=/)];
    ok_("ยังมีตัวคิดวันทำการและกติกาหมดวันเดียว", src.every(Boolean));
    if (src.every(Boolean)) {
      const k = new Function(src.join("\n") + "\nreturn {bizDayBkk,soldOutMark,menuAvailAt};")();
      const BK = (s) => Date.parse(s + "+07:00");   // เวลาไทยที่อ่านง่าย → timestamp
      ck("ห้าทุ่มกับตีสี่ห้าสิบเก้า ยังเป็นวันทำการเดียวกัน",
        [k.bizDayBkk(BK("2026-09-10T23:00:00")), k.bizDayBkk(BK("2026-09-11T04:59:00"))], ["2026-09-10", "2026-09-10"]);
      ck("ตีห้าตรง = ขึ้นวันทำการใหม่", k.bizDayBkk(BK("2026-09-11T05:00:00")), "2026-09-11");
      ck("ข้ามเดือนก็ตัดตีห้าเหมือนกัน",
        [k.bizDayBkk(BK("2026-10-01T04:00:00")), k.bizDayBkk(BK("2026-10-01T05:00:00"))], ["2026-09-30", "2026-10-01"]);
      const today = k.bizDayBkk(), m = (v) => ({ availability: { 8: v } });
      ck("กดวันนี้หมดวันนี้ = หมด", k.menuAvailAt(m("sold_out@" + today), 8), "sold_out");
      ck("กดไว้เมื่อวาน/วันก่อน = กลับมาขายเองแล้ว", [k.menuAvailAt(m("sold_out@2000-01-01"), 8), k.menuAvailAt(m("sold_out@2026-09-10"), 8) === "" || today === "2026-09-10"], ["", true]);
      ck("ค่าเก่าไม่มีวันที่ ถือว่ายังหมด (ไม่เดาว่าขายได้)", k.menuAvailAt(m("sold_out"), 8), "sold_out");
      ck("ซ่อนไม่เกี่ยวกับวัน ยังซ่อนเหมือนเดิม", k.menuAvailAt(m("hidden"), 8), "hidden");
      ok_("ตัวตีตราหมดเขียนวันทำการปัจจุบัน", k.soldOutMark() === "sold_out@" + today);
    }
    ok_("หลังบ้านกดวันนี้หมด = เขียนพร้อมวันที่", APP.includes('else avail[currentBranch.id]=status==="sold_out"?soldOutMark():status;'));
    ok_("ปุ่มหลังบ้านติดไฟตามสถานะจริง (หมดอายุแล้วขึ้นขาย)", APP.includes("cur={menuAvailAt(m,currentBranch.id)}"));
    ok_("ไม่มีจอไหนเทียบคำว่า sold_out ตรงๆ อีก (ต้องผ่านกติกาเดียว)",
      !/\[(bidSale|branchId|currentBranch\.id)\]==="sold_out"/.test(APP) && !/\|\|\{\}\)\[[a-zA-Z.]+\]==="sold_out"/.test(APP));
  }
  // หน้าจอ: จอพนักงานต้องไม่กรองเมนูที่ซ่อนทิ้ง · ของหมดขึ้นกลางรูปทั้งสองฝั่ง
  ok_("จอพนักงานไม่กรองเมนูที่ซ่อนทิ้งแล้ว", !APP.includes('if((m.availability||{})[bidSale]==="hidden")return false;'));
  ok_("การ์ดพนักงานบอกว่าเมนูนี้ซ่อนจากลูกค้า", APP.includes("{hiddenFromCustomer&&<span style={MC_HID}>ซ่อนจากลูกค้า</span>}") && APP.includes("hiddenFromCustomer={menuHiddenAt(m,bidSale)}"));
  ok_("การ์ดพนักงาน: ของหมดขึ้นกลางรูป", APP.includes("{soldOut&&<span style={MC_SOLDOUT}>ของหมด</span>}") && APP.includes('transform:"translate(-50%,-50%)"'));
  ok_("หน้าลูกค้า: ของหมดขึ้นกลางรูป", APP.includes('fontSize:17,fontWeight:900,borderRadius:999,padding:"6px 18px",fontFamily:"\'Sarabun\',sans-serif",letterSpacing:.3}}>ของหมด</span>'));
  ok_("หน้าลูกค้ายังซ่อนเมนูที่ตั้งซ่อน", APP.includes('setMenus(ms.filter(m=>m.price>0&&menuVisibleAt(m,branchId)&&(m.availability||{})[branchId]!=="hidden"));'));
  // ถูกปฏิเสธเพราะของหมด = ปฏิเสธถาวร ห้ามเข้าคิวออฟไลน์วนส่งซ้ำไม่จบ
  ok_("หน้าลูกค้า: ของหมดไม่วนส่งซ้ำ ทั้งทางส่งปกติและทางคิวออฟไลน์",
    APP.includes("if(e&&e.unavailable){handleUnavailable(e,sending);setSending(false);loadMyOrder();return;}") &&
    APP.includes("else if(e&&e.unavailable){handleUnavailable(e,o&&o.lines);loadMyOrder();}") &&
    APP.includes("writeOutbox(null);setOutbox(null);\n    const back=(Array.isArray(lines)?lines:[]).filter(l=>!gone.has(+(l&&l.menu_id)));"));

  const OPEN = { id: 7, items: [], status: "pending", updated_at: "t0" };
  const WAIT = { id: 7, items: [], status: "awaiting_payment", updated_at: "t0" };

  // ลูกค้าสแกน: บิลรอชำระอยู่ → ต้องถูกปฏิเสธ และห้ามเขียนอะไรลงบิลเลย
  {
    const { fn, calls } = mk(WAIT);
    let err = null;
    try { await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: LINE, ordered_by: "customer", blockIfAwaiting: true }); }
    catch (e) { err = e; }
    ok_("ลูกค้าสั่งเพิ่มตอนรอชำระ = ถูกปฏิเสธ", !!err && err.awaitingPayment === true);
    ck("ถูกปฏิเสธแล้วต้องไม่เขียนอะไรลงบิลเลย", calls.filter(c => c.method !== "GET").length, 0);
  }
  // พนักงาน: บิลเดียวกัน ต้องเพิ่มได้ปกติ (เจ้าของสั่งไว้ — เผื่อลูกค้ามาเช็คเมนูก่อนจ่าย)
  {
    const { fn, calls } = mk(WAIT);
    const row = await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: LINE, ordered_by: "ผึ้ง" });
    ok_("พนักงานยังเพิ่มเมนูได้ตอนรอชำระ", !!row && Array.isArray(row.items) && row.items.length === 1);
    ck("และเขียนลงบิลจริง", calls.some(c => c.method === "PATCH"), true);
  }
  // บิลปกติ: ลูกค้าสั่งได้เหมือนเดิม ธงไม่ได้ไปบล็อกมั่ว
  {
    const { fn } = mk(OPEN);
    const row = await fn({ branch_id: 8, table_id: 3, table_number: "C7", newItems: LINE, ordered_by: "customer", blockIfAwaiting: true });
    ok_("บิลปกติลูกค้ายังสั่งได้เหมือนเดิม", !!row && Array.isArray(row.items) && row.items.length === 1);
  }
  _payOk = true;
} catch (e) {
  ok_("ดึง posAppendItems มารันได้ (" + String(e && e.message).slice(0, 60) + ")", false);
}
ok_("ด่านชุดรอชำระเงินรันจนจบ", _payOk);
{
  // ทั้งสองทางที่หน้าลูกค้าส่งออเดอร์ต้องผ่านด่านเดียวกัน — คิวออฟไลน์ก็ด้วย
  ok_("หน้าลูกค้าส่งธงกันสั่งเพิ่มทั้งสองทาง (กดสั่ง + คิวออฟไลน์)",
    APP.split('ordered_by:"customer",blockIfAwaiting:true').length - 1 === 2);
  ok_("จอพนักงานไม่ส่งธงนั้น (ต้องเพิ่ม/ลบได้อยู่)",
    APP.includes("ordered_by:currentUser.username})") && !APP.includes("ordered_by:currentUser.username,blockIfAwaiting"));
  // ถูกปฏิเสธเพราะรอชำระ ≠ เน็ตสะดุด ห้ามวนส่งใหม่ และห้ามทำของในตะกร้าหาย
  ok_("โดนปฏิเสธแล้วเลิกวนส่ง และคืนของกลับตะกร้า",
    APP.includes("if(e&&e.awaitingPayment){") && APP.includes("setCart(p=>[...sending,...p]);")
    && APP.includes("if(back.length)setCart(p=>[...back,...p]);"));
  // คิวออฟไลน์คือรายการที่เซิร์ฟเวอร์ยังไม่เคยได้รับ — ทิ้งไปคือออเดอร์ลูกค้าหายเงียบ
  ok_("คิวออฟไลน์โดนปฏิเสธก็ต้องคืนของ ไม่ใช่ลบทิ้ง",
    APP.includes("const back=(o&&Array.isArray(o.lines))?o.lines:[];"));

  // ── โต๊ะเปลี่ยนสี ──
  // ── กฎสีโต๊ะ: 4 สถานะ ต้องแยกออกจากกันด้วยตาเปล่า ทุกโซนเหมือนกันหมด ──
  // ด่านเดิมล็อกค่าสีม่วงไว้เป็นตัวหนังสือ ซึ่งตรวจ "ค่าที่เขียนไว้" ไม่ได้ตรวจ "สิ่งที่ต้องการ"
  // พอเปลี่ยนจานสีตามที่เจ้าของสั่ง ด่านก็ตกทั้งที่พฤติกรรมถูกขึ้น — ตรวจเจตนาแทน
  const TSmap = (() => {
    const st = APP.indexOf("const TS={");
    if (st < 0) return null;
    const en = APP.indexOf("};", st) + 2;
    return new Function("C", APP.slice(st, en) + " return TS;")(
      new Proxy({}, { get: (_, k) => "C." + String(k) })   // สีจากจานกลางคืนเป็นชื่อ ไม่ต้องโหลดจริง
    );
  })();
  ok_("อ่านจานสีสถานะโต๊ะได้", !!TSmap);
  if (TSmap) {
    const need = ["available", "qrsent", "occupied", "waitpay"];
    ck("มีครบ 4 สถานะตามกฎสีที่ตกลงไว้", need.filter((k) => !TSmap[k]), []);
    // ตัวชี้ขาด: ถ้าสองสถานะสีเดียวกัน พนักงานแยกไม่ออก = กฎสีไม่มีความหมาย
    const borders = need.map((k) => TSmap[k] && TSmap[k].border);
    ck("สีกรอบของ 4 สถานะต้องไม่ซ้ำกันเลย", borders.length - new Set(borders).size, 0);
    const bgs = need.map((k) => TSmap[k] && TSmap[k].bg);
    ck("สีพื้นของ 4 สถานะต้องไม่ซ้ำกันเลย", bgs.length - new Set(bgs).size, 0);
    ok_("โต๊ะว่างเป็นพื้นขาว", String(TSmap.available.bg).toUpperCase() === "C.WHITE" || /^#FFF(FFF)?$/i.test(String(TSmap.available.bg)));
  }
  ok_("พิมพ์ QR จ่ายเงินแล้ว = สถานะรอชำระของตัวเอง",
    APP.includes('if(o.status==="awaiting_payment")return "waitpay";'));
  ok_("พิมพ์ QR สั่งอาหารแล้ว แต่ยังไม่มีบิล = สถานะของตัวเอง ไม่ปนกับโต๊ะว่าง",
    APP.includes('if(!o)return t.qr_printed_at?"qrsent":"available";'));
  // สีโซนเคยทับสีสถานะ ⟹ ทั้งโซนกรอบสีเดียวกันหมด มองไม่ออกว่าโต๊ะไหนมีลูกค้า
  ok_("กรอบโต๊ะเป็นของสถานะ ไม่ใช่ของโซน",
    APP.includes("const borderColor=sv.border;") && !APP.includes("const borderColor=zoneColor||sv.border;"));
  // ธงต้องถูกล้างตอนบิลจบ ไม่งั้นปิดบิลแล้วโต๊ะเด้งกลับเป็นเขียวแทนที่จะเป็นขาว
  // ปิดบิล/ยกเลิกบิล = ปล่อยโต๊ะ (เปลี่ยนรหัส QR + ล้างธงพิมพ์ QR) และต้องรอให้เสร็จก่อนปิดจอ
  ok_("ปิดบิล/ยกเลิกบิลแล้วปล่อยโต๊ะ (ล้างธงพิมพ์ QR + เปลี่ยน QR)",
    (APP.split("      await releaseThisTable();").length - 1) === 2 &&
    APP.includes("ok=await Promise.race([api.releaseTable(table.id),new Promise(r=>setTimeout(()=>r(false),4000))]);"));
  // คอลัมน์ใหม่ยังไม่ถูกเพิ่ม = ห้ามทำให้พิมพ์ QR/ปิดบิล/ปิดกะ ล้ม
  ok_("ยังไม่ได้เพิ่มคอลัมน์ qr_printed_at แล้วต้องไม่พัง",
    APP.includes("if(/PGRST204|column .* does not exist|schema cache/i.test(String((e&&e.message)||e)))return false; throw e;"));

  // ── ล็อกส่วนลด ──
  ok_("พิมพ์ QR แล้วล็อกสถานะ+ยอดไว้ที่ตัวบิล", APP.includes("const row=await api.setPayWaiting(existingOrder.id,verRef.current,lock);"));
  ok_("ล็อกเก็บส่วนลด/โปรฯ/ยอด ครบพอให้กลับมากดยืนยันได้ทันที",
    APP.includes("disc_mode:discMode,disc_type:discType,disc_value:+discValue||0,item_disc:itemDisc,")
    && APP.includes("promo_id:selectedPromoId??null"));
  ok_("เปิดโต๊ะกลับมาแล้วตั้งส่วนลดคืนจากที่ล็อกไว้", APP.includes("const L=existingOrder&&existingOrder.pay_lock;"));
  ok_("ล็อกแล้วระบบห้ามเลือกโปรฯ ให้เอง (ยอดจะเพี้ยนจาก QR)", APP.includes("if(payWait)return;   // ล็อกยอดไว้แล้ว"));
  ok_("ล็อกแล้วกดแก้ส่วนลดไม่ได้จริง ไม่ใช่แค่ขึ้นข้อความ", APP.includes('pointerEvents:payWait?"none":"auto"'));
  ok_("ยอดเปลี่ยนหลังพิมพ์ QR ต้องเตือนให้พิมพ์ใหม่", APP.includes("⚠️ ยอดไม่ตรงกับ QR ที่พิมพ์ไปแล้ว"));
  // กดพิมพ์ผิดโต๊ะต้องยกเลิกได้ตรงนั้นเลย ไม่ต้องไปหาปุ่มที่อื่น
  ok_("ปุ่มยกเลิกรอชำระอยู่ข้างปุ่มพิมพ์ QR",
    APP.includes("{payWait&&onUnlockPay&&<Btn v=\"ghost\" onClick={onUnlockPay}") && APP.includes("↩︎ ยกเลิกรอชำระ"));
  // QR พร้อมเพย์ผูกกับยอดเงิน ไม่ได้ผูกกับโต๊ะ — ยกเลิกรอชำระแล้วใบเดิมยังจ่ายได้ ห้ามไปบอกลูกค้าว่าใช้ไม่ได้
  ok_("ยกเลิกรอชำระแล้วไม่ทิ้งยอดที่พิมพ์ไป (ใบเดิมยังใช้ได้)",
    APP.includes("setPayWait(false);   // คง lockedTotal ไว้")
    && !APP.includes('{status:"pending", pay_lock:null,'));
  ok_("บอกให้ชัดว่า QR ใบเดิมยังใช้ได้", APP.includes("QR ใบเดิมที่ลูกค้าถืออยู่ยังใช้จ่ายได้ ไม่ต้องพิมพ์ใหม่"));
  ok_("ปลดล็อกแล้วยังเฝ้าว่ายอดยังตรงกับ QR อยู่ไหม",
    APP.includes("{lockedTotal!=null&&!payWait&&Math.abs((+total||0)-(+lockedTotal||0))<=0.009&&<div"));
  ok_("มีทางปลดล็อก (กดพิมพ์ผิดโต๊ะต้องมีทางออก)", APP.includes("async function unlockPayWait(){"));
  // เขียนทับบิลที่เพิ่งถูกปิด/ถูกแก้จากเครื่องอื่นไม่ได้
  ok_("ล็อกยอดแบบกันชนกัน (เขียนต่อเมื่อบิลยังไม่ถูกแก้และยังไม่ถูกปิด)",
    APP.includes("const q = `orders?id=eq.${id}&updated_at=${guard}&status=neq.paid&status=neq.cancelled`;"));
  ok_("ยังไม่ได้เพิ่มคอลัมน์ pay_lock ก็ต้องล็อกสถานะให้ได้อยู่",
    APP.includes("const {pay_lock, ...rest} = body;") && APP.includes("_noLockCol:true"));

  // ── หน้าลูกค้า ──
  ok_("หน้าลูกค้าขึ้นป็อปอัพว่ากำลังรอชำระเงิน", APP.includes("{payWaitMsg&&payWaiting&&<div style={{position:\"fixed\"") && APP.includes("ตอนนี้สั่งอาหารเพิ่มไม่ได้"));
  ok_("หน้าลูกค้ามีแถบค้างบนหัวจอด้วย ไม่ใช่เห็นแค่ตอนเด้ง", APP.includes("🔒 กำลังรอการชำระเงิน"));
  ok_("ปุ่มยืนยันสั่งอาหารกดไม่ได้ตอนรอชำระ", APP.includes('disabled={payWaiting} full s={{padding:"10px"}}'));
  ok_("กดการ์ดเมนูตอนรอชำระ = เด้งบอก ไม่ใช่เงียบ", APP.includes("if(payWaiting){setPayWaitMsg(true);return;}   // รอชำระเงินอยู่ ห้ามสั่งเพิ่ม"));
}

// ══════════════════════════════════════════════════════════════════════════
// จอสั่งอาหาร: ของที่ "เพิ่งกดเพิ่ม" ต้องเห็นชัด และปุ่มส่งครัวต้องติดตามนั้นเสมอ
// เจ้าของแจ้ง 9 ก.ย. 69: กดเลือกเมนูแล้วสีส้มจางเกินจนแยกไม่ออก และปุ่มส่งเข้าครัว
// ไม่ทำงานกับเมนูที่เพิ่งกดสั่งเพิ่ม
// ต้นเหตุ: ทั้งสีและปุ่มเดาจากตัวเลข (เทียบจำนวนกับยอดที่ส่งครัวไปแล้วต่อเมนู)
// เมนูเดียวกันอยู่ได้หลายแถว และการกดเพิ่มก็ไปบวกทับแถวที่ส่งครัวไปแล้ว
// การเดาจึงผิดได้ทั้งสองทาง — แถวใหม่ขึ้นเขียวเหมือนส่งแล้ว / ปุ่มดับทั้งที่ยังมีของใหม่
// คราวนี้ติดธงที่แถวตั้งแต่ตอนกด แล้วทั้งสี ปุ่ม และรายการที่ส่ง อ่านธงตัวเดียวกัน
// ══════════════════════════════════════════════════════════════════════════
let _addOk = false;
section("จอสั่งอาหาร: ของใหม่ที่ยังไม่ได้ส่งครัว");
try {
  // ดึงตัวกดเพิ่มเมนูตัวจริงมารัน — ค้นข้อความอย่างเดียวพิสูจน์พฤติกรรมไม่ได้
  let n = 0;
  const src = grabConst(APP, "addItem");
  const mkAdd = (get, set) => new Function("useCallback", "setItems", "uuidv4", "menuCatOf",
    src + " return addItem;")(f => f, set, () => "uid" + (++n), (m) => m.category || null);

  // โต๊ะนี้ส่งครัวไปแล้ว 2 จาน (มาจาก existingOrder จึงไม่มีธง _new)
  const seed = () => [
    { line_uid: "s1", menu_id: 10, name: "หมูสไลด์", price: 100, qty: 2, note: "", category: "หมูกระทะ" },
    { line_uid: "s2", menu_id: 20, name: "ข้าวสวย", price: 10, qty: 1, note: "", category: "เมนูสั่งเพิ่ม" },
  ];
  let items = seed();
  const add = mkAdd(() => items, (f) => { items = f(items); });

  add({ id: 10, name: "หมูสไลด์", price: 100, category: "หมูกระทะ" });
  ck("กดเมนูที่ส่งครัวไปแล้ว = ได้แถวใหม่ ไม่ไปบวกทับแถวเดิม",
    items.map(i => [i.name, i.qty, !!i._new]),
    [["หมูสไลด์", 2, false], ["ข้าวสวย", 1, false], ["หมูสไลด์", 1, true]]);

  add({ id: 10, name: "หมูสไลด์", price: 100, category: "หมูกระทะ" });
  ck("กดซ้ำอีกที = รวมกับแถวใหม่แถวเดิม ไม่แตกแถวเพิ่ม",
    items.filter(i => i._new).map(i => [i.name, i.qty]), [["หมูสไลด์", 2]]);
  ck("แถวที่ส่งครัวไปแล้วไม่ถูกแตะเลย",
    items.filter(i => !i._new).map(i => [i.line_uid, i.qty]), [["s1", 2], ["s2", 1]]);

  // ── ปุ่มส่ง กับ รายการที่ส่งจริง ต้องอ่านธงเดียวกับสีบนจอ ──
  const clean = new Function("return ({_new,...r})=>r;")();
  const newRows = items.filter(i => i._new && (+i.qty || 0) > 0);
  ck("ปุ่มส่งติดเมื่อมีของใหม่", newRows.length > 0, true);
  ck("ส่งเฉพาะของใหม่ ไม่ส่งของที่ครัวได้ไปแล้วซ้ำ",
    newRows.map(clean).map(i => [i.name, i.qty]), [["หมูสไลด์", 2]]);
  ck("ธงในจอไม่หลุดลงฐานข้อมูล", Object.keys(clean(items[2])).includes("_new"), false);
  ck("รายการที่ส่งยังมี line_uid เดิมของแถว (ส่งซ้ำเพราะเน็ตสะดุดถูกกันซ้ำที่ปลายทาง)",
    newRows.map(clean).every(i => !!i.line_uid), true);

  // เมนูที่มีหมายเหตุ/ตัวเลือก ต้องไม่ถูกรวมเข้ากับแถวเปล่า
  items = seed();
  items.push({ line_uid: "s3", menu_id: 10, name: "หมูสไลด์", price: 100, qty: 1, note: "ไม่เผ็ด", category: "หมูกระทะ" });
  const add2 = mkAdd(() => items, (f) => { items = f(items); });
  add2({ id: 10, name: "หมูสไลด์", price: 100, category: "หมูกระทะ" });
  ck("ของที่มีหมายเหตุไม่ถูกเอาไปรวมกับของเปล่า",
    items.filter(i => i._new).map(i => [i.note, i.qty]), [["", 1]]);

  // ── สิ่งที่ตาเห็นบนจอ ──
  ok_("แถวที่ยังไม่ส่งครัวใช้ธงเดียวกับปุ่ม ไม่เดาจากตัวเลขอีก",
    APP.includes("items.map((item,idx)=>({item,idx,unsent:!!item._new}))")
    && APP.includes("const newRows=useMemo(()=>items.filter(i=>i._new&&(+i.qty||0)>0),[items]);")
    && APP.includes("const hasNewItems=newRows.length>0;"));
  ok_("สีส้มเข้มขึ้นจากของเดิม (#FFF7ED จางเกินไป)",
    APP.includes('bg={unsent?"#FFE8CC":C.greenLight}') && !APP.includes('bg={unsent?"#FFF7ED"'));
  ok_("มีแถบสีข้างแถวให้เห็นแต่ไกล", APP.includes('accent={unsent?"#F97316":null}') && APP.includes("borderLeft:accent?"));
  ok_("มีป้าย ใหม่ หน้าชื่อเมนู", APP.includes(">ใหม่</span>"));
  ok_("กดเพิ่มแล้วเลื่อนลงไปให้เห็นของที่เพิ่งเพิ่ม",
    APP.includes("if(newQty>prevNewQty.current&&listRef.current)listRef.current.scrollTop=listRef.current.scrollHeight;"));
  // ของที่ยังไม่ส่งครัวไม่มีอะไรใน DB ให้ลบ และครัวยังไม่ได้ทำ จึงไม่ต้องแจ้ง
  ok_("ยกเลิกของที่ยังไม่ได้ส่ง ไม่ไปแตะบิลใน DB และไม่กวนครัว",
    APP.includes("if(target._new){setItems(newLocal);return;}"));
  ok_("ของที่ยังไม่ส่งลดจำนวนได้ถึงศูนย์ ของที่ส่งแล้วยังลดไม่ได้",
    APP.includes("const floor=it._new?0:Math.max(0,(base.get(sentKey(it))||0)-otherQty);"));
  ok_("ปิดบิลแล้วธงในจอไม่ติดลงข้อมูล", APP.includes("const itemsWithDisc=useMemo(()=>items.map(clean).map((i,idx)=>{"));
  ok_("ส่งครัวแล้วธงในจอไม่ติดลงข้อมูล", APP.includes("const delta=newRows.map(clean);"));
  // เมนูที่มีตัวเลือกไปคนละทางกับเมนูเปล่า ต้องติดธงเหมือนกัน ไม่งั้นสั่งแล้วปุ่มส่งไม่ติด
  ok_("เมนูที่มีตัวเลือกก็ติดธงของใหม่เหมือนกัน",
    APP.includes("options:chosen||[],printer_id:m.printer_id||null,category:menuCatOf(m),_new:true}]);"));
  _addOk = true;
} catch (e) {
  ok_("ดึงตัวกดเพิ่มเมนูมารันได้ (" + String(e && e.message).slice(0, 60) + ")", false);
}
ok_("ด่านชุดของใหม่รันจนจบ", _addOk);

// ══════════════════════════════════════════════════════════════════════════
// ใบครัวต้องบอกได้ว่าเป็นใบชนิดไหน + ย้ายโต๊ะ
// เจ้าของสั่ง: "กดพิมพ์ซ้ำแล้วกระดาษต้องรีมาร์คไว้เล็กๆ ว่าเป็นเมนูที่พิมพ์ซ้ำ"
// ถ้าไม่มีป้าย ครัวเห็นใบเดิมอีกใบก็ทำอีกจาน = ของทิ้งเปล่าทุกครั้งที่กดพิมพ์ซ้ำ
// ══════════════════════════════════════════════════════════════════════════
section("ใบครัว: ป้ายบอกชนิด + ย้ายโต๊ะ");
{
  // ดึงตัวสร้างบรรทัดตัวจริงจาก api/kitchen-slip.js มารัน — ค้นข้อความอย่างเดียวไม่พอ
  const st = SLIP.indexOf("function buildLines(body) {");
  if (st < 0) throw new Error("ไม่เจอ buildLines");
  let d = 0, en = -1;
  for (let j = SLIP.indexOf("{", st); j < SLIP.length; j++) {
    if (SLIP[j] === "{") d++;
    else if (SLIP[j] === "}") { d--; if (!d) { en = j + 1; break; } }
  }
  const buildLines = new Function(SLIP.slice(st, en) + "\nreturn buildLines;")();
  const txt = (ls) => ls.map(l => l.t || l.box || l.c2 || "").join("\n");
  const IT = [{ qty: 2, name: "หมูสไลด์", options: [], note: "" }];

  const plain = buildLines({ table: "C7", items: IT });
  ck("ออเดอร์ปกติไม่มีป้ายอะไรเพิ่ม", /พิมพ์ซ้ำ|ยกเลิกแล้ว|ย้ายมาจาก/.test(txt(plain)), false);
  ck("ออเดอร์ปกติยังขึ้นหัวว่าใบสั่งอาหาร", plain[0].t, "ใบสั่งอาหาร");

  const rep = buildLines({ table: "C7", kind: "reprint", items: IT });
  ok_("ใบพิมพ์ซ้ำมีป้ายบอกว่าไม่ใช่ออเดอร์ใหม่", txt(rep).includes("พิมพ์ซ้ำ - ไม่ใช่ออเดอร์ใหม่"));
  ck("ป้ายอยู่ใต้เบอร์โต๊ะ และตัวเล็กกว่าเบอร์โต๊ะ", rep[2].size < rep[1].size, true);
  ck("เบอร์โต๊ะยังเป็นตัวใหญ่สุดบนใบ", Math.max(...rep.map(l => l.size || 0)), 76);
  ok_("ยังพิมพ์รายการอาหารครบเหมือนเดิม", txt(rep).includes("หมูสไลด์"));

  const vd = buildLines({ table: "C7", kind: "void", items: IT });
  // เจ้าของสั่ง 11 ก.ย. 69: หัวใบยกเลิกเป็นกล่องสี่เหลี่ยมดำทึบ เขียนว่ายกเลิกชัดๆ
  ck("ใบยกเลิกหัวเป็นกล่องดำเขียนว่ายกเลิก", vd[0].box, "ยกเลิก");
  ok_("ใบยกเลิกยังมีเบอร์โต๊ะและรายการที่ยกเลิก", vd[1].t === "C7" && txt(vd).includes("หมูสไลด์"));
  ok_("ใบยกเลิกบอกว่าไม่ต้องทำ", txt(vd).includes("ยกเลิกแล้ว - ไม่ต้องทำ"));

  const mv = buildLines({ table: "C7", kind: "move", from: "A5", items: IT });
  // เจ้าของสั่ง 11 ก.ย. 69: ใบย้ายโต๊ะบอกแค่จากโต๊ะไหน ไปโต๊ะไหน ตามชื่อโต๊ะ
  ck("ใบย้ายโต๊ะหัวเป็นกล่องดำเขียนว่าย้ายโต๊ะ", mv[0].box, "ย้ายโต๊ะ");
  const mvT = mv.map(l => l.t || l.box || "");
  const iFrom = mvT.indexOf("จากโต๊ะ"), iTo = mvT.indexOf("ย้ายไปโต๊ะ");
  ok_("ใบย้ายโต๊ะ: จากโต๊ะ A5 แล้วค่อย ย้ายไปโต๊ะ C7 (ห้ามสลับ)", iFrom >= 0 && mvT[iFrom + 1] === "A5" && iTo > iFrom && mvT[iTo + 1] === "C7");
  ck("ชื่อโต๊ะทั้งสองเป็นตัวใหญ่สุดบนใบ", mv.filter(l => l.size === 76).map(l => l.t).join(), "A5,C7");
  ok_("ใบย้ายโต๊ะไม่มีรายการอาหาร และบอกว่าไม่ต้องทำใหม่", !txt(mv).includes("หมูสไลด์") && txt(mv).includes("ไม่ต้องทำอาหารใหม่"));
  ok_("ตัววาดรองรับกล่องดำตัวขาว", SLIP.includes("if (l.box) {") && SLIP.includes('ctx.fillStyle = "#fff";'));
  ok_("ไม่มีอีโมจิบนกระดาษ (ฟอนต์ใบครัวไม่มีตัวอีโมจิ)",
    ![plain, rep, vd, mv].some(ls => /[\u{1F300}-\u{1FAFF}\u{2700}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(txt(ls))));

  // ── ฝั่งตัวพิมพ์กับแอปต้องส่งชนิดใบมาให้จริง ──
  ok_("ตัวพิมพ์ส่งชนิดใบและโต๊ะเดิมไปกับคำขอเรนเดอร์",
    AGENT.includes('kind: (meta && meta.kind) ? String(meta.kind) : "", from: (meta && meta.from) ? String(meta.from) : "",')
    && AGENT.includes("kind: rp.kind, from: rp.from"));
  ok_("ปุ่มพิมพ์ซ้ำบอกชนิดว่าเป็นการพิมพ์ซ้ำ", APP.includes('kind:o.kind||"reprint"'));
  ok_("ทางยกเลิกรายการบอกชนิดว่าเป็นการยกเลิก", APP.includes('{kind:"void",okMsg:'));

  // ── ย้ายโต๊ะ ──
  // ย้ายผิดกติกาแปลว่าบิลสองใบมาชนกันที่โต๊ะเดียว หรือยอดขายถูกนับซ้ำ
  ok_("มีหน้าต่างย้ายโต๊ะ", APP.includes("function MoveTableModal({from,order,tables,activeOrders,branch,currentUser,onClose,onDone}){"));
  ok_("ปุ่มย้ายโต๊ะขึ้นเฉพาะโต๊ะที่มีบิลอยู่", APP.includes("{selOrder?.id&&<button onClick={()=>setMoveFrom({table:selTable,order:selOrder})}"));
  ok_("เลือกได้เฉพาะโต๊ะที่ว่างจริง (ไม่มีบิลค้างอยู่)",
    APP.includes("const taken=new Set((activeOrders||[]).map(o=>String(o.table_id)));")
    && APP.includes("!taken.has(String(t.id))"));
  ok_("ย้ายไปทับโต๊ะตัวเองไม่ได้", APP.includes('String(t.id)!==String(from.id)'));
  ok_("โต๊ะที่ปิดใช้งานไม่ขึ้นให้เลือก", APP.includes("t.active!==false&&String(t.id)!==String(from.id)"));
  // ลูกค้ากดสั่งเพิ่มจากมือถือพอดีตอนพนักงานกดย้าย = ต้องไม่เขียนทับของใหม่
  ok_("ย้ายแบบกันชนกัน (เขียนต่อเมื่อยังไม่มีใครแก้)",
    APP.includes("await api.updatePOSOrderIfUnchanged(order.id,order.updated_at,")
    && APP.includes("{table_id:+t.id,table_number:t.table_number,updated_at:new Date().toISOString()}"));
  ok_("ย้ายแล้วต้องแจ้งครัว ไม่งั้นเสิร์ฟไปโต๊ะเดิมที่มีลูกค้าใหม่นั่งแล้ว",
    APP.includes('kind:"move",from:String(from.table_number)}'));
  ok_("ใบแจ้งย้ายโต๊ะห้ามเงียบ — ไม่มีเครื่องรับหมวดไหนเลยก็ส่งไปทุกเครื่อง",
    APP.includes("if(!ups.length&&fallbackAll&&usable.length){"));
  ok_("แจ้งครัวไม่สำเร็จต้องบอกให้ไปบอกครัวเอง", APP.includes("แต่แจ้งครัวไม่สำเร็จ กรุณาบอกครัวด้วยตัวเอง"));
  // โต๊ะเก่าว่างเองเพราะจอผังดูจากบิลที่ผูกอยู่ ไม่ใช่คอลัมน์ status
  ok_("จอผังโต๊ะยังตัดสินว่าง/ไม่ว่างจากบิลที่ผูกอยู่",
    APP.includes("function getTableOrder(tid){return activeOrders.find(o=>o.table_id===tid);}"));
}

// ══════════════════════════════════════════════════════════════════════════
// "หมวดไหนออกเครื่องไหน" ที่จอบอก ต้องตรงกับที่ตัวพิมพ์ทำจริง
// เหตุจริง 9 ก.ย. 69: เจ้าของแจ้ง "น้ำเปล่าปริ้นไม่ออก" แล้วไม่มีจอไหนในระบบบอกได้เลย
// ว่าหมวด "น้ำ" ถูกตั้งให้ออกเครื่องแคชเชียร์เครื่องเดียว ต้องไปไล่เปิดทีละเครื่องเอง
// จอใหม่สรุปให้ — แต่ถ้ามันคิดคนละแบบกับตัวพิมพ์ ก็จะโกหกหน้าตาย ตรงนี้จึงเทียบสองตัวจริง
// ══════════════════════════════════════════════════════════════════════════
section("จอบอกว่าออกเครื่องไหน = ที่ตัวพิมพ์ทำจริง");
{
  const app = new Function(grabConst(APP, "menuCatOf") + "\n" + grabConst(APP, "printersForMenu") + "\nreturn printersForMenu;")();
  const st = AGENT.indexOf("function printerHandles(");
  if (st < 0) throw new Error("ไม่เจอ printerHandles ในตัวพิมพ์");
  let d = 0, en = -1;
  for (let j = AGENT.indexOf("{", st); j < AGENT.length; j++) {
    if (AGENT[j] === "{") d++;
    else if (AGENT[j] === "}") { d--; if (d === 0) { en = j + 1; break; } }
  }
  const agent = new Function(AGENT.slice(st, en) + "\nreturn printerHandles;")();

  const P = [
    { id: 10, name: "จานเดียว", active: true, categories: ["อาหารจานเดียว", "ของทอด"] },
    { id: 11, name: "เซตหมู", active: true, categories: ["หมูกระทะ", " ของทอด "] },
    { id: 12, name: "แคชเชียร์", active: true, categories: ["น้ำ"] },
    { id: 13, name: "เครื่องเก่า", active: false, categories: ["น้ำ"] },
    { id: 14, name: "รับทุกหมวด", active: true, categories: null },
  ];
  const noAll = P.filter(p => p.id !== 14);            // ชุดที่ไม่มีเครื่องรับทุกหมวด (ของจริงทุกสาขาเป็นแบบนี้)
  const names = (arr) => arr.map(p => p.name);

  ck("ไม่ปักหมุด → ทุกเครื่องที่ติ๊กหมวดนั้น",
    names(app({ id: 1, category: "ของทอด", printer_id: null }, noAll)), ["จานเดียว", "เซตหมู"]);
  ck("ชื่อหมวดมีช่องว่างหน้าหลังก็ต้องเจอ (ตัวพิมพ์ trim เหมือนกัน)",
    names(app({ id: 2, category: "ของทอด", printer_id: null }, [P[1]])), ["เซตหมู"]);
  ck("น้ำเปล่า (หมวด น้ำ) ออกเครื่องแคชเชียร์เครื่องเดียว — เคสจริงที่เจ้าของถาม",
    names(app({ id: 3, category: "น้ำ", printer_id: null }, noAll)), ["แคชเชียร์"]);
  ck("เครื่องที่ปิดใช้งานไม่ถูกนับว่ารับ", names(app({ id: 4, category: "น้ำ", printer_id: 13 }, noAll)), []);
  ck("ปักหมุดแล้วออกเครื่องนั้นเครื่องเดียว ไม่ตกไปหาหมวด",
    names(app({ id: 5, category: "ของทอด", printer_id: 12 }, noAll)), ["แคชเชียร์"]);
  ck("ปักหมุดไปเครื่องที่ไม่มีในสาขานี้ = ไม่มีเครื่องรับ (ไม่มีทางสำรอง)",
    names(app({ id: 6, category: "ของทอด", printer_id: 99 }, noAll)), []);
  ck("ยังไม่จัดหมวด + ทุกเครื่องติ๊กหมวดไว้ = ไม่มีเครื่องรับ",
    names(app({ id: 7, category: "", printer_id: null }, noAll)), []);
  ck("มีเครื่องรับทุกหมวด (categories=null) รับหมดแม้เมนูยังไม่จัดหมวด",
    names(app({ id: 8, category: "", printer_id: null }, [P[4]])), ["รับทุกหมวด"]);

  // ตัวตัดสินจริง: ทุกคู่ (เมนู × เครื่อง) จอกับตัวพิมพ์ต้องตอบเหมือนกันหมด
  const MENUS = [
    { id: 1, category: "ของทอด", printer_id: null }, { id: 2, category: "น้ำ", printer_id: null },
    { id: 3, category: "หมูกระทะ", printer_id: null }, { id: 4, category: "ไม่มีใครรับ", printer_id: null },
    { id: 5, category: "", printer_id: null }, { id: 6, category: null, printer_id: null },
    { id: 7, category: "ของทอด", printer_id: 12 }, { id: 8, category: "ของทอด", printer_id: 99 },
    { id: 9, category: "ของทอด", printer_id: "11" }, { id: 10, category: " ของทอด ", printer_id: null },
  ];
  let same = 0, diff = [];
  for (const sets of [P, noAll]) {
    const act = sets.filter(p => p.active !== false);
    for (const m of MENUS) {
      const mine = new Set(app(m, sets).map(p => p.id));
      for (const p of act) {
        const theirs = agent(p, { printer_id: m.printer_id, category: m.category });
        if (mine.has(p.id) === !!theirs) same++;
        else diff.push(`เมนู ${m.id} × เครื่อง ${p.id}: จอ=${mine.has(p.id)} ตัวพิมพ์=${!!theirs}`);
      }
    }
  }
  ck(`จอกับตัวพิมพ์ตอบตรงกันทุกคู่ (${same} คู่)`, diff, []);

  ok_("จอสถานะเครื่องพิมพ์สรุปให้เห็นว่าหมวดไหนออกเครื่องไหน",
    APP.includes("🧭 หมวดไหนออกเครื่องไหน") && APP.includes("const routing=useMemo(()=>{"));
  ok_("เมนูที่ไม่มีเครื่องรับต้องเด้งขึ้นบนสุดและขึ้นสีแดง",
    APP.includes("(b.dead>0?1:0)-(a.dead>0?1:0)") && APP.includes("ไม่มีเครื่องพิมพ์รับเลย"));
  ok_("จอใช้ตัวเดียวกับที่ตรวจแล้วว่าตรงกับตัวพิมพ์", APP.includes("const hit=printersForMenu(m,printers);"));
}

// ══════════════════════════════════════════════════════════════════════════
// หมวดของเครื่องพิมพ์ต้องเป็นหมวด "ของสาขานั้น"
// เหตุจริง 9 ก.ย. 69: เครื่อง "เซตหมู" สาขา 8 ติ๊กหมวดของสาขา 5/6 ไว้ 9 หมวด
// เพราะจอกวาดหมวดจากเมนูทั้งเครือ แล้วปุ่ม "เลือกทั้งหมด" ติ๊กติดไปหมด
// ══════════════════════════════════════════════════════════════════════════
section("หมวดของเครื่องพิมพ์ = หมวดของสาขานั้น");
{
  ok_("จอหลังบ้านกรองเมนูตามสาขาของเครื่องก่อนหาหมวด",
    APP.includes("const bid=catEditP&&catEditP.branch_id;") && APP.includes("return (menus||[]).filter(m=>menuVisibleAt(m,bid));"));
  ok_("เครื่องที่ยังไม่ผูกสาขา = ใช้ร่วมทุกสาขา ต้องเห็นครบเหมือนเดิม", APP.includes("if(bid==null)return menus||[];"));
  ok_("เรียงหมวดตามพยัญชนะไทย ไม่ใช่รหัสตัวอักษร", APP.includes("return [...s].sort(thCmp);   // เรียงตามพยัญชนะไทย"));
  ok_("จำนวนเมนูต่อหมวดนับเฉพาะเมนูที่สาขานี้เห็น", APP.includes("const menusInCat=(c)=>branchMenus.filter(m=>menuCatOf(m)===c);"));
  ok_("จอสถานะเครื่องพิมพ์หน้าร้านกรองตามสาขาเหมือนกัน",
    APP.includes("const branchMenus=useMemo(()=>(menus||[]).filter(m=>menuVisibleAt(m,currentBranch&&currentBranch.id)),[menus,currentBranch]);"));
  // ซ่อนเฉยๆ อันตราย: ติ๊กที่ค้างอยู่จะมองไม่เห็นแต่ยังอยู่ในฐานข้อมูล
  ok_("หมวดที่ติ๊กค้างไว้แต่สาขานี้ไม่มีแล้ว ต้องโชว์ให้เห็นและกดเอาออกได้",
    APP.includes("const staleCats=useMemo(()=>{") && APP.includes("ติ๊กค้างไว้ {staleCats.length} หมวด"));
  // "เลือกทั้งหมด" กับตอนบันทึกต้องใช้ชุดเดียวกับที่ตาเห็น ไม่ใช่ชุดทั้งเครือ
  ok_("เลือกทั้งหมด/บันทึก ใช้หมวดของสาขานั้น",
    APP.includes("setCatSel([...allCategories])") && APP.includes("categories:catSel||[...allCategories]"));
}



// ══════════════════════════════════════════════════════════════════════════
// วันที่โอนจริง + จ่ายจากบัญชีไหน (ฟอร์มชำระเงิน PO)
// เหตุ: payment_at เคยเป็น "เวลาที่กดปุ่ม" ไม่ใช่วันที่โอนจริง — โอนวันศุกร์แล้ว
// มากดวันจันทร์ ถ้าคร่อมสิ้นเดือนยอดไปลงผิดเดือนในบัญชี แก้ทีหลังยากกว่ามาก
// และไม่เคยมีช่องบอกว่าเงินออกจากบัญชีธนาคารหรือเงินสด ⟹ กระทบยอดกับสเตทเมนต์ไม่ได้
// ══════════════════════════════════════════════════════════════════════════
section("วันที่โอนจริง + แหล่งเงินที่จ่าย PO");
{
  // ── ดึง bkkNoonISO ตัวจริงมารัน ────────────────────────────────────────
  // ค้นข้อความไม่พอ: เปลี่ยน 12:00 เป็น 00:00 ข้อความยังดูถูกทุกอย่าง แต่วันเพี้ยน
  const bkkNoonISO = (() => {
    const st = APP.indexOf("const bkkNoonISO = (ymd) => {");
    if (st < 0) throw new Error("ไม่เจอ bkkNoonISO");
    let d = 0, started = false, en = -1;
    for (let i = st; i < APP.length; i++) {
      if (APP[i] === "{") { d++; started = true; }
      else if (APP[i] === "}") { d--; if (started && d === 0) { en = APP.indexOf(";", i) + 1; break; } }
    }
    return new Function(APP.slice(st, en) + " return bkkNoonISO;")();
  })();

  // ตัวชี้ขาด: วันที่ที่พนักงานเลือก ต้องอ่านได้ "วันเดียวกัน" ทั้งเวลาไทยและ UTC
  // 00:00+07 = 17:00 ของเมื่อวานใน UTC ⟹ ระบบที่ตัดวันด้วย UTC จะได้วันก่อนหน้า
  // (วันที่ 1 ของเดือนจะเด้งไปเดือนก่อน ซึ่งคือความผิดพลาดที่ช่องนี้ตั้งใจมาแก้)
  const bad = [];
  for (const ymd of ["2026-01-01", "2026-02-28", "2026-06-15", "2026-09-10", "2026-12-31", "2027-03-01"]) {
    const iso = bkkNoonISO(ymd);
    if (!iso) { bad.push(ymd + ": แปลงไม่ได้"); continue; }
    const bkk = new Date(iso).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    if (bkk !== ymd) bad.push(ymd + ": เวลาไทยอ่านได้ " + bkk);
    if (iso.slice(0, 10) !== ymd) bad.push(ymd + ": UTC อ่านได้ " + iso.slice(0, 10));
  }
  ck("วันที่โอนจริงอ่านได้วันเดียวกันทั้งเวลาไทยและ UTC", bad, []);
  // รับมาจาก input วันที่ก็จริง แต่ค่าอาจมาจากที่อื่นได้ — เพี้ยนต้องคืน null
  // ให้โค้ดถอยไปใช้เวลาปัจจุบัน ดีกว่าโยน exception กลางการบันทึกการจ่ายเงิน
  ck("ค่าที่ไม่ใช่ YYYY-MM-DD ต้องคืน null ไม่ใช่วันเพี้ยน",
    ["", null, undefined, "10/09/2569", "2026-9-10", "วันนี้", "2026-02-31"].map((v) => bkkNoonISO(v)),
    [null, null, null, null, null, null, null]);

  // updated_at คือ "แถวถูกแก้เมื่อไหร่" ไม่ใช่ "โอนเมื่อไหร่" — เลือกวันย้อนหลัง
  // แล้วเขียน updated_at ย้อนตาม จะทำให้แถวดูเก่ากว่าความจริงทั้งระบบ
  ok_("เลือกวันย้อนหลังแล้ว updated_at ยังเป็นเวลาปัจจุบัน",
    APP.includes("const paidAt=bkkNoonISO(payDate)||now;") &&
    APP.includes("cash_source:cashSource||null,sliptrack_sync:null,updated_at:now};"));

  // ── ค่าแหล่งเงิน: ฝั่งบัญชีเทียบ "ตรงตัวอักษร" กับคีย์ตารางกระแสเงินสดเขา ──
  // เพี้ยนตัวเดียว/มีวรรคเกิน = เขาอ่านเป็น "ไม่ใช่เงินสด" แล้วยอดไปโผล่ผิดฝั่ง
  const CASH = (() => {
    const ln = APP.split("\n").find((l) => l.startsWith("const PO_CASH_SOURCES="));
    if (!ln) throw new Error("ไม่เจอ PO_CASH_SOURCES");
    return new Function(ln.trim() + " return PO_CASH_SOURCES;")();
  })();
  ck("ค่าแหล่งเงินตรงกับที่ฝั่งบัญชีกำหนดเป๊ะทุกตัวอักษร", CASH,
    ["โอนจากบัญชีบริษัท", "เงินสดย่อย", "เงินในตู้เซฟ", "ลิ้นชักเก็บเงิน"]);
  ck("ไม่มีช่องว่างแอบอยู่ในค่าแหล่งเงิน", CASH.filter((v) => /\s/.test(v)), []);
  // "โอนเข้าบัญชีบริษัท" เป็นคีย์ที่มีจริงของเขา แต่เป็นเงิน "เข้า" ไม่ใช่จ่ายออก
  // มีตัวเลือกผิดทางอยู่ในฟอร์มจ่ายเงิน = รอให้มีคนกดพลาดเท่านั้นเอง
  ok_("ไม่มีตัวเลือกเงิน \"เข้า\" ปนในฟอร์มจ่ายเงินออก", !CASH.includes("โอนเข้าบัญชีบริษัท"));

  // บังคับเลือก ไม่มีค่าตั้งต้น — ข้อมูลผิดที่ "ดูครบ" แย่กว่าข้อมูลว่างที่รู้ว่าไม่มี
  // เพราะไม่มีใครกลับมาตรวจของที่ดูครบแล้ว
  ok_("ช่องจ่ายจากบัญชีไหนตั้งต้นเป็นค่าว่าง", APP.includes('const[cashSource,setCashSource]=useState("");'));
  ok_("ไม่เลือกแหล่งเงิน = กดยืนยันไม่ได้",
    APP.includes("disabled={!slipFile||!cashSource||!payDate||saving}") &&
    APP.includes('if(!cashSource){alert("กรุณาเลือกว่าจ่ายเงินจากบัญชีไหน");return;}'));
  ok_("วันที่โอนตั้งต้นเป็นวันนี้ และเลือกวันในอนาคตไม่ได้",
    APP.includes("const[payDate,setPayDate]=useState(today);") &&
    APP.includes('if(payDate>today){alert("วันที่โอนจริงต้องไม่เกินวันนี้");return;}') &&
    APP.includes("max={today}"));

  // ── ทุกทางที่ยิง "จ่ายแล้ว" ต้องพกแหล่งเงินไปด้วย ──────────────────────
  // ไล่จากการเรียกฟังก์ชันจริงทุกจุด (นับวงเล็บ) ไม่ใช่ค้นข้อความทีละบรรทัด
  // เพราะจุดที่ยิงจาก "ปุ่มส่งทั้งหมด" เขียนคร่อมหลายบรรทัด ค้นบรรทัดเดียวมองไม่เห็น
  const paidCalls = [];
  for (let i = APP.indexOf("pushPOToSlipTrack("); i >= 0; i = APP.indexOf("pushPOToSlipTrack(", i + 1)) {
    if (APP.slice(i - 9, i) === "function ") continue;            // ข้ามตัวประกาศฟังก์ชันเอง
    let d = 0, en = -1;
    for (let j = APP.indexOf("(", i); j < APP.length; j++) {
      if (APP[j] === "(") d++;
      else if (APP[j] === ")") { d--; if (d === 0) { en = j; break; } }
    }
    if (en < 0) continue;
    const args = APP.slice(i, en + 1);
    if (args.includes("paid:true")) paidCalls.push(args);
  }
  ck("เจอจุดยิง \"จ่ายแล้ว\" ครบทุกจุด", paidCalls.length, 3);
  ck("ทุกจุดยิงจ่ายแล้วพกแหล่งเงินไปด้วย", paidCalls.filter((a) => !a.includes("cashSource")).length, 0);

  // ── ฝั่งเซิร์ฟเวอร์: ดึงตัวประกอบ payload ตัวจริงจากตัวเก็บงานค้างมารัน ──
  const buildPush = (() => {
    const st = SWEEP.indexOf("const round2 =");
    const fnAt = SWEEP.indexOf("function buildPushPayload(po, branchById, paidCtx) {");
    if (st < 0 || fnAt < 0) throw new Error("ไม่เจอตัวประกอบ payload ใน sliptrack-sweep.js");
    let d = 0, started = false, en = -1;
    for (let i = fnAt; i < SWEEP.length; i++) {
      if (SWEEP[i] === "{") { d++; started = true; }
      else if (SWEEP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    return new Function(SWEEP.slice(st, en) + " return buildPushPayload;")();
  })();
  const BR = { 1: { name: "ครัวกลาง" }, 8: { name: "กาญจนบุรี" } };
  const PO_ = {
    id: 1, po_number: "PO-TEST", from_branch_id: 8, branch_id: 1,
    received_at: "2026-09-01T00:00:00.000Z",
    items: [{ name: "หมู", qty: 2, unit: "กก.", price_per_unit: 100 }],
    subtotal: 200, vat: 0, total: 200,
    payment_at: "2026-09-05T05:00:00.000Z", payment_note: "โอนแล้ว", cash_source: "เงินในตู้เซฟ",
  };
  const paidBuilt = buildPush(PO_, BR, { paidAt: PO_.payment_at, slipUrl: null, note: PO_.payment_note, cashSource: PO_.cash_source });
  ck("ตัวเก็บงานค้างบนเซิร์ฟเวอร์ส่งแหล่งเงินไปด้วย", paidBuilt.payload && paidBuilt.payload.cash_source, "เงินในตู้เซฟ");
  ck("ใบที่ยังไม่จ่าย ไม่มีแหล่งเงินติดไปด้วย", "cash_source" in (buildPush(PO_, BR, null).payload || {}), false);

  // คอลัมน์ใหม่ยังไม่ถูกเพิ่ม = ห้ามทำให้ของเดิมพัง (PostgREST ปฏิเสธทั้งคำขอ)
  ok_("ยังไม่ได้เพิ่มคอลัมน์ cash_source แล้วตัวเก็บงานค้างต้องไม่ตายทั้งตัว",
    SWEEP.includes('const cols = COLS_BASE + ",cash_source";') &&
    SWEEP.includes("candidates = await sbFetch(") &&
    SWEEP.includes("select=$" + "{COLS_BASE}&$" + "{filter}"));
  // ── ตอบ 2xx ไม่ได้แปลว่ารับครบ ────────────────────────────────────────
  // ฝั่งบัญชีทิ้งค่าที่เขาไม่รู้จักแล้วบอกไว้ใน warnings — เคยหายไป 7 ฟิลด์
  // เพราะฝั่งเราไม่เคยอ่านตัวตอบเลย ดึงบรรทัดที่แกะค่ามารันจริง
  // ถอดโค้ดออกแล้วต้อง "สอบตก" ให้อ่านออก ไม่ใช่โยน exception แล้วตัวตรวจตายทั้งตัว
  // (ตัวพิสูจน์ด่านมองหาบรรทัด ❌ ถ้าโปรแกรมพังก่อนพิมพ์ มันจะนับว่าด่านนี้จับไม่ได้)
  const warnLine = APP.split("\n").find((l) => l.startsWith("const slipWarnings="));
  ok_("ยังมีตัวแกะคำเตือนจากตัวตอบของฝั่งบัญชีอยู่", !!warnLine);
  const parseWarn = warnLine ? new Function(warnLine.trim() + " return slipWarnings;")() : () => null;
  ck("แกะคำเตือนจากตัวตอบได้ และคัดค่าว่างทิ้ง", parseWarn({ warnings: ["ก", "", null, "ข"] }), ["ก", "ข"]);
  ck("ไม่มีคำเตือน = รายการว่าง ไม่ใช่พัง",
    [parseWarn({}), parseWarn(null), parseWarn(undefined), parseWarn({ warnings: "พัง" }), parseWarn({ warnings: [] })],
    [[], [], [], [], []]);
  ok_("คนกดจ่ายต้องรู้ทันทีถ้าบัญชีรับไม่ครบ",
    APP.includes("if(r&&r.warnings&&r.warnings.length)setTimeout(()=>alert(\"⚠️ ระบบบัญชีรับข้อมูลบางส่วนไม่ได้"));
  ok_("ตัวเก็บงานค้างบนเซิร์ฟเวอร์ก็ต้องเห็นคำเตือนเหมือนกัน",
    SWEEP.includes("const warnings = Array.isArray(done && done.warnings) ? done.warnings.filter(Boolean) : [];"));
  // ทุกทางที่คุยกับบัญชีต้องอ่านตัวตอบ ไม่ใช่แค่ทาง PO — ไล่จากจุด fetch จริง
  // (ท่อปิดกะคือท่อที่สำคัญที่สุด ยอดขายรายวันไปออกเอกสารภาษี)
  const slipCalls = APP.split("\n").filter((l) => l.includes('fetch("/api/sliptrack-push"')).length;
  ck("ยังมีทางคุยกับบัญชีครบทุกทาง", slipCalls, 4);
  ck("ทุกทางอ่านคำเตือนจากตัวตอบ",
    ["slipWarnings(done)", "slipWarnings(vd)", "slipWarnings(d)", "slipWarnings(r.reply)"].filter((x) => !APP.includes(x)), []);
  // จอปิดกะเคยขึ้นเขียวล้วนแม้บัญชีจะทิ้งค่าไปบางส่วน = คนปิดกะเชื่อว่าเรียบร้อย
  ok_("จอปิดกะแยกสถานะ \"ส่งแล้วแต่ไม่ครบ\" ออกจากเขียวล้วน",
    APP.includes("const warnRows=rows.filter(r=>r.ok&&slipWarnings(r.reply).length);") &&
    APP.includes("const okAll=!fatal&&bad.length===0&&rows.length>0&&warnRows.length===0;") &&
    APP.includes("ส่งยอดขายแล้ว แต่บางค่าไม่ถูกบันทึก"));
  // ── "ข้าม" มีสองแบบ ห้ามเหมารวม ────────────────────────────────────────
  // ไม่มีอะไรต้องลงบัญชี (ย้ายในหน่วยเดียวกัน/ยอดศูนย์) = จบ
  // ลงไม่ได้เพราะข้อมูลไม่พร้อม (หาสาขาไม่เจอ) = ยังไม่จบ ต้องตามต่อ
  // เดิมเหมาเป็น 'skip' หมด แล้ว 'skip' ถูกนับว่าเรียบร้อย ⟹ ใบหลุดจากทุกตะแกรงพร้อมกัน
  const grabFn = (src, head, name) => {
    const st = src.indexOf(head);
    if (st < 0) return null;
    let d = 0, started = false, en = -1;
    for (let i = st; i < src.length; i++) {
      if (src[i] === "{") { d++; started = true; }
      else if (src[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    const done = src.split("\n").find((l) => l.trim().startsWith("const SLIP_SKIP_DONE"));
    return new Function((done || "") + "\n" + src.slice(st, en) + "\n return " + name + ";")();
  };
  const slipFlag = grabFn(APP, "function slipSyncFlag(res){", "slipSyncFlag");
  ok_("ยังมีตัวตัดสินสถานะการลงบัญชีอยู่", !!slipFlag);
  if (slipFlag) {
    ck("ยิงสำเร็จ = เรียบร้อย", slipFlag({ ok: true }), "ok");
    ck("ไม่มีอะไรต้องลงบัญชีจริงๆ = จบได้",
      [slipFlag({ skipped: "same-branch" }), slipFlag({ skipped: "zero-amount" })], ["skip", "skip"]);
    // ตัวชี้ขาดของบั๊กนี้: หาสาขาไม่เจอไม่ใช่ "ไม่มีอะไรต้องทำ" มันคือ "ยังทำไม่ได้"
    ck("ลงบัญชีไม่ได้เพราะข้อมูลไม่พร้อม = ต้องตามต่อ ห้ามนับว่าเสร็จ",
      [slipFlag({ skipped: "unknown-branch" }), slipFlag({ skipped: "no-po" })], ["failed", "failed"]);
    ck("ไม่มีผลลัพธ์/ยิงพลาด = ตามต่อ", [slipFlag(null), slipFlag({ ok: false })], ["failed", "failed"]);
  }

  // ตะแกรงเดียวที่ป้ายค้างซิงค์ + ตัวซ่อมอัตโนมัติ + ตัวกวาดเซิร์ฟเวอร์ ใช้ร่วมกัน
  // ใบที่ยังลงบัญชีไม่ได้ต้องกลับเข้าตะแกรงนี้ทุกใบ ไม่งั้นคือเงินหายเงียบ
  const needsSync = (() => {
    const st = APP.indexOf("const poNeedsSlipSync=(p)=>!!p");
    if (st < 0) return null;
    const en = APP.indexOf(";", APP.indexOf('p.status==="cancelled"', st)) + 1;
    return new Function(APP.slice(st, en) + " return poNeedsSlipSync;")();
  })();
  ok_("ยังมีตะแกรงตามใบที่ยังไม่เข้าบัญชีอยู่", !!needsSync);
  if (slipFlag && needsSync) {
    const missed = [];
    for (const reason of ["same-branch", "zero-amount", "unknown-branch", "no-po"]) {
      const row = { sliptrack_sync: slipFlag({ skipped: reason }), received_at: "2026-09-01T00:00:00.000Z", status: "paid" };
      const chased = !!needsSync(row);
      const should = !["same-branch", "zero-amount"].includes(reason);
      if (chased !== should) missed.push(reason + ": ตาม=" + chased + " ควรตาม=" + should);
    }
    ck("ใบที่ลงบัญชีไม่ได้ ต้องกลับเข้าตะแกรงตามงานค้างทุกใบ", missed, []);
  }

  // ตัวกวาดบนเซิร์ฟเวอร์ตัดสินคนละที่กับหน้าเว็บ — ถ้าสองฝั่งคิดไม่ตรงกัน
  // ฝั่งหนึ่งจะตามใบที่อีกฝั่งตีตราว่าจบไปแล้ว (หรือแย่กว่า: ไม่มีใครตามเลย)
  const srvFlag = (() => {
    const ln = SWEEP.split("\n").find((l) => l.startsWith("const flagForSkip ="));
    const done = SWEEP.split("\n").find((l) => l.startsWith("const SLIP_SKIP_DONE ="));
    return ln && done ? new Function(done + "\n" + ln + "\n return flagForSkip;")() : null;
  })();
  ok_("ตัวกวาดบนเซิร์ฟเวอร์มีตัวตัดสินของตัวเอง", !!srvFlag);
  if (slipFlag && srvFlag) {
    ck("เซิร์ฟเวอร์กับหน้าเว็บตัดสินเหมือนกันทุกเหตุผล",
      ["same-branch", "zero-amount", "unknown-branch", "no-po"].filter((r) => srvFlag(r) !== slipFlag({ skipped: r })), []);
  }
  ok_("ตัวกวาดใช้ตัวตัดสิน ไม่ใช่ตีตรา skip ตายตัว",
    SWEEP.includes("const f = flagForSkip(built.skip);") && SWEEP.includes("const f = flagForSkip(paidBuilt.skip);"));

  // ── ฟิลด์ที่หน้าเว็บส่ง ต้องรอดผ่านพร็อกซีทุกตัว ──────────────────────
  // /api/sliptrack-push ไม่ได้ "ส่งต่อ body" แต่ประกอบ payload ใหม่จากรายการที่อนุญาต
  // ฟิลด์ที่ไม่มีบรรทัดคัดลอกจะถูกทิ้งเงียบๆ บนเซิร์ฟเวอร์เราเอง ก่อนออกไปถึงบัญชี
  // ไม่มี error ไม่มี warning (บัญชีเตือนเฉพาะฟิลด์ที่ "ไม่รู้จัก" ไม่ใช่ฟิลด์ที่ไม่เคยได้รับ)
  // ด่านเดิมตรวจ "หน้าเว็บส่ง" ✅ กับ "ตัวกวาดส่ง" ✅ แต่ไม่ตรวจตรงกลาง
  // ⟹ cash_source หายทั้งที่ 565 ข้อเขียวหมด นี่คือด่านที่ควรมีตั้งแต่แรก
  const payloadKeys = (src, head) => {
    const st = src.indexOf(head);
    if (st < 0) return null;
    let d = 0, started = false, en = -1;
    for (let i = st; i < src.length; i++) {
      if (src[i] === "{") { d++; started = true; }
      else if (src[i] === "}") { d--; if (started && d === 0) { en = i; break; } }
    }
    return [...new Set([...src.slice(st, en).matchAll(/payload\.([A-Za-z_]+)\s*=[^=]/g)].map((m) => m[1]))].sort();
  };
  const cliKeys = payloadKeys(APP, "async function pushPOToSlipTrack(po, branches, opts={}){");
  const proxyKeys = payloadKeys(SLIPPUSH, "export default async function handler(req, res) {");
  ok_("อ่านรายการฟิลด์ได้ทั้งหน้าเว็บและพร็อกซี", !!cliKeys && !!proxyKeys);
  if (cliKeys && proxyKeys) {
    ck("ทุกฟิลด์ที่หน้าเว็บใส่ ต้องมีบรรทัดส่งต่อในพร็อกซี",
      cliKeys.filter((k) => !proxyKeys.includes(k)), []);
    ok_("พร็อกซีส่งต่อแหล่งเงินจริง", proxyKeys.includes("cash_source"));
  }

  // ── กดจ่ายแล้วต้องเคลียร์ธงซิงค์ พร้อมกับเปลี่ยนสถานะในคำสั่งเดียว ──
  // ตอนรับของธงถูกเขียนเป็น 'ok' ไปแล้ว · ขั้นยืนยันจ่ายยิงแบบไม่รอผล
  // ถ้าคำขอนั้นหลุด ธงยังเป็น 'ok' ซึ่งทั้งสามตะแกรงอ่านว่าเรียบร้อย ⟹ เงินจริงไม่ถึงบัญชี
  // cancelPO ทำถูกอยู่แล้ว ตอนจ่ายเงินเพิ่งตามมาทีหลัง
  ok_("กดจ่ายเงินแล้วเคลียร์ธงซิงค์ให้ตัวตามงานค้างเห็น",
    APP.includes("cash_source:cashSource||null,sliptrack_sync:null,updated_at:now};"));
  ok_("ยกเลิกบิลก็ยังเคลียร์ธงเหมือนเดิม",
    APP.includes("...(wasReceived&&{sliptrack_sync:null})"));

  ok_("จอปิดกะบอกด้วยว่าบัญชีไม่รับอะไรไปบ้าง",
    APP.includes("⚠️ ระบบบัญชีไม่รับ: {slipWarnings(r.reply).join(\" · \")}"));
  ok_("ยังไม่ได้เพิ่มคอลัมน์ cash_source แล้วยังบันทึกการจ่ายเงินได้",
    APP.includes("const {cash_source,...rest}=patch;") &&
    APP.includes('await api.patchPOIfStatus(po.id,"awaiting_payment",rest);'));
}

// ══════════════════════════════════════════════════════════════════════════
// หน้าเว็บหลักห้ามถูกแจกแบบ "เก่าค้าง"
// เหตุจริง 10 ก.ย. 69: index.html ตั้ง s-maxage=300 + stale-while-revalidate=3600
// ⟹ CDN แจกหน้าเก่าได้อีกถึง 1 ชม. หลัง deploy · ร้านรันโค้ดเก่าโดยไม่มีใครรู้
// อาการที่เจอ: แก้บั๊กส่งซ้ำแล้ว deploy แล้ว แต่ iPad ที่ร้านยังเป็นเหมือนเดิม
// (ตรวจหัวข้อจริงตอนนั้น Age: 1203 = หน้าที่ได้รับเก่า 20 นาที)
// ไฟล์ใน /assets มีแฮชในชื่อ จึงแคชยาวได้ตามเดิม — ตัวที่ห้ามค้างคือหน้าที่ชี้ไปหามัน
// ══════════════════════════════════════════════════════════════════════════
section("หน้าเว็บหลักต้องไม่ถูกแจกแบบเก่าค้าง");
{
  const rules = (VERCEL.headers || []);
  const htmlRule = rules.find((r) => /\(\?!api\//.test(String(r.source || "")));
  ok_("ยังมีกติกาแคชของหน้าเว็บหลักอยู่", !!htmlRule);
  if (htmlRule) {
    const cc = String(((htmlRule.headers || []).find((h) => /cache-control/i.test(h.key)) || {}).value || "");
    ck("หน้าเว็บหลักต้องไม่ให้ CDN เก็บไว้แจกเอง (s-maxage)", /s-maxage/i.test(cc), false);
    ck("หน้าเว็บหลักต้องไม่แจกของเก่าระหว่างรอของใหม่ (stale-while-revalidate)", /stale-while-revalidate/i.test(cc), false);
    ok_("หน้าเว็บหลักต้องถามใหม่ทุกครั้ง", /max-age=0/.test(cc) && /must-revalidate|no-cache|no-store/i.test(cc));
  }
  // ไฟล์ที่มีแฮชในชื่อ เปลี่ยนเนื้อ = เปลี่ยนชื่อ จึงแคชยาวได้ ไม่มีทางค้างผิดตัว
  const assetRule = rules.find((r) => String(r.source || "").startsWith("/assets/"));
  ok_("ไฟล์ที่มีแฮชในชื่อยังแคชยาวได้เหมือนเดิม",
    !!assetRule && /immutable/i.test(String(((assetRule.headers || []).find((h) => /cache-control/i.test(h.key)) || {}).value || "")));
}

// ══════════════════════════════════════════════════════════════════════════
// เก็บเงิน: ถามวิธีจ่ายหลังกดยืนยัน แล้วเงินสดต้องกรอกยอดที่รับมา
// ══════════════════════════════════════════════════════════════════════════
section("ป็อปอัพเก็บเงิน + เงินทอน");
{
  // วิธีจ่ายต้องมาเป็น "ค่าที่กด" ไม่ใช่ค่าจาก state — กดปุ๊บตัดเงินปั๊บในจังหวะเดียว
  // ถ้าอ่านจาก state จะได้ค่าเก่า (React อัปเดตทีหลัง) ⟹ บันทึกวิธีจ่ายผิด
  // ผลคือจ่ายพร้อมเพย์แต่ระบบนับเป็นเงินสด → เงินในลิ้นชักเกินจริง หาไม่เจอตอนปิดกะ
  ok_("ตัวปิดบิลรับวิธีจ่ายเป็นค่าที่กดมา (พร้อมรายการแบ่งจ่ายถ้ามี)", APP.includes("async function checkOut(methodArg,opts){"));
  ok_("ค่าที่กดชนะค่าใน state เสมอ", APP.includes("const pm=methodArg||payMethod;"));
  // บิลใบเดียวจ่ายได้หลายช่องทางแล้ว (แบ่งจ่าย) จุดที่เกี่ยวกับเงินสดจึงผูกกับ "ยอดส่วนที่เป็นเงินสด"
  // ไม่ใช่ "วิธีจ่ายของทั้งบิล" อีกต่อไป — แต่ต้องยังใช้ค่าที่กดมา ไม่ใช่ state ค้างในจอ
  ck("ทุกที่ในตัวปิดบิลใช้ค่าที่กด ไม่ใช่ state",
    ["const pm=methodArg||payMethod;", "payment_method:pmCol,updated_at", "const pmCol=payParts?", "if(cashPart>0&&shift)", "payment_method:pmCol,payments:paymentsCol,cash_received"]
      .filter((x) => !APP.includes(x)), []);
  ok_("ป็อปอัพส่งวิธีจ่ายที่กดเข้าไปจริง",
    APP.includes("onPay={async(m)=>{await checkOut(m);setShowPay(false);}}") &&
    APP.includes("setAskPay(null);onPay(m.v);") && APP.includes('onPay("cash");'));

  // เงินสดต้องกรอกยอดที่รับมา และต้องไม่น้อยกว่ายอดบิล — ดึงเงื่อนไขจริงมารัน
  const enough = (() => {
    const ln = APP.split("\n").find((l) => l.trim().startsWith("const enoughCash="));
    return ln ? new Function("cashRcv", "dueNow", ln.trim() + " return enoughCash;") : null;
  })();
  ok_("ยังมีเงื่อนไขกันเงินสดไม่พอ", !!enough);
  if (enough) {
    ck("ไม่กรอกอะไรเลย = กดยืนยันไม่ได้", enough("", 119), false);
    ck("กรอกน้อยกว่ายอดบิล = กดยืนยันไม่ได้", [enough("100", 119), enough("118.99", 119)], [false, false]);
    ck("กรอกพอดี/เกิน = กดยืนยันได้", [enough("119", 119), enough("500", 119)], [true, true]);
  }
  ok_("เงินสดกดยืนยันไม่ได้จนกว่าเงินจะพอ", APP.includes("disabled={!enoughCash||saving}"));

  // ป็อปอัพเงินทอนต้องอยู่ที่จอแม่ — จอโต๊ะปิดตัวเองทันทีที่ปิดบิลเสร็จ
  // ถ้าอยู่ในจอโต๊ะ มันจะถูกถอดออกไปพร้อมกัน แล้วพนักงานไม่เห็นยอดทอนเลย
  ok_("ยอดทอนถูกส่งออกไปก่อนปิดจอโต๊ะ",
    APP.includes('if(cashPart>0&&typeof onCashChange==="function"){'));
  ok_("จอแม่เป็นคนถือป็อปอัพเงินทอน",
    APP.includes("const[changeDlg,setChangeDlg]=useState(null);") && APP.includes("onCashChange={setChangeDlg}"));

  // ส่วนลดรายเมนูต้องไปถึงกระดาษทุกใบ ไม่ใช่เฉพาะใบที่ปิดบิลแล้ว
  // ตัวเรนเดอร์รองรับอยู่แล้วทั้งสองทาง สิ่งที่เคยขาดคือไม่มีใครส่งข้อมูลไปให้
  ok_("ส่วนลดรายเมนูคำนวณที่เดียว ใช้ร่วมทุกใบ",
    APP.includes("const itemsWithDisc=useMemo(()=>items.map(clean).map((i,idx)=>{"));
  ck("ทุกใบที่พิมพ์พกส่วนลดรายเมนูไปด้วย",
    ["smartPrintReceipt({...(existingOrder||{}),items:itemsWithDisc,", "items:itemsWithDisc,subtotal,discount:round2(manualDiscount)"]
      .filter((x) => !APP.includes(x)), []);
  ok_("ตัวพิมพ์ราสเตอร์ยังพิมพ์บรรทัดส่วนลดรายเมนู",
    APP.includes('if(disc>0)L.push({t:"   ลด "+(i.item_discount_type==="percent"?i.item_discount_value+"%":bahtR(i.item_discount_value)),size:18});'));
}

// ══════════════════════════════════════════════════════════════════════════
// จอต้องไม่ค้างจนต้องฆ่าแอป
// เหตุจริง 10 ก.ย. 69: จอโต๊ะหยุดรับการแตะเป็นบางจังหวะ ปิดจอไม่ได้ ต้องปิดแอปเปิดใหม่
// ทางที่ทำให้เกิดได้จริงมีสามทาง แต่ละทางปิดแยกกัน
// ══════════════════════════════════════════════════════════════════════════
section("จอต้องไม่ค้างจนต้องฆ่าแอป");
{
  // ① ตัวกันซูมสองนิ้ว: iOS ยิง touchcancel ไม่ใช่ touchend เมื่อระบบยึดนิ้วไป
  // ดักแต่ touchend = ตัวบล็อกค้างผูกกับ document ถาวร แล้วกิน touchmove ของทุกลำดับ
  // ที่มีนิ้วเกินหนึ่ง ⟹ วางนิ้วโป้งประคองเครื่องแล้วแตะสั่งอาหาร การแตะไม่กลายเป็นคลิก
  ok_("ตัวกันซูมถอดตัวบล็อกตอนระบบยึดนิ้วไปด้วย", HTML.includes('document.addEventListener("touchcancel", unblock, { passive: true });'));
  ok_("ถอดด้วยตัวเดียวกันทั้ง touchend และ touchcancel",
    HTML.includes('document.addEventListener("touchend", unblock, { passive: true });') &&
    HTML.includes("var unblock = function (e) {"));
  ok_("กลับมาจากสลับแอปแล้วถอดตัวบล็อกทิ้งเสมอ",
    HTML.includes('if (document.visibilityState === "visible") document.removeEventListener("touchmove", blockPinch);'));

  // ② กล่องเตือนของเบราว์เซอร์บล็อกเธรดหลัก — บนไอแพดที่เปิดจากไอคอนหน้าจอโฮม
  // มีจังหวะที่มันไม่ขึ้นให้เห็นแต่ยังล็อกไว้ ⟹ ทั้งจอตายจนกว่าจะฆ่าแอป
  ok_("มีกล่องเตือนแบบไม่บล็อกเธรด", APP.includes("function notifyDlg(msg){"));
  ok_("ตัวแจ้ง error กลางก็เลิกบล็อกแล้ว",
    APP.includes("function showErr(prefix,err){console.error(prefix,err);notifyDlg(prefix+\": \"+friendlyError(err));}"));
  // ตัวชี้ขาด: ในจอที่พนักงานกดรัวตอนขาย ต้องไม่เหลือกล่องที่บล็อกเธรดเลยสักจุด
  {
    const lines = APP.split("\n");
    const st = lines.findIndex((l) => l.startsWith("function POSOrderPanel({table,existingOrder,"));
    const en = lines.findIndex((l, i) => i > st && l.startsWith("const PAY_METHODS="));
    const left = (st >= 0 && en > st)
      ? lines.slice(st, en).filter((l) => /(^|[^A-Za-z0-9_.$])alert\(/.test(l)).length
      : -1;
    ck("จอโต๊ะ/จ่ายเงินต้องไม่เหลือกล่องเตือนที่บล็อกเธรด", left, 0);
  }

  // ③ รอสิ่งที่ไม่มีวันมา: ปิดบิลค้างกลางทาง ลูกค้ายืนรอหน้าเคาน์เตอร์
  ok_("รอฟอนต์มีเพดานเวลา", APP.includes("new Promise(r=>setTimeout(r,2500))"));
  ok_("โหลดรูปใบเสร็จมีเพดานเวลา",
    APP.includes('const t=setTimeout(()=>rej(new Error("โหลดรูปนานเกินไป")),6000);') &&
    APP.includes("x.onload=()=>{clearTimeout(t);res(x);};"));
}

// ══════════════════════════════════════════════════════════════════════════
// ใบปิดกะต้องออกเครื่องพิมพ์ใบเสร็จ ไม่ใช่หน้าต่างพิมพ์ A4
// เหตุจริง 10 ก.ย. 69: ปิดกะบนไอแพดแล้วขึ้นหน้าต่างพิมพ์ของ iOS "ไม่มีเครื่องพิมพ์ที่เลือก"
// ใบปิดกะไม่เคยออกเลย เพราะเปิดแต่หน้าต่างเบราว์เซอร์ ไม่เคยต่อเข้าตัวพิมพ์ (agent)
// ══════════════════════════════════════════════════════════════════════════
section("ใบปิดกะออกเครื่องพิมพ์ใบเสร็จ");
{
  const grabFn2 = (head) => {
    const st = APP.indexOf(head);
    if (st < 0) return null;
    let d = 0, started = false, en = -1;
    for (let i = st + head.length - 1; i < APP.length; i++) {  // นับจากปีกกาของตัวฟังก์ชัน ไม่ใช่ของลายเซ็น ({...})
      if (APP[i] === "{") { d++; started = true; }
      else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    return APP.slice(st, en);
  };
  const bahtLn = APP.split("\n").find((l) => l.startsWith("function bahtR(n){"));
  const emojiLn = APP.split("\n").find((l) => l.startsWith("function stripEmoji(s){"));
  const body = grabFn2("function buildZReportLines({shift,totals,branch,user,note,reprint=false,mismatches=[]}){");
  ok_("ยังมีตัวสร้างใบปิดกะแบบบรรทัด", !!(body && bahtLn && emojiLn));
  if (body && bahtLn && emojiLn) {
    const build = new Function(
      bahtLn + "\n" + emojiLn + "\nconst fmtDT=()=>\"10/09/2569 23:02\";\n" + body + "\nreturn buildZReportLines;"
    )();
    // ตัวเลขชุดจริงจากจอปิดกะในรูปที่เจ้าของส่งมา (กะ #9 สาขา 8)
    const T = {
      orderCount: 14, itemQty: 78, avgBill: 553.21, gross: 10113, disc: 2365.5, discPct: 23.39,
      promo: 0, svc: 0, vat: 506.84, vatIncluded: true, roundAdj: -2.5, totalSales: 7745,
      totalCash: 6834, totalTransfer: 535, totalCard: 0, totalOther: 376,
      openingCash: 2000, salesCash: 6834, payIn: 0, payOut: 0, drops: 0, refunds: 0, expected: 8834,
      cancelCount: 1, cancelAmt: 119, cancelList: [{ id: 71, table: "B7", total: 119, by: "มะลิ" }],
      openCount: 1, openAmt: 299, openList: [{ id: 72, table: "A3", total: 299 }],
      actual: 8800, diff: -34,
    };
    const L = build({ shift: { id: 9, opened_at: "2026-09-09T16:28:00Z" }, totals: T, branch: { name: "กาญจนบุรี The River" }, user: { name: "มะลิ" }, note: "⚠️ ปิดกะทั้งที่ยังมีโต๊ะค้าง 1 โต๊ะ" });
    const txt = L.map((x) => [x.t, x.l, x.r].filter(Boolean).join(" ")).join("\n");
    // ตัวเลขเงินทุกตัวที่คนตรวจต้องใช้ ต้องอยู่บนกระดาษ — หายตัวเดียว = กระทบยอดไม่ได้
    ck("ตัวเลขเงินหลักอยู่บนใบครบ",
      ["฿7745.00", "฿8834.00", "฿8800.00", "฿6834.00", "฿535.00", "฿376.00", "-฿2365.50", "฿506.84"].filter((v) => !txt.includes(v)), []);
    ck("หัวข้อครบทุกส่วน",
      ["ยอดขาย", "โครงสร้างยอด", "แยกตามวิธีชำระ", "ลิ้นชัก", "นับจริง", "รายการที่ต้องตรวจ"].filter((h) => !txt.includes(h)), []);
    ok_("เงินขาดต้องบอกว่า \"ขาด\" พร้อมยอด", L.some((x) => x.l === "ขาด" && x.r === "-฿34.00"));
    ok_("บิลที่ยกเลิกต้องบอกว่าใครยกเลิก", txt.includes("B7 ฿119.00 (มะลิ)"));
    ok_("โต๊ะที่ยังไม่ปิดบิลต้องขึ้นบนใบ", txt.includes("A3 ฿299.00"));
    // ฟอนต์ที่ใช้ทำภาพใบไม่มีรูปอีโมจิ — พิมพ์ออกมาเป็นกล่องสี่เหลี่ยม อ่านไม่ออก
    ck("ห้ามมีอีโมจิบนใบ (พิมพ์ออกมาเป็นกล่องสี่เหลี่ยม)",
      L.map((x) => [x.t, x.l, x.r].join("")).filter((s) => /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}]/u.test(s)).length, 0);
  }
  // ทางส่งพิมพ์: ไอแพดต้องไปทางตัวพิมพ์ ไม่ใช่หน้าต่างพิมพ์
  const pz = grabFn2("function printZReport(args){") || "";
  ok_("ไอแพดส่งใบปิดกะเข้าตัวพิมพ์ ไม่ใช่หน้าต่างพิมพ์",
    pz.includes("getReceiptPrinters(prs)") && pz.includes('cmdDesc(p,"pj",{at,b64})') && pz.includes("escposSlipRaster(buildZReportLines(args),576)"));
  ok_("เดสก์ท็อปยังเปิดหน้าต่างพิมพ์ทันทีตอนกด (ไม่โดนบล็อกป็อปอัพ)",
    pz.includes("if(!isHttps){printZReportWindow(args);return;}"));
  ok_("ยังไม่ติ๊กเครื่องพิมพ์ใบเสร็จ ต้องบอกให้รู้ ไม่ใช่เงียบ", pz.includes("ใบปิดกะไม่ได้พิมพ์"));
  ok_("การพิมพ์ต้องไม่ขวางการปิดกะ", pz.includes("(async()=>{"));
}

// ══════════════════════════════════════════════════════════════════════════
// พิมพ์ใบปิดกะซ้ำ: ต้องเป็นตัวเลขชุดเดียวกับที่เซ็นรับไปตอนปิดกะ
// ══════════════════════════════════════════════════════════════════════════
section("พิมพ์ใบปิดกะซ้ำ");
{
  const grabF = (head) => {
    const st = APP.indexOf(head); if (st < 0) return null;
    let d = 0, started = false, en = -1;
    for (let i = st + head.length - 1; i < APP.length; i++) {
      if (APP[i] === "{") { d++; started = true; }
      else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    return APP.slice(st, en);
  };
  // สูตรเดียวทั้งระบบ — ถ้ามีสองชุด ใบพิมพ์ซ้ำจะออกตัวเลขคนละชุดกับใบจริงสักวัน
  ok_("ตอนปิดกะใช้สูตรยอดกะตัวเดียวกับตอนพิมพ์ซ้ำ",
    APP.includes("const totals=useMemo(()=>computeShiftTotals({movements,orders,actualCash,cancelled,openBills}),[movements,orders,actualCash,cancelled,openBills]);"));
  const r2Ln = APP.split("\n").find((l) => /^const round2\s*=/.test(l) || /^function round2\(/.test(l));
  const cst = grabF("function computeShiftTotals({movements,orders,actualCash,cancelled,openBills}){");
  const lsr = grabF("async function loadShiftTotalsForReprint(shift,branchId){");
  ok_("ยังมีตัวประกอบยอดของกะที่ปิดแล้ว", !!(r2Ln && cst && lsr));
  if (r2Ln && cst && lsr) {
    const mk = (orders, moves) => new Function("api", r2Ln + "\n" + cst + "\n" + lsr + "\nreturn loadShiftTotalsForReprint;")({
      getCashMovements: async () => moves,
      getPOSOrdersSince: async () => orders,
    });
    const H = (h) => "2026-09-10T" + String(h).padStart(2, "0") + ":00:00.000Z";
    const SHIFT = { id: 9, opened_at: H(3), closed_at: H(13), opening_cash: 400, closing_cash: 500,
      expected_cash: 700, cash_diff: -200, total_sales: 300, total_cash: 300, total_transfer: 0, total_card: 0,
      total_other: 0, total_pay_in: 0, total_pay_out: 0, total_drop: 0, order_count: 2, username: "มะลิ" };
    const ORDERS = [
      { id: 1, status: "paid", payment_method: "cash", total: 100, subtotal: 100, created_at: H(4), updated_at: H(5), items: [{ qty: 2 }] },
      { id: 2, status: "paid", payment_method: "cash", total: 200, subtotal: 200, created_at: H(6), updated_at: H(7), items: [{ qty: 3 }] },
      // ยังเปิดอยู่ตอนปิดกะ แล้วไปจ่ายในกะถัดไป — ห้ามไหลเข้ามาเป็นยอดขายของกะนี้
      { id: 3, status: "paid", payment_method: "cash", total: 999, subtotal: 999, created_at: H(12), updated_at: H(15), table_number: "A3", items: [] },
      // เปิดหลังปิดกะแล้ว — ไม่ใช่ของกะนี้เลย
      { id: 4, status: "paid", payment_method: "cash", total: 555, subtotal: 555, created_at: H(14), updated_at: H(14), items: [] },
    ];
    const MOVES = [{ type: "opening", amount: 400 }, { type: "sale", amount: 100, order_id: 1 }, { type: "sale", amount: 200, order_id: 2 }, { type: "closing", amount: 500 }];

    const ok1 = await mk(ORDERS, MOVES)(SHIFT, 8);
    ck("ข้อมูลตรงกับตอนปิดกะ = ไม่มีส่วนที่ไม่ตรง", ok1.mismatches, []);
    ck("บิลที่ไปจ่ายในกะถัดไป/เปิดหลังปิดกะ ห้ามนับเป็นยอดของกะนี้", [ok1.totals.totalSales, ok1.totals.orderCount], [300, 2]);
    ok_("บิลที่ยังเปิดอยู่ตอนปิดกะ ต้องขึ้นเป็นโต๊ะค้าง", (ok1.totals.openList || []).some((x) => x.id === 3));
    ck("ยอดนับเงินปิดกะไม่ถูกนับเป็นเงินเข้าลิ้นชัก", ok1.totals.expected, 700);

    // มีคนแก้บิลเก่าหลังปิดกะ — ใบพิมพ์ซ้ำต้องใช้ตัวเลขที่เซ็นรับไปแล้ว และต้องบอกว่าไม่ตรง
    const EDITED = ORDERS.map((o) => o.id === 2 ? { ...o, total: 250 } : o);
    const ok2 = await mk(EDITED, MOVES)(SHIFT, 8);
    ck("มีคนแก้บิลหลังปิดกะ ใบพิมพ์ซ้ำยังใช้ตัวเลขตอนปิดกะ", ok2.totals.totalSales, 300);
    ok_("และต้องบอกว่ายอดคำนวณวันนี้ไม่ตรง ห้ามเงียบ", ok2.mismatches.some((m) => m.startsWith("ยอดขายสุทธิ: ตอนปิดกะ 300")));
    ck("ส่วนต่างบนใบพิมพ์ซ้ำ = ค่าที่บันทึกตอนปิดกะ", [ok2.totals.actual, ok2.totals.expected, ok2.totals.diff], [500, 700, -200]);
  }
  // ตัวใบ: ต้องตีตราว่าเป็นใบพิมพ์ซ้ำ และบอกเวลาปิดกะจริง ไม่ใช่เวลาที่กดพิมพ์
  const bz = grabF("function buildZReportLines({shift,totals,branch,user,note,reprint=false,mismatches=[]}){");
  const bLn = APP.split("\n").find((l) => l.startsWith("function bahtR(n){"));
  const eLn = APP.split("\n").find((l) => l.startsWith("function stripEmoji(s){"));
  if (bz && bLn && eLn) {
    const build = new Function(bLn + "\n" + eLn + "\nconst fmtDT=(d)=>d?\"ปิดจริง:\"+d:\"ตอนนี้\";\n" + bz + "\nreturn buildZReportLines;")();
    const L = build({ shift: { id: 9, opened_at: "o", closed_at: "2026-09-10T16:02", username: "มะลิ" }, totals: {}, branch: { name: "x" }, user: { name: "ผู้จัดการ" }, reprint: true, mismatches: ["ยอดขายสุทธิ: ตอนปิดกะ 300 · คำนวณวันนี้ 350"] });
    const txt = L.map((x) => [x.t, x.l, x.r].filter(Boolean).join(" ")).join("\n");
    ok_("ใบพิมพ์ซ้ำตีตรา \"ใบพิมพ์ซ้ำ\" ให้เห็นชัด", txt.includes("*** ใบพิมพ์ซ้ำ ***"));
    ok_("ใบพิมพ์ซ้ำบอกเวลาปิดกะจริง ไม่ใช่เวลาที่กดพิมพ์", L.some((x) => x.l === "ปิดกะ" && x.r === "ปิดจริง:2026-09-10T16:02"));
    ok_("หัวใบบอกคนเปิดกะ ไม่ใช่คนกดพิมพ์ซ้ำ", txt.includes("กะ #9 · เปิดกะโดย มะลิ"));
    ok_("ส่วนที่ไม่ตรงถูกพิมพ์ไว้บนใบ", txt.includes("ยอดคำนวณวันนี้ไม่ตรงกับตอนปิดกะ") && txt.includes("ตอนปิดกะ 300 · คำนวณวันนี้ 350"));
    const L0 = build({ shift: { id: 9, opened_at: "o" }, totals: {}, branch: { name: "x" }, user: { name: "มะลิ" } });
    ok_("ใบปิดกะปกติไม่มีตราใบพิมพ์ซ้ำ", !L0.some((x) => String(x.t || "").includes("ใบพิมพ์ซ้ำ")));
  }
  // ปุ่มในหน้าประวัติกะ
  ok_("หน้าประวัติกะมีปุ่มพิมพ์ใบปิดกะ", APP.includes("🖨 พิมพ์ใบปิดกะ (ใบพิมพ์ซ้ำ)") && APP.includes("reprintZ(s)"));
  ok_("หน้าประวัติกะประกาศ hook ก่อน return ก่อนกำหนด",
    APP.indexOf("const[busyId,setBusyId]=useState(null);") > 0 &&
    APP.indexOf("const[busyId,setBusyId]=useState(null);") < APP.indexOf('if(loading)return <Loading text="โหลดประวัติกะ..."/>;'));
  ok_("ส่วนต่างติดลบในหน้าประวัติกะมีเครื่องหมายลบ", APP.includes("{+s.cash_diff>0?'+':+s.cash_diff<0?'-':''}฿"));
}

// ══════════════════════════════════════════════════════════════════════════
// ติ๊ก "เสิร์ฟแล้ว" รายเมนู — ต้องไม่มีทางไปแตะรายการอาหารหรือยอดเงินในบิล
// ══════════════════════════════════════════════════════════════════════════
section("ติ๊กเสิร์ฟแล้วรายเมนู");
{
  const head = "  setItemServed: async (orderId, lineUid, served, by) => {";
  const st = APP.indexOf(head);
  let fn = null;
  if (st >= 0) {
    let d = 0, started = false, en = -1;
    for (let i = st + head.length - 1; i < APP.length; i++) {
      if (APP[i] === "{") { d++; started = true; }
      else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    const expr = APP.slice(st + "  setItemServed: ".length, en);
    fn = (sb) => new Function("sb", "return (" + expr + ");")(sb);
  }
  ok_("ยังมีตัวบันทึกติ๊กเสิร์ฟ", !!fn);
  if (fn) {
    // ฐานจำลองต้อง "ทำตัวเหมือน PostgREST จริง" — มีเงื่อนไขในคำสั่งก็เช็ค ไม่มีก็เขียนทับเลย
    // เคยพลาดมาแล้ว: ฐานจำลองรุ่นแรกปฏิเสธการเขียนที่ไม่มีตัวกันชน ซึ่งของจริงไม่ทำ
    // พอมีคนถอดตัวกันชนออก ฟังก์ชันเลย throw แทนที่จะเขียนทับให้เห็น → ด่านระเบิดแทนสอบตก
    // (ตัวพิสูจน์ด่านจับได้ตรงนี้เอง — ด่านที่ผ่านเพราะฐานจำลองเข้มกว่าของจริงคือด่านหลอก)
    const sortK = (v) => (v && typeof v === "object" && !Array.isArray(v)) ? Object.keys(v).sort().reduce((a, k) => (a[k] = sortK(v[k]), a), {}) : v;
    const mkDb = (row, raceOnce) => {
      const db = { row: JSON.parse(JSON.stringify(row)), writes: [], raced: false };
      db.sb = async (path, opt) => {
        if (!opt) return [JSON.parse(JSON.stringify(db.row))];
        const body = JSON.parse(opt.body); db.writes.push({ path, body });
        // อีกเครื่องติ๊กแถว u2 ลงไปก่อน "ระหว่าง" ที่เราอ่านค่าไปแล้วแต่ยังไม่ทันเขียน
        if (raceOnce && !db.raced) { db.raced = true; db.row.served_items = { ...(db.row.served_items || {}), u2: { at: "x", by: "ผึ้ง" } }; }
        const m = /served_items=(is\.null|eq\.(.+))$/.exec(path);
        if (m) {   // มีเงื่อนไขค่าเดิม → เช็คแบบ jsonb (ไม่สนลำดับคีย์) เหมือนของจริง
          const cur = db.row.served_items == null ? null : db.row.served_items;
          const ok = m[1] === "is.null" ? cur == null : JSON.stringify(sortK(JSON.parse(decodeURIComponent(m[2])))) === JSON.stringify(sortK(cur));
          if (!ok) return [];
        }
        Object.assign(db.row, body); return [JSON.parse(JSON.stringify(db.row))];   // ไม่มีเงื่อนไข = เขียนทับทันที
      };
      return db;
    };
    // โยน error ต้องกลายเป็น "สอบตก" ที่อ่านออก ไม่ใช่ทำตัวตรวจทั้งตัวตาย
    const run = async (p) => { try { return await p; } catch (e) { return { __err: String((e && e.message) || e) }; } };
    const ROW = { id: 71, status: "pending", served_items: null, updated_at: "t0", items: [{ line_uid: "u1", name: "หมู", qty: 1, price: 99 }, { line_uid: "u2", name: "น้ำแข็ง", qty: 1, price: 20 }] };

    const d1 = mkDb(ROW);
    const r1 = await run(fn(d1.sb)(71, "u1", true, "มะลิ"));
    ok_("ติ๊กแล้วบันทึกลงเฉพาะแถวนั้น", r1 && r1.u1 && r1.u1.by === "มะลิ" && !r1.u2);
    // ตัวชี้ขาดที่สำคัญที่สุด: ติ๊กเสิร์ฟต้องไม่แตะรายการอาหาร/ยอดเงิน/ตัวกันชนตอนปิดบิล
    ck("ติ๊กเสิร์ฟเขียนแค่ served_items อย่างเดียว ไม่แตะ items/ยอด/updated_at",
      [...new Set(d1.writes.flatMap((w) => Object.keys(w.body)))], ["served_items"]);
    ck("รายการอาหารในบิลเหมือนเดิมทุกตัวอักษร", JSON.stringify(d1.row.items), JSON.stringify(ROW.items));
    ck("updated_at ไม่ขยับ (จ่ายเงินหลังติ๊กต้องไม่โดนปฏิเสธ)", d1.row.updated_at, "t0");

    // สองเครื่องติ๊กพร้อมกัน — ติ๊กของอีกเครื่องต้องไม่หาย
    const d2 = mkDb(ROW, true);
    const r2 = await run(fn(d2.sb)(71, "u1", true, "มะลิ"));
    // ตัวชี้ขาดของการชนกัน: ดูที่ "ในฐาน" ไม่ใช่แค่ค่าที่ฟังก์ชันคืนมา — ของที่หายคือของในฐาน
    ck("สองเครื่องติ๊กพร้อมกัน ติ๊กของทั้งสองเครื่องอยู่ครบในฐาน", Object.keys(d2.row.served_items || {}).sort(), ["u1", "u2"]);
    ok_("ตอนชนกัน ต้องอ่านใหม่แล้วลองอีกรอบ ไม่ใช่เขียนทับ", d2.writes.length === 2);

    // เอาติ๊กออก
    const d3 = mkDb({ ...ROW, served_items: { u1: { at: "a", by: "x" }, u2: { at: "b", by: "y" } } });
    const r3 = await run(fn(d3.sb)(71, "u1", false, "มะลิ"));
    ck("เอาติ๊กออกได้ และไม่กระทบแถวอื่น", Object.keys(r3 || {}), ["u2"]);

    // บิลที่ปิดไปแล้ว / แถวที่ถูกยกเลิกไปแล้ว ต้องไม่ถูกเขียน
    const refused = async (row, uid) => { const d = mkDb(row); try { await fn(d.sb)(71, uid, true, "x"); return d.writes.length === 0 ? "ไม่ปฏิเสธ" : "เขียนไปแล้ว"; } catch { return d.writes.length === 0 ? "ปฏิเสธ" : "เขียนไปแล้ว"; } };
    ck("บิลที่จ่ายแล้ว/ยกเลิกแล้ว/แถวที่ไม่มีแล้ว ห้ามเขียน",
      [await refused({ ...ROW, status: "paid" }, "u1"), await refused({ ...ROW, status: "cancelled" }, "u1"), await refused(ROW, "ไม่มีแถวนี้")],
      ["ปฏิเสธ", "ปฏิเสธ", "ปฏิเสธ"]);

    // ยังไม่ได้เพิ่มคอลัมน์ — ต้องบอกเป็นภาษาคน ไม่ใช่โยน error ดิบ
    const noCol = async () => { try { await fn(async () => { throw new Error('column orders.served_items does not exist'); })(71, "u1", true, "x"); return "ไม่ error"; } catch (e) { return /ต้องเพิ่มคอลัมน์ served_items/.test(e.message) ? "บอกชัด" : e.message; } };
    ck("ยังไม่มีคอลัมน์ ต้องบอกให้รู้ว่าต้องเพิ่มอะไร", await noCol(), "บอกชัด");
  }
  // จอ: ติ๊กมีเฉพาะแถวที่ส่งครัวแล้ว และถ้าบันทึกไม่ได้ต้องถอยกลับ ไม่ค้างติ๊กหลอกไว้
  ok_("ช่องติ๊กมีเฉพาะแถวที่ส่งครัวแล้ว", APP.includes("{!unsent&&existingOrder?.id&&item.line_uid&&(()=>{const sv=served[String(item.line_uid)];"));
  ok_("บันทึกไม่ได้ต้องถอยติ๊กกลับและบอก",
    APP.includes("setServed(p=>{const n={...p};if(prev)n[k]=prev;else delete n[k];return n;});") &&
    APP.includes('notifyDlg("บันทึกการเสิร์ฟไม่สำเร็จ: "+friendlyError(e));'));
  ok_("ติ๊กเสิร์ฟอ่านจากแถวบิลตัวเดียวกัน ไม่ต้องดึงเพิ่ม", APP.includes("existingOrder.served_items&&typeof existingOrder.served_items===\"object\""));
  // กดค้างที่ปุ่มบนไอแพด ต้องไม่ขึ้นแถบ คัดลอก/ค้นดู/แปลภาษา มาบังปุ่ม
  ok_("ปุ่มไม่ขึ้นแถบคัดลอกเมื่อกดค้างบนไอแพด", HTML.includes('button, [role="button"] { -webkit-user-select: none; user-select: none; -webkit-touch-callout: none; }'));
}

// ══════════════════════════════════════════════════════════════════════════
// แจ้งเตือนเข้ามือถือเจ้าของต้อง "จริงและแก้ได้" — ไม่ใช่เตือนทุกอย่างที่ขยับ
// เหตุจริง 11 ก.ย. 69: ตีสี่เตือน "ระบบตอบช้า" (ข้อความเองบอกว่าฐานข้อมูลไม่ได้ช้า)
// ตีสองเตือน "สำรองข้อมูลไม่ผ่าน" ทั้งที่สำรองครบและตรวจแล้วผ่าน แค่ลบไฟล์เก่าไม่สำเร็จ
// ══════════════════════════════════════════════════════════════════════════
section("แจ้งเตือนต้องจริงและแก้ได้");
{
  // ── ตัวเฝ้าความเร็วในแอป ──
  ok_("ไม่นับตัวอย่างตอนแอปอยู่เบื้องหลัง/เพิ่งกลับมาหน้าจอ",
    APP.includes('if(kind!=="ok"&&dbhQuiet())return;') &&
    APP.includes('if(typeof document!=="undefined"&&document.visibilityState==="hidden")return true;') &&
    APP.includes("return dbhResumedAt>0&&Date.now()-dbhResumedAt<20000;"));
  // ดึงตัวตัดสิน "ส่งเข้ามือถือไหม" มารันจริง — ข้อความจากตัววัดคือสิ่งที่ตัดสิน
  const gateStart = APP.indexOf('  if(kind==="down"){\n    if(!/น่าจะล่มจริง|ช้าจริง/.test(msg.body))return;');
  ok_("ยังมีตัวตัดสินว่าจะส่งเข้ามือถือเจ้าของไหม", gateStart > 0);
  if (gateStart > 0) {
    const gateEnd = APP.indexOf("  try{ fetch(\"/api/push\"", gateStart);
    const gate = APP.slice(gateStart, gateEnd);
    const mem = {};
    const LS = { getItem: (k) => (k in mem ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: (k) => { delete mem[k]; } };
    const run = new Function("kind", "msg", "localStorage", 'const DOWN_KEY="fc_dbh_down_pushed";\n' + gate + "\nreturn true;");
    const sends = (kind, body) => run(kind, { body }, LS) === true;
    // ข้อความจริงสามแบบที่ตัววัดสร้าง (ดู dbhAlert)
    const DEVICE = "คำสั่งใช้เวลา 0.7 วินาที แต่คำขอจิ๋วเร็วปกติ (489 ms) — ฐานข้อมูลไม่ได้ช้า ปัญหาอยู่ที่เครื่องนี้";
    const SLOW = "คำสั่งใช้เวลา 9 วินาที คำขอจิ๋วก็ช้า (4200 ms) — เน็ตของสาขาหรือฐานข้อมูลช้าจริง";
    const DOWN = "คำสั่งใช้เวลา 9 วินาที ต่อฐานข้อมูลไม่ได้เลย — น่าจะล่มจริง ตรวจ Supabase ทันที";
    ck("ปัญหาที่เครื่องเดียว (ฐานข้อมูลปกติ) ห้ามปลุกเจ้าของ", sends("down", DEVICE), false);
    ck("ไม่เคยแจ้งว่ามีปัญหา ก็ไม่ต้องแจ้งว่ากลับมาปกติ", sends("up", ""), false);
    ck("ฐานข้อมูลช้าจริง/ต่อไม่ได้ ต้องแจ้ง", [sends("down", SLOW), sends("down", DOWN)], [true, true]);
    ck("เคยแจ้งว่ามีปัญหาแล้ว ต้องแจ้งตอนกลับมาปกติ (ครั้งเดียว)", [sends("up", ""), sends("up", "")], [true, false]);
  }
  // ข้อความต้นทางต้องยังมีคำที่ตัวตัดสินใช้ — ถ้าใครแก้ถ้อยคำ ตัวตัดสินจะเงียบตลอดกาล
  ok_("ข้อความจากตัววัดยังมีคำที่ตัวตัดสินใช้แยก",
    APP.includes("— น่าจะล่มจริง ตรวจ Supabase ทันที") && APP.includes("— เน็ตของสาขาหรือฐานข้อมูลช้าจริง"));

  // ── สำรองข้อมูล ──
  ok_("ลิสต์ไฟล์สำรองไม่ส่งรหัสโฟลเดอร์ไปในช่องรหัส Shared Drive (404 ทุกคืน)",
    BACKUP.includes("corpora=allDrives") && !BACKUP.includes("driveId=$" + "{FOLDER_ID}"));
  ok_("ยังกรองเฉพาะไฟล์ในโฟลเดอร์สำรอง ไม่กวาดทั้งไดรฟ์",
    BACKUP.includes("' in parents and name contains 'foodcost-backup-' and trashed=false"));
  // เก็บกวาดไม่เคยรันสำเร็จมาก่อน — คืนแรกที่ทำงานห้ามลบถาวร
  {
    const rs = BACKUP.indexOf("async function rotate(todayId) {");
    const re = BACKUP.indexOf("export default async function handler", rs);
    const rot = rs > 0 && re > rs ? BACKUP.slice(rs, re) : "";
    ok_("เก็บกวาดไฟล์สำรองเก่าย้ายลงถังขยะ ไม่ลบถาวร",
      rot.includes('method: "PATCH"') && rot.includes("JSON.stringify({ trashed: true })") && !/method:\s*"DELETE"/.test(rot));
    ok_("ยังเก็บ 14 วันล่าสุดเสมอ และปฏิเสธแผนที่จะลบเยอะผิดปกติ",
      BACKUP.includes("const KEEP_DAILY = 14, KEEP_MONTHLY = 12, KEEP_YEARLY = 3, MAX_DELETE = 40;") && rot.includes("toDelete.length > MAX_DELETE"));
  }
  ok_("สาเหตุในแจ้งเตือนต้องตรงความจริง ไม่ใช่ \"ไม่ผ่านการตรวจสอบ\" ทุกกรณี",
    BACKUP.includes(': status === "degraded" ? "ไฟล์สำรองครบแล้ว แต่ข้ามขั้นอ่านกลับมาตรวจ'));
}

// ══════════════════════════════════════════════════════════════════════════
// ป็อปอัพ QR โต๊ะ — พนักงานสแกนเช็คมุมมองลูกค้า
// ต้องเป็นลิงก์เดียวกับที่พิมพ์ลงกระดาษเป๊ะ ไม่งั้นพนักงานเช็คหน้าที่ลูกค้าไม่ได้เห็นจริง
// ══════════════════════════════════════════════════════════════════════════
section("ป็อปอัพ QR โต๊ะ");
{
  // ตัวชี้ขาด: ลิงก์ QR โต๊ะประกอบที่เดียวทั้งแอป — มีที่สองเมื่อไหร่ วันหนึ่งจะไม่ตรงกัน
  ck("ลิงก์ QR โต๊ะประกอบที่เดียวทั้งแอป", APP.split("?scan=1&branch=").length - 1, 1);
  const st = APP.indexOf("function tableScanUrl(table,branch){");
  let fn = null;
  if (st >= 0) {
    let d = 0, started = false, en = -1;
    for (let i = st + "function tableScanUrl(table,branch){".length - 1; i < APP.length; i++) {
      if (APP[i] === "{") { d++; started = true; }
      else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    fn = new Function("publicBaseUrl", APP.slice(st, en) + "\nreturn tableScanUrl;")(() => "https://x.app/");
  }
  ok_("ยังมีตัวประกอบลิงก์ QR โต๊ะ", !!fn);
  if (fn) {
    ck("มีรหัสลับโต๊ะ = ติดไปกับลิงก์ (กันคนสุ่มเลขโต๊ะสั่งแทน)",
      fn({ id: 12, qr_token: "a b/c" }, { id: 8 }), "https://x.app/?scan=1&branch=8&table=12&t=a%20b%2Fc");
    ck("ไม่มีรหัสลับ = ไม่มี t ห้อยท้าย", fn({ id: 12 }, { id: 8 }), "https://x.app/?scan=1&branch=8&table=12");
  }
  ok_("ตัวพิมพ์ QR ใช้ลิงก์ตัวเดียวกัน", APP.includes("  const url=tableScanUrl(table,branch);"));
  ok_("หน้าจัดการ QR ใช้ลิงก์ตัวเดียวกัน", APP.includes("  const buildUrl=(t)=>tableScanUrl(t,branch);"));
  // ปุ่มพิมพ์ QR โต๊ะนี้: เด้งป็อปอัพด้วยลิงก์ตัวเดียวกัน ก่อนสั่งพิมพ์ (พิมพ์ไม่ออกก็ยังเช็คได้)
  // ป็อปอัพรับลิงก์ "จากตัวพิมพ์" หลังอ่านรหัสล่าสุดแล้ว — กระดาษกับจอเป็นลิงก์เดียวกันแน่นอน
  ok_("ปุ่มพิมพ์ QR โต๊ะนี้ เด้งป็อปอัพด้วยลิงก์ตัวเดียวกับที่พิมพ์",
    APP.includes("setQrPeek({table:selTable,url:null});printTableQR(selTable,currentBranch,printers,()=>loadAll({silent:true}),(u)=>setQrPeek(p=>p?{...p,url:u}:p));") &&
    APP.includes('if(typeof onUrl==="function"){try{onUrl(url);}catch{}}'));
  ok_("ป็อปอัพแสดง QR จากลิงก์ในป็อปอัพเอง ไม่ประกอบใหม่",
    APP.includes("data=$" + "{encodeURIComponent(qrPeek.url)}") &&APP.includes("<a href={qrPeek.url} target=\"_blank\" rel=\"noopener noreferrer\""));
  ok_("รูป QR โหลดไม่ได้ ต้องบอกและมีทางเปิดดูแทน", APP.includes("onError={()=>setQrPeekErr(true)}") && APP.includes("โหลดรูป QR ไม่ได้ (เน็ตสะดุด)"));
}

// ══════════════════════════════════════════════════════════════════════════
// ปิดโต๊ะแล้ว QR ต้องเปลี่ยนใหม่ (เจ้าของสั่ง 11 ก.ย. 69)
// ลูกค้าคนใหม่ที่ลงโต๊ะเดิมได้ QR ใหม่ · QR ของคนก่อนสั่งเข้าโต๊ะนี้ไม่ได้อีก
// ══════════════════════════════════════════════════════════════════════════
section("ปิดโต๊ะ = QR ใหม่");
{
  const head = "  releaseTable: async (id) => {";
  const st = APP.indexOf(head);
  let rel = null;
  if (st >= 0) {
    let d = 0, started = false, en = -1;
    for (let i = st + head.length - 1; i < APP.length; i++) {
      if (APP[i] === "{") { d++; started = true; }
      else if (APP[i] === "}") { d--; if (started && d === 0) { en = i + 1; break; } }
    }
    const expr = APP.slice(st + "  releaseTable: ".length, en);
    rel = (sb) => new Function("sb", "uuidv4", "return (" + expr + ");")(sb, () => "NEW-TOKEN");
  }
  ok_("ยังมีตัวปล่อยโต๊ะ", !!rel);
  if (rel) {
    // ปกติ: เขียนรหัสใหม่ + ล้างธง ในคำสั่งเดียว
    { const w = []; const ok = await rel(async (path, opt) => { w.push({ path, body: JSON.parse(opt.body) }); return []; })(12);
      ck("ปล่อยโต๊ะ = เปลี่ยนรหัส QR + ล้างธงพิมพ์ QR ในคำสั่งเดียว", [ok, w.length, w[0] && w[0].body], [true, 1, { qr_token: "NEW-TOKEN", qr_printed_at: null }]);
      ok_("เขียนเฉพาะโต๊ะนั้น", w[0] && w[0].path === "tables?id=eq.12"); }
    // เน็ตสะดุดครั้งแรก — ต้องลองซ้ำ ไม่ใช่ยอมแพ้ (QR เก่าจะยังใช้ได้)
    { let n = 0; const ok = await rel(async () => { if (++n === 1) throw new Error("network"); return []; })(12);
      ck("เน็ตสะดุดครั้งแรก ลองซ้ำจนสำเร็จ", [ok, n], [true, 2]); }
    // คอลัมน์ธงยังไม่มี — ต้องยังเปลี่ยนรหัสได้ (สิ่งที่สำคัญที่สุด)
    { const w = []; const ok = await rel(async (path, opt) => { const b = JSON.parse(opt.body); w.push(b); if ("qr_printed_at" in b) throw new Error("column tables.qr_printed_at does not exist"); return []; })(12);
      ck("ยังไม่มีคอลัมน์ธง ก็ยังเปลี่ยนรหัส QR ได้", [ok, w[w.length - 1]], [true, { qr_token: "NEW-TOKEN" }]); }
    // ล้มทุกครั้ง — ต้องบอกคนเรียกว่าไม่สำเร็จ ห้ามทำเหมือนสำเร็จ
    { const ok = await rel(async () => { throw new Error("network"); })(12);
      ck("เปลี่ยนไม่สำเร็จ ต้องคืนว่าไม่สำเร็จ (ให้จอเตือนพนักงาน)", ok, false); }
  }
  ok_("เปลี่ยนไม่สำเร็จ จอต้องเตือนพนักงานว่า QR เดิมยังใช้ได้", APP.includes("ไม่สำเร็จ — QR เดิมยังใช้ได้อยู่"));
  // ย้ายโต๊ะ: โต๊ะต้นทางต้องถูกปล่อย — ไม่งั้น QR เดิมในมือลูกค้าเปิดบิลใหม่ที่โต๊ะเดิม
  ok_("ย้ายโต๊ะแล้วปล่อยโต๊ะต้นทาง", APP.includes("const released=await Promise.race([api.releaseTable(from.id),"));
  ok_("ย้ายโต๊ะแล้วเตือนให้พิมพ์ QR โต๊ะใหม่", APP.includes("อย่าลืมพิมพ์ QR โต๊ะใหม่ให้ลูกค้า"));
  // พิมพ์ QR ต้องอ่านรหัสล่าสุดจากฐานก่อนประกอบลิงก์ — ห้ามพิมพ์จากค่าค้างในจอ
  {
    const ps = APP.indexOf("async function printTableQR(table,branch,printers=[],onPrinted,onUrl){");
    const fresh = APP.indexOf("const r=await api.getTableFresh(table.id);", ps);
    const build = APP.indexOf("  const url=tableScanUrl(table,branch);", ps);
    ok_("พิมพ์ QR อ่านรหัสล่าสุดจากฐานก่อนประกอบลิงก์", ps > 0 && fresh > ps && build > fresh);
  }
  // หน้าลูกค้า: QR หมดอายุแล้วต้องหยุดทุกทาง
  ok_("หน้าลูกค้าที่ QR หมดอายุ ห้ามเห็นบิลของลูกค้าคนใหม่",
    APP.includes('if(token){const ok=await api.scanTable(branchId,tableId,token);if(Array.isArray(ok)&&ok.length===0){setMyOrder(null);setGateError("bad_token");return;}}'));
  ok_("คิวออฟไลน์เช็ค QR ก่อนส่ง และทิ้งของค้างถ้าหมดอายุ",
    APP.includes('if(Array.isArray(ok)&&ok.length===0){writeOutbox(null);setOutbox(null);setGateError("bad_token");flushingRef.current=false;setOutboxBusy(false);return;}}'));
  ok_("QR หมดอายุบนมือถือลูกค้าไม่ใช้กล่องเตือนที่บล็อกเธรด", !APP.includes('alert("QR ของโต๊ะนี้ถูกอัพเดทใหม่'));
}

// ══════════════════════════════════════════════════════════════════════════
// ตัวเลือกเลือกซ้ำได้ — ปุ่ม − จำนวน + · ×N ต้องแสดงตรงกันทั้งจอ ใบเสร็จ ใบครัว และตัวพิมพ์
// ══════════════════════════════════════════════════════════════════════════
section("ตัวเลือกเลือกซ้ำได้");
{
  const g2 = G(3, true, 2);
  { const P = newPicker(); P.pick(g2, g2.choices[0]); P.inc(g2, g2.choices[0]); P.dec(g2, g2.choices[0]);
    ck("ปุ่ม + แล้ว − กลับมาเหลือ 1", +P.sel.c1 || 0, 1);
    P.dec(g2, g2.choices[0]); ck("ลดจนเหลือ 0 = เอาตัวนั้นออก", "c1" in P.sel, false); }
  { const P = newPicker(); P.pick(g2, g2.choices[0]); P.pick(g2, g2.choices[0]);
    ck("ครบจำนวนแล้วปลดล็อกปุ่มสั่ง (ไม่ขาด ไม่เกิน)", P.countIn(g2) === P.needOf(g2), true); }
  // กลุ่มเลือก 1 และกลุ่มไม่บังคับ ต้องทำงานเหมือนเดิมทุกอย่าง (ไม่มีการเลือกซ้ำ)
  ck("บังคับ 1 → กดตัวเดิมซ้ำ ยังเป็นตัวเดียว (ไม่ซ้ำ)", tap(G(3, true, 1), ["c1", "c1"]).join(), "c1");
  ck("ไม่บังคับ → กดตัวเดิมซ้ำ = เอาออก (เหมือนเดิม)", tap(G(3, false, 1), ["c1", "c1"]).join(), "");
  // ข้อความตัวเลือกทั้งสามที่ต้องตรงกันทุกตัวอักษร
  const appOT = new Function(APP.split("\n").find(l => l.startsWith("function optionsText(opts){")) + "\nreturn optionsText;")();
  const agLine = AGENT.split("\n").find(l => l.startsWith("function optionsText(opts) {"));
  const agOT = agLine ? new Function(agLine + "\nreturn optionsText;")() : null;
  const X = [{ name: "เตาหมูกระทะ" }, { name: "เตาหมูกระทะ" }, { name: "น้ำจิ้มซีฟู้ด" }];
  ck("จอ/ใบเสร็จ: ตัวเลือกซ้ำแสดงเป็น ×N", appOT(X), "เตาหมูกระทะ ×2, น้ำจิ้มซีฟู้ด");
  ck("ไม่มีตัวซ้ำ แสดงเหมือนเดิมทุกตัวอักษร (บิลเก่าไม่เปลี่ยน)", appOT([{ name: "ก" }, { name: "ข" }]), "ก, ข");
  ok_("ตัวพิมพ์ที่ร้านแสดงตรงกับแอปทุกตัวอักษร", !!agOT && agOT(X) === appOT(X) && agOT([{ name: "ก" }, { name: "ข" }]) === "ก, ข");
  ok_("ใบครัวรวมตัวเลือกซ้ำเป็นบรรทัดเดียว ×N", SLIP.includes('lines.push({ t: "- " + n + (k > 1 ? " ×" + k : ""), size: 30, indent: true });'));
  // ราคา: หนึ่งครั้งที่เลือก = หนึ่งรายการ ⟹ ตัวเลือกมีราคาบวกตามจำนวนครั้งเอง
  ok_("ตัวเลือกที่มีราคา เลือกซ้ำแล้วราคาบวกตามจำนวนครั้ง", APP.includes("const chosen=grps.flatMap(g=>g.choices.flatMap(c=>Array.from({length:cnt(c)},()=>({name:c.name,price:+c.price||0}))));"));
  ok_("ขยับเวอร์ชันตัวพิมพ์แล้ว (ร้านอัปเดตเอง)", /const AGENT_VERSION = (\d+);/.test(AGENT) && +AGENT.match(/const AGENT_VERSION = (\d+);/)[1] >= 38);
}

// ══════════════════════════════════════════════════════════════════════════
// <label> ห้ามห่อปุ่ม — ปุ่มคือ "ตัวควบคุมของป้าย" ตามมาตรฐาน HTML
// แตะที่ป้าย (ชื่อตัวเลือก) เบราว์เซอร์จะคลิกปุ่มแรกข้างในให้เองอีกทีหนึ่ง
// เคยเกือบหลุด 11 ก.ย. 69: แถวตัวเลือกมีปุ่ม − จำนวน + · แตะแถวเพื่อเพิ่ม = บวกแล้วโดนลบทันที จำนวนไม่ขยับ
// ══════════════════════════════════════════════════════════════════════════
section("ป้ายห้ามห่อปุ่ม");
{
  const bad = [];
  const re = /<label\b|<\/label>/g;
  let m, stack = [];
  while ((m = re.exec(APP))) {
    if (m[0] === "</label>") {
      const st = stack.pop();
      if (st != null && /<button\b/.test(APP.slice(st, m.index))) bad.push(APP.slice(0, st).split("\n").length);
    } else stack.push(m.index);
  }
  ck("ไม่มี <label> ที่มีปุ่มอยู่ข้างใน (บรรทัด: " + (bad.join(", ") || "-") + ")", bad.length, 0);
  ok_("แถวตัวเลือกเมนูกดได้ทั้งแถว", APP.includes("return <div key={c.id} role=\"button\" onClick={()=>pick(g,c)}"));
}

// ══════════════════════════════════════════════════════════════════════════
// รายการในแผงโต๊ะ: ชื่อ ตัวเลือก หมายเหตุ ต้องอ่านได้เต็ม — พนักงานใช้ทวนรายการกับลูกค้า
// เคยถูกตัดเป็น "ชุด..." "+ ชา..." บนแท็บเล็ตแนวตั้ง (11 ก.ย. 69)
// ══════════════════════════════════════════════════════════════════════════
section("รายการในโต๊ะอ่านได้เต็ม");
{
  const a = APP.indexOf('<div ref={listRef} style={{flex:1,overflowY:"auto",padding:8}}>');
  const b = a < 0 ? -1 : APP.indexOf("</SwipeRow>)", a);
  const blk = a >= 0 && b > a ? APP.slice(a, b) : "";
  ok_("เจอรายการอาหารในแผงโต๊ะ (ชื่อ ตัวเลือก หมายเหตุ)", blk.includes("{item.name}") && blk.includes("optionsText(item.options)") && blk.includes("{item.note}"));
  ck("ชื่อ/ตัวเลือก/หมายเหตุไม่ถูกตัดเป็น ...", (blk.match(/textOverflow:"ellipsis"|whiteSpace:"nowrap"/g) || []).length, 0);
}

// ══════════════════════════════════════════════════════════════════════════
// ช่องทางจ่ายย่อยใต้ "อื่นๆ" (ไทยพลัส ฯลฯ) — ยอดต้องไม่หลุดจากสรุปกะ/ท่อบัญชี และทุกช่องทางต้องมีชื่อ
// ══════════════════════════════════════════════════════════════════════════
section("ช่องทางจ่ายอื่นๆ");
{
  const grab = (head) => { const L = APP.split("\n"); const a = L.findIndex(l => l.startsWith(head)); if (a < 0) return null; const b = L.findIndex((l, i) => i >= a && /^\];|\};$/.test(l.trim()) ); return L.slice(a, b + 1).join("\n"); };
  let OTHER = null, LABEL = null;
  try { OTHER = new Function(grab("const OTHER_PAY_METHODS=") + "\nreturn OTHER_PAY_METHODS;")(); } catch {}
  try { LABEL = new Function(APP.split("\n").find(l => l.startsWith("const PAY_LABEL=")) + "\nreturn PAY_LABEL;")(); } catch {}
  ok_("อ่านรายการช่องทางอื่นๆ ได้", Array.isArray(OTHER) && OTHER.length > 0 && LABEL && typeof LABEL === "object");
  if (Array.isArray(OTHER) && LABEL) {
    const noName = OTHER.filter(m => !LABEL[m.v]).map(m => m.v);
    ck("ทุกช่องทางมีชื่อบนใบเสร็จ/ประวัติ (ขาด: " + (noName.join(",") || "-") + ")", noName.length, 0);
        // ชื่อบนจอต้องตรงกับชื่อที่ฝั่งบัญชีใช้ ไม่งั้นพนักงานกับบัญชีเรียกคนละอย่างแล้วกระทบยอดกันไม่รู้เรื่อง
  ok_("ชื่อไทยช่วยไทย พลัส ตรงกับที่ส่งเข้าบัญชี", OTHER.some(m => m.v === "thaiplus" && m.l === "ไทยช่วยไทย พลัส") && SLIPPUSH.includes('name_th: "ไทยช่วยไทย พลัส"'));
    ok_("ยังเลือก อื่นๆ แบบไม่ระบุได้ (บิลเดิมใช้อยู่)", OTHER.some(m => m.v === "other"));
    ck("ไม่มีช่องทางซ้ำ", new Set(OTHER.map(m => m.v)).size, OTHER.length);
    ok_("ไม่มีช่องทางย่อยไปชนเงินสด/พร้อมเพย์ (จะลงผิดกลุ่ม)", !OTHER.some(m => ["cash", "promptpay", "transfer", "credit", "debit"].includes(m.v)));
  }
  // ยอดของช่องทางใหม่ต้องลงกลุ่ม "อื่นๆ" เอง — ทั้งสองที่ต้องคัดด้วยการยกเว้น ห้ามเป็นรายชื่อ
  ok_("สรุปกะ: ช่องทางที่ไม่รู้จักลงกลุ่มอื่นๆ (คัดด้วยการยกเว้น)",
    APP.includes("if(pm==='cash')totalCash+=a;else if(pm==='transfer'||pm==='promptpay')totalTransfer+=a;else if(pm==='credit'||pm==='debit')totalCard+=a;else totalOther+=a;"));
  ok_("ท่อบัญชี: ช่องทางที่ไม่รู้จักลงกลุ่ม Custom Payment (คัดด้วยการยกเว้น ไม่ใช่รายชื่อ)",
    SLIPPUSH.includes('const MAIN_PAY_METHODS = ["cash", "promptpay", "transfer", "credit", "debit"];')
    && SLIPPUSH.includes("const other = list.filter((x) => !MAIN_PAY_METHODS.includes(x.payment_method));"));
  ok_("กด อื่นๆ = เปิดรายการช่องทาง ไม่ปิดบิลทันที", APP.includes('onClick={()=>{if(m.v==="other"){setAskPay("other");return;}setPayMethod(m.v);'));
  ok_("เลือกช่องทางย่อย = ปิดบิลด้วยช่องทางนั้น", APP.includes("{OTHER_PAY_METHODS.map(m=><button key={m.v} disabled={saving}") && APP.includes("onClick={()=>{setPayMethod(m.v);setAskPay(null);onPay(m.v);}}"));
}

// ══════════════════════════════════════════════════════════════════════════
// ใบยกเลิก/ย้ายโต๊ะ ทางสำรองของตัวพิมพ์ (ตอนเรนเดอร์รูปไม่ได้) — ต้องบอกชนิดใบเหมือนกัน
// เดิมใบสำรองขึ้น "ใบสั่งอาหาร" ทุกชนิด = ใบยกเลิก/ย้ายโต๊ะ ครัวอ่านเป็นออเดอร์ใหม่แล้วทำซ้ำ
// ══════════════════════════════════════════════════════════════════════════
section("ใบยกเลิก/ย้ายโต๊ะ ทางสำรอง");
{
  const L = AGENT.split("\n");
  const a = L.findIndex(l => l.startsWith("function buildKitchenESC(item, tableNum, meta) {"));
  const b = L.findIndex((l, i) => i > a && l === "}");
  let esc = null;
  if (a >= 0 && b > a) {
    try {
      esc = new Function("thaiBytes", "SET_THAI", "optionsText", L.slice(a, b + 1).join("\n") + "\nreturn buildKitchenESC;")(
        (s) => Buffer.from(String(s), "utf8"), [], (o) => (o || []).map(x => x.name).join(", "));
    } catch {}
  }
  ok_("ใบสำรองรับชนิดใบได้", !!esc);
  if (esc) {
    const s = (buf) => buf.toString("utf8");
    const REV = Buffer.from([0x1d, 0x42, 0x01]);
    const it = { qty: 1, name: "ยกเลิก: หมูสไลด์", options: [], note: "ไม่เผ็ด · ยกเลิกโดย a" };
    const v = esc(it, "C7", { kind: "void" });
    ok_("ใบสำรองยกเลิก: กล่องกลับสีเขียนว่ายกเลิก ไม่ใช่ใบสั่งอาหาร", v.includes(REV) && s(v).includes("ยกเลิก") && !s(v).includes("ใบสั่งอาหาร"));
    ok_("ใบสำรองยกเลิก: มีเบอร์โต๊ะ รายการ และหมายเหตุ", s(v).includes("C7") && s(v).includes("หมูสไลด์") && s(v).includes("ไม่เผ็ด"));
    const m = esc({ qty: 1, name: "ย้ายโต๊ะ" }, "C7", { kind: "move", from: "A5" });
    const ms = s(m);
    ok_("ใบสำรองย้ายโต๊ะ: จาก A5 ไป C7 ตามลำดับ ไม่ใช่ใบสั่งอาหาร",
      m.includes(REV) && ms.indexOf("จากโต๊ะ") < ms.indexOf("A5") && ms.indexOf("A5") < ms.indexOf("ย้ายไปโต๊ะ") && ms.indexOf("ย้ายไปโต๊ะ") < ms.indexOf("C7") && !ms.includes("ใบสั่งอาหาร"));
    const n = s(esc({ qty: 2, name: "หมูสไลด์" }, "C7", {}));
    ok_("ใบสั่งอาหารปกติ ใบสำรองเหมือนเดิม", n.includes("ใบสั่งอาหาร") && n.includes("2x หมูสไลด์") && !n.includes("ยกเลิก"));
  }
  ok_("ใบสำรองได้รับชนิดใบจากทางเรนเดอร์", AGENT.includes("{ buf: buildKitchenESC(it, tableNum, meta), raster: false }"));
  ok_("ตัวพิมพ์พิมพ์ใบย้ายโต๊ะใบเดียวต่อเครื่อง", AGENT.includes('const list = (meta && meta.kind === "move") ? (items || []).slice(0, 1) : items;'));
  ok_("แอปส่งใบย้ายโต๊ะใบเดียว ไม่แนบรายการอาหาร", APP.includes('const slipBody=(its)=>(meta&&meta.kind==="move")?[{qty:1,name:"ย้ายโต๊ะ",options:[],note:""}]:its;')
    && APP.includes("items:slipBody(mine)") && APP.includes("items:slipBody(body)"));
  ok_("ใบยกเลิกคงหมายเหตุเดิมของจาน (เมนูเดียวกันหลายจาน)", APP.includes("note:[target.note,\x60ยกเลิกโดย "));
  ok_("ขยับเวอร์ชันตัวพิมพ์แล้ว (ร้านอัปเดตเอง)", +((AGENT.match(/const AGENT_VERSION = (\d+);/) || [])[1] || 0) >= 39);
}

// ══════════════════════════════════════════════════════════════════════════
// ปุ่ม "พิมพ์ไม่สำเร็จ" + รีปริ้นรายเมนู (11 ก.ย. 69)
// ปุ่มต้องหายเมื่อ "ออกจริง" เท่านั้น — กดแล้วหายทั้งที่เครื่องยังดับ = ใบหายเงียบ ครัวไม่ได้ทำ
// ใบสั่งอาหารที่ไม่ออก พิมพ์ใหม่ต้องเป็นใบสั่งอาหารปกติ — ติดป้าย "พิมพ์ซ้ำ" แล้วครัวข้าม = ลูกค้าไม่ได้กิน
// ══════════════════════════════════════════════════════════════════════════
section("ปุ่มพิมพ์ไม่สำเร็จ");
{
  const LA = APP.split("\n"), LG = AGENT.split("\n");
  // ดึงฟังก์ชันระดับบนสุดจากบรรทัดหัว ถึงบรรทัดปิด (บรรทัดที่เป็น "}" หรือ "};" ล้วน)
  const grabTop = (L, head) => { const a = L.findIndex(l => l.startsWith(head)); if (a < 0) return null; const b = L.findIndex((l, i) => i > a && (l === "}" || l === "};")); return b > a ? L.slice(a, b + 1).join("\n") : null; };
  const safe = (f) => { try { return f(); } catch { return null; } };

  // ── ฝั่งแอป: อ่าน/รวมรายการ, ติ๊กรีปริ้น, จับคู่รายการ ──
  const appFns = safe(() => new Function(
    [grabTop(LA, "const printFailList=(printers)=>{"), grabTop(LA, "const printFailsOf=(printers)=>{"), grabTop(LA, "function markPrintRetry(list,failId,ks,now){"),
     LA.find(l => l.startsWith("const PRINT_RETRY_TTL=")), LA.find(l => l.startsWith("const printRetryWaiting=")), LA.find(l => l.startsWith("const samePrintFail="))].join("\n")
    + "\nreturn {printFailList,printFailsOf,markPrintRetry,printRetryWaiting,samePrintFail,PRINT_RETRY_TTL};")());
  ok_("อ่านตัวจัดการรายการพิมพ์ไม่ออกของแอปได้", !!appFns);
  if (appFns) {
    const { printFailList, printFailsOf, markPrintRetry, printRetryWaiting, samePrintFail } = appFns;
    const e1 = { id: "7-100", at: 100, orderId: 7, table: "B5", names: ["หมู"], n: 1, items: [{ k: 0, name: "หมู", qty: 1 }] };
    const e2 = { at: 50, orderId: 7, table: "B5", names: ["ผัก"], n: 2 };   // รายการจากตัวพิมพ์รุ่นเก่า (ไม่มี id/items)
    const PR = [{ id: 10, description: JSON.stringify({ on: true, failed: [e1, e2] }) }, { id: 11, description: "{เสีย" }, { id: 12, description: null }];
    const L = printFailList(PR);
    ok_("อ่านทุกรายการ พร้อมบอกว่าเก็บอยู่เครื่องไหน · เรียงเก่าไปใหม่ · ช่องเสียไม่ทำจอพัง",
      L.length === 2 && L.every(f => f.holder === 10) && L[0].at === 50 && L[1].id === "7-100");
    const M = printFailsOf(PR).get("7");
    ok_("บิลเดียวไม่ออกหลายรอบ = รวมชื่อทุกรอบ (เดิมรอบหลังทับรอบแรก)", !!M && M.names.join() === "ผัก,หมู" && M.n === 3);   // เรียงรอบเก่าก่อน
    const list = [JSON.parse(JSON.stringify(e1)), { id: "8-1", items: [{ k: 0 }, { k: 1 }, { k: 2 }] }];
    const out = markPrintRetry(list, "8-1", [1, 2], 555);
    ok_("กดรีปริ้นเมนูไหน ติ๊กเฉพาะเมนูนั้น", !!out && out[1].items.map(i => i.r || 0).join() === "0,555,555" && !out[0].items[0].r);
    ok_("รายการเพิ่งพิมพ์ออกไปแล้ว (ตัวพิมพ์ลบไป) = ไม่เขียนอะไร", markPrintRetry(list, "ไม่มี", [0], 1) === null && markPrintRetry(list, "8-1", [9], 1) === null);
    ok_("กำลังพิมพ์ = ติ๊กยังไม่เก่าเกินเวลาที่ตัวพิมพ์ยอมทำ", printRetryWaiting({ r: 1000 }, 1000 + 60e3) && !printRetryWaiting({ r: 1000 }, 1000 + appFns.PRINT_RETRY_TTL + 1) && !printRetryWaiting({}, 5));
    ok_("เอาออกถูกรายการ (ทั้งแบบใหม่และแบบเก่า) ไม่โดนรายการอื่น",
      samePrintFail(e1, { id: "7-100" }) && !samePrintFail(e1, { id: "7-101" }) && samePrintFail(e2, { at: 50, orderId: 7 }) && !samePrintFail(e1, { at: 100, orderId: 7 }));
  }
  const ttlApp = safe(() => Function("return " + LA.find(l => l.startsWith("const PRINT_RETRY_TTL=")).split("=")[1].split(";")[0])());
  const ttlAgent = safe(() => Function("return " + LG.find(l => l.startsWith("const RETRY_TTL =")).split("=")[1].split(";")[0])());
  ok_("เวลาหมดอายุของติ๊กรีปริ้น แอปกับตัวพิมพ์ตรงกัน", ttlApp != null && ttlApp === ttlAgent);

  // ── ฝั่งตัวพิมพ์: เขียนผลกลับ (settleFail) ──
  const settleSrc = grabTop(LG, "async function settleFail(holderId, failId, want, okKs) {");
  const runSettle = async (desc, want, okKs) => {
    let wrote = null;
    const fn = new Function("sb", "patchPrinter", settleSrc + "\nreturn settleFail;")(async () => [{ description: JSON.stringify(desc) }], async (id, body) => { wrote = JSON.parse(body.description); });
    await fn(10, "F1", want, new Set(okKs));
    return wrote;
  };
  if (settleSrc) {
    const base = () => ({ on: true, failed: [{ id: "F1", names: ["ก", "ข", "ค"], n: 3, items: [{ k: 0, name: "ก", qty: 1, r: 5 }, { k: 1, name: "ข", qty: 1 }, { k: 2, name: "ค", qty: 1, r: 5 }] }, { id: "F2", items: [{ k: 0 }] }] });
    const w1 = await runSettle(base(), [{ k: 0, r: 5 }, { k: 2, r: 5 }], [0]);
    const f1 = w1 && w1.failed.find(f => f.id === "F1");
    ok_("ออกแล้ว = ลบเมนูนั้น · ไม่ออก = คงไว้ ปลดติ๊กให้กดใหม่ · เมนูที่ไม่ได้กดไม่โดนแตะ",
      !!f1 && f1.items.map(i => i.k).join() === "1,2" && f1.items[1].r === null && !!f1.items[1].lastTry && !("lastTry" in f1.items[0]) && f1.names.join() === "ข,ค" && w1.on === true && w1.failed.length === 2);
    const d2 = base(); d2.failed[0].items[2].r = 9;   // พนักงานกดซ้ำระหว่างที่ตัวพิมพ์กำลังพิมพ์
    const w2 = await runSettle(d2, [{ k: 0, r: 5 }, { k: 2, r: 5 }], [0]);
    ok_("กดใหม่ระหว่างพิมพ์ = คงติ๊กใหม่ไว้ รอบหน้าพิมพ์ต่อ", !!w2 && w2.failed[0].items.find(i => i.k === 2).r === 9);
    const d3 = base(); d3.failed[0].items = [d3.failed[0].items[0]];
    const w3 = await runSettle(d3, [{ k: 0, r: 5 }], [0]);
    ok_("ออกครบทุกเมนู = ลบรายการทิ้ง (ปุ่มหาย) โดยไม่แตะรายการอื่น", !!w3 && w3.failed.length === 1 && w3.failed[0].id === "F2");
  } else ok_("มีตัวเขียนผลรีปริ้นกลับ (settleFail)", false);

  // ── ฝั่งตัวพิมพ์: พิมพ์เฉพาะที่กด ครั้งเดียว ชนิดใบเดิม ──
  const retrySrc = grabTop(LG, "async function handleFailRetries(printers) {");
  const handlesSrc = grabTop(LG, "function printerHandles(p, it) {");
  if (retrySrc && handlesSrc) {
    const mkRun = (opts) => {
      const calls = { print: [], send: [], buf: [], settle: [] };
      const state = { retried: {} };
      const printerHandles = new Function(handlesSrc + "\nreturn printerHandles;")();
      const fn = new Function("state", "saveState", "isBluetooth", "itemsToBuffer", "sendToPrinter", "printItems", "printerHandles", "settleFail", "RETRY_TTL", "console",
        retrySrc + "\nreturn handleFailRetries;")(
        state, () => {}, () => false,
        async (items, t, meta) => { calls.buf.push({ items, t, meta }); return { buf: Buffer.from("x") }; },
        async (ip) => { calls.send.push(ip); if (opts.sendFails) throw new Error("offline"); },
        async (items, t, prs, done, meta) => { calls.print.push({ items: items.map(i => i.k), t, meta }); return { okIds: opts.okIds || [] }; },
        printerHandles,
        async (hid, fid, want, okKs) => { calls.settle.push({ hid, fid, want: want.map(i => i.k), ok: [...okKs].sort() }); },
        600000, { log() {} });
      return { fn, calls, state };
    };
    const now = Date.now();
    const prs = (failed) => [{ id: 1, ip: "10.0.0.5", categories: ["ครัว"], description: JSON.stringify({ failed }) }, { id: 2, ip: "10.0.0.6", categories: ["บาร์"], description: "{}" }];
    // บิลที่ไม่ออก: ติ๊ก 2 เมนู (หนึ่งในนั้นไม่มีเครื่องไหนรับหมวดแล้ว) ไม่ติ๊ก 1 เมนู
    const A = { id: "A", orderId: 7, table: "B5", kind: "", items: [{ k: 0, name: "หมู", category: "ครัว", r: now }, { k: 1, name: "ผัก", category: "ครัว" }, { k: 2, name: "ยำ", category: "ของหวาน", r: now }] };
    const R1 = mkRun({ okIds: [1] });
    await R1.fn(prs([A]));
    ok_("พิมพ์เฉพาะเมนูที่พนักงานกด", R1.calls.print.length === 1 && R1.calls.print[0].items.join() === "0,2");
    ok_("ใบสั่งอาหารที่ไม่ออก พิมพ์ใหม่เป็นใบสั่งอาหารปกติ (ไม่ใช่พิมพ์ซ้ำ)", R1.calls.print[0] && R1.calls.print[0].meta.kind === "" && R1.calls.print[0].meta.bill === 7 && R1.calls.print[0].t === "B5");
    ok_("ออก = มีเครื่องที่รับเมนูนั้นพิมพ์ผ่าน · ไม่มีเครื่องรับเลย ≠ ออก (ห้ามลบเงียบ)", R1.calls.settle.length === 1 && R1.calls.settle[0].ok.join() === "0" && R1.calls.settle[0].want.join() === "0,2");
    await R1.fn(prs([A]));
    ok_("กดครั้งเดียว พิมพ์ครั้งเดียว (รอบถัดไปไม่พิมพ์ซ้ำเอง)", R1.calls.print.length === 1 && R1.calls.settle.length === 1);
    const R2 = mkRun({ okIds: [1] });
    await R2.fn(prs([{ ...A, items: [{ k: 0, name: "หมู", category: "ครัว", r: now - 11 * 60000 }] }]));
    ok_("ติ๊กค้างนานเกิน 10 นาที (ตัวพิมพ์ดับอยู่) = ไม่พิมพ์ย้อนหลัง แค่ปลดติ๊ก", R2.calls.print.length === 0 && R2.calls.settle.length === 1 && R2.calls.settle[0].ok.length === 0);
    const V = { id: "V", orderId: 7, table: "B5", kind: "void", pid: 2, items: [{ k: 0, name: "ยกเลิก: หมู", r: now }] };
    const R3 = mkRun({});
    await R3.fn(prs([V]));
    ok_("ใบยกเลิกที่ไม่ออก พิมพ์ใหม่ที่เครื่องเดิม เป็นใบยกเลิก", R3.calls.send.join() === "10.0.0.6" && R3.calls.buf[0] && R3.calls.buf[0].meta.kind === "void" && R3.calls.settle[0].ok.join() === "0");
    const R4 = mkRun({ sendFails: true });
    await R4.fn(prs([V]));
    ok_("ส่งไม่ผ่านอีก = ยังอยู่ในรายการ ให้กดใหม่ได้", R4.calls.settle.length === 1 && R4.calls.settle[0].ok.length === 0);
    const R5 = mkRun({ okIds: [1] });
    await R5.fn(prs([{ ...A, items: A.items.map(i => ({ ...i, r: null })) }]));
    ok_("ไม่มีใครกด = ไม่พิมพ์เองเด็ดขาด (กติกาเจ้าของ)", R5.calls.print.length === 0 && R5.calls.send.length === 0 && R5.calls.settle.length === 0);
  } else ok_("มีตัวพิมพ์ใหม่ตามที่พนักงานกด (handleFailRetries)", false);

  // ── ต่อสายครบ ──
  ok_("ตัวพิมพ์เรียกพิมพ์ใหม่ทุกรอบ", AGENT.includes("  await handleFailRetries(printers);"));
  ok_("ตัวพิมพ์จำว่ากดไหนทำไปแล้ว (ข้ามการรีสตาร์ท)", AGENT.includes("if (!state.retried) state.retried = {};"));
  ok_("บันทึกรายการละเอียดพอพิมพ์ใหม่ได้ (จำนวน/ตัวเลือก/หมายเหตุ/เครื่องที่รับ)", AGENT.includes("items: items.slice(0, 30).map(failItem),") && AGENT.includes("function failItem(it, k) {"));
  ok_("บิลเดียวไม่ออกหลายรอบ = เพิ่มรายการใหม่ ไม่ทับรอบแรก", !AGENT.includes("const kept = list.filter(f => String(f.orderId) !== String(order.id));"));
  ok_("ใบยกเลิก/ย้ายโต๊ะ/พิมพ์ซ้ำที่ไม่ออก ก็เข้ารายการด้วย",
    AGENT.includes("await recordPrintFail(printers, { id: rp.bill, table_number: rp.table, ordered_by: rp.by }, its, { kind: rp.kind, from: rp.from, pid: p.id, pname: p.name });"));
  // ป้ายที่โต๊ะต้องบอกชื่อเครื่องที่ไม่ออก ไม่ใช่แค่ว่ามีใบไม่ออก (เจ้าของสั่ง 12 ก.ย. 69)
  ok_("บันทึกชื่อเครื่องที่ควรพิมพ์ใบนั้นไว้ด้วย", AGENT.includes("pnames: x.pname ? [String(x.pname)]"));
  ok_("ป้ายที่โต๊ะขึ้นชื่อเครื่องที่ไม่ออก", APP.includes("const failPrinterNames=(f)=>{") && APP.includes("{pn?pn+\" ไม่ออก\":\"ใบครัวไม่ออก\"}"));
  // กดรีปริ้นแล้วป้ายต้องหายไว ⟹ ผังโต๊ะอ่านรายการสดจากรอบถามเร็ว ไม่ใช่รอบดึงเครื่องพิมพ์ 60 วิ
  ok_("ผังโต๊ะอ่านรายการที่ไม่ออกจากรอบถามเร็ว", APP.includes("const failMap=printFailsOf(failPrinters||printers);") && APP.includes("failPrinters={failPrintersLive}"));
  ok_("รอบถามรายการที่ไม่ออกไม่เกิน 6 วินาที", APP.includes("if(!document.hidden)loadFails();},6000);"));
  ok_("ปุ่มขึ้นข้างปุ่มรายงาน เฉพาะตอนมีรายการค้าง",
    APP.includes("{failCount>0&&<Btn v=\"danger\" onClick={()=>setShowPrintFails(true)} icon={I.print} s={{padding:\"5px 10px\",fontSize:12}}>พิมพ์ไม่สำเร็จ ({failCount})</Btn>}\n        <Btn v=\"ghost\" onClick={()=>setShowOrders(true)}"));
  ok_("ถามเฉพาะเครื่องที่มีรายการค้าง (ปกติได้แถวว่าง ไม่เปลืองเน็ต)", APP.includes("description=like.*%22failed%22:%5B%7B*"));
  ok_("รีปริ้นอ่านของล่าสุดก่อนเขียน", APP.includes("async function editPrintFail(holderId,fn){\n  const all=await api.getAllPrinters();"));
  ok_("ในจอมีรีปริ้นท้ายชื่อเมนู + ปุ่มเอาออกเมื่อไม่ต้องพิมพ์แล้ว", APP.includes("onClick={()=>retry(f,[it.k])}") && APP.includes("onClick={()=>dismiss(f)}"));
}

// ══════════════════════════════════════════════════════════════════════════
// บรรทัดวิธีจ่ายที่ส่งเข้าบัญชี — ลำดับแม่ก่อนลูก · ลูกห้ามบวกซ้ำ · ชื่อต้องเป๊ะ
// ไทยช่วยไทย พลัส เข้าบัญชีบุคคล ส่วนตัวแม่ Custom Payment เข้าบัญชีบริษัท
// กอดรวมกัน = ยอดของคนละผู้เสียภาษีไปกองรวมกัน (ฝั่งบัญชีเคยเจอมาแล้ว ฿268,095)
// ══════════════════════════════════════════════════════════════════════════
section("วิธีจ่าย: บรรทัดแม่-ลูกที่ส่งเข้าบัญชี");
{
  const LS = SLIPPUSH.split("\n");
  const a = LS.findIndex(l => l.startsWith("const MAIN_PAY_METHODS ="));
  const b = LS.findIndex((l, i) => i > a && l === "}");
  let build = null;
  try { build = new Function(LS.slice(a, b + 1).join("\n") + "\nreturn buildPaymentLines;")(); } catch {}
  ok_("อ่านตัวสร้างบรรทัดวิธีจ่ายได้", !!build);
  if (build) {
    const bill = (pm, total) => ({ payment_method: pm, total });
    const { payment, mainSum } = build([
      bill("cash", 100), bill("promptpay", 50), bill("credit", 30),
      bill("thaiplus", 200), bill("bartercard", 70), bill("other", 10), bill(null, 5),
    ]);
    const at = (n) => payment.findIndex(p => p.name_th === n);
    const amt = (n) => { const p = payment.find(x => x.name_th === n); return p ? p.amount : null; };
    ck("ผลรวมชั้นหลักเท่ากับยอดขายจริง (ลูกไม่ถูกบวกซ้ำ)", mainSum, 465);
    ck("Custom Payment = ทุกช่องทางนอกชั้นหลักรวมกัน", amt("Custom Payment"), 285);
    ck("แยกบรรทัดไทยช่วยไทย พลัส ตามชื่อที่บัญชีใช้", amt("ไทยช่วยไทย พลัส"), 200);
    ck("แยกบรรทัด Bartercard ตามชื่อที่บัญชีใช้", amt("Bartercard"), 70);
    ok_("ชื่ออังกฤษของบรรทัดลูกตรงกับฝั่งบัญชี",
      payment.find(p => p.name_th === "ไทยช่วยไทย พลัส").name_en === "ไทยช่วยไทย พลัส"
      && payment.find(p => p.name_th === "Bartercard").name_en === "Bartercard");
    ok_("บรรทัดแม่มาก่อนบรรทัดลูกเสมอ (ส่งลูกก่อนแม่ = ยอดทั้งใบขาด)",
      at("Custom Payment") >= 0 && at("Custom Payment") < at("ไทยช่วยไทย พลัส") && at("Custom Payment") < at("Bartercard")
      && at("บัตรเครดิต (กรอกเอง)") < at("พร้อมเพย์"));
    ck("Σ บรรทัดลูก ≤ ยอดบรรทัดแม่", amt("ไทยช่วยไทย พลัส") + amt("Bartercard") <= amt("Custom Payment"), true);
    const only = build([bill("cash", 100), bill("other", 20)]);
    ok_("ไม่มีช่องทางย่อย = ไม่มีบรรทัดลูกติดไปด้วย", only.payment.length === 2 && only.payment[1].name_th === "Custom Payment" && only.mainSum === 120);
    const none = build([bill("cash", 100)]);
    ok_("ไม่มียอดนอกชั้นหลัก = ไม่มี Custom Payment", none.payment.length === 1 && none.mainSum === 100);
  }
  // ── ช่องทางในแอปกับบรรทัดที่ส่งบัญชี ต้องไปด้วยกัน ──
  // เพิ่มช่องทางใหม่ในจอขายแล้วลืมบอกบัญชี = ยอดไปกองรวมในตัวแม่เงียบๆ ทั้งที่ปลายทางคนละบัญชี
  const appPms = (() => {
    try {
      const L = APP.split("\n"); const i = L.findIndex(l => l.startsWith("const OTHER_PAY_METHODS="));
      const j = L.findIndex((l, k) => k > i && l.trim() === "];");
      return new Function(L.slice(i, j + 1).join("\n") + "\nreturn OTHER_PAY_METHODS;")().map(m => m.v);
    } catch { return null; }
  })();
  const childPms = [...SLIPPUSH.matchAll(/\{ pm: "([a-z0-9_]+)"/g)].map(m => m[1]);
  ok_("อ่านช่องทางย่อยได้ทั้งสองฝั่ง", Array.isArray(appPms) && appPms.length > 0 && childPms.length > 0);
  if (appPms) {
    const missing = appPms.filter(v => v !== "other" && !childPms.includes(v));
    ck("ทุกช่องทางย่อยในจอขาย มีบรรทัดของตัวเองฝั่งบัญชี (ขาด: " + (missing.join(",") || "-") + ")", missing.length, 0);
    const extra = childPms.filter(v => !appPms.includes(v));
    ck("ไม่มีบรรทัดบัญชีที่ไม่มีช่องทางในจอขายแล้ว (เกิน: " + (extra.join(",") || "-") + ")", extra.length, 0);
  }
}

// ══════════════════════════════════════════════════════════════════════════
// เปิดนับสต็อกนอกเวลาเฉพาะวัน (branches.stock_count_open_on) — เจ้าของสั่งเปิดให้ The River 12 ก.ย. 69
// ต้องเปิดเฉพาะสาขาที่ตั้งไว้ และเฉพาะวันนั้น · ค่าเพี้ยน/ว่าง = กลับไปใช้ช่วงเวลาปกติเสมอ
// ══════════════════════════════════════════════════════════════════════════
section("เปิดนับสต็อกนอกเวลาเฉพาะวัน");
{
  const L = APP.split("\n");
  const openFn = (() => {
    const a = L.findIndex(l => l.startsWith("const stockCountOpenToday=(branch)=>{"));
    const b = L.findIndex((l, i) => i > a && l === "};");
    try { return new Function(L.slice(a, b + 1).join("\n") + "\nreturn stockCountOpenToday;")(); } catch { return null; }
  })();
  const winFn = (() => {
    const a = L.findIndex(l => l.startsWith("function stockCountWindow(isCentral){"));
    const b = L.findIndex((l, i) => i > a && l === "}");
    try { return new Function("bkkWeekday", L.slice(a, b + 1).join("\n") + "\nreturn stockCountWindow;")(() => 1); } catch { return null; }
  })();
  ok_("อ่านตัวคุมเวลานับสต็อกได้", !!openFn && !!winFn);
  if (openFn && winFn) {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    const other = new Date(Date.now() - 86400000).toLocaleDateString("en-CA", { timeZone: "Asia/Bangkok" });
    ok_("ตั้งวันที่วันนี้ = เปิดให้นับนอกเวลา", openFn({ stock_count_open_on: today }) === true);
    ok_("รับรูปแบบที่มีเวลาต่อท้ายด้วย (timestamp จากฐาน)", openFn({ stock_count_open_on: today + "T00:00:00+07:00" }) === true);
    ok_("วันอื่น/วันเก่า = ปิดเอง ไม่ค้างเปิดข้ามวัน", openFn({ stock_count_open_on: other }) === false);
    ok_("ไม่ได้ตั้ง = ใช้ช่วงเวลาปกติ", openFn({}) === false && openFn(null) === false && openFn({ stock_count_open_on: null }) === false);
    ok_("ค่าเพี้ยน = ใช้ช่วงเวลาปกติ (ไม่เปิดมั่ว)", openFn({ stock_count_open_on: "เปิดเลย" }) === false && openFn({ stock_count_open_on: "2026-13-45" }) === false && openFn({ stock_count_open_on: true }) === false);
    // ช่วงเวลาปกติต้องไม่ถูกแตะ — สาขา 16:00–23:30 · ครัวกลาง 12:00–16:00
    const bw = winFn(false), cw = winFn(true);
    ck("ช่วงเวลาปกติของสาขายังเหมือนเดิม", [bw.s, bw.e], [960, 1410]);
    ck("ช่วงเวลาปกติของครัวกลางยังเหมือนเดิม", [cw.s, cw.e], [720, 960]);
  }
  ok_("ด่านเวลาเช็ควันเปิดพิเศษของ \"สาขาที่กำลังเปิดอยู่\" เท่านั้น",
    APP.includes("if(!stockCountOpenToday(currentBranch)&&(now<win.s||now>=win.e)){"));
  // ต้องยังกันนับทับรอบที่ Area ยังไม่อนุมัติ — การเปิดนอกเวลาไม่ใช่ใบผ่านให้ข้ามการอนุมัติ
  ok_("เปิดนอกเวลาแล้วยังกันนับทับรอบที่รออนุมัติเหมือนเดิม", APP.includes('title:"⏳ ต้องรออนุมัติก่อน"'));
}

// ══════════════════════════════════════════════════════════════════════════
// แก้ไขบิลที่ปิดแล้ว (12 ก.ย. 69) — เพิ่ม/ลดรายการ แล้วเก็บเพิ่มหรือคืนเงิน
// เงินของบิลที่ปิดไปแล้วคือเงินที่นับไปแล้ว: ยอดบิล · ลิ้นชัก · ยอดที่ส่งบัญชี ต้องขยับพร้อมกันเสมอ
// และห้ามแก้เงียบ — ต้องมีเหตุผลทุกครั้ง
// ══════════════════════════════════════════════════════════════════════════
section("แก้ไขบิลที่ปิดแล้ว");
{
  const L = APP.split("\n");
  const grabTop = (head, end) => { const a = L.findIndex(l => l.startsWith(head)); if (a < 0) return null; const b = L.findIndex((l, i) => i > a && l === end); return b > a ? L.slice(a, b + 1).join("\n") : null; };
  const line = (head) => L.find(l => l.startsWith(head)) || "";
  // ประกาศตัวช่วยเขียนได้หลายแบบ (มี/ไม่มีช่องว่างรอบ =) — จับด้วยชื่อล้วนๆ ปลอดภัยกว่า
  const lineRe = (name) => L.find(l => l.startsWith(name + "=") || l.startsWith(name + " =")) || "";
  const totalsFn = (() => {
    try {
      return new Function(
        [lineRe("const round2"), lineRe("const roundModeOf"), grabTop("const roundBill=(amount,mode)=>{", "};"),
         grabTop("function billTotalsOf({items,manualDiscount=0,promoDiscount=0,posSettings=null}){", "}")].join("\n")
        + "\nreturn billTotalsOf;")();
    } catch { return null; }
  })();
  const editableFn = (() => {
    try { return new Function([line("const EDIT_BILL_DAYS="), grabTop("const canEditPaidBill=(o)=>{", "};")].join("\n") + "\nreturn canEditPaidBill;")(); } catch { return null; }
  })();
  ok_("อ่านสูตรยอดบิลและกติกาวันที่แก้ได้", !!totalsFn && !!editableFn);
  if (totalsFn) {
    const S = { vat_enabled: true, vat_rate: 7, vat_included: true, service_charge_enabled: false };
    const items = (n) => Array.from({ length: n }, () => ({ price: 69, qty: 1 }));
    // บิลจริงที่เพิ่งแก้มือ (โต๊ะ A10): 4 แก้ว 276 → 3 แก้ว 207 ภาษี 13.54
    const four = totalsFn({ items: items(4), posSettings: S }), three = totalsFn({ items: items(3), posSettings: S });
    ck("ยอดและภาษีตรงกับบิลจริงที่เคยคิดไว้ (VAT ในราคา)", [four.total, four.vat, three.total, three.vat], [276, 18.06, 207, 13.54]);
    ck("ส่วนต่างที่ต้องคืนลูกค้าคือหนึ่งแก้วพอดี", Math.round((four.total - three.total) * 100) / 100, 69);
    const ex = totalsFn({ items: items(1), posSettings: { vat_enabled: true, vat_rate: 7, vat_included: false } });
    ck("VAT แบบบวกเพิ่ม = บวกเข้ายอด ไม่ใช่ถอดออก", [ex.vat, ex.total], [4.83, 73.83]);
    const sc = totalsFn({ items: items(1), posSettings: { service_charge_enabled: true, service_charge_rate: 10, vat_enabled: false } });
    ck("ค่าบริการคิดจากยอดหลังหักส่วนลด", [sc.sc, sc.total], [6.9, 75.9]);
    const dc = totalsFn({ items: items(1), manualDiscount: 200, posSettings: { vat_enabled: false } });
    ck("ส่วนลดมากกว่าค่าอาหาร = ยอดเป็นศูนย์ ไม่ติดลบ", dc.total, 0);
    const rd = totalsFn({ items: [{ price: 68.4, qty: 1 }], posSettings: { vat_enabled: false, rounding: "up" } });
    ck("ปัดเศษท้ายบิลตามที่ร้านตั้งไว้ และเก็บส่วนต่างการปัด", [rd.total, rd.roundAdj], [69, 0.6]);
  }
  if (editableFn) {
    const d = (days) => new Date(Date.now() - days * 86400000).toISOString();
    ok_("บิลที่ปิดวันนี้แก้ได้", editableFn({ status: "paid", updated_at: d(0) }) === true);
    ok_("ย้อนหลังได้ 7 วันตามที่เจ้าของสั่ง", editableFn({ status: "paid", updated_at: d(6.9) }) === true && editableFn({ status: "paid", updated_at: d(7.1) }) === false);
    ok_("บิลที่ยกเลิก/ยังไม่ปิด แก้ไม่ได้", editableFn({ status: "cancelled", updated_at: d(0) }) === false && editableFn({ status: "open", updated_at: d(0) }) === false);
  }
  // ── ต้องมีเหตุผลเสมอ · เงินต้องขยับให้ตรงทิศ · ห้ามเขียนทับคนอื่น ──
  ok_("ไม่ใส่เหตุผล กดยืนยันไม่ได้ (ปิดปุ่ม + กันซ้ำในตัวจัดการ)",
    APP.includes("disabled={saving||!reason.trim()}") && APP.includes('if(!reason.trim()){notifyDlg("กรุณาใส่เหตุผลที่แก้บิล");return;}'));
  ok_("เก็บเงินเพิ่ม = เงินเข้าลิ้นชัก · คืนเงิน = เงินออกลิ้นชัก (เงินสดเท่านั้น)",
    APP.includes('type:delta>0?"sale":"refund",amount:Math.abs(delta)') && APP.includes('if(delta!==0&&method==="cash"&&shift?.id){'));
  ok_("เงินสดแต่ยังไม่เปิดกะ = ไม่ให้ทำ (ลิ้นชักไม่มีที่ลง)", APP.includes('if(delta!==0&&method==="cash"&&!shift?.id)'));
  ok_("เขียนบิลแบบกันชนกัน (เขียนต่อเมื่อยังไม่มีใครแก้)", APP.includes("await api.updatePOSOrderIfUnchanged(order.id,order.updated_at,full)"));
  ok_("บันทึกร่องรอยทุกครั้ง พร้อมเหตุผลและส่วนต่าง", APP.includes("await api.addOrderEdit({order_id:order.id,") && APP.includes("delta,settle_method:delta!==0?method:null,"));
  ok_("เขียนร่องรอยไม่ได้ ต้องบอกดังๆ ไม่ใช่เงียบ", APP.includes('if(noTrail)posToast("⚠️ แก้บิลแล้ว แต่บันทึกร่องรอยไม่ได้'));
  ok_("บิลของวันที่ปิดกะไปแล้ว ต้องเตือนว่าต้องแจ้งบัญชี และติดธงไว้ในร่องรอย",
    APP.includes("const pastDay=!!(oldDay&&today&&oldDay!==today);") && APP.includes("needs_accounting:pastDay"));
  ok_("ของที่เพิ่ม = ใบสั่งอาหารปกติ · ของที่ลด = ใบยกเลิกไปครัว",
    APP.includes('if(added.length)await agentPrintItems(added,String(order.table_number||"-"),branch?.id,{bill:order.id,by:who,kind:""});')
    && APP.includes('kind:"void"}'));
  ok_("แก้เสร็จพิมพ์ใบเสร็จใบใหม่ให้ลูกค้า", APP.includes("await printBillReceipt({...order,...full,id:order.id},order.table_number,"));
  ok_("ใบเสร็จจอโต๊ะกับจอแก้บิลใช้ตัวพิมพ์ตัวเดียวกัน",
    APP.includes("const smartPrintReceipt=(order,tableNum,paid)=>printBillReceipt(order,tableNum,{branch,posSettings,printers,paid});"));
  ok_("ส่วนลดรายเมนูคิดใหม่เมื่อจำนวนเปลี่ยน (ไม่ลดเกินราคาอาหาร)", APP.includes("function recalcItemDiscounts(items){") && APP.includes("const amt=t===\"percent\"?round2(line*v/100):Math.min(v,line);"));
  ok_("ช่องทางเก็บเพิ่ม/คืนเงิน ใช้รายชื่อเดียวกับตอนปิดบิล ไม่มีรายชื่อซ้อนที่สอง",
    APP.includes("const SETTLE_METHODS=()=>[...PAY_METHODS.filter(m=>m.v!==\"other\"),...OTHER_PAY_METHODS];"));
  ok_("เปิดจอแก้บิลได้จากหน้าบิลในรายงาน", APP.includes("onEdit={()=>setEditBill(bill)}") && APP.includes("{onEdit&&canEditPaidBill(o)&&<div"));

  // ── ท่อบัญชี: บิลที่จ่ายหลายช่องทางต้องแยกยอดตามช่องทางจริง ──
  const LS = SLIPPUSH.split("\n");
  const a2 = LS.findIndex(l => l.startsWith("const MAIN_PAY_METHODS ="));
  const b2 = LS.findIndex((l, i) => i > a2 && l === "}");
  let build = null;
  try { build = new Function(LS.slice(a2, b2 + 1).join("\n") + "\nreturn buildPaymentLines;")(); } catch {}
  if (build) {
    const out = build([
      { payment_method: "cash", total: 276 },                                  // บิลปกติ
      { payment_method: "cash", total: 376, payments: [{ method: "cash", amount: 276 }, { method: "promptpay", amount: 100 }] },   // แก้บิลแล้วเก็บเพิ่มทางพร้อมเพย์
      { payment_method: "cash", total: 207, payments: [{ method: "cash", amount: 276 }, { method: "cash", amount: -69 }] },        // แก้บิลแล้วคืนเงินสด
    ]);
    const amt = (n) => { const p = out.payment.find(x => x.name_th === n); return p ? p.amount : 0; };
    ck("ยอดเงินสดหักเงินที่คืนไปแล้ว", amt("เงินสด"), 759);
    ck("ยอดที่เก็บเพิ่มทางพร้อมเพย์ไปอยู่ช่องพร้อมเพย์", amt("พร้อมเพย์"), 100);
    ck("ผลรวมชั้นหลักยังเท่ายอดขายจริงทั้งสามใบ", out.mainSum, 859);
  } else ok_("อ่านตัวสร้างบรรทัดวิธีจ่ายได้ (หลังรองรับหลายช่องทาง)", false);
  ok_("ท่อบัญชีดึงช่องทางที่จ่ายจริงมาด้วย", SLIPPUSH.includes("payment_method,payments,created_at,updated_at"));
}

// ══════════════════════════════════════════════════════════════════════════
// เปิดลิ้นชักเก็บเงินอัตโนมัติ (เจ้าของสั่ง 12 ก.ย. 69) — กด "เงินในลิ้นชัก" แล้วลิ้นชักเด้งออก
// ลิ้นชักต่อ RJ11 อยู่กับเครื่องพิมพ์ ⟹ ต้องสั่งผ่านตัวพิมพ์ที่ร้าน ไม่ใช่จากเบราว์เซอร์ตรงๆ
// ══════════════════════════════════════════════════════════════════════════
section("เปิดลิ้นชักเก็บเงิน");
{
  const L = APP.split("\n");
  const a = L.findIndex(l => l.startsWith("const drawerPrinters=(printers)=>{"));
  const b = L.findIndex((l, i) => i > a && l === "};");
  let pick = null;
  try {
    pick = new Function("getPConn", "getReceiptPrinters", L.slice(a, b + 1).join("\n") + "\nreturn drawerPrinters;")(
      () => ({ type: "net" }),
      (list) => (list || []).filter(p => { try { return JSON.parse(p.description || "{}").rcpt === 1; } catch { return false; } }));
  } catch {}
  ok_("อ่านตัวเลือกเครื่องที่ต่อลิ้นชักได้", !!pick);
  if (pick) {
    const P = (id, d, extra) => ({ id, ip: "10.0.0." + id, description: JSON.stringify(d), ...(extra || {}) });
    const kitchen = P(1, {}), cashier = P(2, { rcpt: 1 }), withDrawer = P(3, { dw: 1 });
    ck("ติ๊กไว้ว่าลิ้นชักต่อเครื่องไหน = สั่งเครื่องนั้นเครื่องเดียว", pick([kitchen, cashier, withDrawer]).map(p => p.id).join(), "3");
    ck("ไม่ได้ติ๊กเลย = ใช้เครื่องพิมพ์ใบเสร็จ", pick([kitchen, cashier]).map(p => p.id).join(), "2");
    ck("ไม่มีทั้งสองอย่าง = ไม่สั่งอะไรเลย (ไม่ไปเปิดลิ้นชักผิดเครื่อง)", pick([kitchen]).length, 0);
    ck("เครื่องที่ปิดใช้งาน/ไม่มี IP ไม่ถูกสั่ง", pick([P(3, { dw: 1 }, { active: false }), { id: 4, description: JSON.stringify({ dw: 1 }) }]).length, 0);
    ck("ช่องข้อมูลเสีย ไม่ทำให้จอพัง", pick([{ id: 5, ip: "10.0.0.5", description: "{พัง" }]).length, 0);
  }
  ok_("คำสั่งเปิดลิ้นชักเป็นคำสั่งครั้งเดียวจบ เหมือน tp/rp/qr/pj", APP.includes('const CMD_KEYS=["tp","rp","qr","pj","dk"];'));
  ok_("กดเข้าจอเงินในลิ้นชัก = สั่งเปิดหนึ่งครั้ง", APP.includes("useEffect(()=>{openDrawer(false);},[]);"));
  ok_("มีปุ่มสั่งเปิดลิ้นชักซ้ำในจอ", APP.includes('onClick={()=>openDrawer(true)} title="สั่งเปิดลิ้นชักเก็บเงิน"'));
  ok_("ไม่มีเครื่องที่ต่อลิ้นชัก ต้องบอกว่าไปตั้งที่ไหน", APP.includes("ยังไม่ได้ตั้งว่าลิ้นชักต่อกับเครื่องไหน"));
  ok_("มีช่องติ๊ก \"ลิ้นชักเก็บเงินต่อกับเครื่องนี้\" ในกำหนดการพิมพ์ และบันทึกค่าได้",
    APP.includes("💵 ลิ้นชักเก็บเงินต่อกับเครื่องนี้") && APP.includes("if(sDraw)dd.dw=1;else delete dd.dw;") && APP.includes("setSDraw(dd.dw===1);"));
  // ── ฝั่งตัวพิมพ์ ──
  ok_("ตัวพิมพ์ยิงคำสั่งเปิดลิ้นชักทั้งขา 2 และขา 5", AGENT.includes("const DRAWER_KICK = Buffer.from([0x1b, 0x70, 0x00, 0x19, 0xfa, 0x1b, 0x70, 0x01, 0x19, 0xfa]);"));
  ok_("ตัวพิมพ์รับคำสั่งเปิดลิ้นชักทุกรอบ", AGENT.includes("  await handleDrawerRequests(printers);"));
  // ลิ้นชักต้องเปิดทันทีที่กดตกลง — รอรอบปกติ 5 วิ ช้าเกินไปเวลาถือเงินลูกค้าอยู่
  // แต่ห้ามดึงของหนักถี่ๆ: คิวรีรอบเร็วต้องกรองว่ามีคำสั่งอยู่จริง ปกติได้แถวว่าง
  ok_("มีรอบเร็วเฉพาะคำสั่งเปิดลิ้นชัก และไม่เกิน 1 วินาที",
    /const DRAWER_POLL_MS = (\d+);/.test(AGENT) && +AGENT.match(/const DRAWER_POLL_MS = (\d+);/)[1] <= 1000);
  ok_("รอบเร็วกรองเฉพาะเครื่องที่มีคำสั่งค้างอยู่ (ไม่ดึงตารางทั้งใบ)",
    AGENT.includes("or=(description.like.*%22dk%22:%7B*,description.like.*%22pj%22:%7B*,description.like.*%22rp%22:%7B*,description.like.*%22qr%22:%7B*)"));
  // ── งานพิมพ์ทุกอย่างที่คนยืนรอ ต้องวิ่งในรอบเร็ว ไม่ใช่รอรอบหลัก ──
  ok_("รอบเร็วทำครบทั้งลิ้นชัก ใบเสร็จ พิมพ์ซ้ำ/ใบยกเลิก และ QR โต๊ะ",
    AGENT.includes("        await handleDrawerRequests(rows);\n        await handlePJRequests(rows);\n        await handleQRRequests(rows);\n        await handleReprintRequests(rows);"));
  // คำสั่งที่ไม่ถูกล้าง = ค้างในแถวตลอดวัน (rp พกรายการอาหารไปด้วย) และรอบเร็วจะเจอแถวเดิมซ้ำทุก 0.8 วิ
  ok_("คำสั่งพิมพ์ซ้ำ/QR ถูกล้างทิ้งหลังทำ เหมือน pj และ dk",
    AGENT.includes('await clearCmdKey(p.id, "rp", rp.at);') && AGENT.includes('await clearCmdKey(p.id, "qr", q.at);'));
  // ── รอบหลัก: ถามบิลถี่ขึ้น แต่ของหนักต้องไม่ถูกดึงถี่ตาม ──
  ok_("รอบหลักไม่เกิน 2 วินาที", /const POLL_MS = (\d+);/.test(AGENT) && +AGENT.match(/const POLL_MS = (\d+);/)[1] <= 2000);
  ok_("รายชื่อเครื่องพิมพ์ (ก้อนใหญ่) ถูกใช้ซ้ำ ไม่ดึงใหม่ทุกรอบ",
    AGENT.includes("async function getPrintersCached() {") && AGENT.includes("getActiveOrderHeads(), getPrintersCached()"));
  ok_("ตัวเรนเดอร์ใบครัวถูกอุ่นไว้ และเซิร์ฟเวอร์รับคำขออุ่นแบบเบา",
    AGENT.includes("setInterval(warmSlip, 4 * 60 * 1000);") && SLIP.includes('if (req.method === "GET") {') && SLIP.includes("warm: true"));
  ok_("ออเดอร์ใบใหญ่เรนเดอร์พร้อมกันได้มากขึ้น", AGENT.includes("return mapLimit(items || [], 10, async it => {"));
  ok_("รอบเร็วกันซ้อนรอบตัวเอง", AGENT.includes("if (kickBusy) return;"));
  ok_("มาร์คก่อนส่ง (tick ซ้อนไม่เปิดลิ้นชักซ้ำ) และล้างคำสั่งทิ้งหลังทำ",
    AGENT.includes("state.kicked[p.id] = k.at; saveState();") && AGENT.includes('await clearCmdKey(p.id, "dk", k.at);'));
  ok_("จำคำสั่งที่ทำแล้วข้ามการรีสตาร์ท", AGENT.includes("if (!state.kicked) state.kicked = {};"));
  // เงินสดเข้า/ออกจริงเมื่อไหร่ ลิ้นชักต้องเปิดเมื่อนั้น — และห้ามทำให้การปิดบิลล้มเด็ดขาด
  // บิลใบเดียวจ่ายได้หลายช่องทาง ⟹ เงื่อนไขคือ "มีส่วนที่เป็นเงินสดจริง" ไม่ใช่ "ทั้งบิลเป็นเงินสด"
  ok_("มีเงินสดในบิล = ลิ้นชักเปิดให้ทอน (ยิงแบบไม่รอผล กลืน error)",
    APP.includes('if(cashPart>0)kickCashDrawer(printers,branch?.id).catch(()=>{});'));
  ok_("แก้บิลแล้วเก็บเพิ่ม/คืนเป็นเงินสด = ลิ้นชักเปิดด้วย",
    APP.includes('if(delta!==0&&method==="cash")kickCashDrawer(printers,branch?.id).catch(()=>{});'));
  // จ่ายพร้อมเพย์/ช่องทางอื่น ลิ้นชักต้องไม่เปิด — ทุกจุดที่สั่งเปิดต้องผูกกับเงื่อนไขเงินสดหรือปุ่มที่คนกดเอง
  // จ่ายเงินสด: กดตกลง → ลิ้นชักเปิด → บอกเงินทอนทันที แล้วค่อยรอใบเสร็จ/เปลี่ยนรหัส QR โต๊ะ
  // ถ้าป็อปอัพเงินทอนไปอยู่หลังการเปลี่ยน QR (รอได้ถึง 4 วิ) พนักงานจะยืนรอโดยไม่รู้ว่าต้องทอนเท่าไร
  ok_("กดตกลงเงินสด = สั่งเปิดลิ้นชักก่อนพิมพ์ใบเสร็จ",
    APP.indexOf('if(pm==="cash")kickCashDrawer') < APP.indexOf('const _rcpt=smartPrintReceipt('));
  ok_("บอกเงินทอนก่อนรอใบเสร็จและก่อนเปลี่ยนรหัส QR โต๊ะ",
    APP.indexOf("onCashChange({change:round2") < APP.indexOf("await _rcpt;"));
  ck("จุดที่สั่งเปิดลิ้นชักมีเท่าที่ตั้งใจไว้ (ประกาศ + จอลิ้นชัก + ปิดบิลเงินสด + แก้บิลเงินสด)",
    (APP.match(/kickCashDrawer\(/g) || []).length, 4);
  ok_("ขยับเวอร์ชันตัวพิมพ์แล้ว (ร้านอัปเดตเอง)", +((AGENT.match(/const AGENT_VERSION = (\d+);/) || [])[1] || 0) >= 41);
}

// ══════════════════════════════════════════════════════════════════════════
// แบ่งจ่ายหลายช่องทาง (เจ้าของสั่ง 12 ก.ย. 69) — ใส่จำนวน → เลือกช่องทาง → ทำซ้ำจนครบยอด
// เงินสดต้องเป็นขั้นสุดท้ายเสมอ เพราะเป็นขั้นเดียวที่มีเงินทอน
// เงินที่เข้าลิ้นชักต้องเป็น "เฉพาะส่วนที่เป็นเงินสด" ไม่ใช่ยอดทั้งบิล ไม่งั้นปิดกะเงินเกินทุกครั้ง
// ══════════════════════════════════════════════════════════════════════════
section("แบ่งจ่ายหลายช่องทาง");
{
  const L = APP.split("\n");
  const lineOf = (name) => L.find(l => l.startsWith(name + "=") || l.startsWith(name + " =")) || "";
  const grabTop = (head, end) => { const a = L.findIndex(l => l.startsWith(head)); if (a < 0) return null; const b = L.findIndex((l, i) => i > a && l === end); return b > a ? L.slice(a, b + 1).join("\n") : null; };

  // ── ยอดตามช่องทางในสรุปกะ: บิลแบ่งจ่ายต้องถูกแยกตามช่องทางจริง ──
  let totalsFn = null;
  try {
    totalsFn = new Function("round2", grabTop("function computeShiftTotals({movements,orders,actualCash,cancelled,openBills}){", "}") + "\nreturn computeShiftTotals;")(
      (n) => Math.round((+n || 0) * 100) / 100);
  } catch {}
  ok_("อ่านสูตรยอดกะได้", !!totalsFn);
  if (totalsFn) {
    const mv = [{ type: "opening", amount: 1000 }, { type: "sale", amount: 285 }];
    const t = totalsFn({
      movements: mv, actualCash: 1285, cancelled: [], openBills: [],
      orders: [
        { total: 500, payment_method: "promptpay" },                                   // บิลปกติช่องทางเดียว
        { total: 1285, payment_method: "mixed", payments: [{ method: "promptpay", amount: 1000 }, { method: "cash", amount: 285 }] },   // แบ่งจ่าย
        { total: 207, payment_method: "cash", payments: [{ method: "cash", amount: 276 }, { method: "cash", amount: -69 }] },           // แก้บิลแล้วคืนเงินสด
      ],
    });
    ck("ยอดขายรวมยังนับจากยอดบิล ไม่ใช่ผลรวมช่องทาง", t.totalSales, 1992);
    ck("เงินสดนับเฉพาะส่วนที่เป็นเงินสดจริง (รวมส่วนที่คืนไป)", t.totalCash, 492);
    ck("พร้อมเพย์ได้ส่วนของมันครบ", t.totalTransfer, 1500);
    ck("ผลรวมทุกช่องทางต้องเท่ายอดขาย", Math.round((t.totalCash + t.totalTransfer + t.totalCard + t.totalOther) * 100) / 100, 1992);
  }

  // ── คำสั่งพิมพ์ที่เครื่องแคชเชียร์ทับกัน ──
  // เปิดลิ้นชัก + ใบเสร็จ ถูกสั่งห่างกันไม่ถึงวินาที ถ้าคำสั่งใหม่ลบของเก่า ลิ้นชักจะไม่เปิด
  let cmd = null;
  try {
    cmd = new Function([lineOf("const CMD_KEYS"), lineOf("const CMD_FRESH_MS"), grabTop("function cmdDesc(printer,key,val){", "}")].join("\n") + "\nreturn cmdDesc;")();
  } catch {}
  ok_("อ่านตัวเขียนคำสั่งลงเครื่องพิมพ์ได้", !!cmd);
  if (cmd) {
    const now = Date.now();
    const withPj = { description: JSON.stringify({ rcpt: 1, dw: 1, on: true, pj: { at: now - 200, b64: "x" } }) };
    const afterDk = JSON.parse(cmd(withPj, "dk", { at: now }));
    ok_("สั่งเปิดลิ้นชักแล้ว งานพิมพ์ใบเสร็จที่เพิ่งสั่งต้องไม่หาย", !!afterDk.pj && !!afterDk.dk);
    ok_("ค่าตั้งค่าของเครื่อง (เครื่องใบเสร็จ/ลิ้นชัก/สถานะ) ไม่ถูกลบ", afterDk.rcpt === 1 && afterDk.dw === 1 && afterDk.on === true);
    const stale = { description: JSON.stringify({ pj: { at: now - 10 * 60 * 1000 }, rp: { at: now - 10 * 60 * 1000 } }) };
    const afterStale = JSON.parse(cmd(stale, "dk", { at: now }));
    ok_("คำสั่งค้างเก่า (ตัวพิมพ์ดับไปนาน) ถูกทิ้ง ไม่พิมพ์ย้อนหลัง", !afterStale.pj && !afterStale.rp && !!afterStale.dk);
    const broken = { description: "{พัง" };
    ok_("ช่องข้อมูลเสีย ยังเขียนคำสั่งได้", JSON.parse(cmd(broken, "dk", { at: now })).dk.at === now);
  }

  // ── จอแบ่งจ่าย ──
  ok_("ปุ่มแบ่งจ่ายอยู่ในป็อปอัพถามวิธีจ่าย (ไม่ใช่แถบล่างแล้ว)",
    APP.includes('onClick={()=>{setParts([]);setPartAmt("");setAskPay("split");}}') && !APP.includes('<button onClick={onSplit} title="แบ่งจ่ายหลายคน"'));
  ok_("เงินสดกดได้เฉพาะขั้นสุดท้าย (ขั้นที่เหลือพอดี) เพราะต้องทอนเงิน",
    APP.includes("const lastStep=partNow>0&&round2(remain-partNow)===0;") && APP.includes('(mt.v==="cash"&&!lastStep)'));
  ok_("ใส่เกินยอดที่เหลือไม่ได้", APP.includes("if(partNow<=0||partNow>remain)return;"));
  ok_("มีคอลัมน์บอกว่าจ่ายไปกี่ขั้น ขั้นละเท่าไร ด้วยช่องทางอะไร",
    APP.includes(">จ่ายไปแล้ว</div>") && APP.includes("{payMethodLabel(p.method)}") && APP.includes("{i===parts.length-1&&<button onClick={()=>setParts(a=>a.slice(0,-1))}"));
  ok_("ปิดบิลได้ต่อเมื่อจ่ายครบยอดพอดี", APP.includes("disabled={saving||remain!==0||parts.length===0}"));
  ok_("แบ่งบิลตามคน (ของเดิม) ยังเข้าถึงได้จากจอแบ่งจ่าย", APP.includes("แบ่งบิลตามคน (พิมพ์ใบตัวอย่างให้ลูกค้าดู)"));
  // ── เงินสดของบิลแบ่งจ่าย ──
  ok_("ลิ้นชักเปิดเฉพาะเมื่อมีขั้นที่เป็นเงินสด", APP.includes("if(cashPart>0)kickCashDrawer(printers,branch?.id).catch(()=>{});"));
  ok_("ลิ้นชักได้เฉพาะยอดส่วนที่เป็นเงินสด ไม่ใช่ทั้งบิล",
    APP.includes('type:"sale",amount:cashPart,') && APP.includes("if(cashPart>0&&shift){"));
  ok_("เงินทอนคิดจากขั้นเงินสด ไม่ใช่ยอดบิล", APP.includes("onCashChange({change:round2(Math.max(0,(+cashReceived||0)-cashPart)),received:+cashReceived||0,total:cashPart,"));
  ok_("บิลเก็บช่องทางที่จ่ายจริงไว้ทุกขั้น", APP.includes("payments:paymentsCol,paid_by:"));
  ok_("จ่ายช่องทางเดียวยังเก็บเป็นช่องทางนั้น · หลายช่องทางจึงเป็น mixed",
    APP.includes('const pmCol=payParts?(payParts.length===1?payParts[0].method:"mixed"):pm;'));
  ok_("ใบเสร็จแจกแจงว่าขั้นไหนจ่ายเท่าไรด้วยอะไร",
    APP.includes("if(Array.isArray(order.payments)&&order.payments.length>1)") && APP.includes("const splitLines="));
}

// ══════════════════════════════════════════════════════════════════════════
// ของที่พิมพ์ไปแล้วห้ามออกซ้ำเอง (เจ้าของสั่ง 12 ก.ย. 69 หลังเจอของจริง)
// บิลโต๊ะ C13 ถูกปิดผิดแล้วเปิดคืน → ความจำในเครื่องถูกล้างตอนบิลปิด ตัวพิมพ์เห็นเป็นบิลใหม่
// แล้วพิมพ์อาหารทั้งโต๊ะซ้ำ ครัวทำซ้ำทั้งโต๊ะ ⟹ ความจำต้องอยู่บนตัวบิลด้วย ไม่ใช่แค่ในเครื่อง
// ══════════════════════════════════════════════════════════════════════════
section("พิมพ์แล้วห้ามออกซ้ำเอง");
{
  const LG = AGENT.split("\n");
  const lineOf = (head) => LG.find((l) => l.startsWith(head)) || "";
  let fn = null;
  try {
    fn = new Function("state", [lineOf("const lastSigOf ="), lineOf("const isFirstSight =")].join("\n") + "\nreturn { lastSigOf, isFirstSight };");
  } catch {}
  ok_("อ่านตัวตัดสินใจว่าเคยพิมพ์ไปแล้วหรือยังได้", !!fn);
  if (fn) {
    const memEmpty = fn({ sig: {}, init: {} });
    const memHas = fn({ sig: { 7: "SIG-เครื่องจำไว้" }, init: { 7: 1 } });
    const reopened = { id: 7, printed_sig: "SIG-บนบิล" };
    // เคสจริง: บิลถูกปิดแล้วเปิดคืน ความจำในเครื่องหายไปแล้ว แต่ตัวบิลยังจำได้
    ok_("บิลที่เคยพิมพ์แล้ว ถึงความจำในเครื่องหาย ก็ไม่ใช่บิลใหม่", memEmpty.isFirstSight(reopened) === false);
    ck("ใช้ลายเซ็นบนบิลแทนเมื่อในเครื่องไม่มี", memEmpty.lastSigOf(reopened), "SIG-บนบิล");
    ck("ความจำในเครื่องมาก่อนเสมอ (สดกว่า)", memHas.lastSigOf(reopened), "SIG-เครื่องจำไว้");
    ok_("บิลใหม่จริงๆ (ไม่เคยพิมพ์เลย) ยังถือว่าใหม่", memEmpty.isFirstSight({ id: 9 }) === true && memEmpty.lastSigOf({ id: 9 }) === null);
  }
  ok_("จดลายเซ็นลงบิลหลังพิมพ์ผ่าน แบบไม่แตะเวลาแก้ไขบิล",
    AGENT.includes("function rememberPrinted(id, sig) {") && AGENT.includes('body: JSON.stringify({ printed_sig: sig }),') && !AGENT.includes("printed_sig: sig, updated_at"));
  ok_("ดึงลายเซ็นบนบิลมาด้วยทุกคำขอ และมีทางถอยถ้ายังไม่มีคอลัมน์",
    AGENT.includes("async function sbCols(path, cols, tail) {") && AGENT.includes("_noPrintedSig = true;"));
  ok_("ตัดสินใจพิมพ์จากความจำสองชั้น", AGENT.includes("const sig = sigOf(o), last = lastSigOf(o), first = isFirstSight(o);"));
  // ยังต้องพิมพ์ "เฉพาะส่วนที่เพิ่มขึ้น" เหมือนเดิม ไม่ใช่ทั้งบิล
  ok_("บิลที่เคยพิมพ์แล้วมีของเพิ่ม = พิมพ์เฉพาะที่เพิ่ม", AGENT.includes("const items = newItemsVs(last, o.items);"));
}

// ══════════════════════════════════════════════════════════════════════════
// ยกเลิกรายการอาหารต้องหายจากบิลจริง ไม่ใช่หายแค่บนจอ (เจอจริง 12 ก.ย. 69)
// ใบยกเลิกออกที่ครัวแล้ว แต่พอเข้าหน้าชำระเงิน/เปิดโต๊ะใหม่ รายการนั้นยังอยู่
// เพราะเทียบแถวด้วย เมนู+หมายเหตุ+ตัวเลือก ถ้าเทียบไม่ตรงก็เอาออกแค่บนจอแล้วเงียบ
// ══════════════════════════════════════════════════════════════════════════
section("ยกเลิกรายการต้องหายจากบิลจริง");
{
  const L = APP.split("\n");
  const a = L.findIndex((l) => l.startsWith("const findSentIndex=(rows,target,keyOf)=>{"));
  const b = L.findIndex((l, i) => i > a && l === "};");
  let find = null;
  try { find = new Function(L.slice(a, b + 1).join("\n") + "\nreturn findSentIndex;")(); } catch {}
  ok_("อ่านตัวหาแถวที่จะยกเลิกได้", !!find);
  if (find) {
    const key = (i) => `${i.menu_id}|${i.note || ""}|${(i.options || []).map((o) => o.name).join(",")}`;
    const rows = [
      { line_uid: "A", menu_id: 5, note: "", options: [] },
      { line_uid: "B", menu_id: 5, note: "", options: [] },
      { line_uid: "C", menu_id: 9, note: "เผ็ดน้อย", options: [{ name: "ไข่" }] },
    ];
    ck("ผูกกับแถวตรงตัวด้วย line_uid (เมนูซ้ำกันก็ไม่โดนผิดแถว)", find(rows, { line_uid: "B", menu_id: 5 }, key), 1);
    ck("แถวเก่าที่ไม่มี line_uid ยังเทียบด้วยเมนู+หมายเหตุ+ตัวเลือกได้", find(rows, { menu_id: 9, note: "เผ็ดน้อย", options: [{ name: "ไข่" }] }, key), 2);
    ck("line_uid ไม่ตรงใครเลย = ถอยไปเทียบด้วยคีย์ประกอบ", find(rows, { line_uid: "ไม่มีจริง", menu_id: 5, note: "", options: [] }, key), 0);
    ck("ไม่มีในบิลแล้ว = บอกว่าไม่เจอ (ห้ามเดาว่าเป็นแถวแรก)", find(rows, { line_uid: "Z", menu_id: 77 }, key), -1);
    ck("บิลว่าง/ข้อมูลเพี้ยน ไม่ทำให้จอพัง", [find(null, { menu_id: 1 }, key), find([], { menu_id: 1 }, key)], [-1, -1]);
  }
  // ต้องอ่านบิลล่าสุดจากฐานก่อนตัดสินใจ — สำเนาในจออาจเก่ากว่าความจริง
  ok_("อ่านบิลล่าสุดจากฐานก่อนยกเลิก", APP.includes("try{const r=await api.getPOSOrderById(existingOrder.id);fresh=Array.isArray(r)?r[0]:r;}catch{}"));
  ok_("อ่านไม่ได้ = ไม่ยกเลิก (ห้ามเอาออกแค่บนจอ)", APP.includes('notifyDlg("อ่านบิลล่าสุดไม่ได้ (เน็ตสะดุด) — ยังไม่ได้ยกเลิกรายการนี้ กรุณาลองใหม่");return;'));
  ok_("เขียนกลับจากรายการจริงในฐาน และกันชนกันด้วยเวลาแก้ล่าสุดของฐาน",
    APP.includes("const newSent=dbItems.filter((_,i)=>i!==at);") && APP.includes("await api.updatePOSOrderIfUnchanged(existingOrder.id,fresh.updated_at,{items:newSent,"));
  ok_("ไม่มีในฐานแล้ว = บอกพนักงาน แล้วปรับจอให้ตรงกับบิลจริง",
    APP.includes('posToast("รายการนี้ถูกเอาออกไปก่อนหน้านี้แล้ว — จอถูกอัปเดตให้ตรงกับบิลจริง","warn",6000);'));
  ok_("ยกเลิกเสร็จแล้วให้จอแม่ดึงบิลใหม่ (เปิดโต๊ะซ้ำต้องไม่เห็นของที่ยกเลิก)",
    APP.includes("    onDone&&onDone();   // ให้จอแม่ดึงบิลใหม่"));
}

// ══════════════════════════════════════════════════════════════════════════
// มีเวอร์ชันใหม่ขึ้นระบบแล้วต้องบอกที่หน้าจอ — ร้านเจอซ้ำๆ ว่าแก้แล้วแต่เครื่องยังใช้ของเก่า
// (12 ก.ย. 69: บิล #129 จ่ายแบบแบ่งจ่าย แต่ไม่มีข้อมูลบันทึกเพราะเครื่องยังรันโค้ดชุดเก่า)
// ⚠️ ห้ามรีโหลดเอง — พนักงานอาจกำลังคิดเงินอยู่กลางบิล
// ══════════════════════════════════════════════════════════════════════════
section("แจ้งเมื่อมีเวอร์ชันใหม่");
{
  ok_("มีตัวเช็คเวอร์ชันใหม่ในจอขาย", APP.includes("function useNewBuild(){") && APP.includes("const hasNewBuild=useNewBuild();"));
  ok_("เทียบจากชื่อไฟล์โปรแกรมที่มีแฮช (เปลี่ยนทุกครั้งที่ขึ้นระบบ)", APP.includes("assets") && APP.includes("fresh.includes(cur)"));
  ok_("อ่าน index.html แบบไม่เอาของในแคช", APP.includes("fetch(\"/index.html?_=\"+Date.now(),{cache:\"no-store\"})"));
  ok_("ขึ้นแถบให้แตะเอง ไม่รีโหลดกลางบิล",
    APP.includes("{hasNewBuild&&<button onClick={()=>{try{location.reload();}catch{}}}") && !APP.includes("setTimeout(()=>location.reload()"));
  ok_("หยุดเช็คเมื่อออกจากจอ และไม่เช็คตอนจอถูกซ่อน", APP.includes("return()=>{stop=true;clearInterval(t);document.removeEventListener(\"visibilitychange\",onVis);};"));
}

// ── รายงานยอดขาย: สิ่งที่เพิ่งเกิดล่าสุดต้องอยู่บนสุด (เจ้าของสั่ง 12 ก.ย. 69) ──
// เดิมเรียงตามเวลาเปิดโต๊ะ บิลที่เพิ่งปิด/เพิ่งแก้จึงจมอยู่กลางรายการ กลับมาดูแลต่อไม่เจอ
section("รายงาน: ล่าสุดอยู่บนสุด");
{
  const L = APP.split("\n");
  const a = L.findIndex((l) => l.startsWith("const billActedAt=(o)=>{"));
  const b = L.findIndex((l, i) => i > a && l === "};");
  let at = null;
  try { at = new Function(L.slice(a, b + 1).join("\n") + "\nreturn billActedAt;")(); } catch {}
  ok_("อ่านตัวจับเวลาล่าสุดของบิลได้", !!at);
  if (at) {
    const open = "2026-09-12T10:44:00Z", closed = "2026-09-12T12:23:00Z";
    ck("ใช้เวลาที่เพิ่งเกิดเรื่องล่าสุด ไม่ใช่เวลาเปิดโต๊ะ", at({ created_at: open, updated_at: closed }), Date.parse(closed));
    ck("บิลที่ยังไม่เคยถูกแตะ ใช้เวลาเปิดโต๊ะ", at({ created_at: open }), Date.parse(open));
    ck("ข้อมูลเวลาเพี้ยน = 0 (ไม่ทำให้การเรียงพัง)", [at({}), at(null), at({ updated_at: "เมื่อวาน" })], [0, 0, 0]);
    // บิลที่เปิดทีหลัง (11:00) แต่ไม่มีใครแตะ ต้องอยู่ใต้บิลเก่าที่เพิ่งถูกแก้ตอน 12:23
    const rows = [{ created_at: "2026-09-12T11:00:00Z" }, { created_at: open, updated_at: closed }];
    ck("บิลเก่าที่เพิ่งถูกแก้ ต้องขึ้นมาอยู่บนสุด", rows.slice().sort((x, y) => at(y) - at(x))[0].updated_at, closed);
  }
  ok_("รายงานเรียงด้วยเวลาล่าสุดจริง", APP.includes("const list=baseList.slice().sort((a,b)=>billActedAt(b)-billActedAt(a));"));
  ok_("การ์ดบอกทั้งเวลาเปิดโต๊ะและเวลาล่าสุด", APP.includes("ล่าสุด ") && APP.includes("const open=hhmm(o.created_at),act=o.updated_at?hhmm(o.updated_at):open;"));
}

// ── เวลาส่งครัวของแต่ละรายการ (เจ้าของสั่ง 12 ก.ย. 69) ──────────────────────
// พนักงานต้องไล่เช็คได้ว่ารายการไหนส่งรอบไหน จะได้รู้ว่าไม่ใช่ของซ้ำ
// ติดเวลาที่ posAppendItems ที่เดียว เพราะทุกทาง (พนักงานกดส่ง + ลูกค้าสแกนสั่ง) ผ่านที่นั่น
section("เวลาส่งครัวรายรายการ");
{
  ok_("ติดเวลาส่งครัวตอนส่งจริง ที่จุดเดียวที่ทุกทางผ่าน",
    APP.includes("{ const _at=new Date().toISOString(); newItems=(newItems||[]).map(i=>(i&&i.sent_at)?i:{...i,sent_at:_at}); }"));
  ok_("ของที่เคยติดเวลาแล้ว ไม่ถูกเขียนทับ (ส่งซ้ำ/ลองใหม่ ก็ยังเป็นเวลาเดิม)", APP.includes("(i&&i.sent_at)?i:"));
  ok_("จอโต๊ะโชว์เวลาส่งครัวใต้ชื่อรายการ", APP.includes("🕘 ส่งครัว ") && APP.includes("{!unsent&&item.sent_at&&(()=>{"));
  ok_("แถวที่ยังไม่ได้ส่ง ไม่โชว์เวลา", APP.includes("{!unsent&&item.sent_at"));
}

console.log(`\n════════════════════════════════════════════════════`);
console.log(fail === 0 ? `✅ ผ่านทั้งหมด ${pass} ข้อ` : `❌ ล้มเหลว ${fail} ข้อ (ผ่าน ${pass})`);
process.exitCode = fail ? 1 : 0;
