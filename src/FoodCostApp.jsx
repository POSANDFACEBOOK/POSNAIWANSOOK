import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Design Tokens ──────────────────────────────────────
const C = {
  brand: "#FF6B35",
  brandDark: "#E85520",
  brandLight: "#FFF4F0",
  brandBorder: "#FFD4C2",
  green: "#10B981", greenLight: "#ECFDF5", greenDark: "#065F46",
  blue: "#3B82F6", blueLight: "#EFF6FF", blueDark: "#1E40AF",
  yellow: "#F59E0B", yellowLight: "#FFFBEB", yellowDark: "#92400E",
  red: "#EF4444", redLight: "#FEF2F2", redDark: "#991B1B",
  purple: "#8B5CF6", purpleLight: "#F5F3FF",
  ink: "#0F172A", ink2: "#334155", ink3: "#64748B", ink4: "#94A3B8",
  line: "#E2E8F0", lineLight: "#F1F5F9", bg: "#F8FAFC",
  white: "#FFFFFF",
};

// ── Icons (Heroicons style) ────────────────────────────
const Ic = ({ d, s = 18, c = "currentColor", sw = 1.75, fill = "none" }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    {Array.isArray(d) ? d.map((p, i) => <path key={i} d={p} />) : <path d={d} />}
  </svg>
);

const I = {
  leaf: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z M8 12s1-4 4-4 4 4 4 4",
  menu2: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4",
  sop: ["M9 12h6", "M9 16h6", "M9 8h2", "M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z", "M13 2v7h7"],
  chart: ["M18 20V10", "M12 20V4", "M6 20v-6"],
  clock: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  plus: ["M12 5v14", "M5 12h14"],
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  pencil: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  x: ["M18 6L6 18", "M6 6l12 12"],
  check: "M5 13l4 4L19 7",
  img: ["M21 19V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2z", "M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z", "M21 15l-5-5L5 21"],
  save: ["M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z", "M17 21v-8H7v8", "M7 3v5h8"],
  dl: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M7 10l5 5 5-5", "M12 15V3"],
  ul: ["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4", "M17 8l-5-5-5 5", "M12 3v12"],
  wifi: ["M5 12.55a11 11 0 0114.08 0", "M1.42 9a16 16 0 0121.16 0", "M8.53 16.11a6 6 0 016.95 0", "M12 20h.01"],
  tag: "M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
  bolt: "M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  eye: ["M1 12s4-8 11-8 11 8 11 8", "M1 12s4 8 11 8 11-8 11-8", "M12 9a3 3 0 100 6 3 3 0 000-6z"],
  fire: "M12 2c0 6-6 7-6 12a6 6 0 0012 0c0-5-6-6-6-12z M9 18c0-2 3-3 3-3s3 1 3 3",
  warning: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  chevD: "M19 9l-7 7-7-7",
  drag: ["M9 5h.01", "M9 12h.01", "M9 19h.01", "M15 5h.01", "M15 12h.01", "M15 19h.01"],
};

// ── LocalStorage ───────────────────────────────────────
function useLS(key, init) {
  const [v, setV] = useState(() => { try { const i = localStorage.getItem(key); return i ? JSON.parse(i) : init; } catch { return init; } });
  const set = useCallback((val) => {
    const nv = val instanceof Function ? val(v) : val;
    setV(nv); try { localStorage.setItem(key, JSON.stringify(nv)); } catch {}
  }, [key, v]);
  return [v, set];
}

// ── Seed Data ──────────────────────────────────────────
const CATS = ["เนื้อสัตว์", "ผักและผลไม้", "เครื่องปรุง", "นม/ไข่", "แป้ง/ธัญพืช", "อื่นๆ"];
const INIT_ING = [
  { id: 1, name: "ไก่หน้าอก", category: "เนื้อสัตว์", buyUnit: "กก.", buyAmount: 1, buyPrice: 120, convertToGram: 1000, pricePerGram: 0.12, stock: 5, image: null, note: "" },
  { id: 2, name: "ไข่ไก่", category: "นม/ไข่", buyUnit: "แผง 30 ฟอง", buyAmount: 1, buyPrice: 120, convertToGram: 1800, pricePerGram: 0.067, stock: 3, image: null, note: "1 ฟอง ≈ 60g" },
  { id: 3, name: "น้ำมันพืช", category: "เครื่องปรุง", buyUnit: "ลิตร", buyAmount: 1, buyPrice: 55, convertToGram: 920, pricePerGram: 0.060, stock: 4, image: null, note: "" },
  { id: 4, name: "ซีอิ้วขาว", category: "เครื่องปรุง", buyUnit: "ขวด 700ml", buyAmount: 1, buyPrice: 45, convertToGram: 700, pricePerGram: 0.064, stock: 6, image: null, note: "" },
];
const INIT_MENUS = [
  { id: 1, name: "ข้าวผัดไก่", category: "อาหารจานเดียว", price: 80, image: null, description: "ข้าวผัดไก่หอมๆ", ingredients: [{ ingredientId: 1, amountGram: 150 }, { ingredientId: 2, amountGram: 60 }, { ingredientId: 3, amountGram: 20 }, { ingredientId: 4, amountGram: 15 }], sop: [{ step: 1, title: "เตรียมวัตถุดิบ", desc: "หั่นไก่เป็นชิ้นเล็กๆ ตีไข่ใส่ชาม เตรียมข้าวสวย", image: null }, { step: 2, title: "ผัดไก่", desc: "ตั้งกระทะไฟแรง ใส่น้ำมัน ผัดไก่จนสุก ปรุงรส", image: null }, { step: 3, title: "ใส่ข้าวและเสิร์ฟ", desc: "ใส่ข้าวผัดรวมกัน ปรุงด้วยซีอิ้ว ตักเสิร์ฟ", image: null }] },
];

// ── Helpers ────────────────────────────────────────────
const ppg = (price, gram) => (gram > 0 ? price / gram : 0);
const menuCost = (menu, ings) => menu.ingredients.reduce((s, x) => { const i = ings.find(g => g.id === x.ingredientId); return s + (i ? i.pricePerGram * x.amountGram : 0); }, 0);
const marginColor = (m) => m >= 60 ? C.green : m >= 40 ? C.yellow : C.red;
const marginBg = (m) => m >= 60 ? C.greenLight : m >= 40 ? C.yellowLight : C.redLight;
const marginLabel = (m) => m >= 60 ? "ดี" : m >= 40 ? "พอใช้" : "ต่ำ";

