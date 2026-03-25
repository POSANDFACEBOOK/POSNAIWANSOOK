import { useState, useEffect, useCallback, useMemo, useRef } from "react";

// ── Supabase ───────────────────────────────────────────
const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";

async function sb(path, opts = {}) {
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": opts.prefer || "return=representation", ...opts.headers },
    ...opts,
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

const db = {
  getTables: (bid) => sb(`tables?order=table_number.asc${bid?`&branch_id=eq.${bid}`:""}&active=eq.true`),
  addTable: (d) => sb("tables", { method:"POST", body:JSON.stringify(d) }),
  updateTable: (id, d) => sb(`tables?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  deleteTable: (id) => sb(`tables?id=eq.${id}`, { method:"DELETE", headers:{"Prefer":"return=minimal"} }),
  getMenus: (bid) => sb(`menus?order=name.asc${bid?`&branch_id=eq.${bid}`:""}`),
  getCategories: () => sb("categories?type=eq.menu&order=name.asc"),
  getOrders: (bid) => sb(`orders?order=created_at.desc${bid?`&branch_id=eq.${bid}`:""}&limit=200`),
  getActiveOrders: (bid) => sb(`orders?status=neq.paid&status=neq.cancelled&order=created_at.desc${bid?`&branch_id=eq.${bid}`:""}`),
  getOrderByTable: (tid) => sb(`orders?table_id=eq.${tid}&status=neq.paid&status=neq.cancelled&order=created_at.desc&limit=1`),
  createOrder: (d) => sb("orders", { method:"POST", body:JSON.stringify(d) }),
  updateOrder: (id, d) => sb(`orders?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  getBranches: () => sb("branches?order=id.asc&active=eq.true"),
  loginUser: (u, p) => sb(`app_users?username=eq.${u}&password=eq.${p}&active=eq.true`),
};

// ── Colors ─────────────────────────────────────────────
const C = {
  brand:"#FF6B35", brandDark:"#E85520", brandLight:"#FFF4F0", brandBorder:"#FFD4C2",
  green:"#10B981", greenLight:"#ECFDF5", greenDark:"#065F46",
  blue:"#3B82F6", blueLight:"#EFF6FF",
  yellow:"#F59E0B", yellowLight:"#FFFBEB",
  red:"#EF4444", redLight:"#FEF2F2",
  purple:"#8B5CF6", purpleLight:"#F5F3FF",
  teal:"#0D9488", tealLight:"#F0FDFA",
  ink:"#0F172A", ink2:"#334155", ink3:"#64748B", ink4:"#94A3B8",
  line:"#E2E8F0", lineLight:"#F1F5F9", bg:"#F8FAFC", white:"#FFFFFF",
};

// Table status colors
const TS = {
  available: { bg:C.greenLight, border:C.green, text:C.green, label:"ว่าง" },
  occupied:  { bg:"#FFF7ED", border:C.brand, text:C.brand, label:"มีลูกค้า" },
  ordering:  { bg:C.yellowLight, border:C.yellow, text:"#92400E", label:"กำลังสั่ง" },
  bill:      { bg:C.redLight, border:C.red, text:C.red, label:"เรียกบิล" },
  cleaning:  { bg:C.lineLight, border:C.line, text:C.ink3, label:"กำลังทำความสะอาด" },
};

// ── Icons ──────────────────────────────────────────────
const Ic = ({ d, s=18, c="currentColor", sw=1.75, fill="none" }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill={fill} stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    {Array.isArray(d)?d.map((p,i)=><path key={i} d={p}/>):<path d={d}/>}
  </svg>
);
const I = {
  table:["M3 3h18v18H3z","M3 9h18","M3 15h18","M9 3v18","M15 3v18"],
  menu:["M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2","M9 5a2 2 0 002 2h2a2 2 0 002-2","M9 12h6","M9 16h4"],
  order:["M9 11l3 3L22 4","M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"],
  bill:["M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"],
  plus:["M12 5v14","M5 12h14"],
  minus:"M5 12h14",
  x:["M18 6L6 18","M6 6l12 12"],
  check:"M5 13l4 4L19 7",
  trash:"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  edit:"M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  qr:["M3 3h6v6H3z","M15 3h6v6h-6z","M3 15h6v6H3z","M15 15h2v2h-2z","M19 15v2","M15 19h2","M19 19h2","M19 21v-2"],
  print:["M6 9V2h12v7","M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2","M6 14h12v8H6z"],
  user:["M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2","M12 11a4 4 0 100-8 4 4 0 000 8z"],
  lock:["M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z","M7 11V7a5 5 0 0110 0v4"],
  logout:["M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4","M16 17l5-5-5-5","M21 12H9"],
  settings:["M12 15a3 3 0 100-6 3 3 0 000 6z","M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"],
  fire:"M12 2c0 6-6 7-6 12a6 6 0 0012 0c0-5-6-6-6-12z",
  refresh:"M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0020.49 15",
  warning:"M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  eye:["M1 12s4-8 11-8 11 8 11 8","M1 12s4 8 11 8 11-8 11-8","M12 9a3 3 0 100 6 3 3 0 000-6z"],
  drag:"M9 3h.01M15 3h.01M9 9h.01M15 9h.01M9 15h.01M15 15h.01",
  cash:"M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6",
  credit:["M1 4h22v16H1z","M1 10h22"],
  scan:["M3 9V5a2 2 0 012-2h4","M15 3h4a2 2 0 012 2v4","M21 15v4a2 2 0 01-2 2h-4","M9 21H5a2 2 0 01-2-2v-4","M7 12h10"],
  branch:["M6 3v12","M18 9a3 3 0 100-6 3 3 0 000 6z","M6 21a3 3 0 100-6 3 3 0 000 6z","M15 6a9 9 0 01-9 9"],
  grid:"M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z",
  list:["M8 6h13","M8 12h13","M8 18h13","M3 6h.01","M3 12h.01","M3 18h.01"],
  clock:"M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  people:["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2","M9 11a4 4 0 100-8 4 4 0 000 8z","M23 21v-2a4 4 0 00-3-3.87","M16 3.13a4 4 0 010 7.75"],
  note:"M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z M14 2v6h6",
  shop:"M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z",
  food:"M18 8h1a4 4 0 010 8h-1 M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z M6 1v3 M10 1v3 M14 1v3",
};

const nowStr = () => new Date().toLocaleString("th-TH");
const iS = {width:"100%",padding:"10px 14px",border:`1.5px solid ${C.line}`,borderRadius:10,fontSize:14,fontFamily:"'Sarabun',sans-serif",outline:"none",boxSizing:"border-box",color:C.ink,background:C.white};

function Btn({children,v="primary",onClick,icon,disabled,full,s,loading,small}){
  const st={
    primary:{bg:`linear-gradient(135deg,${C.brand},${C.brandDark})`,c:C.white,sh:`0 4px 14px ${C.brand}44`},
    success:{bg:`linear-gradient(135deg,${C.green},#059669)`,c:C.white,sh:`0 4px 14px ${C.green}44`},
    ghost:{bg:C.white,c:C.ink2,sh:`0 0 0 1.5px ${C.line}`},
    danger:{bg:C.redLight,c:C.red,sh:"none"},
    info:{bg:`linear-gradient(135deg,${C.blue},#2563EB)`,c:C.white,sh:`0 4px 14px ${C.blue}44`},
    yellow:{bg:`linear-gradient(135deg,${C.yellow},#D97706)`,c:C.white,sh:`0 4px 14px ${C.yellow}44`},
    dark:{bg:`linear-gradient(135deg,${C.ink},${C.ink2})`,c:C.white,sh:`0 4px 14px ${C.ink}44`},
  }[v]||{bg:C.lineLight,c:C.ink2,sh:"none"};
  const pd = small?"7px 14px":"10px 20px";
  return <button onClick={(disabled||loading)?undefined:onClick} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:6,padding:pd,borderRadius:10,fontSize:small?13:14,fontWeight:700,cursor:(disabled||loading)?"not-allowed":"pointer",border:"none",fontFamily:"'Sarabun',sans-serif",transition:"all .15s",opacity:(disabled||loading)?.6:1,background:st.bg,color:st.c,boxShadow:st.sh,width:full?"100%":undefined,whiteSpace:"nowrap",...s}} onMouseEnter={e=>{if(!disabled&&!loading)e.currentTarget.style.opacity=".85";}} onMouseLeave={e=>e.currentTarget.style.opacity="1"}>
    {loading?<>⟳ รอสักครู่...</>:<>{icon&&<Ic d={icon} s={small?13:15} c={st.c}/>}{children}</>}
  </button>;
}

