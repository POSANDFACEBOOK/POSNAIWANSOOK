import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Icons ──────────────────────────────────────────────
const Icon = ({ d, size = 18, color = "currentColor" }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);
const Icons = {
  ingredient: "M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14H9V8h2v8zm4 0h-2V8h2v8z",
  menu: "M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2",
  sop: "M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6 M16 13H8 M16 17H8 M10 9H8",
  chart: "M18 20V10 M12 20V4 M6 20v-6",
  history: "M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  plus: "M12 5v14 M5 12h14",
  search: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  edit: "M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash: "M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  close: "M6 18L18 6M6 6l12 12",
  check: "M5 13l4 4L19 7",
  warning: "M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  food: "M18 8h1a4 4 0 010 8h-1 M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z M6 1v3 M10 1v3 M14 1v3",
  save: "M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z M17 21v-8H7v8 M7 3v5h8",
  download: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M7 10l5 5 5-5 M12 15V3",
  upload: "M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4 M17 8l-5-5-5 5 M12 3v12",
  wifi: "M5 12.55a11 11 0 0114.08 0 M1.42 9a16 16 0 0121.16 0 M8.53 16.11a6 6 0 016.95 0 M12 20h.01",
};

// ── LocalStorage Hook ──────────────────────────────────
function useLocalStorage(key, initialValue) {
  const [storedValue, setStoredValue] = useState(() => {
    try {
      const item = window.localStorage.getItem(key);
      return item ? JSON.parse(item) : initialValue;
    } catch {
      return initialValue;
    }
  });

  const setValue = useCallback((value) => {
    try {
      const valueToStore = value instanceof Function ? value(storedValue) : value;
      setStoredValue(valueToStore);
      window.localStorage.setItem(key, JSON.stringify(valueToStore));
    } catch (err) {
      console.error("localStorage error:", err);
    }
  }, [key, storedValue]);

  return [storedValue, setValue];
}

// ── Initial Data ───────────────────────────────────────
const INIT_CATEGORIES = ["เนื้อสัตว์", "ผักและผลไม้", "เครื่องปรุง", "นม/ไข่", "แป้ง/ธัญพืช"];
const INIT_INGREDIENTS = [
  { id: 1, name: "ไก่หน้าอก", category: "เนื้อสัตว์", unit: "กก.", price: 120, stock: 5 },
  { id: 2, name: "หมูสามชั้น", category: "เนื้อสัตว์", unit: "กก.", price: 160, stock: 3 },
  { id: 3, name: "กะหล่ำปลี", category: "ผักและผลไม้", unit: "กก.", price: 25, stock: 10 },
  { id: 4, name: "ไข่ไก่", category: "นม/ไข่", unit: "ฟอง", price: 5, stock: 60 },
  { id: 5, name: "ซีอิ้วขาว", category: "เครื่องปรุง", unit: "ขวด", price: 45, stock: 8 },
  { id: 6, name: "น้ำมันพืช", category: "เครื่องปรุง", unit: "ลิตร", price: 60, stock: 6 },
];
const INIT_MENUS = [
  {
    id: 1, name: "ข้าวผัดไก่", category: "อาหารจานเดียว", price: 80,
    ingredients: [
      { ingredientId: 1, amount: 0.15 },
      { ingredientId: 4, amount: 1 },
      { ingredientId: 6, amount: 0.02 },
      { ingredientId: 5, amount: 0.05 },
    ]
  },
  {
    id: 2, name: "ผัดกะหล่ำปลีหมู", category: "อาหารจานเดียว", price: 70,
    ingredients: [
      { ingredientId: 2, amount: 0.1 },
      { ingredientId: 3, amount: 0.2 },
      { ingredientId: 6, amount: 0.02 },
    ]
  },
];

// ── Helpers ────────────────────────────────────────────
function calcMenuCost(menu, ingredients) {
  return menu.ingredients.reduce((sum, item) => {
    const ing = ingredients.find(i => i.id === item.ingredientId);
    return sum + (ing ? ing.price * item.amount : 0);
  }, 0);
}

// ── Save Indicator ─────────────────────────────────────
function SaveIndicator({ saved }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 5,
      fontSize: 11, color: saved ? "#22c55e" : "#f97316",
      transition: "color 0.3s"
    }}>
      <Icon d={Icons.save} size={12} color={saved ? "#22c55e" : "#f97316"} />
      {saved ? "บันทึกแล้ว" : "กำลังบันทึก..."}
    </div>
  );
}