// ── Image Upload ───────────────────────────────────────
function ImgUp({ value, onChange, label, compact }) {
  const ref = useRef();
  const handleFile = e => {
    const f = e.target.files?.[0]; if (!f) return;
    if (f.size > 3 * 1024 * 1024) { alert("รูปต้องไม่เกิน 3MB"); return; }
    const r = new FileReader(); r.onload = ev => onChange(ev.target.result); r.readAsDataURL(f);
    e.target.value = "";
  };
  return (
    <div style={{ marginBottom: compact ? 0 : 16 }}>
      {label && !compact && <div style={{ fontSize: 13, fontWeight: 600, color: C.ink2, marginBottom: 6, fontFamily: "'Sarabun',sans-serif" }}>{label}</div>}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        {value ? (
          <div style={{ position: "relative" }}>
            <img src={value} alt="" style={{ width: compact ? 44 : 96, height: compact ? 44 : 96, objectFit: "cover", borderRadius: compact ? 8 : 14, border: `2px solid ${C.line}` }} />
            <button onClick={() => onChange(null)} style={{ position: "absolute", top: -7, right: -7, width: 20, height: 20, borderRadius: "50%", background: C.red, border: `2px solid ${C.white}`, color: C.white, cursor: "pointer", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700 }}>✕</button>
          </div>
        ) : (
          <div onClick={() => ref.current?.click()} style={{ width: compact ? 44 : 96, height: compact ? 44 : 96, border: `2px dashed ${C.line}`, borderRadius: compact ? 8 : 14, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", cursor: "pointer", background: C.bg, gap: 4, transition: "all .2s" }}
            onMouseEnter={e => { e.currentTarget.style.borderColor = C.brand; e.currentTarget.style.background = C.brandLight; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = C.line; e.currentTarget.style.background = C.bg; }}>
            <Ic d={I.img} s={compact ? 16 : 24} c={C.ink4} />
            {!compact && <span style={{ fontSize: 11, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>อัปโหลด</span>}
          </div>
        )}
        {!compact && !value && <div style={{ fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif", lineHeight: 1.6 }}>JPG, PNG<br />ไม่เกิน 3MB</div>}
        <input ref={ref} type="file" accept="image/*" onChange={handleFile} style={{ display: "none" }} />
      </div>
    </div>
  );
}

// ── Base UI ────────────────────────────────────────────
const iS = { width: "100%", padding: "11px 14px", border: `1.5px solid ${C.line}`, borderRadius: 10, fontSize: 15, fontFamily: "'Sarabun',sans-serif", outline: "none", boxSizing: "border-box", color: C.ink, background: C.white, transition: "border .15s, box-shadow .15s" };
const iSFocus = { border: `1.5px solid ${C.brand}`, boxShadow: `0 0 0 3px ${C.brandLight}` };

function Field({ label, hint, children, style }) {
  return <div style={{ marginBottom: 16, ...style }}>{(label || hint) && <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>{label && <label style={{ fontSize: 13, fontWeight: 600, color: C.ink2, fontFamily: "'Sarabun',sans-serif" }}>{label}</label>}{hint && <span style={{ fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>{hint}</span>}</div>}{children}</div>;
}
function Inp({ label, hint, style: s, ...p }) {
  const [focus, setFocus] = useState(false);
  return <Field label={label} hint={hint}><input style={{ ...iS, ...(focus ? iSFocus : {}), ...s }} {...p} onFocus={e => { setFocus(true); p.onFocus?.(e); }} onBlur={e => { setFocus(false); p.onBlur?.(e); }} /></Field>;
}
function TA({ label, hint, rows = 4, ...p }) {
  const [focus, setFocus] = useState(false);
  return <Field label={label} hint={hint}><textarea rows={rows} style={{ ...iS, ...(focus ? iSFocus : {}), resize: "vertical", lineHeight: 1.7 }} {...p} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} /></Field>;
}
function Sel({ label, options, ...p }) {
  const [focus, setFocus] = useState(false);
  return <Field label={label}><select style={{ ...iS, ...(focus ? iSFocus : {}), appearance: "none", cursor: "pointer" }} {...p} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)}>{options.map(o => <option key={o.v ?? o} value={o.v ?? o}>{o.l ?? o}</option>)}</select></Field>;
}
function Btn({ children, v = "primary", onClick, icon, disabled, full, s }) {
  const styles = {
    primary: { bg: `linear-gradient(135deg,${C.brand},${C.brandDark})`, color: C.white, shadow: `0 4px 16px ${C.brand}44` },
    success: { bg: `linear-gradient(135deg,${C.green},#059669)`, color: C.white, shadow: `0 4px 16px ${C.green}44` },
    ghost: { bg: C.white, color: C.ink2, shadow: `0 0 0 1.5px ${C.line}`, hoverBg: C.lineLight },
    danger: { bg: C.redLight, color: C.red, shadow: "none" },
    info: { bg: `linear-gradient(135deg,${C.blue},#2563EB)`, color: C.white, shadow: `0 4px 16px ${C.blue}44` },
  };
  const st = styles[v] || styles.primary;
  return (
    <button onClick={disabled ? undefined : onClick} style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, padding: "10px 20px", borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: disabled ? "not-allowed" : "pointer", border: "none", fontFamily: "'Sarabun',sans-serif", transition: "all .15s", opacity: disabled ? .5 : 1, background: st.bg, color: st.color, boxShadow: st.shadow, width: full ? "100%" : undefined, whiteSpace: "nowrap", ...s }}
      onMouseEnter={e => { if (!disabled) { e.currentTarget.style.opacity = ".88"; e.currentTarget.style.transform = "translateY(-1px)"; } }}
      onMouseLeave={e => { e.currentTarget.style.opacity = "1"; e.currentTarget.style.transform = ""; }}>
      {icon && <Ic d={icon} s={15} c={st.color} />}{children}
    </button>
  );
}
function Chip({ children, color = "orange" }) {
  const map = { orange: [C.brandLight, C.brand], blue: [C.blueLight, C.blue], green: [C.greenLight, C.green], red: [C.redLight, C.red], yellow: [C.yellowLight, C.yellow], gray: [C.lineLight, C.ink3], purple: [C.purpleLight, C.purple] };
  const [bg, tc] = map[color] || map.gray;
  return <span style={{ display: "inline-flex", alignItems: "center", padding: "3px 10px", background: bg, color: tc, borderRadius: 20, fontSize: 12, fontWeight: 700, fontFamily: "'Sarabun',sans-serif" }}>{children}</span>;
}
function Card({ children, style, onClick, hover }) {
  const [hov, setHov] = useState(false);
  return <div style={{ background: C.white, borderRadius: 16, border: `1px solid ${hov && hover ? C.brandBorder : C.line}`, boxShadow: hov && hover ? `0 8px 32px rgba(255,107,53,.12)` : "0 2px 8px rgba(15,23,42,.06)", transition: "all .2s", cursor: onClick ? "pointer" : undefined, ...style }} onClick={onClick} onMouseEnter={() => setHov(true)} onMouseLeave={() => setHov(false)}>{children}</div>;
}

// ── Modal ──────────────────────────────────────────────
function Modal({ title, onClose, children, wide }) {
  useEffect(() => { const h = e => e.key === "Escape" && onClose(); document.addEventListener("keydown", h); return () => document.removeEventListener("keydown", h); }, []);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,.65)", backdropFilter: "blur(8px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }} onClick={e => e.target === e.currentTarget && onClose()}>
      <div style={{ background: C.white, borderRadius: 20, width: "100%", maxWidth: wide ? 760 : 560, maxHeight: "94vh", display: "flex", flexDirection: "column", boxShadow: "0 40px 100px rgba(15,23,42,.22)", animation: "mIn .22s cubic-bezier(.34,1.56,.64,1)", overflow: "hidden" }}>
        <div style={{ padding: "20px 24px 16px", borderBottom: `1px solid ${C.line}`, display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0, background: C.bg }}>
          <span style={{ fontFamily: "'Sarabun',sans-serif", fontSize: 18, fontWeight: 800, color: C.ink }}>{title}</span>
          <button onClick={onClose} style={{ background: C.line, border: "none", cursor: "pointer", color: C.ink3, padding: 7, borderRadius: 8, display: "flex", transition: "all .15s" }} onMouseEnter={e => e.currentTarget.style.background = C.lineLight} onMouseLeave={e => e.currentTarget.style.background = C.line}><Ic d={I.x} s={15} /></button>
        </div>
        <div style={{ padding: "22px 24px 24px", overflowY: "auto", flex: 1 }}>{children}</div>
      </div>
    </div>
  );
}

// ── Section Header ─────────────────────────────────────
function SH({ label, icon, count, action }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: C.brandLight, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic d={icon} s={16} c={C.brand} /></div>
        <span style={{ fontWeight: 700, fontSize: 15, color: C.ink, fontFamily: "'Sarabun',sans-serif" }}>{label}</span>
        {count != null && <Chip color="gray">{count}</Chip>}
      </div>
      {action}
    </div>
  );
}