function Chip({children,color="gray",size="sm"}){
  const m={orange:[C.brandLight,C.brand],blue:[C.blueLight,C.blue],green:[C.greenLight,C.green],red:[C.redLight,C.red],yellow:[C.yellowLight,"#92400E"],gray:[C.lineLight,C.ink3],purple:[C.purpleLight,C.purple],teal:[C.tealLight,C.teal]};
  const[bg,tc]=m[color]||m.gray;
  return <span style={{display:"inline-flex",alignItems:"center",padding:size==="xs"?"1px 7px":"2px 10px",background:bg,color:tc,borderRadius:20,fontSize:size==="xs"?10:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>{children}</span>;
}

function Modal({title,onClose,children,wide,full}){
  useEffect(()=>{const h=e=>e.key==="Escape"&&onClose();document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h);},[]);
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",backdropFilter:"blur(6px)",display:"flex",alignItems:full?"stretch":"center",justifyContent:"center",zIndex:2000,padding:full?0:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:C.white,borderRadius:full?0:18,width:"100%",maxWidth:full?"100%":wide?800:520,maxHeight:full?"100%":"95vh",display:"flex",flexDirection:"column",boxShadow:"0 32px 80px rgba(0,0,0,.25)",overflow:"hidden",animation:"mIn .2s ease"}}>
      <div style={{padding:"16px 20px 14px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,background:C.bg}}>
        <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:17,fontWeight:800,color:C.ink}}>{title}</span>
        <button onClick={onClose} style={{background:C.line,border:"none",cursor:"pointer",padding:"6px",borderRadius:8,display:"flex"}}><Ic d={I.x} s={15} c={C.ink3}/></button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 20px 20px"}}>{children}</div>
    </div>
  </div>;
}

function Loading({text="กำลังโหลด..."}){return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"60px 0",gap:12}}><div style={{width:40,height:40,border:`4px solid ${C.brandLight}`,borderTop:`4px solid ${C.brand}`,borderRadius:"50%",animation:"spin .8s linear infinite"}}/><p style={{color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>{text}</p></div>;}

// ── Print Receipt (XPrinter compatible ESC/POS style) ──
function printReceipt(order, tableNum, branchName) {
  const w = window.open("","_blank","width=400,height=600");
  const items = order.items || [];
  const rows = items.map(i=>`
    <tr>
      <td style="padding:2px 4px;font-size:13px">${i.name}${i.note?`<br/><span style="font-size:11px;color:#666">*${i.note}</span>`:""}</td>
      <td style="padding:2px 4px;text-align:center;font-size:13px">${i.qty}</td>
      <td style="padding:2px 4px;text-align:right;font-size:13px">${(i.price*i.qty).toFixed(0)}</td>
    </tr>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700&display=swap');
    body{font-family:'Sarabun',sans-serif;width:72mm;margin:0 auto;padding:8px;font-size:13px}
    h2{text-align:center;font-size:16px;margin:4px 0}
    .center{text-align:center} .right{text-align:right}
    table{width:100%;border-collapse:collapse}
    .line{border-top:1px dashed #000;margin:6px 0}
    @media print{@page{margin:0;size:72mm auto}}
  </style></head><body>
  <h2>${branchName}</h2>
  <div class="center" style="font-size:12px">โต๊ะ ${tableNum} | ${new Date().toLocaleString("th-TH")}</div>
  <div class="line"></div>
  <table>
    <thead><tr><th style="text-align:left;font-size:12px">รายการ</th><th style="text-align:center;font-size:12px">จำนวน</th><th style="text-align:right;font-size:12px">ราคา</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="line"></div>
  <div style="display:flex;justify-content:space-between"><span>รวม</span><span>฿${order.subtotal?.toFixed(0)||0}</span></div>
  ${order.discount>0?`<div style="display:flex;justify-content:space-between"><span>ส่วนลด</span><span>-฿${order.discount?.toFixed(0)}</span></div>`:""}
  <div style="display:flex;justify-content:space-between;font-weight:700;font-size:16px;margin-top:4px"><span>รวมทั้งสิ้น</span><span>฿${order.total?.toFixed(0)||0}</span></div>
  <div class="line"></div>
  <div class="center" style="font-size:12px">ชำระโดย: ${order.payment_method==="cash"?"เงินสด":order.payment_method==="transfer"?"โอนเงิน":"บัตรเครดิต"}</div>
  <div class="center" style="font-size:11px;margin-top:8px">ขอบคุณที่ใช้บริการครับ</div>
  <br/><br/>
  <script>window.onload=()=>window.print();</script>
  </body></html>`);
  w.document.close();
}

function printKitchen(order, tableNum) {
  const w = window.open("","_blank","width=350,height=400");
  const rows = (order.items||[]).map(i=>`<div style="margin:4px 0;font-size:15px"><b>${i.qty}x ${i.name}</b>${i.note?`<div style="font-size:12px;padding-left:16px">★ ${i.note}</div>`:""}</div>`).join("");
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Kitchen</title><style>body{font-family:'Sarabun',sans-serif;width:72mm;margin:0 auto;padding:8px}@media print{@page{margin:0;size:72mm auto}}</style></head><body>
  <h2 style="text-align:center;font-size:18px;margin:4px 0">🍳 ใบสั่งครัว</h2>
  <div style="text-align:center;font-size:14px;font-weight:700">โต๊ะ ${tableNum}</div>
  <div style="text-align:center;font-size:12px">${new Date().toLocaleString("th-TH")}</div>
  <hr/>${rows}<hr/>
  <div style="text-align:center;font-size:12px">--- สิ้นสุดรายการ ---</div>
  <br/><script>window.onload=()=>window.print();</script></body></html>`);
  w.document.close();
}

// ══════════════════════════════════════════════════════
// ── LOGIN PAGE ────────────────────────────────────────
// ══════════════════════════════════════════════════════
function LoginPage({onLogin}){
  const[u,setU]=useState("");const[p,setP]=useState("");const[err,setErr]=useState("");const[loading,setLoading]=useState(false);const[show,setShow]=useState(false);
  async function login(){if(!u||!p)return;setLoading(true);setErr("");try{const r=await db.loginUser(u,p);if(r&&r.length>0)onLogin(r[0]);else setErr("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");}catch(e){setErr("เชื่อมต่อ Server ไม่ได้ กรุณาลองใหม่");}setLoading(false);}
  return <div style={{minHeight:"100vh",background:`linear-gradient(135deg,#1e3a5f,#0f172a)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{background:C.white,borderRadius:24,padding:"40px 36px",width:"100%",maxWidth:400,boxShadow:"0 40px 100px rgba(0,0,0,.3)",animation:"mIn .4s ease"}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:64,height:64,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",boxShadow:`0 8px 24px ${C.brand}55`}}><Ic d={I.fire} s={30} c={C.white} sw={2}/></div>
        <div style={{fontWeight:900,fontSize:20,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>NAIWANSOOK FOODCOST</div>
        <div style={{fontSize:11,color:C.ink4,letterSpacing:2,fontFamily:"'Sarabun',sans-serif"}}>BY BOSSMAX</div>
      </div>
      <div style={{marginBottom:14}}>
        <label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>ชื่อผู้ใช้</label>
        <div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.user} s={16} c={C.ink4}/></span><input value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="username" style={{...iS,paddingLeft:40}} autoFocus/></div>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>รหัสผ่าน</label>
        <div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.lock} s={16} c={C.ink4}/></span><input value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} type={show?"text":"password"} placeholder="password" style={{...iS,paddingLeft:40,paddingRight:44}}/><button onClick={()=>setShow(!show)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer"}}><Ic d={I.eye} s={16} c={C.ink4}/></button></div>
      </div>
      {err&&<div style={{background:C.redLight,color:C.red,borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:600,marginBottom:14,display:"flex",gap:8,alignItems:"center"}}><Ic d={I.warning} s={14} c={C.red}/>{err}</div>}
      <Btn onClick={login} full loading={loading}>เข้าสู่ระบบ</Btn>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── BRANCH SELECTOR ───────────────────────────────────
// ══════════════════════════════════════════════════════
function BranchSelect({user,onSelect}){
  const[branches,setBranches]=useState([]);const[loading,setLoading]=useState(true);
  useEffect(()=>{db.getBranches().then(setBranches).finally(()=>setLoading(false));},[]);
  if(loading)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg}}><Loading/></div>;
  return <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.brandLight},${C.blueLight})`,display:"flex",alignItems:"center",justifyContent:"center",padding:24}}>
    <div style={{width:"100%",maxWidth:600}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:56,height:56,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><Ic d={I.fire} s={26} c={C.white} sw={2}/></div>
        <h2 style={{fontSize:22,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>เลือกสาขา</h2>
        <p style={{fontSize:14,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>สวัสดีครับ <b>{user.name||user.username}</b></p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:14}}>
        {branches.map(b=><div key={b.id} onClick={()=>onSelect(b)} style={{background:C.white,borderRadius:16,padding:"20px",cursor:"pointer",border:`2px solid ${b.type==="central"?C.teal:C.line}`,boxShadow:"0 2px 12px rgba(0,0,0,.06)",transition:"all .2s",display:"flex",alignItems:"center",gap:14}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 12px 32px ${C.brand}22`;}} onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="0 2px 12px rgba(0,0,0,.06)";}}>
          <div style={{width:48,height:48,borderRadius:14,background:b.type==="central"?`linear-gradient(135deg,${C.teal},#0F766E)`:`linear-gradient(135deg,${C.brand},${C.brandDark})`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={b.type==="central"?I.shop:I.branch} s={22} c={C.white} sw={2}/></div>
          <div><div style={{fontWeight:800,fontSize:16,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>{b.name}</div><Chip color={b.type==="central"?"teal":"orange"}>{b.type==="central"?"ครัวกลาง":"สาขา"}</Chip></div>
        </div>)}
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── TABLE MAP ─────────────────────────────────────────
// ══════════════════════════════════════════════════════
function TableMap({tables,orders,onSelectTable,onEditLayout}){
  const [editMode,setEditMode]=useState(false);
  const [dragging,setDragging]=useState(null);
  const [tables2,setTables2]=useState(tables);
  const [saving,setSaving]=useState(false);
  const canvasRef=useRef();

  useEffect(()=>setTables2(tables),[tables]);

  // Get active order for table
  function getTableOrder(tableId){
    return orders.find(o=>o.table_id===tableId&&["pending","confirmed","ready"].includes(o.status));
  }

  function getTableStatus(t){
    const o=getTableOrder(t.id);
    if(!o)return "available";
    if(o.status==="pending")return "ordering";
    if(o.status==="bill_requested")return "bill";
    return "occupied";
  }

  function handleMouseDown(e,t){
    if(!editMode)return;
    const rect=canvasRef.current.getBoundingClientRect();
    setDragging({id:t.id,startX:e.clientX-rect.left-t.x,startY:e.clientY-rect.top-t.y});
  }

  function handleMouseMove(e){
    if(!dragging)return;
    const rect=canvasRef.current.getBoundingClientRect();
    const nx=Math.max(0,Math.round((e.clientX-rect.left-dragging.startX)/10)*10);
    const ny=Math.max(0,Math.round((e.clientY-rect.top-dragging.startY)/10)*10);
    setTables2(ts=>ts.map(t=>t.id===dragging.id?{...t,x:nx,y:ny}:t));
  }

  async function saveLayout(){
    setSaving(true);
    try{for(const t of tables2)await db.updateTable(t.id,{x:t.x,y:t.y});}catch(e){alert("บันทึกไม่สำเร็จ");}
    setSaving(false);setEditMode(false);onEditLayout();
  }

  const statusSummary=useMemo(()=>({
    available:tables.filter(t=>getTableStatus(t)==="available").length,
    occupied:tables.filter(t=>["occupied","ordering","bill"].includes(getTableStatus(t))).length,
  }),[tables,orders]);

  return <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {/* Header bar */}
    <div style={{padding:"12px 20px",background:C.white,borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
      <div style={{flex:1,display:"flex",gap:10,flexWrap:"wrap"}}>
        {Object.entries(TS).map(([k,v])=>{const count=tables.filter(t=>getTableStatus(t)===k).length;return count>0?<div key={k} style={{display:"flex",alignItems:"center",gap:6,background:v.bg,border:`1px solid ${v.border}`,borderRadius:8,padding:"4px 12px"}}>
          <div style={{width:10,height:10,borderRadius:"50%",background:v.border}}/>
          <span style={{fontSize:12,fontWeight:700,color:v.text,fontFamily:"'Sarabun',sans-serif"}}>{v.label} ({count})</span>
        </div>:null;})}
      </div>
      <div style={{display:"flex",gap:8}}>
        {editMode?<>
          <Btn v="ghost" onClick={()=>{setTables2(tables);setEditMode(false);}} small>ยกเลิก</Btn>
          <Btn v="success" onClick={saveLayout} loading={saving} small>💾 บันทึก Layout</Btn>
        </>:<Btn v="ghost" onClick={()=>setEditMode(true)} icon={I.drag} small>จัด Layout</Btn>}
      </div>
    </div>

    {/* Canvas */}
    <div ref={canvasRef} onMouseMove={handleMouseMove} onMouseUp={()=>setDragging(null)} style={{flex:1,position:"relative",overflow:"auto",background:"#f0f4f8",backgroundImage:"radial-gradient(circle,#c8d0da 1px,transparent 1px)",backgroundSize:"20px 20px",minHeight:500,cursor:editMode?"move":"default"}}>
      {tables2.map(t=>{
        const st=getTableStatus(t);const sv=TS[st]||TS.available;
        const order=getTableOrder(t.id);
        const total=order?.total||0;
        const itemCount=(order?.items||[]).reduce((s,i)=>s+i.qty,0);
        return <div key={t.id} onMouseDown={e=>handleMouseDown(e,t)} onClick={()=>!editMode&&onSelectTable(t,order)}
          style={{position:"absolute",left:t.x,top:t.y,width:t.w||90,height:t.h||80,background:sv.bg,border:`2px solid ${sv.border}`,borderRadius:t.shape==="round"?"50%":12,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:editMode?"grab":"pointer",userSelect:"none",boxShadow:st!=="available"?`0 4px 16px ${sv.border}44`:"0 2px 8px rgba(0,0,0,.08)",transition:"box-shadow .2s",zIndex:dragging?.id===t.id?10:1}}>
          <div style={{fontWeight:900,fontSize:16,color:sv.text,fontFamily:"'Sarabun',sans-serif"}}>T{t.table_number}</div>
          {t.label&&<div style={{fontSize:10,color:sv.text,fontFamily:"'Sarabun',sans-serif",opacity:.8}}>{t.label}</div>}
          {st==="available"?<div style={{fontSize:10,color:C.green,fontFamily:"'Sarabun',sans-serif"}}>{t.seats||4} ที่นั่ง</div>
          :<><div style={{fontSize:11,fontWeight:700,color:sv.text,fontFamily:"'Sarabun',sans-serif"}}>{itemCount} รายการ</div>
          <div style={{fontSize:11,color:sv.text,fontFamily:"'Sarabun',sans-serif"}}>฿{total.toFixed(0)}</div></>}
          {st==="bill"&&<div style={{fontSize:10,background:C.red,color:C.white,borderRadius:4,padding:"1px 6px",fontFamily:"'Sarabun',sans-serif"}}>เรียกบิล</div>}
        </div>;
      })}
      {tables2.length===0&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
        <Ic d={I.table} s={60} c={C.line}/>
        <p style={{color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontSize:16}}>ยังไม่มีโต๊ะ กดปุ่ม "จัดการโต๊ะ" เพื่อเพิ่มครับ</p>
      </div>}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── TABLE MANAGEMENT ──────────────────────────────────
// ══════════════════════════════════════════════════════
function TableManage({tables,branch,onDone}){
  const[form,setForm]=useState({table_number:"",label:"",seats:4,shape:"square",w:90,h:80});
  const[saving,setSaving]=useState(false);
  const[bulk,setBulk]=useState({from:1,to:10,prefix:"",seats:4});
  const[tab,setTab]=useState("single");

  async function addSingle(){
    if(!form.table_number)return;
    setSaving(true);
    try{
      const maxX=tables.reduce((m,t)=>Math.max(m,t.x),0);
      await db.addTable({...form,branch_id:branch.id,status:"available",active:true,x:maxX+100,y:50});
      setForm({table_number:"",label:"",seats:4,shape:"square",w:90,h:80});
      onDone();
    }catch(e){alert("เพิ่มไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }

  async function addBulk(){
    setSaving(true);
    try{
      let col=0,row=0;
      for(let i=bulk.from;i<=bulk.to;i++){
        const num=bulk.prefix?`${bulk.prefix}${i}`:String(i);
        if(!tables.find(t=>t.table_number===num)){
          await db.addTable({table_number:num,label:"",seats:+bulk.seats,shape:"square",w:90,h:80,branch_id:branch.id,status:"available",active:true,x:col*110+20,y:row*100+20});
          col++;if(col>9){col=0;row++;}
        }
      }
      onDone();alert(`✅ เพิ่มโต๊ะ ${bulk.from}-${bulk.to} สำเร็จ!`);
    }catch(e){alert("เพิ่มไม่สำเร็จ");}
    setSaving(false);
  }

  async function delTable(id,num){
    if(!confirm(`ลบโต๊ะ ${num}?`))return;
    try{await db.deleteTable(id);onDone();}catch(e){alert("ลบไม่สำเร็จ");}
  }

  return <div>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      {[{id:"single",l:"เพิ่มโต๊ะเดี่ยว"},{id:"bulk",l:"เพิ่มหลายโต๊ะ"},{id:"list",l:`โต๊ะทั้งหมด (${tables.length})`}].map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"7px 16px",borderRadius:9,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13,background:tab===t.id?C.brand:"transparent",color:tab===t.id?C.white:C.ink3}}>{t.l}</button>)}
    </div>

    {tab==="single"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>หมายเลขโต๊ะ *</label><input value={form.table_number} onChange={e=>setForm(f=>({...f,table_number:e.target.value}))} placeholder="เช่น 1, A1, VIP1" style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>ชื่อ/Label</label><input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="เช่น ริมหน้าต่าง" style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>จำนวนที่นั่ง</label><input type="number" value={form.seats} onChange={e=>setForm(f=>({...f,seats:+e.target.value}))} style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>รูปทรง</label><select value={form.shape} onChange={e=>setForm(f=>({...f,shape:e.target.value}))} style={{...iS,appearance:"none"}}><option value="square">สี่เหลี่ยม</option><option value="round">กลม</option></select></div>
      </div>
      <Btn onClick={addSingle} icon={I.plus} disabled={!form.table_number} loading={saving}>เพิ่มโต๊ะ</Btn>
    </div>}

    {tab==="bulk"&&<div>
      <div style={{background:C.blueLight,borderRadius:10,padding:"12px 14px",marginBottom:14,fontSize:13,color:C.blue,fontFamily:"'Sarabun',sans-serif"}}>
        เพิ่มโต๊ะหลายตัวพร้อมกัน ระบบจะสร้างโต๊ะตั้งแต่หมายเลขเริ่มต้นถึงสิ้นสุดครับ
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12,marginBottom:14}}>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>Prefix</label><input value={bulk.prefix} onChange={e=>setBulk(f=>({...f,prefix:e.target.value}))} placeholder="เช่น A (ไม่บังคับ)" style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>เริ่มที่</label><input type="number" value={bulk.from} onChange={e=>setBulk(f=>({...f,from:+e.target.value}))} style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>ถึง</label><input type="number" value={bulk.to} onChange={e=>setBulk(f=>({...f,to:+e.target.value}))} style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>ที่นั่ง/โต๊ะ</label><input type="number" value={bulk.seats} onChange={e=>setBulk(f=>({...f,seats:+e.target.value}))} style={iS}/></div>
      </div>
      <div style={{marginBottom:14,fontSize:14,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>จะสร้าง <b>{Math.max(0,bulk.to-bulk.from+1)}</b> โต๊ะ ({bulk.prefix}{bulk.from} ถึง {bulk.prefix}{bulk.to})</div>
      <Btn onClick={addBulk} loading={saving} icon={I.plus}>สร้างโต๊ะทั้งหมด</Btn>
    </div>}

    {tab==="list"&&<div style={{maxHeight:400,overflowY:"auto"}}>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:10}}>
        {tables.sort((a,b)=>a.table_number.localeCompare(b.table_number,undefined,{numeric:true})).map(t=><div key={t.id} style={{background:C.bg,border:`1px solid ${C.line}`,borderRadius:10,padding:"10px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <div><div style={{fontWeight:700,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {t.table_number}</div>{t.label&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{t.label}</div>}<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{t.seats} ที่นั่ง</div></div>
          <button onClick={()=>delTable(t.id,t.table_number)} style={{background:C.redLight,border:"none",borderRadius:7,padding:5,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>
        </div>)}
      </div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── ORDER PANEL ───────────────────────────────────────
// ══════════════════════════════════════════════════════
function OrderPanel({table,order,menus,categories,branch,currentUser,onClose,onDone}){
  const[items,setItems]=useState(order?.items||[]);
  const[selCat,setSelCat]=useState("ทั้งหมด");
  const[search,setSearch]=useState("");
  const[note,setNote]=useState("");
  const[noteItem,setNoteItem]=useState(null);
  const[saving,setSaving]=useState(false);
  const[showBill,setShowBill]=useState(false);
  const[discount,setDiscount]=useState(0);
  const[payMethod,setPayMethod]=useState("cash");

  const filteredMenus=useMemo(()=>menus.filter(m=>(selCat==="ทั้งหมด"||m.category===selCat)&&m.name.toLowerCase().includes(search.toLowerCase())),[menus,selCat,search]);

  const subtotal=useMemo(()=>items.reduce((s,i)=>s+i.price*i.qty,0),[items]);
  const total=Math.max(0,subtotal-discount);

  function addItem(menu){
    setItems(prev=>{const ex=prev.find(i=>i.menu_id===menu.id&&!i.note);if(ex)return prev.map(i=>i.menu_id===menu.id&&!i.note?{...i,qty:i.qty+1}:i);return[...prev,{menu_id:menu.id,name:menu.name,price:menu.price,qty:1,note:""}];});
  }
  function removeItem(idx){setItems(p=>p.filter((_,i)=>i!==idx));}
  function changeQty(idx,delta){setItems(p=>p.map((i,j)=>j===idx?{...i,qty:Math.max(0,i.qty+delta)}:i).filter(i=>i.qty>0));}
  function addNote(idx){setNoteItem(idx);}

  async function saveOrder(){
    setSaving(true);
    try{
      const data={branch_id:branch.id,table_id:table.id,table_number:table.table_number,items,subtotal,discount:0,total:subtotal,status:"pending",ordered_by:currentUser.username,updated_at:new Date().toISOString()};
      if(order?.id)await db.updateOrder(order.id,data);
      else await db.createOrder(data);
      // print to kitchen
      printKitchen({items},table.table_number);
      onDone();onClose();
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }

  async function checkOut(){
    setSaving(true);
    try{
      await db.updateOrder(order.id,{status:"paid",subtotal,discount:+discount,total,payment_method:payMethod,updated_at:new Date().toISOString()});
      await db.updateTable(table.id,{status:"available"});
      printReceipt({...order,items,subtotal,discount:+discount,total,payment_method:payMethod},table.table_number,branch.name);
      onDone();onClose();
    }catch(e){alert("ชำระเงินไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }

  return <div style={{display:"flex",height:"100%",minHeight:"80vh"}}>
    {/* Left - Menu */}
    <div style={{flex:1,display:"flex",flexDirection:"column",borderRight:`1px solid ${C.line}`}}>
      {/* Category tabs */}
      <div style={{padding:"10px 14px",borderBottom:`1px solid ${C.line}`,display:"flex",gap:6,overflowX:"auto",flexShrink:0}}>
        {["ทั้งหมด",...new Set(menus.map(m=>m.category))].map(cat=><button key={cat} onClick={()=>setSelCat(cat)} style={{padding:"5px 14px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12,background:selCat===cat?C.brand:"transparent",color:selCat===cat?C.white:C.ink3,whiteSpace:"nowrap"}}>{cat}</button>)}
      </div>
      {/* Search */}
      <div style={{padding:"8px 14px",borderBottom:`1px solid ${C.line}`,flexShrink:0}}>
        <div style={{position:"relative"}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.scan} s={14} c={C.ink4}/></span><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาเมนู..." style={{...iS,paddingLeft:32,padding:"7px 12px 7px 32px",fontSize:13}}/></div>
      </div>
      {/* Menu grid */}
      <div style={{flex:1,overflowY:"auto",padding:10,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(120px,1fr))",gap:8,alignContent:"start"}}>
        {filteredMenus.map(menu=><div key={menu.id} onClick={()=>addItem(menu)} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:12,padding:"10px 8px",cursor:"pointer",textAlign:"center",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.background=C.brandLight;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.background=C.white;}}>
          {menu.image&&<img src={menu.image} alt={menu.name} style={{width:"100%",height:60,objectFit:"cover",borderRadius:8,marginBottom:6}}/>}
          {!menu.image&&<div style={{height:44,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.food} s={28} c={C.brand}/></div>}
          <div style={{fontSize:12,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif",lineHeight:1.3,marginBottom:4}}>{menu.name}</div>
          <div style={{fontSize:13,fontWeight:900,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{menu.price}</div>
        </div>)}
      </div>
    </div>

    {/* Right - Order */}
    <div style={{width:280,display:"flex",flexDirection:"column",background:C.bg}}>
      <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.line}`,background:C.white,flexShrink:0}}>
        <div style={{fontWeight:800,fontSize:16,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {table.table_number}</div>
        {table.label&&<div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{table.label} · {table.seats} ที่นั่ง</div>}
      </div>

      {/* Items */}
      <div style={{flex:1,overflowY:"auto",padding:10}}>
        {items.length===0?<div style={{textAlign:"center",padding:"40px 0",color:C.ink4}}><Ic d={I.food} s={40} c={C.line}/><p style={{marginTop:10,fontFamily:"'Sarabun',sans-serif",fontSize:14}}>ยังไม่มีรายการ<br/>กดเมนูทางซ้าย</p></div>
        :items.map((item,idx)=><div key={idx} style={{background:C.white,borderRadius:10,padding:"9px 10px",marginBottom:6,border:`1px solid ${C.line}`}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
            <div style={{flex:1}}>
              <div style={{fontSize:13,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{item.name}</div>
              {item.note&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>★ {item.note}</div>}
            </div>
            <button onClick={()=>removeItem(idx)} style={{background:"none",border:"none",cursor:"pointer",padding:2}}><Ic d={I.x} s={13} c={C.red}/></button>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={()=>changeQty(idx,-1)} style={{width:24,height:24,borderRadius:6,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.minus} s={12} c={C.ink}/></button>
              <span style={{fontSize:14,fontWeight:700,minWidth:20,textAlign:"center",fontFamily:"'Sarabun',sans-serif"}}>{item.qty}</span>
              <button onClick={()=>changeQty(idx,1)} style={{width:24,height:24,borderRadius:6,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={12} c={C.ink}/></button>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <button onClick={()=>addNote(idx)} style={{background:C.lineLight,border:"none",borderRadius:6,padding:"3px 7px",cursor:"pointer",fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>หมายเหตุ</button>
              <span style={{fontSize:13,fontWeight:700,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{(item.price*item.qty).toFixed(0)}</span>
            </div>
          </div>
        </div>)}
      </div>

      {/* Bill area */}
      {!showBill?<div style={{padding:12,borderTop:`1px solid ${C.line}`,background:C.white,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10}}>
          <span style={{fontSize:15,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>รวม</span>
          <span style={{fontSize:18,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>฿{subtotal.toFixed(0)}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          {order?.id&&<Btn v="yellow" onClick={()=>setShowBill(true)} icon={I.bill} full small>เช็คบิล</Btn>}
          <Btn onClick={saveOrder} icon={I.check} loading={saving} full small>{order?.id?"อัปเดตออเดอร์":"สั่งอาหาร"}</Btn>
        </div>
      </div>
      :<div style={{padding:12,borderTop:`1px solid ${C.line}`,background:C.white,flexShrink:0}}>
        <div style={{fontSize:14,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>💳 ชำระเงิน</div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}><span style={{fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>ยอดรวม</span><span style={{fontSize:14,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>฿{subtotal.toFixed(0)}</span></div>
        <div style={{marginBottom:8}}>
          <label style={{display:"block",fontSize:12,color:C.ink3,marginBottom:3,fontFamily:"'Sarabun',sans-serif"}}>ส่วนลด (฿)</label>
          <input type="number" value={discount} onChange={e=>setDiscount(+e.target.value)} style={{...iS,padding:"6px 10px",fontSize:13}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:10,padding:"8px",background:C.greenLight,borderRadius:8}}>
          <span style={{fontSize:15,fontWeight:700,color:C.green,fontFamily:"'Sarabun',sans-serif"}}>สุทธิ</span>
          <span style={{fontSize:18,fontWeight:900,color:C.green,fontFamily:"'Sarabun',sans-serif"}}>฿{total.toFixed(0)}</span>
        </div>
        <div style={{display:"flex",gap:6,marginBottom:8}}>
          {[{v:"cash",l:"💵 เงินสด"},{v:"transfer",l:"📱 โอน"},{v:"credit",l:"💳 บัตร"}].map(m=><button key={m.v} onClick={()=>setPayMethod(m.v)} style={{flex:1,padding:"6px",borderRadius:8,border:`2px solid ${payMethod===m.v?C.green:C.line}`,background:payMethod===m.v?C.greenLight:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:11,color:payMethod===m.v?C.green:C.ink3}}>{m.l}</button>)}
        </div>
        <div style={{display:"flex",gap:6}}>
          <Btn v="ghost" onClick={()=>setShowBill(false)} small>← กลับ</Btn>
          <Btn v="success" onClick={checkOut} loading={saving} full small icon={I.check}>ชำระเงิน & พิมพ์</Btn>
        </div>
      </div>}
    </div>

    {/* Note modal */}
    {noteItem!==null&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000}}>
      <div style={{background:C.white,borderRadius:16,padding:24,width:"100%",maxWidth:340}}>
        <div style={{fontWeight:700,fontSize:16,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:12}}>หมายเหตุ: {items[noteItem]?.name}</div>
        <textarea value={note} onChange={e=>setNote(e.target.value)} placeholder="เช่น ไม่เผ็ด, ไม่ใส่ผัก..." style={{...iS,height:80,resize:"none"}}/>
        <div style={{display:"flex",gap:8,marginTop:12}}>
          <Btn v="ghost" onClick={()=>{setNoteItem(null);setNote("");}} full small>ยกเลิก</Btn>
          <Btn onClick={()=>{setItems(p=>p.map((i,j)=>j===noteItem?{...i,note}:i));setNoteItem(null);setNote("");}} full small>บันทึก</Btn>
        </div>
      </div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── ORDER LIST VIEW ───────────────────────────────────
// ══════════════════════════════════════════════════════
function OrderListView({orders,tables,onRefresh}){
  const active=orders.filter(o=>!["paid","cancelled"].includes(o.status));
  const today=orders.filter(o=>o.status==="paid"&&new Date(o.created_at).toDateString()===new Date().toDateString());
  const todayRevenue=today.reduce((s,o)=>s+o.total,0);
  const[view,setView]=useState("active");
  return <div style={{padding:"16px 20px"}}>
    <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap",alignItems:"center"}}>
      <div style={{display:"flex",gap:6}}>
        {[{id:"active",l:`ออเดอร์ปัจจุบัน (${active.length})`},{id:"paid",l:`ชำระแล้ววันนี้ (${today.length})`}].map(t=><button key={t.id} onClick={()=>setView(t.id)} style={{padding:"7px 16px",borderRadius:9,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13,background:view===t.id?C.brand:"transparent",color:view===t.id?C.white:C.ink3}}>{t.l}</button>)}
      </div>
      <div style={{marginLeft:"auto",display:"flex",gap:8,alignItems:"center"}}>
        {view==="paid"&&<div style={{background:C.greenLight,borderRadius:8,padding:"6px 14px",fontFamily:"'Sarabun',sans-serif",fontWeight:700,color:C.green}}>รายรับวันนี้ ฿{todayRevenue.toFixed(0)}</div>}
        <Btn v="ghost" onClick={onRefresh} icon={I.refresh} small>รีเฟรช</Btn>
      </div>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12}}>
      {(view==="active"?active:today).map(o=>{
        const t=tables.find(tb=>tb.id===o.table_id);
        const stColor={pending:C.yellow,confirmed:C.green,ready:C.blue,bill_requested:C.red,paid:C.green,cancelled:C.ink4};
        const stLabel={pending:"รอยืนยัน",confirmed:"กำลังทำ",ready:"พร้อมเสิร์ฟ",bill_requested:"เรียกบิล",paid:"ชำระแล้ว",cancelled:"ยกเลิก"};
        return <div key={o.id} style={{background:C.white,borderRadius:14,border:`1px solid ${C.line}`,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,.06)"}}>
          <div style={{padding:"10px 14px",background:C.bg,borderBottom:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div><span style={{fontWeight:800,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {o.table_number}</span>{t?.label&&<span style={{fontSize:12,color:C.ink4,marginLeft:6,fontFamily:"'Sarabun',sans-serif"}}>{t.label}</span>}</div>
            <span style={{fontSize:11,fontWeight:700,color:stColor[o.status]||C.ink3,background:`${stColor[o.status]}22`,padding:"2px 8px",borderRadius:20,fontFamily:"'Sarabun',sans-serif"}}>{stLabel[o.status]||o.status}</span>
          </div>
          <div style={{padding:"10px 14px"}}>
            {(o.items||[]).slice(0,4).map((i,idx)=><div key={idx} style={{display:"flex",justifyContent:"space-between",fontSize:13,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}><span>{i.qty}x {i.name}</span><span style={{color:C.brand,fontWeight:700}}>฿{(i.price*i.qty).toFixed(0)}</span></div>)}
            {(o.items||[]).length>4&&<div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>+อีก {o.items.length-4} รายการ</div>}
            <div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:`1px solid ${C.lineLight}`}}>
              <span style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{new Date(o.created_at).toLocaleTimeString("th-TH")}</span>
              <span style={{fontSize:15,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>฿{o.total?.toFixed(0)||0}</span>
            </div>
          </div>
        </div>;
      })}
      {(view==="active"?active:today).length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.order} s={48} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>{view==="active"?"ไม่มีออเดอร์ที่รอดำเนินการ":"ยังไม่มียอดขายวันนี้"}</p></div>}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── QR CODE PAGE (ลูกค้าสแกน) ─────────────────────────
// ══════════════════════════════════════════════════════
function QRPage({branch,tables}){
  const[sel,setSel]=useState(null);
  const baseUrl=window.location.origin+window.location.pathname;
  return <div style={{padding:20}}>
    <h2 style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:800,color:C.ink,marginBottom:4}}>QR Code สั่งอาหาร</h2>
    <p style={{fontSize:13,color:C.ink3,marginBottom:16,fontFamily:"'Sarabun',sans-serif"}}>พิมพ์ QR Code ไว้ที่โต๊ะ ลูกค้าสแกนแล้วสั่งอาหารได้เลยครับ</p>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(140px,1fr))",gap:10}}>
      {tables.map(t=>{
        const url=`${baseUrl}?scan=1&branch=${branch.id}&table=${t.id}`;
        return <div key={t.id} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:12,padding:"12px",textAlign:"center"}}>
          <div style={{fontWeight:800,fontSize:16,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>โต๊ะ {t.table_number}</div>
          {/* Simple QR placeholder - in production use a QR library */}
          <div style={{width:80,height:80,background:C.bg,border:`2px solid ${C.line}`,borderRadius:8,margin:"0 auto 8px",display:"flex",alignItems:"center",justifyContent:"center",fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>QR Code<br/>T{t.table_number}</div>
          <Btn v="ghost" small onClick={()=>{window.open(url,"_blank");}} icon={I.eye}>ดูหน้าสั่ง</Btn>
        </div>;
      })}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── CUSTOMER ORDER PAGE (ลูกค้าสั่งจากมือถือ) ──────────
// ══════════════════════════════════════════════════════
function CustomerOrderPage({branchId,tableId}){
  const[branch,setBranch]=useState(null);const[table,setTable]=useState(null);const[menus,setMenus]=useState([]);
  const[cart,setCart]=useState([]);const[selCat,setSelCat]=useState("ทั้งหมด");const[search,setSearch]=useState("");
  const[step,setStep]=useState("menu");const[sending,setSending]=useState(false);const[done,setDone]=useState(false);
  const[note,setNote]=useState("");const[noteItem,setNoteItem]=useState(null);

  useEffect(()=>{
    Promise.all([db.getBranches(),db.getTables(branchId),db.getMenus(branchId)]).then(([bs,ts,ms])=>{
      setBranch(bs.find(b=>b.id===+branchId)||bs[0]);
      setTable(ts.find(t=>t.id===+tableId));
      setMenus(ms.filter(m=>m.price>0));
    });
  },[branchId,tableId]);

  const cats=useMemo(()=>["ทั้งหมด",...new Set(menus.map(m=>m.category))],[menus]);
  const filtered=useMemo(()=>menus.filter(m=>(selCat==="ทั้งหมด"||m.category===selCat)&&m.name.toLowerCase().includes(search.toLowerCase())),[menus,selCat,search]);
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const itemCount=cart.reduce((s,i)=>s+i.qty,0);

  function addToCart(menu){setCart(p=>{const ex=p.find(i=>i.menu_id===menu.id&&!i.note);if(ex)return p.map(i=>i.menu_id===menu.id&&!i.note?{...i,qty:i.qty+1}:i);return[...p,{menu_id:menu.id,name:menu.name,price:menu.price,qty:1,note:""}];});}
  function removeFromCart(idx){setCart(p=>p.filter((_,i)=>i!==idx));}
  function changeQty(idx,d){setCart(p=>p.map((i,j)=>j===idx?{...i,qty:Math.max(0,i.qty+d)}:i).filter(i=>i.qty>0));}

  async function placeOrder(){
    setSending(true);
    try{
      const existing=await db.getOrderByTable(+tableId);
      const data={branch_id:+branchId,table_id:+tableId,table_number:table?.table_number,items:cart,subtotal:total,discount:0,total,status:"pending",ordered_by:"customer",updated_at:new Date().toISOString()};
      if(existing&&existing.length>0){
        const merged=[...existing[0].items,...cart];
        await db.updateOrder(existing[0].id,{...data,items:merged,subtotal:merged.reduce((s,i)=>s+i.price*i.qty,0),total:merged.reduce((s,i)=>s+i.price*i.qty,0)});
      }else await db.createOrder(data);
      setDone(true);
    }catch(e){alert("สั่งไม่สำเร็จ กรุณาลองใหม่ครับ");}
    setSending(false);
  }

  if(!table||!branch)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><Loading text="กำลังโหลดเมนู..."/></div>;

  if(done)return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,${C.greenLight},${C.white})`,padding:24,textAlign:"center"}}>
    <div style={{fontSize:72,marginBottom:16}}>✅</div>
    <h2 style={{fontSize:24,fontWeight:900,color:C.green,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>สั่งอาหารสำเร็จ!</h2>
    <p style={{fontSize:16,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>โต๊ะ {table.table_number} — {branch.name}</p>
    <p style={{fontSize:14,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:24}}>รอสักครู่นะครับ อาหารกำลังเตรียม 🍳</p>
    <Btn onClick={()=>{setDone(false);setCart([]);setStep("menu");}}>สั่งเพิ่ม</Btn>
  </div>;

  return <div style={{minHeight:"100vh",background:C.bg,maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column"}}>
    {/* Header */}
    <div style={{background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,padding:"16px 16px 12px",flexShrink:0}}>
      <div style={{fontWeight:900,fontSize:18,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>{branch.name}</div>
      <div style={{fontSize:13,color:"rgba(255,255,255,.8)",fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {table.table_number}{table.label?` — ${table.label}`:""} · {table.seats} ที่นั่ง</div>
    </div>

    {step==="menu"&&<>
      {/* Category */}
      <div style={{padding:"10px 12px",background:C.white,borderBottom:`1px solid ${C.line}`,display:"flex",gap:6,overflowX:"auto"}}>
        {cats.map(c=><button key={c} onClick={()=>setSelCat(c)} style={{padding:"6px 14px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12,background:selCat===c?C.brand:"transparent",color:selCat===c?C.white:C.ink3,whiteSpace:"nowrap"}}>{c}</button>)}
      </div>
      {/* Search */}
      <div style={{padding:"8px 12px",background:C.white,borderBottom:`1px solid ${C.line}`}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาเมนู..." style={{...iS,padding:"9px 14px",fontSize:14}}/>
      </div>
      {/* Menu list */}
      <div style={{flex:1,overflowY:"auto",padding:12,display:"flex",flexDirection:"column",gap:10}}>
        {filtered.map(menu=>{
          const inCart=cart.find(i=>i.menu_id===menu.id);
          return <div key={menu.id} style={{background:C.white,borderRadius:14,overflow:"hidden",border:`1px solid ${inCart?C.brand:C.line}`,display:"flex",alignItems:"stretch",transition:"all .15s"}}>
            {menu.image?<img src={menu.image} alt={menu.name} style={{width:90,objectFit:"cover",flexShrink:0}}/>
            :<div style={{width:90,background:`linear-gradient(135deg,${C.brandLight},#FEF9C3)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={I.food} s={32} c={C.brand}/></div>}
            <div style={{flex:1,padding:"12px 12px 10px"}}>
              <div style={{fontWeight:700,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}>{menu.name}</div>
              {menu.description&&<div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:6,lineHeight:1.4}}>{menu.description}</div>}
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span style={{fontSize:17,fontWeight:900,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{menu.price}</span>
                {inCart?<div style={{display:"flex",alignItems:"center",gap:8}}>
                  <button onClick={()=>changeQty(cart.indexOf(inCart),-1)} style={{width:28,height:28,borderRadius:8,border:`1.5px solid ${C.brand}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.minus} s={14} c={C.brand}/></button>
                  <span style={{fontWeight:900,fontSize:16,minWidth:20,textAlign:"center",color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>{inCart.qty}</span>
                  <button onClick={()=>addToCart(menu)} style={{width:28,height:28,borderRadius:8,background:C.brand,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={14} c={C.white}/></button>
                </div>
                :<button onClick={()=>addToCart(menu)} style={{width:36,height:36,borderRadius:10,background:C.brand,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 4px 12px ${C.brand}44`}}><Ic d={I.plus} s={18} c={C.white}/></button>}
              </div>
            </div>
          </div>;
        })}
      </div>
      {/* Cart button */}
      {cart.length>0&&<div style={{padding:"12px 16px",background:C.white,borderTop:`1px solid ${C.line}`,flexShrink:0}}>
        <button onClick={()=>setStep("cart")} style={{width:"100%",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,border:"none",borderRadius:14,padding:"14px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center",boxShadow:`0 6px 20px ${C.brand}44`}}>
          <span style={{background:"rgba(255,255,255,.25)",borderRadius:20,padding:"2px 10px",fontSize:13,fontWeight:700,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>{itemCount} รายการ</span>
          <span style={{fontSize:16,fontWeight:900,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>ดูตะกร้า →</span>
          <span style={{fontSize:16,fontWeight:900,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>฿{total.toFixed(0)}</span>
        </button>
      </div>}
    </>}

    {step==="cart"&&<>
      <div style={{flex:1,overflowY:"auto",padding:12}}>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:16,fontWeight:800,color:C.ink,marginBottom:12}}>รายการที่สั่ง</h3>
        {cart.map((item,idx)=><div key={idx} style={{background:C.white,borderRadius:12,padding:"12px",marginBottom:8,border:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:10}}>
          <div style={{flex:1}}>
            <div style={{fontWeight:700,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{item.name}</div>
            {item.note&&<div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>★ {item.note}</div>}
            <div style={{fontSize:13,color:C.brand,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>฿{item.price} × {item.qty} = ฿{(item.price*item.qty).toFixed(0)}</div>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <button onClick={()=>changeQty(idx,-1)} style={{width:28,height:28,borderRadius:8,border:`1.5px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.minus} s={13} c={C.ink}/></button>
            <span style={{fontWeight:900,fontSize:15,minWidth:22,textAlign:"center",fontFamily:"'Sarabun',sans-serif"}}>{item.qty}</span>
            <button onClick={()=>changeQty(idx,1)} style={{width:28,height:28,borderRadius:8,border:`1.5px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={13} c={C.ink}/></button>
          </div>
          <button onClick={()=>removeFromCart(idx)} style={{background:C.redLight,border:"none",borderRadius:8,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={14} c={C.red}/></button>
        </div>)}
        <div style={{background:C.bg,borderRadius:12,padding:"14px",marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
            <span style={{fontSize:14,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>{itemCount} รายการ</span>
            <span style={{fontSize:18,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>฿{total.toFixed(0)}</span>
          </div>
          <div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>*ราคายังไม่รวมภาษีและค่าบริการ (ถ้ามี)</div>
        </div>
      </div>
      <div style={{padding:"12px 16px",background:C.white,borderTop:`1px solid ${C.line}`,display:"flex",gap:10,flexShrink:0}}>
        <Btn v="ghost" onClick={()=>setStep("menu")} full small>← เพิ่มเมนู</Btn>
        <Btn v="success" onClick={placeOrder} loading={sending} full small icon={I.check}>ยืนยันสั่งอาหาร</Btn>
      </div>
    </>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── MAIN POS APP ──────────────────────────────────────
// ══════════════════════════════════════════════════════
function POSApp(){
  const[tab,setTab]=useState("tables");
  const[tables,setTables]=useState([]);const[menus,setMenus]=useState([]);const[cats,setCats]=useState([]);
  const[orders,setOrders]=useState([]);const[loading,setLoading]=useState(true);
  const[selTable,setSelTable]=useState(null);const[selOrder,setSelOrder]=useState(null);
  const[showManage,setShowManage]=useState(false);const[showQR,setShowQR]=useState(false);
  const currentUser=POSApp._user;const currentBranch=POSApp._branch;
  const autoRefTimer=useRef(null);

  async function loadAll(){
    try{
      const[t,m,c,o]=await Promise.all([db.getTables(currentBranch.id),db.getMenus(currentBranch.id),db.getCategories(),db.getActiveOrders(currentBranch.id)]);
      setTables(t);setMenus(m);setCats(c);setOrders(o);
    }catch(e){console.error(e);}
    setLoading(false);
  }

  async function loadOrders(){const o=await db.getActiveOrders(currentBranch.id);setOrders(o);}
  async function loadAllOrders(){const o=await db.getOrders(currentBranch.id);setOrders(o);}

  useEffect(()=>{
    loadAll();
    autoRefTimer.current=setInterval(()=>{if(tab==="tables"||tab==="orders")loadOrders();},15000);
    return()=>clearInterval(autoRefTimer.current);
  },[]);

  useEffect(()=>{if(tab==="orders")loadAllOrders();},[tab]);

  const TABS=[{id:"tables",l:"แผนผังโต๊ะ",icon:I.table},{id:"orders",l:"ออเดอร์",icon:I.order},{id:"qr",l:"QR สั่งอาหาร",icon:I.qr}];

  if(loading)return <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center"}}><Loading text="กำลังโหลดข้อมูล..."/></div>;

  return <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {/* Tabs */}
    <div style={{background:C.white,borderBottom:`1px solid ${C.line}`,padding:"0 16px",display:"flex",alignItems:"center",gap:2,height:48,flexShrink:0}}>
      {TABS.map(t=>{const active=tab===t.id;return <button key={t.id} onClick={()=>setTab(t.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"0 14px",height:48,border:"none",background:"none",cursor:"pointer",fontSize:13,fontWeight:active?800:500,color:active?C.brand:C.ink3,fontFamily:"'Sarabun',sans-serif",borderBottom:active?`2.5px solid ${C.brand}`:"2.5px solid transparent",transition:"all .15s"}}><Ic d={t.icon} s={14} c={active?C.brand:C.ink4}/>{t.l}</button>;})}
      <div style={{marginLeft:"auto",display:"flex",gap:8}}>
        <Btn v="ghost" onClick={()=>setShowManage(true)} icon={I.settings} small>จัดการโต๊ะ</Btn>
        <Btn v="ghost" onClick={()=>loadAll()} icon={I.refresh} small>รีเฟรช</Btn>
      </div>
    </div>

    {/* Content */}
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {tab==="tables"&&<TableMap tables={tables} orders={orders} onSelectTable={(t,o)=>{setSelTable(t);setSelOrder(o);}} onEditLayout={loadAll}/>}
      {tab==="orders"&&<OrderListView orders={orders} tables={tables} onRefresh={()=>loadAllOrders()}/>}
      {tab==="qr"&&<div style={{overflowY:"auto",flex:1}}><QRPage branch={currentBranch} tables={tables}/></div>}
    </div>

    {/* Table Order Modal */}
    {selTable&&<Modal title={`โต๊ะ ${selTable.table_number}${selTable.label?` — ${selTable.label}`:""}`} onClose={()=>{setSelTable(null);setSelOrder(null);loadAll();}} full>
      <OrderPanel table={selTable} order={selOrder} menus={menus} categories={cats} branch={currentBranch} currentUser={currentUser} onClose={()=>{setSelTable(null);setSelOrder(null);}} onDone={loadAll}/>
    </Modal>}

    {/* Table Management */}
    {showManage&&<Modal title="⚙️ จัดการโต๊ะ" onClose={()=>{setShowManage(false);loadAll();}} wide>
      <TableManage tables={tables} branch={currentBranch} onDone={loadAll}/>
    </Modal>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── ROOT APP ──────────────────────────────────────────
// ══════════════════════════════════════════════════════
export default function App(){
  const[user,setUser]=useState(null);const[branch,setBranch]=useState(null);

  // Check if customer scan mode
  const params=new URLSearchParams(window.location.search);
  const isScan=params.get("scan")==="1";
  const scanBranch=params.get("branch");
  const scanTable=params.get("table");

  if(isScan&&scanBranch&&scanTable){
    return <><style>{GS}</style><CustomerOrderPage branchId={scanBranch} tableId={scanTable}/></>;
  }

  if(!user)return <><style>{GS}</style><LoginPage onLogin={setUser}/></>;
  if(!branch)return <><style>{GS}</style><BranchSelect user={user} onSelect={setBranch}/></>;

  POSApp._user=user;POSApp._branch=branch;

  return <><style>{GS}</style>
    <div style={{height:"100vh",display:"flex",flexDirection:"column",overflow:"hidden",background:C.bg}}>
      {/* Navbar */}
      <nav style={{background:`linear-gradient(135deg,${C.ink},${C.ink2})`,padding:"0 16px",display:"flex",alignItems:"center",height:52,flexShrink:0,gap:12}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginRight:12}}>
          <div style={{width:32,height:32,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.fire} s={16} c={C.white} sw={2}/></div>
          <div><div style={{fontWeight:900,fontSize:13,color:C.white,fontFamily:"'Sarabun',sans-serif",lineHeight:1}}>NAIWANSOOK</div><div style={{fontSize:9,color:"rgba(255,255,255,.5)",letterSpacing:1.5,fontFamily:"'Sarabun',sans-serif"}}>FOODCOST POS</div></div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,background:"rgba(255,255,255,.1)",borderRadius:8,padding:"4px 10px"}}>
          <Ic d={I.branch} s={13} c="rgba(255,255,255,.7)"/>
          <span style={{fontSize:12,fontWeight:700,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>{branch.name}</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:8}}>
          <div style={{display:"flex",alignItems:"center",gap:5,background:"rgba(255,255,255,.1)",borderRadius:8,padding:"4px 10px"}}>
            <div style={{width:20,height:20,borderRadius:"50%",background:C.brand,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.user} s={10} c={C.white}/></div>
            <span style={{fontSize:12,fontWeight:600,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>{user.name||user.username}</span>
          </div>
          <button onClick={()=>setBranch(null)} style={{background:"rgba(255,255,255,.1)",border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",color:"rgba(255,255,255,.7)",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>เปลี่ยนสาขา</button>
          <button onClick={()=>{setUser(null);setBranch(null);}} style={{background:"rgba(239,68,68,.2)",border:"none",borderRadius:8,padding:"6px",cursor:"pointer",display:"flex"}}><Ic d={I.logout} s={14} c="#f87171"/></button>
        </div>
      </nav>
      <POSApp/>
    </div>
  </>;
}

const GS=`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Sarabun',sans-serif;overflow:hidden}
@keyframes mIn{from{opacity:0;transform:scale(.95) translateY(8px)}to{opacity:1;transform:scale(1) translateY(0)}}
@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}
::-webkit-scrollbar{width:4px;height:4px}
::-webkit-scrollbar-thumb{background:#CBD5E1;border-radius:999px}
input:focus,select:focus,textarea:focus{border-color:#FF6B35!important;outline:none}`;