// ── Offline Banner ─────────────────────────────────────
function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);
  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => { window.removeEventListener("online", on); window.removeEventListener("offline", off); };
  }, []);
  if (!offline) return null;
  return (
    <div style={{ background: "#1e293b", color: "#f8fafc", padding: "8px 20px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontFamily: "'Sarabun', sans-serif" }}>
      <Icon d={Icons.wifi} size={14} color="#f8fafc" />
      <span>ออฟไลน์อยู่ — ข้อมูลยังบันทึกในเครื่องครับ ใช้งานได้ตามปกติ</span>
    </div>
  );
}

// ── Modal ──────────────────────────────────────────────
function Modal({ title, onClose, children }) {
  useEffect(() => {
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);
  return (
    <div style={{ position: "fixed", inset: 0, background: "rgba(15,23,42,0.55)", backdropFilter: "blur(4px)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div style={{ background: "#fff", borderRadius: 20, width: "100%", maxWidth: 540, boxShadow: "0 24px 64px rgba(15,23,42,0.18)", overflow: "hidden", animation: "modalIn 0.22s cubic-bezier(.34,1.56,.64,1)", maxHeight: "90vh", display: "flex", flexDirection: "column" }}>
        <div style={{ padding: "22px 28px 16px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between", flexShrink: 0 }}>
          <span style={{ fontFamily: "'Sarabun', sans-serif", fontSize: 18, fontWeight: 700, color: "#0f172a" }}>{title}</span>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "#94a3b8", padding: 4 }}><Icon d={Icons.close} size={20} /></button>
        </div>
        <div style={{ padding: "20px 28px 24px", overflowY: "auto" }}>{children}</div>
      </div>
    </div>
  );
}

// ── Input / Select / Btn ───────────────────────────────
const inputStyle = {
  width: "100%", padding: "10px 14px", border: "1.5px solid #e2e8f0",
  borderRadius: 10, fontSize: 14, fontFamily: "'Sarabun', sans-serif",
  outline: "none", boxSizing: "border-box", color: "#0f172a",
  background: "#f8fafc", transition: "border 0.15s"
};
function Input({ label, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6, fontFamily: "'Sarabun', sans-serif" }}>{label}</label>}
      <input style={inputStyle} {...props} />
    </div>
  );
}
function Select({ label, options, ...props }) {
  return (
    <div style={{ marginBottom: 14 }}>
      {label && <label style={{ display: "block", fontSize: 13, fontWeight: 600, color: "#475569", marginBottom: 6, fontFamily: "'Sarabun', sans-serif" }}>{label}</label>}
      <select style={{ ...inputStyle, appearance: "none" }} {...props}>
        {options.map(o => <option key={o.value ?? o} value={o.value ?? o}>{o.label ?? o}</option>)}
      </select>
    </div>
  );
}
function Btn({ children, variant = "primary", onClick, style = {}, icon, disabled }) {
  const base = { display: "inline-flex", alignItems: "center", gap: 6, padding: "9px 18px", borderRadius: 10, fontSize: 14, fontWeight: 600, cursor: disabled ? "not-allowed" : "pointer", border: "none", fontFamily: "'Sarabun', sans-serif", transition: "all 0.15s", opacity: disabled ? 0.5 : 1, ...style };
  const variants = {
    primary: { background: "linear-gradient(135deg,#f97316,#ef4444)", color: "#fff", boxShadow: "0 4px 14px rgba(249,115,22,0.35)" },
    secondary: { background: "#f1f5f9", color: "#475569" },
    danger: { background: "#fee2e2", color: "#dc2626" },
    ghost: { background: "transparent", color: "#64748b" },
    success: { background: "linear-gradient(135deg,#22c55e,#16a34a)", color: "#fff", boxShadow: "0 4px 14px rgba(34,197,94,0.35)" },
  };
  return <button style={{ ...base, ...variants[variant] }} onClick={disabled ? undefined : onClick}>{icon && <Icon d={icon} size={15} />}{children}</button>;
}

// ── Export / Import ────────────────────────────────────
function ExportImportBar({ ingredients, menus, categories, onImport }) {
  const fileRef = useRef();
  function exportData() {
    const data = { ingredients, menus, categories, exportedAt: new Date().toISOString(), version: "1.0" };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `foodcost-backup-${new Date().toLocaleDateString("th-TH").replace(/\//g, "-")}.json`; a.click();
    URL.revokeObjectURL(url);
  }
  function handleImport(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        if (data.ingredients && data.menus) { onImport(data); alert("นำเข้าข้อมูลสำเร็จครับ!"); }
        else alert("ไฟล์ไม่ถูกต้องครับ");
      } catch { alert("ไม่สามารถอ่านไฟล์ได้ครับ"); }
    };
    reader.readAsText(file); e.target.value = "";
  }
  return (
    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
      <Btn variant="secondary" onClick={exportData} icon={Icons.download} style={{ padding: "6px 12px", fontSize: 12 }}>Export</Btn>
      <Btn variant="secondary" onClick={() => fileRef.current?.click()} icon={Icons.upload} style={{ padding: "6px 12px", fontSize: 12 }}>Import</Btn>
      <input ref={fileRef} type="file" accept=".json" onChange={handleImport} style={{ display: "none" }} />
    </div>
  );
}