// ── Stat Card ──────────────────────────────────────────
function StatCard({ label, value, unit, icon, color }) {
  return (
    <Card style={{ padding: "18px 20px", display: "flex", alignItems: "center", gap: 14 }}>
      <div style={{ width: 46, height: 46, borderRadius: 12, background: `${color}18`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Ic d={icon} s={22} c={color} />
      </div>
      <div>
        <div style={{ fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif", marginBottom: 2 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 800, color, fontFamily: "'Sarabun',sans-serif", lineHeight: 1.1 }}>{value}<span style={{ fontSize: 13, fontWeight: 600, marginLeft: 3, color: C.ink3 }}>{unit}</span></div>
      </div>
    </Card>
  );
}

// ── Export/Import ──────────────────────────────────────
function EI({ ings, menus, cats, onImport }) {
  const ref = useRef();
  const exp = () => {
    const b = new Blob([JSON.stringify({ ingredients: ings, menus, categories: cats, v: "2.1", at: new Date().toISOString() }, null, 2)], { type: "application/json" });
    const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `foodcost-${new Date().toLocaleDateString("th-TH").replace(/\//g, "-")}.json`; a.click(); URL.revokeObjectURL(u);
  };
  const imp = e => {
    const f = e.target.files?.[0]; if (!f) return;
    const r = new FileReader(); r.onload = ev => { try { const d = JSON.parse(ev.target.result); if (d.ingredients && d.menus) { onImport(d); alert("✅ นำเข้าข้อมูลสำเร็จ!"); } else alert("❌ ไฟล์ไม่ถูกต้อง"); } catch { alert("❌ อ่านไฟล์ไม่ได้"); } };
    r.readAsText(f); e.target.value = "";
  };
  return (
    <div style={{ display: "flex", gap: 6 }}>
      <Btn v="ghost" onClick={exp} icon={I.dl} s={{ padding: "7px 12px", fontSize: 12 }}>Export</Btn>
      <Btn v="ghost" onClick={() => ref.current?.click()} icon={I.ul} s={{ padding: "7px 12px", fontSize: 12 }}>Import</Btn>
      <input ref={ref} type="file" accept=".json" onChange={imp} style={{ display: "none" }} />
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── INGREDIENT TAB ────────────────────────────────────
// ══════════════════════════════════════════════════════
function IngTab({ ings, setIngs, cats, addH }) {
  const [q, setQ] = useState(""); const [cat, setCat] = useState("ทุกหมวด");
  const [open, setOpen] = useState(false); const [editId, setEditId] = useState(null);
  const [pg, setPg] = useState(1); const PG = 18;
  const ef = { name: "", category: cats[0], buyUnit: "กก.", buyAmount: 1, buyPrice: "", convertToGram: 1000, pricePerGram: 0, stock: "", image: null, note: "" };
  const [form, setForm] = useState(ef);

  const filtered = useMemo(() => ings.filter(i => i.name.toLowerCase().includes(q.toLowerCase()) && (cat === "ทุกหมวด" || i.category === cat)), [ings, q, cat]);
  const paged = useMemo(() => filtered.slice(0, pg * PG), [filtered, pg]);

  function upd(k, val) {
    setForm(f => {
      const n = { ...f, [k]: val };
      if (k === "buyPrice" || k === "convertToGram") n.pricePerGram = ppg(+(k === "buyPrice" ? val : n.buyPrice) || 0, +(k === "convertToGram" ? val : n.convertToGram) || 1);
      return n;
    });
  }
  function save() {
    if (!form.name || !form.buyPrice) return;
    const item = { ...form, buyPrice: +form.buyPrice, buyAmount: +form.buyAmount, convertToGram: +form.convertToGram, pricePerGram: ppg(+form.buyPrice, +form.convertToGram), stock: +form.stock };
    if (editId) { setIngs(p => p.map(i => i.id === editId ? { ...i, ...item } : i)); addH(`แก้ไขวัตถุดิบ: ${form.name}`); }
    else { setIngs(p => [...p, { ...item, id: Date.now() }]); addH(`เพิ่มวัตถุดิบ: ${form.name}`); }
    setOpen(false);
  }
  function del(id, name) { if (!confirm(`ลบ "${name}"?`)) return; setIngs(p => p.filter(i => i.id !== id)); addH(`ลบวัตถุดิบ: ${name}`); }

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: "flex", gap: 10, marginBottom: 20, flexWrap: "wrap" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 220 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Ic d={I.search} s={16} c={C.ink4} /></span>
          <input value={q} onChange={e => { setQ(e.target.value); setPg(1); }} placeholder="ค้นหาวัตถุดิบ..." style={{ ...iS, paddingLeft: 40 }} />
        </div>
        <select value={cat} onChange={e => { setCat(e.target.value); setPg(1); }} style={{ ...iS, width: "auto", minWidth: 140, appearance: "none" }}>
          <option>ทุกหมวด</option>{cats.map(c => <option key={c}>{c}</option>)}
        </select>
        <Btn onClick={() => { setForm(ef); setEditId(null); setOpen(true); }} icon={I.plus}>เพิ่มวัตถุดิบ</Btn>
      </div>

      {/* Count */}
      <div style={{ fontSize: 12, color: C.ink4, marginBottom: 14, fontFamily: "'Sarabun',sans-serif" }}>แสดง {paged.length} จาก {filtered.length} รายการ</div>

      {/* Grid */}
      {paged.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 0", color: C.ink4 }}><Ic d={I.warning} s={44} c={C.line} /><p style={{ marginTop: 12, fontFamily: "'Sarabun',sans-serif", fontSize: 15 }}>ไม่พบวัตถุดิบ</p></div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(310px,1fr))", gap: 14 }}>
            {paged.map(item => (
              <Card key={item.id} hover style={{ overflow: "hidden" }}>
                {/* Top row */}
                <div style={{ display: "flex" }}>
                  {item.image ? <img src={item.image} alt={item.name} style={{ width: 88, height: 88, objectFit: "cover", flexShrink: 0 }} /> :
                    <div style={{ width: 88, height: 88, background: `linear-gradient(135deg,${C.brandLight},#FEF3C7)`, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic d={I.leaf} s={32} c={C.brand} /></div>}
                  <div style={{ flex: 1, padding: "12px 14px 10px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 6 }}>
                      <div>
                        <div style={{ fontWeight: 800, fontSize: 15, color: C.ink, fontFamily: "'Sarabun',sans-serif", marginBottom: 4 }}>{item.name}</div>
                        <Chip color="orange">{item.category}</Chip>
                      </div>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button onClick={() => { setForm({ ...item }); setEditId(item.id); setOpen(true); }} style={{ background: C.blueLight, border: "none", borderRadius: 7, padding: 6, cursor: "pointer", color: C.blue, display: "flex" }}><Ic d={I.pencil} s={13} c={C.blue} /></button>
                        <button onClick={() => del(item.id, item.name)} style={{ background: C.redLight, border: "none", borderRadius: 7, padding: 6, cursor: "pointer", color: C.red, display: "flex" }}><Ic d={I.trash} s={13} c={C.red} /></button>
                      </div>
                    </div>
                  </div>
                </div>
                {/* Stats */}
                <div style={{ padding: "10px 14px 14px", borderTop: `1px solid ${C.lineLight}` }}>
                  <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 8 }}>
                    {[
                      { l: "ซื้อมา", v: `฿${item.buyPrice}`, sub: `${item.buyAmount} ${item.buyUnit}`, bg: C.lineLight, tc: C.ink },
                      { l: "รวมกรัม", v: `${item.convertToGram.toLocaleString()}g`, sub: "ทั้งหมด", bg: C.brandLight, tc: C.brand },
                      { l: "ราคา/กรัม", v: `฿${item.pricePerGram.toFixed(3)}`, sub: "ต่อ 1g", bg: C.greenLight, tc: C.green },
                    ].map(st => (
                      <div key={st.l} style={{ background: st.bg, borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                        <div style={{ fontSize: 10, color: C.ink4, fontFamily: "'Sarabun',sans-serif", marginBottom: 2 }}>{st.l}</div>
                        <div style={{ fontSize: 13, fontWeight: 800, color: st.tc, fontFamily: "'Sarabun',sans-serif" }}>{st.v}</div>
                        <div style={{ fontSize: 10, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>{st.sub}</div>
                      </div>
                    ))}
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>สต็อก: <b style={{ color: item.stock < 3 ? C.red : C.green }}>{item.stock} {item.buyUnit}</b></span>
                    {item.note && <span style={{ fontSize: 11, color: C.ink4, fontFamily: "'Sarabun',sans-serif", fontStyle: "italic" }}>📝 {item.note}</span>}
                  </div>
                </div>
              </Card>
            ))}
          </div>
          {paged.length < filtered.length && <div style={{ textAlign: "center", marginTop: 20 }}><Btn v="ghost" onClick={() => setPg(p => p + 1)}>โหลดเพิ่ม ({filtered.length - paged.length} รายการ)</Btn></div>}
        </>
      )}

      {open && (
        <Modal title={editId ? "✏️ แก้ไขวัตถุดิบ" : "➕ เพิ่มวัตถุดิบใหม่"} onClose={() => setOpen(false)}>
          <ImgUp label="รูปวัตถุดิบ" value={form.image} onChange={v => upd("image", v)} />
          <Inp label="ชื่อวัตถุดิบ" value={form.name} onChange={e => upd("name", e.target.value)} placeholder="เช่น ไก่หน้าอก" autoFocus />
          <Sel label="หมวดหมู่" value={form.category} onChange={e => upd("category", e.target.value)} options={cats} />

          <div style={{ background: C.lineLight, borderRadius: 12, padding: "16px", marginBottom: 16 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.ink2, fontFamily: "'Sarabun',sans-serif", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Ic d={I.tag} s={14} c={C.brand} />ข้อมูลการซื้อ</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
              <Inp label="จำนวนที่ซื้อ" type="number" value={form.buyAmount} onChange={e => upd("buyAmount", e.target.value)} placeholder="1" />
              <Inp label="หน่วยที่ซื้อ" value={form.buyUnit} onChange={e => upd("buyUnit", e.target.value)} placeholder="กก., ขวด, แผง" />
            </div>
            <Inp label="ราคาที่ซื้อมา (บาท)" type="number" value={form.buyPrice} onChange={e => upd("buyPrice", e.target.value)} placeholder="0" />
          </div>

          <div style={{ background: C.brandLight, borderRadius: 12, padding: "16px", marginBottom: 16, border: `1px solid ${C.brandBorder}` }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.brand, fontFamily: "'Sarabun',sans-serif", marginBottom: 12, display: "flex", alignItems: "center", gap: 6 }}><Ic d={I.bolt} s={14} c={C.brand} />แปลงเป็นกรัม</div>
            <Inp label="รวมทั้งหมดกี่กรัม" hint="(ทุกหน่วยที่ซื้อรวมกัน)" type="number" value={form.convertToGram} onChange={e => upd("convertToGram", e.target.value)} placeholder="1000" />
            <div style={{ background: C.white, borderRadius: 10, padding: "12px 14px", border: `1px solid ${C.brandBorder}`, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif", marginBottom: 4 }}>ราคาต่อกรัม (คำนวณให้อัตโนมัติ)</div>
              <div style={{ fontSize: 26, fontWeight: 900, color: C.brand, fontFamily: "'Sarabun',sans-serif" }}>
                ฿{form.buyPrice && form.convertToGram ? ppg(+form.buyPrice, +form.convertToGram).toFixed(4) : "0.0000"}
                <span style={{ fontSize: 13, fontWeight: 500, color: C.ink3, marginLeft: 4 }}>/ กรัม</span>
              </div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Inp label="สต็อกปัจจุบัน" type="number" value={form.stock} onChange={e => upd("stock", e.target.value)} placeholder="0" />
          </div>
          <TA label="หมายเหตุ" rows={2} value={form.note} onChange={e => upd("note", e.target.value)} placeholder="เช่น 1 ฟอง ≈ 60 กรัม" />

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 8, borderTop: `1px solid ${C.line}` }}>
            <Btn v="ghost" onClick={() => setOpen(false)}>ยกเลิก</Btn>
            <Btn onClick={save} icon={I.check} disabled={!form.name || !form.buyPrice}>{editId ? "บันทึก" : "เพิ่มวัตถุดิบ"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── MENU TAB ──────────────────────────────────────────
// ══════════════════════════════════════════════════════
function MenuTab({ menus, setMenus, ings, addH }) {
  const [q, setQ] = useState(""); const [open, setOpen] = useState(false); const [editId, setEditId] = useState(null);
  const ef = { name: "", category: "อาหารจานเดียว", price: "", description: "", image: null, ingredients: [], sop: [] };
  const [form, setForm] = useState(ef);
  const [ni, setNi] = useState({ ingredientId: "", amountGram: "" });

  const filtered = useMemo(() => menus.filter(m => m.name.toLowerCase().includes(q.toLowerCase())), [menus, q]);
  const fc = form.ingredients.reduce((s, x) => { const i = ings.find(g => g.id === x.ingredientId); return s + (i ? i.pricePerGram * x.amountGram : 0); }, 0);
  const fm = form.price > 0 ? ((+form.price - fc) / +form.price * 100) : 0;

  function addIng() {
    if (!ni.ingredientId || !ni.amountGram) return;
    setForm(f => ({ ...f, ingredients: [...f.ingredients, { ingredientId: +ni.ingredientId, amountGram: +ni.amountGram }] }));
    setNi({ ingredientId: "", amountGram: "" });
  }
  function save() {
    if (!form.name || !form.price) return;
    if (editId) { setMenus(p => p.map(m => m.id === editId ? { ...m, ...form, price: +form.price } : m)); addH(`แก้ไขเมนู: ${form.name}`); }
    else { setMenus(p => [...p, { ...form, id: Date.now(), price: +form.price }]); addH(`เพิ่มเมนู: ${form.name}`); }
    setOpen(false);
  }
  function del(id, name) { if (!confirm(`ลบเมนู "${name}"?`)) return; setMenus(p => p.filter(m => m.id !== id)); addH(`ลบเมนู: ${name}`); }

  return (
    <div>
      <div style={{ display: "flex", gap: 10, marginBottom: 20 }}>
        <div style={{ position: "relative", flex: 1 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)" }}><Ic d={I.search} s={16} c={C.ink4} /></span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="ค้นหาเมนู..." style={{ ...iS, paddingLeft: 40 }} />
        </div>
        <Btn onClick={() => { setForm(ef); setEditId(null); setOpen(true); }} icon={I.plus}>เพิ่มเมนู</Btn>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(320px,1fr))", gap: 16 }}>
        {filtered.map(menu => {
          const cost = menuCost(menu, ings);
          const profit = menu.price - cost;
          const mg = menu.price > 0 ? profit / menu.price * 100 : 0;
          const mc = marginColor(mg);
          return (
            <Card key={menu.id} hover style={{ overflow: "hidden" }}>
              <div style={{ height: 5, background: `linear-gradient(90deg,${mc},${mc}66)` }} />
              {menu.image ? <img src={menu.image} alt={menu.name} style={{ width: "100%", height: 150, objectFit: "cover" }} /> :
                <div style={{ height: 90, background: `linear-gradient(135deg,${C.brandLight},#FEF9C3)`, display: "flex", alignItems: "center", justifyContent: "center" }}><Ic d={I.fire} s={38} c={C.brand} /></div>}
              <div style={{ padding: "14px 16px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div><div style={{ fontWeight: 800, fontSize: 17, color: C.ink, fontFamily: "'Sarabun',sans-serif", marginBottom: 4 }}>{menu.name}</div><Chip color="blue">{menu.category}</Chip></div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button onClick={() => { setForm({ ...menu }); setEditId(menu.id); setOpen(true); }} style={{ background: C.blueLight, border: "none", borderRadius: 7, padding: 6, cursor: "pointer", display: "flex" }}><Ic d={I.pencil} s={13} c={C.blue} /></button>
                    <button onClick={() => del(menu.id, menu.name)} style={{ background: C.redLight, border: "none", borderRadius: 7, padding: 6, cursor: "pointer", display: "flex" }}><Ic d={I.trash} s={13} c={C.red} /></button>
                  </div>
                </div>
                {menu.description && <p style={{ fontSize: 13, color: C.ink3, fontFamily: "'Sarabun',sans-serif", marginBottom: 10, lineHeight: 1.5 }}>{menu.description}</p>}
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[{ l: "ราคาขาย", v: `฿${menu.price}`, c: C.ink }, { l: "ต้นทุน", v: `฿${cost.toFixed(1)}`, c: C.brand }, { l: "กำไร %", v: `${mg.toFixed(0)}%`, c: mc }].map(s => (
                    <div key={s.l} style={{ background: C.bg, borderRadius: 10, padding: "8px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>{s.l}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: s.c, fontFamily: "'Sarabun',sans-serif" }}>{s.v}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, display: "flex", justifyContent: "space-between", fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>
                  <span>{menu.ingredients.length} วัตถุดิบ</span>
                  <Chip color={mg >= 60 ? "green" : mg >= 40 ? "yellow" : "red"}>{marginLabel(mg)}</Chip>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      {open && (
        <Modal title={editId ? "✏️ แก้ไขเมนู" : "➕ เพิ่มเมนูใหม่"} onClose={() => setOpen(false)} wide>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
            {/* Left */}
            <div>
              <ImgUp label="รูปเมนู" value={form.image} onChange={v => setForm(f => ({ ...f, image: v }))} />
              <Inp label="ชื่อเมนู" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="เช่น ข้าวผัดไก่" autoFocus />
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <Inp label="หมวดหมู่" value={form.category} onChange={e => setForm(f => ({ ...f, category: e.target.value }))} />
                <Inp label="ราคาขาย (฿)" type="number" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} placeholder="0" />
              </div>
              <TA label="รายละเอียดเมนู" rows={3} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="อธิบายเมนูสั้นๆ" />
            </div>
            {/* Right */}
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: C.ink2, fontFamily: "'Sarabun',sans-serif", marginBottom: 10 }}>วัตถุดิบ (คำนวณจากกรัม)</div>
              <div style={{ maxHeight: 200, overflowY: "auto", marginBottom: 10 }}>
                {form.ingredients.map((mi, idx) => {
                  const ing = ings.find(i => i.id === mi.ingredientId);
                  const c = ing ? ing.pricePerGram * mi.amountGram : 0;
                  return (
                    <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: C.bg, borderRadius: 9, padding: "8px 10px", border: `1px solid ${C.line}` }}>
                      <span style={{ flex: 1, fontSize: 13, fontFamily: "'Sarabun',sans-serif", fontWeight: 600 }}>{ing?.name ?? "?"}</span>
                      <span style={{ fontSize: 12, color: C.brand, fontWeight: 700 }}>{mi.amountGram}g</span>
                      <span style={{ fontSize: 11, color: C.ink3 }}>฿{c.toFixed(2)}</span>
                      <button onClick={() => setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) }))} style={{ background: "none", border: "none", cursor: "pointer", color: C.red, display: "flex" }}><Ic d={I.x} s={13} c={C.red} /></button>
                    </div>
                  );
                })}
              </div>
              <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>
                <div style={{ flex: 2 }}>
                  <select value={ni.ingredientId} onChange={e => setNi({ ...ni, ingredientId: e.target.value })} style={{ ...iS, fontSize: 13 }}>
                    <option value="">-- เลือกวัตถุดิบ --</option>
                    {ings.map(i => <option key={i.id} value={i.id}>{i.name} (฿{i.pricePerGram.toFixed(3)}/g)</option>)}
                  </select>
                </div>
                <div style={{ flex: 1 }}><input type="number" value={ni.amountGram} onChange={e => setNi({ ...ni, amountGram: e.target.value })} placeholder="กรัม" style={{ ...iS, fontSize: 13 }} /></div>
                <Btn v="ghost" onClick={addIng} icon={I.plus} s={{ padding: "10px 12px" }}>เพิ่ม</Btn>
              </div>
              {form.ingredients.length > 0 && (
                <div style={{ background: C.brandLight, borderRadius: 12, padding: "14px", border: `1px solid ${C.brandBorder}`, marginBottom: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                    <span style={{ fontSize: 13, color: C.ink3, fontFamily: "'Sarabun',sans-serif" }}>ต้นทุนรวม</span>
                    <span style={{ fontSize: 20, fontWeight: 900, color: C.brand, fontFamily: "'Sarabun',sans-serif" }}>฿{fc.toFixed(2)}</span>
                  </div>
                  {form.price > 0 && (
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                      <span style={{ fontSize: 12, color: C.ink3, fontFamily: "'Sarabun',sans-serif" }}>กำไร</span>
                      <span style={{ fontSize: 14, fontWeight: 700, color: marginColor(fm), fontFamily: "'Sarabun',sans-serif" }}>฿{(+form.price - fc).toFixed(2)} ({fm.toFixed(1)}%)</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", paddingTop: 16, borderTop: `1px solid ${C.line}`, marginTop: 8 }}>
            <Btn v="ghost" onClick={() => setOpen(false)}>ยกเลิก</Btn>
            <Btn onClick={save} icon={I.check} disabled={!form.name || !form.price}>{editId ? "บันทึก" : "เพิ่มเมนู"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── SOP TAB ───────────────────────────────────────────
// ══════════════════════════════════════════════════════
function SOPTab({ menus, setMenus, ings }) {
  const [sel, setSel] = useState(menus[0]?.id ?? null);
  const [edit, setEdit] = useState(false);
  const [sop, setSop] = useState([]);
  const menu = useMemo(() => menus.find(m => m.id === sel), [menus, sel]);

  useEffect(() => { if (menu) { setSop(menu.sop ? [...menu.sop.map(s => ({ ...s }))] : []); setEdit(false); } }, [sel]);

  function saveSop() { setMenus(p => p.map(m => m.id === sel ? { ...m, sop } : m)); setEdit(false); }
  function addStep() { setSop(f => [...f, { step: f.length + 1, title: "", desc: "", image: null }]); }
  function rmStep(i) { setSop(f => f.filter((_, j) => j !== i)); }
  function updStep(i, k, v) { setSop(f => f.map((s, j) => j === i ? { ...s, [k]: v } : s)); }

  return (
    <div style={{ display: "grid", gridTemplateColumns: "260px 1fr", gap: 16, minHeight: 520 }}>
      {/* Sidebar */}
      <div style={{ background: C.white, borderRadius: 16, border: `1px solid ${C.line}`, overflow: "hidden" }}>
        <div style={{ padding: "14px 16px 10px", borderBottom: `1px solid ${C.lineLight}`, background: C.bg }}>
          <div style={{ fontSize: 11, fontWeight: 800, color: C.ink4, letterSpacing: 1.2, textTransform: "uppercase", fontFamily: "'Sarabun',sans-serif" }}>รายการเมนู</div>
        </div>
        <div style={{ padding: 8, overflowY: "auto", maxHeight: 520 }}>
          {menus.map(m => {
            const cost = menuCost(m, ings);
            const mg = m.price > 0 ? ((m.price - cost) / m.price * 100) : 0;
            const active = sel === m.id;
            return (
              <div key={m.id} onClick={() => setSel(m.id)} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", marginBottom: 4, background: active ? C.brandLight : "transparent", border: `1px solid ${active ? C.brandBorder : "transparent"}`, transition: "all .15s" }}>
                <div style={{ fontFamily: "'Sarabun',sans-serif", fontSize: 14, fontWeight: active ? 800 : 500, color: active ? C.brand : C.ink2, marginBottom: 2 }}>{m.name}</div>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 11, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>กำไร</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: marginColor(mg), fontFamily: "'Sarabun',sans-serif" }}>{mg.toFixed(0)}%</span>
                  <span style={{ fontSize: 11, color: C.ink4, fontFamily: "'Sarabun',sans-serif" }}>· {m.sop?.length || 0} ขั้นตอน</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <Card style={{ padding: "22px 24px", overflow: "auto" }}>
        {menu ? (
          <>
            {/* Header */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 20, paddingBottom: 16, borderBottom: `1px solid ${C.lineLight}` }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center" }}>
                {menu.image && <img src={menu.image} alt={menu.name} style={{ width: 60, height: 60, objectFit: "cover", borderRadius: 12, border: `2px solid ${C.line}` }} />}
                <div>
                  <h2 style={{ fontFamily: "'Sarabun',sans-serif", fontSize: 22, fontWeight: 900, color: C.ink, marginBottom: 4 }}>{menu.name}</h2>
                  <div style={{ display: "flex", gap: 10, fontSize: 13, color: C.ink3, fontFamily: "'Sarabun',sans-serif" }}>
                    <span>ราคา <b style={{ color: C.ink }}>฿{menu.price}</b></span>
                    <span>ต้นทุน <b style={{ color: C.brand }}>฿{menuCost(menu, ings).toFixed(2)}</b></span>
                    <span>กำไร <b style={{ color: marginColor(menu.price > 0 ? ((menu.price - menuCost(menu, ings)) / menu.price * 100) : 0) }}>{menu.price > 0 ? (((menu.price - menuCost(menu, ings)) / menu.price) * 100).toFixed(1) : 0}%</b></span>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {edit ? (
                  <><Btn v="ghost" onClick={() => { setSop(menu.sop ? [...menu.sop] : []); setEdit(false); }} s={{ padding: "8px 14px" }}>ยกเลิก</Btn>
                    <Btn v="success" onClick={saveSop} icon={I.check} s={{ padding: "8px 14px" }}>บันทึก SOP</Btn></>
                ) : (
                  <Btn v="info" onClick={() => setEdit(true)} icon={I.pencil} s={{ padding: "8px 14px" }}>แก้ไข SOP</Btn>
                )}
              </div>
            </div>

            {/* Ingredients summary */}
            <div style={{ marginBottom: 22 }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: C.ink3, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Sarabun',sans-serif", marginBottom: 8 }}>วัตถุดิบในเมนู</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {menu.ingredients.map((mi, idx) => {
                  const ing = ings.find(i => i.id === mi.ingredientId);
                  return ing ? (
                    <div key={idx} style={{ background: C.bg, borderRadius: 8, padding: "6px 12px", fontSize: 13, fontFamily: "'Sarabun',sans-serif", border: `1px solid ${C.line}`, display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 700, color: C.ink }}>{ing.name}</span>
                      <span style={{ color: C.brand, fontWeight: 700 }}>{mi.amountGram}g</span>
                      <span style={{ color: C.ink4, fontSize: 11 }}>฿{(ing.pricePerGram * mi.amountGram).toFixed(2)}</span>
                    </div>
                  ) : null;
                })}
              </div>
            </div>

            {/* SOP Steps */}
            <div style={{ fontSize: 12, fontWeight: 700, color: C.ink3, textTransform: "uppercase", letterSpacing: 1, fontFamily: "'Sarabun',sans-serif", marginBottom: 14 }}>ขั้นตอนการทำ (SOP)</div>

            {edit ? (
              <div>
                {sop.map((step, idx) => (
                  <div key={idx} style={{ background: C.bg, borderRadius: 14, padding: "18px 20px", marginBottom: 14, border: `1px solid ${C.line}` }}>
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <div style={{ width: 32, height: 32, borderRadius: "50%", background: `linear-gradient(135deg,${C.brand},${C.brandDark})`, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 14, fontWeight: 800, flexShrink: 0 }}>{idx + 1}</div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: C.ink3, fontFamily: "'Sarabun',sans-serif" }}>ขั้นตอนที่ {idx + 1}</span>
                      </div>
                      <button onClick={() => rmStep(idx)} style={{ background: C.redLight, border: "none", borderRadius: 8, padding: "5px 12px", cursor: "pointer", color: C.red, fontSize: 12, fontFamily: "'Sarabun',sans-serif", fontWeight: 600, display: "flex", alignItems: "center", gap: 4 }}><Ic d={I.trash} s={12} c={C.red} />ลบขั้นตอน</button>
                    </div>
                    <Inp label="ชื่อขั้นตอน" value={step.title} onChange={e => updStep(idx, "title", e.target.value)} placeholder="เช่น เตรียมวัตถุดิบ" />
                    <TA label="รายละเอียดขั้นตอน" hint="อธิบายวิธีทำให้ละเอียด" rows={5} value={step.desc} onChange={e => updStep(idx, "desc", e.target.value)} placeholder="อธิบายวิธีทำในขั้นตอนนี้อย่างละเอียด เช่น อุณหภูมิ เวลา วิธีการ..." />
                    <ImgUp label="รูปประกอบขั้นตอนนี้" value={step.image} onChange={v => updStep(idx, "image", v)} />
                  </div>
                ))}
                <Btn v="ghost" onClick={addStep} icon={I.plus} full>+ เพิ่มขั้นตอน</Btn>
              </div>
            ) : (
              <div>
                {(!menu.sop || menu.sop.length === 0) ? (
                  <div style={{ textAlign: "center", padding: "60px 0", color: C.ink4 }}><Ic d={I.sop} s={44} c={C.line} /><p style={{ marginTop: 12, fontFamily: "'Sarabun',sans-serif", fontSize: 15 }}>ยังไม่มี SOP<br /><span style={{ fontSize: 13, color: C.ink4 }}>กด "แก้ไข SOP" เพื่อเพิ่มขั้นตอน</span></p></div>
                ) : (
                  menu.sop.map((step, idx) => (
                    <div key={idx} style={{ display: "flex", gap: 16, marginBottom: 28 }}>
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0, width: 36 }}>
                        <div style={{ width: 36, height: 36, borderRadius: "50%", background: `linear-gradient(135deg,${C.brand},${C.brandDark})`, color: C.white, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 15, fontWeight: 800, boxShadow: `0 4px 12px ${C.brand}44` }}>{idx + 1}</div>
                        {idx < menu.sop.length - 1 && <div style={{ width: 2, flex: 1, minHeight: 24, background: `linear-gradient(to bottom,${C.brand},${C.brand}22)`, marginTop: 6 }} />}
                      </div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 800, fontSize: 16, color: C.ink, fontFamily: "'Sarabun',sans-serif", marginBottom: 6 }}>{step.title || `ขั้นตอนที่ ${idx + 1}`}</div>
                        {step.desc && <p style={{ fontSize: 15, color: C.ink2, fontFamily: "'Sarabun',sans-serif", lineHeight: 1.8, marginBottom: step.image ? 12 : 0, background: C.bg, padding: "12px 14px", borderRadius: 10, border: `1px solid ${C.line}` }}>{step.desc}</p>}
                        {step.image && <img src={step.image} alt={step.title} style={{ maxWidth: 360, borderRadius: 12, border: `2px solid ${C.line}`, marginTop: 10, display: "block" }} />}
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "100px 0", color: C.ink4 }}><Ic d={I.sop} s={52} c={C.line} /><p style={{ marginTop: 16, fontFamily: "'Sarabun',sans-serif", fontSize: 16 }}>เลือกเมนูเพื่อดู SOP</p></div>
        )}
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── SUMMARY TAB ───────────────────────────────────────
// ══════════════════════════════════════════════════════
function SumTab({ menus, ings }) {
  const items = useMemo(() => menus.map(m => { const c = menuCost(m, ings); const p = m.price - c; const mg = m.price > 0 ? p / m.price * 100 : 0; return { ...m, cost: c, profit: p, margin: mg }; }), [menus, ings]);
  const stats = useMemo(() => ({ avg: items.length ? items.reduce((s, i) => s + i.margin, 0) / items.length : 0, total: items.length, good: items.filter(i => i.margin >= 60).length, profit: items.reduce((s, i) => s + i.profit, 0) }), [items]);
  const [sort, setSort] = useState("margin");
  const sorted = useMemo(() => [...items].sort((a, b) => b[sort] - a[sort]), [items, sort]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(200px,1fr))", gap: 14, marginBottom: 24 }}>
        <StatCard label="เมนูทั้งหมด" value={stats.total} unit="เมนู" icon={I.menu2} color={C.blue} />
        <StatCard label="กำไรเฉลี่ย" value={stats.avg.toFixed(1)} unit="%" icon={I.chart} color={C.brand} />
        <StatCard label="เมนูกำไรดี ≥60%" value={stats.good} unit="เมนู" icon={I.check} color={C.green} />
        <StatCard label="กำไรรวม" value={`฿${stats.profit.toFixed(0)}`} unit="" icon={I.bolt} color={C.purple} />
      </div>
      <Card>
        <div style={{ padding: "16px 20px", borderBottom: `1px solid ${C.line}`, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 800, fontSize: 15, fontFamily: "'Sarabun',sans-serif", color: C.ink }}>ตารางต้นทุนทุกเมนู</div>
          <select value={sort} onChange={e => setSort(e.target.value)} style={{ ...iS, width: "auto", fontSize: 12, padding: "6px 12px" }}>
            <option value="margin">เรียง % กำไร</option>
            <option value="profit">เรียงกำไร</option>
            <option value="price">เรียงราคาขาย</option>
            <option value="cost">เรียงต้นทุน</option>
          </select>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Sarabun',sans-serif" }}>
            <thead><tr style={{ background: C.bg }}>
              {["เมนู", "หมวด", "ราคาขาย", "ต้นทุน", "กำไร (฿)", "% กำไร", "สถานะ"].map(h => <th key={h} style={{ padding: "11px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: C.ink3, whiteSpace: "nowrap" }}>{h}</th>)}
            </tr></thead>
            <tbody>
              {sorted.map((item, idx) => (
                <tr key={item.id} style={{ borderTop: `1px solid ${C.lineLight}`, background: idx % 2 === 0 ? C.white : C.bg, transition: "background .1s" }} onMouseEnter={e => e.currentTarget.style.background = C.brandLight} onMouseLeave={e => e.currentTarget.style.background = idx % 2 === 0 ? C.white : C.bg}>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {item.image && <img src={item.image} alt={item.name} style={{ width: 32, height: 32, objectFit: "cover", borderRadius: 6 }} />}
                      <span style={{ fontWeight: 700, color: C.ink, fontSize: 14 }}>{item.name}</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}><Chip color="blue">{item.category}</Chip></td>
                  <td style={{ padding: "12px 16px", fontWeight: 700, fontSize: 14 }}>฿{item.price}</td>
                  <td style={{ padding: "12px 16px", color: C.brand, fontWeight: 700, fontSize: 14 }}>฿{item.cost.toFixed(2)}</td>
                  <td style={{ padding: "12px 16px", color: item.profit >= 0 ? C.green : C.red, fontWeight: 700, fontSize: 14 }}>฿{item.profit.toFixed(2)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 80, height: 7, background: C.lineLight, borderRadius: 999, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${Math.min(Math.max(item.margin, 0), 100)}%`, background: marginColor(item.margin), borderRadius: 999, transition: "width .4s" }} />
                      </div>
                      <span style={{ fontSize: 13, fontWeight: 700, color: marginColor(item.margin), minWidth: 40 }}>{item.margin.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}><Chip color={item.margin >= 60 ? "green" : item.margin >= 40 ? "yellow" : "red"}>{marginLabel(item.margin)}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

// ── History ────────────────────────────────────────────
function HisTab({ history, onClear }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {history.length > 0 && <Btn v="danger" onClick={() => { if (confirm("ลบประวัติทั้งหมด?")) onClear(); }} icon={I.trash} s={{ padding: "7px 14px", fontSize: 12 }}>ลบประวัติ</Btn>}
      </div>
      <Card>
        {history.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: C.ink4 }}><Ic d={I.clock} s={40} c={C.line} /><p style={{ marginTop: 12, fontFamily: "'Sarabun',sans-serif" }}>ยังไม่มีประวัติ</p></div>
        ) : history.map((item, idx) => (
          <div key={idx} style={{ display: "flex", alignItems: "center", gap: 14, padding: "13px 20px", borderBottom: `1px solid ${C.lineLight}` }}>
            <div style={{ width: 34, height: 34, borderRadius: "50%", background: C.brandLight, display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}><Ic d={I.check} s={15} c={C.brand} /></div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: C.ink, fontFamily: "'Sarabun',sans-serif" }}>{item.action}</div>
              <div style={{ fontSize: 12, color: C.ink4, fontFamily: "'Sarabun',sans-serif", marginTop: 1 }}>{item.time}</div>
            </div>
          </div>
        ))}
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════
// ── MAIN APP ──────────────────────────────────────────
// ══════════════════════════════════════════════════════
export default function App() {
  const [tab, setTab] = useState("ingredients");
  const [ings, setIngs] = useLS("fc3_ings", INIT_ING);
  const [menus, setMenus] = useLS("fc3_menus", INIT_MENUS);
  const [cats] = useLS("fc3_cats", CATS);
  const [hist, setHist] = useLS("fc3_hist", []);
  const [saved, setSaved] = useState(true);
  const t = useRef(null);

  useEffect(() => { setSaved(false); clearTimeout(t.current); t.current = setTimeout(() => setSaved(true), 700); return () => clearTimeout(t.current); }, [ings, menus]);

  const addH = useCallback((a) => setHist(p => [{ action: a, time: new Date().toLocaleString("th-TH") }, ...p.slice(0, 99)]), [setHist]);

  const TABS = [
    { id: "ingredients", label: "วัตถุดิบ", icon: I.leaf },
    { id: "menus", label: "เมนู", icon: I.fire },
    { id: "sop", label: "SOP", icon: I.sop },
    { id: "summary", label: "สรุปต้นทุน", icon: I.chart },
    { id: "history", label: "ประวัติ", icon: I.clock },
  ];

  const DESC = { ingredients: "จัดการวัตถุดิบ ราคา และสต็อก", menus: "คำนวณต้นทุนและกำไรแต่ละเมนู", sop: "ขั้นตอนมาตรฐานพร้อมรูปภาพ", summary: "ภาพรวมต้นทุนและกำไรทุกเมนู", history: "บันทึกการเปลี่ยนแปลงทั้งหมด" };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');
        *{margin:0;padding:0;box-sizing:border-box}
        body{background:${C.bg};font-family:'Sarabun',sans-serif}
        @keyframes mIn{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}
        ::-webkit-scrollbar{width:5px;height:5px}
        ::-webkit-scrollbar-thumb{background:${C.line};border-radius:999px}
        input:focus,select:focus,textarea:focus{border-color:${C.brand}!important;box-shadow:0 0 0 3px ${C.brandLight}!important;outline:none}
      `}</style>

      {/* Offline */}
      {typeof navigator !== "undefined" && !navigator.onLine && (
        <div style={{ background: C.ink, color: C.white, padding: "8px 20px", display: "flex", gap: 8, alignItems: "center", fontSize: 12 }}><Ic d={I.wifi} s={14} c={C.white} />ออฟไลน์อยู่ — ข้อมูลบันทึกในเครื่องครับ</div>
      )}

      <div style={{ minHeight: "100vh" }}>
        {/* Navbar */}
        <nav style={{ background: C.white, borderBottom: `1px solid ${C.line}`, padding: "0 28px", display: "flex", alignItems: "center", position: "sticky", top: 0, zIndex: 100, height: 62, boxShadow: "0 1px 16px rgba(15,23,42,.07)" }}>
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginRight: 32 }}>
            <div style={{ width: 36, height: 36, background: `linear-gradient(135deg,${C.brand},${C.brandDark})`, borderRadius: 10, display: "flex", alignItems: "center", justifyContent: "center", boxShadow: `0 4px 12px ${C.brand}44` }}>
              <Ic d={I.fire} s={18} c={C.white} sw={2} />
            </div>
            <div>
              <div style={{ fontWeight: 900, fontSize: 18, color: C.ink, lineHeight: 1, letterSpacing: -.3 }}>FoodCost</div>
              <div style={{ fontSize: 9, color: C.ink4, fontWeight: 600, letterSpacing: 1.5 }}>MANAGEMENT</div>
            </div>
          </div>

          {/* Tabs */}
          <div style={{ display: "flex", flex: 1, overflowX: "auto", gap: 2 }}>
            {TABS.map(t2 => {
              const active = tab === t2.id;
              return (
                <button key={t2.id} onClick={() => setTab(t2.id)} style={{ display: "flex", alignItems: "center", gap: 7, padding: "0 16px", height: 62, border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: active ? 800 : 500, color: active ? C.brand : C.ink3, fontFamily: "'Sarabun',sans-serif", borderBottom: active ? `2.5px solid ${C.brand}` : "2.5px solid transparent", transition: "all .15s", whiteSpace: "nowrap" }}>
                  <Ic d={t2.icon} s={15} c={active ? C.brand : C.ink4} />{t2.label}
                </button>
              );
            })}
          </div>

          {/* Right */}
          <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: 11, color: saved ? C.green : C.brand, transition: "color .3s" }}>
              <Ic d={I.save} s={12} c={saved ? C.green : C.brand} />{saved ? "บันทึกแล้ว" : "กำลังบันทึก..."}
            </div>
            <EI ings={ings} menus={menus} cats={cats} onImport={d => { setIngs(d.ingredients); setMenus(d.menus); addH("นำเข้าข้อมูล"); }} />
            <div style={{ height: 28, width: 1, background: C.line }} />
            <span style={{ fontSize: 11, color: C.ink4, whiteSpace: "nowrap" }}>{ings.length} วัตถุดิบ · {menus.length} เมนู</span>
          </div>
        </nav>

        {/* Page */}
        <div style={{ maxWidth: 1280, margin: "0 auto", padding: "24px 28px 56px" }}>
          <div style={{ marginBottom: 22 }}>
            <h1 style={{ fontSize: 26, fontWeight: 900, color: C.ink, marginBottom: 4, letterSpacing: -.3 }}>{TABS.find(t2 => t2.id === tab)?.label}</h1>
            <p style={{ fontSize: 14, color: C.ink3 }}>{DESC[tab]}</p>
          </div>
          {tab === "ingredients" && <IngTab ings={ings} setIngs={setIngs} cats={cats} addH={addH} />}
          {tab === "menus" && <MenuTab menus={menus} setMenus={setMenus} ings={ings} addH={addH} />}
          {tab === "sop" && <SOPTab menus={menus} setMenus={setMenus} ings={ings} />}
          {tab === "summary" && <SumTab menus={menus} ings={ings} />}
          {tab === "history" && <HisTab history={hist} onClear={() => setHist([])} />}
        </div>
      </div>
    </>
  );
}