// ── Ingredient Tab ─────────────────────────────────────
function IngredientTab({ ingredients, setIngredients, categories, addHistory }) {
  const [search, setSearch] = useState("");
  const [filterCat, setFilterCat] = useState("ทุกหมวด");
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: "", category: categories[0], unit: "กก.", price: "", stock: "" });
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 20;

  const filtered = useMemo(() =>
    ingredients.filter(i =>
      i.name.toLowerCase().includes(search.toLowerCase()) &&
      (filterCat === "ทุกหมวด" || i.category === filterCat)
    ), [ingredients, search, filterCat]);

  const paged = useMemo(() => filtered.slice(0, page * PAGE_SIZE), [filtered, page]);
  const hasMore = paged.length < filtered.length;

  const openAdd = useCallback(() => { setForm({ name: "", category: categories[0], unit: "กก.", price: "", stock: "" }); setEditItem(null); setShowAdd(true); }, [categories]);
  const openEdit = useCallback((item) => { setForm({ ...item }); setEditItem(item.id); setShowAdd(true); }, []);

  const save = useCallback(() => {
    if (!form.name || !form.price) return;
    if (editItem) {
      setIngredients(prev => prev.map(i => i.id === editItem ? { ...i, ...form, price: +form.price, stock: +form.stock } : i));
      addHistory(`แก้ไขวัตถุดิบ: ${form.name}`);
    } else {
      setIngredients(prev => [...prev, { ...form, id: Date.now(), price: +form.price, stock: +form.stock }]);
      addHistory(`เพิ่มวัตถุดิบใหม่: ${form.name}`);
    }
    setShowAdd(false);
  }, [form, editItem, setIngredients, addHistory]);

  const del = useCallback((id, name) => {
    if (!window.confirm(`ลบ "${name}" ออกจากระบบ?`)) return;
    setIngredients(prev => prev.filter(i => i.id !== id));
    addHistory(`ลบวัตถุดิบ: ${name}`);
  }, [setIngredients, addHistory]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, flexWrap: "wrap", alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}><Icon d={Icons.search} size={16} /></span>
          <input value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} placeholder="ค้นหาวัตถุดิบ..." style={{ ...inputStyle, paddingLeft: 38 }} />
        </div>
        <select value={filterCat} onChange={e => { setFilterCat(e.target.value); setPage(1); }} style={{ ...inputStyle, width: "auto", minWidth: 150 }}>
          <option>ทุกหมวด</option>
          {categories.map(c => <option key={c}>{c}</option>)}
        </select>
        <Btn onClick={openAdd} icon={Icons.plus}>เพิ่มวัตถุดิบ</Btn>
      </div>
      <div style={{ marginBottom: 10, fontSize: 12, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>
        แสดง {paged.length} จาก {filtered.length} รายการ
      </div>
      {paged.length === 0 ? (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8" }}>
          <Icon d={Icons.warning} size={40} color="#cbd5e1" />
          <p style={{ marginTop: 12, fontFamily: "'Sarabun', sans-serif" }}>ไม่พบวัตถุดิบ</p>
        </div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(280px,1fr))", gap: 14 }}>
            {paged.map(item => (
              <div key={item.id} style={{ background: "#fff", borderRadius: 16, padding: "18px 20px", boxShadow: "0 1px 8px rgba(15,23,42,0.07)", border: "1px solid #f1f5f9", transition: "transform 0.15s,box-shadow 0.15s" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,23,42,0.12)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 1px 8px rgba(15,23,42,0.07)"; }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 15, color: "#0f172a", fontFamily: "'Sarabun', sans-serif" }}>{item.name}</div>
                    <span style={{ display: "inline-block", marginTop: 4, padding: "2px 10px", background: "#fff7ed", color: "#f97316", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{item.category}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openEdit(item)} style={{ background: "#f0f9ff", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: "#0ea5e9" }}><Icon d={Icons.edit} size={14} /></button>
                    <button onClick={() => del(item.id, item.name)} style={{ background: "#fff1f2", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: "#f43f5e" }}><Icon d={Icons.trash} size={14} /></button>
                  </div>
                </div>
                <div style={{ display: "flex", gap: 20, marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>ราคา/{item.unit}</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#f97316", fontFamily: "'Sarabun', sans-serif" }}>฿{item.price.toLocaleString()}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 11, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>สต็อก</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: item.stock < 3 ? "#ef4444" : "#22c55e", fontFamily: "'Sarabun', sans-serif" }}>{item.stock} {item.unit}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {hasMore && (
            <div style={{ textAlign: "center", marginTop: 20 }}>
              <Btn variant="secondary" onClick={() => setPage(p => p + 1)}>โหลดเพิ่ม ({filtered.length - paged.length} รายการ)</Btn>
            </div>
          )}
        </>
      )}
      {showAdd && (
        <Modal title={editItem ? "แก้ไขวัตถุดิบ" : "เพิ่มวัตถุดิบใหม่"} onClose={() => setShowAdd(false)}>
          <Input label="ชื่อวัตถุดิบ" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น ไก่หน้าอก" autoFocus />
          <Select label="หมวดหมู่" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} options={categories} />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="หน่วย" value={form.unit} onChange={e => setForm({ ...form, unit: e.target.value })} placeholder="กก., ฟอง, ขวด" />
            <Input label="ราคา (บาท)" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0" />
          </div>
          <Input label="สต็อกปัจจุบัน" type="number" value={form.stock} onChange={e => setForm({ ...form, stock: e.target.value })} placeholder="0" />
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>ยกเลิก</Btn>
            <Btn onClick={save} icon={Icons.check} disabled={!form.name || !form.price}>{editItem ? "บันทึก" : "เพิ่ม"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Menu Tab ───────────────────────────────────────────
function MenuTab({ menus, setMenus, ingredients, addHistory }) {
  const [search, setSearch] = useState("");
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState(null);
  const [form, setForm] = useState({ name: "", category: "อาหารจานเดียว", price: "", ingredients: [] });
  const [newIng, setNewIng] = useState({ ingredientId: "", amount: "" });

  const filtered = useMemo(() => menus.filter(m => m.name.toLowerCase().includes(search.toLowerCase())), [menus, search]);

  const openAdd = useCallback(() => { setForm({ name: "", category: "อาหารจานเดียว", price: "", ingredients: [] }); setEditItem(null); setShowAdd(true); }, []);
  const openEdit = useCallback((item) => { setForm({ ...item }); setEditItem(item.id); setShowAdd(true); }, []);
  const addIngredient = useCallback(() => {
    if (!newIng.ingredientId || !newIng.amount) return;
    setForm(f => ({ ...f, ingredients: [...f.ingredients, { ingredientId: +newIng.ingredientId, amount: +newIng.amount }] }));
    setNewIng({ ingredientId: "", amount: "" });
  }, [newIng]);
  const removeIng = useCallback((idx) => { setForm(f => ({ ...f, ingredients: f.ingredients.filter((_, i) => i !== idx) })); }, []);
  const save = useCallback(() => {
    if (!form.name || !form.price) return;
    if (editItem) {
      setMenus(prev => prev.map(m => m.id === editItem ? { ...m, ...form, price: +form.price } : m));
      addHistory(`แก้ไขเมนู: ${form.name}`);
    } else {
      setMenus(prev => [...prev, { ...form, id: Date.now(), price: +form.price }]);
      addHistory(`เพิ่มเมนูใหม่: ${form.name}`);
    }
    setShowAdd(false);
  }, [form, editItem, setMenus, addHistory]);
  const del = useCallback((id, name) => {
    if (!window.confirm(`ลบเมนู "${name}" ออกจากระบบ?`)) return;
    setMenus(prev => prev.filter(m => m.id !== id));
    addHistory(`ลบเมนู: ${name}`);
  }, [setMenus, addHistory]);

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 20, alignItems: "center" }}>
        <div style={{ position: "relative", flex: 1, minWidth: 200 }}>
          <span style={{ position: "absolute", left: 12, top: "50%", transform: "translateY(-50%)", color: "#94a3b8" }}><Icon d={Icons.search} size={16} /></span>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="ค้นหาเมนู..." style={{ ...inputStyle, paddingLeft: 38 }} />
        </div>
        <Btn onClick={openAdd} icon={Icons.plus}>เพิ่มเมนู</Btn>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(300px,1fr))", gap: 14 }}>
        {filtered.map(menu => {
          const cost = calcMenuCost(menu, ingredients);
          const profit = menu.price - cost;
          const margin = menu.price > 0 ? (profit / menu.price * 100) : 0;
          return (
            <div key={menu.id} style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(15,23,42,0.07)", border: "1px solid #f1f5f9", transition: "transform 0.15s,box-shadow 0.15s" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; e.currentTarget.style.boxShadow = "0 8px 24px rgba(15,23,42,0.12)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = ""; e.currentTarget.style.boxShadow = "0 1px 8px rgba(15,23,42,0.07)"; }}>
              <div style={{ height: 6, background: margin >= 60 ? "linear-gradient(90deg,#22c55e,#16a34a)" : margin >= 40 ? "linear-gradient(90deg,#f59e0b,#d97706)" : "linear-gradient(90deg,#ef4444,#dc2626)" }} />
              <div style={{ padding: "18px 20px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 16, color: "#0f172a", fontFamily: "'Sarabun', sans-serif" }}>{menu.name}</div>
                    <span style={{ display: "inline-block", marginTop: 4, padding: "2px 10px", background: "#f0f9ff", color: "#0ea5e9", borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{menu.category}</span>
                  </div>
                  <div style={{ display: "flex", gap: 6 }}>
                    <button onClick={() => openEdit(menu)} style={{ background: "#f0f9ff", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: "#0ea5e9" }}><Icon d={Icons.edit} size={14} /></button>
                    <button onClick={() => del(menu.id, menu.name)} style={{ background: "#fff1f2", border: "none", borderRadius: 8, padding: 6, cursor: "pointer", color: "#f43f5e" }}><Icon d={Icons.trash} size={14} /></button>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
                  {[
                    { label: "ราคาขาย", value: `฿${menu.price}`, color: "#0f172a" },
                    { label: "ต้นทุน", value: `฿${cost.toFixed(1)}`, color: "#f97316" },
                    { label: "กำไร %", value: `${margin.toFixed(0)}%`, color: margin >= 60 ? "#22c55e" : margin >= 40 ? "#f59e0b" : "#ef4444" },
                  ].map(stat => (
                    <div key={stat.label} style={{ background: "#f8fafc", borderRadius: 10, padding: "8px 10px", textAlign: "center" }}>
                      <div style={{ fontSize: 10, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>{stat.label}</div>
                      <div style={{ fontSize: 15, fontWeight: 800, color: stat.color, fontFamily: "'Sarabun', sans-serif" }}>{stat.value}</div>
                    </div>
                  ))}
                </div>
                <div style={{ marginTop: 10, fontSize: 11, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>{menu.ingredients.length} วัตถุดิบ</div>
              </div>
            </div>
          );
        })}
      </div>
      {showAdd && (
        <Modal title={editItem ? "แก้ไขเมนู" : "เพิ่มเมนูใหม่"} onClose={() => setShowAdd(false)}>
          <Input label="ชื่อเมนู" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="เช่น ข้าวผัดไก่" autoFocus />
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Input label="หมวดหมู่" value={form.category} onChange={e => setForm({ ...form, category: e.target.value })} placeholder="อาหารจานเดียว" />
            <Input label="ราคาขาย (บาท)" type="number" value={form.price} onChange={e => setForm({ ...form, price: e.target.value })} placeholder="0" />
          </div>
          <div style={{ marginBottom: 8, fontSize: 13, fontWeight: 600, color: "#475569", fontFamily: "'Sarabun', sans-serif" }}>วัตถุดิบที่ใช้</div>
          {form.ingredients.map((mi, idx) => {
            const ing = ingredients.find(i => i.id === mi.ingredientId);
            return (
              <div key={idx} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, background: "#f8fafc", borderRadius: 8, padding: "6px 10px" }}>
                <span style={{ flex: 1, fontSize: 13, fontFamily: "'Sarabun', sans-serif", color: "#0f172a" }}>{ing?.name ?? "?"}</span>
                <span style={{ fontSize: 12, color: "#64748b" }}>{mi.amount} {ing?.unit}</span>
                <button onClick={() => removeIng(idx)} style={{ background: "none", border: "none", cursor: "pointer", color: "#f43f5e" }}><Icon d={Icons.close} size={14} /></button>
              </div>
            );
          })}
          <div style={{ display: "flex", gap: 8, alignItems: "flex-end" }}>
            <div style={{ flex: 2 }}>
              <select value={newIng.ingredientId} onChange={e => setNewIng({ ...newIng, ingredientId: e.target.value })} style={inputStyle}>
                <option value="">-- เลือกวัตถุดิบ --</option>
                {ingredients.map(i => <option key={i.id} value={i.id}>{i.name} ({i.unit})</option>)}
              </select>
            </div>
            <div style={{ flex: 1 }}>
              <input type="number" value={newIng.amount} onChange={e => setNewIng({ ...newIng, amount: e.target.value })} placeholder="จำนวน" style={inputStyle} />
            </div>
            <Btn variant="secondary" onClick={addIngredient} icon={Icons.plus} style={{ marginBottom: 14 }}>เพิ่ม</Btn>
          </div>
          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end", marginTop: 8 }}>
            <Btn variant="secondary" onClick={() => setShowAdd(false)}>ยกเลิก</Btn>
            <Btn onClick={save} icon={Icons.check} disabled={!form.name || !form.price}>{editItem ? "บันทึก" : "เพิ่ม"}</Btn>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ── Summary Tab ────────────────────────────────────────
function SummaryTab({ menus, ingredients }) {
  const items = useMemo(() => menus.map(m => {
    const cost = calcMenuCost(m, ingredients);
    const profit = m.price - cost;
    const margin = m.price > 0 ? profit / m.price * 100 : 0;
    return { ...m, cost, profit, margin };
  }), [menus, ingredients]);

  const stats = useMemo(() => ({
    avgMargin: items.length ? items.reduce((s, i) => s + i.margin, 0) / items.length : 0,
    totalMenus: items.length,
    highProfit: items.filter(i => i.margin >= 60).length,
    totalRevenue: items.reduce((s, i) => s + i.price, 0),
  }), [items]);

  const [sortBy, setSortBy] = useState("margin");
  const sorted = useMemo(() => [...items].sort((a, b) => b[sortBy] - a[sortBy]), [items, sortBy]);

  return (
    <div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(180px,1fr))", gap: 14, marginBottom: 24 }}>
        {[
          { label: "เมนูทั้งหมด", value: stats.totalMenus, unit: "เมนู", color: "#6366f1" },
          { label: "กำไรเฉลี่ย", value: stats.avgMargin.toFixed(1), unit: "%", color: "#f97316" },
          { label: "เมนูกำไรสูง", value: stats.highProfit, unit: "เมนู", color: "#22c55e" },
          { label: "ราคาขายรวม", value: `฿${stats.totalRevenue.toLocaleString()}`, unit: "", color: "#0ea5e9" },
        ].map(card => (
          <div key={card.label} style={{ background: "#fff", borderRadius: 16, padding: "20px 22px", boxShadow: "0 1px 8px rgba(15,23,42,0.07)" }}>
            <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif", marginBottom: 6 }}>{card.label}</div>
            <div style={{ fontSize: 26, fontWeight: 800, color: card.color, fontFamily: "'Sarabun', sans-serif", lineHeight: 1 }}>
              {card.value}<span style={{ fontSize: 13, fontWeight: 600, marginLeft: 2 }}>{card.unit}</span>
            </div>
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(15,23,42,0.07)" }}>
        <div style={{ padding: "16px 20px", borderBottom: "1px solid #f1f5f9", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontWeight: 700, fontSize: 15, fontFamily: "'Sarabun', sans-serif", color: "#0f172a" }}>สรุปต้นทุนแต่ละเมนู</span>
          <select value={sortBy} onChange={e => setSortBy(e.target.value)} style={{ ...inputStyle, width: "auto", fontSize: 12, padding: "5px 10px" }}>
            <option value="margin">เรียงตาม % กำไร</option>
            <option value="profit">เรียงตามกำไร</option>
            <option value="price">เรียงตามราคาขาย</option>
            <option value="cost">เรียงตามต้นทุน</option>
          </select>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "'Sarabun', sans-serif" }}>
            <thead>
              <tr style={{ background: "#f8fafc" }}>
                {["เมนู", "หมวด", "ราคาขาย", "ต้นทุน", "กำไร", "% กำไร", "สถานะ"].map(h => (
                  <th key={h} style={{ padding: "10px 16px", textAlign: "left", fontSize: 12, fontWeight: 700, color: "#64748b" }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((item, idx) => (
                <tr key={item.id} style={{ borderTop: "1px solid #f1f5f9", background: idx % 2 === 0 ? "#fff" : "#fafafa" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 600, color: "#0f172a" }}>{item.name}</td>
                  <td style={{ padding: "12px 16px", color: "#64748b", fontSize: 13 }}>{item.category}</td>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: "#0f172a" }}>฿{item.price}</td>
                  <td style={{ padding: "12px 16px", color: "#f97316", fontWeight: 600 }}>฿{item.cost.toFixed(1)}</td>
                  <td style={{ padding: "12px 16px", color: item.profit >= 0 ? "#22c55e" : "#ef4444", fontWeight: 600 }}>฿{item.profit.toFixed(1)}</td>
                  <td style={{ padding: "12px 16px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ flex: 1, height: 6, background: "#f1f5f9", borderRadius: 999, minWidth: 60 }}>
                        <div style={{ height: "100%", width: `${Math.min(Math.max(item.margin, 0), 100)}%`, background: item.margin >= 60 ? "#22c55e" : item.margin >= 40 ? "#f59e0b" : "#ef4444", borderRadius: 999, transition: "width 0.3s" }} />
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: "#475569", minWidth: 36 }}>{item.margin.toFixed(0)}%</span>
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    <span style={{ padding: "3px 10px", borderRadius: 20, fontSize: 11, fontWeight: 700, background: item.margin >= 60 ? "#dcfce7" : item.margin >= 40 ? "#fef9c3" : "#fee2e2", color: item.margin >= 60 ? "#15803d" : item.margin >= 40 ? "#a16207" : "#b91c1c" }}>
                      {item.margin >= 60 ? "ดี" : item.margin >= 40 ? "พอใช้" : "ต่ำ"}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── SOP Tab ────────────────────────────────────────────
function SOPTab({ menus, ingredients }) {
  const [selected, setSelected] = useState(menus[0]?.id ?? null);
  const menu = useMemo(() => menus.find(m => m.id === selected), [menus, selected]);
  return (
    <div style={{ display: "grid", gridTemplateColumns: "220px 1fr", gap: 16 }}>
      <div style={{ background: "#fff", borderRadius: 16, padding: 12, boxShadow: "0 1px 8px rgba(15,23,42,0.07)" }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "#94a3b8", padding: "6px 8px", fontFamily: "'Sarabun', sans-serif", marginBottom: 4 }}>เมนูทั้งหมด</div>
        {menus.map(m => (
          <div key={m.id} onClick={() => setSelected(m.id)} style={{ padding: "10px 12px", borderRadius: 10, cursor: "pointer", marginBottom: 4, background: selected === m.id ? "#fff7ed" : "transparent", color: selected === m.id ? "#f97316" : "#475569", fontFamily: "'Sarabun', sans-serif", fontSize: 14, fontWeight: selected === m.id ? 700 : 500, transition: "all 0.1s" }}>
            {m.name}
          </div>
        ))}
      </div>
      <div style={{ background: "#fff", borderRadius: 16, padding: "22px 24px", boxShadow: "0 1px 8px rgba(15,23,42,0.07)" }}>
        {menu ? (
          <>
            <h2 style={{ fontFamily: "'Sarabun', sans-serif", fontSize: 20, fontWeight: 800, color: "#0f172a", marginBottom: 6 }}>{menu.name}</h2>
            <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Sarabun', sans-serif", marginBottom: 20 }}>ราคาขาย: ฿{menu.price} | ต้นทุน: ฿{calcMenuCost(menu, ingredients).toFixed(1)}</div>
            <div style={{ fontSize: 14, fontWeight: 700, color: "#475569", fontFamily: "'Sarabun', sans-serif", marginBottom: 10 }}>วัตถุดิบ</div>
            {menu.ingredients.map((mi, idx) => {
              const ing = ingredients.find(i => i.id === mi.ingredientId);
              return ing ? (
                <div key={idx} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid #f8fafc", fontFamily: "'Sarabun', sans-serif" }}>
                  <span style={{ fontSize: 14, color: "#0f172a" }}>{ing.name}</span>
                  <span style={{ fontSize: 14, color: "#f97316", fontWeight: 600 }}>{mi.amount} {ing.unit} = ฿{(ing.price * mi.amount).toFixed(1)}</span>
                </div>
              ) : null;
            })}
            <div style={{ marginTop: 20, padding: "14px 16px", background: "#f8fafc", borderRadius: 12 }}>
              <div style={{ fontSize: 13, color: "#64748b", fontFamily: "'Sarabun', sans-serif" }}>ขั้นตอนการทำ (SOP)</div>
              <ol style={{ paddingLeft: 20, marginTop: 10, fontFamily: "'Sarabun', sans-serif", fontSize: 14, color: "#475569", lineHeight: 2 }}>
                <li>เตรียมวัตถุดิบทั้งหมดตามรายการ</li>
                <li>ล้างและหั่นวัตถุดิบให้พร้อม</li>
                <li>ตั้งกระทะให้ร้อน ใส่น้ำมัน</li>
                <li>ผัดวัตถุดิบตามลำดับ</li>
                <li>ปรุงรสและตักเสิร์ฟ</li>
              </ol>
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>เลือกเมนูเพื่อดู SOP</div>
        )}
      </div>
    </div>
  );
}

// ── History Tab ────────────────────────────────────────
function HistoryTab({ history, onClear }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12 }}>
        {history.length > 0 && <Btn variant="danger" onClick={() => { if (window.confirm("ลบประวัติทั้งหมด?")) onClear(); }} icon={Icons.trash} style={{ fontSize: 12, padding: "6px 12px" }}>ลบประวัติ</Btn>}
      </div>
      <div style={{ background: "#fff", borderRadius: 16, overflow: "hidden", boxShadow: "0 1px 8px rgba(15,23,42,0.07)" }}>
        {history.length === 0 ? (
          <div style={{ textAlign: "center", padding: "60px 0", color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>
            <Icon d={Icons.history} size={40} color="#cbd5e1" />
            <p style={{ marginTop: 12 }}>ยังไม่มีประวัติการเปลี่ยนแปลง</p>
          </div>
        ) : (
          history.map((item, idx) => (
            <div key={idx} style={{ display: "flex", alignItems: "center", gap: 14, padding: "14px 20px", borderBottom: "1px solid #f1f5f9" }}>
              <div style={{ width: 36, height: 36, borderRadius: "50%", background: "#fff7ed", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
                <Icon d={Icons.check} size={16} color="#f97316" />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 600, color: "#0f172a", fontFamily: "'Sarabun', sans-serif" }}>{item.action}</div>
                <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "'Sarabun', sans-serif" }}>{item.time}</div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}

// ── Main App ───────────────────────────────────────────
export default function FoodCostApp() {
  const [activeTab, setActiveTab] = useState("ingredients");
  const [ingredients, setIngredients] = useLocalStorage("foodcost_ingredients", INIT_INGREDIENTS);
  const [menus, setMenus] = useLocalStorage("foodcost_menus", INIT_MENUS);
  const [categories] = useLocalStorage("foodcost_categories", INIT_CATEGORIES);
  const [history, setHistory] = useLocalStorage("foodcost_history", []);
  const [saved, setSaved] = useState(true);
  const saveTimer = useRef(null);

  useEffect(() => {
    setSaved(false);
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => setSaved(true), 600);
    return () => clearTimeout(saveTimer.current);
  }, [ingredients, menus]);

  const addHistory = useCallback((action) => {
    setHistory(prev => [{ action, time: new Date().toLocaleString("th-TH") }, ...prev.slice(0, 99)]);
  }, [setHistory]);

  const handleImport = useCallback((data) => {
    setIngredients(data.ingredients);
    setMenus(data.menus);
    addHistory("นำเข้าข้อมูลจากไฟล์ backup");
  }, [setIngredients, setMenus, addHistory]);

  const tabs = [
    { id: "ingredients", label: "วัตถุดิบ", icon: Icons.ingredient },
    { id: "menus", label: "เมนู", icon: Icons.food },
    { id: "sop", label: "SOP", icon: Icons.sop },
    { id: "summary", label: "สรุปต้นทุน", icon: Icons.chart },
    { id: "history", label: "ประวัติ", icon: Icons.history },
  ];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800&display=swap');
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { background: #f1f5f9; }
        @keyframes modalIn { from { opacity: 0; transform: scale(0.92) translateY(10px); } to { opacity: 1; transform: scale(1) translateY(0); } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: #f1f5f9; }
        ::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 999px; }
      `}</style>
      <OfflineBanner />
      <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#fef3ec 0%,#f1f5f9 60%)", fontFamily: "'Sarabun', sans-serif" }}>
        <nav style={{ background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)", borderBottom: "1px solid rgba(241,245,249,0.8)", padding: "0 24px", display: "flex", alignItems: "center", gap: 0, position: "sticky", top: 0, zIndex: 100, height: 58 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginRight: 24 }}>
            <div style={{ width: 32, height: 32, background: "linear-gradient(135deg,#f97316,#ef4444)", borderRadius: 8, display: "flex", alignItems: "center", justifyContent: "center" }}>
              <Icon d={Icons.food} size={16} color="#fff" />
            </div>
            <span style={{ fontWeight: 800, fontSize: 18, background: "linear-gradient(135deg,#f97316,#ef4444)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>FoodCost</span>
          </div>
          <div style={{ display: "flex", flex: 1, overflowX: "auto" }}>
            {tabs.map(tab => (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{ display: "flex", alignItems: "center", gap: 6, padding: "0 16px", height: 58, border: "none", background: "none", cursor: "pointer", fontSize: 14, fontWeight: activeTab === tab.id ? 700 : 500, color: activeTab === tab.id ? "#f97316" : "#64748b", fontFamily: "'Sarabun', sans-serif", borderBottom: activeTab === tab.id ? "2.5px solid #f97316" : "2.5px solid transparent", transition: "all 0.15s", whiteSpace: "nowrap" }}>
                <Icon d={tab.icon} size={15} color={activeTab === tab.id ? "#f97316" : "#94a3b8"} />
                {tab.label}
              </button>
            ))}
          </div>
          <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 12, flexShrink: 0 }}>
            <SaveIndicator saved={saved} />
            <ExportImportBar ingredients={ingredients} menus={menus} categories={categories} onImport={handleImport} />
            <span style={{ fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>{ingredients.length} วัตถุดิบ · {menus.length} เมนู</span>
          </div>
        </nav>
        <div style={{ padding: "28px 28px 0" }}>
          <h1 style={{ fontSize: 26, fontWeight: 800, color: "#0f172a", marginBottom: 4 }}>{tabs.find(t => t.id === activeTab)?.label}</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>
            {activeTab === "ingredients" && "จัดการวัตถุดิบและราคาสำหรับคำนวณต้นทุน"}
            {activeTab === "menus" && "กำหนดส่วนผสมและคำนวณต้นทุนต่อเมนู"}
            {activeTab === "sop" && "ขั้นตอนการทำและสูตรมาตรฐาน"}
            {activeTab === "summary" && "ภาพรวมต้นทุนและกำไรทุกเมนู"}
            {activeTab === "history" && "บันทึกการเปลี่ยนแปลงข้อมูลในระบบ"}
          </p>
        </div>
        <div style={{ padding: "0 28px 40px" }}>
          {activeTab === "ingredients" && <IngredientTab ingredients={ingredients} setIngredients={setIngredients} categories={categories} addHistory={addHistory} />}
          {activeTab === "menus" && <MenuTab menus={menus} setMenus={setMenus} ingredients={ingredients} addHistory={addHistory} />}
          {activeTab === "sop" && <SOPTab menus={menus} ingredients={ingredients} />}
          {activeTab === "summary" && <SummaryTab menus={menus} ingredients={ingredients} />}
          {activeTab === "history" && <HistoryTab history={history} onClear={() => setHistory([])} />}
        </div>
      </div>
    </>
  );
}
