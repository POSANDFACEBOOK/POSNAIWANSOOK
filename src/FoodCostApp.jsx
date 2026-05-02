import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import * as XLSX from "xlsx";

const SUPA_URL = "https://niplvsfxynrufiyvbwme.supabase.co";
const SUPA_KEY = "sb_publishable_jpym6Xg4gOIPWDUDt5IntQ_7Bbh9KcZ";

async function sb(path, opts = {}) {
  const {headers:extraH, prefer, ...fetchOpts} = opts;
  const res = await fetch(`${SUPA_URL}/rest/v1/${path}`, {
    ...fetchOpts,
    headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json", "Prefer": prefer || "return=representation", ...extraH },
  });
  if (!res.ok) throw new Error(await res.text());
  const text = await res.text();
  return text ? JSON.parse(text) : [];
}

// === Production-grade helpers ============================================
// Money: round to 2 decimals using "banker's-safe" half-away-from-zero
const round2 = (n) => Math.round((+n||0)*100)/100;
// Currency formatter (Thai Baht, always 2 decimals)
const fmtTHB = (n) => `฿${(+n||0).toLocaleString("en-US",{minimumFractionDigits:2,maximumFractionDigits:2})}`;
// Today in Asia/Bangkok (YYYY-MM-DD) — avoids UTC off-by-one near midnight
const todayBkk = () => new Date().toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
// Friendly error mapping (avoid leaking Postgres internals to cashiers)
function friendlyError(err){
  const raw=(err&&err.message)?err.message:String(err||"");
  if(/duplicate key/.test(raw))return "ข้อมูลซ้ำกับที่มีอยู่ในระบบ";
  if(/violates row-level security/.test(raw))return "ไม่มีสิทธิ์ทำรายการนี้ — กรุณาติดต่อแอดมิน";
  if(/violates foreign key/.test(raw))return "ข้อมูลที่อ้างอิงไม่ถูกต้อง — อาจมีรายการที่เกี่ยวข้องถูกลบไปแล้ว";
  if(/violates not-null/.test(raw))return "ข้อมูลที่จำเป็นยังไม่ครบ — ตรวจสอบฟอร์มอีกครั้ง";
  if(/violates check constraint/.test(raw))return "ข้อมูลไม่ถูกต้องตามกติกาของระบบ";
  if(/Failed to fetch|NetworkError/.test(raw))return "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ — ตรวจสอบอินเทอร์เน็ต";
  if(raw.length>120)return "ทำรายการไม่สำเร็จ ลองใหม่อีกครั้ง";
  return raw||"เกิดข้อผิดพลาด";
}
// Show friendly error + log raw to console in dev only
function showErr(prefix,err){console.error(prefix,err);alert(prefix+": "+friendlyError(err));}
// Detect image MIME from magic bytes (browser File). Returns 'image/jpeg' | 'image/png' | 'image/webp' | null
async function detectImageMime(file){
  const buf=await file.slice(0,12).arrayBuffer();
  const b=new Uint8Array(buf);
  if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return "image/jpeg";
  if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47)return "image/png";
  if(b[0]===0x47&&b[1]===0x49&&b[2]===0x46)return "image/gif";
  if(b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50)return "image/webp";
  return null;
}
// Open print/PDF popup with blocker detection — caller falls back if returns null
function openPrintWindow(width=860,height=900){
  const w=window.open("","_blank",`width=${width},height=${height}`);
  if(!w){alert("เบราว์เซอร์บล็อกหน้าต่างพิมพ์ — กรุณาอนุญาต popup ในแถบที่อยู่ของเบราว์เซอร์ แล้วลองอีกครั้ง");return null;}
  return w;
}
// Random suffix for filenames so they're not enumerable by sequential ID
const randId=()=>Math.random().toString(36).slice(2,10)+Date.now().toString(36).slice(-4);
// HTML-escape user-content before injecting into print popup HTML (XSS guard)
const esc=(s)=>String(s==null?"":s).replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c]));

const api = {
  getIngs: () => sb(`ingredients?order=id.asc`),
  addIng: (d) => sb("ingredients", { method: "POST", body: JSON.stringify(d) }),
  updateIng: (id, d) => sb(`ingredients?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteIng: (id) => sb(`ingredients?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  getMenus: () => sb(`menus?order=id.asc`),
  addMenu: (d) => sb("menus", { method: "POST", body: JSON.stringify(d) }),
  updateMenu: (id, d) => sb(`menus?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteMenu: (id) => sb(`menus?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  getCats: () => sb("categories?order=id.asc"),
  addCat: (d) => sb("categories", { method: "POST", body: JSON.stringify(d) }),
  deleteCat: (id) => sb(`categories?id=eq.${id}`, { method: "DELETE", prefer: "return=minimal" }),
  updateCat: (id,d) => sb(`categories?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  getUsers: () => sb("app_users?order=id.asc"),
  addUser: (d) => sb("app_users", { method: "POST", body: JSON.stringify(d) }),
  updateUser: (id, d) => sb(`app_users?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteUser: (id) => sb(`app_users?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  loginUser: (u, p) => sb(`app_users?username=eq.${encodeURIComponent(u)}&password=eq.${encodeURIComponent(p)}&active=eq.true`),
  // Re-check that the logged-in user is still active (lets admins force logout)
  getMyUserStatus: (id) => sb(`app_users?id=eq.${+id}&select=id,active,role,perms,name,username,allowed_branches`),
  getBranches: () => sb("branches?order=id.asc"),
  addBranch: (d) => sb("branches", { method: "POST", body: JSON.stringify(d) }),
  updateBranch: (id, d) => sb(`branches?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteBranch: (id) => sb(`branches?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  getSuppliers: () => sb("suppliers?order=id.asc"),
  addSupplier: (d) => sb("suppliers", { method: "POST", body: JSON.stringify(d) }),
  updateSupplier: (id, d) => sb(`suppliers?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteSupplier: (id) => sb(`suppliers?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  getCostHist: (bid) => sb(`cost_history?order=id.desc&limit=50${bid ? `&branch_id=eq.${bid}` : ""}`),
  addCostHist: (d) => sb("cost_history", { method: "POST", body: JSON.stringify(d) }),
  deleteCostHistItem: (id) => sb(`cost_history?id=eq.${id}`, {method:"DELETE", prefer:"return=minimal"}),
  updateCostHistItem: (id,d) => sb(`cost_history?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  getActionHist: () => sb("action_history?order=id.desc&limit=100"),
  addActionHist: (d) => sb("action_history", { method: "POST", body: JSON.stringify(d) }),
  clearActionHist: () => sb("action_history?id=gt.0", { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  getOrders: (bid) => sb(`order_requests?order=id.desc${bid ? `&branch_id=eq.${bid}` : ""}`),
  addOrder: (d) => sb("order_requests", { method: "POST", body: JSON.stringify(d) }),
  updateOrder: (id, d) => sb(`order_requests?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(d) }),
  deleteOrder: (id) => sb(`order_requests?id=eq.${id}`, { method: "DELETE", headers: { "Prefer": "return=minimal" } }),
  getAllOrders: () => sb("order_requests?order=id.desc"),
  // POS
  getPOSTables: (bid) => sb(`tables?order=table_number.asc&branch_id=eq.${bid}&active=eq.true`),
  // Rotate QR token for a single table (cuts off any leaked / stale QRs)
  rotateTableToken: (id) => sb(`tables?id=eq.${id}`, {method:"PATCH", body:JSON.stringify({qr_token:crypto.randomUUID()})}),
  // Rotate all active tables in a branch in one batch
  rotateAllTableTokens: async (bid) => {
    const tbls=await sb(`tables?branch_id=eq.${bid}&active=eq.true&select=id`);
    for(const t of tbls){await sb(`tables?id=eq.${t.id}`, {method:"PATCH", body:JSON.stringify({qr_token:crypto.randomUUID()})});}
    return tbls.length;
  },
  // Public scan — verify QR token + branch active before returning anything
  scanTable: (branchId,tableId,token) => sb(`tables?id=eq.${+tableId}&branch_id=eq.${+branchId}&qr_token=eq.${encodeURIComponent(token||"")}&active=eq.true`),
  addPOSTable: (d) => sb("tables", { method:"POST", body:JSON.stringify(d) }),
  updatePOSTable: (id, d) => sb(`tables?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  deletePOSTable: (id) => sb(`tables?id=eq.${id}`, { method:"DELETE", headers:{"Prefer":"return=minimal"} }),
  getPOSOrders: (bid) => sb(`orders?order=created_at.desc&branch_id=eq.${bid}&limit=200`),
  // Printers
  getPrinters: (bid) => sb(`printers?order=id.asc${bid?`&branch_id=eq.${bid}`:"&branch_id=is.null"}`),
  getAllPrinters: () => sb(`printers?order=id.asc`),
  addPrinter: (d) => sb("printers", {method:"POST", body:JSON.stringify(d)}),
  updatePrinter: (id,d) => sb(`printers?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deletePrinter: (id) => sb(`printers?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  getActiveOrders: (bid) => sb(`orders?status=neq.paid&status=neq.cancelled&order=created_at.desc&branch_id=eq.${bid}`),
  getOrderByTable: (tid) => sb(`orders?table_id=eq.${tid}&status=neq.paid&status=neq.cancelled&order=created_at.desc&limit=1`),
  createPOSOrder: (d) => sb("orders", { method:"POST", body:JSON.stringify(d) }),
  updatePOSOrder: (id, d) => sb(`orders?id=eq.${id}`, { method:"PATCH", body:JSON.stringify(d) }),
  // CRM
  getCRMCustomers: (bid) => sb(`crm_customers?order=id.desc${bid?`&branch_id=eq.${bid}`:""}`),
  addCRMCustomer: (d) => sb("crm_customers", {method:"POST", body:JSON.stringify(d)}),
  updateCRMCustomer: (id,d) => sb(`crm_customers?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deleteCRMCustomer: (id) => sb(`crm_customers?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  getCRMTransactions: (bid) => sb(`crm_transactions?order=id.desc${bid?`&branch_id=eq.${bid}`:""}&limit=500`),
  addCRMTransaction: (d) => sb("crm_transactions", {method:"POST", body:JSON.stringify(d)}),
  getCRMVouchers: (bid) => sb(`crm_vouchers?order=id.desc${bid?`&branch_id=eq.${bid}`:""}`),
  addCRMVoucher: (d) => sb("crm_vouchers", {method:"POST", body:JSON.stringify(d)}),
  updateCRMVoucher: (id,d) => sb(`crm_vouchers?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deleteCRMVoucher: (id) => sb(`crm_vouchers?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  getCRMFeedback: (bid) => sb(`crm_feedback?order=id.desc${bid?`&branch_id=eq.${bid}`:""}&limit=200`),
  addCRMFeedback: (d) => sb("crm_feedback", {method:"POST", body:JSON.stringify(d)}),
  getCRMReservations: (bid) => sb(`crm_reservations?order=reserved_at.asc${bid?`&branch_id=eq.${bid}`:""}`),
  addCRMReservation: (d) => sb("crm_reservations", {method:"POST", body:JSON.stringify(d)}),
  updateCRMReservation: (id,d) => sb(`crm_reservations?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deleteCRMReservation: (id) => sb(`crm_reservations?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  // POS Shifts & Cash Drawer
  getActiveShift: (bid) => sb(`pos_shifts?branch_id=eq.${bid}&status=eq.open&order=opened_at.desc&limit=1`),
  getShifts: (bid,limit=50) => sb(`pos_shifts?branch_id=eq.${bid}&order=opened_at.desc&limit=${limit}`),
  openShift: (d) => sb("pos_shifts", {method:"POST", body:JSON.stringify(d)}),
  closeShift: (id,d) => sb(`pos_shifts?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  getCashMovements: (sid) => sb(`cash_movements?shift_id=eq.${sid}&order=created_at.desc`),
  addCashMovement: (d) => sb("cash_movements", {method:"POST", body:JSON.stringify(d)}),
  getExpenseCats: (bid) => sb(`expense_categories?branch_id=eq.${bid}&active=eq.true&order=sort_order.asc`),
  addExpenseCat: (d) => sb("expense_categories", {method:"POST", body:JSON.stringify(d)}),
  updateExpenseCat: (id,d) => sb(`expense_categories?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deleteExpenseCat: (id) => sb(`expense_categories?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  // Zones
  getZones: (bid) => sb(`table_zones?branch_id=eq.${bid}&order=sort_order.asc`),
  addZone: (d) => sb("table_zones", {method:"POST", body:JSON.stringify(d)}),
  updateZone: (id,d) => sb(`table_zones?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deleteZone: (id) => sb(`table_zones?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  // POS Settings (per-branch VAT, Service Charge, PromptPay, Receipt)
  getPOSSettings: (bid) => sb(`pos_settings?branch_id=eq.${bid}&limit=1`),
  upsertPOSSettings: (d) => sb("pos_settings", {method:"POST", body:JSON.stringify(d), headers:{"Prefer":"resolution=merge-duplicates,return=representation"}}),
  // Promotions
  getPromotions: (bid) => sb(`promotions?or=(branch_id.eq.${bid},branch_id.is.null)&order=sort_order.asc`),
  addPromotion: (d) => sb("promotions", {method:"POST", body:JSON.stringify(d)}),
  updatePromotion: (id,d) => sb(`promotions?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  deletePromotion: (id) => sb(`promotions?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  // Cost Snapshots — saved daily summaries (rolled up from external_sales)
  getCostSnapshots: (filters={}) => {
    const q=["order=snapshot_date.desc,id.desc","limit=2000"];
    if(filters.branchId)q.push(`branch_id=eq.${+filters.branchId}`);
    if(filters.dateFrom)q.push(`snapshot_date=gte.${filters.dateFrom}`);
    if(filters.dateTo)q.push(`snapshot_date=lte.${filters.dateTo}`);
    return sb(`cost_snapshots?${q.join("&")}`);
  },
  upsertCostSnapshot: async (d) => {
    const existing=await sb(`cost_snapshots?branch_id=eq.${+d.branch_id}&snapshot_date=eq.${d.snapshot_date}&source=eq.${encodeURIComponent(d.source||'foodstory')}&select=id`);
    if(Array.isArray(existing)&&existing.length>0){
      return sb(`cost_snapshots?id=eq.${existing[0].id}`, {method:"PATCH", body:JSON.stringify({...d,updated_at:new Date().toISOString()})});
    }
    return sb("cost_snapshots", {method:"POST", body:JSON.stringify(d)});
  },
  deleteCostSnapshot: (id) => sb(`cost_snapshots?id=eq.${+id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  // External Sales (FoodStory imports)
  getExternalSales: (filters={}) => {
    const q=["order=sale_date.desc,menu_name.asc","limit=5000"];
    if(filters.branchId)q.push(`branch_id=eq.${+filters.branchId}`);
    if(filters.dateFrom)q.push(`sale_date=gte.${filters.dateFrom}`);
    if(filters.dateTo)q.push(`sale_date=lte.${filters.dateTo}`);
    return sb(`external_sales?${q.join("&")}`);
  },
  addExternalSalesBatch: (rows) => sb("external_sales", {method:"POST", body:JSON.stringify(rows), headers:{"Prefer":"return=minimal"}}),
  deleteExternalSalesBy: (branchId,date) => sb(`external_sales?branch_id=eq.${+branchId}&sale_date=eq.${date}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  // Purchase Orders
  getPOs: (filters={}) => {
    const q=["order=po_date.desc,id.desc"];
    // viewerBranchId = branch sees POs where it is sender OR receiver
    if(filters.viewerBranchId!=null)q.push(`or=(from_branch_id.eq.${filters.viewerBranchId},branch_id.eq.${filters.viewerBranchId})`);
    if(filters.fromBranchId!=null)q.push(`from_branch_id=eq.${filters.fromBranchId}`);
    if(filters.toBranchId!=null)q.push(`branch_id=eq.${filters.toBranchId}`);
    if(filters.dateFrom)q.push(`po_date=gte.${filters.dateFrom}`);
    if(filters.dateTo)q.push(`po_date=lte.${filters.dateTo}`);
    return sb(`purchase_orders?${q.join("&")}`);
  },
  addPO: (d) => sb("purchase_orders", {method:"POST", body:JSON.stringify(d)}),
  updatePO: (id,d) => sb(`purchase_orders?id=eq.${id}`, {method:"PATCH", body:JSON.stringify(d)}),
  // PATCH only when the row is in an expected status. If 0 rows return, the row was changed by someone else.
  patchPOIfStatus: async (id,expectedStatus,d) => {
    const res=await sb(`purchase_orders?id=eq.${id}&status=eq.${encodeURIComponent(expectedStatus)}`, {method:"PATCH", body:JSON.stringify(d)});
    if(!Array.isArray(res)||res.length===0)throw new Error("เอกสารถูกแก้ไขโดยผู้ใช้อื่นแล้ว — กรุณารีเฟรชและลองใหม่");
    return res;
  },
  deletePO: (id) => sb(`purchase_orders?id=eq.${id}`, {method:"DELETE", headers:{"Prefer":"return=minimal"}}),
  uploadImage: async (file, path) => {
    const res = await fetch(`${SUPA_URL}/storage/v1/object/foodcost-images/${path}`, {
      method: "POST", headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": file.type, "x-upsert": "true" }, body: file,
    });
    if (!res.ok) throw new Error(await res.text());
    return `${SUPA_URL}/storage/v1/object/public/foodcost-images/${path}`;
  },
  // Private slip upload — returns the storage *path* only (not a public URL)
  uploadSlip: async (file, path) => {
    const res = await fetch(`${SUPA_URL}/storage/v1/object/po-slips-private/${path}`, {
      method: "POST", headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": file.type, "x-upsert": "true" }, body: file,
    });
    if (!res.ok) throw new Error(await res.text());
    return path;  // Caller stores this path; viewing requires getSlipSignedUrl
  },
  // Get a short-lived signed URL to view a private slip
  getSlipSignedUrl: async (pathOrUrl, expiresIn=3600) => {
    if(!pathOrUrl)return null;
    // Backward compat: legacy slips were saved as full URLs to the public bucket
    if(/^https?:\/\//.test(pathOrUrl))return pathOrUrl;
    const res = await fetch(`${SUPA_URL}/storage/v1/object/sign/po-slips-private/${pathOrUrl}`, {
      method: "POST", headers: { "apikey": SUPA_KEY, "Authorization": `Bearer ${SUPA_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({expiresIn}),
    });
    if (!res.ok) throw new Error(await res.text());
    const data = await res.json();
    const signed = data.signedURL || data.signedUrl;  // API spelling has varied
    return signed.startsWith("http") ? signed : `${SUPA_URL}/storage/v1${signed}`;
  },
};

const C = {
  brand:"#FF6B35",brandDark:"#E85520",brandLight:"#FFF4F0",brandBorder:"#FFD4C2",
  green:"#10B981",greenLight:"#ECFDF5",blue:"#3B82F6",blueLight:"#EFF6FF",
  yellow:"#F59E0B",yellowLight:"#FFFBEB",red:"#EF4444",redLight:"#FEF2F2",
  purple:"#8B5CF6",purpleLight:"#F5F3FF",teal:"#0D9488",tealLight:"#F0FDFA",
  ink:"#0F172A",ink2:"#334155",ink3:"#64748B",ink4:"#94A3B8",
  line:"#E2E8F0",lineLight:"#F1F5F9",bg:"#F8FAFC",white:"#FFFFFF",
};

const Ic = ({ d, s=18, c="currentColor", sw=1.75 }) => (
  <svg width={s} height={s} viewBox="0 0 24 24" fill="none" stroke={c} strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" style={{flexShrink:0}}>
    {Array.isArray(d)?d.map((p,i)=><path key={i} d={p}/>):<path d={d}/>}
  </svg>
);
const I = {
  leaf:"M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2z M8 12s1-4 4-4 4 4 4 4",
  fire:"M12 2c0 6-6 7-6 12a6 6 0 0012 0c0-5-6-6-6-12z",
  sop:["M9 12h6","M9 16h6","M9 8h2","M13 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V9z","M13 2v7h7"],
  chart:["M18 20V10","M12 20V4","M6 20v-6"],
  clock:"M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z",
  plus:["M12 5v14","M5 12h14"],
  search:"M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  pencil:"M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z",
  trash:"M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16",
  x:["M18 6L6 18","M6 6l12 12"],
  check:"M5 13l4 4L19 7",
  img:["M21 19V5a2 2 0 00-2-2H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2z","M8.5 10a1.5 1.5 0 100-3 1.5 1.5 0 000 3z","M21 15l-5-5L5 21"],
  save:["M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z","M17 21v-8H7v8","M7 3v5h8"],
  dl:["M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4","M7 10l5 5 5-5","M12 15V3"],
  user:["M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2","M12 11a4 4 0 100-8 4 4 0 000 8z"],
  lock:["M19 11H5a2 2 0 00-2 2v7a2 2 0 002 2h14a2 2 0 002-2v-7a2 2 0 00-2-2z","M7 11V7a5 5 0 0110 0v4"],
  settings:["M12 15a3 3 0 100-6 3 3 0 000 6z","M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"],
  logout:["M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4","M16 17l5-5-5-5","M21 12H9"],
  tag:"M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z",
  bolt:"M13 2L3 14h9l-1 8 10-12h-9l1-8z",
  warning:"M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z",
  calendar:["M8 2v4","M16 2v4","M3 8h18","M5 4h14a2 2 0 012 2v14a2 2 0 01-2 2H5a2 2 0 01-2-2V6a2 2 0 012-2z"],
  printer:["M6 9V2h12v7","M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2","M6 14h12v8H6z"],
  sortAsc:["M3 8h8","M3 12h6","M3 16h4","M17 20V4","M13 8l4-4 4 4"],
  sortDesc:["M3 8h8","M3 12h6","M3 16h4","M17 4v16","M13 16l4 4 4-4"],
  eye:["M1 12s4-8 11-8 11 8 11 8","M1 12s4 8 11 8 11-8 11-8","M12 9a3 3 0 100 6 3 3 0 000-6z"],
  users:["M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2","M9 11a4 4 0 100-8 4 4 0 000 8z","M23 21v-2a4 4 0 00-3-3.87","M16 3.13a4 4 0 010 7.75"],
  refresh:"M23 4v6h-6 M1 20v-6h6 M3.51 9a9 9 0 0114.85-3.36L23 10 M1 14l4.64 4.36A9 9 0 0020.49 15",
  cloud:"M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z",
  branch:["M6 3v12","M18 9a3 3 0 100-6 3 3 0 000 6z","M6 21a3 3 0 100-6 3 3 0 000 6z","M15 6a9 9 0 01-9 9"],
  truck:["M1 3h15v13H1z","M16 8h4l3 3v5h-7V8z","M5.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z","M18.5 21a2.5 2.5 0 100-5 2.5 2.5 0 000 5z"],
  shop:"M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z M9 22V12h6v10",
  order:["M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2","M9 5a2 2 0 002 2h2a2 2 0 002-2","M9 5a2 2 0 012-2h2a2 2 0 012 2","M9 12h6","M9 16h4"],
  send:["M22 2L11 13","M22 2L15 22 11 13 2 9l20-7z"],
  box:"M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z",
  arrowRight:"M5 12h14 M12 5l7 7-7 7",
  chevD:"M19 9l-7 7-7-7",
  table:["M3 3h18v18H3z","M3 9h18","M3 15h18","M9 3v18","M15 3v18"],
  qr:["M3 3h6v6H3z","M15 3h6v6h-6z","M3 15h6v6H3z","M15 15h2v2h-2z","M19 15v2","M15 19h2","M19 19h2","M19 21v-2"],
  bill:["M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z","M14 2v6h6","M16 13H8","M16 17H8","M10 9H8"],
  print:["M6 9V2h12v7","M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2","M6 14h12v8H6z"],
  minus:"M5 12h14",
  cash:"M12 2v20M17 5H9.5a3.5 3.5 0 100 7h5a3.5 3.5 0 110 7H6",
  food:"M18 8h1a4 4 0 010 8h-1 M2 8h16v9a4 4 0 01-4 4H6a4 4 0 01-4-4V8z M6 1v3 M10 1v3 M14 1v3",
  drag:"M9 3h.01M15 3h.01M9 9h.01M15 9h.01M9 15h.01M15 15h.01",
};

const ALL_PERMS=[
  {id:"pos",label:"ขายหน้าร้าน"},
  {id:"crm",label:"CRM ลูกค้า"},
  {id:"ingredients",label:"วัตถุดิบ"},
  {id:"menus",label:"เมนู"},
  {id:"sop",label:"SOP"},
  {id:"summary",label:"สรุปต้นทุน"},
  {id:"fs_sales",label:"ยอดขาย FoodStory"},
  {id:"po",label:"เอกสาร PO"},
  {id:"orders",label:"สั่งวัตถุดิบ"},
  {id:"history",label:"ประวัติต้นทุน"},
  {id:"suppliers",label:"ซัพพลาย"},
  {id:"settings",label:"ตั้งค่า"},
];
const ROLE_DEFAULT_PERMS={
  admin:ALL_PERMS.map(p=>p.id),
  manager:["pos","crm","ingredients","menus","sop","summary","fs_sales","po","orders","history","suppliers"],
  staff:["pos","crm","ingredients","menus","sop","summary","fs_sales","po","orders","history","suppliers"],
  viewer:["pos","menus","sop"],
};
// Coerce a value to an array (handles JSON string from legacy DB rows, null = treat as null sentinel)
function asArr(x){
  if(Array.isArray(x))return x;
  if(typeof x==="string"){try{const p=JSON.parse(x);return Array.isArray(p)?p:[];}catch{return [];}}
  return null;  // null/undefined preserved as sentinel
}
// Normalize a perms array: dedupe + only keep ids that exist in ALL_PERMS today.
// Cleans legacy/duplicate/renamed entries so we never see counts like "17/12".
function normalizePerms(input){
  const arr=asArr(input)||[];
  const valid=new Set(ALL_PERMS.map(p=>p.id));
  return [...new Set(arr.filter(p=>typeof p==="string"&&valid.has(p)))];
}
// Same idea for allowed_branches: dedupe + only keep numeric ids
function normalizeBranchIds(input){
  const arr=asArr(input);
  if(arr==null)return null;  // sentinel preserved (null = unrestricted)
  return [...new Set(arr.map(x=>+x).filter(x=>Number.isFinite(x)&&x>0))];
}
function getUserPerms(user){const a=normalizePerms(user?.perms);return(a&&a.length>0)?a:(ROLE_DEFAULT_PERMS[user?.role]||[]);}
function hasPerm(user,perm){
  if(!user)return false;
  if(user.role==="admin")return true;
  return getUserPerms(user).includes(perm);
}
const ROLES={admin:{label:"Admin",color:"purple"},manager:{label:"Manager",color:"blue"},staff:{label:"Staff",color:"green"},viewer:{label:"Viewer",color:"gray"}};
const ppg=(price,gram)=>(gram>0?price/gram:0);
const menuCost=(menu,ings)=>(menu.ingredients||[]).reduce((s,x)=>{const i=ings.find(g=>g.id===x.ingredientId);return s+(i?i.price_per_gram*x.amountGram:0);},0);
const marginColor=(m)=>m>=60?C.green:m>=40?C.yellow:C.red;
const marginLabel=(m)=>m>=60?"ดี":m>=40?"พอใช้":"ต่ำ";
// Format date/time in Thai locale but always Gregorian year (not Buddhist) — receipts must read 2026 not 2569
const fmtDT=(d)=>(d?new Date(d):new Date()).toLocaleString("th-TH",{calendar:"gregory",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"});
const fmtD=(d)=>(d?new Date(d):new Date()).toLocaleDateString("th-TH",{calendar:"gregory",year:"numeric",month:"2-digit",day:"2-digit"});
const nowStr=()=>fmtDT();
const todayStr=()=>todayBkk();

const iS={width:"100%",padding:"11px 14px",border:`1.5px solid ${C.line}`,borderRadius:10,fontSize:15,fontFamily:"'Sarabun',sans-serif",outline:"none",boxSizing:"border-box",color:C.ink,background:C.white,transition:"border .15s"};
function Field({label,hint,children,style}){return <div style={{marginBottom:16,...style}}>{(label||hint)&&<div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}>{label&&<label style={{fontSize:13,fontWeight:600,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>{label}</label>}{hint&&<span style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{hint}</span>}</div>}{children}</div>;}
function Inp({label,hint,style:s,...p}){return <Field label={label} hint={hint}><input style={{...iS,...s}} {...p}/></Field>;}
function TA({label,hint,rows=4,...p}){return <Field label={label} hint={hint}><textarea rows={rows} style={{...iS,resize:"vertical",lineHeight:1.8}} {...p}/></Field>;}
function Sel({label,options,...p}){return <Field label={label}><select style={{...iS,appearance:"none",cursor:"pointer"}} {...p}>{options.map(o=><option key={o.v??o} value={o.v??o}>{o.l??o}</option>)}</select></Field>;}
function Btn({children,v="primary",onClick,icon,disabled,full,s,loading}){
  const st={primary:{bg:`linear-gradient(135deg,${C.brand},${C.brandDark})`,c:C.white,sh:`0 4px 16px ${C.brand}44`},success:{bg:`linear-gradient(135deg,${C.green},#059669)`,c:C.white,sh:`0 4px 16px ${C.green}44`},ghost:{bg:C.white,c:C.ink2,sh:`0 0 0 1.5px ${C.line}`},danger:{bg:C.redLight,c:C.red,sh:"none"},info:{bg:`linear-gradient(135deg,${C.blue},#2563EB)`,c:C.white,sh:`0 4px 16px ${C.blue}44`},teal:{bg:`linear-gradient(135deg,${C.teal},#0F766E)`,c:C.white,sh:`0 4px 16px ${C.teal}44`},purple:{bg:`linear-gradient(135deg,${C.purple},#7C3AED)`,c:C.white,sh:`0 4px 16px ${C.purple}44`}}[v]||{bg:C.lineLight,c:C.ink2,sh:"none"};
  return <button onClick={(disabled||loading)?undefined:onClick} style={{display:"inline-flex",alignItems:"center",justifyContent:"center",gap:7,padding:"10px 20px",borderRadius:10,fontSize:14,fontWeight:700,cursor:(disabled||loading)?"not-allowed":"pointer",border:"none",fontFamily:"'Sarabun',sans-serif",transition:"all .15s",opacity:(disabled||loading)?.6:1,background:st.bg,color:st.c,boxShadow:st.sh,width:full?"100%":undefined,whiteSpace:"nowrap",...s}} onMouseEnter={e=>{if(!disabled&&!loading){e.currentTarget.style.opacity=".85";e.currentTarget.style.transform="translateY(-1px)";}}} onMouseLeave={e=>{e.currentTarget.style.opacity="1";e.currentTarget.style.transform="";}}>{loading?<span>⟳ กำลังโหลด...</span>:<>{icon&&<Ic d={icon} s={15} c={st.c}/>}{children}</>}</button>;
}
function Chip({children,color="orange"}){const m={orange:[C.brandLight,C.brand],blue:[C.blueLight,C.blue],green:[C.greenLight,C.green],red:[C.redLight,C.red],yellow:[C.yellowLight,C.yellow],gray:[C.lineLight,C.ink3],purple:[C.purpleLight,C.purple],teal:[C.tealLight,C.teal]};const[bg,tc]=m[color]||m.gray;return <span style={{display:"inline-flex",alignItems:"center",padding:"2px 10px",background:bg,color:tc,borderRadius:20,fontSize:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>{children}</span>;}
function Card({children,style,onClick,hover}){const[hov,setHov]=useState(false);return <div style={{background:C.white,borderRadius:16,border:`1px solid ${hov&&hover?C.brandBorder:C.line}`,boxShadow:hov&&hover?"0 8px 32px rgba(255,107,53,.12)":"0 2px 8px rgba(15,23,42,.06)",transition:"all .2s",cursor:onClick?"pointer":undefined,...style}} onClick={onClick} onMouseEnter={()=>setHov(true)} onMouseLeave={()=>setHov(false)}>{children}</div>;}
function Modal({title,onClose,children,wide,extraWide}){
  useEffect(()=>{const h=e=>e.key==="Escape"&&onClose();document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h);},[]);
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1000,padding:16}} onClick={e=>e.target===e.currentTarget&&onClose()}>
    <div style={{background:C.white,borderRadius:20,width:"100%",maxWidth:extraWide?1000:wide?760:560,maxHeight:"94vh",display:"flex",flexDirection:"column",boxShadow:"0 40px 100px rgba(15,23,42,.22)",animation:"mIn .22s cubic-bezier(.34,1.56,.64,1)",overflow:"hidden"}}>
      <div style={{padding:"18px 24px 14px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0,background:C.bg}}>
        <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:800,color:C.ink}}>{title}</span>
        <button onClick={onClose} style={{background:C.line,border:"none",cursor:"pointer",color:C.ink3,padding:7,borderRadius:8,display:"flex"}}><Ic d={I.x} s={15}/></button>
      </div>
      <div style={{padding:"20px 24px 24px",overflowY:"auto",flex:1}}>{children}</div>
    </div>
  </div>;
}
let _confirmOpener=null;
function confirmDlg(opts){
  return new Promise(resolve=>{
    if(!_confirmOpener)return resolve(typeof window!=="undefined"?window.confirm(typeof opts==="string"?opts:opts.message||"ยืนยัน?"):false);
    _confirmOpener(typeof opts==="string"?{message:opts}:opts,resolve);
  });
}
function ConfirmDlg(){
  const[st,setSt]=useState(null);
  useEffect(()=>{_confirmOpener=(opts,resolve)=>setSt({opts,resolve});return()=>{_confirmOpener=null;};},[]);
  useEffect(()=>{if(!st)return;const h=e=>{if(e.key==="Escape"){e.preventDefault();const r=st.resolve;setSt(null);r(false);}else if(e.key==="Enter"){e.preventDefault();const r=st.resolve;setSt(null);r(true);}};document.addEventListener("keydown",h);return()=>document.removeEventListener("keydown",h);},[st]);
  if(!st)return null;
  const close=v=>{const r=st.resolve;setSt(null);r(v);};
  const o=st.opts;
  const danger=o.danger!==false;
  const title=o.title||(danger?"ยืนยันการลบ":"ยืนยัน");
  const msg=o.message||"ต้องการดำเนินการนี้ใช่หรือไม่?";
  const ok=o.confirmLabel||(danger?"ลบ":"ยืนยัน");
  const cancel=o.cancelLabel||"ยกเลิก";
  const accent=danger?C.red:C.brand;
  const accentLight=danger?C.redLight:C.brandLight;
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:6000,padding:16}} onClick={e=>e.target===e.currentTarget&&close(false)}>
    <div style={{background:C.white,borderRadius:22,width:"100%",maxWidth:420,boxShadow:"0 40px 100px rgba(15,23,42,.28)",animation:"mIn .22s cubic-bezier(.34,1.56,.64,1)",overflow:"hidden"}}>
      <div style={{padding:"30px 28px 20px",textAlign:"center"}}>
        <div style={{width:68,height:68,margin:"0 auto 18px",borderRadius:"50%",background:accentLight,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:`0 8px 24px ${accent}33`,border:`1px solid ${accent}22`}}>
          <Ic d={danger?I.trash:I.warning} s={30} c={accent} sw={2}/>
        </div>
        <div style={{fontSize:20,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:8,letterSpacing:-.3}}>{title}</div>
        <div style={{fontSize:14,color:C.ink3,fontFamily:"'Sarabun',sans-serif",lineHeight:1.65,whiteSpace:"pre-line"}}>{msg}</div>
      </div>
      <div style={{display:"flex",gap:10,padding:"4px 24px 24px"}}>
        <button onClick={()=>close(false)} style={{flex:1,padding:"12px 16px",borderRadius:12,border:`1.5px solid ${C.line}`,background:C.white,color:C.ink2,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.background=C.lineLight;}} onMouseLeave={e=>{e.currentTarget.style.background=C.white;}}>{cancel}</button>
        <button onClick={()=>close(true)} autoFocus style={{flex:1,padding:"12px 16px",borderRadius:12,border:"none",background:danger?`linear-gradient(135deg,${C.red},#DC2626)`:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white,fontSize:14,fontWeight:800,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:`0 8px 20px ${accent}55`,transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-1px)";e.currentTarget.style.filter="brightness(1.05)";}} onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.filter="";}}>{ok}</button>
      </div>
    </div>
  </div>;
}
function EditedBy({username,editAt}){if(!username)return null;return <span style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:3}}><Ic d={I.user} s={9} c={C.ink4}/>แก้โดย {username}{editAt?` · ${editAt}`:""}</span>;}
function Loading({text="กำลังโหลด..."}){return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"80px 0",gap:16}}><div style={{width:44,height:44,border:`4px solid ${C.brandLight}`,borderTop:`4px solid ${C.brand}`,borderRadius:"50%",animation:"spin .8s linear infinite"}}/><p style={{color:C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>{text}</p></div>;}
function ErrBox({msg,onRetry}){return <div style={{background:C.redLight,border:`1px solid ${C.red}22`,borderRadius:12,padding:"16px 20px",display:"flex",alignItems:"center",gap:12,margin:"16px 0"}}><Ic d={I.warning} s={20} c={C.red}/><span style={{flex:1,color:C.red,fontFamily:"'Sarabun',sans-serif",fontSize:14}}>{msg}</span>{onRetry&&<Btn v="danger" onClick={onRetry} s={{padding:"6px 14px",fontSize:12}}>ลองใหม่</Btn>}</div>;}
function STh({label,col,sortCol,sortDir,onSort}){const active=sortCol===col;return <th onClick={()=>onSort(col)} style={{padding:"10px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:active?C.brand:C.ink3,cursor:"pointer",whiteSpace:"nowrap",userSelect:"none",background:active?C.brandLight:C.bg}}><div style={{display:"flex",alignItems:"center",gap:4}}>{label}<Ic d={active?(sortDir==="asc"?I.sortAsc:I.sortDesc):I.sortAsc} s={12} c={active?C.brand:C.ink4}/></div></th>;}

async function compressImage(file,maxW=800,quality=0.75){return new Promise(resolve=>{const img=new Image();const url=URL.createObjectURL(file);img.onload=()=>{const scale=Math.min(1,maxW/Math.max(img.width,img.height));const w=Math.round(img.width*scale);const h=Math.round(img.height*scale);const canvas=document.createElement("canvas");canvas.width=w;canvas.height=h;canvas.getContext("2d").drawImage(img,0,0,w,h);canvas.toBlob(blob=>{URL.revokeObjectURL(url);resolve(blob);},"image/jpeg",quality);};img.src=url;});}

function ImgUp({value,onChange,label,compact}){
  const ref=useRef();const[uploading,setUploading]=useState(false);
  const h=async e=>{const f=e.target.files?.[0];if(!f)return;if(f.size>10*1024*1024){alert("รูปต้องไม่เกิน 10MB");return;}setUploading(true);try{const compressed=await compressImage(f,800,0.75);const path=`${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`;const url=await api.uploadImage(new File([compressed],path,{type:"image/jpeg"}),path);onChange(url);}catch(err){alert("อัปโหลดรูปไม่สำเร็จ: "+err.message);}setUploading(false);e.target.value="";};
  return <div style={{marginBottom:compact?0:16}}>{label&&!compact&&<div style={{fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>{label}</div>}
    <div style={{display:"flex",alignItems:"center",gap:12}}>
      {value?<div style={{position:"relative"}}><img src={value} alt="" style={{width:compact?44:96,height:compact?44:96,objectFit:"cover",borderRadius:compact?8:14,border:`2px solid ${C.line}`}}/><button onClick={()=>onChange(null)} style={{position:"absolute",top:-7,right:-7,width:20,height:20,borderRadius:"50%",background:C.red,border:`2px solid ${C.white}`,color:C.white,cursor:"pointer",fontSize:10,display:"flex",alignItems:"center",justifyContent:"center",fontWeight:700}}>✕</button></div>
      :<div onClick={()=>ref.current?.click()} style={{width:compact?44:96,height:compact?44:96,border:`2px dashed ${C.line}`,borderRadius:compact?8:14,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:"pointer",background:uploading?C.brandLight:C.bg,gap:4,transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.background=C.brandLight;}} onMouseLeave={e=>{if(!uploading){e.currentTarget.style.borderColor=C.line;e.currentTarget.style.background=C.bg;}}}>
        {uploading?<span style={{fontSize:10,color:C.brand,fontFamily:"'Sarabun',sans-serif",textAlign:"center",padding:4}}>กำลังอัปโหลด...</span>:<><Ic d={I.img} s={compact?16:24} c={C.ink4}/>{!compact&&<span style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>อัปโหลด</span>}</>}
      </div>}
      {!compact&&!value&&!uploading&&<div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif",lineHeight:1.6}}>JPG, PNG<br/>ย่อรูปอัตโนมัติ</div>}
      <input ref={ref} type="file" accept="image/*" onChange={h} style={{display:"none"}}/>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── LOGIN ─────────────────────────────────────────────
// ══════════════════════════════════════════════════════
function LoginPage({onLogin}){
  const[u,setU]=useState("");const[p,setP]=useState("");const[err,setErr]=useState("");const[show,setShow]=useState(false);const[loading,setLoading]=useState(false);
  async function login(){if(!u||!p)return;setLoading(true);setErr("");try{const found=await api.loginUser(u,p);if(found&&found.length>0)onLogin(found[0]);else setErr("ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง");}catch(e){setErr("เชื่อมต่อ Supabase ไม่ได้");}setLoading(false);}
  return <div style={{minHeight:"100vh",background:`linear-gradient(135deg,${C.brandLight} 0%,#FEF3C7 50%,${C.blueLight} 100%)`,display:"flex",alignItems:"center",justifyContent:"center"}}>
    <div style={{background:C.white,borderRadius:24,padding:"44px 40px",width:"100%",maxWidth:420,boxShadow:"0 32px 80px rgba(15,23,42,.15)",animation:"mIn .4s cubic-bezier(.34,1.56,.64,1)"}}>
      <div style={{textAlign:"center",marginBottom:36}}>
        <div style={{width:64,height:64,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 14px",boxShadow:`0 8px 24px ${C.brand}44`}}><Ic d={I.fire} s={30} c={C.white} sw={2}/></div>
        <h1 style={{fontSize:20,fontWeight:900,color:C.ink,marginBottom:2,fontFamily:"'Sarabun',sans-serif"}}>NAIWANSOOK FOODCOST</h1>
        <p style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",letterSpacing:1.5}}>BY BOSSMAX</p>
      </div>
      <div style={{marginBottom:16}}><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ชื่อผู้ใช้</label><div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.user} s={16} c={C.ink4}/></span><input value={u} onChange={e=>setU(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} placeholder="username" style={{...iS,paddingLeft:40}} autoFocus/></div></div>
      <div style={{marginBottom:20}}><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>รหัสผ่าน</label><div style={{position:"relative"}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.lock} s={16} c={C.ink4}/></span><input value={p} onChange={e=>setP(e.target.value)} onKeyDown={e=>e.key==="Enter"&&login()} type={show?"text":"password"} placeholder="password" style={{...iS,paddingLeft:40,paddingRight:44}}/><button onClick={()=>setShow(!show)} style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",background:"none",border:"none",cursor:"pointer"}}><Ic d={I.eye} s={16} c={C.ink4}/></button></div></div>
      {err&&<div style={{background:C.redLight,color:C.red,borderRadius:10,padding:"10px 14px",fontSize:13,fontWeight:600,marginBottom:16,display:"flex",alignItems:"center",gap:6}}><Ic d={I.warning} s={14} c={C.red}/>{err}</div>}
      <Btn onClick={login} full loading={loading}>เข้าสู่ระบบ</Btn>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── BRANCH SELECTOR ───────────────────────────────────
// ══════════════════════════════════════════════════════
function BranchSelector({branches,onSelect,user,onLogout}){
  // Filter by user.allowed_branches: null = no restriction; array = whitelist
  // Admin always bypasses the restriction (so they can fix mistakes).
  const allowed=user?.allowed_branches;
  const isAdmin=user?.role==="admin";
  const visible=branches.filter(b=>{
    if(b.active===false)return false;
    if(isAdmin)return true;
    if(allowed==null)return true;
    return (allowed||[]).map(x=>+x).includes(+b.id);
  });
  return <div style={{minHeight:"100vh",background:`linear-gradient(135deg,#f0fdf4,#eff6ff)`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:"'Sarabun',sans-serif"}}>
    <div style={{width:"100%",maxWidth:600,padding:24}}>
      <div style={{textAlign:"center",marginBottom:32}}>
        <div style={{width:56,height:56,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><Ic d={I.fire} s={26} c={C.white} sw={2}/></div>
        <h2 style={{fontSize:22,fontWeight:900,color:C.ink,marginBottom:4}}>เลือกสาขา</h2>
        <p style={{fontSize:14,color:C.ink3}}>สวัสดีครับ <b>{user.name||user.username}</b> กรุณาเลือกสาขาที่ต้องการเข้าใช้งาน</p>
      </div>
      {visible.length===0?<div style={{background:C.white,borderRadius:16,padding:"30px 24px",textAlign:"center",border:`2px solid ${C.brandBorder}`}}>
        <div style={{fontSize:48,marginBottom:8}}>🚫</div>
        <div style={{fontSize:17,fontWeight:900,color:C.ink,marginBottom:6}}>ยังไม่ได้รับสิทธิ์เข้าสาขาใด</div>
        <div style={{fontSize:13,color:C.ink3,lineHeight:1.7,marginBottom:18}}>กรุณาติดต่อแอดมินเพื่อขอสิทธิ์เข้าสาขา</div>
        {onLogout&&<Btn v="ghost" onClick={onLogout}>← ออกจากระบบ</Btn>}
      </div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(240px,1fr))",gap:14}}>
        {visible.map(branch=>{
          const isCentral=branch.type==="central";
          return <div key={branch.id} onClick={()=>onSelect(branch)} style={{background:C.white,borderRadius:16,padding:"22px 20px",cursor:"pointer",border:`2px solid ${isCentral?C.teal:C.line}`,boxShadow:isCentral?`0 4px 20px ${C.teal}22`:"0 2px 8px rgba(15,23,42,.06)",transition:"all .2s",display:"flex",alignItems:"center",gap:16}} onMouseEnter={e=>{e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 12px 32px ${isCentral?C.teal:C.brand}22`;}} onMouseLeave={e=>{e.currentTarget.style.transform="";e.currentTarget.style.boxShadow=isCentral?`0 4px 20px ${C.teal}22`:"0 2px 8px rgba(15,23,42,.06)";}}>
            <div style={{width:48,height:48,borderRadius:14,background:isCentral?`linear-gradient(135deg,${C.teal},#0F766E)`:`linear-gradient(135deg,${C.brand},${C.brandDark})`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <Ic d={isCentral?I.shop:I.branch} s={22} c={C.white} sw={2}/>
            </div>
            <div>
              <div style={{fontWeight:800,fontSize:16,color:C.ink,marginBottom:4}}>{branch.name}</div>
              <Chip color={isCentral?"teal":"orange"}>{isCentral?"ครัวกลาง":"สาขา"}</Chip>
            </div>
          </div>;
        })}
      </div>}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── IMPORT INGREDIENTS MODAL ──────────────────────────
// ══════════════════════════════════════════════════════
function ImportIngModal({onClose,ingCats,suppliers,currentUser,currentBranch,onDone}){
  const[step,setStep]=useState(1); // 1=upload, 2=preview, 3=done
  const[rows,setRows]=useState([]);
  const[saving,setSaving]=useState(false);
  const[progress,setProgress]=useState(0);
  const fileRef=useRef();

  // parse text/csv file
  function parseFile(text){
    const lines=text.split("\n").map(l=>l.trim()).filter(l=>l);
    const parsed=[];
    let currentCat="อื่นๆ";
    const catKeywords=["หมวดหมู่","หมวด"];
    lines.forEach(line=>{
      // detect category header
      if(catKeywords.some(k=>line.includes(k))&&!line.match(/^\d/)){
        const m=line.match(/[（(](.+?)[）)]/);
        if(m){
          const raw=m[1].trim();
          if(raw.includes("หมู"))currentCat="เนื้อสัตว์";
          else if(raw.includes("ไก่"))currentCat="เนื้อสัตว์";
          else if(raw.includes("เนื้อ"))currentCat="เนื้อสัตว์";
          else if(raw.includes("ทะเล"))currentCat="เนื้อสัตว์";
          else if(raw.includes("ผัก"))currentCat="ผักและผลไม้";
          else if(raw.includes("เครื่องปรุง"))currentCat="เครื่องปรุง";
          else if(raw.includes("แช่แข็ง"))currentCat="อื่นๆ";
          else if(raw.includes("เส้น"))currentCat="แป้ง/ธัญพืช";
          else currentCat="อื่นๆ";
        }
        return;
      }
      // split by tab
      const parts=line.split("\t").map(p=>p.trim());
      if(parts.length<1||!parts[0])return;
      const name=parts[0];
      if(!name||name.length<2)return;
      // skip if looks like header
      if(["ราคา","ยี่ห้อ","ซัพ","พลาย","การสั่ง","หมายเหตุ"].includes(name))return;
      const priceRaw=parts[1]||"";
      const price=parseFloat(priceRaw.replace(/[^0-9.]/g,""))||0;
      const brand=parts[2]||"";
      const supName=parts[3]||"";
      const note=parts[5]||"";
      parsed.push({name,buy_price:price,category:currentCat,supplier_name:supName.trim(),brand:brand.trim(),note:note.trim(),buy_unit:"กก.",buy_amount:1,convert_to_gram:1000,price_per_gram:price>0?price/1000:0,stock:0,selected:true});
    });
    return parsed.filter(r=>r.name&&r.name.length>=2);
  }

  function handleFile(e){
    const f=e.target.files?.[0];if(!f)return;
    const r=new FileReader();
    r.onload=ev=>{
      const text=ev.target.result;
      const parsed=parseFile(text);
      setRows(parsed);setStep(2);
    };
    r.readAsText(f,"UTF-8");
    e.target.value="";
  }

  function handlePaste(e){
    const text=e.target.value;
    const parsed=parseFile(text);
    if(parsed.length>0){setRows(parsed);setStep(2);}
  }

  async function doImport(){
    const selected=rows.filter(r=>r.selected);
    if(!selected.length)return;
    setSaving(true);setProgress(0);
    let done=0;
    for(const row of selected){
      try{
        // find supplier id
        const sup=suppliers.find(s=>s.name===row.supplier_name||s.name.includes(row.supplier_name)||row.supplier_name.includes(s.name));
        const item={name:row.name,category:row.category,buy_unit:row.buy_unit,buy_amount:row.buy_amount,buy_price:row.buy_price,convert_to_gram:row.convert_to_gram,price_per_gram:row.buy_price>0?row.buy_price/row.convert_to_gram:0,stock:row.stock,image:null,note:row.note,edit_by:currentUser.username,edit_at:new Date().toLocaleString("th-TH"),branch_id:currentBranch.id,supplier_id:sup?.id||null,supplier_name:sup?.name||row.supplier_name||""};
        await api.addIng(item);
      }catch(e){console.error("skip:",row.name,e.message);}
      done++;setProgress(Math.round(done/selected.length*100));
    }
    setSaving(false);setStep(3);onDone();
  }

  const catColors={"เนื้อสัตว์":"orange","ผักและผลไม้":"green","เครื่องปรุง":"blue","แป้ง/ธัญพืช":"purple","นม/ไข่":"yellow","อื่นๆ":"gray"};
  const allCatList=["เนื้อสัตว์","ผักและผลไม้","เครื่องปรุง","แป้ง/ธัญพืช","นม/ไข่","อื่นๆ"];

  return <Modal title="📥 Import วัตถุดิบ" onClose={onClose} extraWide>
    {step===1&&<div>
      <div style={{background:C.blueLight,borderRadius:12,padding:"14px 16px",marginBottom:20,border:`1px solid ${C.blue}22`}}>
        <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>รองรับไฟล์ประเภทไหนบ้าง?</div>
        <div style={{fontSize:13,color:C.ink2,fontFamily:"'Sarabun',sans-serif",lineHeight:1.8}}>
          ✅ ไฟล์ <b>.txt</b> จาก Google Docs (ดาวน์โหลด → ข้อความธรรมดา)<br/>
          ✅ ไฟล์ <b>.csv</b> จาก Excel<br/>
          ✅ <b>วางข้อความ</b> ตรงๆ จาก Google Sheet/Excel
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${C.line}`,borderRadius:14,padding:"32px 20px",textAlign:"center",cursor:"pointer",transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.background=C.brandLight;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.background="transparent";}}>
          <Ic d={I.ul} s={36} c={C.brand}/>
          <div style={{fontWeight:700,fontSize:15,color:C.ink,marginTop:10,fontFamily:"'Sarabun',sans-serif"}}>อัปโหลดไฟล์</div>
          <div style={{fontSize:12,color:C.ink4,marginTop:4,fontFamily:"'Sarabun',sans-serif"}}>.txt หรือ .csv</div>
        </div>
        <div style={{border:`2px dashed ${C.line}`,borderRadius:14,padding:"16px"}}>
          <div style={{fontSize:13,fontWeight:600,color:C.ink2,marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>หรือวางข้อความโดยตรง</div>
          <textarea onChange={handlePaste} placeholder={"วางข้อมูลจาก Excel/Google Sheet ที่นี่...\nตัวอย่าง:\nสันคอแลป\t143\t\tปนัดดา"} style={{...iS,height:130,fontSize:12,resize:"none"}}/>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".txt,.csv" onChange={handleFile} style={{display:"none"}}/>
    </div>}

    {step===2&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontFamily:"'Sarabun',sans-serif"}}>
          <span style={{fontWeight:800,fontSize:15,color:C.ink}}>พบข้อมูล {rows.length} รายการ</span>
          <span style={{fontSize:13,color:C.ink3,marginLeft:8}}>เลือก {rows.filter(r=>r.selected).length} รายการ</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={()=>setRows(r=>r.map(x=>({...x,selected:true})))} s={{padding:"6px 12px",fontSize:12}}>เลือกทั้งหมด</Btn>
          <Btn v="ghost" onClick={()=>setRows(r=>r.map(x=>({...x,selected:false})))} s={{padding:"6px 12px",fontSize:12}}>ยกเลิกทั้งหมด</Btn>
        </div>
      </div>
      <div style={{maxHeight:420,overflowY:"auto",border:`1px solid ${C.line}`,borderRadius:12,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif",fontSize:13}}>
          <thead><tr style={{background:C.bg,position:"sticky",top:0}}>
            <th style={{padding:"8px 12px",textAlign:"center",width:40}}><input type="checkbox" checked={rows.every(r=>r.selected)} onChange={e=>setRows(r=>r.map(x=>({...x,selected:e.target.checked})))} style={{accentColor:C.brand,width:15,height:15}}/></th>
            {["ชื่อวัตถุดิบ","ราคา (฿)","หมวดหมู่","ซัพพลาย","หมายเหตุ"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:C.ink3}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {rows.map((row,idx)=><tr key={idx} style={{borderTop:`1px solid ${C.lineLight}`,background:row.selected?C.white:"#f8f9fa",opacity:row.selected?1:.5}}>
              <td style={{padding:"8px 12px",textAlign:"center"}}><input type="checkbox" checked={!!row.selected} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,selected:e.target.checked}:x))} style={{accentColor:C.brand,width:15,height:15}}/></td>
              <td style={{padding:"8px 12px"}}>
                <input value={row.name} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,name:e.target.value}:x))} style={{...iS,padding:"4px 8px",fontSize:13}}/>
              </td>
              <td style={{padding:"8px 12px"}}>
                <input type="number" value={row.buy_price} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,buy_price:+e.target.value}:x))} style={{...iS,padding:"4px 8px",fontSize:13,width:80}}/>
              </td>
              <td style={{padding:"8px 12px"}}>
                <select value={row.category} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,category:e.target.value}:x))} style={{...iS,padding:"4px 8px",fontSize:12,appearance:"none"}}>
                  {allCatList.map(c=><option key={c}>{c}</option>)}
                </select>
              </td>
              <td style={{padding:"8px 12px"}}>
                <div style={{fontSize:12,color:C.teal,fontWeight:600}}>{row.supplier_name||"-"}</div>
              </td>
              <td style={{padding:"8px 12px",fontSize:11,color:C.ink4}}>{row.note||"-"}</td>
            </tr>)}
          </tbody>
        </table>
      </div>
      {saving&&<div style={{marginTop:12,background:C.brandLight,borderRadius:10,padding:"10px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:13,fontFamily:"'Sarabun',sans-serif",color:C.brand}}>กำลัง Import...</span><span style={{fontSize:13,fontWeight:700,color:C.brand}}>{progress}%</span></div>
        <div style={{background:C.brandBorder,borderRadius:999,height:6}}><div style={{width:`${progress}%`,background:C.brand,height:"100%",borderRadius:999,transition:"width .3s"}}/></div>
      </div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:14,borderTop:`1px solid ${C.line}`,marginTop:14}}>
        <Btn v="ghost" onClick={()=>setStep(1)}>← กลับ</Btn>
        <Btn onClick={doImport} icon={I.check} disabled={!rows.filter(r=>r.selected).length} loading={saving}>Import {rows.filter(r=>r.selected).length} รายการ</Btn>
      </div>
    </div>}

    {step===3&&<div style={{textAlign:"center",padding:"40px 0"}}>
      <div style={{fontSize:48,marginBottom:12}}>✅</div>
      <div style={{fontSize:20,fontWeight:800,color:C.green,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>Import สำเร็จ!</div>
      <div style={{fontSize:14,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:24}}>เพิ่มวัตถุดิบเข้าระบบแล้วครับ</div>
      <Btn onClick={onClose}>ปิดและดูข้อมูล</Btn>
    </div>}
  </Modal>;
}

// ══════════════════════════════════════════════════════
// ── IMPORT MENU MODAL ─────────────────────────────────
// ══════════════════════════════════════════════════════
function ImportMenuModal({onClose,menuCats,currentUser,currentBranch,onDone}){
  const[step,setStep]=useState(1);const[rows,setRows]=useState([]);const[saving,setSaving]=useState(false);const[progress,setProgress]=useState(0);
  const fileRef=useRef();
  const defaultCat=menuCats[0]?.name||"อาหารจานเดียว";
  const allMenuCatList=menuCats.map(c=>c.name);

  function parseMenuText(text){
    const lines=text.split("\n").map(l=>l.trim()).filter(l=>l);
    const parsed=[];
    lines.forEach(line=>{
      const parts=line.split("\t").map(p=>p.trim());
      const name=parts[0];
      if(!name||name.length<2)return;
      if(["ชื่อเมนู","เมนู","ราคา","หมวด"].includes(name))return;
      const priceRaw=parts[1]||"";
      const price=parseFloat(priceRaw.replace(/[^0-9.]/g,""))||0;
      const cat=parts[2]||defaultCat;
      const desc=parts[3]||"";
      parsed.push({name,price,category:allMenuCatList.includes(cat)?cat:defaultCat,description:desc,selected:true});
    });
    return parsed.filter(r=>r.name&&r.name.length>=2);
  }

  function handleFile(e){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=ev=>{const parsed=parseMenuText(ev.target.result);setRows(parsed);setStep(2);};r.readAsText(f,"UTF-8");e.target.value="";}
  function handlePaste(e){const parsed=parseMenuText(e.target.value);if(parsed.length>0){setRows(parsed);setStep(2);}}

  async function doImport(){
    const selected=rows.filter(r=>r.selected);if(!selected.length)return;
    setSaving(true);setProgress(0);let done=0;
    for(const row of selected){
      try{await api.addMenu({name:row.name,category:row.category,price:+row.price,description:row.description,image:null,ingredients:[],sop:[],edit_by:currentUser.username,edit_at:new Date().toLocaleString("th-TH"),branch_id:currentBranch.id});}
      catch(e){console.error("skip:",row.name);}
      done++;setProgress(Math.round(done/selected.length*100));
    }
    setSaving(false);setStep(3);onDone();
  }

  return <Modal title="📥 Import เมนูอาหาร" onClose={onClose} wide>
    {step===1&&<div>
      <div style={{background:C.blueLight,borderRadius:12,padding:"14px 16px",marginBottom:20,border:`1px solid ${C.blue}22`}}>
        <div style={{fontSize:13,fontWeight:700,color:C.blue,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>รูปแบบข้อมูลที่รองรับ</div>
        <div style={{fontSize:13,color:C.ink2,fontFamily:"'Sarabun',sans-serif",lineHeight:1.8}}>
          ✅ ไฟล์ <b>.txt</b> หรือ <b>.csv</b><br/>
          ✅ คอลัมน์: <b>ชื่อเมนู | ราคา | หมวดหมู่ | รายละเอียด</b><br/>
          ✅ วางข้อความจาก Excel ได้เลย
        </div>
      </div>
      <div style={{background:C.bg,borderRadius:12,padding:"12px 14px",marginBottom:16,border:`1px solid ${C.line}`}}>
        <div style={{fontSize:12,fontWeight:700,color:C.ink3,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ตัวอย่างรูปแบบ</div>
        <pre style={{fontSize:12,color:C.ink2,fontFamily:"monospace",lineHeight:1.6}}>{"ข้าวผัดไก่\t80\tอาหารจานเดียว\tข้าวผัดหอมๆ\nผัดกะเพราหมู\t70\tอาหารจานเดียว"}</pre>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16}}>
        <div onClick={()=>fileRef.current?.click()} style={{border:`2px dashed ${C.line}`,borderRadius:14,padding:"32px 20px",textAlign:"center",cursor:"pointer",transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.background=C.brandLight;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.background="transparent";}}>
          <Ic d={I.ul} s={36} c={C.brand}/><div style={{fontWeight:700,fontSize:15,color:C.ink,marginTop:10,fontFamily:"'Sarabun',sans-serif"}}>อัปโหลดไฟล์</div><div style={{fontSize:12,color:C.ink4,marginTop:4,fontFamily:"'Sarabun',sans-serif"}}>.txt หรือ .csv</div>
        </div>
        <div style={{border:`2px dashed ${C.line}`,borderRadius:14,padding:"16px"}}>
          <div style={{fontSize:13,fontWeight:600,color:C.ink2,marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>หรือวางข้อความ</div>
          <textarea onChange={handlePaste} placeholder={"ชื่อเมนู\tราคา\tหมวดหมู่\nข้าวผัดไก่\t80\tอาหารจานเดียว"} style={{...iS,height:130,fontSize:12,resize:"none"}}/>
        </div>
      </div>
      <input ref={fileRef} type="file" accept=".txt,.csv" onChange={handleFile} style={{display:"none"}}/>
    </div>}

    {step===2&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <div style={{fontFamily:"'Sarabun',sans-serif"}}><span style={{fontWeight:800,fontSize:15,color:C.ink}}>พบ {rows.length} เมนู</span><span style={{fontSize:13,color:C.ink3,marginLeft:8}}>เลือก {rows.filter(r=>r.selected).length} รายการ</span></div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={()=>setRows(r=>r.map(x=>({...x,selected:true})))} s={{padding:"6px 12px",fontSize:12}}>เลือกทั้งหมด</Btn>
          <Btn v="ghost" onClick={()=>setRows(r=>r.map(x=>({...x,selected:false})))} s={{padding:"6px 12px",fontSize:12}}>ยกเลิก</Btn>
        </div>
      </div>
      <div style={{maxHeight:380,overflowY:"auto",border:`1px solid ${C.line}`,borderRadius:12,overflow:"hidden"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif",fontSize:13}}>
          <thead><tr style={{background:C.bg}}>
            <th style={{padding:"8px 12px",width:40,textAlign:"center"}}><input type="checkbox" checked={rows.every(r=>r.selected)} onChange={e=>setRows(r=>r.map(x=>({...x,selected:e.target.checked})))} style={{accentColor:C.brand,width:15,height:15}}/></th>
            {["ชื่อเมนู","ราคา (฿)","หมวดหมู่","รายละเอียด"].map(h=><th key={h} style={{padding:"8px 12px",textAlign:"left",fontSize:11,fontWeight:700,color:C.ink3}}>{h}</th>)}
          </tr></thead>
          <tbody>{rows.map((row,idx)=><tr key={idx} style={{borderTop:`1px solid ${C.lineLight}`,opacity:row.selected?1:.5}}>
            <td style={{padding:"8px 12px",textAlign:"center"}}><input type="checkbox" checked={!!row.selected} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,selected:e.target.checked}:x))} style={{accentColor:C.brand,width:15,height:15}}/></td>
            <td style={{padding:"8px 12px"}}><input value={row.name} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,name:e.target.value}:x))} style={{...iS,padding:"4px 8px",fontSize:13}}/></td>
            <td style={{padding:"8px 12px"}}><input type="number" value={row.price} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,price:+e.target.value}:x))} style={{...iS,padding:"4px 8px",fontSize:13,width:90}}/></td>
            <td style={{padding:"8px 12px"}}><select value={row.category} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,category:e.target.value}:x))} style={{...iS,padding:"4px 8px",fontSize:12,appearance:"none"}}>{allMenuCatList.map(c=><option key={c}>{c}</option>)}</select></td>
            <td style={{padding:"8px 12px"}}><input value={row.description} onChange={e=>setRows(r=>r.map((x,i)=>i===idx?{...x,description:e.target.value}:x))} placeholder="รายละเอียด..." style={{...iS,padding:"4px 8px",fontSize:12}}/></td>
          </tr>)}
          </tbody>
        </table>
      </div>
      {saving&&<div style={{marginTop:12,background:C.brandLight,borderRadius:10,padding:"10px 14px"}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:6}}><span style={{fontSize:13,fontFamily:"'Sarabun',sans-serif",color:C.brand}}>กำลัง Import...</span><span style={{fontSize:13,fontWeight:700,color:C.brand}}>{progress}%</span></div>
        <div style={{background:C.brandBorder,borderRadius:999,height:6}}><div style={{width:`${progress}%`,background:C.brand,height:"100%",borderRadius:999,transition:"width .3s"}}/></div>
      </div>}
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:14,borderTop:`1px solid ${C.line}`,marginTop:14}}>
        <Btn v="ghost" onClick={()=>setStep(1)}>← กลับ</Btn>
        <Btn onClick={doImport} icon={I.check} disabled={!rows.filter(r=>r.selected).length} loading={saving}>Import {rows.filter(r=>r.selected).length} เมนู</Btn>
      </div>
    </div>}

    {step===3&&<div style={{textAlign:"center",padding:"40px 0"}}>
      <div style={{fontSize:48,marginBottom:12}}>✅</div>
      <div style={{fontSize:20,fontWeight:800,color:C.green,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>Import เมนูสำเร็จ!</div>
      <div style={{fontSize:14,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:24}}>เพิ่มเมนูเข้าระบบแล้วครับ</div>
      <Btn onClick={onClose}>ปิดและดูเมนู</Btn>
    </div>}
  </Modal>;
}

// ══════════════════════════════════════════════════════
// ── INGREDIENT TAB ────────────────────────────────────
// ══════════════════════════════════════════════════════
function IngTab({ings,reload,ingCats,suppliers,currentUser,currentBranch,addH,branches=[],reloadCats}){
  const[q,setQ]=useState("");const[cat,setCat]=useState("ทุกหมวด");const[open,setOpen]=useState(false);const[editId,setEditId]=useState(null);const[saving,setSaving]=useState(false);const[pg,setPg]=useState(1);const PG=18;const[showImport,setShowImport]=useState(false);
  const[editingCatId,setEditingCatId]=useState(null);const[editingCatName,setEditingCatName]=useState("");const[newCatName,setNewCatName]=useState("");const[addingCat,setAddingCat]=useState(false);
  const ef={name:"",category:ingCats[0]?.name||"",buy_unit:"กก.",buy_amount:1,buy_price:"",convert_to_gram:1000,price_per_gram:0,stock:"",image:null,note:"",supplier_id:"",supplier_name:""};
  const[form,setForm]=useState(ef);
  const isCentral=currentBranch?.type==="central";
  const canE=hasPerm(currentUser,"ingredients")&&isCentral;const canD=hasPerm(currentUser,"ingredients")&&isCentral;
  async function addCat(){if(!newCatName.trim())return;try{await api.addCat({type:"ingredient",name:newCatName.trim()});await reloadCats();setNewCatName("");setAddingCat(false);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}}
  async function saveCatRename(){if(!editingCatName.trim()||!editingCatId)return;try{await api.updateCat(editingCatId,{name:editingCatName.trim()});await reloadCats();setEditingCatId(null);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}}
  async function delCat(c){if(!await confirmDlg({title:"ลบหมวดหมู่",message:`ต้องการลบหมวด "${c.name}" ใช่หรือไม่?`}))return;try{await api.deleteCat(c.id);await reloadCats();if(cat===c.name)setCat("ทุกหมวด");}catch(e){alert("ลบไม่สำเร็จ: "+e.message);}}
  const filtered=useMemo(()=>ings.filter(i=>{const vb=i.visible_branches||[];const matchB=isCentral||vb.length===0||vb.includes(currentBranch?.id);return i.name.toLowerCase().includes(q.toLowerCase())&&(cat==="ทุกหมวด"||i.category===cat)&&matchB;}),[ings,q,cat,isCentral,currentBranch]);
  const paged=useMemo(()=>filtered.slice(0,pg*PG),[filtered,pg]);
  function upd(k,val){setForm(f=>{const n={...f,[k]:val};if(k==="buy_price"||k==="convert_to_gram")n.price_per_gram=ppg(+(k==="buy_price"?val:n.buy_price)||0,+(k==="convert_to_gram"?val:n.convert_to_gram)||1);if(k==="supplier_id"){const sup=suppliers.find(s=>String(s.id)===String(val));n.supplier_name=sup?sup.name:"";}return n;});}
  async function save(){if(!form.name||!form.buy_price)return;setSaving(true);try{const item={...form,buy_price:+form.buy_price,buy_amount:+form.buy_amount,convert_to_gram:+form.convert_to_gram,price_per_gram:ppg(+form.buy_price,+form.convert_to_gram),stock:+form.stock,edit_by:currentUser.username,edit_at:nowStr(),branch_id:currentBranch.id,supplier_id:form.supplier_id?+form.supplier_id:null};if(editId){await api.updateIng(editId,item);addH(`แก้ไขวัตถุดิบ: ${form.name}`);}else{await api.addIng(item);addH(`เพิ่มวัตถุดิบ: ${form.name}`);}await reload();setOpen(false);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}setSaving(false);}
  async function del(id,name){if(!await confirmDlg({title:"ลบวัตถุดิบ",message:`ต้องการลบ "${name}" ใช่หรือไม่?`}))return;try{await api.deleteIng(id);addH(`ลบวัตถุดิบ: ${name}`);await reload();}catch(e){alert("ลบไม่สำเร็จ");}}
  async function toggleVBIng(item,branchId){const nonCB=branches.filter(b=>b.type!=="central");let vb=[...(item.visible_branches||[])];if(vb.length===0){vb=nonCB.map(b=>b.id).filter(id=>id!==branchId);}else{const idx=vb.indexOf(branchId);if(idx===-1)vb.push(branchId);else vb.splice(idx,1);if(vb.length===nonCB.length)vb=[];}try{await api.updateIng(item.id,{visible_branches:vb});await reload();}catch{alert("บันทึกไม่สำเร็จ");}}
  return <div>
    {!isCentral&&<div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}><Ic d={I.warning} s={16} c="#F59E0B"/><span style={{fontSize:13,color:"#92400E",fontFamily:"'Sarabun',sans-serif"}}>วัตถุดิบจัดการโดยสาขาครัวกลางเท่านั้น • สาขานี้ดูข้อมูลได้อย่างเดียว</span></div>}
    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      <button onClick={()=>{setCat("ทุกหมวด");setPg(1);}} style={{padding:"7px 18px",borderRadius:20,border:`2px solid ${cat==="ทุกหมวด"?C.brand:C.line}`,background:cat==="ทุกหมวด"?C.brand:"transparent",color:cat==="ทุกหมวด"?C.white:C.ink3,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"'Sarabun',sans-serif",transition:"all .15s"}}>ทุกหมวด</button>
      {ingCats.map(c=>{const active=cat===c.name;return editingCatId===c.id?
        <input key={c.id} value={editingCatName} onChange={e=>setEditingCatName(e.target.value)} onBlur={saveCatRename} onKeyDown={e=>{if(e.key==="Enter")saveCatRename();if(e.key==="Escape")setEditingCatId(null);}} autoFocus style={{...iS,width:110,padding:"6px 12px",fontSize:13,borderRadius:20,border:`2px solid ${C.brand}`,fontWeight:700}}/>
        :<div key={c.id} onClick={()=>{setCat(c.name);setPg(1);}} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:20,border:`2px solid ${active?C.brand:C.line}`,background:active?C.brand:"transparent",cursor:"pointer",transition:"all .15s"}}>
          <span style={{fontSize:13,fontWeight:700,color:active?C.white:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>{c.name}</span>
          {canE&&<div style={{display:"flex",gap:2,marginLeft:2}} onClick={e=>e.stopPropagation()}>
            <button onClick={()=>{setEditingCatId(c.id);setEditingCatName(c.name);}} style={{background:active?"rgba(255,255,255,0.25)":"rgba(0,0,0,0.06)",border:"none",borderRadius:6,width:20,height:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.pencil} s={10} c={active?C.white:C.ink3}/></button>
            <button onClick={()=>delCat(c)} style={{background:active?"rgba(255,255,255,0.25)":"rgba(239,68,68,0.1)",border:"none",borderRadius:6,width:20,height:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.x} s={10} c={active?C.white:C.red}/></button>
          </div>}
        </div>;
      })}
      {canE&&(addingCat?
        <div style={{display:"flex",gap:6,alignItems:"center"}}>
          <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addCat();if(e.key==="Escape"){setAddingCat(false);setNewCatName("");}}} autoFocus placeholder="ชื่อหมวดหมู่..." style={{...iS,width:130,padding:"6px 14px",fontSize:13,borderRadius:20,border:`2px solid ${C.brand}`,fontWeight:600}}/>
          <button onClick={addCat} style={{padding:"7px 14px",borderRadius:20,background:C.brand,color:C.white,border:"none",cursor:"pointer",fontSize:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ตกลง</button>
          <button onClick={()=>{setAddingCat(false);setNewCatName("");}} style={{padding:"7px 12px",borderRadius:20,background:"transparent",color:C.ink3,border:`1px solid ${C.line}`,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>ยกเลิก</button>
        </div>
        :<button onClick={()=>setAddingCat(true)} style={{padding:"7px 14px",borderRadius:20,border:`2px dashed ${C.line}`,background:"transparent",color:C.ink3,cursor:"pointer",fontSize:13,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:5,transition:"all .15s"}}><Ic d={I.plus} s={12} c={C.ink3}/>เพิ่มหมวด</button>
      )}
    </div>
    <div style={{display:"flex",gap:10,marginBottom:20,flexWrap:"wrap"}}>
      <div style={{position:"relative",flex:1,minWidth:220}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.search} s={16} c={C.ink4}/></span><input value={q} onChange={e=>{setQ(e.target.value);setPg(1);}} placeholder="ค้นหาวัตถุดิบ..." style={{...iS,paddingLeft:40}}/></div>
      {canE&&<Btn onClick={()=>{setForm(ef);setEditId(null);setOpen(true);}} icon={I.plus}>เพิ่มวัตถุดิบ</Btn>}
      {canE&&<Btn v="info" onClick={()=>setShowImport(true)} icon={I.ul}>Import</Btn>}
    </div>
    <div style={{fontSize:12,color:C.ink4,marginBottom:14,fontFamily:"'Sarabun',sans-serif"}}>แสดง {paged.length} จาก {filtered.length} รายการ</div>
    {paged.length===0?<div style={{textAlign:"center",padding:"80px 0",color:C.ink4}}><Ic d={I.warning} s={44} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>ไม่พบวัตถุดิบ</p></div>:<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(310px,1fr))",gap:14}}>
        {paged.map(item=><Card key={item.id} hover style={{overflow:"hidden"}}>
          <div style={{display:"flex"}}>
            {item.image?<img src={item.image} alt={item.name} style={{width:88,height:88,objectFit:"cover",flexShrink:0}}/>:<div style={{width:88,height:88,background:`linear-gradient(135deg,${C.brandLight},#FEF3C7)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={I.leaf} s={32} c={C.brand}/></div>}
            <div style={{flex:1,padding:"12px 14px 10px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:4}}>
                <div><div style={{fontWeight:800,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}>{item.name}</div><Chip color="orange">{item.category}</Chip></div>
                <div style={{display:"flex",gap:4}}>
                  {canE&&<button onClick={()=>{setForm({name:item.name,category:item.category,buy_unit:item.buy_unit,buy_amount:item.buy_amount,buy_price:item.buy_price,convert_to_gram:item.convert_to_gram,price_per_gram:item.price_per_gram,stock:item.stock,image:item.image,note:item.note||"",supplier_id:String(item.supplier_id||""),supplier_name:item.supplier_name||""});setEditId(item.id);setOpen(true);}} style={{background:C.blueLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c={C.blue}/></button>}
                  {canD&&<button onClick={()=>del(item.id,item.name)} style={{background:C.redLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>}
                </div>
              </div>
              {item.supplier_name&&<div style={{fontSize:11,color:C.teal,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:3}}><Ic d={I.truck} s={10} c={C.teal}/>ซัพพลาย: {item.supplier_name}</div>}
            </div>
          </div>
          <div style={{padding:"10px 14px 14px",borderTop:`1px solid ${C.lineLight}`}}>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:6}}>
              {[{l:"ซื้อมา",v:`฿${item.buy_price}`,sub:`${item.buy_amount} ${item.buy_unit}`,bg:C.lineLight,tc:C.ink},{l:"รวมกรัม",v:`${(+item.convert_to_gram).toLocaleString()}g`,sub:"ทั้งหมด",bg:C.brandLight,tc:C.brand},{l:"ราคา/กรัม",v:`฿${(+item.price_per_gram).toFixed(3)}`,sub:"ต่อ 1g",bg:C.greenLight,tc:C.green}].map(st=><div key={st.l} style={{background:st.bg,borderRadius:10,padding:"8px 10px",textAlign:"center"}}><div style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}>{st.l}</div><div style={{fontSize:13,fontWeight:800,color:st.tc,fontFamily:"'Sarabun',sans-serif"}}>{st.v}</div><div style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{st.sub}</div></div>)}
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>สต็อก: <b style={{color:+item.stock<3?C.red:C.green}}>{item.stock} {item.buy_unit}</b></span>
              <EditedBy username={item.edit_by} editAt={item.edit_at}/>
            </div>
          </div>
          {isCentral&&<div style={{padding:"8px 14px 10px",borderTop:`1px solid ${C.lineLight}`,background:"#F8FAFC"}}>
            <div style={{fontSize:10,color:C.ink4,marginBottom:5,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:4}}><Ic d={I.branch} s={10} c={C.ink4}/>แสดงที่สาขา:</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {branches.filter(b=>b.type!=="central").length===0?<span style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีสาขา</span>
              :branches.filter(b=>b.type!=="central").map(b=>{const vb=item.visible_branches||[];const isOn=vb.length===0||vb.includes(b.id);return <button key={b.id} onClick={()=>toggleVBIng(item,b.id)} style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:700,border:`1px solid ${isOn?C.green:C.line}`,background:isOn?C.greenLight:"transparent",color:isOn?C.green:C.ink4,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>{isOn?"✓ ":""}{b.name}</button>;})}
            </div>
          </div>}
        </Card>)}
      </div>
      {paged.length<filtered.length&&<div style={{textAlign:"center",marginTop:20}}><Btn v="ghost" onClick={()=>setPg(p=>p+1)}>โหลดเพิ่ม ({filtered.length-paged.length})</Btn></div>}
    </>}
    {showImport&&<ImportIngModal onClose={()=>setShowImport(false)} ingCats={ingCats} suppliers={suppliers} currentUser={currentUser} currentBranch={currentBranch} onDone={async()=>{await reload();setShowImport(false);}}/>}
    {open&&<Modal title={editId?"✏️ แก้ไขวัตถุดิบ":"➕ เพิ่มวัตถุดิบใหม่"} onClose={()=>setOpen(false)}>
      <ImgUp label="รูปวัตถุดิบ" value={form.image} onChange={v=>upd("image",v)}/>
      <Inp label="ชื่อวัตถุดิบ" value={form.name} onChange={e=>upd("name",e.target.value)} placeholder="เช่น ไก่หน้าอก" autoFocus/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="หมวดหมู่"><select value={form.category} onChange={e=>upd("category",e.target.value)} style={{...iS,appearance:"none"}}>{ingCats.map(c=><option key={c.id}>{c.name}</option>)}</select></Field>
        <Field label="ซัพพลาย"><select value={form.supplier_id} onChange={e=>upd("supplier_id",e.target.value)} style={{...iS,appearance:"none"}}><option value="">-- ไม่ระบุ --</option>{suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
      </div>
      <div style={{background:C.lineLight,borderRadius:12,padding:"16px",marginBottom:16}}>
        <div style={{fontSize:13,fontWeight:700,color:C.ink2,marginBottom:12,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:6}}><Ic d={I.tag} s={14} c={C.brand}/>ข้อมูลการซื้อ</div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><Inp label="จำนวนที่ซื้อ" type="number" value={form.buy_amount} onChange={e=>upd("buy_amount",e.target.value)} placeholder="1"/><Inp label="หน่วยที่ซื้อ" value={form.buy_unit} onChange={e=>upd("buy_unit",e.target.value)} placeholder="กก., ขวด, แผง"/></div>
        <Inp label="ราคาที่ซื้อมา (บาท)" type="number" value={form.buy_price} onChange={e=>upd("buy_price",e.target.value)} placeholder="0"/>
      </div>
      <div style={{background:C.brandLight,borderRadius:12,padding:"16px",marginBottom:16,border:`1px solid ${C.brandBorder}`}}>
        <Inp label="รวมทั้งหมดกี่กรัม" hint="แปลงเป็นกรัม" type="number" value={form.convert_to_gram} onChange={e=>upd("convert_to_gram",e.target.value)} placeholder="1000"/>
        <div style={{background:C.white,borderRadius:10,padding:"10px 14px",border:`1px solid ${C.brandBorder}`,textAlign:"center"}}>
          <div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}>ราคาต่อกรัม</div>
          <div style={{fontSize:24,fontWeight:900,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{form.buy_price&&form.convert_to_gram?ppg(+form.buy_price,+form.convert_to_gram).toFixed(4):"0.0000"}<span style={{fontSize:12,fontWeight:500,color:C.ink3,marginLeft:4}}>/ กรัม</span></div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><Inp label="สต็อกปัจจุบัน" type="number" value={form.stock} onChange={e=>upd("stock",e.target.value)} placeholder="0"/></div>
      <TA label="หมายเหตุ" rows={2} value={form.note} onChange={e=>upd("note",e.target.value)} placeholder="หมายเหตุ..."/>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:8,borderTop:`1px solid ${C.line}`}}>
        <Btn v="ghost" onClick={()=>setOpen(false)}>ยกเลิก</Btn>
        <Btn onClick={save} icon={I.check} disabled={!form.name||!form.buy_price} loading={saving}>{editId?"บันทึก":"เพิ่มวัตถุดิบ"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── MENU TAB ──────────────────────────────────────────
// ══════════════════════════════════════════════════════
function MenuTab({menus,reload,ings,menuCats,currentUser,currentBranch,addH,printers=[],branches=[],allCats=[],reloadCats}){
  const[q,setQ]=useState("");const[open,setOpen]=useState(false);const[editId,setEditId]=useState(null);const[saving,setSaving]=useState(false);const[showImportMenu,setShowImportMenu]=useState(false);
  const[selCat,setSelCat]=useState("ทั้งหมด");
  const[editingCatId,setEditingCatId]=useState(null);const[editingCatName,setEditingCatName]=useState("");
  const[newCatName,setNewCatName]=useState("");const[addingCat,setAddingCat]=useState(false);
  const[form,setForm]=useState({name:"",category:"",price:"",description:"",image:null,ingredients:[],sop:[]});
  const[ingQ,setIngQ]=useState("");const[ni,setNi]=useState({ingredientId:"",amountGram:""});
  const isCentral=currentBranch?.type==="central";
  const canE=hasPerm(currentUser,"menus")&&isCentral;const canD=hasPerm(currentUser,"menus")&&isCentral;
  const localCats=useMemo(()=>allCats.filter(c=>c.type==="menu"&&(isCentral?!c.branch_id:c.branch_id===currentBranch?.id)),[allCats,isCentral,currentBranch]);
  async function toggleAvailability(menu,status){
    const avail={...(menu.availability||{})};
    if(avail[currentBranch.id]===status)delete avail[currentBranch.id];
    else avail[currentBranch.id]=status;
    try{await api.updateMenu(menu.id,{availability:avail});await reload();}catch(e){alert("บันทึกไม่สำเร็จ");}
  }
  async function toggleVBMenu(menu,branchId){const nonCB=branches.filter(b=>b.type!=="central");let vb=[...(menu.visible_branches||[])];if(vb.length===0){vb=nonCB.map(b=>b.id).filter(id=>id!==branchId);}else{const idx=vb.indexOf(branchId);if(idx===-1)vb.push(branchId);else vb.splice(idx,1);if(vb.length===nonCB.length)vb=[];}try{await api.updateMenu(menu.id,{visible_branches:vb});await reload();}catch{alert("บันทึกไม่สำเร็จ");}}
  async function assignLocalCat(menuId,catName){const menu=menus.find(m=>m.id===menuId);const lc={...(menu.local_categories||{})};if(catName)lc[currentBranch.id]=catName;else delete lc[currentBranch.id];try{await api.updateMenu(menuId,{local_categories:lc});await reload();}catch{alert("บันทึกไม่สำเร็จ");}}
  async function addCat(){if(!newCatName.trim())return;try{await api.addCat({type:"menu",name:newCatName.trim(),branch_id:isCentral?null:currentBranch?.id});await reloadCats();setNewCatName("");setAddingCat(false);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}}
  async function saveCatRename(){if(!editingCatName.trim()||!editingCatId)return;try{await api.updateCat(editingCatId,{name:editingCatName.trim()});await reloadCats();setEditingCatId(null);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}}
  async function delCat(cat){if(!await confirmDlg({title:"ลบหมวดหมู่",message:`ต้องการลบหมวด "${cat.name}" ใช่หรือไม่?`}))return;try{await api.deleteCat(cat.id);await reloadCats();if(selCat===cat.name)setSelCat("ทั้งหมด");}catch(e){alert("ลบไม่สำเร็จ: "+e.message);}}
  const filtered=useMemo(()=>menus.filter(m=>{
    const vb=m.visible_branches||[];
    const matchB=isCentral||vb.length===0||vb.includes(currentBranch?.id);
    if(!matchB||!m.name.toLowerCase().includes(q.toLowerCase()))return false;
    if(selCat==="ทั้งหมด")return true;
    if(isCentral)return m.category===selCat;
    return (m.local_categories||{})[currentBranch?.id]===selCat;
  }),[menus,q,isCentral,currentBranch,selCat]);
  const filteredIngs=useMemo(()=>ings.filter(i=>i.name.toLowerCase().includes(ingQ.toLowerCase())),[ings,ingQ]);
  const fc=(form.ingredients||[]).reduce((s,x)=>{const i=ings.find(g=>g.id===x.ingredientId);return s+(i?i.price_per_gram*x.amountGram:0);},0);
  const fm=form.price>0?((+form.price-fc)/+form.price*100):0;
  async function save(){if(!form.name||!form.price)return;setSaving(true);try{const item={name:form.name,category:form.category||selCat||"",price:+form.price,description:form.description,image:form.image,ingredients:form.ingredients,sop:form.sop||[],edit_by:currentUser.username,edit_at:nowStr(),branch_id:currentBranch.id};if(editId){await api.updateMenu(editId,item);addH(`แก้ไขเมนู: ${form.name}`);}else{await api.addMenu(item);addH(`เพิ่มเมนู: ${form.name}`);}await reload();setOpen(false);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}setSaving(false);}
  async function del(id,name){if(!await confirmDlg({title:"ลบเมนู",message:`ต้องการลบเมนู "${name}" ใช่หรือไม่?`}))return;try{await api.deleteMenu(id);addH(`ลบเมนู: ${name}`);await reload();}catch(e){alert("ลบไม่สำเร็จ");}}
  const catTabBtn=(label,active,onClick)=><button onClick={onClick} style={{padding:"6px 14px",borderRadius:20,border:`1.5px solid ${active?C.brand:C.line}`,background:active?C.brandLight:"transparent",color:active?C.brand:C.ink3,cursor:"pointer",fontSize:13,fontWeight:700,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>{label}</button>;
  return <div>
    {!isCentral&&<div style={{background:"#FFF7ED",border:"1px solid #FED7AA",borderRadius:12,padding:"12px 16px",marginBottom:16,display:"flex",alignItems:"center",gap:10}}><Ic d={I.warning} s={16} c="#F59E0B"/><span style={{fontSize:13,color:"#92400E",fontFamily:"'Sarabun',sans-serif"}}>เมนูจัดการโดยครัวกลางเท่านั้น • สาขานี้กำหนดหมวดหมู่และสถานะสินค้าได้</span></div>}
    <div style={{display:"flex",gap:6,marginBottom:14,flexWrap:"wrap",alignItems:"center",padding:"10px 14px",background:C.bg,borderRadius:14,border:`1px solid ${C.line}`}}>
      {catTabBtn("ทั้งหมด",selCat==="ทั้งหมด",()=>setSelCat("ทั้งหมด"))}
      {localCats.map(cat=>editingCatId===cat.id
        ?<input key={cat.id} value={editingCatName} onChange={e=>setEditingCatName(e.target.value)} onBlur={saveCatRename} onKeyDown={e=>{if(e.key==="Enter")saveCatRename();if(e.key==="Escape")setEditingCatId(null);}} autoFocus style={{...iS,width:110,padding:"5px 10px",fontSize:13,borderRadius:20,border:`1.5px solid ${C.brand}`}}/>
        :<div key={cat.id} style={{display:"flex",alignItems:"center"}}>
          {catTabBtn(cat.name,selCat===cat.name,()=>setSelCat(cat.name))}
          <button onClick={()=>{setEditingCatId(cat.id);setEditingCatName(cat.name);}} style={{marginLeft:2,background:"none",border:"none",cursor:"pointer",padding:3,display:"flex"}}><Ic d={I.pencil} s={11} c={C.ink4}/></button>
          <button onClick={()=>delCat(cat)} style={{background:"none",border:"none",cursor:"pointer",padding:3,display:"flex"}}><Ic d={I.trash} s={11} c={C.red}/></button>
        </div>
      )}
      {addingCat
        ?<div style={{display:"flex",gap:4,alignItems:"center"}}>
          <input value={newCatName} onChange={e=>setNewCatName(e.target.value)} onKeyDown={e=>{if(e.key==="Enter")addCat();if(e.key==="Escape"){setAddingCat(false);setNewCatName("");}}} autoFocus placeholder="ชื่อหมวดหมู่..." style={{...iS,width:120,padding:"5px 10px",fontSize:13,borderRadius:20,border:`1.5px solid ${C.brand}`}}/>
          <Btn v="success" onClick={addCat} s={{padding:"5px 12px",fontSize:12}}>ตกลง</Btn>
          <Btn v="ghost" onClick={()=>{setAddingCat(false);setNewCatName("");}} s={{padding:"5px 10px",fontSize:12}}>ยกเลิก</Btn>
        </div>
        :<button onClick={()=>setAddingCat(true)} style={{padding:"6px 12px",borderRadius:20,border:`1.5px dashed ${C.line}`,background:"transparent",color:C.ink4,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:4}}><Ic d={I.plus} s={11} c={C.ink4}/>เพิ่มหมวด</button>
      }
    </div>
    <div style={{display:"flex",gap:10,marginBottom:20}}>
      <div style={{position:"relative",flex:1}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.search} s={16} c={C.ink4}/></span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="ค้นหาเมนู..." style={{...iS,paddingLeft:40}}/></div>
      {canE&&selCat!=="ทั้งหมด"&&<Btn onClick={()=>{setForm({name:"",category:selCat,price:"",description:"",image:null,ingredients:[],sop:[]});setEditId(null);setIngQ("");setOpen(true);}} icon={I.plus}>เพิ่มเมนู</Btn>}
      {canE&&<Btn v="info" onClick={()=>setShowImportMenu(true)} icon={I.ul}>Import</Btn>}
    </div>
    {canE&&selCat==="ทั้งหมด"&&<div style={{background:"#EFF6FF",border:"1px solid #BFDBFE",borderRadius:10,padding:"10px 16px",marginBottom:16,fontSize:13,color:"#1E40AF",fontFamily:"'Sarabun',sans-serif"}}>เลือกหมวดหมู่ก่อน จึงจะเพิ่มเมนูใหม่ได้</div>}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(300px,1fr))",gap:16}}>
      {filtered.map(menu=>{const cost=menuCost(menu,ings);const profit=menu.price-cost;const mg=menu.price>0?profit/menu.price*100:0;const mc=marginColor(mg);return <Card key={menu.id} hover style={{overflow:"hidden"}}>
        <div style={{height:5,background:`linear-gradient(90deg,${mc},${mc}66)`}}/>
        {menu.image?<img src={menu.image} alt={menu.name} style={{width:"100%",height:130,objectFit:"cover"}}/>:<div style={{height:80,background:`linear-gradient(135deg,${C.brandLight},#FEF9C3)`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.fire} s={36} c={C.brand}/></div>}
        <div style={{padding:"12px 16px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:8}}>
            <div><div style={{fontWeight:800,fontSize:16,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}>{menu.name}</div><Chip color="blue">{menu.category}</Chip></div>
            <div style={{display:"flex",gap:4}}>
              {canE&&<button onClick={async()=>{try{const newPos=menu.quick_key_pos!=null?null:(menus.reduce((m,x)=>Math.max(m,x.quick_key_pos||0),0)+1);await api.updateMenu(menu.id,{quick_key_pos:newPos});await reload();}catch{alert("บันทึกไม่สำเร็จ");}}} title={menu.quick_key_pos!=null?"ยกเลิกปักหมุด":"ปักหมุดเป็น Quick Key"} style={{background:menu.quick_key_pos!=null?"#FEF3C7":C.lineLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><span style={{fontSize:13}}>{menu.quick_key_pos!=null?"⭐":"☆"}</span></button>}
              {canE&&<button onClick={()=>{setForm({name:menu.name,category:menu.category,price:menu.price,description:menu.description||"",image:menu.image,ingredients:menu.ingredients||[],sop:menu.sop||[]});setEditId(menu.id);setIngQ("");setOpen(true);}} style={{background:C.blueLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c={C.blue}/></button>}
              {canD&&<button onClick={()=>del(menu.id,menu.name)} style={{background:C.redLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>}
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8}}>
            {[{l:"ราคาขาย",v:`฿${menu.price}`,c:C.ink},{l:"ต้นทุน",v:`฿${cost.toFixed(1)}`,c:C.brand},{l:"กำไร %",v:`${mg.toFixed(0)}%`,c:mc}].map(s=><div key={s.l} style={{background:C.bg,borderRadius:10,padding:8,textAlign:"center"}}><div style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{s.l}</div><div style={{fontSize:14,fontWeight:800,color:s.c,fontFamily:"'Sarabun',sans-serif"}}>{s.v}</div></div>)}
          </div>
          <div style={{marginTop:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}><Chip color={mg>=60?"green":mg>=40?"yellow":"red"}>{marginLabel(mg)}</Chip><EditedBy username={menu.edit_by} editAt={menu.edit_at}/></div>
          {!isCentral&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.lineLight}`}}>
            <div style={{fontSize:10,color:C.ink4,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>จัดเข้าหมวดหมู่:</div>
            <select value={(menu.local_categories||{})[currentBranch?.id]||""} onChange={e=>assignLocalCat(menu.id,e.target.value)} style={{...iS,fontSize:12,padding:"4px 8px",height:28,width:"100%"}}>
              <option value="">— ยังไม่กำหนดหมวด —</option>
              {localCats.map(c=><option key={c.id} value={c.name}>{c.name}</option>)}
            </select>
          </div>}
          {canE&&printers.length>0&&<div style={{marginTop:8,paddingTop:8,borderTop:`1px solid ${C.lineLight}`}}>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <Ic d={I.print} s={12} c={C.ink4}/>
              <select value={menu.printer_id||""} onChange={async e=>{try{await api.updateMenu(menu.id,{printer_id:e.target.value?+e.target.value:null});await reload();}catch{alert("บันทึกไม่สำเร็จ");}}} style={{...iS,flex:1,padding:"4px 8px",fontSize:11,height:28}}>
                <option value="">— ไม่ระบุ printer —</option>
                {printers.map(p=><option key={p.id} value={p.id}>{p.name} ({p.ip})</option>)}
              </select>
            </div>
          </div>}
          <div style={{marginTop:10,display:"flex",gap:6,paddingTop:10,borderTop:`1px solid ${C.lineLight}`}}>
            {(()=>{const avail=(menu.availability||{})[currentBranch.id];const isSoldOut=avail==="sold_out";const isHidden=avail==="hidden";return(<>
              <button onClick={()=>toggleAvailability(menu,"sold_out")} style={{flex:1,padding:"6px 8px",borderRadius:8,border:`1.5px solid ${isSoldOut?"#F59E0B":"#E2E8F0"}`,background:isSoldOut?"#FEF3C7":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:isSoldOut?"#92400E":"#94A3B8",fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                <span style={{fontSize:13}}>{isSoldOut?"🟡":"⬜"}</span>วันนี้ของหมด
              </button>
              <button onClick={()=>toggleAvailability(menu,"hidden")} style={{flex:1,padding:"6px 8px",borderRadius:8,border:`1.5px solid ${isHidden?"#EF4444":"#E2E8F0"}`,background:isHidden?"#FEE2E2":"transparent",cursor:"pointer",fontSize:11,fontWeight:700,color:isHidden?"#991B1B":"#94A3B8",fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",justifyContent:"center",gap:4}}>
                <span style={{fontSize:13}}>{isHidden?"🔴":"⬜"}</span>งดขายชั่วคราว
              </button>
            </>);})()}
          </div>
          {isCentral&&<div style={{marginTop:6,padding:"8px 0 2px",borderTop:`1px solid ${C.lineLight}`}}>
            <div style={{fontSize:10,color:C.ink4,marginBottom:4,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:4}}><Ic d={I.branch} s={10} c={C.ink4}/>แสดงที่สาขา:</div>
            <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
              {branches.filter(b=>b.type!=="central").length===0?<span style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีสาขา</span>
              :branches.filter(b=>b.type!=="central").map(b=>{const vb=menu.visible_branches||[];const isOn=vb.length===0||vb.includes(b.id);return <button key={b.id} onClick={()=>toggleVBMenu(menu,b.id)} style={{padding:"2px 8px",borderRadius:6,fontSize:10,fontWeight:700,border:`1px solid ${isOn?C.green:C.line}`,background:isOn?C.greenLight:"transparent",color:isOn?C.green:C.ink4,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}}>{isOn?"✓ ":""}{b.name}</button>;})}
            </div>
          </div>}
        </div>
      </Card>;})}
    </div>
    {showImportMenu&&<ImportMenuModal onClose={()=>setShowImportMenu(false)} menuCats={menuCats} currentUser={currentUser} currentBranch={currentBranch} onDone={async()=>{await reload();setShowImportMenu(false);}}/>}
    {open&&<Modal title={editId?"✏️ แก้ไขเมนู":"➕ เพิ่มเมนูใหม่"} onClose={()=>setOpen(false)} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:24}}>
        <div>
          <ImgUp label="รูปเมนู" value={form.image} onChange={v=>setForm(f=>({...f,image:v}))}/>
          <Inp label="ชื่อเมนู" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} placeholder="เช่น ข้าวผัดไก่" autoFocus/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            <Field label="หมวดหมู่"><select value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))} style={{...iS,appearance:"none"}}>{localCats.map(c=><option key={c.id}>{c.name}</option>)}</select></Field>
            <Inp label="ราคาขาย (฿)" type="number" value={form.price} onChange={e=>setForm(f=>({...f,price:e.target.value}))} placeholder="0"/>
          </div>
          <TA label="รายละเอียดเมนู" rows={3} value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="อธิบายเมนูสั้นๆ"/>
        </div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:10}}>วัตถุดิบ</div>
          <div style={{maxHeight:140,overflowY:"auto",marginBottom:10}}>
            {(form.ingredients||[]).map((mi,idx)=>{const ing=ings.find(i=>i.id===mi.ingredientId);const c=ing?ing.price_per_gram*mi.amountGram:0;return <div key={idx} style={{display:"flex",alignItems:"center",gap:8,marginBottom:6,background:C.bg,borderRadius:9,padding:"8px 10px",border:`1px solid ${C.line}`}}><span style={{flex:1,fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>{ing?.name??"?"}</span><span style={{fontSize:12,color:C.brand,fontWeight:700}}>{mi.amountGram}g</span><span style={{fontSize:11,color:C.ink3}}>฿{c.toFixed(2)}</span><button onClick={()=>setForm(f=>({...f,ingredients:f.ingredients.filter((_,i)=>i!==idx)}))} style={{background:"none",border:"none",cursor:"pointer",display:"flex"}}><Ic d={I.x} s={13} c={C.red}/></button></div>;})}
          </div>
          <div style={{background:C.bg,borderRadius:12,padding:"12px",marginBottom:10,border:`1px solid ${C.line}`}}>
            <div style={{position:"relative",marginBottom:8}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.search} s={13} c={C.ink4}/></span><input value={ingQ} onChange={e=>setIngQ(e.target.value)} placeholder="ค้นหาวัตถุดิบ..." style={{...iS,paddingLeft:32,fontSize:13,padding:"8px 12px 8px 32px"}}/></div>
            <div style={{maxHeight:120,overflowY:"auto"}}>
              {filteredIngs.map(ing=>{const already=(form.ingredients||[]).find(x=>x.ingredientId===ing.id);return <div key={ing.id} onClick={()=>{if(!already)setNi(n=>({...n,ingredientId:String(ing.id)}));}} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 10px",borderRadius:8,marginBottom:3,background:already?C.greenLight:ni.ingredientId===String(ing.id)?C.brandLight:C.white,border:`1px solid ${already?C.green:ni.ingredientId===String(ing.id)?C.brandBorder:C.line}`,cursor:already?"default":"pointer"}}>
                <span style={{flex:1,fontSize:13,fontWeight:600,fontFamily:"'Sarabun',sans-serif"}}>{ing.name}</span>
                <span style={{fontSize:10,color:C.teal}}>{ing.supplier_name||""}</span>
                <span style={{fontSize:11,color:C.brand}}>฿{(+ing.price_per_gram).toFixed(3)}/g</span>
                {already&&<Chip color="green">✓</Chip>}
              </div>;})}
            </div>
          </div>
          <div style={{display:"flex",gap:6,marginBottom:10}}>
            <div style={{flex:2}}><select value={ni.ingredientId} onChange={e=>setNi({...ni,ingredientId:e.target.value})} style={{...iS,fontSize:13}}><option value="">-- ยืนยันวัตถุดิบ --</option>{ings.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></div>
            <div style={{flex:1}}><input type="number" value={ni.amountGram} onChange={e=>setNi({...ni,amountGram:e.target.value})} onKeyDown={e=>{if(e.key==="Enter"&&ni.ingredientId&&ni.amountGram){setForm(f=>({...f,ingredients:[...f.ingredients,{ingredientId:+ni.ingredientId,amountGram:+ni.amountGram}]}));setNi({ingredientId:"",amountGram:""});}}} placeholder="กรัม" style={{...iS,fontSize:13}}/></div>
            <Btn v="ghost" onClick={()=>{if(!ni.ingredientId||!ni.amountGram)return;setForm(f=>({...f,ingredients:[...f.ingredients,{ingredientId:+ni.ingredientId,amountGram:+ni.amountGram}]}));setNi({ingredientId:"",amountGram:""});}} icon={I.plus} s={{padding:"10px 12px"}}>เพิ่ม</Btn>
          </div>
          {(form.ingredients||[]).length>0&&<div style={{background:C.brandLight,borderRadius:12,padding:"12px",border:`1px solid ${C.brandBorder}`}}>
            <div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>ต้นทุนรวม</span><span style={{fontSize:18,fontWeight:900,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{fc.toFixed(2)}</span></div>
            {form.price>0&&<div style={{display:"flex",justifyContent:"space-between"}}><span style={{fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>กำไร</span><span style={{fontSize:13,fontWeight:700,color:marginColor(fm)}}>฿{(+form.price-fc).toFixed(2)} ({fm.toFixed(1)}%)</span></div>}
          </div>}
        </div>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:16,borderTop:`1px solid ${C.line}`,marginTop:8}}>
        <Btn v="ghost" onClick={()=>setOpen(false)}>ยกเลิก</Btn>
        <Btn onClick={save} icon={I.check} disabled={!form.name||!form.price} loading={saving}>{editId?"บันทึก":"เพิ่มเมนู"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── SOP TAB ───────────────────────────────────────────
// ══════════════════════════════════════════════════════
// Compute food cost % (cost / price * 100). Lower is better.
// Returns null if price<=0 (can't compute meaningful %).
function foodCostPct(menu,ings){
  const price=+menu?.price||0;
  if(price<=0)return null;
  const cost=menuCost(menu,ings);
  return Math.round(cost/price*100);
}
// Cost % buckets (Thai restaurant industry standard)
const COST_BUCKETS=[
  {id:"low",    label:"🟢 ต้นทุนต่ำ",    short:"≤30%",  range:[0,30],    color:"#10B981", bg:"#D1FAE5"},
  {id:"normal", label:"🟡 ปกติ",         short:"31-40%",range:[31,40],   color:"#F59E0B", bg:"#FEF3C7"},
  {id:"high",   label:"🟠 สูง",          short:"41-50%",range:[41,50],   color:"#EA580C", bg:"#FFEDD5"},
  {id:"crit",   label:"🔴 วิกฤต",        short:">50%",  range:[51,9999], color:"#EF4444", bg:"#FEE2E2"},
];
function SOPTab({menus,reload,ings,currentUser,currentBranch}){
  const isCentral=currentBranch?.type==="central";
  const visibleMenus=useMemo(()=>menus.filter(m=>{const vb=m.visible_branches||[];return isCentral||vb.length===0||vb.includes(currentBranch?.id);}),[menus,isCentral,currentBranch]);
  const[sel,setSel]=useState(visibleMenus[0]?.id??null);const[edit,setEdit]=useState(false);const[sop,setSop]=useState([]);const[saving,setSaving]=useState(false);const[ingQ,setIngQ]=useState("");const[menuQ,setMenuQ]=useState("");
  const[editIngs,setEditIngs]=useState([]);
  const[ingPopup,setIngPopup]=useState(null);
  const[newUnit,setNewUnit]=useState("");
  const[customUnits,setCustomUnits]=useState(()=>{try{return JSON.parse(localStorage.getItem("fc_custom_units")||"[]");}catch{return[];}});
  const allUnits=useMemo(()=>["กรัม","มล.","ชิ้น","ช้อนโต๊ะ","ช้อนชา","ถ้วย","กก.","ลิตร",...customUnits],[customUnits]);
  // Filters: SOP presence + (when "has SOP") cost % bucket
  const[sopStatus,setSopStatus]=useState("all");  // all | has | none
  const[costBucket,setCostBucket]=useState("all");  // all | low | normal | high | crit
  // Pre-compute "has SOP" + cost % once per menus list
  const menuMeta=useMemo(()=>{
    const m=new Map();
    visibleMenus.forEach(x=>m.set(x.id,{hasSOP:Array.isArray(x.sop)&&x.sop.length>0,costPct:foodCostPct(x,ings)}));
    return m;
  },[visibleMenus,ings]);
  const counts=useMemo(()=>{
    const all=visibleMenus.length;
    const hasArr=visibleMenus.filter(x=>menuMeta.get(x.id)?.hasSOP);
    const noneArr=visibleMenus.filter(x=>!menuMeta.get(x.id)?.hasSOP);
    const buckets={};
    COST_BUCKETS.forEach(b=>{buckets[b.id]=hasArr.filter(x=>{const p=menuMeta.get(x.id)?.costPct;return p!=null&&p>=b.range[0]&&p<=b.range[1];}).length;});
    return{all,has:hasArr.length,none:noneArr.length,buckets};
  },[visibleMenus,menuMeta]);
  const filteredMenus=useMemo(()=>{
    let out=visibleMenus;
    if(sopStatus==="has")out=out.filter(m=>menuMeta.get(m.id)?.hasSOP);
    else if(sopStatus==="none")out=out.filter(m=>!menuMeta.get(m.id)?.hasSOP);
    if(sopStatus==="has"&&costBucket!=="all"){
      const b=COST_BUCKETS.find(x=>x.id===costBucket);
      if(b)out=out.filter(m=>{const p=menuMeta.get(m.id)?.costPct;return p!=null&&p>=b.range[0]&&p<=b.range[1];});
    }
    if(menuQ.trim())out=out.filter(m=>m.name.toLowerCase().includes(menuQ.toLowerCase()));
    return out;
  },[visibleMenus,menuMeta,sopStatus,costBucket,menuQ]);
  const menu=useMemo(()=>visibleMenus.find(m=>m.id===sel),[visibleMenus,sel]);
  const canE=hasPerm(currentUser,"sop")&&isCentral;
  useEffect(()=>{if(menu){setSop(menu.sop?[...menu.sop.map(s=>({...s}))]:[]); setEditIngs(menu.ingredients?[...menu.ingredients]:[]); setEdit(false);}}, [sel]);
  async function saveSop(){setSaving(true);try{await api.updateMenu(sel,{sop,ingredients:editIngs,edit_by:currentUser.username,edit_at:nowStr()});await reload();setEdit(false);}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}setSaving(false);}
  const filteredIngs=useMemo(()=>ings.filter(i=>i.name.toLowerCase().includes(ingQ.toLowerCase())),[ings,ingQ]);
  function pickIng(ing){setIngPopup({ing,amount:"",unit:"กรัม"});}
  function confirmIngPick(){
    if(!ingPopup||!String(ingPopup.amount).trim())return;
    const amt=parseFloat(ingPopup.amount);
    if(isNaN(amt)||amt<=0)return;
    setEditIngs(f=>{const idx=f.findIndex(x=>x.ingredientId===ingPopup.ing.id);return idx>=0?f.map((x,i)=>i===idx?{...x,amountGram:amt,unit:ingPopup.unit||"กรัม"}:x):[...f,{ingredientId:ingPopup.ing.id,amountGram:amt,unit:ingPopup.unit||"กรัม"}];});
    setIngPopup(null);
  }
  function addCustomUnit(){
    if(!newUnit.trim())return;
    const u=newUnit.trim();
    const next=customUnits.includes(u)?customUnits:[...customUnits,u];
    setCustomUnits(next);localStorage.setItem("fc_custom_units",JSON.stringify(next));
    setIngPopup(p=>({...p,unit:u}));setNewUnit("");
  }
  function printSOP(){
    if(!menu)return;
    const ingChips=(menu.ingredients||[]).map(mi=>{const ing=ings.find(i=>i.id===mi.ingredientId);return ing?`<span class="ic"><b>${ing.name}</b>&nbsp;${mi.amountGram}&nbsp;${mi.unit||'กรัม'}</span>`:''}).join('');
    const hasAnyImg=(menu.sop||[]).some(s=>s.image);
    const steps=(menu.sop||[]).map((s,idx)=>`
      <div class="step${s.image?' has-img':''}">
        <div class="num">${idx+1}</div>
        <div class="sbody">
          <div class="stext">
            ${s.title?`<div class="stitle">${s.title}</div>`:''}
            ${s.desc?`<div class="sdesc">${s.desc.replace(/\n/g,'<br/>')}</div>`:''}
          </div>
          ${s.image?`<img src="${s.image}" class="simg"/>`:''}
        </div>
      </div>`).join('');
    const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>SOP - ${menu.name}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;700;800;900&display=swap');
@page{size:A4 portrait;margin:10mm 12mm}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:'Sarabun',sans-serif;color:#0F172A;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact}
#wrap{width:100%}
.header{padding-bottom:10px;border-bottom:3px solid #FF6B35;margin-bottom:12px;display:flex;gap:14px;align-items:center}
.hmain{flex:1}
.hlabel{font-size:9px;font-weight:800;color:#FF6B35;letter-spacing:1.5px;text-transform:uppercase;margin-bottom:4px}
.htitle{font-size:26px;font-weight:900;color:#0F172A;line-height:1.15}
.himg{width:90px;height:90px;object-fit:cover;border-radius:12px;border:2px solid #E2E8F0;flex-shrink:0}
.sec-label{font-size:9px;font-weight:800;color:#94A3B8;letter-spacing:1.2px;text-transform:uppercase;margin-bottom:6px}
.ings{display:flex;flex-wrap:wrap;gap:5px;margin-bottom:12px}
.ic{background:#F8FAFC;border:1px solid #E2E8F0;border-radius:6px;padding:3px 9px;font-size:11px;color:#334155}
.ic b{color:#0F172A}
.steps{display:flex;flex-direction:column;gap:10px}
.step{display:flex;gap:12px;align-items:flex-start}
.num{width:30px;height:30px;border-radius:50%;background:linear-gradient(135deg,#FF6B35,#E85520);color:#fff;font-size:14px;font-weight:900;display:flex;align-items:center;justify-content:center;flex-shrink:0;margin-top:1px}
.sbody{flex:1;background:#F8FAFC;border-radius:10px;padding:10px 14px;border:1px solid #E2E8F0}
.step.has-img .sbody{display:flex;gap:12px;align-items:flex-start}
.stext{flex:1;min-width:0}
.stitle{font-size:14px;font-weight:900;color:#0F172A;margin-bottom:4px}
.sdesc{font-size:12px;color:#334155;line-height:1.65;white-space:pre-wrap}
.simg{width:220px;min-width:220px;max-width:220px;height:160px;object-fit:cover;border-radius:9px;border:2px solid #E2E8F0;display:block;flex-shrink:0}
.step:not(.has-img) .simg{width:100%;max-width:100%;height:auto;max-height:260px;min-width:unset}
.footer{margin-top:12px;padding-top:8px;border-top:1px solid #E2E8F0;display:flex;justify-content:space-between;font-size:9px;color:#94A3B8}
</style></head><body>
<div id="wrap">
  <div class="header">
    ${menu.image?`<img src="${menu.image}" class="himg" crossorigin="anonymous"/>`:''}
    <div class="hmain">
      <div class="hlabel">ขั้นตอนการทำ · Standard Operating Procedure</div>
      <div class="htitle">${menu.name}</div>
    </div>
  </div>
  ${ingChips?`<div class="sec-label">วัตถุดิบที่ใช้</div><div class="ings">${ingChips}</div>`:''}
  <div class="sec-label">ขั้นตอนการทำ &nbsp;(${(menu.sop||[]).length} ขั้นตอน)</div>
  <div class="steps">${steps}</div>
  <div class="footer"><span>NAIWANSOOK · ห้องครัว</span><span>พิมพ์วันที่ ${new Date().toLocaleDateString('th-TH',{year:'numeric',month:'long',day:'numeric'})}</span></div>
</div>
<script>
async function waitImgs(){
  const imgs=[...document.images];
  await Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=img.onerror=r;})));
}
window.addEventListener('load',async()=>{
  await waitImgs();
  await new Promise(r=>setTimeout(r,100));
  const A4H=(297-20)*3.7795;
  const w=document.getElementById('wrap');
  const h=w.offsetHeight;
  if(h>A4H){document.body.style.zoom=(A4H/h).toFixed(4);}
  setTimeout(()=>window.print(),300);
});
</script></body></html>`;
    const win=window.open('','_blank','width=800,height=700');
    win.document.write(html);win.document.close();
  }
  return <><div style={{display:"grid",gridTemplateColumns:"240px 1fr",gap:16,minHeight:520}}>
    <div style={{background:C.white,borderRadius:16,border:`1px solid ${C.line}`,overflow:"hidden"}}>
      <div style={{padding:"12px 14px 10px",borderBottom:`1px solid ${C.lineLight}`,background:C.bg}}>
        <div style={{fontSize:11,fontWeight:800,color:C.ink4,letterSpacing:1.2,textTransform:"uppercase",fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>รายการเมนู ({counts.all})</div>
        <div style={{position:"relative",marginBottom:8}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.search} s={13} c={C.ink4}/></span><input value={menuQ} onChange={e=>setMenuQ(e.target.value)} placeholder="ค้นหาเมนู..." style={{...iS,paddingLeft:32,fontSize:13,padding:"7px 10px 7px 32px",width:"100%",boxSizing:"border-box"}}/></div>
        {/* SOP status filter */}
        <div style={{display:"flex",gap:4,marginBottom:sopStatus==="has"?6:0}}>
          {[
            {v:"all",l:`ทั้งหมด (${counts.all})`,c:C.ink2},
            {v:"has",l:`มี SOP (${counts.has})`,c:C.green},
            {v:"none",l:`ยังไม่มี (${counts.none})`,c:C.red},
          ].map(o=>{const sel2=sopStatus===o.v;return <button key={o.v} onClick={()=>{setSopStatus(o.v);if(o.v!=="has")setCostBucket("all");}} style={{flex:1,padding:"5px 4px",borderRadius:7,border:`1.5px solid ${sel2?o.c:C.line}`,background:sel2?`${o.c}15`:C.white,color:sel2?o.c:C.ink3,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:11}}>{o.l}</button>;})}
        </div>
        {/* Cost % bucket — only when "มี SOP" */}
        {sopStatus==="has"&&<div>
          <div style={{fontSize:9,fontWeight:700,color:C.ink4,letterSpacing:.8,textTransform:"uppercase",fontFamily:"'Sarabun',sans-serif",marginTop:6,marginBottom:4}}>กรอง % ต้นทุน</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:3}}>
            <button onClick={()=>setCostBucket("all")} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${costBucket==="all"?C.brand:C.line}`,background:costBucket==="all"?C.brandLight:C.white,color:costBucket==="all"?C.brand:C.ink3,cursor:"pointer",fontSize:10,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ทุกช่วง</button>
            {COST_BUCKETS.map(b=>{const sel2=costBucket===b.id;const n=counts.buckets[b.id]||0;return <button key={b.id} onClick={()=>setCostBucket(b.id)} disabled={n===0} title={`${b.label} (${b.short})`} style={{padding:"3px 8px",borderRadius:6,border:`1px solid ${sel2?b.color:C.line}`,background:sel2?b.bg:C.white,color:sel2?b.color:(n===0?C.ink4:C.ink2),cursor:n===0?"not-allowed":"pointer",fontSize:10,fontWeight:700,fontFamily:"'Sarabun',sans-serif",opacity:n===0?.5:1}}>{b.short} ({n})</button>;})}
          </div>
        </div>}
      </div>
      <div style={{padding:8,overflowY:"auto",maxHeight:520}}>
        {filteredMenus.length===0&&<div style={{padding:"20px 12px",textAlign:"center",color:C.ink4,fontSize:13,fontFamily:"'Sarabun',sans-serif"}}>ไม่พบเมนูในเงื่อนไขนี้</div>}
        {filteredMenus.map(m=>{
          const meta=menuMeta.get(m.id);const cost=menuCost(m,ings);const mg=m.price>0?((m.price-cost)/m.price*100):0;
          const cp=meta?.costPct;
          const cb=cp!=null?COST_BUCKETS.find(b=>cp>=b.range[0]&&cp<=b.range[1]):null;
          const active=sel===m.id;
          return <div key={m.id} onClick={()=>setSel(m.id)} style={{padding:"10px 12px",borderRadius:10,cursor:"pointer",marginBottom:4,background:active?C.brandLight:"transparent",border:`1px solid ${active?C.brandBorder:"transparent"}`,transition:"all .15s"}}>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,fontWeight:active?800:500,color:active?C.brand:C.ink2,marginBottom:3,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{m.name}</div>
            <div style={{display:"flex",gap:5,flexWrap:"wrap",alignItems:"center"}}>
              {meta?.hasSOP
                ?<span style={{fontSize:10,fontWeight:700,color:C.green,background:C.greenLight,padding:"1px 6px",borderRadius:6}}>✓ SOP {(m.sop||[]).length}</span>
                :<span style={{fontSize:10,fontWeight:700,color:C.red,background:C.redLight,padding:"1px 6px",borderRadius:6}}>ยังไม่มี SOP</span>}
              {cp!=null&&cb&&<span title={`ต้นทุน ${cp}% · ${cb.label}`} style={{fontSize:10,fontWeight:700,color:cb.color,background:cb.bg,padding:"1px 6px",borderRadius:6}}>ต้นทุน {cp}%</span>}
              <span style={{fontSize:10,color:marginColor(mg),fontWeight:700}}>กำไร {mg.toFixed(0)}%</span>
            </div>
          </div>;
        })}
      </div>
    </div>
    <Card style={{padding:"20px 24px",overflow:"auto"}}>
      {menu?<>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,paddingBottom:14,borderBottom:`1px solid ${C.lineLight}`}}>
          <div style={{display:"flex",gap:12,alignItems:"center"}}>
            {menu.image&&<img src={menu.image} alt={menu.name} style={{width:52,height:52,objectFit:"cover",borderRadius:10,border:`2px solid ${C.line}`}}/>}
            <div><h2 style={{fontFamily:"'Sarabun',sans-serif",fontSize:20,fontWeight:900,color:C.ink,marginBottom:3}}>{menu.name}</h2><EditedBy username={menu.edit_by} editAt={menu.edit_at}/></div>
          </div>
          <div style={{display:"flex",gap:8}}>
            {!edit&&<Btn v="ghost" onClick={printSOP} icon={I.print} s={{padding:"8px 14px"}}>พิมพ์</Btn>}
            {canE&&<>{edit?<><Btn v="ghost" onClick={()=>{setSop(menu.sop?[...menu.sop]:[]); setEdit(false);}} s={{padding:"8px 14px"}}>ยกเลิก</Btn><Btn v="success" onClick={saveSop} icon={I.check} loading={saving} s={{padding:"8px 14px"}}>บันทึก SOP</Btn></>
            :<Btn v="info" onClick={()=>setEdit(true)} icon={I.pencil} s={{padding:"8px 14px"}}>แก้ไข SOP</Btn>}</>}
          </div>
        </div>
        {edit&&<div style={{marginBottom:14}}>
          <div style={{fontSize:12,fontWeight:700,color:C.ink3,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ค้นหาวัตถุดิบ</div>
          <div style={{position:"relative",marginBottom:8}}><span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.search} s={13} c={C.ink4}/></span><input value={ingQ} onChange={e=>setIngQ(e.target.value)} placeholder="ค้นหาวัตถุดิบ..." style={{...iS,paddingLeft:32,fontSize:13,padding:"8px 12px 8px 32px"}}/></div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,maxHeight:90,overflowY:"auto",background:C.bg,borderRadius:10,padding:8,border:`1px solid ${C.line}`}}>
            {filteredIngs.map(ing=>{const already=editIngs.some(x=>x.ingredientId===ing.id);return <span key={ing.id} onClick={()=>pickIng(ing)} style={{background:already?C.brandLight:C.white,border:`1px solid ${already?C.brandBorder:C.line}`,borderRadius:8,padding:"4px 10px",fontSize:12,fontFamily:"'Sarabun',sans-serif",color:already?C.brand:C.ink2,cursor:"pointer",transition:"all .15s",userSelect:"none"}}>{ing.name}{already&&<span style={{color:C.green,marginLeft:3}}>✓</span>}<span style={{color:C.teal,marginLeft:4,fontSize:10}}>{ing.supplier_name||""}</span></span>;})}
            {filteredIngs.length===0&&<div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif",padding:4}}>ไม่พบวัตถุดิบ</div>}
          </div>
        </div>}
        <div style={{marginBottom:18}}>
          <div style={{fontSize:12,fontWeight:700,color:C.ink3,textTransform:"uppercase",letterSpacing:1,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>วัตถุดิบในเมนู</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:8}}>
            {(edit?editIngs:menu.ingredients||[]).map((mi,idx)=>{const ing=ings.find(i=>i.id===mi.ingredientId);return ing?<div key={idx} style={{background:C.bg,borderRadius:8,padding:"5px 10px 5px 12px",fontSize:13,fontFamily:"'Sarabun',sans-serif",border:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:6}}>
              <span style={{fontWeight:700,color:C.ink}}>{ing.name}</span>
              <span style={{color:C.brand,fontWeight:700}}>{mi.amountGram} {mi.unit||"กรัม"}</span>
              {edit&&<button onClick={()=>setEditIngs(f=>f.filter((_,i)=>i!==idx))} style={{background:"none",border:"none",cursor:"pointer",padding:"0 2px",display:"flex",lineHeight:1}}><Ic d={I.x} s={12} c={C.red}/></button>}
            </div>:null;})}
            {edit&&editIngs.length===0&&<div style={{fontSize:13,color:C.ink4,fontFamily:"'Sarabun',sans-serif",padding:"8px 12px",background:C.bg,borderRadius:8,border:`1px dashed ${C.line}`}}>กดเลือกวัตถุดิบจากรายการด้านบน</div>}
          </div>
        </div>
        <div style={{fontSize:12,fontWeight:700,color:C.ink3,textTransform:"uppercase",letterSpacing:1,fontFamily:"'Sarabun',sans-serif",marginBottom:12}}>ขั้นตอนการทำ (SOP)</div>
        {edit?<div>
          {sop.map((step,idx)=><div key={idx} style={{background:C.bg,borderRadius:14,padding:"16px 18px",marginBottom:12,border:`1px solid ${C.line}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <div style={{width:30,height:30,borderRadius:"50%",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800}}>{idx+1}</div>
              <button onClick={()=>setSop(f=>f.filter((_,j)=>j!==idx))} style={{background:C.redLight,border:"none",borderRadius:8,padding:"4px 10px",cursor:"pointer",color:C.red,fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600,display:"flex",alignItems:"center",gap:4}}><Ic d={I.trash} s={12} c={C.red}/>ลบ</button>
            </div>
            <Inp label="ชื่อขั้นตอน" value={step.title} onChange={e=>setSop(f=>f.map((s,j)=>j===idx?{...s,title:e.target.value}:s))} placeholder="เช่น เตรียมวัตถุดิบ"/>
            <TA label="รายละเอียด" hint="อธิบายให้ละเอียด" rows={5} value={step.desc} onChange={e=>setSop(f=>f.map((s,j)=>j===idx?{...s,desc:e.target.value}:s))} placeholder="อธิบายวิธีทำ..."/>
            <ImgUp label="รูปประกอบ" value={step.image} onChange={v=>setSop(f=>f.map((s,j)=>j===idx?{...s,image:v}:s))}/>
          </div>)}
          <Btn v="ghost" onClick={()=>setSop(f=>[...f,{step:f.length+1,title:"",desc:"",image:null}])} icon={I.plus} full>+ เพิ่มขั้นตอน</Btn>
        </div>:<div>
          {(!menu.sop||menu.sop.length===0)?<div style={{textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.sop} s={44} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>ยังไม่มี SOP</p></div>
          :menu.sop.map((step,idx)=><div key={idx} style={{display:"flex",gap:14,marginBottom:24}}>
            <div style={{display:"flex",flexDirection:"column",alignItems:"center",flexShrink:0,width:34}}>
              <div style={{width:34,height:34,borderRadius:"50%",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,fontWeight:800,boxShadow:`0 4px 12px ${C.brand}44`}}>{idx+1}</div>
              {idx<menu.sop.length-1&&<div style={{width:2,flex:1,minHeight:20,background:`linear-gradient(to bottom,${C.brand},${C.brand}22)`,marginTop:5}}/>}
            </div>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:5}}>{step.title||`ขั้นตอนที่ ${idx+1}`}</div>
              {step.desc&&<p style={{fontSize:14,color:C.ink2,fontFamily:"'Sarabun',sans-serif",lineHeight:1.8,background:C.bg,padding:"10px 14px",borderRadius:10,border:`1px solid ${C.line}`,marginBottom:step.image?10:0,whiteSpace:"pre-wrap"}}>{step.desc}</p>}
              {step.image&&<img src={step.image} alt={step.title} style={{maxWidth:340,borderRadius:12,border:`2px solid ${C.line}`,marginTop:8,display:"block"}}/>}
            </div>
          </div>)}
        </div>}
      </>:<div style={{textAlign:"center",padding:"100px 0",color:C.ink4}}><Ic d={I.sop} s={52} c={C.line}/><p style={{marginTop:16,fontFamily:"'Sarabun',sans-serif",fontSize:16}}>เลือกเมนูเพื่อดู SOP</p></div>}
    </Card>
  </div>
  {ingPopup&&<div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.65)",backdropFilter:"blur(8px)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:1500,padding:16}} onClick={e=>e.target===e.currentTarget&&setIngPopup(null)}>
    <div style={{background:C.white,borderRadius:22,width:"100%",maxWidth:420,boxShadow:"0 40px 100px rgba(15,23,42,.28)",animation:"mIn .22s cubic-bezier(.34,1.56,.64,1)",overflow:"hidden"}}>
      <div style={{padding:"20px 24px 0",borderBottom:`1px solid ${C.lineLight}`,paddingBottom:16,background:C.bg,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:40,height:40,borderRadius:"50%",background:C.brandLight,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,border:`1px solid ${C.brandBorder}`}}>
          <Ic d={I.leaf} s={20} c={C.brand}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>เพิ่มวัตถุดิบ</div>
          <div style={{fontSize:17,fontWeight:800,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{ingPopup.ing.name}</div>
        </div>
      </div>
      <div style={{padding:"18px 24px"}}>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:16}}>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:C.ink3,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>จำนวน</div>
            <input autoFocus type="number" min="0" step="any" value={ingPopup.amount} onChange={e=>setIngPopup(p=>({...p,amount:e.target.value}))} onKeyDown={e=>e.key==="Enter"&&confirmIngPick()} placeholder="0" style={{...iS,fontSize:16,fontWeight:700,textAlign:"center"}}/>
          </div>
          <div>
            <div style={{fontSize:12,fontWeight:700,color:C.ink3,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>หน่วย</div>
            <div style={{position:"relative"}}>
              <select value={ingPopup.unit} onChange={e=>setIngPopup(p=>({...p,unit:e.target.value}))} style={{...iS,cursor:"pointer",appearance:"none",paddingRight:36}}>
                {allUnits.map(u=><option key={u} value={u}>{u}</option>)}
              </select>
              <span style={{position:"absolute",right:12,top:"50%",transform:"translateY(-50%)",pointerEvents:"none"}}><Ic d={I.chevD} s={16} c={C.ink3}/></span>
            </div>
          </div>
        </div>
        <div style={{background:C.bg,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.line}`,marginBottom:16}}>
          <div style={{fontSize:11,fontWeight:700,color:C.ink4,marginBottom:8,fontFamily:"'Sarabun',sans-serif",letterSpacing:.5}}>+ เพิ่มหน่วยใหม่</div>
          <div style={{display:"flex",gap:8}}>
            <input value={newUnit} onChange={e=>setNewUnit(e.target.value)} onKeyDown={e=>{if(e.key==="Enter"){e.preventDefault();addCustomUnit();}}} placeholder="ชื่อหน่วย เช่น ฝา, แพ็ค..." style={{...iS,fontSize:13,padding:"7px 12px",flex:1}}/>
            <button onClick={addCustomUnit} style={{background:`linear-gradient(135deg,${C.teal},#0F766E)`,color:C.white,border:"none",borderRadius:10,padding:"7px 16px",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,whiteSpace:"nowrap"}}>เพิ่ม</button>
          </div>
        </div>
        <div style={{display:"flex",gap:10}}>
          <button onClick={()=>setIngPopup(null)} style={{flex:1,padding:"11px 16px",borderRadius:12,border:`1.5px solid ${C.line}`,background:C.white,color:C.ink2,fontSize:14,fontWeight:700,cursor:"pointer",fontFamily:"'Sarabun',sans-serif"}} onMouseEnter={e=>e.currentTarget.style.background=C.lineLight} onMouseLeave={e=>e.currentTarget.style.background=C.white}>ยกเลิก</button>
          <button onClick={confirmIngPick} disabled={!ingPopup.amount||parseFloat(ingPopup.amount)<=0} style={{flex:1,padding:"11px 16px",borderRadius:12,border:"none",background:!ingPopup.amount||parseFloat(ingPopup.amount)<=0?"#E2E8F0":`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:!ingPopup.amount||parseFloat(ingPopup.amount)<=0?C.ink4:C.white,fontSize:14,fontWeight:800,cursor:!ingPopup.amount||parseFloat(ingPopup.amount)<=0?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",boxShadow:!ingPopup.amount||parseFloat(ingPopup.amount)<=0?"none":`0 6px 16px ${C.brand}55`,transition:"all .15s"}}>ยืนยัน</button>
        </div>
      </div>
    </div>
  </div>}
  </>;
}

// ══════════════════════════════════════════════════════
// ── PURCHASE ORDERS (PO) ──────────────────────────────
// ══════════════════════════════════════════════════════
function genPONumber(branchId){
  const d=new Date();
  const ym=`${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}`;
  const seq=Math.random().toString(36).slice(2,7).toUpperCase();
  // Include branch prefix so two branches creating POs in the same second don't collide
  const bp=branchId?`B${branchId}-`:"";
  return `PO-${ym}-${bp}${seq}`;
}
function buildPOHTML(po,toBranchName,fromBranchName){
  const fmt=(v)=>(+v||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
  const rows=(po.items||[]).map((it,i)=>`<tr>
    <td style="text-align:center;padding:6px 8px;border:1px solid #ddd">${i+1}</td>
    <td style="padding:6px 10px;border:1px solid #ddd">${esc(it.name)}${it.note?`<br/><span style="font-size:11px;color:#888">★ ${esc(it.note)}</span>`:""}</td>
    <td style="text-align:center;padding:6px 8px;border:1px solid #ddd">${esc(it.unit||"-")}</td>
    <td style="text-align:right;padding:6px 8px;border:1px solid #ddd">${fmt(it.qty)}</td>
    <td style="text-align:right;padding:6px 8px;border:1px solid #ddd">${fmt(it.price_per_unit)}</td>
    <td style="text-align:right;padding:6px 8px;border:1px solid #ddd;font-weight:700">฿${fmt(it.line_total)}</td>
  </tr>`).join("");
  const stLabel=po.status==='received'?'✅ รับสินค้าแล้ว':po.status==='cancelled'?'❌ ยกเลิก':po.status==='paid'?'✅ ชำระแล้ว':po.status==='disputed'?'⚠️ ส่งกลับ':po.status==='awaiting_payment'?'💰 รอชำระเงิน':'⏳ เปิดอยู่';
  return `<div id="po-doc" style="font-family:'Sarabun',sans-serif;padding:32px;color:#0F172A;font-size:13px;line-height:1.5;max-width:780px;margin:0 auto;background:#fff">
<div style="display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #FF6B35;padding-bottom:14px;margin-bottom:18px">
  <div>
    <h1 style="margin:0;font-size:28px;color:#FF6B35;letter-spacing:1px">📄 ใบสั่งซื้อ (Purchase Order)</h1>
    <div style="margin-top:6px;font-size:13px;color:#475569">${esc(fromBranchName||"-")} <span style="color:#FF6B35;font-weight:700">→</span> ${esc(toBranchName||"-")}</div>
  </div>
  <div style="text-align:right">
    <div style="font-size:18px;font-weight:900;color:#0F172A">${esc(po.po_number||"-")}</div>
    <div style="font-size:13px;color:#475569;margin-top:4px">วันที่ ${esc(po.po_date||"-")}</div>
    <div style="font-size:11px;color:#94A3B8;margin-top:4px">สถานะ: ${stLabel}</div>
  </div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px;font-size:13px">
  <div><b style="color:#475569;font-weight:600">จาก (ผู้ออก):</b> ${esc(fromBranchName||"-")}</div>
  <div><b style="color:#475569;font-weight:600">ถึง (ผู้รับ):</b> ${esc(toBranchName||"-")}</div>
  ${po.received_at?`<div><b style="color:#475569;font-weight:600">รับเมื่อ:</b> ${esc(new Date(po.received_at).toLocaleString("th-TH",{calendar:"gregory"}))}${po.received_by?` โดย ${esc(po.received_by)}`:""}</div>`:""}
  ${po.notes?`<div style="grid-column:1/3"><b style="color:#475569;font-weight:600">หมายเหตุ:</b> ${esc(po.notes)}</div>`:""}
</div>
<table style="width:100%;border-collapse:collapse;margin:14px 0">
  <thead><tr>
    <th style="background:#0F172A;color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:center;width:40px">#</th>
    <th style="background:#0F172A;color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:left">รายการ</th>
    <th style="background:#0F172A;color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:center;width:60px">หน่วย</th>
    <th style="background:#0F172A;color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:center;width:80px">จำนวน</th>
    <th style="background:#0F172A;color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:right;width:90px">ราคา/หน่วย</th>
    <th style="background:#0F172A;color:#fff;padding:8px;font-weight:700;font-size:12px;text-align:right;width:110px">รวม</th>
  </tr></thead>
  <tbody>
    ${rows||`<tr><td colspan="6" style="text-align:center;padding:20px;color:#94A3B8">— ไม่มีรายการ —</td></tr>`}
    ${po.subtotal?`<tr><td colspan="5" style="text-align:right;padding:8px 12px;border:1px solid #ddd;font-weight:600">ยอดรวม</td><td style="text-align:right;padding:8px;border:1px solid #ddd;font-weight:700">฿${fmt(po.subtotal)}</td></tr>`:""}
    ${po.vat>0?`<tr><td colspan="5" style="text-align:right;padding:8px 12px;border:1px solid #ddd;font-weight:600">VAT</td><td style="text-align:right;padding:8px;border:1px solid #ddd;font-weight:700">฿${fmt(po.vat)}</td></tr>`:""}
    <tr style="font-size:15px;font-weight:900;background:#FFF4F0;color:#FF6B35"><td colspan="5" style="text-align:right;padding:10px 12px;border:1px solid #ddd">ยอดรวมทั้งสิ้น</td><td style="text-align:right;padding:10px;border:1px solid #ddd">฿${fmt(po.total)}</td></tr>
  </tbody>
</table>
<div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:30px;font-size:12px">
  <div><div style="border-top:1px dashed #94A3B8;padding-top:8px;text-align:center;margin-top:50px;color:#64748B">ผู้สั่งซื้อ / วันที่</div></div>
  <div><div style="border-top:1px dashed #94A3B8;padding-top:8px;text-align:center;margin-top:50px;color:#64748B">ผู้รับ-ตรวจสินค้า / วันที่</div></div>
</div>
</div>`;
}
function printPO(po,toBranchName,action='print',fromBranchName){
  const w=openPrintWindow(860,950);
  if(!w)return;
  const filename=(po.po_number||`PO-${po.id}`).replace(/[^\w\-]/g,"_")+".pdf";
  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${po.po_number||"PO"}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700;900&display=swap" rel="stylesheet">
<script src="https://cdn.jsdelivr.net/npm/html2pdf.js@0.10.2/dist/html2pdf.bundle.min.js"><\/script>
<style>
  body{font-family:'Sarabun',sans-serif;margin:0;background:#F1F5F9}
  .toolbar{position:sticky;top:0;background:#0F172A;color:#fff;padding:10px 16px;display:flex;justify-content:space-between;align-items:center;z-index:10;box-shadow:0 4px 12px rgba(0,0,0,.18)}
  .tools{display:flex;gap:8px}
  .tools button{background:#FF6B35;color:#fff;border:none;border-radius:8px;padding:7px 16px;cursor:pointer;font-family:'Sarabun',sans-serif;font-weight:700;font-size:13px;display:flex;align-items:center;gap:6px}
  .tools button.alt{background:#3B82F6}
  .tools button.ghost{background:rgba(255,255,255,.12)}
  .tools button:hover{opacity:.85}
  @media print{.toolbar{display:none}body{background:#fff}@page{size:A4;margin:14mm}}
</style>
</head><body>
<div class="toolbar">
  <div style="font-weight:800;font-size:14px">📄 ${esc(po.po_number||"PO")} — ${esc(fromBranchName||"-")} → ${esc(toBranchName||"-")}</div>
  <div class="tools">
    <button onclick="window.print()">🖨 พิมพ์</button>
    <button class="alt" onclick="savePDF()" id="pdfBtn">💾 ดาวน์โหลด PDF</button>
    <button class="ghost" onclick="window.close()">✕ ปิด</button>
  </div>
</div>
${buildPOHTML(po,toBranchName,fromBranchName)}
<script>
function savePDF(){
  var btn=document.getElementById('pdfBtn');
  if(typeof html2pdf==='undefined'){btn.textContent='⏳ กำลังโหลด...';setTimeout(savePDF,300);return;}
  btn.textContent='⏳ กำลังสร้าง PDF...';btn.disabled=true;
  html2pdf().set({margin:[8,8,8,8],filename:'${filename}',image:{type:'jpeg',quality:.98},html2canvas:{scale:2,useCORS:true,backgroundColor:'#ffffff'},jsPDF:{unit:'mm',format:'a4',orientation:'portrait'}}).from(document.getElementById('po-doc')).save().then(function(){btn.textContent='💾 ดาวน์โหลด PDF';btn.disabled=false;}).catch(function(e){alert('สร้าง PDF ไม่สำเร็จ: '+e.message);btn.textContent='💾 ดาวน์โหลด PDF';btn.disabled=false;});
}
${action==='print'?"setTimeout(function(){window.print();},400);":""}
${action==='pdf'?"window.addEventListener('load',function(){setTimeout(savePDF,400);});":""}
<\/script>
</body></html>`;
  w.document.write(html);w.document.close();
}

// Export PO list to Excel
function exportPOsToExcel(pos,branchById){
  if(!pos||pos.length===0){alert("ไม่มีข้อมูลให้ Export");return;}
  const stL={open:"เปิดอยู่",received:"รับแล้ว",cancelled:"ยกเลิก"};
  const summary=pos.map(po=>({
    "เลข PO":po.po_number||"",
    "วันที่":po.po_date||"",
    "จาก":branchById[po.from_branch_id]?.name||"",
    "ถึง":branchById[po.branch_id]?.name||"",
    "สถานะ":stL[po.status]||po.status||"",
    "จำนวนรายการ":(po.items||[]).length,
    "ยอดก่อน VAT":+po.subtotal||0,
    "VAT":+po.vat||0,
    "ยอดสุทธิ":+po.total||0,
    "ผู้สร้าง":po.created_by||"",
    "ผู้รับ":po.received_by||"",
    "วันที่รับ":po.received_at?new Date(po.received_at).toLocaleString("th-TH"):"",
    "หมายเหตุ":po.notes||"",
  }));
  const details=[];
  pos.forEach(po=>{
    (po.items||[]).forEach((it,idx)=>{
      details.push({
        "เลข PO":po.po_number||"",
        "วันที่":po.po_date||"",
        "จาก":branchById[po.from_branch_id]?.name||"",
        "ถึง":branchById[po.branch_id]?.name||"",
        "ลำดับ":idx+1,
        "รายการ":it.name,
        "หน่วย":it.unit||"",
        "จำนวน":+it.qty||0,
        "ราคา/หน่วย":+it.price_per_unit||0,
        "รวม":+it.line_total||0,
        "หมายเหตุ":it.note||"",
      });
    });
  });
  const wb=XLSX.utils.book_new();
  const ws1=XLSX.utils.json_to_sheet(summary);
  const ws2=XLSX.utils.json_to_sheet(details);
  ws1["!cols"]=[{wch:18},{wch:12},{wch:18},{wch:18},{wch:12},{wch:8},{wch:14},{wch:10},{wch:14},{wch:14},{wch:14},{wch:18},{wch:30}];
  ws2["!cols"]=[{wch:18},{wch:12},{wch:18},{wch:18},{wch:6},{wch:24},{wch:10},{wch:10},{wch:14},{wch:14},{wch:24}];
  XLSX.utils.book_append_sheet(wb,ws1,"สรุป PO");
  XLSX.utils.book_append_sheet(wb,ws2,"รายการรายบรรทัด");
  XLSX.writeFile(wb,`PO_Export_${todayBkk()}.xlsx`);
}

// ══════════════════════════════════════════════════════
// ── FOODSTORY SALES IMPORT ───────────────────────────
// ══════════════════════════════════════════════════════
function FSImportModal({branches,currentUser,onClose,onDone}){
  const[step,setStep]=useState("pick");  // pick | preview
  const[parsed,setParsed]=useState(null);  // {rows, branchHint}
  const today=todayBkk();
  const yest=(()=>{const t=new Date();t.setDate(t.getDate()-1);return t.toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});})();
  const[saleDate,setSaleDate]=useState(yest);
  const[branchId,setBranchId]=useState("");
  const[busy,setBusy]=useState(false);
  const fileRef=useRef();

  async function onPickFile(f){
    if(!f)return;
    if(!/\.xlsx?$/i.test(f.name)){alert("กรุณาเลือกไฟล์ .xlsx เท่านั้น");return;}
    try{
      const buf=await f.arrayBuffer();
      const wb=XLSX.read(buf,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const data=XLSX.utils.sheet_to_json(ws,{header:1,defval:''});
      // Find header row by matching key Thai column names
      const headerRowIdx=data.findIndex(r=>Array.isArray(r)&&(r.includes("ชื่อสินค้า")||r.includes("จำนวนการขาย")));
      if(headerRowIdx===-1){alert("ไม่พบหัวคอลัมน์ในไฟล์ — ตรวจสอบรูปแบบ FoodStory");return;}
      const headers=data[headerRowIdx].map(h=>String(h||"").trim());
      const idx=(label)=>headers.indexOf(label);
      const ix={name:idx("ชื่อสินค้า"),qty:idx("จำนวนการขาย"),cat:idx("หมวดสินค้า"),price:idx("ราคาขายเฉลี่ย"),net:idx("ราคาสุทธิ"),branch:idx("สาขา")};
      if(ix.name<0||ix.qty<0){alert("ไม่พบคอลัมน์ \"ชื่อสินค้า\" หรือ \"จำนวนการขาย\"");return;}
      const rows=data.slice(headerRowIdx+1).filter(r=>r&&r[ix.name]).map(r=>({
        menu_name:String(r[ix.name]||"").trim(),
        category:ix.cat>=0?String(r[ix.cat]||"").trim()||null:null,
        qty:+r[ix.qty]||0,
        price_avg:ix.price>=0?round2(+r[ix.price]||0):0,
        net_total:ix.net>=0?round2(+r[ix.net]||0):0,
        branch_name_raw:ix.branch>=0?String(r[ix.branch]||"").trim():"",
      })).filter(r=>r.menu_name&&r.qty>0);
      if(rows.length===0){alert("ไม่พบรายการที่มีจำนวนการขายในไฟล์");return;}
      // Auto-match branch by name substring
      const firstRaw=rows.find(r=>r.branch_name_raw)?.branch_name_raw||"";
      const hint=branches.find(b=>b.active!==false&&firstRaw&&(firstRaw.includes(b.name)||b.name.includes(firstRaw)));
      setParsed({rows,branchHint:hint,fileName:f.name,headers});
      if(hint)setBranchId(String(hint.id));
      setStep("preview");
    }catch(e){showErr("อ่านไฟล์ไม่สำเร็จ",e);}
  }

  async function save(){
    if(!branchId){alert("กรุณาเลือกสาขา");return;}
    if(!saleDate){alert("กรุณาเลือกวันที่");return;}
    setBusy(true);
    try{
      // Replace any previous import for this (branch, date) — clean re-import
      await api.deleteExternalSalesBy(branchId,saleDate);
      const payload=parsed.rows.map(r=>({
        source:'foodstory',
        branch_id:+branchId,
        branch_name_raw:r.branch_name_raw||null,
        sale_date:saleDate,
        menu_name:r.menu_name,
        category:r.category,
        qty:r.qty,
        price_avg:r.price_avg||null,
        net_total:r.net_total||null,
        imported_by:currentUser?.username||null,
      }));
      // Batch in chunks of 200 to keep PostgREST happy
      for(let i=0;i<payload.length;i+=200){
        await api.addExternalSalesBatch(payload.slice(i,i+200));
      }
      alert(`✅ นำเข้าสำเร็จ ${payload.length} รายการ`);
      onDone();
    }catch(e){showErr("นำเข้าไม่สำเร็จ",e);}
    setBusy(false);
  }

  const totalQty=parsed?parsed.rows.reduce((s,r)=>s+(+r.qty||0),0):0;
  const totalNet=parsed?round2(parsed.rows.reduce((s,r)=>s+(+r.net_total||0),0)):0;

  return <Modal title="📊 นำเข้ายอดขายจาก FoodStory" onClose={onClose} extraWide>
    {step==="pick"&&<div>
      <div style={{background:C.blueLight,borderRadius:12,padding:"14px 18px",marginBottom:16,fontSize:13,color:C.blue,fontFamily:"'Sarabun',sans-serif",lineHeight:1.7}}>
        <div style={{fontWeight:800,marginBottom:6}}>📋 วิธี Export จาก FoodStory:</div>
        <div>1. เข้า FoodStory Dashboard → <b>รายงาน</b> → <b>ยอดขายตามสินค้า</b></div>
        <div>2. เลือก <b>วันที่</b> ที่ต้องการ (1 วัน เพื่อให้นำเข้ารายวันได้)</div>
        <div>3. กด Export → ดาวน์โหลดไฟล์ .xlsx</div>
        <div>4. กลับมาที่หน้านี้ → กดเลือกไฟล์ด้านล่าง</div>
      </div>
      <label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"40px 20px",border:`2.5px dashed ${C.brandBorder}`,borderRadius:14,cursor:"pointer",background:C.bg,textAlign:"center"}}>
        <div style={{fontSize:48,marginBottom:8}}>📁</div>
        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.brand,marginBottom:4}}>กดเพื่อเลือกไฟล์ .xlsx</div>
        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.ink4}}>หรือลากวางไฟล์มาที่นี่</div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" onChange={e=>onPickFile(e.target.files?.[0])} style={{display:"none"}}/>
      </label>
    </div>}
    {step==="preview"&&parsed&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:14}}>
        <div style={{background:C.bg,borderRadius:10,padding:"10px 14px",border:`1px solid ${C.line}`}}>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:700,marginBottom:3}}>📁 ไฟล์</div>
          <div style={{fontSize:13,color:C.ink,fontFamily:"'Sarabun',sans-serif",fontWeight:700,wordBreak:"break-all"}}>{parsed.fileName}</div>
        </div>
        <div style={{background:C.bg,borderRadius:10,padding:"10px 14px",border:`1px solid ${C.line}`}}>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:700,marginBottom:3}}>📊 รายการ</div>
          <div style={{fontSize:13,color:C.brand,fontFamily:"'Sarabun',sans-serif",fontWeight:800}}>{parsed.rows.length} เมนู · ขาย {totalQty} ครั้ง · ฿{totalNet.toLocaleString(undefined,{minimumFractionDigits:2})}</div>
        </div>
        <div style={{background:parsed.branchHint?C.greenLight:"#FEF3C7",borderRadius:10,padding:"10px 14px",border:`1px solid ${parsed.branchHint?C.green:"#FDE68A"}`}}>
          <div style={{fontSize:11,color:parsed.branchHint?C.green:"#92400E",fontFamily:"'Sarabun',sans-serif",fontWeight:700,marginBottom:3}}>🏢 สาขาในไฟล์</div>
          <div style={{fontSize:12,color:parsed.branchHint?C.green:"#92400E",fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>{parsed.rows[0]?.branch_name_raw||"—"}{parsed.branchHint?` ✅ จับคู่ ${parsed.branchHint.name}`:" ⚠️ เลือกสาขาเอง"}</div>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:14}}>
        <Field label="📅 วันที่ของยอดนี้ *">
          <input type="date" value={saleDate} onChange={e=>setSaleDate(e.target.value)} style={{...iS,fontSize:14,fontWeight:700}}/>
        </Field>
        <Field label="🏢 สาขา *">
          <select value={branchId} onChange={e=>setBranchId(e.target.value)} style={{...iS,appearance:"none",fontSize:14}}>
            <option value="">— เลือกสาขา —</option>
            {branches.filter(b=>b.active!==false).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </Field>
      </div>
      <div style={{background:"#FFFBEB",border:`1px solid #FDE68A`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400E",fontFamily:"'Sarabun',sans-serif",lineHeight:1.6}}>
        ⚠️ <b>หมายเหตุ:</b> ถ้าสาขานี้ในวันที่ <b>{saleDate}</b> เคยนำเข้าแล้ว ข้อมูลเดิมจะถูก<b>แทนที่ทั้งหมด</b> ก่อนใส่ใหม่
      </div>
      <div style={{maxHeight:320,overflowY:"auto",border:`1px solid ${C.line}`,borderRadius:10,marginBottom:14}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
          <thead style={{position:"sticky",top:0,background:"#0F172A",zIndex:1}}>
            <tr>{["#","เมนู","หมวด","จำนวน","ราคาเฉลี่ย","ยอดสุทธิ"].map((h,i)=><th key={h} style={{padding:"9px 10px",textAlign:i>=3?"right":"left",fontSize:11,fontWeight:700,color:"#F8FAFC"}}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {parsed.rows.slice(0,200).map((r,i)=><tr key={i} style={{borderTop:`1px solid ${C.lineLight}`,background:i%2===0?C.white:"#FAFBFC"}}>
              <td style={{padding:"7px 10px",fontSize:11,color:C.ink4,fontWeight:700}}>{i+1}</td>
              <td style={{padding:"7px 10px",fontSize:13,fontWeight:600,color:C.ink}}>{r.menu_name}</td>
              <td style={{padding:"7px 10px",fontSize:11,color:C.ink3}}>{r.category||"—"}</td>
              <td style={{padding:"7px 10px",fontSize:13,textAlign:"right",fontWeight:800,color:C.brand}}>{r.qty}</td>
              <td style={{padding:"7px 10px",fontSize:12,textAlign:"right",color:C.ink3}}>฿{(+r.price_avg||0).toFixed(2)}</td>
              <td style={{padding:"7px 10px",fontSize:13,textAlign:"right",fontWeight:700,color:C.ink}}>฿{(+r.net_total||0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
            </tr>)}
            {parsed.rows.length>200&&<tr><td colSpan={6} style={{padding:10,textAlign:"center",fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>+ อีก {parsed.rows.length-200} แถว (จะนำเข้าทั้งหมด)</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
        <Btn v="ghost" onClick={()=>{setStep("pick");setParsed(null);}}>← เลือกไฟล์ใหม่</Btn>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={onClose}>ยกเลิก</Btn>
          <Btn onClick={save} loading={busy} disabled={!branchId||!saleDate||busy} icon={I.check}>นำเข้า {parsed.rows.length} รายการ</Btn>
        </div>
      </div>
    </div>}
  </Modal>;
}

// Build a cost snapshot from current external_sales for (branchId, date) using current menus/ings.
// Returns the saved row (PostgREST representation). Throws on error.
async function generateCostSnapshot({branchId,date,menus,ings,currentUser}){
  const data=await api.getExternalSales({branchId,dateFrom:date,dateTo:date});
  const rows=(data||[]).filter(r=>+r.branch_id===+branchId&&r.sale_date===date);
  // Build a normalized name lookup
  const norm=(s)=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
  const byName=new Map();
  menus.forEach(m=>{const k=norm(m.name);if(k&&!byName.has(k))byName.set(k,m);});
  const items=rows.map(r=>{
    const m=byName.get(norm(r.menu_name));
    const cu=m?round2(menuCost(m,ings)):0;
    const qty=+r.qty||0;
    const cost=round2(cu*qty);
    const revenue=round2(+r.net_total||0);
    return{menu_name:r.menu_name,category:r.category||null,qty,revenue,cost,profit:round2(revenue-cost),matched:!!m,price_avg:+r.price_avg||0};
  });
  const total_revenue=round2(items.reduce((s,i)=>s+i.revenue,0));
  const total_cost=round2(items.reduce((s,i)=>s+i.cost,0));
  const cost_pct=total_revenue>0?round2(total_cost/total_revenue*100):0;
  const total_qty=round2(items.reduce((s,i)=>s+i.qty,0));
  return await api.upsertCostSnapshot({
    branch_id:+branchId,
    snapshot_date:date,
    source:"foodstory",
    total_revenue,total_cost,cost_pct,
    menu_count:items.length,total_qty,items,
    created_by:currentUser?.username||null,
  });
}
// Export a single saved snapshot's items as a 1-sheet Excel file
function exportSnapshotXlsx(snapshot,branchName){
  const items=Array.isArray(snapshot.items)?snapshot.items:[];
  const rows=items.map((it,i)=>{
    const rev=+it.revenue||0,cost=+it.cost||0;
    return{
      "ลำดับ":i+1,
      "เมนู":it.menu_name||"",
      "หมวด":it.category||"",
      "จับคู่ระบบ":it.matched?"✅":"❌",
      "จำนวนที่ขาย":+it.qty||0,
      "ยอดขาย":rev,
      "ต้นทุน":cost,
      "กำไร":+it.profit||round2(rev-cost),
      "% ต้นทุน":rev>0?round2(cost/rev*100):0,
    };
  });
  // Append summary row
  rows.push({"ลำดับ":"","เมนู":"รวมทั้งหมด","หมวด":"","จับคู่ระบบ":"","จำนวนที่ขาย":+snapshot.total_qty||0,"ยอดขาย":+snapshot.total_revenue||0,"ต้นทุน":+snapshot.total_cost||0,"กำไร":round2((+snapshot.total_revenue||0)-(+snapshot.total_cost||0)),"% ต้นทุน":+snapshot.cost_pct||0});
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(rows);
  ws["!cols"]=[{wch:6},{wch:30},{wch:18},{wch:9},{wch:12},{wch:14},{wch:14},{wch:14},{wch:10}];
  XLSX.utils.book_append_sheet(wb,ws,"สรุปต้นทุนรายเมนู");
  XLSX.writeFile(wb,`CostSnapshot_${snapshot.snapshot_date}_${(branchName||"branch").replace(/\s+/g,"_")}.xlsx`);
}

function FSSalesTab({branches,currentBranch,currentUser,menus=[],ings=[],reloadMenus,reloadCats}){
  const isCentral=currentBranch?.type==="central";
  const today=todayBkk();
  const ago=(d=>{const t=new Date();t.setDate(t.getDate()-d);return t.toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});})(7);
  const[rows,setRows]=useState([]);
  const[loading,setLoading]=useState(false);
  const[filterBranch,setFilterBranch]=useState(isCentral?"":String(currentBranch.id));
  const[dateFrom,setDateFrom]=useState(ago);
  const[dateTo,setDateTo]=useState(today);
  const[viewMode,setViewMode]=useState("pivot");
  const[showImport,setShowImport]=useState(false);
  const[search,setSearch]=useState("");
  const[showCost,setShowCost]=useState(true);
  const canImport=hasPerm(currentUser,"fs_sales");

  // Build menu lookup by normalized name (trim + lowercase, also strip parenthesized tails)
  const menusByName=useMemo(()=>{
    const m=new Map();
    const norm=(s)=>String(s||"").trim().toLowerCase().replace(/\s+/g," ");
    menus.forEach(mn=>{
      const k=norm(mn.name);
      if(k&&!m.has(k))m.set(k,mn);
    });
    return m;
  },[menus]);
  function findMenu(saleName){
    const k=String(saleName||"").trim().toLowerCase().replace(/\s+/g," ");
    if(!k)return null;
    return menusByName.get(k)||null;
  }

  async function load(){
    setLoading(true);
    try{
      const filters={dateFrom,dateTo};
      if(filterBranch)filters.branchId=+filterBranch;
      else if(!isCentral&&currentBranch)filters.branchId=currentBranch.id;
      const data=await api.getExternalSales(filters);
      setRows(data);
    }catch(e){showErr("โหลดข้อมูลไม่สำเร็จ",e);}
    setLoading(false);
  }
  useEffect(()=>{load();},[filterBranch,dateFrom,dateTo,currentBranch?.id]);

  const filtered=useMemo(()=>{
    const q=search.trim().toLowerCase();
    return q?rows.filter(r=>r.menu_name.toLowerCase().includes(q)||(r.category||"").toLowerCase().includes(q)):rows;
  },[rows,search]);
  const dates=useMemo(()=>[...new Set(filtered.map(r=>r.sale_date))].sort(),[filtered]);
  // Pivot rows + cost calculation
  const pivot=useMemo(()=>{
    const m=new Map();
    filtered.forEach(r=>{
      let row=m.get(r.menu_name);
      if(!row){
        const matched=findMenu(r.menu_name);
        const costPerUnit=matched?round2(menuCost(matched,ings)):null;
        row={menu_name:r.menu_name,category:r.category||"",cells:new Map(),totalQty:0,totalNet:0,matched,costPerUnit};
        m.set(r.menu_name,row);
      }
      row.cells.set(r.sale_date,(row.cells.get(r.sale_date)||0)+(+r.qty||0));
      row.totalQty+=+r.qty||0;
      row.totalNet+=+r.net_total||0;
    });
    // Compute cost/profit/margin per row
    const out=[...m.values()].map(row=>{
      const totalCost=row.costPerUnit!=null?round2(row.costPerUnit*row.totalQty):null;
      const profit=totalCost!=null?round2(row.totalNet-totalCost):null;
      const margin=totalCost!=null&&row.totalNet>0?round2(profit/row.totalNet*100):null;
      return{...row,totalCost,profit,margin};
    });
    return out.sort((a,b)=>b.totalQty-a.totalQty);
  },[filtered,menusByName,ings]);

  const grandTotalQty=pivot.reduce((s,r)=>s+r.totalQty,0);
  const grandTotalNet=round2(pivot.reduce((s,r)=>s+r.totalNet,0));
  // Costs only for matched menus
  const costSummary=useMemo(()=>{
    let totalCost=0,matchedRevenue=0,unmatchedRevenue=0,matchedCount=0,unmatchedCount=0;
    pivot.forEach(r=>{
      if(r.matched){matchedCount++;totalCost+=r.totalCost||0;matchedRevenue+=r.totalNet||0;}
      else{unmatchedCount++;unmatchedRevenue+=r.totalNet||0;}
    });
    totalCost=round2(totalCost);matchedRevenue=round2(matchedRevenue);unmatchedRevenue=round2(unmatchedRevenue);
    const profit=round2(matchedRevenue-totalCost);
    const margin=matchedRevenue>0?round2(profit/matchedRevenue*100):null;
    return{totalCost,matchedRevenue,unmatchedRevenue,matchedCount,unmatchedCount,profit,margin};
  },[pivot]);
  const unmatchedMenus=useMemo(()=>pivot.filter(r=>!r.matched).map(r=>r.menu_name),[pivot]);
  // Map menu_name → {category, price_avg, totalQty} for quick auto-create
  const unmatchedDetail=useMemo(()=>{
    const m=new Map();
    pivot.filter(r=>!r.matched).forEach(r=>{
      // Find a representative row from raw filtered data (latest first since we order desc)
      const sample=filtered.find(x=>x.menu_name===r.menu_name);
      m.set(r.menu_name,{
        menu_name:r.menu_name,
        category:r.category||sample?.category||"อื่นๆ",
        price:round2(+(sample?.price_avg)||0)||round2(r.totalQty>0?r.totalNet/r.totalQty:0),
        totalQty:r.totalQty,
      });
    });
    return m;
  },[pivot,filtered]);
  const[creating,setCreating]=useState(null);  // menu_name | null
  const[savingSnap,setSavingSnap]=useState(null);  // "branchId|date" | null
  const canCreateMenu=hasPerm(currentUser,"menus");

  async function saveBatchSnapshot(branchId,date){
    const br=branches.find(x=>+x.id===+branchId);
    // Pre-compute totals to show in the confirm dialog
    const batchRows=rows.filter(r=>+r.branch_id===+branchId&&r.sale_date===date);
    let prevRev=0,prevCost=0;
    batchRows.forEach(r=>{
      prevRev+=+r.net_total||0;
      const m=findMenu(r.menu_name);
      if(m)prevCost+=round2(menuCost(m,ings))*(+r.qty||0);
    });
    prevRev=round2(prevRev);prevCost=round2(prevCost);
    const prevPct=prevRev>0?round2(prevCost/prevRev*100):0;
    if(!await confirmDlg({
      title:"💾 บันทึกสรุปต้นทุน",
      message:`บันทึกสรุปต้นทุนของวันที่ ${date} (สาขา ${br?.name||"-"}) ไปยังแท็บ "สรุปต้นทุน"?\n\nยอดขาย: ฿${prevRev.toLocaleString(undefined,{minimumFractionDigits:2})}\nต้นทุน: ฿${prevCost.toLocaleString(undefined,{minimumFractionDigits:2})} (${prevPct}%)\n\nหากเคยบันทึกไว้แล้ว ระบบจะอัพเดททับของเดิม`,
      confirmLabel:"บันทึกสรุป",
    }))return;
    const key=`${branchId}|${date}`;
    setSavingSnap(key);
    try{
      await generateCostSnapshot({branchId,date,menus,ings,currentUser});
      alert(`✅ บันทึกสรุปต้นทุนเรียบร้อย\n\nไปดูได้ที่แท็บ "สรุปต้นทุน"`);
    }catch(e){showErr("บันทึกสรุปไม่สำเร็จ",e);}
    setSavingSnap(null);
  }

  async function ensureCategory(name){
    if(!name)return;
    try{
      const all=await api.getCats();
      if(!all.some(c=>c.name===name&&c.type==="menu")){
        try{await api.addCat({name,type:"menu"});}catch{/* duplicate ok */}
      }
    }catch{/* ignore */}
  }
  async function autoCreateMenu(menuName){
    const d=unmatchedDetail.get(menuName);
    if(!d)return;
    setCreating(menuName);
    try{
      await ensureCategory(d.category);
      await api.addMenu({
        name:d.menu_name,
        category:d.category,
        price:d.price||0,
        description:"นำเข้าจาก FoodStory — กรุณาใส่วัตถุดิบเพื่อคำนวณต้นทุน",
        image:null,
        ingredients:[],
        sop:[],
        edit_by:currentUser?.username||null,
        edit_at:nowStr(),
        branch_id:currentBranch?.id||null,
      });
      if(reloadMenus)await reloadMenus();
      if(reloadCats)await reloadCats();
    }catch(e){showErr("สร้างเมนูไม่สำเร็จ",e);}
    setCreating(null);
  }

  function exportXlsx(){
    if(rows.length===0){alert("ไม่มีข้อมูลให้ export");return;}
    const sheet1=pivot.map(p=>{
      const o={"เมนู":p.menu_name,"หมวด":p.category||"","จับคู่ระบบ":p.matched?"✅":"❌"};
      dates.forEach(d=>{o[d]=p.cells.get(d)||0;});
      o["รวม (จำนวน)"]=p.totalQty;
      o["ยอดขาย (฿)"]=p.totalNet;
      o["ต้นทุน/หน่วย"]=p.costPerUnit==null?"":p.costPerUnit;
      o["ต้นทุนรวม"]=p.totalCost==null?"":p.totalCost;
      o["กำไร"]=p.profit==null?"":p.profit;
      o["% กำไร"]=p.margin==null?"":p.margin;
      return o;
    });
    const sheet2=filtered.map(r=>{
      const m=findMenu(r.menu_name);
      const cu=m?round2(menuCost(m,ings)):null;
      const cost=cu!=null?round2(cu*(+r.qty||0)):null;
      return{"วันที่":r.sale_date,"สาขา":branches.find(b=>+b.id===+r.branch_id)?.name||"","เมนู":r.menu_name,"จับคู่ระบบ":m?"✅":"❌","หมวด":r.category||"","จำนวน":+r.qty||0,"ราคาเฉลี่ย":+r.price_avg||0,"ยอดสุทธิ":+r.net_total||0,"ต้นทุน/หน่วย":cu??"","ต้นทุนรวม":cost??"","กำไร":cost!=null?round2((+r.net_total||0)-cost):""};
    });
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(sheet1),"Pivot");
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(sheet2),"รายการรายวัน");
    XLSX.writeFile(wb,`FS_Sales_${dateFrom}_${dateTo}.xlsx`);
  }

  async function delDate(b,d){
    if(!await confirmDlg({title:"ลบยอดของวันนี้",message:`ลบยอดขายของสาขา/วันนี้ออกจากระบบ?\n(ลบเฉพาะที่ import เข้ามา ไม่กระทบ FoodStory)`,danger:true}))return;
    try{await api.deleteExternalSalesBy(b,d);await load();}
    catch(e){showErr("ลบไม่สำเร็จ",e);}
  }
  // Distinct (branch,date) pairs for "imported batches" section
  const batches=useMemo(()=>{
    const m=new Map();
    rows.forEach(r=>{const k=`${r.branch_id}|${r.sale_date}`;if(!m.has(k))m.set(k,{branch_id:r.branch_id,sale_date:r.sale_date,count:0,qtySum:0});const v=m.get(k);v.count++;v.qtySum+=+r.qty||0;});
    return [...m.values()].sort((a,b)=>b.sale_date.localeCompare(a.sale_date));
  },[rows]);

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:18,flexWrap:"wrap",gap:10}}>
      <div>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:20,fontWeight:900,color:C.ink,margin:0,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:24}}>📊</span> ยอดขายจาก FoodStory
        </h3>
        <p style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,color:C.ink4,margin:"4px 0 0"}}>นำเข้าจากไฟล์ Export ของ FoodStory · ดูเมนูที่ขายไปเท่าไรในแต่ละวัน</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn v="success" onClick={exportXlsx} disabled={rows.length===0} s={{padding:"8px 14px",fontSize:13}}>📊 Export Excel</Btn>
        {canImport&&<Btn onClick={()=>setShowImport(true)} icon={I.plus}>นำเข้าไฟล์ใหม่</Btn>}
      </div>
    </div>

    {/* Filter */}
    <Card style={{padding:"12px 16px",marginBottom:14,background:C.bg}}>
      <div style={{display:"grid",gridTemplateColumns:isCentral?"1.5fr 1.5fr 1fr 1fr auto":"2fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
        {isCentral&&<div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>สาขา</div>
          <select value={filterBranch} onChange={e=>setFilterBranch(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px",appearance:"none"}}>
            <option value="">— ทุกสาขา —</option>
            {branches.filter(b=>b.active!==false).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>}
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ค้นหาเมนู</div>
          <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="พิมพ์ชื่อเมนู / หมวด..." style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ตั้งแต่วันที่</div>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ถึง</div>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <Btn v="ghost" onClick={load} icon={I.refresh} s={{padding:"8px 14px",fontSize:12}}>รีเฟรช</Btn>
      </div>
    </Card>

    {/* Imported batches */}
    {batches.length>0&&<div style={{marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:6}}>📦 รายการที่นำเข้า ({batches.length} ไฟล์):</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {batches.map(b=>{const br=branches.find(x=>+x.id===+b.branch_id);const busy=savingSnap===`${b.branch_id}|${b.sale_date}`;return <div key={`${b.branch_id}-${b.sale_date}`} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:8,padding:"5px 10px",fontSize:11,fontFamily:"'Sarabun',sans-serif",color:C.ink2,display:"flex",alignItems:"center",gap:6}}>
          <span><b>{b.sale_date}</b> · {br?.name||"—"} · {b.count} เมนู / {b.qtySum} ครั้ง</span>
          {canImport&&<button onClick={()=>saveBatchSnapshot(b.branch_id,b.sale_date)} disabled={busy} title="บันทึกเป็นสรุปต้นทุนของวันนี้ — ไปแสดงในแท็บ 'สรุปต้นทุน'" style={{background:busy?C.lineLight:`linear-gradient(135deg,${C.green},#059669)`,border:"none",borderRadius:5,padding:"3px 9px",cursor:busy?"not-allowed":"pointer",color:busy?C.ink4:C.white,fontSize:10,fontWeight:800,fontFamily:"'Sarabun',sans-serif"}}>{busy?"⏳":"💾 บันทึกสรุป"}</button>}
          {canImport&&<button onClick={()=>delDate(b.branch_id,b.sale_date)} title="ลบยอดของวันนี้" style={{background:C.redLight,border:"none",borderRadius:5,padding:"2px 6px",cursor:"pointer",color:C.red,fontSize:10,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>×</button>}
        </div>;})}
      </div>
    </div>}

    {/* Cost summary cards */}
    {rows.length>0&&<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:10,marginBottom:14}}>
      {[
        {l:"💰 ยอดขายรวม",v:`฿${grandTotalNet.toLocaleString(undefined,{minimumFractionDigits:2})}`,c:C.brand,sub:`${grandTotalQty} ครั้ง`},
        {l:"📦 ต้นทุนรวม",v:`฿${costSummary.totalCost.toLocaleString(undefined,{minimumFractionDigits:2})}`,c:C.red,sub:`เฉพาะเมนูที่จับคู่`},
        {l:"📈 กำไรรวม",v:`฿${costSummary.profit.toLocaleString(undefined,{minimumFractionDigits:2})}`,c:costSummary.profit>=0?C.green:C.red,sub:costSummary.margin!=null?`${costSummary.margin.toFixed(1)}% margin`:"—"},
        {l:"✅ จับคู่ระบบได้",v:`${costSummary.matchedCount}/${pivot.length}`,c:C.green,sub:`฿${costSummary.matchedRevenue.toLocaleString(undefined,{minimumFractionDigits:2})}`},
        ...(costSummary.unmatchedCount>0?[{l:"⚠️ ยังไม่จับคู่",v:`${costSummary.unmatchedCount} เมนู`,c:"#EA580C",sub:`฿${costSummary.unmatchedRevenue.toLocaleString(undefined,{minimumFractionDigits:2})}`}]:[]),
      ].map(s=><Card key={s.l} style={{padding:"12px 14px"}}>
        <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:700,marginBottom:4}}>{s.l}</div>
        <div style={{fontSize:18,fontWeight:900,color:s.c,fontFamily:"'Sarabun',sans-serif",lineHeight:1.2}}>{s.v}</div>
        <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>{s.sub}</div>
      </Card>)}
    </div>}

    {/* Unmatched menus — compact note (per-row buttons live inside the table) */}
    {unmatchedMenus.length>0&&<div style={{background:"#FEF3C7",border:`1px solid #FDE68A`,borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:12,color:"#92400E",fontFamily:"'Sarabun',sans-serif",lineHeight:1.6}}>
      <b>⚠️ พบ {unmatchedMenus.length} เมนูใน FoodStory ที่ยังไม่ได้สร้างในระบบ</b> — คำนวณต้นทุนไม่ได้จนกว่าจะมีในระบบ ใช้ปุ่ม <b>"+ สร้างเมนูนี้"</b> ที่ท้ายชื่อเมนูในตารางด้านล่างเพื่อเพิ่มทีละเมนู (กรุณาเช็คความถูกต้องก่อนกด)
    </div>}

    {/* Toggle view + cost columns */}
    <div style={{display:"flex",gap:6,marginBottom:10,alignItems:"center",flexWrap:"wrap"}}>
      {[{v:"pivot",l:"📈 Pivot (เมนู × วันที่)"},{v:"flat",l:"📋 รายการรายวัน"}].map(o=>{const sel=viewMode===o.v;return <button key={o.v} onClick={()=>setViewMode(o.v)} style={{padding:"6px 14px",borderRadius:9,border:`2px solid ${sel?C.brand:C.line}`,background:sel?C.brandLight:C.white,color:sel?C.brand:C.ink2,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12}}>{o.l}</button>;})}
      <label style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.ink2,fontWeight:600}}>
        <input type="checkbox" checked={showCost} onChange={e=>setShowCost(e.target.checked)} style={{accentColor:C.brand,width:14,height:14}}/>
        แสดงคอลัมน์ต้นทุน/กำไร
      </label>
    </div>

    {/* Table */}
    {loading?<Loading text="โหลดยอดขาย..."/>:rows.length===0?<Card style={{padding:50,textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:8}}>📭</div>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,color:C.ink3,fontWeight:600}}>ยังไม่มีข้อมูลในช่วงนี้</div>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.ink4,marginTop:4}}>กดปุ่ม "นำเข้าไฟล์ใหม่" เพื่อเริ่มต้น</div>
    </Card>:viewMode==="pivot"?<Card style={{padding:0,overflow:"hidden"}}>
      <div style={{overflowX:"auto",maxHeight:560}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
          <thead style={{position:"sticky",top:0,zIndex:2}}><tr style={{background:"#0F172A"}}>
            <th style={{padding:"11px 12px",textAlign:"left",fontSize:11,color:"#F8FAFC",fontWeight:700,whiteSpace:"nowrap",position:"sticky",left:0,background:"#0F172A",zIndex:3,minWidth:200}}>เมนู</th>
            <th style={{padding:"11px 12px",textAlign:"left",fontSize:11,color:"#F8FAFC",fontWeight:700,whiteSpace:"nowrap"}}>หมวด</th>
            {dates.map(d=><th key={d} style={{padding:"11px 10px",textAlign:"center",fontSize:11,color:"#F8FAFC",fontWeight:700,whiteSpace:"nowrap"}}>{d.slice(5)}</th>)}
            <th style={{padding:"11px 12px",textAlign:"right",fontSize:11,color:"#F8FAFC",fontWeight:800,background:"#1E293B",whiteSpace:"nowrap"}}>จำนวน</th>
            <th style={{padding:"11px 12px",textAlign:"right",fontSize:11,color:"#F8FAFC",fontWeight:800,background:"#1E293B",whiteSpace:"nowrap"}}>ยอดขาย (฿)</th>
            {showCost&&<>
              <th style={{padding:"11px 12px",textAlign:"right",fontSize:11,color:"#FCA5A5",fontWeight:800,background:"#7F1D1D",whiteSpace:"nowrap"}}>ต้นทุน</th>
              <th style={{padding:"11px 12px",textAlign:"right",fontSize:11,color:"#A7F3D0",fontWeight:800,background:"#064E3B",whiteSpace:"nowrap"}}>กำไร</th>
              <th style={{padding:"11px 12px",textAlign:"right",fontSize:11,color:"#A7F3D0",fontWeight:800,background:"#064E3B",whiteSpace:"nowrap"}}>%</th>
            </>}
          </tr></thead>
          <tbody>
            {pivot.map((p,idx)=><tr key={p.menu_name} style={{borderTop:`1px solid ${C.lineLight}`,background:idx%2===0?C.white:"#FAFBFC"}}>
              <td style={{padding:"9px 12px",fontSize:13,fontWeight:700,color:C.ink,position:"sticky",left:0,background:idx%2===0?C.white:"#FAFBFC",zIndex:1}}>
                <span style={{display:"inline-flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                  <span>{p.menu_name}</span>
                  {!p.matched&&<>
                    <span title="เมนูนี้ยังไม่อยู่ในระบบ — คำนวณต้นทุนไม่ได้" style={{fontSize:10,background:"#FEF3C7",color:"#92400E",padding:"1px 6px",borderRadius:8,fontWeight:700}}>⚠ ยังไม่จับคู่</span>
                    {canCreateMenu&&<button onClick={()=>autoCreateMenu(p.menu_name)} disabled={!!creating} title="สร้างเมนูนี้ในระบบ" style={{background:creating===p.menu_name?C.lineLight:`linear-gradient(135deg,${C.green},#059669)`,border:"none",borderRadius:6,padding:"2px 9px",cursor:creating?"not-allowed":"pointer",fontSize:10,fontWeight:800,color:creating===p.menu_name?C.ink4:C.white,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>{creating===p.menu_name?"⏳":"+ สร้างเมนูนี้"}</button>}
                  </>}
                </span>
              </td>
              <td style={{padding:"9px 12px",fontSize:11,color:C.ink3}}>{p.category||"—"}</td>
              {dates.map(d=>{const v=p.cells.get(d)||0;return <td key={d} style={{padding:"9px 10px",textAlign:"center",fontSize:13,fontWeight:v>0?700:400,color:v>0?C.ink:C.ink4}}>{v||"·"}</td>;})}
              <td style={{padding:"9px 12px",textAlign:"right",fontSize:14,fontWeight:900,color:C.brand,background:C.brandLight}}>{p.totalQty}</td>
              <td style={{padding:"9px 12px",textAlign:"right",fontSize:13,fontWeight:700,color:C.ink,background:C.brandLight}}>฿{round2(p.totalNet).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
              {showCost&&<>
                <td style={{padding:"9px 12px",textAlign:"right",fontSize:12,fontWeight:700,color:p.totalCost!=null?C.red:C.ink4,background:"#FEF2F2"}}>{p.totalCost!=null?`฿${p.totalCost.toLocaleString(undefined,{minimumFractionDigits:2})}`:"—"}</td>
                <td style={{padding:"9px 12px",textAlign:"right",fontSize:13,fontWeight:800,color:p.profit!=null?(p.profit>=0?C.green:C.red):C.ink4,background:C.greenLight}}>{p.profit!=null?`฿${p.profit.toLocaleString(undefined,{minimumFractionDigits:2})}`:"—"}</td>
                <td style={{padding:"9px 12px",textAlign:"right",fontSize:12,fontWeight:700,color:p.margin!=null?(p.margin>=60?C.green:p.margin>=40?C.yellow:C.red):C.ink4,background:C.greenLight}}>{p.margin!=null?`${p.margin.toFixed(1)}%`:"—"}</td>
              </>}
            </tr>)}
            <tr style={{background:"#0F172A",color:"#F8FAFC",fontWeight:900}}>
              <td colSpan={2+dates.length} style={{padding:"11px 12px",fontSize:13,textAlign:"right"}}>รวมทั้งหมด</td>
              <td style={{padding:"11px 12px",textAlign:"right",fontSize:15,color:"#F8FAFC"}}>{grandTotalQty}</td>
              <td style={{padding:"11px 12px",textAlign:"right",fontSize:14,color:"#F8FAFC"}}>฿{grandTotalNet.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
              {showCost&&<>
                <td style={{padding:"11px 12px",textAlign:"right",fontSize:13,color:"#FCA5A5"}}>฿{costSummary.totalCost.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                <td style={{padding:"11px 12px",textAlign:"right",fontSize:14,color:costSummary.profit>=0?"#A7F3D0":"#FCA5A5"}}>฿{costSummary.profit.toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                <td style={{padding:"11px 12px",textAlign:"right",fontSize:13,color:"#A7F3D0"}}>{costSummary.margin!=null?`${costSummary.margin.toFixed(1)}%`:"—"}</td>
              </>}
            </tr>
          </tbody>
        </table>
      </div>
    </Card>:<Card style={{padding:0,overflow:"hidden"}}>
      <div style={{overflowX:"auto",maxHeight:560}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
          <thead style={{position:"sticky",top:0,zIndex:1}}><tr style={{background:"#0F172A"}}>
            {(showCost?["วันที่","สาขา","เมนู","หมวด","จำนวน","ราคา/หน่วย","ยอดสุทธิ","ต้นทุน","กำไร"]:["วันที่","สาขา","เมนู","หมวด","จำนวน","ราคา/หน่วย","ยอดสุทธิ"]).map((h,i)=><th key={h} style={{padding:"11px 12px",textAlign:i>=4?"right":"left",fontSize:11,fontWeight:700,color:"#F8FAFC",whiteSpace:"nowrap"}}>{h}</th>)}
          </tr></thead>
          <tbody>
            {filtered.map((r,i)=>{
              const matched=findMenu(r.menu_name);
              const cu=matched?round2(menuCost(matched,ings)):null;
              const cost=cu!=null?round2(cu*(+r.qty||0)):null;
              const profit=cost!=null?round2((+r.net_total||0)-cost):null;
              return <tr key={i} style={{borderTop:`1px solid ${C.lineLight}`,background:i%2===0?C.white:"#FAFBFC"}}>
                <td style={{padding:"8px 12px",fontSize:12,color:C.ink2,whiteSpace:"nowrap"}}>{r.sale_date}</td>
                <td style={{padding:"8px 12px",fontSize:12,color:C.ink3}}>{branches.find(b=>+b.id===+r.branch_id)?.name||"—"}</td>
                <td style={{padding:"8px 12px",fontSize:13,fontWeight:600,color:C.ink}}>
                  <span style={{display:"inline-flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                    <span>{r.menu_name}</span>
                    {!matched&&<>
                      <span title="ยังไม่จับคู่กับเมนูในระบบ" style={{fontSize:10,background:"#FEF3C7",color:"#92400E",padding:"1px 6px",borderRadius:8,fontWeight:700}}>⚠ ยังไม่จับคู่</span>
                      {canCreateMenu&&<button onClick={()=>autoCreateMenu(r.menu_name)} disabled={!!creating} title="สร้างเมนูนี้ในระบบ" style={{background:creating===r.menu_name?C.lineLight:`linear-gradient(135deg,${C.green},#059669)`,border:"none",borderRadius:6,padding:"2px 8px",cursor:creating?"not-allowed":"pointer",fontSize:10,fontWeight:800,color:creating===r.menu_name?C.ink4:C.white,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>{creating===r.menu_name?"⏳":"+ สร้างเมนูนี้"}</button>}
                    </>}
                  </span>
                </td>
                <td style={{padding:"8px 12px",fontSize:11,color:C.ink3}}>{r.category||"—"}</td>
                <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,fontWeight:700,color:C.brand}}>{r.qty}</td>
                <td style={{padding:"8px 12px",textAlign:"right",fontSize:12,color:C.ink3}}>฿{(+r.price_avg||0).toFixed(2)}</td>
                <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,fontWeight:700,color:C.ink}}>฿{(+r.net_total||0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                {showCost&&<>
                  <td style={{padding:"8px 12px",textAlign:"right",fontSize:12,fontWeight:700,color:cost!=null?C.red:C.ink4}}>{cost!=null?`฿${cost.toLocaleString(undefined,{minimumFractionDigits:2})}`:"—"}</td>
                  <td style={{padding:"8px 12px",textAlign:"right",fontSize:13,fontWeight:800,color:profit!=null?(profit>=0?C.green:C.red):C.ink4}}>{profit!=null?`฿${profit.toLocaleString(undefined,{minimumFractionDigits:2})}`:"—"}</td>
                </>}
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </Card>}

    {showImport&&<FSImportModal branches={branches} currentUser={currentUser} onClose={()=>setShowImport(false)} onDone={()=>{setShowImport(false);load();}}/>}
  </div>;
}

const PO_STATUS={
  open:            {label:"⏳ เปิดอยู่",       short:"เปิดอยู่",    color:"#F59E0B",bg:"#FEF3C7"},
  disputed:        {label:"⚠️ ส่งกลับ",        short:"ส่งกลับ",     color:"#EA580C",bg:"#FFEDD5"},
  awaiting_payment:{label:"💰 รอชำระเงิน",     short:"รอชำระ",     color:"#3B82F6",bg:"#DBEAFE"},
  paid:            {label:"✅ ยืนยันแล้ว",     short:"ยืนยันแล้ว", color:"#10B981",bg:"#D1FAE5"},
  received:        {label:"✅ รับแล้ว (เก่า)", short:"รับแล้ว",     color:"#10B981",bg:"#D1FAE5"},
  cancelled:       {label:"❌ ยกเลิก",          short:"ยกเลิก",      color:"#94A3B8",bg:"#F1F5F9"},
};
function POSection({branches,ings,currentBranch,currentUser}){
  // Every branch (central or otherwise) can issue a PO to any other branch
  // and only ever sees POs it's involved in (as sender or receiver).
  // - "from_branch_id" = creator (sender)
  // - "branch_id"      = receiver
  const today=todayBkk();
  const ago=(d=>{const t=new Date();t.setDate(t.getDate()-d);return t.toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});})(30);
  const[pos,setPOs]=useState([]);
  const[loading,setLoading]=useState(false);
  const[direction,setDirection]=useState("all");  // all | sent | received
  const[partnerFilter,setPartnerFilter]=useState("");  // other party
  const[filterStatus,setFilterStatus]=useState("");
  const[dateFrom,setDateFrom]=useState(ago);
  const[dateTo,setDateTo]=useState(today);
  const[step,setStep]=useState(null);
  const[pickedBranch,setPickedBranch]=useState(null);
  const[editPO,setEditPO]=useState(null);
  const[viewPO,setViewPO]=useState(null);
  const[confirming,setConfirming]=useState(null);
  const hasPO=hasPerm(currentUser,"po")||hasPerm(currentUser,"summary")||hasPerm(currentUser,"orders");
  // Per-PO permissions
  const isCreator=(po)=>+po.from_branch_id===currentBranch.id;
  const isReceiver=(po)=>+po.branch_id===currentBranch.id;
  const canEditPO=(po)=>hasPO&&isCreator(po);
  const canConfirmPO=(po)=>hasPO&&isReceiver(po)&&po.status==="open";

  async function load(){
    setLoading(true);
    try{
      const filters={dateFrom,dateTo};
      if(direction==="sent")filters.fromBranchId=currentBranch.id;
      else if(direction==="received")filters.toBranchId=currentBranch.id;
      else filters.viewerBranchId=currentBranch.id;
      let data=await api.getPOs(filters);
      if(partnerFilter){
        const pid=+partnerFilter;
        data=data.filter(p=>+p.from_branch_id===pid||+p.branch_id===pid);
      }
      if(filterStatus)data=data.filter(p=>p.status===filterStatus);
      setPOs(data);
    }catch(e){console.error("loadPOs",e);alert("โหลด PO ไม่สำเร็จ: "+e.message);}
    setLoading(false);
  }
  useEffect(()=>{load();},[direction,partnerFilter,filterStatus,dateFrom,dateTo,currentBranch?.id]);

  async function confirmReceive(po){
    if(!isReceiver(po)){alert("เฉพาะสาขาผู้รับเท่านั้นที่ยืนยันรับสินค้าได้");return;}
    if(!await confirmDlg({title:"ยืนยันรับสินค้า",message:`ยืนยันว่าได้รับสินค้าครบตามใบ ${po.po_number||"PO นี้"}?\n\nหลังยืนยันแล้ว เอกสารจะรอต้นทางชำระเงิน`,confirmLabel:"✅ ยืนยันรับครบ",cancelLabel:"ยกเลิก"}))return;
    setConfirming(po.id);
    try{
      await api.patchPOIfStatus(po.id,"open",{status:"awaiting_payment",received_at:new Date().toISOString(),received_by:currentUser?.username||currentUser?.name||null,updated_at:new Date().toISOString()});
      await load();
    }catch(e){showErr("ยืนยันไม่สำเร็จ",e);}
    setConfirming(null);
  }
  async function submitDispute(po,updatedItems,note){
    if(!isReceiver(po)){alert("เฉพาะสาขาผู้รับเท่านั้นที่ส่งกลับได้");return;}
    setConfirming(po.id);
    try{
      // Clamp received_qty to [0, original qty] to prevent fraud
      const safeItems=(updatedItems||[]).map(it=>{const orig=+it.qty||0;const got=Math.max(0,Math.min(orig,+it.received_qty||0));return{...it,received_qty:got};});
      await api.patchPOIfStatus(po.id,"open",{items:safeItems,status:"disputed",dispute_note:note||null,dispute_at:new Date().toISOString(),dispute_by:currentUser?.username||null,updated_at:new Date().toISOString()});
      await load();setViewPO(null);
    }catch(e){showErr("ส่งกลับไม่สำเร็จ",e);}
    setConfirming(null);
  }
  async function acceptDispute(po){
    if(!isCreator(po)){alert("เฉพาะผู้ออกเอกสารเท่านั้นที่ยอมรับได้");return;}
    if(!await confirmDlg({title:"ยอมรับการแก้ไข",message:`ยอมรับจำนวนที่ปลายทางแจ้งใน ${po.po_number||"PO นี้"}?\n\nระบบจะปรับจำนวนและยอดรวมตามที่ปลายทางแจ้ง แล้วเปลี่ยนสถานะเป็น "รอชำระเงิน"`,confirmLabel:"✅ ยอมรับการแก้ไข"}))return;
    setConfirming(po.id);
    try{
      // Preserve every existing item field; only adjust qty + line_total based on (clamped) received_qty
      const newItems=(po.items||[]).map(it=>{
        const orig=+it.qty||0;
        const recv=it.received_qty!=null?Math.max(0,Math.min(orig,+it.received_qty||0)):orig;
        return{...it,qty:recv,line_total:round2(recv*(+it.price_per_unit||0))};
      });
      const subtotal=round2(newItems.reduce((s,i)=>s+(+i.line_total||0),0));
      const oldSub=+po.subtotal||0;
      const vatRate=oldSub>0?(+po.vat||0)/oldSub:0;
      const vat=round2(subtotal*vatRate);
      const total=round2(subtotal+vat);
      await api.patchPOIfStatus(po.id,"disputed",{items:newItems,subtotal,vat,total,status:"awaiting_payment",received_at:new Date().toISOString(),received_by:po.dispute_by||null,updated_at:new Date().toISOString()});
      await load();setViewPO(null);
    }catch(e){showErr("ยอมรับไม่สำเร็จ",e);}
    setConfirming(null);
  }
  async function submitPayment(po,slipUrl,note){
    if(!isCreator(po))throw new Error("เฉพาะผู้ออกเอกสารเท่านั้นที่ชำระเงินได้");
    try{
      await api.patchPOIfStatus(po.id,"awaiting_payment",{status:"paid",payment_slip_url:slipUrl,payment_at:new Date().toISOString(),payment_by:currentUser?.username||null,payment_note:note||null,updated_at:new Date().toISOString()});
      await load();setViewPO(null);
    }catch(e){showErr("บันทึกการชำระไม่สำเร็จ",e);throw e;}
  }
  async function cancelPO(po){
    if(!isCreator(po)){alert("เฉพาะผู้ออกเอกสารเท่านั้นที่ยกเลิกได้");return;}
    if(po.status==="paid"||po.status==="cancelled"){alert("เอกสารนี้ไม่สามารถยกเลิกในสถานะปัจจุบันได้");return;}
    if(!await confirmDlg({title:"ยกเลิก PO",message:`ยกเลิก ${po.po_number||"PO นี้"}?`,danger:true,confirmLabel:"ยกเลิก PO"}))return;
    try{
      await api.updatePO(po.id,{status:"cancelled",updated_at:new Date().toISOString()});
      await load();setViewPO(null);
    }catch(e){showErr("ยกเลิกไม่สำเร็จ",e);}
  }
  const[payPO,setPayPO]=useState(null);

  async function delPO(po){
    const isPaid=po.status==="paid";
    const msg=isPaid
      ?`เอกสาร ${po.po_number||"PO นี้"} ชำระเงินแล้ว\n\n⚠️ ลบแล้วจะไม่สามารถกู้คืนได้ และประวัติการชำระเงิน + รูปสลิปจะถูกลบทิ้งด้วย\n\nต้องการลบจริงๆ?`
      :`ต้องการลบ ${po.po_number||"PO นี้"} ใช่หรือไม่?`;
    if(!await confirmDlg({title:isPaid?"⚠️ ลบเอกสารที่ชำระแล้ว":"ลบเอกสาร PO",message:msg,danger:true,confirmLabel:isPaid?"ลบทิ้งถาวร":"ลบ"}))return;
    try{await api.deletePO(po.id);await load();setViewPO(null);}
    catch(e){alert("ลบไม่สำเร็จ: "+e.message);}
  }
  function startCreate(){setPickedBranch(null);setEditPO(null);setStep('pick-branch');}
  function pickBranch(b){setPickedBranch(b);setStep('form');}
  function startEdit(po){const b=branches.find(x=>x.id===po.branch_id);setPickedBranch(b||null);setEditPO(po);setStep('form');}
  async function onSaved(){setStep(null);setEditPO(null);await load();}

  const branchById=Object.fromEntries(branches.map(b=>[b.id,b]));
  const totalAll=pos.reduce((s,p)=>s+(+p.total||0),0);
  const branchOptions=branches.filter(b=>b.id!==currentBranch.id&&b.active!==false);

  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18,flexWrap:"wrap",gap:10}}>
      <div>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:20,fontWeight:900,color:C.ink,margin:0,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:24}}>📄</span> เอกสาร PO (ใบสั่งซื้อวัตถุดิบ)
        </h3>
        <p style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,color:C.ink4,margin:"4px 0 0"}}>เปิดใบสั่งซื้อระหว่างสาขาได้ทุกทิศทาง · กดปุ่ม "+" เพื่อสร้างใหม่ · กด ✅ ยืนยันเมื่อได้รับสินค้า</p>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <Btn v="success" onClick={()=>exportPOsToExcel(pos,branchById)} disabled={pos.length===0} s={{padding:"8px 14px",fontSize:13}}>📊 Export Excel</Btn>
        {hasPO&&<Btn onClick={startCreate} icon={I.plus}>สร้างเอกสาร PO</Btn>}
      </div>
    </div>

    {/* Direction tabs */}
    <div style={{display:"flex",gap:6,marginBottom:12,flexWrap:"wrap"}}>
      {[
        {v:"all",l:"📋 ทั้งหมด",c:C.brand},
        {v:"sent",l:"📤 ที่ฉันออก",c:C.blue},
        {v:"received",l:"📥 รอรับ / รับแล้ว",c:C.green},
      ].map(d=>{const active=direction===d.v;return <button key={d.v} onClick={()=>setDirection(d.v)} style={{padding:"7px 16px",borderRadius:10,border:`2px solid ${active?d.c:C.line}`,background:active?`${d.c}15`:C.white,color:active?d.c:C.ink2,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:active?800:600,fontSize:13,transition:"all .15s"}}>{d.l}</button>;})}
    </div>
    {/* Filter row */}
    <Card style={{padding:"12px 16px",marginBottom:14,background:C.bg}}>
      <div style={{display:"grid",gridTemplateColumns:"1.5fr 1fr 1fr 1fr auto",gap:10,alignItems:"end"}}>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>{direction==="sent"?"ส่งไปที่":direction==="received"?"ส่งมาจาก":"คู่ค้า (จาก/ถึง)"}</div>
          <select value={partnerFilter} onChange={e=>setPartnerFilter(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px",appearance:"none"}}>
            <option value="">— ทุกสาขา —</option>
            {branchOptions.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>สถานะ</div>
          <select value={filterStatus} onChange={e=>setFilterStatus(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px",appearance:"none"}}>
            <option value="">— ทุกสถานะ —</option>
            <option value="open">⏳ เปิดอยู่</option>
            <option value="received">✅ รับแล้ว</option>
            <option value="cancelled">❌ ยกเลิก</option>
          </select>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ตั้งแต่วันที่</div>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ถึง</div>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <Btn v="ghost" onClick={load} icon={I.refresh} s={{padding:"8px 14px",fontSize:12}}>รีเฟรช</Btn>
      </div>
      {pos.length>0&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px dashed ${C.line}`,display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"'Sarabun',sans-serif",color:C.ink3}}>
        <span>📑 พบ <b style={{color:C.ink}}>{pos.length}</b> เอกสาร</span>
        <span>💰 รวม <b style={{color:C.brand,fontSize:14}}>฿{totalAll.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</b></span>
      </div>}
    </Card>

    {/* List */}
    {loading?<Loading text="โหลดเอกสาร PO..."/>:pos.length===0?<Card style={{padding:"50px 20px",textAlign:"center"}}>
      <div style={{fontSize:48,marginBottom:8}}>📭</div>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,color:C.ink3,fontWeight:600}}>{direction==="sent"?"ยังไม่มี PO ที่คุณออก":direction==="received"?"ยังไม่มี PO ที่ส่งมาหา":"ยังไม่มีเอกสาร PO ในช่วงนี้"}</div>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.ink4,marginTop:4}}>กดปุ่ม "+ สร้างเอกสาร PO" เพื่อเริ่มต้น</div>
    </Card>:<Card style={{padding:0,overflow:"hidden"}}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
          <thead>
            <tr style={{background:"#0F172A"}}>
              {["วันที่สร้าง","เลขที่ใบ PO","จาก","ถึง","ยอดเงิน","สถานะ","จัดการ"].map((h,i)=><th key={h} style={{padding:"11px 14px",textAlign:i===4?"right":i===5||i===6?"center":"left",fontSize:12,fontWeight:700,color:"#F8FAFC",whiteSpace:"nowrap",letterSpacing:.2}}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {pos.map((po,idx)=>{
              const fromB=branchById[po.from_branch_id];
              const toB=branchById[po.branch_id];
              const st=PO_STATUS[po.status]||{label:po.status,color:C.ink3,bg:C.lineLight};
              const created=po.created_at?new Date(po.created_at).toLocaleString("th-TH",{year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit"}):po.po_date;
              const recAt=po.received_at?new Date(po.received_at).toLocaleDateString("th-TH"):null;
              const iCreator=isCreator(po),iReceiver=isReceiver(po);
              return <tr key={po.id} style={{borderTop:`1px solid ${C.lineLight}`,background:idx%2===0?C.white:"#FAFBFC",transition:"background .12s"}} onMouseEnter={e=>e.currentTarget.style.background=C.brandLight} onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?C.white:"#FAFBFC"}>
                <td style={{padding:"11px 14px",fontSize:12,color:C.ink2,whiteSpace:"nowrap"}}>{created}</td>
                <td style={{padding:"11px 14px",fontSize:13,fontWeight:800,color:C.ink,whiteSpace:"nowrap"}}>
                  {po.po_number||`#${po.id}`}
                  <div style={{fontSize:10,color:C.ink4,fontWeight:500,marginTop:1}}>{(po.items||[]).length} รายการ</div>
                </td>
                <td style={{padding:"11px 14px",fontSize:13,color:iCreator?C.brand:C.ink2,fontWeight:iCreator?800:600}}>
                  {fromB?.name||"-"}
                  {iCreator&&<span style={{fontSize:10,color:C.brand,marginLeft:5,background:C.brandLight,padding:"1px 6px",borderRadius:8,fontWeight:700}}>📤 ออก</span>}
                </td>
                <td style={{padding:"11px 14px",fontSize:13,color:iReceiver?C.green:C.ink2,fontWeight:iReceiver?800:600}}>
                  {toB?.name||"-"}
                  {iReceiver&&<span style={{fontSize:10,color:C.green,marginLeft:5,background:C.greenLight,padding:"1px 6px",borderRadius:8,fontWeight:700}}>📥 รับ</span>}
                </td>
                <td style={{padding:"11px 14px",fontSize:14,fontWeight:900,color:C.brand,textAlign:"right",whiteSpace:"nowrap"}}>฿{(+po.total).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                <td style={{padding:"11px 14px",textAlign:"center"}}>
                  <span style={{fontSize:11,fontWeight:700,color:st.color,background:st.bg,padding:"3px 10px",borderRadius:18,whiteSpace:"nowrap",display:"inline-block"}}>{st.label}</span>
                  {(po.status==="awaiting_payment"||po.status==="paid"||po.status==="received")&&recAt&&<div style={{fontSize:10,color:C.green,fontFamily:"'Sarabun',sans-serif",marginTop:3,fontWeight:600}}>รับ: {recAt}{po.received_by?` · ${po.received_by}`:""}</div>}
                  {po.status==="paid"&&po.payment_at&&<div style={{fontSize:10,color:C.blue,fontFamily:"'Sarabun',sans-serif",marginTop:2,fontWeight:600}}>จ่าย: {new Date(po.payment_at).toLocaleDateString("th-TH")}</div>}
                </td>
                <td style={{padding:"8px 12px",textAlign:"center",whiteSpace:"nowrap"}}>
                  <div style={{display:"inline-flex",gap:4,flexWrap:"wrap",justifyContent:"center"}}>
                    <button onClick={()=>setViewPO(po)} title="ดูรายละเอียด" style={{background:C.lineLight,border:`1px solid ${C.line}`,borderRadius:7,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center"}}><Ic d={I.eye} s={13} c={C.ink2}/></button>
                    <button onClick={()=>printPO(po,toB?.name,'print',fromB?.name)} title="พิมพ์" style={{background:C.blueLight,border:`1px solid #BFDBFE`,borderRadius:7,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center"}}><Ic d={I.print} s={13} c={C.blue}/></button>
                    <button onClick={()=>printPO(po,toB?.name,'pdf',fromB?.name)} title="ดาวน์โหลด PDF" style={{background:C.greenLight,border:`1px solid #86EFAC`,borderRadius:7,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",fontSize:12,color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:800}}>💾</button>
                    {canEditPO(po)&&po.status!=="paid"&&po.status!=="cancelled"&&<button onClick={()=>startEdit(po)} title="แก้ไข (เฉพาะผู้ออก)" style={{background:"#FEF3C7",border:`1px solid #FDE68A`,borderRadius:7,padding:"5px 8px",cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c="#92400E"/></button>}
                    {canEditPO(po)&&<button onClick={()=>delPO(po)} title={po.status==="paid"?"ลบทิ้งถาวร (ระวัง: ชำระแล้ว)":"ลบ"} style={{background:po.status==="paid"?"#7F1D1D":C.redLight,border:`1px solid ${po.status==="paid"?"#7F1D1D":"#FECACA"}`,borderRadius:7,padding:"5px 8px",cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={po.status==="paid"?C.white:C.red}/></button>}
                    {iCreator&&po.status==="awaiting_payment"&&<button onClick={()=>setPayPO(po)} title="ชำระเงิน" style={{background:`linear-gradient(135deg,${C.blue},#2563EB)`,border:"none",borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.white,fontFamily:"'Sarabun',sans-serif",fontWeight:800,boxShadow:`0 2px 6px ${C.blue}55`}}>💳 ชำระเงิน</button>}
                    {iCreator&&po.status==="disputed"&&<button onClick={()=>acceptDispute(po)} disabled={confirming===po.id} title="ยอมรับการแก้ไข" style={{background:`linear-gradient(135deg,${C.green},#059669)`,border:"none",borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.white,fontFamily:"'Sarabun',sans-serif",fontWeight:800,opacity:confirming===po.id?.6:1,boxShadow:`0 2px 6px ${C.green}55`}}>✅ ยอมรับการแก้</button>}
                    {canConfirmPO(po)&&<button onClick={()=>setViewPO(po)} title="ตรวจสอบ + ยืนยันรับ" style={{background:`linear-gradient(135deg,${C.green},#059669)`,border:"none",borderRadius:7,padding:"5px 12px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:11,color:C.white,fontFamily:"'Sarabun',sans-serif",fontWeight:800,boxShadow:`0 2px 6px ${C.green}55`}}>✅ ตรวจรับ</button>}
                  </div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </Card>}

    {/* Step 1: Pick branch */}
    {step==='pick-branch'&&<Modal title={`🏢 เลือกสาขาปลายทาง — ส่งจาก "${currentBranch.name}" ไปยัง...`} onClose={()=>setStep(null)}>
      {branchOptions.length===0?<div style={{padding:30,textAlign:"center",color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>ไม่มีสาขาอื่นในระบบ — เพิ่มสาขาในแท็บ "ตั้งค่า" ก่อน</div>:
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
        {branchOptions.map(b=><button key={b.id} onClick={()=>pickBranch(b)} style={{padding:"18px 16px",border:`2px solid ${C.line}`,borderRadius:14,background:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",textAlign:"left",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.background=C.brandLight;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.background=C.white;}}>
          <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:6}}>
            <div style={{width:36,height:36,borderRadius:10,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.branch} s={16} c={C.white}/></div>
            <div>
              <div style={{fontSize:14,fontWeight:800,color:C.ink}}>{b.name}</div>
              <div style={{fontSize:11,color:C.ink4}}>{b.active?"เปิดใช้งาน":"ปิดใช้งาน"}</div>
            </div>
          </div>
        </button>)}
      </div>}
    </Modal>}

    {/* Step 2: Form */}
    {step==='form'&&pickedBranch&&<POFormModal branch={pickedBranch} fromBranch={editPO?branchById[editPO.from_branch_id]:currentBranch} editPO={editPO} ings={ings} currentUser={currentUser} onClose={()=>{setStep(null);setEditPO(null);}} onSaved={onSaved}/>}

    {/* Full-screen view + actions */}
    {viewPO&&<POViewModal
      po={viewPO}
      fromBranch={branchById[viewPO.from_branch_id]}
      toBranch={branchById[viewPO.branch_id]}
      currentBranch={currentBranch}
      currentUser={currentUser}
      busy={confirming===viewPO.id}
      canDelete={canEditPO(viewPO)}
      onClose={()=>setViewPO(null)}
      onConfirmReceive={()=>confirmReceive(viewPO)}
      onSubmitDispute={(items,note)=>submitDispute(viewPO,items,note)}
      onAcceptDispute={()=>acceptDispute(viewPO)}
      onEdit={()=>{setViewPO(null);startEdit(viewPO);}}
      onOpenPayment={()=>{setViewPO(null);setPayPO(viewPO);}}
      onCancel={()=>cancelPO(viewPO)}
      onDelete={()=>delPO(viewPO)}
    />}
    {payPO&&<POPaymentModal po={payPO} fromBranch={branchById[payPO.from_branch_id]} toBranch={branchById[payPO.branch_id]} onClose={()=>setPayPO(null)} onSubmit={(url,note)=>{submitPayment(payPO,url,note);setPayPO(null);}}/>}
  </div>;
}

// Full-screen PO view with status-aware actions
function POViewModal({po,fromBranch,toBranch,currentBranch,currentUser,busy,canDelete,onClose,onConfirmReceive,onSubmitDispute,onAcceptDispute,onEdit,onOpenPayment,onCancel,onDelete}){
  const isCreator=+po.from_branch_id===currentBranch.id;
  const isReceiver=+po.branch_id===currentBranch.id;
  const st=PO_STATUS[po.status]||{label:po.status,color:C.ink3,bg:C.lineLight};
  const recAt=po.received_at?new Date(po.received_at).toLocaleString("th-TH"):null;
  const dispAt=po.dispute_at?new Date(po.dispute_at).toLocaleString("th-TH"):null;
  const payAt=po.payment_at?new Date(po.payment_at).toLocaleString("th-TH"):null;
  const[mode,setMode]=useState("view");  // view | dispute
  const[receivedQty,setReceivedQty]=useState(()=>{const m={};(po.items||[]).forEach((it,i)=>{m[i]=it.received_qty!=null?it.received_qty:it.qty;});return m;});
  const[disputeNote,setDisputeNote]=useState(po.dispute_note||"");
  // Permissions for actions in this view
  const canConfirmReceive=isReceiver&&po.status==="open";
  const canDispute=isReceiver&&po.status==="open";
  const canAcceptDispute=isCreator&&po.status==="disputed";
  const canEditFromView=isCreator&&(po.status==="open"||po.status==="disputed");
  const canPayNow=isCreator&&po.status==="awaiting_payment";
  const canCancelPO=isCreator&&po.status!=="paid"&&po.status!=="cancelled";

  async function submitDisputeNow(){
    if(!await confirmDlg({title:"ยืนยันส่งกลับ",message:"ส่งกลับให้ต้นทางตรวจสอบ?\nรายการที่ระบุจำนวนต่างจากเดิมจะถูกบันทึก",confirmLabel:"📤 ส่งกลับ",danger:false}))return;
    const updated=(po.items||[]).map((it,i)=>{const orig=+it.qty||0;const got=Math.max(0,Math.min(orig,+receivedQty[i]||0));return{...it,received_qty:got};});
    onSubmitDispute(updated,disputeNote);
  }
  const allMatch=(po.items||[]).every((it,i)=>+receivedQty[i]===+it.qty);

  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",zIndex:5000,display:"flex",flexDirection:"column"}}>
    {/* Header */}
    <div style={{background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white,padding:"14px 24px",display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0,boxShadow:"0 4px 16px rgba(0,0,0,.18)"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{fontSize:26}}>📄</div>
        <div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:20,fontWeight:900,letterSpacing:.2}}>{po.po_number||`PO #${po.id}`}</div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,opacity:.92}}>{fromBranch?.name||"-"} <span style={{margin:"0 6px",opacity:.6}}>→</span> {toBranch?.name||"-"} · {po.po_date||""}</div>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <span style={{background:st.bg,color:st.color,padding:"5px 14px",borderRadius:20,fontFamily:"'Sarabun',sans-serif",fontWeight:800,fontSize:13}}>{st.label}</span>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.18)",border:"none",borderRadius:10,width:36,height:36,cursor:"pointer",color:C.white,fontSize:20,fontFamily:"'Sarabun',sans-serif"}}>✕</button>
      </div>
    </div>

    {/* Body — scrollable */}
    <div style={{flex:1,overflowY:"auto",background:"#F1F5F9",padding:"24px 32px"}}>
      <div style={{maxWidth:1100,margin:"0 auto"}}>

        {/* Status / activity timeline */}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(200px,1fr))",gap:10,marginBottom:18}}>
          <div style={{background:C.white,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.line}`}}>
            <div style={{fontSize:11,color:C.ink4,fontWeight:700,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>📤 ผู้ออก</div>
            <div style={{fontSize:14,fontWeight:800,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>{fromBranch?.name||"-"}</div>
            <div style={{fontSize:11,color:C.ink4,marginTop:2,fontFamily:"'Sarabun',sans-serif"}}>{po.created_by||""} · {po.created_at?new Date(po.created_at).toLocaleString("th-TH"):"-"}</div>
          </div>
          <div style={{background:C.white,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.line}`}}>
            <div style={{fontSize:11,color:C.ink4,fontWeight:700,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>📥 ผู้รับ</div>
            <div style={{fontSize:14,fontWeight:800,color:C.green,fontFamily:"'Sarabun',sans-serif"}}>{toBranch?.name||"-"}</div>
            {recAt&&<div style={{fontSize:11,color:C.green,marginTop:2,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>✅ รับเมื่อ {recAt}{po.received_by?` · ${po.received_by}`:""}</div>}
          </div>
          {dispAt&&<div style={{background:"#FFEDD5",borderRadius:12,padding:"12px 14px",border:`1px solid #FB923C`}}>
            <div style={{fontSize:11,color:"#9A3412",fontWeight:700,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>⚠️ ส่งกลับ</div>
            <div style={{fontSize:13,color:"#9A3412",fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>{dispAt}{po.dispute_by?` · ${po.dispute_by}`:""}</div>
            {po.dispute_note&&<div style={{fontSize:11,color:"#7C2D12",marginTop:4,fontFamily:"'Sarabun',sans-serif"}}>"{po.dispute_note}"</div>}
          </div>}
          {payAt&&<div style={{background:C.greenLight,borderRadius:12,padding:"12px 14px",border:`1px solid ${C.green}`}}>
            <div style={{fontSize:11,color:C.green,fontWeight:700,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>💳 ชำระเงิน</div>
            <div style={{fontSize:13,color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>{payAt}{po.payment_by?` · ${po.payment_by}`:""}</div>
            {po.payment_slip_url&&<button onClick={async()=>{try{const u=await api.getSlipSignedUrl(po.payment_slip_url,300);if(u)window.open(u,"_blank","noopener");}catch(e){showErr("เปิดสลิปไม่สำเร็จ",e);}}} style={{background:"transparent",border:"none",padding:0,marginTop:4,fontSize:11,color:C.blue,fontFamily:"'Sarabun',sans-serif",fontWeight:700,cursor:"pointer",textDecoration:"underline"}}>📎 ดูสลิปการโอน →</button>}
          </div>}
        </div>

        {/* Items table */}
        <div style={{background:C.white,borderRadius:14,overflow:"hidden",boxShadow:"0 2px 8px rgba(15,23,42,.05)",marginBottom:14}}>
          <div style={{padding:"12px 18px",borderBottom:`1px solid ${C.line}`,background:C.bg,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontWeight:800,fontSize:15,color:C.ink}}>📋 รายการ ({(po.items||[]).length})</div>
            {mode==="dispute"&&<span style={{fontFamily:"'Sarabun',sans-serif",fontSize:11,color:"#9A3412",background:"#FFEDD5",padding:"4px 10px",borderRadius:18,fontWeight:700}}>กำลังแก้ไขจำนวนที่ได้รับจริง</span>}
          </div>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
            <thead><tr style={{background:C.bg}}>
              <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:40}}>#</th>
              <th style={{padding:"10px 12px",textAlign:"left",fontSize:11,color:C.ink3,fontWeight:700}}>รายการ</th>
              <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:70}}>หน่วย</th>
              <th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:90}}>สั่ง</th>
              {mode==="dispute"&&<th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:"#9A3412",fontWeight:800,width:120}}>ได้รับจริง *</th>}
              {(mode==="view"&&po.status==="disputed")&&<th style={{padding:"10px 12px",textAlign:"center",fontSize:11,color:"#9A3412",fontWeight:800,width:100}}>ได้จริง</th>}
              <th style={{padding:"10px 12px",textAlign:"right",fontSize:11,color:C.ink3,fontWeight:700,width:100}}>ราคา/หน่วย</th>
              <th style={{padding:"10px 12px",textAlign:"right",fontSize:11,color:C.ink3,fontWeight:700,width:110}}>รวม</th>
            </tr></thead>
            <tbody>
              {(po.items||[]).map((it,i)=>{
                const recv=mode==="dispute"?(+receivedQty[i]||0):it.received_qty;
                const short=recv!=null&&+recv<+it.qty;
                return <tr key={i} style={{borderTop:`1px solid ${C.lineLight}`}}>
                  <td style={{padding:"9px 12px",textAlign:"center",fontSize:12,color:C.ink4,fontWeight:700}}>{i+1}</td>
                  <td style={{padding:"9px 12px",fontSize:13,fontWeight:600,color:C.ink}}>{it.name}{it.note?<div style={{fontSize:11,color:C.ink4,marginTop:2}}>★ {it.note}</div>:null}</td>
                  <td style={{padding:"9px 12px",textAlign:"center",fontSize:12,color:C.ink2}}>{it.unit||"-"}</td>
                  <td style={{padding:"9px 12px",textAlign:"center",fontSize:14,fontWeight:800,color:C.ink}}>{it.qty}</td>
                  {mode==="dispute"&&<td style={{padding:"6px 8px",textAlign:"center"}}>
                    <input type="number" step="0.01" min="0" max={+it.qty} value={receivedQty[i]} onChange={e=>setReceivedQty(prev=>({...prev,[i]:e.target.value}))} style={{...iS,fontSize:14,padding:"6px 8px",height:34,textAlign:"center",fontWeight:800,color:short?C.red:C.ink,background:short?"#FEF2F2":C.white,border:`2px solid ${short?C.red:C.brandBorder}`,maxWidth:90,margin:"0 auto"}}/>
                  </td>}
                  {(mode==="view"&&po.status==="disputed")&&<td style={{padding:"9px 12px",textAlign:"center",fontSize:14,fontWeight:800,color:short?C.red:C.green}}>{recv!=null?recv:it.qty}{short&&<div style={{fontSize:10,color:C.red,fontWeight:700,marginTop:2}}>ขาด {(+it.qty-+recv).toFixed(2)}</div>}</td>}
                  <td style={{padding:"9px 12px",textAlign:"right",fontSize:13,color:C.ink2}}>฿{(+it.price_per_unit||0).toFixed(2)}</td>
                  <td style={{padding:"9px 12px",textAlign:"right",fontSize:14,fontWeight:800,color:C.brand}}>฿{(+it.line_total||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
                </tr>;
              })}
            </tbody>
          </table>
        </div>

        {/* Dispute note input */}
        {mode==="dispute"&&<div style={{background:C.white,borderRadius:14,padding:"14px 18px",marginBottom:14,border:`1px solid ${C.line}`}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:"#9A3412",marginBottom:6}}>💬 หมายเหตุที่ต้องการแจ้งต้นทาง</div>
          <textarea value={disputeNote} onChange={e=>setDisputeNote(e.target.value)} rows={2} placeholder="เช่น มะนาว 2 กก. ได้แค่ 1.5 กก. — สินค้าขาดส่ง" style={{...iS,fontSize:13,resize:"none",lineHeight:1.6}}/>
        </div>}
        {mode==="view"&&po.notes&&<div style={{padding:"12px 16px",background:C.yellowLight,borderRadius:12,fontSize:13,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:14,border:`1px solid #FDE68A`}}>📝 หมายเหตุ: {po.notes}</div>}

        {/* Total summary */}
        <div style={{background:C.white,borderRadius:14,padding:"14px 20px",marginBottom:14,border:`2px solid ${C.brandBorder}`,boxShadow:"0 2px 8px rgba(255,107,53,.12)"}}>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}><span>ยอดรวม</span><span>฿{(+po.subtotal||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>
          {(+po.vat>0)&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}><span>VAT</span><span>฿{(+po.vat).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span></div>}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",paddingTop:8,marginTop:6,borderTop:`2px dashed ${C.brandBorder}`}}>
            <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.brand}}>ยอดรวมทั้งสิ้น</span>
            <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:28,fontWeight:900,color:C.brand}}>฿{(+po.total||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
          </div>
        </div>

      </div>
    </div>

    {/* Footer — sticky action bar */}
    <div style={{background:C.white,borderTop:`1px solid ${C.line}`,padding:"14px 24px",display:"flex",gap:8,flexWrap:"wrap",justifyContent:"flex-end",alignItems:"center",flexShrink:0,boxShadow:"0 -4px 16px rgba(0,0,0,.08)"}}>
      {mode==="dispute"?<>
        <Btn v="ghost" onClick={()=>setMode("view")}>← กลับ</Btn>
        <Btn v="success" onClick={submitDisputeNow} disabled={busy||allMatch} loading={busy} s={{background:`linear-gradient(135deg,#EA580C,#C2410C)`,padding:"11px 22px",fontWeight:900}}>{allMatch?"ไม่มีรายการที่ขาด":"📤 ส่งกลับให้ต้นทางตรวจสอบ"}</Btn>
      </>:<>
        <Btn v="ghost" onClick={onClose}>ปิด</Btn>
        <Btn v="info" icon={I.print} onClick={()=>printPO(po,toBranch?.name,'print',fromBranch?.name)} s={{padding:"10px 16px"}}>🖨 พิมพ์</Btn>
        <Btn v="success" onClick={()=>printPO(po,toBranch?.name,'pdf',fromBranch?.name)} s={{padding:"10px 16px"}}>💾 ดาวน์โหลด PDF</Btn>
        {canCancelPO&&<Btn v="danger" onClick={onCancel} s={{padding:"10px 16px"}}>❌ ยกเลิก PO</Btn>}
        {canDelete&&<Btn onClick={onDelete} icon={I.trash} s={{padding:"10px 16px",background:po.status==="paid"?"#7F1D1D":C.redLight,color:po.status==="paid"?C.white:C.red,border:`1.5px solid ${po.status==="paid"?"#7F1D1D":"#FECACA"}`}}>🗑 ลบทิ้งถาวร</Btn>}
        {canEditFromView&&<Btn v="ghost" onClick={onEdit} icon={I.pencil} s={{padding:"10px 16px",background:"#FEF3C7",color:"#92400E"}}>✏️ แก้ไข</Btn>}
        {canDispute&&<Btn onClick={()=>setMode("dispute")} s={{background:`linear-gradient(135deg,#EA580C,#C2410C)`,padding:"11px 20px",fontWeight:900,color:C.white,boxShadow:"0 4px 14px rgba(234,88,12,.4)"}}>⚠️ สินค้าไม่ครบ</Btn>}
        {canConfirmReceive&&<Btn v="success" onClick={onConfirmReceive} loading={busy} disabled={busy} s={{background:`linear-gradient(135deg,${C.green},#059669)`,padding:"11px 22px",fontWeight:900,fontSize:14,boxShadow:`0 4px 14px ${C.green}55`}}>✅ ยืนยันรับสินค้าครบ</Btn>}
        {canAcceptDispute&&<Btn v="success" onClick={onAcceptDispute} loading={busy} disabled={busy} s={{background:`linear-gradient(135deg,${C.green},#059669)`,padding:"11px 22px",fontWeight:900,fontSize:14}}>✅ ยอมรับการแก้ไข</Btn>}
        {canPayNow&&<Btn onClick={onOpenPayment} s={{background:`linear-gradient(135deg,${C.blue},#2563EB)`,padding:"11px 22px",fontWeight:900,fontSize:14,color:C.white,boxShadow:`0 4px 14px ${C.blue}55`}}>💳 ชำระเงิน</Btn>}
      </>}
    </div>
  </div>;
}

// Payment popup with slip upload
function POPaymentModal({po,fromBranch,toBranch,onClose,onSubmit}){
  const[slipFile,setSlipFile]=useState(null);
  const[preview,setPreview]=useState(null);
  const[note,setNote]=useState("");
  const[saving,setSaving]=useState(false);
  async function pickFile(e){
    const f=e.target.files?.[0];if(!f)return;
    if(f.size>5*1024*1024){alert("ไฟล์ใหญ่เกิน 5MB");return;}
    const mime=await detectImageMime(f);
    if(!mime){alert("ไฟล์ที่เลือกไม่ใช่รูปภาพ (JPG / PNG / WebP / GIF) — กรุณาเลือกรูปสลิปจริงเท่านั้น");return;}
    if(preview)URL.revokeObjectURL(preview);
    setSlipFile(f);setPreview(URL.createObjectURL(f));
  }
  // Cleanup blob URL on unmount
  useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview);},[]);  // eslint-disable-line
  async function submit(){
    if(!slipFile){alert("กรุณาแนบสลิปการโอนเงิน");return;}
    setSaving(true);
    try{
      const mime=await detectImageMime(slipFile);
      if(!mime)throw new Error("ไฟล์ไม่ใช่รูปภาพที่ถูกต้อง");
      const ext=mime==="image/jpeg"?"jpg":mime==="image/png"?"png":mime==="image/webp"?"webp":"gif";
      const path=`${randId()}.${ext}`;
      const safeFile=new File([slipFile],`slip.${ext}`,{type:mime});
      // Upload to private bucket; only the storage path is returned
      const slipPath=await api.uploadSlip(safeFile,path);
      await onSubmit(slipPath,note);
    }catch(e){showErr("อัพโหลดสลิปไม่สำเร็จ",e);setSaving(false);}
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.75)",zIndex:6000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:C.white,borderRadius:18,width:"100%",maxWidth:520,boxShadow:"0 30px 80px rgba(0,0,0,.4)",overflow:"hidden"}}>
      <div style={{padding:"16px 22px",background:`linear-gradient(135deg,${C.blue},#2563EB)`,color:C.white,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:28}}>💳</div>
          <div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900}}>ชำระเงิน</div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:11,opacity:.9}}>{po.po_number||""} · {fromBranch?.name||""} → {toBranch?.name||""}</div>
          </div>
        </div>
        <button onClick={onClose} disabled={saving} style={{background:"rgba(255,255,255,.18)",border:"none",borderRadius:10,width:32,height:32,cursor:saving?"not-allowed":"pointer",color:C.white,fontSize:18}}>✕</button>
      </div>
      <div style={{padding:22}}>
        <div style={{background:C.brandLight,borderRadius:12,padding:"14px 18px",marginBottom:16,border:`2px solid ${C.brandBorder}`,textAlign:"center"}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.brand,fontWeight:700,marginBottom:4}}>ยอดที่ต้องชำระ</div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:32,fontWeight:900,color:C.brand}}>฿{(+po.total||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:C.ink2,marginBottom:6}}>📎 สลิปการโอนเงิน *</div>
          {preview?<div style={{position:"relative"}}>
            <img src={preview} alt="slip" style={{width:"100%",maxHeight:280,objectFit:"contain",borderRadius:10,border:`2px solid ${C.green}`,background:C.bg}}/>
            <button onClick={()=>{setSlipFile(null);setPreview(null);}} disabled={saving} style={{position:"absolute",top:6,right:6,background:C.red,color:C.white,border:"none",borderRadius:8,padding:"5px 10px",cursor:saving?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>เปลี่ยนรูป</button>
          </div>:<label style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:"30px 16px",border:`2.5px dashed ${C.brandBorder}`,borderRadius:12,cursor:"pointer",background:C.bg,textAlign:"center"}}>
            <div style={{fontSize:36,marginBottom:6}}>📤</div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,fontWeight:700,color:C.brand}}>กดเพื่อเลือกรูปสลิป</div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:11,color:C.ink4,marginTop:3}}>JPG / PNG · ไม่เกิน 5MB</div>
            <input type="file" accept="image/*" onChange={pickFile} style={{display:"none"}}/>
          </label>}
        </div>
        <div style={{marginBottom:18}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:C.ink2,marginBottom:6}}>หมายเหตุ (ไม่บังคับ)</div>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="เช่น โอนผ่าน SCB เลขที่อ้างอิง..." style={{...iS,fontSize:13}}/>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={onClose} disabled={saving} s={{padding:"11px 16px"}}>ยกเลิก</Btn>
          <Btn onClick={submit} loading={saving} disabled={!slipFile||saving} full icon={I.check} s={{padding:"11px",fontSize:14,fontWeight:900,background:`linear-gradient(135deg,${C.green},#059669)`,color:C.white,boxShadow:`0 4px 14px ${C.green}55`}}>ยืนยันชำระเงิน</Btn>
        </div>
      </div>
    </div>
  </div>;
}

function POFormModal({branch,fromBranch,editPO,ings,currentUser,onClose,onSaved}){
  const today=todayBkk();
  const[items,setItems]=useState(editPO?.items||[]);
  const[poDate,setPoDate]=useState(editPO?.po_date||today);
  const[notes,setNotes]=useState(editPO?.notes||"");
  const[status,setStatus]=useState(editPO?.status||"open");
  const[poNumber,setPoNumber]=useState(editPO?.po_number||genPONumber(fromBranch?.id));
  const[search,setSearch]=useState("");
  const[saving,setSaving]=useState(false);
  const[vatPct,setVatPct]=useState(editPO?(editPO.subtotal>0?+((editPO.vat/editPO.subtotal)*100).toFixed(2):0):0);

  // Filter ingredients available for this branch (visible_branches)
  const branchIngs=useMemo(()=>{
    return ings.filter(i=>{
      const vb=i.visible_branches||[];
      return vb.length===0||vb.includes(branch.id);
    });
  },[ings,branch.id]);

  const searchResults=useMemo(()=>{
    if(!search.trim())return[];
    const q=search.toLowerCase();
    const used=new Set(items.map(it=>it.ingredient_id));
    return branchIngs.filter(i=>!used.has(i.id)&&(i.name.toLowerCase().includes(q)||(i.category||"").toLowerCase().includes(q))).slice(0,30);
  },[search,branchIngs,items]);

  function addIng(ing){
    setItems(prev=>[...prev,{
      ingredient_id:ing.id,
      name:ing.name,
      unit:ing.buy_unit||"หน่วย",
      qty:1,
      price_per_unit:+ing.buy_price||0,
      line_total:+ing.buy_price||0,
      note:"",
    }]);
    setSearch("");
  }
  function updateItem(idx,field,value){
    setItems(prev=>prev.map((it,i)=>{
      if(i!==idx)return it;
      const next={...it,[field]:value};
      if(field==="qty"||field==="price_per_unit")next.line_total=(+next.qty||0)*(+next.price_per_unit||0);
      return next;
    }));
  }
  function removeItem(idx){setItems(prev=>prev.filter((_,i)=>i!==idx));}

  const subtotal=items.reduce((s,i)=>s+(+i.line_total||0),0);
  const vat=subtotal*(+vatPct||0)/100;
  const total=subtotal+vat;

  async function save(){
    if(items.length===0){alert("กรุณาเพิ่มรายการอย่างน้อย 1 รายการ");return;}
    setSaving(true);
    try{
      // Editing preserves status — to actually accept a dispute the creator uses the dedicated
      // "✅ ยอมรับการแก้ไข" button (acceptDispute), which has its own confirm + recompute.
      const payload={
        po_number:poNumber,
        branch_id:branch.id,
        from_branch_id:editPO?.from_branch_id||fromBranch?.id||null,
        po_date:poDate,
        status,
        items:items.map(it=>({...it,line_total:round2((+it.qty||0)*(+it.price_per_unit||0))})),
        subtotal:round2(subtotal),
        vat:round2(vat),
        total:round2(total),
        notes:notes||null,
        created_by:editPO?.created_by||currentUser?.username||null,
        updated_at:new Date().toISOString(),
      };
      if(editPO){await api.updatePO(editPO.id,payload);}
      else{await api.addPO(payload);}
      await onSaved();
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }

  return <Modal title={`${editPO?"✏️ แก้ไข":"➕ สร้าง"}เอกสาร PO — ${fromBranch?.name||""} → ${branch.name}`} onClose={onClose} extraWide>
    <div style={{display:"grid",gridTemplateColumns:"1.2fr 1fr 1fr",gap:10,marginBottom:14}}>
      <Inp label="เลขที่ PO" value={poNumber} onChange={e=>setPoNumber(e.target.value)}/>
      <Inp label="วันที่" type="date" value={poDate} onChange={e=>setPoDate(e.target.value)}/>
      <Field label="สถานะ">
        <select value={status} onChange={e=>setStatus(e.target.value)} style={{...iS,appearance:"none"}}>
          <option value="open">⏳ เปิดอยู่</option>
          <option value="received">✅ รับสินค้าแล้ว</option>
          <option value="cancelled">❌ ยกเลิก</option>
        </select>
      </Field>
    </div>

    {/* Ingredient search */}
    <div style={{marginBottom:8,position:"relative"}}>
      <div style={{fontSize:12,fontWeight:700,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>🔍 ค้นหาวัตถุดิบเพื่อเพิ่ม</div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="พิมพ์ชื่อวัตถุดิบ..." style={{...iS,fontSize:14,padding:"10px 14px"}}/>
      {searchResults.length>0&&<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:10,background:C.white,border:`1.5px solid ${C.brandBorder}`,borderRadius:10,marginTop:4,boxShadow:"0 8px 24px rgba(0,0,0,.12)",maxHeight:280,overflowY:"auto"}}>
        {searchResults.map(ing=><button key={ing.id} onClick={()=>addIng(ing)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",width:"100%",background:"none",border:"none",borderBottom:`1px solid ${C.lineLight}`,cursor:"pointer",textAlign:"left",fontFamily:"'Sarabun',sans-serif",transition:"background .1s"}} onMouseEnter={e=>e.currentTarget.style.background=C.brandLight} onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
          <Ic d={I.leaf} s={16} c={C.brand}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink}}>{ing.name}</div>
            <div style={{fontSize:11,color:C.ink4}}>{ing.category} · {ing.buy_unit||"หน่วย"} · ฿{(+ing.buy_price||0).toFixed(2)}/{ing.buy_unit||"หน่วย"}</div>
          </div>
          <Ic d={I.plus} s={14} c={C.green}/>
        </button>)}
      </div>}
      {search&&searchResults.length===0&&<div style={{position:"absolute",top:"100%",left:0,right:0,zIndex:10,background:C.white,border:`1.5px solid ${C.line}`,borderRadius:10,marginTop:4,padding:"14px 16px",fontSize:13,color:C.ink4,fontFamily:"'Sarabun',sans-serif",textAlign:"center"}}>ไม่พบวัตถุดิบที่ตรงกัน หรือถูกเพิ่มแล้ว</div>}
    </div>

    {/* Items table */}
    <div style={{marginTop:14,marginBottom:6,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div style={{fontSize:12,fontWeight:700,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>📋 รายการในเอกสาร <span style={{color:C.brand,fontWeight:900}}>({items.length})</span> <span style={{fontSize:11,fontWeight:500,color:C.ink4}}>เพิ่มได้ไม่จำกัด</span></div>
      {items.length>0&&<button onClick={()=>setItems([])} style={{background:"transparent",border:"none",color:C.red,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>ล้างทั้งหมด</button>}
    </div>
    <div style={{marginBottom:14,maxHeight:520,overflowY:"auto",border:`1px solid ${C.line}`,borderRadius:10}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
        <thead style={{position:"sticky",top:0,zIndex:1}}>
          <tr style={{background:C.bg}}>
            <th style={{padding:"8px 10px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:40}}>#</th>
            <th style={{padding:"8px 10px",textAlign:"left",fontSize:11,color:C.ink3,fontWeight:700}}>รายการ</th>
            <th style={{padding:"8px 10px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:80}}>หน่วย</th>
            <th style={{padding:"8px 10px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:90}}>จำนวน</th>
            <th style={{padding:"8px 10px",textAlign:"center",fontSize:11,color:C.ink3,fontWeight:700,width:120}}>ราคา/หน่วย</th>
            <th style={{padding:"8px 10px",textAlign:"right",fontSize:11,color:C.ink3,fontWeight:700,width:120}}>รวม</th>
            <th style={{width:36}}></th>
          </tr>
        </thead>
        <tbody>
          {items.length===0&&<tr><td colSpan={7} style={{padding:"30px 20px",textAlign:"center",color:C.ink4,fontSize:13}}>ยังไม่มีรายการ — ค้นหาและเพิ่มวัตถุดิบจากด้านบน</td></tr>}
          {items.map((it,idx)=><tr key={idx} style={{borderTop:`1px solid ${C.lineLight}`}}>
            <td style={{padding:"6px 10px",textAlign:"center",fontSize:12,color:C.ink4,fontWeight:700}}>{idx+1}</td>
            <td style={{padding:"6px 10px"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.ink}}>{it.name}</div>
              <input value={it.note||""} onChange={e=>updateItem(idx,"note",e.target.value)} placeholder="หมายเหตุ (ถ้ามี)" style={{...iS,fontSize:11,padding:"3px 8px",height:22,marginTop:3,background:"transparent",border:`1px dashed ${C.line}`}}/>
            </td>
            <td style={{padding:"6px 10px"}}>
              <input value={it.unit} onChange={e=>updateItem(idx,"unit",e.target.value)} style={{...iS,fontSize:12,padding:"5px 8px",height:30,textAlign:"center"}}/>
            </td>
            <td style={{padding:"6px 10px"}}>
              <input type="number" step="0.01" value={it.qty} onChange={e=>updateItem(idx,"qty",+e.target.value)} style={{...iS,fontSize:13,padding:"5px 8px",height:30,textAlign:"center",fontWeight:700}}/>
            </td>
            <td style={{padding:"6px 10px"}}>
              <input type="number" step="0.01" value={it.price_per_unit} onChange={e=>updateItem(idx,"price_per_unit",+e.target.value)} style={{...iS,fontSize:13,padding:"5px 8px",height:30,textAlign:"right"}}/>
            </td>
            <td style={{padding:"6px 10px",textAlign:"right",fontWeight:800,fontSize:14,color:C.brand}}>฿{(+it.line_total||0).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</td>
            <td style={{padding:"6px 4px",textAlign:"center"}}>
              <button onClick={()=>removeItem(idx)} title="ลบ" style={{background:C.redLight,border:"none",borderRadius:6,padding:"4px 6px",cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={12} c={C.red}/></button>
            </td>
          </tr>)}
        </tbody>
      </table>
    </div>

    {/* Notes + totals */}
    <div style={{display:"grid",gridTemplateColumns:"1fr 320px",gap:14}}>
      <div>
        <div style={{fontSize:12,fontWeight:700,color:C.ink2,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>หมายเหตุ</div>
        <textarea value={notes} onChange={e=>setNotes(e.target.value)} rows={3} placeholder="—" style={{...iS,fontSize:13,resize:"none"}}/>
      </div>
      <div style={{background:C.bg,borderRadius:12,padding:"14px 16px",border:`1px solid ${C.line}`}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:6}}>
          <span>ยอดรวม ({items.length} รายการ)</span>
          <span style={{fontWeight:700}}>฿{subtotal.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:6,alignItems:"center"}}>
          <span>VAT (%)</span>
          <input type="number" step="0.1" value={vatPct} onChange={e=>setVatPct(+e.target.value)} style={{...iS,fontSize:12,padding:"4px 8px",height:26,width:70,textAlign:"right"}}/>
        </div>
        {vat>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:6}}>
          <span>VAT</span>
          <span>฿{vat.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>}
        <div style={{paddingTop:8,marginTop:8,borderTop:`2px solid ${C.brandBorder}`,display:"flex",justifyContent:"space-between",alignItems:"center",fontFamily:"'Sarabun',sans-serif"}}>
          <span style={{fontSize:14,fontWeight:800,color:C.brand}}>ยอดรวมทั้งสิ้น</span>
          <span style={{fontSize:22,fontWeight:900,color:C.brand}}>฿{total.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}</span>
        </div>
      </div>
    </div>

    <div style={{display:"flex",justifyContent:"flex-end",gap:8,paddingTop:14,borderTop:`1px solid ${C.line}`,marginTop:14}}>
      <Btn v="ghost" onClick={onClose}>ยกเลิก</Btn>
      <Btn onClick={save} loading={saving} disabled={items.length===0} icon={I.check}>{editPO?"บันทึกการแก้ไข":"บันทึกเอกสาร PO"}</Btn>
    </div>
  </Modal>;
}

// ══════════════════════════════════════════════════════
// ── SUMMARY TAB ───────────────────────────────────────
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// ── COST SNAPSHOT SECTION (saved daily summaries) ────
// ══════════════════════════════════════════════════════
function CostSummarySection({branches,currentBranch,currentUser,menus,ings}){
  const isCentral=currentBranch?.type==="central";
  const today=todayBkk();
  const ago=(d=>{const t=new Date();t.setDate(t.getDate()-d);return t.toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});})(30);
  const[snaps,setSnaps]=useState([]);const[loading,setLoading]=useState(false);
  const[filterBranch,setFilterBranch]=useState(isCentral?"":String(currentBranch?.id||""));
  const[dateFrom,setDateFrom]=useState(ago);const[dateTo,setDateTo]=useState(today);
  const[busy,setBusy]=useState(null);  // snapshot id being acted on
  const canEdit=hasPerm(currentUser,"summary")||hasPerm(currentUser,"fs_sales");

  async function load(){
    setLoading(true);
    try{
      const filters={dateFrom,dateTo};
      if(filterBranch)filters.branchId=+filterBranch;
      else if(!isCentral&&currentBranch)filters.branchId=currentBranch.id;
      setSnaps(await api.getCostSnapshots(filters));
    }catch(e){showErr("โหลดข้อมูลไม่สำเร็จ",e);}
    setLoading(false);
  }
  useEffect(()=>{load();},[filterBranch,dateFrom,dateTo,currentBranch?.id]);

  async function regenerate(s){
    if(!await confirmDlg({title:"แก้ไข (คำนวณใหม่)",message:`คำนวณยอด/ต้นทุนใหม่จากข้อมูลขายของวันที่ ${s.snapshot_date} ?\n\nระบบจะใช้ราคาวัตถุดิบและสูตรเมนูปัจจุบัน — ผลลัพธ์จะอัพเดททับสรุปเดิมของวันนี้`,confirmLabel:"คำนวณใหม่"}))return;
    setBusy(s.id);
    try{
      await generateCostSnapshot({branchId:s.branch_id,date:s.snapshot_date,menus,ings,currentUser});
      await load();
    }catch(e){showErr("คำนวณใหม่ไม่สำเร็จ",e);}
    setBusy(null);
  }
  async function del(s){
    if(!await confirmDlg({title:"ลบสรุปต้นทุน",message:`ลบสรุปของวันที่ ${s.snapshot_date}?\n(ข้อมูลขายดิบไม่กระทบ — ลบแค่สรุปนี้เท่านั้น)`,danger:true,confirmLabel:"ลบทิ้ง"}))return;
    setBusy(s.id);
    try{await api.deleteCostSnapshot(s.id);await load();}
    catch(e){showErr("ลบไม่สำเร็จ",e);}
    setBusy(null);
  }

  const sumRev=round2(snaps.reduce((s,x)=>s+(+x.total_revenue||0),0));
  const sumCost=round2(snaps.reduce((s,x)=>s+(+x.total_cost||0),0));
  const sumPct=sumRev>0?round2(sumCost/sumRev*100):0;
  const branchById=Object.fromEntries(branches.map(b=>[b.id,b]));

  return <div style={{marginTop:30,paddingTop:24,borderTop:`2px dashed ${C.brandBorder}`}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14,flexWrap:"wrap",gap:10}}>
      <div>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900,color:C.ink,margin:0,display:"flex",alignItems:"center",gap:10}}>
          <span style={{fontSize:22}}>📊</span> สรุปต้นทุนรายวัน (Saved Snapshots)
        </h3>
        <p style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.ink4,margin:"3px 0 0"}}>บันทึกจากแท็บ "ยอดขายรายเมนูตามระบบ FOODSTORY" — กดปุ่ม 💾 บนแถบ "📦 รายการที่นำเข้า" เพื่อเพิ่มสรุปใหม่</p>
      </div>
    </div>

    {/* Filter row */}
    <Card style={{padding:"12px 16px",marginBottom:14,background:C.bg}}>
      <div style={{display:"grid",gridTemplateColumns:isCentral?"1.5fr 1fr 1fr auto":"1fr 1fr auto",gap:10,alignItems:"end"}}>
        {isCentral&&<div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>สาขา</div>
          <select value={filterBranch} onChange={e=>setFilterBranch(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px",appearance:"none"}}>
            <option value="">— ทุกสาขา —</option>
            {branches.filter(b=>b.active!==false).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>}
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ตั้งแต่วันที่</div>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,fontWeight:700,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ถึง</div>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...iS,fontSize:13,padding:"8px 10px"}}/>
        </div>
        <Btn v="ghost" onClick={load} icon={I.refresh} s={{padding:"8px 14px",fontSize:12}}>รีเฟรช</Btn>
      </div>
      {snaps.length>0&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px dashed ${C.line}`,display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"'Sarabun',sans-serif",color:C.ink3,flexWrap:"wrap",gap:6}}>
        <span>📑 พบ <b style={{color:C.ink}}>{snaps.length}</b> สรุป</span>
        <span>💰 ยอดขายรวม <b style={{color:C.brand,fontSize:14}}>฿{sumRev.toLocaleString(undefined,{minimumFractionDigits:2})}</b></span>
        <span>📦 ต้นทุนรวม <b style={{color:C.red,fontSize:14}}>฿{sumCost.toLocaleString(undefined,{minimumFractionDigits:2})}</b></span>
        <span>📊 % เฉลี่ย <b style={{color:sumPct<=30?C.green:sumPct<=40?C.yellow:sumPct<=50?"#EA580C":C.red,fontSize:14}}>{sumPct}%</b></span>
      </div>}
    </Card>

    {/* Table */}
    {loading?<Loading text="โหลดสรุปต้นทุน..."/>:snaps.length===0?<Card style={{padding:"40px 20px",textAlign:"center"}}>
      <div style={{fontSize:42,marginBottom:6}}>📭</div>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,color:C.ink3,fontWeight:600}}>ยังไม่มีสรุปต้นทุนในช่วงนี้</div>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:11,color:C.ink4,marginTop:4}}>ไปแท็บ "ยอดขายรายเมนูตามระบบ FOODSTORY" → กด 💾 บันทึกสรุป บน batch ที่ต้องการ</div>
    </Card>:<Card style={{padding:0,overflow:"hidden"}}>
      <div style={{overflowX:"auto"}}>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
          <thead>
            <tr style={{background:"#0F172A"}}>
              {["วันที่","สาขา","ยอดขาย","ต้นทุน","%","จัดการ"].map((h,i)=><th key={h} style={{padding:"11px 14px",textAlign:i>=2&&i<=4?"right":"left",fontSize:12,fontWeight:700,color:"#F8FAFC",whiteSpace:"nowrap"}}>{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {snaps.map((s,idx)=>{
              const br=branchById[s.branch_id];
              const pct=+s.cost_pct||0;
              const pctColor=pct<=30?C.green:pct<=40?C.yellow:pct<=50?"#EA580C":C.red;
              return <tr key={s.id} style={{borderTop:`1px solid ${C.lineLight}`,background:idx%2===0?C.white:"#FAFBFC"}}>
                <td style={{padding:"11px 14px",fontSize:13,color:C.ink,fontWeight:700,whiteSpace:"nowrap"}}>
                  {s.snapshot_date}
                  <div style={{fontSize:10,color:C.ink4,fontWeight:500,marginTop:1}}>{s.menu_count||0} เมนู · {+s.total_qty||0} ครั้ง</div>
                </td>
                <td style={{padding:"11px 14px",fontSize:13,color:C.ink,fontWeight:700}}>{br?.name||"—"}</td>
                <td style={{padding:"11px 14px",fontSize:14,fontWeight:900,color:C.brand,textAlign:"right",whiteSpace:"nowrap"}}>฿{(+s.total_revenue||0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                <td style={{padding:"11px 14px",fontSize:14,fontWeight:800,color:C.red,textAlign:"right",whiteSpace:"nowrap"}}>฿{(+s.total_cost||0).toLocaleString(undefined,{minimumFractionDigits:2})}</td>
                <td style={{padding:"11px 14px",textAlign:"right",whiteSpace:"nowrap"}}>
                  <span style={{fontSize:13,fontWeight:800,color:pctColor,background:`${pctColor}22`,padding:"3px 10px",borderRadius:18}}>{pct}%</span>
                </td>
                <td style={{padding:"8px 12px",textAlign:"center",whiteSpace:"nowrap"}}>
                  <div style={{display:"inline-flex",gap:4}}>
                    <button onClick={()=>exportSnapshotXlsx(s,br?.name)} title="พิมพ์เป็น Excel" style={{background:C.greenLight,border:`1px solid #86EFAC`,borderRadius:7,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:11,color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>📊 Excel</button>
                    {canEdit&&<button onClick={()=>regenerate(s)} disabled={busy===s.id} title="คำนวณใหม่จากข้อมูลขายปัจจุบัน" style={{background:"#FEF3C7",border:`1px solid #FDE68A`,borderRadius:7,padding:"5px 8px",cursor:busy===s.id?"not-allowed":"pointer",display:"flex",alignItems:"center",opacity:busy===s.id?.6:1}}><Ic d={I.pencil} s={13} c="#92400E"/></button>}
                    {canEdit&&<button onClick={()=>del(s)} disabled={busy===s.id} title="ลบสรุปนี้" style={{background:C.redLight,border:`1px solid #FECACA`,borderRadius:7,padding:"5px 8px",cursor:busy===s.id?"not-allowed":"pointer",display:"flex",alignItems:"center",opacity:busy===s.id?.6:1}}><Ic d={I.trash} s={13} c={C.red}/></button>}
                  </div>
                </td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
    </Card>}
  </div>;
}

function SumTab({menus,ings,currentBranch,reloadHistory,reloadOrders,currentUser,branches=[],suppliers=[]}){
  const[dateFrom,setDateFrom]=useState(todayStr);const[dateTo,setDateTo]=useState(todayStr);
  const[q,setQ]=useState("");const[selected,setSelected]=useState({});
  const[sortCol,setSortCol]=useState("margin");const[sortDir,setSortDir]=useState("desc");
  const[saving,setSaving]=useState(false);const[sendingOrder,setSendingOrder]=useState(false);
  const[xlsxResult,setXlsxResult]=useState(null); // {matched, unmatched}
  const xlsxRef=useRef();
  const canE=hasPerm(currentUser,"summary");const canOrder=hasPerm(currentUser,"orders");

  function handleXlsxUpload(e){
    const file=e.target.files?.[0];if(!file)return;
    const reader=new FileReader();
    reader.onload=ev=>{
      try{
        const wb=XLSX.read(ev.target.result,{type:"array"});
        const ws=wb.Sheets[wb.SheetNames[0]];
        // อ่านเป็น array of arrays เพื่อดึงคอลัม B (index 1) และ G (index 6) ตรงๆ
        const rows=XLSX.utils.sheet_to_json(ws,{header:1,defval:""});
        if(rows.length<2){alert("ไฟล์ว่างเปล่าหรือมีแค่หัวตาราง");return;}
        const matched=[],unmatched=[];
        const newSel={...selected};
        // เริ่มจาก row index 1 (ข้ามแถวหัวตาราง)
        rows.slice(1).forEach(row=>{
          const rawName=String(row[1]||"").trim();   // คอลัม B
          const qty=+(String(row[6]||"0").replace(/,/g,""))||0; // คอลัม G
          if(!rawName)return;
          // จับคู่ชื่อแบบตรงตัวก่อน แล้วค่อย partial match
          const menu=menus.find(m=>m.name.toLowerCase()===rawName.toLowerCase())
            ||menus.find(m=>rawName.toLowerCase().includes(m.name.toLowerCase()))
            ||menus.find(m=>m.name.toLowerCase().includes(rawName.toLowerCase()));
          if(menu){newSel[menu.id]=(+(newSel[menu.id]||0))+qty;matched.push({name:rawName,menuName:menu.name,qty});}
          else unmatched.push({name:rawName,qty});
        });
        setSelected(newSel);
        setXlsxResult({matched,unmatched});
      }catch(err){alert("อ่านไฟล์ไม่สำเร็จ: "+err.message);}
    };
    reader.readAsArrayBuffer(file);
    e.target.value="";
  }
  function onSort(col){if(sortCol===col)setSortDir(d=>d==="asc"?"desc":"asc");else{setSortCol(col);setSortDir("desc");}}
  const allItems=useMemo(()=>menus.map(m=>{const c=menuCost(m,ings);const p=m.price-c;const mg=m.price>0?p/m.price*100:0;return{...m,cost:c,profit:p,margin:mg};}),[menus,ings]);
  const searchResults=useMemo(()=>allItems.filter(m=>m.name.toLowerCase().includes(q.toLowerCase())&&!selected[m.id]),[allItems,q,selected]);
  const selectedItems=useMemo(()=>allItems.filter(m=>selected[m.id]!==undefined),[allItems,selected]);
  const sortedSelected=useMemo(()=>[...selectedItems].sort((a,b)=>{let va=a[sortCol]??0,vb=b[sortCol]??0;if(sortCol==="soldQty"){va=+(selected[a.id]||0);vb=+(selected[b.id]||0);}return sortDir==="asc"?va-vb:vb-va;}),[selectedItems,sortCol,sortDir,selected]);
  const stats=useMemo(()=>({total:selectedItems.length,avg:selectedItems.length?selectedItems.reduce((s,i)=>s+i.margin,0)/selectedItems.length:0,totalRev:selectedItems.reduce((s,i)=>s+(+(selected[i.id]||0))*i.price,0),totalProfit:selectedItems.reduce((s,i)=>s+(+(selected[i.id]||0))*(i.price-i.cost),0)}),[selectedItems,selected]);

  async function saveSummary(){
    const snap=sortedSelected.map(m=>({name:m.name,category:m.category,price:m.price,cost:m.cost,margin:m.margin,soldQty:+(selected[m.id]||0),totalRevenue:(+(selected[m.id]||0))*m.price,totalCost:(+(selected[m.id]||0))*m.cost,totalProfit:(+(selected[m.id]||0))*(m.price-m.cost),ingredients:m.ingredients||[]}));
    setSaving(true);try{await api.addCostHist({date_from:dateFrom,date_to:dateTo,items:snap,saved_by:currentUser.username,saved_at:nowStr(),branch_id:currentBranch.id,branch_name:currentBranch.name});await reloadHistory();alert("✅ บันทึกสรุปต้นทุนสำเร็จ!");}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}setSaving(false);
  }

  // คำนวณวัตถุดิบที่ต้องสั่ง จากยอดขาย
  function calcOrderItems(){
    const ingMap={};
    sortedSelected.forEach(m=>{
      const qty=+(selected[m.id]||0);
      if(!qty)return;
      (m.ingredients||[]).forEach(mi=>{
        const ing=ings.find(g=>g.id===mi.ingredientId);
        if(!ing)return;
        const totalGram=mi.amountGram*qty;
        if(!ingMap[ing.id])ingMap[ing.id]={ingId:ing.id,name:ing.name,unit:ing.buy_unit,pricePerGram:ing.price_per_gram,buyPrice:ing.buy_price,convertToGram:ing.convert_to_gram,supplierId:ing.supplier_id,supplierName:ing.supplier_name||"ไม่ระบุ",totalGram:0};
        ingMap[ing.id].totalGram+=totalGram;
      });
    });
    return Object.values(ingMap).map(i=>({...i,qtyNeeded:+(i.totalGram/i.convertToGram).toFixed(2),estimatedCost:+(i.totalGram*i.pricePerGram).toFixed(2)}));
  }

  async function sendOrderToCentral(){
    const orderItems=calcOrderItems();
    if(!orderItems.length){alert("ไม่มีวัตถุดิบที่ต้องสั่ง");return;}
    // group by supplier
    const supMap={};
    orderItems.forEach(i=>{const k=i.supplierId||"none";if(!supMap[k])supMap[k]={supplierId:i.supplierId,supplierName:i.supplierName,items:[]};supMap[k].items.push(i);});
    setSendingOrder(true);
    try{
      for(const sup of Object.values(supMap)){
        await api.addOrder({branch_id:currentBranch.id,branch_name:currentBranch.name,supplier_id:sup.supplierId,supplier_name:sup.supplierName,items:sup.items,status:"pending",requested_by:currentUser.username,requested_at:nowStr(),note:`${dateFrom} - ${dateTo}`});
      }
      await reloadOrders();alert("✅ ส่งรายการสั่งวัตถุดิบไปครัวกลางสำเร็จ!");
    }catch(e){alert("ส่งไม่สำเร็จ: "+e.message);}setSendingOrder(false);
  }

  return <div>
    <div style={{display:"flex",gap:14,marginBottom:20,flexWrap:"wrap",alignItems:"flex-end"}}>
      <div style={{background:C.white,borderRadius:12,padding:"12px 16px",border:`1px solid ${C.line}`,display:"flex",gap:12,alignItems:"center",flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:6}}><Ic d={I.calendar} s={16} c={C.brand}/><span style={{fontSize:13,fontWeight:600,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>ช่วงวันที่</span></div>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} style={{...iS,width:155,fontSize:13,padding:"7px 10px"}}/>
          <span style={{color:C.ink3}}>ถึง</span>
          <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} style={{...iS,width:155,fontSize:13,padding:"7px 10px"}}/>
        </div>
      </div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
        <input ref={xlsxRef} type="file" accept=".xlsx,.xls,.csv" style={{display:"none"}} onChange={handleXlsxUpload}/>
        <Btn v="info" icon={I.ul} onClick={()=>xlsxRef.current?.click()}>แนบ Excel ยอดขาย</Btn>
        {canE&&<Btn onClick={saveSummary} icon={I.save} v="success" disabled={selectedItems.length===0} loading={saving}>บันทึกสรุป</Btn>}
        {canOrder&&<Btn onClick={sendOrderToCentral} icon={I.send} v="teal" disabled={selectedItems.length===0} loading={sendingOrder}>ส่งสั่งวัตถุดิบ</Btn>}
      </div>
    </div>
    {xlsxResult&&<div style={{background:C.white,borderRadius:14,border:`1px solid ${C.line}`,padding:"14px 18px",marginBottom:16,boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}><Ic d={I.ul} s={16} c={C.blue}/><span style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>ผลการอ่านไฟล์ Excel</span></div>
        <button onClick={()=>setXlsxResult(null)} style={{background:"none",border:"none",cursor:"pointer",color:C.ink4,fontSize:18,lineHeight:1}}>×</button>
      </div>
      <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:xlsxResult.unmatched.length>0?10:0}}>
        <div style={{background:C.greenLight,border:`1px solid ${C.green}44`,borderRadius:10,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>✅</span>
          <div><div style={{fontWeight:800,fontSize:15,color:C.green}}>{xlsxResult.matched.length} เมนู</div><div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>จับคู่สำเร็จ</div></div>
        </div>
        {xlsxResult.unmatched.length>0&&<div style={{background:C.yellowLight,border:`1px solid ${C.yellow}44`,borderRadius:10,padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:20}}>⚠️</span>
          <div><div style={{fontWeight:800,fontSize:15,color:C.yellow}}>{xlsxResult.unmatched.length} เมนู</div><div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>ไม่พบในระบบ</div></div>
        </div>}
      </div>
      {xlsxResult.matched.length>0&&<div style={{marginBottom:8}}>
        <div style={{fontSize:11,fontWeight:700,color:C.green,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>จับคู่สำเร็จ:</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {xlsxResult.matched.map((m,i)=><span key={i} style={{background:C.greenLight,border:`1px solid ${C.green}44`,borderRadius:6,padding:"2px 8px",fontSize:11,color:C.green,fontFamily:"'Sarabun',sans-serif"}}>{m.menuName} ({m.qty} จาน)</span>)}
        </div>
      </div>}
      {xlsxResult.unmatched.length>0&&<div>
        <div style={{fontSize:11,fontWeight:700,color:"#B45309",marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>⚠️ ไม่พบเมนูต่อไปนี้ในระบบ — กรุณาเพิ่มเมนูก่อนนำเข้าข้อมูล:</div>
        <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
          {xlsxResult.unmatched.map((m,i)=><div key={i} style={{background:"#FEF3C7",border:"1px solid #FCD34D",borderRadius:8,padding:"4px 10px",fontSize:11,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:5}}>
            <span style={{color:"#92400E",fontWeight:700}}>❌ {m.name}</span>
            <span style={{color:"#B45309"}}>({m.qty} จาน)</span>
          </div>)}
        </div>
      </div>}
    </div>}
    <Card style={{padding:"16px 20px",marginBottom:20}}>
      <div style={{fontSize:14,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:10}}>ค้นหาและเพิ่มเมนูที่ต้องการสรุป</div>
      <div style={{position:"relative",marginBottom:10}}><span style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)"}}><Ic d={I.search} s={16} c={C.ink4}/></span><input value={q} onChange={e=>setQ(e.target.value)} placeholder="พิมพ์ชื่อเมนู..." style={{...iS,paddingLeft:40}}/></div>
      {q&&<div style={{maxHeight:200,overflowY:"auto",background:C.bg,borderRadius:10,border:`1px solid ${C.line}`,padding:8}}>
        {searchResults.length===0?<div style={{textAlign:"center",padding:"16px",color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontSize:13}}>ไม่พบเมนู</div>
        :searchResults.map(m=><div key={m.id} onClick={()=>{setSelected(p=>({...p,[m.id]:0}));setQ("");}} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",borderRadius:8,marginBottom:4,cursor:"pointer",background:C.white,border:`1px solid ${C.line}`,transition:"all .15s"}} onMouseEnter={e=>e.currentTarget.style.background=C.brandLight} onMouseLeave={e=>e.currentTarget.style.background=C.white}>
          <div style={{display:"flex",alignItems:"center",gap:8}}>{m.image&&<img src={m.image} alt={m.name} style={{width:28,height:28,objectFit:"cover",borderRadius:5}}/>}<span style={{fontWeight:600,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{m.name}</span></div>
          <div style={{display:"flex",alignItems:"center",gap:10}}><span style={{fontSize:13,color:C.brand,fontWeight:700}}>฿{m.price}</span><Btn icon={I.plus} s={{padding:"4px 10px",fontSize:12}}>เพิ่ม</Btn></div>
        </div>)}
      </div>}
    </Card>
    {selectedItems.length>0&&<>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(200px,1fr))",gap:14,marginBottom:20}}>
        {[{l:"เมนูที่เลือก",v:stats.total,u:"เมนู",icon:I.fire,c:C.blue},{l:"กำไรเฉลี่ย",v:stats.avg.toFixed(1),u:"%",icon:I.chart,c:C.brand},{l:"รายรับรวม",v:`฿${stats.totalRev.toFixed(0)}`,u:"",icon:I.bolt,c:C.green},{l:"กำไรสุทธิ",v:`฿${stats.totalProfit.toFixed(0)}`,u:"",icon:I.check,c:C.purple}].map(card=><div key={card.l} style={{background:C.white,borderRadius:16,padding:"14px 18px",boxShadow:"0 2px 8px rgba(15,23,42,.06)",display:"flex",alignItems:"center",gap:12}}><div style={{width:42,height:42,borderRadius:12,background:`${card.c}18`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={card.icon} s={20} c={card.c}/></div><div><div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:1}}>{card.l}</div><div style={{fontSize:18,fontWeight:800,color:card.c,fontFamily:"'Sarabun',sans-serif",lineHeight:1.1}}>{card.v}<span style={{fontSize:12,fontWeight:600,marginLeft:2,color:C.ink3}}>{card.u}</span></div></div></div>)}
      </div>
      <Card>
        <div style={{padding:"12px 18px 10px",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
          <span style={{fontWeight:800,fontSize:14,fontFamily:"'Sarabun',sans-serif",color:C.ink}}>ตารางสรุป ({selectedItems.length} เมนู)</span>
          <span style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>กดหัวตารางเพื่อเรียง</span>
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
            <thead><tr><STh label="เมนู" col="name" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><STh label="ราคาขาย" col="price" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><STh label="ต้นทุน" col="cost" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><STh label="% กำไร" col="margin" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><STh label="ขายออก (จาน)" col="soldQty" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><STh label="รายรับ" col="totalRevenue" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><STh label="กำไรสุทธิ" col="totalProfit" sortCol={sortCol} sortDir={sortDir} onSort={onSort}/><th style={{padding:"10px 12px",background:C.bg}}></th></tr></thead>
            <tbody>{sortedSelected.map((item,idx)=>{const qty=+(selected[item.id]||0);const rev=qty*item.price;const np=qty*(item.price-item.cost);return <tr key={item.id} style={{borderTop:`1px solid ${C.lineLight}`,background:idx%2===0?C.white:C.bg}} onMouseEnter={e=>e.currentTarget.style.background=C.brandLight} onMouseLeave={e=>e.currentTarget.style.background=idx%2===0?C.white:C.bg}>
              <td style={{padding:"10px 12px"}}><div style={{display:"flex",alignItems:"center",gap:8}}>{item.image&&<img src={item.image} alt={item.name} style={{width:26,height:26,objectFit:"cover",borderRadius:5}}/>}<span style={{fontWeight:700,color:C.ink,fontSize:13}}>{item.name}</span></div></td>
              <td style={{padding:"10px 12px",fontWeight:700,fontSize:13}}>฿{item.price}</td>
              <td style={{padding:"10px 12px",color:C.brand,fontWeight:700,fontSize:13}}>฿{item.cost.toFixed(2)}</td>
              <td style={{padding:"10px 12px"}}><span style={{fontSize:12,fontWeight:700,color:marginColor(item.margin)}}>{item.margin.toFixed(0)}%</span></td>
              <td style={{padding:"10px 12px"}}>{canE?<input type="number" min="0" value={selected[item.id]||""} onChange={e=>setSelected(p=>({...p,[item.id]:e.target.value}))} placeholder="0" style={{...iS,width:80,padding:"5px 8px",fontSize:13,textAlign:"center"}}/>:<span style={{fontWeight:700}}>{selected[item.id]||0}</span>}</td>
              <td style={{padding:"10px 12px",color:C.blue,fontWeight:700,fontSize:13}}>฿{rev.toFixed(0)}</td>
              <td style={{padding:"10px 12px",color:np>=0?C.green:C.red,fontWeight:700,fontSize:13}}>฿{np.toFixed(0)}</td>
              <td style={{padding:"10px 12px"}}><button onClick={()=>setSelected(p=>{const n={...p};delete n[item.id];return n;})} style={{background:C.redLight,border:"none",borderRadius:6,padding:"4px 8px",cursor:"pointer",display:"flex"}}><Ic d={I.x} s={13} c={C.red}/></button></td>
            </tr>;})}
            </tbody>
          </table>
        </div>
      </Card>
    </>}
    {selectedItems.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.search} s={44} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>ค้นหาและเพิ่มเมนูเพื่อสรุปต้นทุน</p></div>}
    <CostSummarySection branches={branches} currentBranch={currentBranch} currentUser={currentUser} menus={menus} ings={ings}/>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── ORDER TAB ─────────────────────────────────────────
// ══════════════════════════════════════════════════════
function OrderTab({orders,allOrders,reload,ings,suppliers,currentBranch,currentUser}){
  const isCentral=currentBranch.type==="central";
  const[view,setView]=useState(isCentral?"all":"mine");
  const[editOrder,setEditOrder]=useState(null);
  const[saving,setSaving]=useState(false);
  const canOrder=hasPerm(currentUser,"orders");

  const displayOrders=isCentral?(view==="all"?allOrders:orders):orders;

  function printOrder(order){
    const w=window.open("","_blank");
    const rows=(order.items||[]).map(i=>`<tr><td>${i.supplierName||i.supplier_name||"-"}</td><td>${i.name}</td><td>${i.qtyNeeded||0} ${i.unit||""}</td><td>฿${i.estimatedCost?.toFixed(2)||0}</td></tr>`).join("");
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>รายการสั่งวัตถุดิบ</title><style>body{font-family:'Sarabun',sans-serif;padding:24px}h2{color:#FF6B35}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f5f5f5;font-weight:700}.status{display:inline-block;padding:2px 10px;border-radius:20px;font-weight:700}@media print{.noprint{display:none}}</style></head><body><h2>NAIWANSOOK FOODCOST — รายการสั่งวัตถุดิบ</h2><p>สาขา: <b>${order.branch_name}</b> | ซัพพลาย: <b>${order.supplier_name}</b></p><p>สั่งโดย: <b>${order.requested_by}</b> | วันที่: ${order.requested_at}</p><p>ช่วงวันที่: ${order.note||"-"}</p><table><thead><tr><th>ซัพพลาย</th><th>วัตถุดิบ</th><th>จำนวน</th><th>ราคาประมาณ</th></tr></thead><tbody>${rows}</tbody></table><br/><button class="noprint" onclick="window.print()">🖨️ พิมพ์</button></body></html>`);
    w.document.close();setTimeout(()=>w.print(),600);
  }

  const statusColor={pending:"yellow",approved:"green",rejected:"red",delivered:"blue"};
  const statusLabel={pending:"รอดำเนินการ",approved:"อนุมัติ",rejected:"ปฏิเสธ",delivered:"จัดส่งแล้ว"};

  return <div>
    {isCentral&&<div style={{display:"flex",gap:8,marginBottom:16}}>
      {[{id:"all",l:"ทุกสาขา"},{id:"mine",l:"ครัวกลาง"}].map(t=><button key={t.id} onClick={()=>setView(t.id)} style={{padding:"8px 18px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,background:view===t.id?C.teal:"transparent",color:view===t.id?C.white:C.ink3,transition:"all .15s"}}>{t.l}</button>)}
      <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6,background:C.tealLight,borderRadius:8,padding:"6px 12px"}}><Ic d={I.shop} s={14} c={C.teal}/><span style={{fontSize:12,fontWeight:700,color:C.teal,fontFamily:"'Sarabun',sans-serif"}}>ครัวกลาง — รับคำสั่งซื้อจากทุกสาขา</span></div>
    </div>}

    {displayOrders.length===0?<div style={{textAlign:"center",padding:"80px 0",color:C.ink4}}><Ic d={I.box} s={48} c={C.line}/><p style={{marginTop:16,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>ยังไม่มีรายการสั่งวัตถุดิบ<br/><span style={{fontSize:13}}>กด "ส่งสั่งวัตถุดิบ" จากหน้าสรุปต้นทุน</span></p></div>
    :<div style={{display:"flex",flexDirection:"column",gap:12}}>
      {displayOrders.map(order=><Card key={order.id} style={{overflow:"hidden"}}>
        <div style={{padding:"14px 18px",background:C.bg,borderBottom:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:10}}>
          <div>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <Chip color="teal">{order.branch_name}</Chip>
              <Chip color="orange">{order.supplier_name}</Chip>
              <Chip color={statusColor[order.status]||"gray"}>{statusLabel[order.status]||order.status}</Chip>
            </div>
            <div style={{fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>สั่งโดย {order.requested_by} · {order.requested_at} · ช่วง: {order.note||"-"}</div>
          </div>
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            {canOrder&&<button onClick={()=>setEditOrder(editOrder?.id===order.id?null:order)} style={{background:C.blueLight,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",color:C.blue,fontFamily:"'Sarabun',sans-serif",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}><Ic d={I.pencil} s={12} c={C.blue}/>แก้ไข</button>}
            <button onClick={()=>printOrder(order)} style={{background:C.lineLight,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",color:C.ink2,fontFamily:"'Sarabun',sans-serif",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}><Ic d={I.printer} s={12} c={C.ink3}/>PDF/พิมพ์</button>
            {isCentral&&canOrder&&<>
              {order.status==="pending"&&<button onClick={async()=>{try{await api.updateOrder(order.id,{status:"approved"});await reload();}catch(e){alert("ไม่สำเร็จ");}}} style={{background:C.greenLight,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}><Ic d={I.check} s={12} c={C.green}/>อนุมัติ</button>}
              {order.status==="approved"&&<button onClick={async()=>{try{await api.updateOrder(order.id,{status:"delivered"});await reload();}catch(e){alert("ไม่สำเร็จ");}}} style={{background:C.blueLight,border:"none",borderRadius:8,padding:"6px 12px",cursor:"pointer",color:C.blue,fontFamily:"'Sarabun',sans-serif",fontWeight:600,fontSize:12,display:"flex",alignItems:"center",gap:5}}><Ic d={I.truck} s={12} c={C.blue}/>จัดส่งแล้ว</button>}
            </>}
            {canOrder&&<button onClick={async()=>{if(!await confirmDlg({title:"ลบคำสั่งซื้อ",message:"ต้องการลบรายการสั่งวัตถุดิบนี้ใช่หรือไม่?"}))return;try{await api.deleteOrder(order.id);await reload();}catch(e){alert("ลบไม่สำเร็จ");}}} style={{background:C.redLight,border:"none",borderRadius:8,padding:"6px 10px",cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>}
          </div>
        </div>
        <div style={{padding:"12px 18px"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif",fontSize:13}}>
            <thead><tr style={{background:C.bg}}>{["ซัพพลาย","วัตถุดิบ","จำนวนที่ต้องสั่ง","ราคาประมาณ"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",fontWeight:700,color:C.ink3,fontSize:11}}>{h}</th>)}</tr></thead>
            <tbody>{(order.items||[]).map((it,i)=><tr key={i} style={{borderTop:`1px solid ${C.lineLight}`}}>
              <td style={{padding:"7px 10px"}}><Chip color="teal">{it.supplierName||it.supplier_name||"ไม่ระบุ"}</Chip></td>
              <td style={{padding:"7px 10px",fontWeight:600,color:C.ink}}>{it.name}</td>
              <td style={{padding:"7px 10px",color:C.brand,fontWeight:700}}>{it.qtyNeeded} {it.unit}</td>
              <td style={{padding:"7px 10px",color:C.green,fontWeight:700}}>฿{it.estimatedCost?.toFixed(2)}</td>
            </tr>)}
            </tbody>
          </table>
          {editOrder?.id===order.id&&<div style={{marginTop:12,padding:"12px",background:C.bg,borderRadius:10}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink2,marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>เปลี่ยนสถานะ</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              {["pending","approved","rejected","delivered"].map(s=><button key={s} onClick={async()=>{try{await api.updateOrder(order.id,{status:s});await reload();setEditOrder(null);}catch(e){alert("ไม่สำเร็จ");}}} style={{padding:"6px 14px",borderRadius:8,border:`2px solid ${order.status===s?C.brand:C.line}`,background:order.status===s?C.brandLight:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13,color:order.status===s?C.brand:C.ink3}}>{statusLabel[s]}</button>)}
            </div>
          </div>}
        </div>
      </Card>)}
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── HISTORY TAB ───────────────────────────────────────
// ══════════════════════════════════════════════════════
function HisTab({costHistory,actionHistory,reloadHistory,reloadAction,ings,currentBranch,reloadOrders,currentUser}){
  const[view,setView]=useState("cost");const[selSnap,setSelSnap]=useState(null);const[sendingOrder,setSendingOrder]=useState(null);
  const[editSnap,setEditSnap]=useState(null); // {id, date_from, date_to, items:[...]}
  const[editSaving,setEditSaving]=useState(false);
  const canOrder=hasPerm(currentUser,"orders");const canE=hasPerm(currentUser,"history");

  function startEdit(snap){setEditSnap({id:snap.id,date_from:snap.date_from,date_to:snap.date_to,items:(snap.items||[]).map(i=>({...i}))});setSelSnap(null);}
  async function saveEdit(){if(!editSnap)return;setEditSaving(true);try{await api.updateCostHistItem(editSnap.id,{date_from:editSnap.date_from,date_to:editSnap.date_to,items:editSnap.items});await reloadHistory();setEditSnap(null);alert("✅ แก้ไขสำเร็จ");}catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}setEditSaving(false);}
  async function deleteSnap(snap){if(!await confirmDlg({title:"ลบประวัติต้นทุน",message:`ต้องการลบรายการ\n"${snap.date_from} → ${snap.date_to}"\nใช่หรือไม่?`}))return;try{await api.deleteCostHistItem(snap.id);await reloadHistory();}catch(e){alert("ลบไม่สำเร็จ: "+e.message);}}

  function exportCSV(snap){const rows=[["เมนู","ราคาขาย","ต้นทุน","กำไร%","ขายออก","รายรับ","กำไรสุทธิ"],...(snap.items||[]).map(i=>[i.name,i.price,i.cost?.toFixed(2),i.margin?.toFixed(1),i.soldQty,i.totalRevenue?.toFixed(0),i.totalProfit?.toFixed(0)])];const csv=rows.map(r=>r.join(",")).join("\n");const blob=new Blob(["\uFEFF"+csv],{type:"text/csv;charset=utf-8"});const u=URL.createObjectURL(blob);const a=document.createElement("a");a.href=u;a.download=`foodcost-${snap.date_from}_${snap.date_to}.csv`;a.click();URL.revokeObjectURL(u);}
  function printSnap(snap){const w=window.open("","_blank");const rows=(snap.items||[]).map(i=>`<tr><td>${i.name}</td><td>฿${i.price}</td><td>฿${i.cost?.toFixed(2)}</td><td>${i.margin?.toFixed(1)}%</td><td>${i.soldQty}</td><td>฿${i.totalRevenue?.toFixed(0)}</td><td>฿${i.totalProfit?.toFixed(0)}</td></tr>`).join("");w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>สรุปต้นทุน</title><style>body{font-family:'Sarabun',sans-serif;padding:24px}h2{color:#FF6B35}table{width:100%;border-collapse:collapse;margin-top:16px}th,td{border:1px solid #ddd;padding:8px;font-size:13px}th{background:#f5f5f5;font-weight:700}@media print{.noprint{display:none}}</style></head><body><h2>NAIWANSOOK FOODCOST — สรุปต้นทุน</h2><p>สาขา: <b>${snap.branch_name||""}</b> | ${snap.date_from} ถึง ${snap.date_to} | บันทึกโดย: ${snap.saved_by}</p><table><thead><tr><th>เมนู</th><th>ราคาขาย</th><th>ต้นทุน</th><th>กำไร%</th><th>ขายออก</th><th>รายรับ</th><th>กำไรสุทธิ</th></tr></thead><tbody>${rows}</tbody></table><button class="noprint" onclick="window.print()">พิมพ์</button></body></html>`);w.document.close();setTimeout(()=>w.print(),600);}

  async function sendOrderFromSnap(snap){
    const ingMap={};
    (snap.items||[]).forEach(m=>{
      const qty=+(m.soldQty||0);
      (m.ingredients||[]).forEach(mi=>{
        const ing=ings.find(g=>g.id===mi.ingredientId);
        if(!ing)return;
        const totalGram=mi.amountGram*qty;
        if(!ingMap[ing.id])ingMap[ing.id]={ingId:ing.id,name:ing.name,unit:ing.buy_unit,pricePerGram:ing.price_per_gram,buyPrice:ing.buy_price,convertToGram:ing.convert_to_gram,supplierId:ing.supplier_id,supplierName:ing.supplier_name||"ไม่ระบุ",totalGram:0};
        ingMap[ing.id].totalGram+=totalGram;
      });
    });
    const orderItems=Object.values(ingMap).map(i=>({...i,qtyNeeded:+(i.totalGram/i.convertToGram).toFixed(2),estimatedCost:+(i.totalGram*i.pricePerGram).toFixed(2)}));
    if(!orderItems.length){alert("ไม่มีวัตถุดิบที่ต้องสั่ง");return;}
    const supMap={};
    orderItems.forEach(i=>{const k=i.supplierId||"none";if(!supMap[k])supMap[k]={supplierId:i.supplierId,supplierName:i.supplierName,items:[]};supMap[k].items.push(i);});
    setSendingOrder(snap.id);
    try{for(const sup of Object.values(supMap)){await api.addOrder({branch_id:currentBranch.id,branch_name:currentBranch.name,supplier_id:sup.supplierId,supplier_name:sup.supplierName,items:sup.items,status:"pending",requested_by:currentUser.username,requested_at:nowStr(),note:`${snap.date_from} - ${snap.date_to}`});}await reloadOrders();alert("✅ ส่งรายการสั่งวัตถุดิบไปครัวกลางสำเร็จ!");}
    catch(e){alert("ส่งไม่สำเร็จ: "+e.message);}setSendingOrder(null);
  }

  return <div>
    <div style={{display:"flex",gap:8,marginBottom:16}}>
      {[{id:"cost",l:"ประวัติต้นทุน"},{id:"action",l:"ประวัติการแก้ไข"}].map(t=><button key={t.id} onClick={()=>setView(t.id)} style={{padding:"8px 18px",borderRadius:10,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,background:view===t.id?C.brand:"transparent",color:view===t.id?C.white:C.ink3,transition:"all .15s"}}>{t.l}</button>)}
    </div>
    {view==="cost"&&<div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:12}}>
        <Btn v="ghost" onClick={reloadHistory} icon={I.refresh} s={{padding:"7px 14px",fontSize:12}}>รีเฟรช</Btn>
      </div>
      {costHistory.length===0?<Card><div style={{textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.clock} s={40} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีประวัติต้นทุน</p></div></Card>
      :costHistory.map(snap=><Card key={snap.id} style={{marginBottom:12,overflow:"hidden"}}>
        <div style={{padding:"12px 18px",display:"flex",justifyContent:"space-between",alignItems:"center",background:C.bg,borderBottom:`1px solid ${C.line}`,flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}>📅 {snap.date_from} → {snap.date_to}</div>
            <div style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>{(snap.items||[]).length} เมนู · บันทึกโดย {snap.saved_by} · {snap.saved_at}</div>
          </div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            <Btn v="ghost" onClick={()=>{setSelSnap(selSnap?.id===snap.id?null:snap);setEditSnap(null);}} s={{padding:"5px 10px",fontSize:11}} icon={I.eye}>รายละเอียด</Btn>
            <Btn v="success" onClick={()=>exportCSV(snap)} s={{padding:"5px 10px",fontSize:11}} icon={I.dl}>CSV</Btn>
            <Btn v="info" onClick={()=>printSnap(snap)} s={{padding:"5px 10px",fontSize:11}} icon={I.printer}>PDF/พิมพ์</Btn>
            {canOrder&&<Btn v="teal" onClick={()=>sendOrderFromSnap(snap)} loading={sendingOrder===snap.id} s={{padding:"5px 10px",fontSize:11}} icon={I.send}>ส่งสั่งวัตถุดิบ</Btn>}
            {canE&&<button onClick={()=>startEdit(snap)} style={{background:C.blueLight,border:`1px solid #BFDBFE`,borderRadius:8,padding:"5px 10px",cursor:"pointer",display:"flex",alignItems:"center",gap:5,fontSize:11,fontWeight:700,color:C.blue,fontFamily:"'Sarabun',sans-serif"}}><Ic d={I.pencil} s={12} c={C.blue}/>แก้ไข</button>}
            <button onClick={()=>deleteSnap(snap)} style={{background:C.redLight,border:`1px solid #FECACA`,borderRadius:8,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4,fontSize:11,fontWeight:700,color:C.red,fontFamily:"'Sarabun',sans-serif"}}><Ic d={I.trash} s={12} c={C.red}/>ลบ</button>
          </div>
        </div>
        {/* View mode */}
        {selSnap?.id===snap.id&&editSnap?.id!==snap.id&&<div style={{padding:"12px 18px",overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif",fontSize:13}}>
            <thead><tr style={{background:C.bg}}>{["เมนู","ราคาขาย","ต้นทุน","กำไร%","ขายออก","รายรับ","กำไรสุทธิ"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:C.ink3,fontSize:11}}>{h}</th>)}</tr></thead>
            <tbody>{(snap.items||[]).map((it,i)=><tr key={i} style={{borderTop:`1px solid ${C.lineLight}`}}>
              <td style={{padding:"7px 10px",fontWeight:600}}>{it.name}</td>
              <td style={{padding:"7px 10px"}}>฿{it.price}</td>
              <td style={{padding:"7px 10px",color:C.brand}}>฿{it.cost?.toFixed(2)}</td>
              <td style={{padding:"7px 10px",color:marginColor(it.margin||0),fontWeight:700}}>{it.margin?.toFixed(1)}%</td>
              <td style={{padding:"7px 10px",fontWeight:700}}>{it.soldQty} จาน</td>
              <td style={{padding:"7px 10px",color:C.blue,fontWeight:700}}>฿{it.totalRevenue?.toFixed(0)}</td>
              <td style={{padding:"7px 10px",color:(it.totalProfit||0)>=0?C.green:C.red,fontWeight:700}}>฿{it.totalProfit?.toFixed(0)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {/* Edit mode */}
        {editSnap?.id===snap.id&&<div style={{padding:"16px 18px",background:"#FAFBFF",borderTop:`1px solid ${C.line}`}}>
          <div style={{fontSize:13,fontWeight:800,color:C.blue,marginBottom:12,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:6}}><Ic d={I.pencil} s={14} c={C.blue}/>แก้ไขรายการ</div>
          <div style={{display:"flex",gap:12,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
            <div><label style={{fontSize:12,fontWeight:600,color:C.ink3,fontFamily:"'Sarabun',sans-serif",display:"block",marginBottom:4}}>วันที่เริ่ม</label><input type="date" value={editSnap.date_from} onChange={e=>setEditSnap(s=>({...s,date_from:e.target.value}))} style={{...iS,fontSize:13,padding:"6px 10px",width:150}}/></div>
            <div><label style={{fontSize:12,fontWeight:600,color:C.ink3,fontFamily:"'Sarabun',sans-serif",display:"block",marginBottom:4}}>วันที่สิ้นสุด</label><input type="date" value={editSnap.date_to} onChange={e=>setEditSnap(s=>({...s,date_to:e.target.value}))} style={{...iS,fontSize:13,padding:"6px 10px",width:150}}/></div>
          </div>
          <div style={{overflowX:"auto",marginBottom:14}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif",fontSize:13}}>
              <thead><tr style={{background:C.bg}}>{["เมนู","ราคาขาย","ต้นทุน","กำไร%","ขายออก (จาน)","รายรับ","กำไรสุทธิ"].map(h=><th key={h} style={{padding:"7px 10px",textAlign:"left",fontWeight:700,color:C.ink3,fontSize:11}}>{h}</th>)}</tr></thead>
              <tbody>{editSnap.items.map((it,i)=>{
                const qty=+(it.soldQty||0);
                const rev=qty*(it.price||0);const np=qty*((it.price||0)-(it.cost||0));
                return <tr key={i} style={{borderTop:`1px solid ${C.lineLight}`}}>
                  <td style={{padding:"7px 10px",fontWeight:600}}>{it.name}</td>
                  <td style={{padding:"7px 10px"}}>฿{it.price}</td>
                  <td style={{padding:"7px 10px",color:C.brand}}>฿{it.cost?.toFixed(2)}</td>
                  <td style={{padding:"7px 10px",color:marginColor(it.margin||0),fontWeight:700}}>{it.margin?.toFixed(1)}%</td>
                  <td style={{padding:"7px 10px"}}><input type="number" min="0" value={it.soldQty} onChange={e=>{const v=+e.target.value;setEditSnap(s=>({...s,items:s.items.map((x,j)=>j===i?{...x,soldQty:v,totalRevenue:v*(x.price||0),totalCost:v*(x.cost||0),totalProfit:v*((x.price||0)-(x.cost||0))}:x)}));}} style={{...iS,width:80,padding:"4px 8px",fontSize:13,textAlign:"center"}}/></td>
                  <td style={{padding:"7px 10px",color:C.blue,fontWeight:700}}>฿{rev.toFixed(0)}</td>
                  <td style={{padding:"7px 10px",color:np>=0?C.green:C.red,fontWeight:700}}>฿{np.toFixed(0)}</td>
                </tr>;})}
              </tbody>
            </table>
          </div>
          <div style={{display:"flex",gap:8}}>
            <Btn v="ghost" onClick={()=>setEditSnap(null)}>ยกเลิก</Btn>
            <Btn v="success" icon={I.check} onClick={saveEdit} loading={editSaving}>บันทึกการแก้ไข</Btn>
          </div>
        </div>}
      </Card>)}
    </div>}
    {view==="action"&&<div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,marginBottom:12}}>
        <Btn v="ghost" onClick={reloadAction} icon={I.refresh} s={{padding:"7px 14px",fontSize:12}}>รีเฟรช</Btn>
        {actionHistory.length>0&&<Btn v="danger" onClick={async()=>{if(!await confirmDlg({title:"ลบประวัติการใช้งาน",message:"ต้องการลบประวัติการใช้งานทั้งหมดใช่หรือไม่?"}))return;try{await api.clearActionHist();await reloadAction();}catch(e){alert("ลบไม่สำเร็จ");}}} s={{padding:"7px 14px",fontSize:12}} icon={I.trash}>ลบ</Btn>}
      </div>
      <Card>{actionHistory.length===0?<div style={{textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.clock} s={40} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีประวัติ</p></div>
      :actionHistory.map((item,idx)=><div key={idx} style={{display:"flex",alignItems:"center",gap:12,padding:"11px 18px",borderBottom:`1px solid ${C.lineLight}`}}>
        <div style={{width:30,height:30,borderRadius:"50%",background:C.brandLight,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={I.check} s={13} c={C.brand}/></div>
        <div style={{flex:1}}><div style={{fontSize:13,fontWeight:600,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{item.action}</div><div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:1}}>{item.time}</div></div>
      </div>)}</Card>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── SETTINGS TAB ──────────────────────────────────────
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// ── SUPPLIER TAB ──────────────────────────────────────
// ══════════════════════════════════════════════════════
function SupplierTab({suppliers,reloadSuppliers,currentUser}){
  const[supForm,setSupForm]=useState({name:"",contact:"",phone:"",note:"",active:true});
  const[editSID,setEditSID]=useState(null);
  const canE=hasPerm(currentUser,"suppliers");
  async function saveSup(){
    if(!supForm.name)return;
    try{if(editSID)await api.updateSupplier(editSID,supForm);else await api.addSupplier(supForm);await reloadSuppliers();setSupForm({name:"",contact:"",phone:"",note:"",active:true});setEditSID(null);}
    catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
  }
  return <div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:12,marginBottom:16}}>
      {suppliers.map(s=><Card key={s.id} style={{padding:"14px 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
          <div>
            <div style={{fontWeight:700,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>{s.name}</div>
            {s.contact&&<div style={{fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}><span style={{color:C.ink4}}>ผู้ติดต่อ:</span> {s.contact}</div>}
            {s.phone&&<div style={{fontSize:12,color:C.blue,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}>📞 {s.phone}</div>}
            {s.note&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontStyle:"italic",marginTop:4}}>📝 {s.note}</div>}
          </div>
          {canE&&<div style={{display:"flex",gap:4}}>
            <button onClick={()=>{setSupForm({name:s.name,contact:s.contact||"",phone:s.phone||"",note:s.note||"",active:s.active});setEditSID(s.id);}} style={{background:C.blueLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c={C.blue}/></button>
            <button onClick={async()=>{if(!await confirmDlg({title:"ลบซัพพลายเออร์",message:`ต้องการลบ "${s.name}" ใช่หรือไม่?`}))return;await api.deleteSupplier(s.id);await reloadSuppliers();}} style={{background:C.redLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>
          </div>}
        </div>
      </Card>)}
      {suppliers.length===0&&<div style={{gridColumn:"1/-1",textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.truck} s={44} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>ยังไม่มีซัพพลาย</p></div>}
    </div>
    {canE&&<Card style={{padding:"16px 18px"}}>
      <h4 style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,fontWeight:700,color:C.ink,marginBottom:12}}>{editSID?"✏️ แก้ไขซัพพลาย":"➕ เพิ่มซัพพลายใหม่"}</h4>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <Inp label="ชื่อซัพพลาย *" value={supForm.name} onChange={e=>setSupForm(f=>({...f,name:e.target.value}))} placeholder="เช่น ตลาดสด ก."/>
        <Inp label="ชื่อผู้ติดต่อ" value={supForm.contact} onChange={e=>setSupForm(f=>({...f,contact:e.target.value}))} placeholder="คุณสมชาย"/>
        <Inp label="เบอร์โทร" value={supForm.phone} onChange={e=>setSupForm(f=>({...f,phone:e.target.value}))} placeholder="081-234-5678"/>
        <Inp label="หมายเหตุ" value={supForm.note} onChange={e=>setSupForm(f=>({...f,note:e.target.value}))} placeholder="ส่งทุกเช้า..."/>
      </div>
      <div style={{display:"flex",gap:8}}>
        <Btn onClick={saveSup} icon={I.check} disabled={!supForm.name}>{editSID?"บันทึก":"เพิ่มซัพพลาย"}</Btn>
        {editSID&&<Btn v="ghost" onClick={()=>{setSupForm({name:"",contact:"",phone:"",note:"",active:true});setEditSID(null);}}>ยกเลิก</Btn>}
      </div>
    </Card>}
  </div>;
}

function SettingsTab({ingCats,menuCats,reloadCats,users,reloadUsers,branches,reloadBranches,suppliers,reloadSuppliers,currentUser,printers=[],reloadPrinters,currentBranch}){
  const[section,setSection]=useState("branches");
  const[showUser,setShowUser]=useState(false);const[editUID,setEditUID]=useState(null);const[saving,setSaving]=useState(false);
  const uF0={username:"",password:"",name:"",role:"staff",active:true,perms:ROLE_DEFAULT_PERMS.staff,allowed_branches:null};
  const[uF,setUF]=useState(uF0);
  function toggleUserBranch(bid){
    setUF(f=>{
      // null = "ทุกสาขา" → start from full list, then remove the toggled one
      const current=f.allowed_branches===null?branches.map(b=>+b.id):(f.allowed_branches||[]).map(x=>+x);
      const next=current.includes(+bid)?current.filter(x=>x!==+bid):[...current,+bid];
      return{...f,allowed_branches:next};
    });
  }
  const bF0={name:"",type:"branch",active:true};
  const[branchForm,setBranchForm]=useState(bF0);const[editBID,setEditBID]=useState(null);const[showBranch,setShowBranch]=useState(false);
  const pF0={name:"",ip:"",port:9100,description:"",type:"kitchen",branch_id:null,active:true,conn:"ip",btName:""};
  const[pForm,setPForm]=useState(pF0);const[editPID,setEditPID]=useState(null);const[pSaving,setPSaving]=useState(false);
  const[testResults,setTestResults]=useState({});const[btScanning,setBtScanning]=useState(false);
  const isAdmin=hasPerm(currentUser,"settings");
  async function testPrinter(p){
    const conn=getPConn(p);
    setTestResults(r=>({...r,[p.id]:{status:"testing"}}));
    if(conn.type==="bluetooth"){
      try{
        if(!navigator.bluetooth)throw new Error("เบราว์เซอร์ไม่รองรับ Bluetooth");
        const device=await navigator.bluetooth.requestDevice({filters:conn.btName?[{name:conn.btName}]:undefined,acceptAllDevices:!conn.btName,optionalServices:_BT_SVC});
        const server=await device.gatt.connect();
        await server.getPrimaryServices();
        device.gatt.disconnect();
        setTestResults(r=>({...r,[p.id]:{status:"ok",msg:"เชื่อมต่อ Bluetooth สำเร็จ: "+device.name}}));
      }catch(e){setTestResults(r=>({...r,[p.id]:{status:"fail",msg:e.message}}));}
      return;
    }
    const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),4000);
    try{await fetch(`http://${p.ip}:${p.port||9100}/`,{mode:"no-cors",signal:ctrl.signal,cache:"no-store"});clearTimeout(tid);setTestResults(r=>({...r,[p.id]:{status:"ok",msg:"เชื่อมต่อได้ปกติ"}}));}
    catch(e){clearTimeout(tid);setTestResults(r=>({...r,[p.id]:{status:"fail",msg:e.name==="AbortError"?"หมดเวลา ไม่ตอบสนอง (4s)":"เชื่อมต่อไม่ได้"}}));}
  }
  async function scanBTPrinter(all=false){
    if(!navigator.bluetooth){alert("เบราว์เซอร์ไม่รองรับ Bluetooth ต้องใช้ Chrome/Edge");return;}
    setBtScanning(true);
    try{
      const opts=all?{acceptAllDevices:true,optionalServices:_BT_SVC}:{
        filters:[
          {namePrefix:"XP-"},{namePrefix:"Xprinter"},{namePrefix:"MTP"},{namePrefix:"MPT"},
          {namePrefix:"RPP"},{namePrefix:"BT Printer"},{namePrefix:"BT-Printer"},{namePrefix:"Printer"},
          {namePrefix:"POS"},{namePrefix:"Thermal"},{namePrefix:"SPP"},{namePrefix:"GP-"},
          {namePrefix:"Gprinter"},{namePrefix:"PT-"},{namePrefix:"MP-"},{namePrefix:"P80"},
          {namePrefix:"P58"},{namePrefix:"HOIN"},{namePrefix:"Goojprt"},{namePrefix:"GOOJPRT"},
          {namePrefix:"BlueTooth"},{namePrefix:"HC-"},{namePrefix:"ESC"},{namePrefix:"TP"},
          ..._BT_SVC.map(s=>({services:[s]})),
        ],
        optionalServices:_BT_SVC,
      };
      const device=await navigator.bluetooth.requestDevice(opts);
      setPForm(f=>({...f,btName:device.name||"",conn:"bluetooth"}));
    }catch(e){
      if(e.name==="NotFoundError"&&!all){
        if(await confirmDlg({title:"ไม่พบเครื่องปริ้น",message:"ไม่พบอุปกรณ์ที่ตรงกับชื่อเครื่องปริ้น\nต้องการแสดงอุปกรณ์ Bluetooth ทั้งหมดไหม?",confirmLabel:"แสดงทั้งหมด",danger:false})){setBtScanning(false);scanBTPrinter(true);return;}
      }else if(e.name!=="NotFoundError"&&e.name!=="NotAllowedError")alert("เกิดข้อผิดพลาด: "+e.message);
    }
    setBtScanning(false);
  }

  async function saveUser(){
    if(!uF.username||!uF.password)return;
    setSaving(true);
    try{
      // Normalize perms + allowed_branches on every save so DB stays clean
      const payload={...uF,perms:normalizePerms(uF.perms),allowed_branches:normalizeBranchIds(uF.allowed_branches)};
      if(editUID)await api.updateUser(editUID,payload);else await api.addUser(payload);
      await reloadUsers();setShowUser(false);setEditUID(null);setUF(uF0);
    }catch(e){showErr("บันทึกไม่สำเร็จ",e);}
    setSaving(false);
  }
  async function saveBranch(){
    if(!branchForm.name)return;
    try{
      // Branch-level perm gating removed — permissions are managed per-user only.
      // Send allowed_perms:null to clear any legacy data so the column doesn't gate visibility anymore.
      const payload={name:branchForm.name,type:branchForm.type,active:branchForm.active,allowed_perms:null};
      if(editBID)await api.updateBranch(editBID,payload);else await api.addBranch(payload);
      await reloadBranches();
      setBranchForm(bF0);setEditBID(null);
    }catch(e){showErr("บันทึกไม่สำเร็จ",e);}
  }
  async function savePrinter(){
    const isBT=pForm.conn==="bluetooth";
    if(!pForm.name||(isBT?!pForm.btName:!pForm.ip))return;
    setPSaving(true);
    try{
      const d={name:pForm.name,ip:isBT?"bluetooth":pForm.ip,port:isBT?0:+pForm.port||9100,type:pForm.type,branch_id:pForm.branch_id||null,active:true,description:isBT?JSON.stringify({c:"bt",n:pForm.btName}):pForm.description};
      if(editPID)await api.updatePrinter(editPID,d);else await api.addPrinter(d);
      await reloadPrinters();setPForm(pF0);setEditPID(null);
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setPSaving(false);
  }

  const sections=[{id:"branches",label:"สาขา",icon:I.branch},{id:"users",label:"ผู้ใช้",icon:I.users}];

  return <div style={{display:"grid",gridTemplateColumns:"180px 1fr",gap:16,minHeight:480}}>
    <Card style={{padding:8,height:"fit-content"}}>
      {sections.map(s=><div key={s.id} onClick={()=>setSection(s.id)} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",borderRadius:10,cursor:"pointer",marginBottom:4,background:section===s.id?C.brandLight:"transparent",color:section===s.id?C.brand:C.ink2,fontWeight:section===s.id?700:500,fontFamily:"'Sarabun',sans-serif",fontSize:14,transition:"all .15s"}}><Ic d={s.icon} s={15} c={section===s.id?C.brand:C.ink3}/>{s.label}</div>)}
    </Card>
    <div>
    {section==="branches"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink,margin:0}}>จัดการสาขา <span style={{fontSize:13,fontWeight:500,color:C.ink4}}>({branches.length})</span></h3>
        {isAdmin&&<Btn onClick={()=>{setBranchForm(bF0);setEditBID(null);setShowBranch(true);}} icon={I.plus}>เพิ่มสาขา</Btn>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(220px,1fr))",gap:10}}>
        {branches.map(b=><Card key={b.id} style={{padding:"12px 14px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:6}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:6,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{b.name}</div>
              <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
                <Chip color={b.type==="central"?"teal":"orange"}>{b.type==="central"?"ครัวกลาง":"สาขา"}</Chip>
                <Chip color={b.active?"green":"gray"}>{b.active?"เปิด":"ปิด"}</Chip>
              </div>
            </div>
            {isAdmin&&<div style={{display:"flex",gap:3,flexShrink:0}}>
              <button onClick={()=>{setBranchForm({name:b.name,type:b.type,active:b.active});setEditBID(b.id);setShowBranch(true);}} title="แก้ไข" style={{background:C.blueLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c={C.blue}/></button>
              {b.type!=="central"&&<button onClick={async()=>{
                if(!await confirmDlg({title:b.active?"ปิดใช้งานสาขา":"เปิดใช้งานสาขา",message:b.active?`ปิดใช้งาน "${b.name}"?\n\nสาขาจะไม่ปรากฏใน picker, การสแกน QR ของสาขานี้จะถูกปฏิเสธ\n(ข้อมูลทั้งหมดจะยังอยู่ — ไม่ลบจริง)`:`เปิดใช้งาน "${b.name}" อีกครั้ง?`,danger:b.active,confirmLabel:b.active?"ปิดใช้งาน":"เปิดใช้งาน"}))return;
                try{await api.updateBranch(b.id,{active:!b.active});await reloadBranches();}
                catch(e){showErr("เปลี่ยนสถานะไม่สำเร็จ",e);}
              }} title={b.active?"ปิดใช้งาน (Soft delete)":"เปิดใช้งาน"} style={{background:b.active?C.redLight:C.greenLight,border:"none",borderRadius:7,padding:6,cursor:"pointer",display:"flex"}}><Ic d={b.active?I.trash:I.refresh} s={13} c={b.active?C.red:C.green}/></button>}
            </div>}
          </div>
        </Card>)}
      </div>
    </div>}

    {/* Branch add/edit modal */}
    {showBranch&&<Modal title={editBID?"✏️ แก้ไขสาขา":"➕ เพิ่มสาขาใหม่"} onClose={()=>{setShowBranch(false);setBranchForm(bF0);setEditBID(null);}}>
      <Inp label="ชื่อสาขา *" value={branchForm.name} onChange={e=>setBranchForm(f=>({...f,name:e.target.value}))} placeholder="เช่น คลองสาม, สีลม, ครัวกลาง" autoFocus/>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Field label="ประเภท"><select value={branchForm.type} onChange={e=>setBranchForm(f=>({...f,type:e.target.value}))} style={{...iS,appearance:"none"}}><option value="branch">🏢 สาขา</option><option value="central">🏛 ครัวกลาง</option></select></Field>
        <Field label="สถานะ"><select value={branchForm.active?"true":"false"} onChange={e=>setBranchForm(f=>({...f,active:e.target.value==="true"}))} style={{...iS,appearance:"none"}}><option value="true">✅ เปิดใช้งาน</option><option value="false">⏸ ปิดใช้งาน</option></select></Field>
      </div>
      <div style={{padding:"10px 14px",background:C.blueLight,borderRadius:10,border:`1px solid #BFDBFE`,marginTop:6,marginBottom:14,fontSize:12,color:C.blue,fontFamily:"'Sarabun',sans-serif",lineHeight:1.6}}>
        ℹ️ การกำหนดสิทธิ์เมนูทำที่หัวข้อ <b>"ผู้ใช้"</b> เท่านั้น (รายผู้ใช้)
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",paddingTop:10,borderTop:`1px solid ${C.line}`}}>
        <Btn v="ghost" onClick={()=>{setShowBranch(false);setBranchForm(bF0);setEditBID(null);}}>ยกเลิก</Btn>
        <Btn onClick={async()=>{await saveBranch();setShowBranch(false);}} icon={I.check} disabled={!branchForm.name}>{editBID?"บันทึก":"เพิ่มสาขา"}</Btn>
      </div>
    </Modal>}

    {section==="users"&&<div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink}}>ผู้ใช้งานและสิทธิ์</h3>
        {isAdmin&&<Btn onClick={()=>{setUF(uF0);setEditUID(null);setShowUser(true);}} icon={I.plus}>เพิ่มผู้ใช้</Btn>}
      </div>
      <Card>
        <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
          <thead><tr style={{background:C.bg}}>{["ผู้ใช้","ชื่อ","บทบาท","สิทธิ์","สาขา","สถานะ",""].map(h=><th key={h} style={{padding:"9px 14px",textAlign:"left",fontSize:11,fontWeight:700,color:C.ink3}}>{h}</th>)}</tr></thead>
          <tbody>{users.map(u=>{
            const perms=normalizePerms(u.perms);  // raw perms (post-cleanup); 0 = use role default
            const effective=perms.length>0?perms:(ROLE_DEFAULT_PERMS[u.role]||[]);
            const ab=normalizeBranchIds(u.allowed_branches);
            const branchSummary=u.role==="admin"?"ทุกสาขา (admin)":(ab==null?"ทุกสาขา":(ab.length===0?"ไม่มี ⚠️":`${ab.length}/${branches.length} สาขา`));
            const isStale=asArr(u.perms)&&asArr(u.perms).length!==perms.length;
            return <tr key={u.id} style={{borderTop:`1px solid ${C.lineLight}`}}>
            <td style={{padding:"11px 14px"}}><div style={{display:"flex",alignItems:"center",gap:8}}><div style={{width:30,height:30,borderRadius:"50%",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.user} s={14} c={C.white}/></div><span style={{fontWeight:700,color:C.ink,fontSize:13}}>{u.username}</span></div></td>
            <td style={{padding:"11px 14px",color:C.ink2,fontSize:13}}>{u.name}</td>
            <td style={{padding:"11px 14px"}}><Chip color={ROLES[u.role]?.color||"gray"}>{ROLES[u.role]?.label||u.role}</Chip></td>
            <td style={{padding:"11px 14px"}} title={perms.length>0?perms.join(", "):"(ไม่มี — จะใช้สิทธิ์ default ของ role)"}>
              <span style={{fontSize:12,color:perms.length===0?C.red:C.ink3,fontWeight:perms.length===0?700:400}}>{perms.length===0?"⚠️ ว่าง":`${perms.length}/${ALL_PERMS.length} แท็บ`}</span>
              {isStale&&<div style={{fontSize:10,color:"#92400E",fontFamily:"'Sarabun',sans-serif",marginTop:2}} title="DB มีรายการที่ไม่มีอยู่หรือซ้ำ — กดแก้ไข + บันทึกเพื่อ clean">⚠ ข้อมูลเก่า กดแก้ไขเพื่อ clean</div>}
            </td>
            <td style={{padding:"11px 14px"}} title={ab&&ab.length>0?ab.map(id=>branches.find(b=>+b.id===+id)?.name||id).join(", "):""}><span style={{fontSize:12,color:(ab&&ab.length===0)?C.red:C.ink3,fontWeight:(ab&&ab.length===0)?700:400}}>{branchSummary}</span></td>
            <td style={{padding:"11px 14px"}}><Chip color={u.active?"green":"gray"}>{u.active?"ใช้งาน":"ปิด"}</Chip></td>
            <td style={{padding:"11px 14px"}}>{isAdmin&&<div style={{display:"flex",gap:5}}>
              <button onClick={()=>{setUF({username:u.username,password:u.password,name:u.name,role:u.role,active:u.active,perms:normalizePerms(u.perms),allowed_branches:normalizeBranchIds(u.allowed_branches)});setEditUID(u.id);setShowUser(true);}} style={{background:C.blueLight,border:"none",borderRadius:7,padding:5,cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c={C.blue}/></button>
              {u.id!==currentUser.id&&<button onClick={async()=>{if(!await confirmDlg({title:"ลบผู้ใช้",message:`ต้องการลบผู้ใช้ "${u.name||u.username}" ใช่หรือไม่?`}))return;try{await api.deleteUser(u.id);await reloadUsers();}catch(e){alert("ลบไม่สำเร็จ");}}} style={{background:C.redLight,border:"none",borderRadius:7,padding:5,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>}
            </div>}</td>
          </tr>;})}
          </tbody>
        </table>
      </Card>
    </div>}

    {section==="printers"&&<div style={{minHeight:"100%"}}>
      {/* ── Header Bar ── */}
      <div style={{background:"linear-gradient(135deg,#0F172A 0%,#1E293B 100%)",borderRadius:16,padding:"28px 32px",marginBottom:24,display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 4px 24px rgba(15,23,42,0.18)"}}>
        <div style={{display:"flex",alignItems:"center",gap:18}}>
          <div style={{width:56,height:56,background:"linear-gradient(135deg,#6366F1,#8B5CF6)",borderRadius:16,display:"flex",alignItems:"center",justifyContent:"center",boxShadow:"0 8px 24px rgba(99,102,241,0.4)"}}>
            <Ic d={I.print} s={26} c="#fff" sw={1.5}/>
          </div>
          <div>
            <h2 style={{fontFamily:"'Sarabun',sans-serif",fontSize:22,fontWeight:900,color:"#F8FAFC",margin:0,letterSpacing:-.3}}>เครื่องพิมพ์ใบสั่ง</h2>
            <p style={{fontSize:13,color:"rgba(255,255,255,0.45)",margin:"3px 0 0",fontFamily:"'Sarabun',sans-serif"}}>Network Printer — Xprinter / ESC-POS 80mm (TCP Port 9100)</p>
          </div>
        </div>
        <div style={{display:"flex",gap:10,alignItems:"center"}}>
          {[{label:"ทั้งหมด",count:printers.length,color:"#6366F1"},{label:"ครัว",count:printers.filter(p=>p.type==="kitchen").length,color:"#F59E0B"},{label:"บาร์",count:printers.filter(p=>p.type==="bar").length,color:"#10B981"},{label:"แคชเชียร์",count:printers.filter(p=>p.type==="receipt").length,color:"#3B82F6"}].map(s=><div key={s.label} style={{textAlign:"center",background:"rgba(255,255,255,0.07)",borderRadius:12,padding:"10px 18px",border:"1px solid rgba(255,255,255,0.1)"}}>
            <div style={{fontSize:22,fontWeight:900,color:s.color,lineHeight:1}}>{s.count}</div>
            <div style={{fontSize:11,color:"rgba(255,255,255,0.45)",fontFamily:"'Sarabun',sans-serif",marginTop:2}}>{s.label}</div>
          </div>)}
        </div>
      </div>

      {/* ── Add / Edit Form ── */}
      <div style={{background:C.white,borderRadius:16,border:`1px solid ${C.line}`,marginBottom:24,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.06)"}}>
        <div style={{padding:"18px 28px",borderBottom:`1px solid ${C.line}`,background:editPID?"#FFF7ED":"#F8FAFF",display:"flex",alignItems:"center",gap:12}}>
          <div style={{width:32,height:32,background:editPID?"#F59E0B22":"#6366F122",borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <Ic d={editPID?I.pencil:I.plus} s={15} c={editPID?"#F59E0B":"#6366F1"}/>
          </div>
          <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink}}>{editPID?"แก้ไขเครื่องพิมพ์":"เพิ่มเครื่องพิมพ์ใหม่"}</span>
          {editPID&&<Chip color="yellow">กำลังแก้ไข</Chip>}
        </div>
        <div style={{padding:"24px 28px"}}>
          {/* Row 1: name + conn type + printer type + branch */}
          <div style={{display:"grid",gridTemplateColumns:"2fr 1.4fr 1fr 1fr",gap:14,marginBottom:14}}>
            <Inp label="ชื่อเครื่องพิมพ์ *" value={pForm.name} onChange={e=>setPForm(f=>({...f,name:e.target.value}))} placeholder="เช่น ครัวหลัก, บาร์"/>
            <div>
              <label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ประเภทการเชื่อมต่อ</label>
              <div style={{display:"flex",gap:0,borderRadius:10,overflow:"hidden",border:`1.5px solid ${C.line}`}}>
                {[{v:"ip",label:"🌐 IP Network"},{v:"bluetooth",label:"📶 Bluetooth"}].map(o=><button key={o.v} onClick={()=>setPForm(f=>({...f,conn:o.v}))} style={{flex:1,padding:"9px 0",border:"none",background:pForm.conn===o.v?`linear-gradient(135deg,${C.brand},${C.brandDark})`:C.white,color:pForm.conn===o.v?C.white:C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer",transition:"all .15s"}}>{o.label}</button>)}
              </div>
            </div>
            <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ประเภท</label><select value={pForm.type} onChange={e=>setPForm(f=>({...f,type:e.target.value}))} style={{...iS,appearance:"none"}}><option value="kitchen">🍳 ครัว</option><option value="bar">🍹 บาร์</option><option value="receipt">🧾 แคชเชียร์</option><option value="other">📄 อื่นๆ</option></select></div>
            <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>สาขา</label><select value={pForm.branch_id||""} onChange={e=>setPForm(f=>({...f,branch_id:e.target.value?+e.target.value:null}))} style={{...iS,appearance:"none"}}><option value="">ทุกสาขา</option>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
          </div>
          {/* Row 2: IP fields OR BT scan */}
          {pForm.conn==="ip"?<div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:14,marginBottom:14,alignItems:"flex-end"}}>
            <Inp label="IP Address *" value={pForm.ip} onChange={e=>setPForm(f=>({...f,ip:e.target.value}))} placeholder="192.168.1.100"/>
            <Inp label="Port" type="number" value={pForm.port} onChange={e=>setPForm(f=>({...f,port:+e.target.value}))} placeholder="9100" style={{width:90}}/>
            <Inp label="หมายเหตุ" value={pForm.description} onChange={e=>setPForm(f=>({...f,description:e.target.value}))} placeholder="ปริ้นครัวหลัก..."/>
          </div>:<div style={{marginBottom:14,background:C.bg,borderRadius:12,padding:"16px 18px",border:`1.5px dashed ${C.brand}44`}}>
            <div style={{fontSize:12,fontWeight:700,color:C.ink3,marginBottom:10,fontFamily:"'Sarabun',sans-serif"}}>อุปกรณ์ Bluetooth</div>
            {pForm.btName?<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
              <div style={{width:36,height:36,background:C.brandLight,borderRadius:10,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18}}>📶</div>
              <div><div style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{pForm.btName}</div><div style={{fontSize:11,color:C.green,fontWeight:600}}>✅ จับคู่แล้ว</div></div>
              <button onClick={()=>setPForm(f=>({...f,btName:""}))} style={{marginLeft:"auto",background:C.redLight,border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",color:C.red,fontSize:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ล้าง</button>
            </div>:<div style={{color:C.ink4,fontSize:13,fontFamily:"'Sarabun',sans-serif",marginBottom:10}}>ยังไม่ได้จับคู่อุปกรณ์</div>}
            <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
              <button onClick={()=>scanBTPrinter(false)} disabled={btScanning} style={{background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white,border:"none",borderRadius:10,padding:"9px 18px",cursor:btScanning?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,opacity:btScanning?.6:1,display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16}}>📶</span>{btScanning?"กำลังสแกน...":"สแกนเฉพาะเครื่องปริ้น"}
              </button>
              <button onClick={()=>scanBTPrinter(true)} disabled={btScanning} style={{background:C.white,color:C.ink2,border:`1.5px solid ${C.line}`,borderRadius:10,padding:"9px 16px",cursor:btScanning?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:600,opacity:btScanning?.6:1,display:"flex",alignItems:"center",gap:6}}>
                <span style={{fontSize:14}}>🔍</span>แสดงทั้งหมด
              </button>
            </div>
            <div style={{marginTop:8,fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>* "สแกนเฉพาะเครื่องปริ้น" จะกรองเฉพาะอุปกรณ์ที่ชื่อขึ้นต้นด้วย XP, MTP, RPP, POS, Thermal, BT Printer ฯลฯ</div>
          </div>}
          {/* Buttons */}
          <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
            {editPID&&<Btn v="ghost" onClick={()=>{setPForm(pF0);setEditPID(null);}}>ยกเลิก</Btn>}
            <Btn onClick={savePrinter} icon={I.check} disabled={!pForm.name||(pForm.conn==="bluetooth"?!pForm.btName:!pForm.ip)} loading={pSaving} s={{minWidth:160}}>{editPID?"บันทึกการแก้ไข":"เพิ่มเครื่องพิมพ์"}</Btn>
          </div>
        </div>
      </div>

      {/* ── Printer Grid ── */}
      <div style={{marginBottom:16,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:16,fontWeight:800,color:C.ink,margin:0}}>เครื่องพิมพ์ที่เชื่อมต่อ <span style={{fontSize:13,fontWeight:600,color:C.ink4}}>({printers.length} เครื่อง)</span></h3>
        <div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif",background:C.blueLight,padding:"6px 14px",borderRadius:20,border:`1px solid #BFDBFE`}}>💡 ไปที่หน้า <b>เมนู</b> เพื่อกำหนดเครื่องพิมพ์ให้แต่ละเมนู</div>
      </div>

      {printers.length===0?<div style={{background:C.white,border:`2px dashed ${C.line}`,borderRadius:16,padding:"60px 20px",textAlign:"center"}}>
        <div style={{width:64,height:64,background:C.lineLight,borderRadius:20,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 16px"}}><Ic d={I.print} s={30} c={C.ink4}/></div>
        <div style={{fontSize:16,fontWeight:700,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:6}}>ยังไม่มีเครื่องพิมพ์</div>
        <div style={{fontSize:13,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>เพิ่มเครื่องพิมพ์แรกของคุณด้านบน</div>
      </div>:
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:16}}>
        {printers.map(p=>{
          const typeConf={kitchen:{label:"ครัว",emoji:"🍳",color:"#F59E0B",bg:"#FFFBEB",border:"#FDE68A"},bar:{label:"บาร์",emoji:"🍹",color:"#10B981",bg:"#ECFDF5",border:"#A7F3D0"},receipt:{label:"แคชเชียร์",emoji:"🧾",color:"#3B82F6",bg:"#EFF6FF",border:"#BFDBFE"},other:{label:"อื่นๆ",emoji:"📄",color:"#8B5CF6",bg:"#F5F3FF",border:"#DDD6FE"}}[p.type]||{label:p.type,emoji:"🖨️",color:C.ink3,bg:C.bg,border:C.line};
          return <div key={p.id} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:16,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,0.05)",transition:"box-shadow .2s",display:"flex",flexDirection:"column"}}>
            <div style={{padding:"18px 20px 14px",borderBottom:`1px solid ${C.line}`,background:`linear-gradient(135deg,${typeConf.bg},${C.white})`,display:"flex",alignItems:"flex-start",gap:14}}>
              <div style={{width:48,height:48,background:typeConf.bg,border:`2px solid ${typeConf.border}`,borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center",fontSize:22,flexShrink:0}}>{typeConf.emoji}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                  <span style={{fontWeight:800,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.name}</span>
                </div>
                <div style={{display:"inline-flex",alignItems:"center",gap:5,background:typeConf.bg,border:`1px solid ${typeConf.border}`,borderRadius:20,padding:"2px 10px"}}>
                  <span style={{fontSize:11,fontWeight:700,color:typeConf.color,fontFamily:"'Sarabun',sans-serif"}}>{typeConf.label}</span>
                </div>
              </div>
              <div style={{display:"flex",gap:6,flexShrink:0}}>
                <button onClick={()=>{const pc=getPConn(p);setPForm({name:p.name,ip:pc.type==="bluetooth"?"":p.ip,port:p.port||9100,description:pc.type==="bluetooth"?"":p.description||"",type:p.type||"kitchen",branch_id:p.branch_id,active:p.active,conn:pc.type,btName:pc.btName||""});setEditPID(p.id);}} title="แก้ไข" style={{background:C.blueLight,border:`1px solid #BFDBFE`,borderRadius:9,padding:"6px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                  <Ic d={I.pencil} s={13} c={C.blue}/><span style={{fontSize:11,color:C.blue,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>แก้ไข</span>
                </button>
                <button onClick={async()=>{if(!await confirmDlg({title:"ลบเครื่องปริ้น",message:`ต้องการลบ "${p.name}" ใช่หรือไม่?`}))return;try{await api.deletePrinter(p.id);await reloadPrinters();}catch{alert("ลบไม่สำเร็จ");}}} title="ลบ" style={{background:C.redLight,border:`1px solid #FECACA`,borderRadius:9,padding:"6px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:5}}>
                  <Ic d={I.trash} s={13} c={C.red}/><span style={{fontSize:11,color:C.red,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>ลบ</span>
                </button>
              </div>
            </div>
            <div style={{padding:"14px 20px",display:"flex",flexDirection:"column",gap:8}}>
              {(()=>{const tr=testResults[p.id];const dotColor=!tr?C.ink3:tr.status==="testing"?C.yellow:tr.status==="ok"?C.green:C.red;const dotAnim=tr?.status==="testing"?"pulse 1s infinite":"none";const pc=getPConn(p);const isBT=pc.type==="bluetooth";return<div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 14px",background:"#F8FAFC",borderRadius:10,border:`1px solid ${tr?.status==="ok"?C.green:tr?.status==="fail"?C.red:C.line}`,transition:"border .3s"}}>
                <div style={{width:9,height:9,borderRadius:"50%",background:dotColor,boxShadow:`0 0 6px ${dotColor}88`,flexShrink:0,animation:dotAnim}}/>
                <div style={{flex:1}}>
                  <div style={{display:"flex",alignItems:"center",gap:6}}>
                    <span style={{fontSize:11,background:isBT?C.brandLight:C.blueLight,color:isBT?C.brand:C.blue,border:`1px solid ${isBT?C.brandBorder:"#BFDBFE"}`,borderRadius:6,padding:"1px 7px",fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>{isBT?"📶 Bluetooth":"🌐 IP"}</span>
                    <span style={{fontSize:13,fontWeight:800,color:C.ink,fontFamily:"monospace",letterSpacing:.5}}>{isBT?pc.btName||"—":`${p.ip}:${p.port||9100}`}</span>
                  </div>
                  <div style={{fontSize:11,color:tr?.status==="ok"?C.green:tr?.status==="fail"?C.red:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:tr?600:400,marginTop:2}}>
                    {!tr&&(isBT?"กด ทดสอบ เพื่อจับคู่ Bluetooth":"IP Address : Port")}
                    {tr?.status==="testing"&&"⏳ กำลังทดสอบ..."}
                    {tr?.status==="ok"&&`✅ ${tr.msg}`}
                    {tr?.status==="fail"&&`❌ ${tr.msg}`}
                  </div>
                </div>
                <button onClick={()=>testPrinter(p)} disabled={testResults[p.id]?.status==="testing"} style={{padding:"6px 14px",borderRadius:8,border:`1.5px solid ${C.brand}`,background:testResults[p.id]?.status==="testing"?C.lineLight:C.brandLight,color:C.brand,cursor:testResults[p.id]?.status==="testing"?"not-allowed":"pointer",fontSize:12,fontWeight:700,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>
                  {testResults[p.id]?.status==="testing"?"...":"🔌 ทดสอบ"}
                </button>
              </div>;})()}
              {p.description&&!p.description.startsWith("{")&&<div style={{fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif",padding:"8px 12px",background:"#FFFBEB",borderRadius:8,border:"1px solid #FDE68A"}}>📝 {p.description}</div>}
              {p.branch_id&&branches.find(b=>b.id===p.branch_id)&&<div style={{fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:6}}>
                <Ic d={I.branch} s={13} c={C.ink4}/><span>สาขา: <b>{branches.find(b=>b.id===p.branch_id)?.name}</b></span>
              </div>}
              {!p.branch_id&&<div style={{fontSize:12,color:C.teal,fontFamily:"'Sarabun',sans-serif",display:"flex",alignItems:"center",gap:6}}>
                <Ic d={I.shop} s={13} c={C.teal}/><span>ใช้งานได้ทุกสาขา</span>
              </div>}
            </div>
          </div>;
        })}
      </div>}
    </div>}
    </div>

    {showUser&&<Modal title={editUID?"✏️ แก้ไขผู้ใช้":"➕ เพิ่มผู้ใช้ใหม่"} onClose={()=>setShowUser(false)} extraWide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20}}>
        <div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}><Inp label="ชื่อผู้ใช้" value={uF.username} onChange={e=>setUF(f=>({...f,username:e.target.value}))} placeholder="username"/><Inp label="รหัสผ่าน" type="password" value={uF.password} onChange={e=>setUF(f=>({...f,password:e.target.value}))} placeholder="password"/></div>
          <Inp label="ชื่อ-นามสกุล" value={uF.name} onChange={e=>setUF(f=>({...f,name:e.target.value}))} placeholder="ชื่อจริง"/>
          <div style={{marginBottom:14}}><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>บทบาท</label><div style={{display:"flex",gap:8,flexWrap:"wrap"}}>{Object.entries(ROLES).map(([k,r])=><button key={k} onClick={()=>setUF(f=>({...f,role:k,perms:ROLE_DEFAULT_PERMS[k]||[]}))} style={{padding:"6px 12px",borderRadius:8,border:`2px solid ${uF.role===k?C.brand:C.line}`,background:uF.role===k?C.brandLight:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13,color:uF.role===k?C.brand:C.ink3}}>{r.label}</button>)}</div></div>
          <div style={{display:"flex",gap:8}}>{[{v:true,l:"ใช้งาน"},{v:false,l:"ปิดใช้"}].map(o=><button key={String(o.v)} onClick={()=>setUF(f=>({...f,active:o.v}))} style={{padding:"6px 14px",borderRadius:8,border:`2px solid ${uF.active===o.v?C.brand:C.line}`,background:uF.active===o.v?C.brandLight:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13,color:uF.active===o.v?C.brand:C.ink3}}>{o.l}</button>)}</div>
        </div>
        <div>
          <div style={{fontSize:13,fontWeight:700,color:C.ink2,marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>เมนูที่เข้าถึงได้ ({(uF.perms||[]).length}/{ALL_PERMS.length})</div>
          <div style={{background:C.bg,borderRadius:12,padding:"10px",border:`1px solid ${C.line}`,marginBottom:14}}>
            {ALL_PERMS.map(p=>{const has=(uF.perms||[]).includes(p.id);return <label key={p.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",borderRadius:10,cursor:"pointer",background:has?C.brandLight:C.white,marginBottom:4,border:`1.5px solid ${has?C.brandBorder:C.line}`,transition:"all .15s"}}>
              <input type="checkbox" checked={has} onChange={()=>setUF(f=>{const ps=f.perms||[];return{...f,perms:ps.includes(p.id)?ps.filter(x=>x!==p.id):[...ps,p.id]};})} style={{accentColor:C.brand,width:16,height:16}}/>
              <span style={{fontSize:14,fontFamily:"'Sarabun',sans-serif",fontWeight:has?700:400,color:has?C.brand:C.ink2}}>{p.label}</span>
              {has&&<span style={{marginLeft:"auto",fontSize:11,color:C.green,fontWeight:700}}>✓ เข้าถึงได้</span>}
            </label>;})}
          </div>
          {/* Branch access */}
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
            <div style={{fontSize:13,fontWeight:700,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>🏢 สาขาที่เข้าถึงได้ {uF.allowed_branches===null?"(ทุกสาขา)":`(${(uF.allowed_branches||[]).length}/${branches.length})`}</div>
            <div style={{display:"flex",gap:5}}>
              <button onClick={()=>setUF(f=>({...f,allowed_branches:null}))} style={{padding:"4px 9px",borderRadius:7,border:`1px solid ${uF.allowed_branches===null?C.green:C.line}`,background:uF.allowed_branches===null?C.greenLight:C.white,color:uF.allowed_branches===null?C.green:C.ink3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ทุกสาขา</button>
              <button onClick={()=>setUF(f=>({...f,allowed_branches:branches.map(b=>+b.id)}))} style={{padding:"4px 9px",borderRadius:7,border:`1px solid ${C.line}`,background:C.white,color:C.ink3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>เลือกทั้งหมด</button>
              <button onClick={()=>setUF(f=>({...f,allowed_branches:[]}))} style={{padding:"4px 9px",borderRadius:7,border:`1px solid ${C.line}`,background:C.white,color:C.ink3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ล้าง</button>
            </div>
          </div>
          {uF.role==="admin"
            ?<div style={{padding:"12px 14px",background:C.purpleLight,borderRadius:10,border:`1.5px solid ${C.purple}`,fontSize:12,color:C.purple,fontFamily:"'Sarabun',sans-serif",fontWeight:600,lineHeight:1.6}}>👑 <b>Admin</b> เข้าได้ทุกสาขาเสมอ — ไม่ต้องตั้งค่า</div>
            :uF.allowed_branches===null
              ?<div style={{padding:"12px 14px",background:C.greenLight,borderRadius:10,border:`1.5px solid ${C.green}`,fontSize:12,color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:600,lineHeight:1.6}}>✅ ผู้ใช้นี้เข้าได้ทุกสาขา</div>
              :<div style={{background:C.bg,borderRadius:12,padding:"10px",border:`1px solid ${C.line}`,maxHeight:200,overflowY:"auto"}}>
                {branches.length===0&&<div style={{padding:14,textAlign:"center",color:C.ink4,fontSize:12,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีสาขาในระบบ</div>}
                {branches.map(b=>{const has=(uF.allowed_branches||[]).map(x=>+x).includes(+b.id);return <label key={b.id} style={{display:"flex",alignItems:"center",gap:10,padding:"7px 12px",borderRadius:9,cursor:"pointer",background:has?C.brandLight:C.white,marginBottom:4,border:`1.5px solid ${has?C.brandBorder:C.line}`,transition:"all .15s"}}>
                  <input type="checkbox" checked={has} onChange={()=>toggleUserBranch(b.id)} style={{accentColor:C.brand,width:15,height:15}}/>
                  <span style={{fontSize:13,fontFamily:"'Sarabun',sans-serif",fontWeight:has?800:500,color:has?C.brand:C.ink2}}>{b.name}</span>
                  <Chip color={b.type==="central"?"teal":"orange"}>{b.type==="central"?"ครัวกลาง":"สาขา"}</Chip>
                  {b.active===false&&<Chip color="gray">ปิด</Chip>}
                </label>;})}
              </div>}
        </div>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",paddingTop:14,borderTop:`1px solid ${C.line}`,marginTop:8}}>
        <Btn v="ghost" onClick={()=>setShowUser(false)}>ยกเลิก</Btn>
        <Btn onClick={saveUser} icon={I.check} disabled={!uF.username||!uF.password} loading={saving}>{editUID?"บันทึก":"เพิ่มผู้ใช้"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── CRM TAB ───────────────────────────────────────────
// ══════════════════════════════════════════════════════
const CRM_TIERS=[
  {id:"bronze",label:"Bronze",min:0,max:999,color:"#92400E",bg:"#FEF3C7"},
  {id:"silver",label:"Silver",min:1000,max:4999,color:"#475569",bg:"#F1F5F9"},
  {id:"gold",label:"Gold",min:5000,max:14999,color:"#B45309",bg:"#FEF9C3"},
  {id:"platinum",label:"Platinum",min:15000,max:Infinity,color:"#7C3AED",bg:"#F5F3FF"},
];
function getTier(pts){return CRM_TIERS.find(t=>pts>=t.min&&pts<=t.max)||CRM_TIERS[0];}
function getCustomerTags(cust,txns){
  const tags=[];
  const myTxns=txns.filter(t=>t.customer_id===cust.id);
  const now=Date.now();
  const createdMs=new Date(cust.created_at||0).getTime();
  if(now-createdMs<30*24*3600*1000)tags.push({l:"ใหม่",c:C.blue,bg:C.blueLight});
  else if(myTxns.length>=5)tags.push({l:"ประจำ",c:C.green,bg:C.greenLight});
  if(myTxns.length>0){
    const lastMs=Math.max(...myTxns.map(t=>new Date(t.created_at||0).getTime()));
    if(now-lastMs>60*24*3600*1000)tags.push({l:"เสี่ยงหาย",c:C.red,bg:C.redLight});
  }
  return tags;
}
function genVoucherCode(){return"VCH-"+Math.random().toString(36).slice(2,8).toUpperCase();}

function CRMTab({currentBranch,currentUser,menus}){
  const[subTab,setSubTab]=useState("customers");
  const[customers,setCustomers]=useState([]);
  const[transactions,setTransactions]=useState([]);
  const[vouchers,setVouchers]=useState([]);
  const[feedback,setFeedback]=useState([]);
  const[reservations,setReservations]=useState([]);
  const[loading,setLoading]=useState(false);
  const[err,setErr]=useState("");

  // Customer sub-states
  const[custSearch,setCustSearch]=useState("");
  const[showCustForm,setShowCustForm]=useState(false);
  const[editCust,setEditCust]=useState(null);
  const[selCust,setSelCust]=useState(null);
  const[custFilter,setCustFilter]=useState("all");

  // Reservation sub-states
  const[showResForm,setShowResForm]=useState(false);
  const[editRes,setEditRes]=useState(null);
  const[resFilter,setResFilter]=useState("all");

  // Voucher sub-states
  const[showVoucherForm,setShowVoucherForm]=useState(false);
  const[voucherCustId,setVoucherCustId]=useState("");

  // Feedback sub-states
  const[showFeedForm,setShowFeedForm]=useState(false);

  const canEdit=currentUser&&(currentUser.role==="admin"||currentUser.role==="manager"||currentUser.role==="staff");

  async function loadAll(){
    setLoading(true);setErr("");
    try{
      const[c,tx,v,fb,res]=await Promise.all([
        api.getCRMCustomers(currentBranch.id),
        api.getCRMTransactions(currentBranch.id),
        api.getCRMVouchers(currentBranch.id),
        api.getCRMFeedback(currentBranch.id),
        api.getCRMReservations(currentBranch.id),
      ]);
      setCustomers(c);setTransactions(tx);setVouchers(v);setFeedback(fb);setReservations(res);
    }catch(e){setErr(e.message);}
    setLoading(false);
  }
  useEffect(()=>{loadAll();},[]);

  const filteredCustomers=useMemo(()=>{
    let list=customers;
    if(custSearch){const q=custSearch.toLowerCase();list=list.filter(c=>(c.name||"").toLowerCase().includes(q)||(c.phone||"").includes(q));}
    if(custFilter==="new")list=list.filter(c=>Date.now()-new Date(c.created_at||0).getTime()<30*24*3600*1000);
    if(custFilter==="regular")list=list.filter(c=>transactions.filter(t=>t.customer_id===c.id).length>=5);
    if(custFilter==="atrisk")list=list.filter(c=>{const myTxns=transactions.filter(t=>t.customer_id===c.id);if(!myTxns.length)return false;const lastMs=Math.max(...myTxns.map(t=>new Date(t.created_at||0).getTime()));return Date.now()-lastMs>60*24*3600*1000;});
    if(custFilter==="silver")list=list.filter(c=>getTier(c.points||0).id==="silver");
    if(custFilter==="gold")list=list.filter(c=>getTier(c.points||0).id==="gold");
    if(custFilter==="platinum")list=list.filter(c=>getTier(c.points||0).id==="platinum");
    return list;
  },[customers,transactions,custSearch,custFilter]);

  const SUB_TABS=[
    {id:"customers",l:"ลูกค้า"},
    {id:"loyalty",l:"ความภักดี"},
    {id:"reservations",l:"จองโต๊ะ"},
    {id:"feedback",l:"ความคิดเห็น"},
    {id:"analytics",l:"วิเคราะห์"},
  ];

  if(loading)return <Loading text="กำลังโหลด CRM..."/>;
  if(err)return <ErrBox msg={err} onRetry={loadAll}/>;

  return <div>
    {/* Sub-tab nav */}
    <div style={{display:"flex",gap:6,marginBottom:20,background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:6,flexWrap:"wrap"}}>
      {SUB_TABS.map(st=><button key={st.id} onClick={()=>setSubTab(st.id)} style={{padding:"7px 18px",borderRadius:8,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:subTab===st.id?700:500,background:subTab===st.id?C.brand:"transparent",color:subTab===st.id?"#fff":C.ink3,transition:"all .15s"}}>{st.l}</button>)}
    </div>

    {/* ── CUSTOMERS ── */}
    {subTab==="customers"&&<CRMCustomers customers={filteredCustomers} allCustomers={customers} transactions={transactions} vouchers={vouchers} custSearch={custSearch} setCustSearch={setCustSearch} custFilter={custFilter} setCustFilter={setCustFilter} selCust={selCust} setSelCust={setSelCust} showCustForm={showCustForm} setShowCustForm={setShowCustForm} editCust={editCust} setEditCust={setEditCust} canEdit={canEdit} currentBranch={currentBranch} reload={loadAll} menus={menus}/>}

    {/* ── LOYALTY ── */}
    {subTab==="loyalty"&&<CRMloyalty customers={customers} transactions={transactions} vouchers={vouchers} setVouchers={setVouchers} showVoucherForm={showVoucherForm} setShowVoucherForm={setShowVoucherForm} voucherCustId={voucherCustId} setVoucherCustId={setVoucherCustId} canEdit={canEdit} currentBranch={currentBranch} reload={loadAll}/>}

    {/* ── RESERVATIONS ── */}
    {subTab==="reservations"&&<CRMReservations reservations={reservations} customers={customers} showResForm={showResForm} setShowResForm={setShowResForm} editRes={editRes} setEditRes={setEditRes} resFilter={resFilter} setResFilter={setResFilter} canEdit={canEdit} currentBranch={currentBranch} reload={loadAll}/>}

    {/* ── FEEDBACK ── */}
    {subTab==="feedback"&&<CRMFeedback feedback={feedback} customers={customers} showFeedForm={showFeedForm} setShowFeedForm={setShowFeedForm} canEdit={canEdit} currentBranch={currentBranch} reload={loadAll}/>}

    {/* ── ANALYTICS ── */}
    {subTab==="analytics"&&<CRMAnalytics customers={customers} transactions={transactions} feedback={feedback} reservations={reservations}/>}
  </div>;
}

// ── CRM Customers sub-component ──
function CRMCustomers({customers,allCustomers,transactions,vouchers,custSearch,setCustSearch,custFilter,setCustFilter,selCust,setSelCust,showCustForm,setShowCustForm,editCust,setEditCust,canEdit,currentBranch,reload,menus}){
  const[saving,setSaving]=useState(false);
  const[form,setForm]=useState({name:"",phone:"",birthdate:"",allergies:"",seat_pref:"",notes:""});
  const[showPoints,setShowPoints]=useState(false);
  const[ptForm,setPtForm]=useState({amount:"",type:"earn",note:""});
  const[ptSaving,setPtSaving]=useState(false);

  useEffect(()=>{
    if(editCust)setForm({name:editCust.name||"",phone:editCust.phone||"",birthdate:editCust.birthdate||"",allergies:editCust.allergies||"",seat_pref:editCust.seat_pref||"",notes:editCust.notes||""});
    else setForm({name:"",phone:"",birthdate:"",allergies:"",seat_pref:"",notes:""});
  },[editCust,showCustForm]);

  async function saveCust(){
    if(!form.name.trim())return alert("กรุณาใส่ชื่อลูกค้า");
    setSaving(true);
    try{
      const d={...form,branch_id:currentBranch.id,points:editCust?editCust.points:0};
      if(editCust)await api.updateCRMCustomer(editCust.id,{name:form.name,phone:form.phone,birthdate:form.birthdate||null,allergies:form.allergies,seat_pref:form.seat_pref,notes:form.notes});
      else await api.addCRMCustomer(d);
      await reload();setShowCustForm(false);setEditCust(null);
    }catch(e){alert("เกิดข้อผิดพลาด: "+e.message);}
    setSaving(false);
  }

  async function delCust(c){
    if(!await confirmDlg(`ลบลูกค้า "${c.name}"?`,"ลบ","ยกเลิก"))return;
    try{await api.deleteCRMCustomer(c.id);await reload();if(selCust?.id===c.id)setSelCust(null);}
    catch(e){alert("ลบไม่ได้: "+e.message);}
  }

  async function adjustPoints(){
    if(!selCust||!ptForm.amount)return;
    const amt=parseInt(ptForm.amount);
    if(isNaN(amt)||amt<=0)return alert("กรุณาใส่จำนวนคะแนน");
    const delta=ptForm.type==="earn"?amt:-amt;
    const newPts=Math.max(0,(selCust.points||0)+delta);
    setPtSaving(true);
    try{
      await api.updateCRMCustomer(selCust.id,{points:newPts});
      await api.addCRMTransaction({customer_id:selCust.id,branch_id:currentBranch.id,amount:0,points_earned:ptForm.type==="earn"?amt:0,points_redeemed:ptForm.type==="redeem"?amt:0,note:ptForm.note,created_at:new Date().toISOString()});
      await reload();setShowPoints(false);setPtForm({amount:"",type:"earn",note:""});
      setSelCust(prev=>prev?{...prev,points:newPts}:prev);
    }catch(e){alert("เกิดข้อผิดพลาด: "+e.message);}
    setPtSaving(false);
  }

  const FILTERS=[{id:"all",l:"ทั้งหมด"},{id:"new",l:"ใหม่"},{id:"regular",l:"ประจำ"},{id:"atrisk",l:"เสี่ยงหาย"},{id:"silver",l:"Silver"},{id:"gold",l:"Gold"},{id:"platinum",l:"Platinum"}];

  return <div>
    <div style={{display:"flex",gap:10,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{position:"relative",flex:1,minWidth:200}}>
        <Ic d={I.search} s={15} c={C.ink4} style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)"}}/>
        <input value={custSearch} onChange={e=>setCustSearch(e.target.value)} placeholder="ค้นหาชื่อ / เบอร์โทร..." style={{width:"100%",paddingLeft:34,paddingRight:12,height:38,border:"1px solid "+C.line,borderRadius:8,fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none",boxSizing:"border-box"}}/>
      </div>
      <div style={{display:"flex",gap:4,flexWrap:"wrap"}}>
        {FILTERS.map(f=><button key={f.id} onClick={()=>setCustFilter(f.id)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid "+(custFilter===f.id?C.brand:C.line),background:custFilter===f.id?C.brand:"#fff",color:custFilter===f.id?"#fff":C.ink3,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>{f.l}</button>)}
      </div>
      {canEdit&&<Btn icon={I.plus} onClick={()=>{setEditCust(null);setShowCustForm(true);}}>เพิ่มลูกค้า</Btn>}
    </div>

    <div style={{display:"grid",gridTemplateColumns:selCust?"1fr 360px":"1fr",gap:16}}>
      {/* Customer list */}
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {customers.length===0&&<div style={{textAlign:"center",padding:40,color:C.ink4}}>ยังไม่มีข้อมูลลูกค้า</div>}
        {customers.map(c=>{
          const tier=getTier(c.points||0);
          const tags=getCustomerTags(c,transactions);
          const myTxns=transactions.filter(t=>t.customer_id===c.id);
          const totalSpend=myTxns.reduce((s,t)=>s+(t.amount||0),0);
          const active=selCust?.id===c.id;
          return <div key={c.id} onClick={()=>setSelCust(active?null:c)} style={{background:"#fff",border:"2px solid "+(active?C.brand:C.line),borderRadius:12,padding:"12px 16px",cursor:"pointer",transition:"all .15s",display:"flex",alignItems:"center",gap:12}}>
            <div style={{width:44,height:44,borderRadius:"50%",background:`linear-gradient(135deg,${tier.bg},${tier.color}22)`,border:`2px solid ${tier.color}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:16,fontWeight:900,color:tier.color}}>{(c.name||"?")[0]}</span>
            </div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
                <span style={{fontWeight:700,fontSize:14,color:C.ink}}>{c.name}</span>
                <span style={{fontSize:11,padding:"1px 7px",borderRadius:20,background:tier.bg,color:tier.color,fontWeight:700}}>{tier.label}</span>
                {tags.map((tg,i)=><span key={i} style={{fontSize:11,padding:"1px 7px",borderRadius:20,background:tg.bg,color:tg.c,fontWeight:700}}>{tg.l}</span>)}
              </div>
              <div style={{fontSize:12,color:C.ink3,marginTop:2}}>{c.phone||"ไม่มีเบอร์"} • {myTxns.length} ครั้ง • ยอดรวม ฿{totalSpend.toLocaleString()}</div>
            </div>
            <div style={{textAlign:"right",flexShrink:0}}>
              <div style={{fontSize:18,fontWeight:900,color:C.brand}}>{(c.points||0).toLocaleString()}</div>
              <div style={{fontSize:10,color:C.ink4}}>คะแนน</div>
            </div>
            {canEdit&&<div style={{display:"flex",gap:4}} onClick={e=>e.stopPropagation()}>
              <button onClick={()=>{setEditCust(c);setShowCustForm(true);}} style={{padding:"6px",border:"1px solid "+C.line,borderRadius:7,background:"#fff",cursor:"pointer"}}><Ic d={I.pencil} s={13} c={C.ink3}/></button>
              <button onClick={()=>delCust(c)} style={{padding:"6px",border:"1px solid #FCA5A5",borderRadius:7,background:"#fff",cursor:"pointer"}}><Ic d={I.trash} s={13} c={C.red}/></button>
            </div>}
          </div>;
        })}
      </div>

      {/* Customer detail panel */}
      {selCust&&<div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:16,position:"sticky",top:80,maxHeight:"calc(100vh - 120px)",overflowY:"auto"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:12}}>
          <div>
            <div style={{fontWeight:800,fontSize:16,color:C.ink}}>{selCust.name}</div>
            <div style={{fontSize:12,color:C.ink3}}>{selCust.phone||"ไม่มีเบอร์"}</div>
          </div>
          <button onClick={()=>setSelCust(null)} style={{border:"none",background:"none",cursor:"pointer",padding:4}}><Ic d={I.x} s={16} c={C.ink3}/></button>
        </div>
        {/* Tier & points */}
        {(()=>{const tier=getTier(selCust.points||0);const nextTier=CRM_TIERS[CRM_TIERS.indexOf(tier)+1];const prog=nextTier?Math.min(100,((selCust.points||0)-tier.min)/(nextTier.min-tier.min)*100):100;return<div style={{background:tier.bg,border:`1px solid ${tier.color}44`,borderRadius:10,padding:12,marginBottom:12}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:6}}>
            <span style={{fontWeight:800,color:tier.color,fontSize:15}}>{tier.label} ⭐</span>
            <span style={{fontSize:18,fontWeight:900,color:tier.color}}>{(selCust.points||0).toLocaleString()} pts</span>
          </div>
          <div style={{height:6,background:"rgba(0,0,0,0.1)",borderRadius:3,overflow:"hidden"}}>
            <div style={{height:"100%",width:prog+"%",background:tier.color,borderRadius:3,transition:"width .5s"}}/>
          </div>
          {nextTier&&<div style={{fontSize:11,color:tier.color,marginTop:4}}>อีก {(nextTier.min-(selCust.points||0)).toLocaleString()} pts → {nextTier.label}</div>}
        </div>;})()}
        {/* Tags */}
        {(()=>{const tags=getCustomerTags(selCust,transactions);return tags.length>0&&<div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:10}}>{tags.map((tg,i)=><span key={i} style={{fontSize:12,padding:"3px 10px",borderRadius:20,background:tg.bg,color:tg.c,fontWeight:700}}>{tg.l}</span>)}</div>;})()}
        {/* Info */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
          {[["วันเกิด",selCust.birthdate?new Date(selCust.birthdate).toLocaleDateString("th-TH"):"—"],["เก้าอี้ที่ชอบ",selCust.seat_pref||"—"],["แพ้อาหาร",selCust.allergies||"—"],["หมายเหตุ",selCust.notes||"—"]].map(([k,v])=><div key={k} style={{background:C.lineLight,borderRadius:8,padding:"8px 10px"}}><div style={{fontSize:10,color:C.ink4,fontWeight:700}}>{k}</div><div style={{fontSize:12,color:C.ink,fontWeight:500,marginTop:2}}>{v}</div></div>)}
        </div>
        {/* Transactions */}
        <div style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:13,color:C.ink,marginBottom:6}}>ประวัติธุรกรรม</div>
          <div style={{maxHeight:160,overflowY:"auto",display:"flex",flexDirection:"column",gap:4}}>
            {transactions.filter(t=>t.customer_id===selCust.id).slice(0,20).map(t=><div key={t.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",background:C.lineLight,borderRadius:7,fontSize:12}}>
              <span style={{color:C.ink3}}>{new Date(t.created_at).toLocaleDateString("th-TH")}</span>
              <span style={{color:t.points_earned?C.green:C.red,fontWeight:700}}>{t.points_earned?"+"+t.points_earned+" pts":t.points_redeemed?"-"+t.points_redeemed+" pts":"—"}</span>
              {t.amount>0&&<span style={{color:C.ink}}>฿{t.amount.toLocaleString()}</span>}
            </div>)}
            {transactions.filter(t=>t.customer_id===selCust.id).length===0&&<div style={{color:C.ink4,fontSize:12,textAlign:"center",padding:8}}>ยังไม่มีธุรกรรม</div>}
          </div>
        </div>
        {/* Vouchers */}
        <div style={{marginBottom:12}}>
          <div style={{fontWeight:700,fontSize:13,color:C.ink,marginBottom:6}}>คูปอง</div>
          {vouchers.filter(v=>v.customer_id===selCust.id).map(v=><div key={v.id} style={{display:"flex",justifyContent:"space-between",padding:"5px 8px",background:v.status==="used"?"#F1F5F9":C.yellowLight,borderRadius:7,fontSize:12,marginBottom:4,opacity:v.status==="used"?.6:1}}>
            <span style={{fontWeight:700,color:C.ink,fontFamily:"monospace"}}>{v.code}</span>
            <span style={{color:C.ink3}}>{v.type==="percent"?v.value+"%":"฿"+v.value}</span>
            <span style={{color:v.status==="active"?C.green:v.status==="used"?C.ink3:C.red,fontWeight:700}}>{v.status==="active"?"ใช้ได้":v.status==="used"?"ใช้แล้ว":"หมดอายุ"}</span>
          </div>)}
          {vouchers.filter(v=>v.customer_id===selCust.id).length===0&&<div style={{color:C.ink4,fontSize:12}}>ยังไม่มีคูปอง</div>}
        </div>
        {canEdit&&<div style={{display:"flex",gap:6}}>
          <Btn icon={I.bolt} onClick={()=>{setShowPoints(true);}} style={{flex:1}}>ปรับคะแนน</Btn>
        </div>}
      </div>}
    </div>

    {/* Add/Edit Customer Modal */}
    {showCustForm&&<Modal title={editCust?"แก้ไขลูกค้า":"เพิ่มลูกค้าใหม่"} onClose={()=>{setShowCustForm(false);setEditCust(null);}}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Field label="ชื่อ-นามสกุล *"><Inp value={form.name} onChange={v=>setForm(f=>({...f,name:v}))} placeholder="ชื่อลูกค้า"/></Field>
        <Field label="เบอร์โทรศัพท์"><Inp value={form.phone} onChange={v=>setForm(f=>({...f,phone:v}))} placeholder="0812345678"/></Field>
        <Field label="วันเกิด"><Inp type="date" value={form.birthdate} onChange={v=>setForm(f=>({...f,birthdate:v}))}/></Field>
        <Field label="แพ้อาหาร / ข้อจำกัด"><Inp value={form.allergies} onChange={v=>setForm(f=>({...f,allergies:v}))} placeholder="เช่น แพ้ถั่ว, ไม่กินหมู"/></Field>
        <Field label="ที่นั่งที่ชอบ"><Inp value={form.seat_pref} onChange={v=>setForm(f=>({...f,seat_pref:v}))} placeholder="เช่น โต๊ะริมหน้าต่าง"/></Field>
        <Field label="หมายเหตุ"><TA value={form.notes} onChange={v=>setForm(f=>({...f,notes:v}))} rows={2} placeholder="ข้อมูลเพิ่มเติม"/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn onClick={()=>{setShowCustForm(false);setEditCust(null);}} style={{background:"#fff",color:C.ink3,border:"1px solid "+C.line}}>ยกเลิก</Btn>
          <Btn icon={I.save} onClick={saveCust} disabled={saving}>{saving?"กำลังบันทึก...":"บันทึก"}</Btn>
        </div>
      </div>
    </Modal>}

    {/* Adjust points modal */}
    {showPoints&&selCust&&<Modal title={`ปรับคะแนน — ${selCust.name}`} onClose={()=>setShowPoints(false)}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <div style={{display:"flex",gap:8}}>
          {[{id:"earn",l:"บวกคะแนน"},{id:"redeem",l:"หักคะแนน"}].map(opt=><button key={opt.id} onClick={()=>setPtForm(f=>({...f,type:opt.id}))} style={{flex:1,padding:"10px 0",borderRadius:8,border:"2px solid "+(ptForm.type===opt.id?C.brand:C.line),background:ptForm.type===opt.id?C.brand:"#fff",color:ptForm.type===opt.id?"#fff":C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,cursor:"pointer"}}>{opt.l}</button>)}
        </div>
        <Field label="จำนวนคะแนน"><Inp type="number" value={ptForm.amount} onChange={v=>setPtForm(f=>({...f,amount:v}))} placeholder="เช่น 100"/></Field>
        <Field label="หมายเหตุ"><Inp value={ptForm.note} onChange={v=>setPtForm(f=>({...f,note:v}))} placeholder="ซื้อสินค้า, แลกรางวัล ฯลฯ"/></Field>
        <div style={{background:C.lineLight,borderRadius:8,padding:10,fontSize:13}}>
          คะแนนปัจจุบัน: <b>{(selCust.points||0).toLocaleString()}</b> pts &nbsp;→&nbsp;
          หลังปรับ: <b style={{color:ptForm.type==="earn"?C.green:C.red}}>{Math.max(0,(selCust.points||0)+(ptForm.type==="earn"?+ptForm.amount:-+ptForm.amount)).toLocaleString()}</b> pts
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn onClick={()=>setShowPoints(false)} style={{background:"#fff",color:C.ink3,border:"1px solid "+C.line}}>ยกเลิก</Btn>
          <Btn icon={I.check} onClick={adjustPoints} disabled={ptSaving}>{ptSaving?"กำลังบันทึก...":"ยืนยัน"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

// ── CRM Loyalty sub-component ──
function CRMloyalty({customers,transactions,vouchers,setVouchers,showVoucherForm,setShowVoucherForm,voucherCustId,setVoucherCustId,canEdit,currentBranch,reload}){
  const[vForm,setVForm]=useState({customer_id:"",type:"fixed",value:"",expires_days:"30",note:""});
  const[saving,setSaving]=useState(false);

  async function saveVoucher(){
    if(!vForm.customer_id)return alert("กรุณาเลือกลูกค้า");
    if(!vForm.value||+vForm.value<=0)return alert("กรุณาใส่มูลค่าคูปอง");
    setSaving(true);
    try{
      const expDate=new Date();expDate.setDate(expDate.getDate()+parseInt(vForm.expires_days||30));
      await api.addCRMVoucher({customer_id:parseInt(vForm.customer_id),branch_id:currentBranch.id,code:genVoucherCode(),type:vForm.type,value:parseFloat(vForm.value),status:"active",expires_at:expDate.toISOString(),note:vForm.note,created_at:new Date().toISOString()});
      await reload();setShowVoucherForm(false);setVForm({customer_id:"",type:"fixed",value:"",expires_days:"30",note:""});
    }catch(e){alert("เกิดข้อผิดพลาด: "+e.message);}
    setSaving(false);
  }

  async function useVoucher(v){
    if(v.status!=="active")return;
    if(!await confirmDlg(`ทำเครื่องหมายว่าใช้คูปอง ${v.code}?`,"ยืนยัน","ยกเลิก"))return;
    try{await api.updateCRMVoucher(v.id,{status:"used"});await reload();}
    catch(e){alert(e.message);}
  }
  async function deleteVoucher(v){
    if(!await confirmDlg(`ลบคูปอง ${v.code}?`,"ลบ","ยกเลิก"))return;
    try{await api.deleteCRMVoucher(v.id);await reload();}
    catch(e){alert(e.message);}
  }

  const tierStats=CRM_TIERS.map(tier=>{
    const inTier=customers.filter(c=>getTier(c.points||0).id===tier.id);
    return{...tier,count:inTier.length,totalPts:inTier.reduce((s,c)=>s+(c.points||0),0)};
  });

  return <div>
    {/* Tier overview cards */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(180px,1fr))",gap:12,marginBottom:20}}>
      {tierStats.map(tier=><div key={tier.id} style={{background:tier.bg,border:`1px solid ${tier.color}44`,borderRadius:12,padding:"14px 16px"}}>
        <div style={{fontWeight:800,fontSize:15,color:tier.color}}>{tier.label}</div>
        <div style={{fontSize:26,fontWeight:900,color:tier.color,marginTop:4}}>{tier.count}</div>
        <div style={{fontSize:11,color:tier.color,opacity:.8}}>คน • {tier.min.toLocaleString()}+ pts</div>
      </div>)}
    </div>

    {/* Top customers by points */}
    <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:14,color:C.ink}}>ลูกค้าสะสมคะแนนสูงสุด</div>
        {canEdit&&<Btn icon={I.plus} onClick={()=>setShowVoucherForm(true)}>ออกคูปอง</Btn>}
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {[...customers].sort((a,b)=>(b.points||0)-(a.points||0)).slice(0,10).map((c,idx)=>{
          const tier=getTier(c.points||0);
          return<div key={c.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:idx===0?C.yellowLight:C.lineLight,borderRadius:8}}>
            <div style={{width:24,height:24,borderRadius:"50%",background:tier.color,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <span style={{fontSize:11,fontWeight:900,color:"#fff"}}>{idx+1}</span>
            </div>
            <div style={{flex:1,fontWeight:600,fontSize:13,color:C.ink}}>{c.name}</div>
            <span style={{fontSize:11,padding:"2px 8px",borderRadius:20,background:tier.bg,color:tier.color,fontWeight:700}}>{tier.label}</span>
            <div style={{fontWeight:800,color:C.brand,fontSize:15}}>{(c.points||0).toLocaleString()} pts</div>
          </div>;
        })}
        {customers.length===0&&<div style={{textAlign:"center",padding:20,color:C.ink4}}>ยังไม่มีข้อมูลลูกค้า</div>}
      </div>
    </div>

    {/* Vouchers list */}
    <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:16}}>
      <div style={{fontWeight:700,fontSize:14,color:C.ink,marginBottom:12}}>คูปองทั้งหมด</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {vouchers.map(v=>{
          const cust=customers.find(c=>c.id===v.customer_id);
          const expired=v.status==="active"&&new Date(v.expires_at)<new Date();
          return<div key={v.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",background:v.status==="used"||expired?"#F8FAFC":C.yellowLight,borderRadius:8,opacity:v.status==="used"||expired?.6:1}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:"monospace",fontWeight:800,color:C.ink,fontSize:14}}>{v.code}</div>
              <div style={{fontSize:11,color:C.ink3,marginTop:1}}>{cust?.name||"ลูกค้า"} • หมดอายุ {new Date(v.expires_at).toLocaleDateString("th-TH")}</div>
            </div>
            <div style={{fontWeight:800,color:C.brand,fontSize:15}}>{v.type==="percent"?v.value+"%":"฿"+v.value}</div>
            <span style={{fontSize:11,padding:"3px 9px",borderRadius:20,fontWeight:700,background:v.status==="active"&&!expired?C.greenLight:C.lineLight,color:v.status==="active"&&!expired?C.green:C.ink3}}>{v.status==="used"?"ใช้แล้ว":expired?"หมดอายุ":"ใช้ได้"}</span>
            {canEdit&&<div style={{display:"flex",gap:4}}>
              {v.status==="active"&&!expired&&<button onClick={()=>useVoucher(v)} title="ทำเครื่องหมายว่าใช้แล้ว" style={{padding:"5px",border:"1px solid "+C.green,borderRadius:6,background:"#fff",cursor:"pointer"}}><Ic d={I.check} s={12} c={C.green}/></button>}
              <button onClick={()=>deleteVoucher(v)} style={{padding:"5px",border:"1px solid #FCA5A5",borderRadius:6,background:"#fff",cursor:"pointer"}}><Ic d={I.trash} s={12} c={C.red}/></button>
            </div>}
          </div>;
        })}
        {vouchers.length===0&&<div style={{textAlign:"center",padding:20,color:C.ink4}}>ยังไม่มีคูปอง</div>}
      </div>
    </div>

    {/* Issue Voucher Modal */}
    {showVoucherForm&&<Modal title="ออกคูปองใหม่" onClose={()=>setShowVoucherForm(false)}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Field label="ลูกค้า *">
          <select value={vForm.customer_id} onChange={e=>setVForm(f=>({...f,customer_id:e.target.value}))} style={{width:"100%",padding:"8px 10px",border:"1px solid "+C.line,borderRadius:8,fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
            <option value="">-- เลือกลูกค้า --</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.phone||"ไม่มีเบอร์"})</option>)}
          </select>
        </Field>
        <div style={{display:"flex",gap:8}}>
          {[{id:"fixed",l:"ส่วนลด (฿)"},{id:"percent",l:"ส่วนลด (%)"}].map(opt=><button key={opt.id} onClick={()=>setVForm(f=>({...f,type:opt.id}))} style={{flex:1,padding:"9px 0",borderRadius:8,border:"2px solid "+(vForm.type===opt.id?C.brand:C.line),background:vForm.type===opt.id?C.brand:"#fff",color:vForm.type===opt.id?"#fff":C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>{opt.l}</button>)}
        </div>
        <Field label={vForm.type==="percent"?"ส่วนลด (%)":"มูลค่า (฿)"}><Inp type="number" value={vForm.value} onChange={v=>setVForm(f=>({...f,value:v}))} placeholder={vForm.type==="percent"?"เช่น 10":"เช่น 50"}/></Field>
        <Field label="หมดอายุภายใน (วัน)"><Inp type="number" value={vForm.expires_days} onChange={v=>setVForm(f=>({...f,expires_days:v}))} placeholder="30"/></Field>
        <Field label="หมายเหตุ"><Inp value={vForm.note} onChange={v=>setVForm(f=>({...f,note:v}))} placeholder="เช่น วันเกิด, ครบรอบ"/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn onClick={()=>setShowVoucherForm(false)} style={{background:"#fff",color:C.ink3,border:"1px solid "+C.line}}>ยกเลิก</Btn>
          <Btn icon={I.tag} onClick={saveVoucher} disabled={saving}>{saving?"กำลังออก...":"ออกคูปอง"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

// ── CRM Reservations sub-component ──
function CRMReservations({reservations,customers,showResForm,setShowResForm,editRes,setEditRes,resFilter,setResFilter,canEdit,currentBranch,reload}){
  const[form,setForm]=useState({customer_id:"",reserved_at:"",party_size:"2",table_pref:"",special_req:"",status:"pending"});
  const[saving,setSaving]=useState(false);

  useEffect(()=>{
    if(editRes)setForm({customer_id:String(editRes.customer_id||""),reserved_at:editRes.reserved_at?editRes.reserved_at.slice(0,16):"",party_size:String(editRes.party_size||2),table_pref:editRes.table_pref||"",special_req:editRes.special_req||"",status:editRes.status||"pending"});
    else setForm({customer_id:"",reserved_at:"",party_size:"2",table_pref:"",special_req:"",status:"pending"});
  },[editRes,showResForm]);

  async function saveRes(){
    if(!form.reserved_at)return alert("กรุณาเลือกวันเวลาจอง");
    setSaving(true);
    try{
      const d={customer_id:form.customer_id?parseInt(form.customer_id):null,branch_id:currentBranch.id,reserved_at:new Date(form.reserved_at).toISOString(),party_size:parseInt(form.party_size)||2,table_pref:form.table_pref,special_req:form.special_req,status:form.status};
      if(editRes)await api.updateCRMReservation(editRes.id,d);
      else await api.addCRMReservation({...d,created_at:new Date().toISOString()});
      await reload();setShowResForm(false);setEditRes(null);
    }catch(e){alert("เกิดข้อผิดพลาด: "+e.message);}
    setSaving(false);
  }

  async function updateStatus(res,status){
    try{await api.updateCRMReservation(res.id,{status});await reload();}
    catch(e){alert(e.message);}
  }
  async function delRes(res){
    if(!await confirmDlg("ลบการจองนี้?","ลบ","ยกเลิก"))return;
    try{await api.deleteCRMReservation(res.id);await reload();}
    catch(e){alert(e.message);}
  }

  const STATUS_MAP={pending:{l:"รอยืนยัน",c:C.yellow,bg:C.yellowLight},confirmed:{l:"ยืนยันแล้ว",c:C.green,bg:C.greenLight},cancelled:{l:"ยกเลิก",c:C.red,bg:C.redLight},done:{l:"เสร็จสิ้น",c:C.ink3,bg:C.lineLight}};
  const FILTERS=[{id:"all",l:"ทั้งหมด"},{id:"pending",l:"รอยืนยัน"},{id:"confirmed",l:"ยืนยันแล้ว"},{id:"done",l:"เสร็จสิ้น"},{id:"cancelled",l:"ยกเลิก"}];
  const filtered=resFilter==="all"?reservations:reservations.filter(r=>r.status===resFilter);

  return<div>
    <div style={{display:"flex",gap:8,marginBottom:16,alignItems:"center",flexWrap:"wrap"}}>
      <div style={{display:"flex",gap:4,flexWrap:"wrap",flex:1}}>
        {FILTERS.map(f=><button key={f.id} onClick={()=>setResFilter(f.id)} style={{padding:"6px 12px",borderRadius:8,border:"1px solid "+(resFilter===f.id?C.brand:C.line),background:resFilter===f.id?C.brand:"#fff",color:resFilter===f.id?"#fff":C.ink3,fontSize:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>{f.l}</button>)}
      </div>
      {canEdit&&<Btn icon={I.plus} onClick={()=>{setEditRes(null);setShowResForm(true);}}>เพิ่มการจอง</Btn>}
    </div>

    <div style={{display:"flex",flexDirection:"column",gap:8}}>
      {filtered.map(res=>{
        const cust=customers.find(c=>c.id===res.customer_id);
        const st=STATUS_MAP[res.status]||STATUS_MAP.pending;
        const resDate=new Date(res.reserved_at);
        return<div key={res.id} style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:"12px 16px",display:"flex",alignItems:"flex-start",gap:12}}>
          <div style={{width:44,height:44,borderRadius:10,background:st.bg,border:`1px solid ${st.c}44`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,flexDirection:"column"}}>
            <div style={{fontSize:14,fontWeight:900,color:st.c,lineHeight:1}}>{resDate.getDate()}</div>
            <div style={{fontSize:9,color:st.c,fontWeight:700}}>{resDate.toLocaleString("th-TH",{month:"short"})}</div>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14,color:C.ink}}>{cust?.name||"ลูกค้าทั่วไป"} ({res.party_size} คน)</div>
            <div style={{fontSize:12,color:C.ink3,marginTop:2}}>{resDate.toLocaleString("th-TH",{hour:"2-digit",minute:"2-digit"})} น. {res.table_pref&&`• ที่นั่ง: ${res.table_pref}`}</div>
            {res.special_req&&<div style={{fontSize:11,color:C.ink4,marginTop:2,background:C.yellowLight,borderRadius:6,padding:"2px 8px",display:"inline-block"}}>★ {res.special_req}</div>}
          </div>
          <div style={{display:"flex",gap:4,alignItems:"center",flexWrap:"wrap",justifyContent:"flex-end"}}>
            <span style={{fontSize:11,padding:"3px 9px",borderRadius:20,fontWeight:700,background:st.bg,color:st.c}}>{st.l}</span>
            {canEdit&&res.status==="pending"&&<>
              <button onClick={()=>updateStatus(res,"confirmed")} style={{padding:"5px 10px",border:"1px solid "+C.green,borderRadius:7,background:"#fff",cursor:"pointer",fontSize:11,color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>ยืนยัน</button>
              <button onClick={()=>updateStatus(res,"cancelled")} style={{padding:"5px 10px",border:"1px solid "+C.red,borderRadius:7,background:"#fff",cursor:"pointer",fontSize:11,color:C.red,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>ยกเลิก</button>
            </>}
            {canEdit&&res.status==="confirmed"&&<button onClick={()=>updateStatus(res,"done")} style={{padding:"5px 10px",border:"1px solid "+C.teal,borderRadius:7,background:"#fff",cursor:"pointer",fontSize:11,color:C.teal,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>เสร็จสิ้น</button>}
            {canEdit&&<div style={{display:"flex",gap:4}}>
              <button onClick={()=>{setEditRes(res);setShowResForm(true);}} style={{padding:"5px",border:"1px solid "+C.line,borderRadius:6,background:"#fff",cursor:"pointer"}}><Ic d={I.pencil} s={12} c={C.ink3}/></button>
              <button onClick={()=>delRes(res)} style={{padding:"5px",border:"1px solid #FCA5A5",borderRadius:6,background:"#fff",cursor:"pointer"}}><Ic d={I.trash} s={12} c={C.red}/></button>
            </div>}
          </div>
        </div>;
      })}
      {filtered.length===0&&<div style={{textAlign:"center",padding:40,color:C.ink4}}>ไม่มีการจองในหมวดนี้</div>}
    </div>

    {showResForm&&<Modal title={editRes?"แก้ไขการจอง":"เพิ่มการจองใหม่"} onClose={()=>{setShowResForm(false);setEditRes(null);}}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Field label="ลูกค้า">
          <select value={form.customer_id} onChange={e=>setForm(f=>({...f,customer_id:e.target.value}))} style={{width:"100%",padding:"8px 10px",border:"1px solid "+C.line,borderRadius:8,fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
            <option value="">-- ลูกค้าทั่วไป --</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name} ({c.phone||"ไม่มีเบอร์"})</option>)}
          </select>
        </Field>
        <Field label="วันและเวลาจอง *"><Inp type="datetime-local" value={form.reserved_at} onChange={v=>setForm(f=>({...f,reserved_at:v}))}/></Field>
        <Field label="จำนวนคน"><Inp type="number" value={form.party_size} onChange={v=>setForm(f=>({...f,party_size:v}))} placeholder="2"/></Field>
        <Field label="ที่นั่งที่ต้องการ"><Inp value={form.table_pref} onChange={v=>setForm(f=>({...f,table_pref:v}))} placeholder="เช่น ริมหน้าต่าง, ห้องส่วนตัว"/></Field>
        <Field label="คำขอพิเศษ"><TA value={form.special_req} onChange={v=>setForm(f=>({...f,special_req:v}))} rows={2} placeholder="เค้กวันเกิด, ตกแต่งพิเศษ ฯลฯ"/></Field>
        <Field label="สถานะ">
          <select value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))} style={{width:"100%",padding:"8px 10px",border:"1px solid "+C.line,borderRadius:8,fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
            <option value="pending">รอยืนยัน</option><option value="confirmed">ยืนยันแล้ว</option><option value="done">เสร็จสิ้น</option><option value="cancelled">ยกเลิก</option>
          </select>
        </Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn onClick={()=>{setShowResForm(false);setEditRes(null);}} style={{background:"#fff",color:C.ink3,border:"1px solid "+C.line}}>ยกเลิก</Btn>
          <Btn icon={I.save} onClick={saveRes} disabled={saving}>{saving?"กำลังบันทึก...":"บันทึก"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

// ── CRM Feedback sub-component ──
function CRMFeedback({feedback,customers,showFeedForm,setShowFeedForm,canEdit,currentBranch,reload}){
  const[form,setForm]=useState({customer_id:"",score:"5",comment:"",order_ref:""});
  const[saving,setSaving]=useState(false);

  async function saveFeedback(){
    if(!form.score)return alert("กรุณาให้คะแนน");
    setSaving(true);
    try{
      await api.addCRMFeedback({customer_id:form.customer_id?parseInt(form.customer_id):null,branch_id:currentBranch.id,score:parseInt(form.score),comment:form.comment,order_ref:form.order_ref,created_at:new Date().toISOString()});
      await reload();setShowFeedForm(false);setForm({customer_id:"",score:"5",comment:"",order_ref:""});
    }catch(e){alert("เกิดข้อผิดพลาด: "+e.message);}
    setSaving(false);
  }

  const avgScore=feedback.length?feedback.reduce((s,f)=>s+f.score,0)/feedback.length:0;
  const lowScore=feedback.filter(f=>f.score<=2);
  const scoreGroups=[5,4,3,2,1].map(s=>({score:s,count:feedback.filter(f=>f.score===s).length}));

  return<div>
    {/* Summary cards */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:20}}>
      <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
        <div style={{fontSize:32,fontWeight:900,color:avgScore>=4?C.green:avgScore>=3?C.yellow:C.red}}>{avgScore.toFixed(1)}</div>
        <div style={{fontSize:12,color:C.ink3,fontWeight:600}}>คะแนนเฉลี่ย / 5</div>
      </div>
      <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
        <div style={{fontSize:32,fontWeight:900,color:C.blue}}>{feedback.length}</div>
        <div style={{fontSize:12,color:C.ink3,fontWeight:600}}>รีวิวทั้งหมด</div>
      </div>
      <div style={{background:lowScore.length>0?C.redLight:"#fff",border:"1px solid "+(lowScore.length>0?"#FCA5A5":C.line),borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
        <div style={{fontSize:32,fontWeight:900,color:lowScore.length>0?C.red:C.ink3}}>{lowScore.length}</div>
        <div style={{fontSize:12,color:lowScore.length>0?C.red:C.ink3,fontWeight:600}}>คะแนนต่ำ (≤2) ⚠️</div>
      </div>
    </div>

    {/* Score distribution */}
    <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
        <div style={{fontWeight:700,fontSize:14,color:C.ink}}>การกระจายคะแนน</div>
        {canEdit&&<Btn icon={I.plus} onClick={()=>setShowFeedForm(true)}>บันทึกรีวิว</Btn>}
      </div>
      {scoreGroups.map(({score,count})=><div key={score} style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
        <div style={{width:16,textAlign:"right",fontWeight:700,color:C.ink3,fontSize:13}}>{score}</div>
        <div style={{fontSize:14}}>{"⭐".repeat(score)}</div>
        <div style={{flex:1,height:18,background:C.lineLight,borderRadius:4,overflow:"hidden"}}>
          <div style={{height:"100%",width:feedback.length?(count/feedback.length*100)+"%":"0%",background:score>=4?C.green:score===3?C.yellow:C.red,borderRadius:4,transition:"width .5s"}}/>
        </div>
        <div style={{width:32,textAlign:"right",fontSize:12,color:C.ink3,fontWeight:700}}>{count}</div>
      </div>)}
    </div>

    {/* Low score alert */}
    {lowScore.length>0&&<div style={{background:C.redLight,border:"1px solid #FCA5A5",borderRadius:12,padding:14,marginBottom:16}}>
      <div style={{fontWeight:700,color:C.red,fontSize:13,marginBottom:8}}>⚠️ แจ้งเตือน: ลูกค้าให้คะแนนต่ำ — ต้องติดตาม</div>
      {lowScore.map(f=>{const cust=customers.find(c=>c.id===f.customer_id);return<div key={f.id} style={{background:"#fff",borderRadius:8,padding:"8px 12px",marginBottom:6,display:"flex",gap:10,alignItems:"flex-start"}}>
        <div style={{fontWeight:800,fontSize:18,color:C.red}}>{"⭐".repeat(f.score)}</div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:13,color:C.ink}}>{cust?.name||"ลูกค้าทั่วไป"} <span style={{color:C.ink4,fontWeight:400,fontSize:11}}>— {new Date(f.created_at).toLocaleDateString("th-TH")}</span></div>
          {f.comment&&<div style={{fontSize:12,color:C.ink3,marginTop:2}}>"{f.comment}"</div>}
        </div>
      </div>;})}
    </div>}

    {/* All feedback */}
    <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:16}}>
      <div style={{fontWeight:700,fontSize:14,color:C.ink,marginBottom:12}}>รีวิวทั้งหมด</div>
      <div style={{display:"flex",flexDirection:"column",gap:8}}>
        {feedback.map(f=>{
          const cust=customers.find(c=>c.id===f.customer_id);
          return<div key={f.id} style={{padding:"10px 12px",background:f.score<=2?C.redLight:f.score>=4?C.greenLight:C.yellowLight,borderRadius:8}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:f.comment?6:0}}>
              <div style={{display:"flex",alignItems:"center",gap:8}}>
                <span style={{fontSize:16}}>{"⭐".repeat(f.score)}</span>
                <span style={{fontWeight:700,fontSize:13,color:C.ink}}>{cust?.name||"ลูกค้าทั่วไป"}</span>
              </div>
              <span style={{fontSize:11,color:C.ink4}}>{new Date(f.created_at).toLocaleDateString("th-TH")}</span>
            </div>
            {f.comment&&<div style={{fontSize:12,color:C.ink2,fontStyle:"italic"}}>"{f.comment}"</div>}
          </div>;
        })}
        {feedback.length===0&&<div style={{textAlign:"center",padding:20,color:C.ink4}}>ยังไม่มีรีวิว</div>}
      </div>
    </div>

    {showFeedForm&&<Modal title="บันทึกรีวิวลูกค้า" onClose={()=>setShowFeedForm(false)}>
      <div style={{display:"flex",flexDirection:"column",gap:12}}>
        <Field label="ลูกค้า">
          <select value={form.customer_id} onChange={e=>setForm(f=>({...f,customer_id:e.target.value}))} style={{width:"100%",padding:"8px 10px",border:"1px solid "+C.line,borderRadius:8,fontFamily:"'Sarabun',sans-serif",fontSize:13,outline:"none"}}>
            <option value="">-- ลูกค้าทั่วไป --</option>
            {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="คะแนนความพึงพอใจ *">
          <div style={{display:"flex",gap:6}}>
            {[1,2,3,4,5].map(s=><button key={s} onClick={()=>setForm(f=>({...f,score:String(s)}))} style={{flex:1,padding:"10px 0",borderRadius:8,border:"2px solid "+(+form.score>=s?C.yellow:C.line),background:+form.score>=s?C.yellowLight:"#fff",cursor:"pointer",fontSize:18}}>⭐</button>)}
          </div>
          <div style={{textAlign:"center",fontSize:12,color:C.ink3,marginTop:4}}>{["","แย่มาก","แย่","ปานกลาง","ดี","ดีมาก"][+form.score]}</div>
        </Field>
        <Field label="ความคิดเห็น"><TA value={form.comment} onChange={v=>setForm(f=>({...f,comment:v}))} rows={3} placeholder="ความคิดเห็นของลูกค้า..."/></Field>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn onClick={()=>setShowFeedForm(false)} style={{background:"#fff",color:C.ink3,border:"1px solid "+C.line}}>ยกเลิก</Btn>
          <Btn icon={I.save} onClick={saveFeedback} disabled={saving}>{saving?"กำลังบันทึก...":"บันทึก"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

// ── CRM Analytics sub-component ──
function CRMAnalytics({customers,transactions,feedback,reservations}){
  const now=Date.now();

  const rfm=useMemo(()=>{
    return customers.map(cust=>{
      const myTxns=transactions.filter(t=>t.customer_id===cust.id&&t.amount>0);
      const lastMs=myTxns.length?Math.max(...myTxns.map(t=>new Date(t.created_at).getTime())):0;
      const recency=lastMs?(now-lastMs)/(1000*3600*24):999;
      const frequency=myTxns.length;
      const monetary=myTxns.reduce((s,t)=>s+(t.amount||0),0);
      let rScore=recency<=7?5:recency<=14?4:recency<=30?3:recency<=60?2:1;
      let fScore=frequency>=20?5:frequency>=10?4:frequency>=5?3:frequency>=2?2:frequency>=1?1:0;
      let mScore=monetary>=10000?5:monetary>=5000?4:monetary>=2000?3:monetary>=500?2:monetary>=1?1:0;
      const total=rScore+fScore+mScore;
      let segment=total>=12?"แชมป์":total>=9?"ภักดี":total>=6?"ที่มีศักยภาพ":total>=3?"เสี่ยงหาย":"หลับ";
      return{...cust,recency:Math.round(recency),frequency,monetary,rScore,fScore,mScore,total,segment};
    }).sort((a,b)=>b.total-a.total);
  },[customers,transactions,now]);

  const segmentColors={
    "แชมป์":{c:"#7C3AED",bg:"#F5F3FF"},
    "ภักดี":{c:C.green,bg:C.greenLight},
    "ที่มีศักยภาพ":{c:C.blue,bg:C.blueLight},
    "เสี่ยงหาย":{c:C.yellow,bg:C.yellowLight},
    "หลับ":{c:C.ink3,bg:C.lineLight},
  };
  const segCounts=Object.fromEntries(Object.keys(segmentColors).map(s=>[s,rfm.filter(r=>r.segment===s).length]));

  const totalRevenue=transactions.reduce((s,t)=>s+(t.amount||0),0);
  const totalPoints=customers.reduce((s,c)=>s+(c.points||0),0);
  const avgFeedback=feedback.length?feedback.reduce((s,f)=>s+f.score,0)/feedback.length:0;
  const upcomingRes=reservations.filter(r=>r.status==="confirmed"&&new Date(r.reserved_at)>new Date());

  return<div>
    {/* KPI row */}
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12,marginBottom:20}}>
      {[
        {label:"ลูกค้าทั้งหมด",value:customers.length,unit:"คน",color:C.blue},
        {label:"รายได้จาก CRM",value:"฿"+totalRevenue.toLocaleString(),unit:"",color:C.green},
        {label:"คะแนนสะสมรวม",value:totalPoints.toLocaleString(),unit:"pts",color:C.brand},
        {label:"ความพึงพอใจ",value:avgFeedback.toFixed(1),unit:"/5",color:avgFeedback>=4?C.green:avgFeedback>=3?C.yellow:C.red},
        {label:"จองล่วงหน้า",value:upcomingRes.length,unit:"รายการ",color:C.purple},
      ].map(kpi=><div key={kpi.label} style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:"14px 16px",textAlign:"center"}}>
        <div style={{fontSize:26,fontWeight:900,color:kpi.color}}>{kpi.value}<span style={{fontSize:14,fontWeight:500,color:C.ink4}}>{kpi.unit}</span></div>
        <div style={{fontSize:11,color:C.ink3,fontWeight:600,marginTop:2}}>{kpi.label}</div>
      </div>)}
    </div>

    {/* RFM segments */}
    <div style={{background:"#fff",border:"1px solid "+C.line,borderRadius:12,padding:16,marginBottom:16}}>
      <div style={{fontWeight:700,fontSize:14,color:C.ink,marginBottom:12}}>RFM Segmentation</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:16}}>
        {Object.entries(segCounts).map(([seg,count])=>{
          const{c,bg}=segmentColors[seg];
          return<div key={seg} style={{background:bg,border:`1px solid ${c}44`,borderRadius:10,padding:"10px 16px",textAlign:"center",minWidth:100}}>
            <div style={{fontSize:22,fontWeight:900,color:c}}>{count}</div>
            <div style={{fontSize:11,color:c,fontWeight:700}}>{seg}</div>
          </div>;
        })}
      </div>
      <div style={{fontSize:11,color:C.ink4,marginBottom:12}}>R=ความถี่ล่าสุด F=ความถี่ M=มูลค่า (คะแนน 1-5 แต่ละด้าน รวมสูงสุด 15)</div>
      <div style={{display:"flex",flexDirection:"column",gap:6}}>
        {rfm.slice(0,15).map(r=>{
          const{c,bg}=segmentColors[r.segment]||segmentColors["หลับ"];
          return<div key={r.id} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 12px",background:bg,borderRadius:8,opacity:r.frequency===0?.6:1}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13,color:C.ink}}>{r.name}</div>
              <div style={{fontSize:11,color:C.ink3}}>{r.frequency} ครั้ง • ฿{r.monetary.toLocaleString()} • ล่าสุด {r.recency<999?r.recency+" วันที่แล้ว":"ไม่เคย"}</div>
            </div>
            <div style={{display:"flex",gap:4}}>
              {[{l:"R",v:r.rScore},{l:"F",v:r.fScore},{l:"M",v:r.mScore}].map(({l,v})=><div key={l} style={{width:28,height:28,borderRadius:6,background:`rgba(0,0,0,0.06)`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                <div style={{fontSize:8,color:c,fontWeight:700}}>{l}</div>
                <div style={{fontSize:12,fontWeight:900,color:c,lineHeight:1}}>{v}</div>
              </div>)}
            </div>
            <span style={{fontSize:11,padding:"3px 10px",borderRadius:20,fontWeight:700,background:"rgba(255,255,255,0.7)",color:c}}>{r.segment}</span>
          </div>;
        })}
        {rfm.length===0&&<div style={{textAlign:"center",padding:20,color:C.ink4}}>ยังไม่มีข้อมูลลูกค้า</div>}
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── MAIN APP ──────────────────────────────────────────
// ══════════════════════════════════════════════════════
export default function App(){
  const[currentUser,setCurrentUser]=useState(null);
  const[currentBranch,setCurrentBranch]=useState(null);
  const[ings,setIngs]=useState([]);const[menus,setMenus]=useState([]);
  const[allCats,setAllCats]=useState([]);const[users,setUsers]=useState([]);
  const[branches,setBranches]=useState([]);const[suppliers,setSuppliers]=useState([]);
  const[costHistory,setCostHistory]=useState([]);const[actionHistory,setActionHistory]=useState([]);
  const[orders,setOrders]=useState([]);const[allOrders,setAllOrders]=useState([]);
  const[printers,setPrinters]=useState([]);
  const[loading,setLoading]=useState(false);const[initErr,setInitErr]=useState("");
  const[tab,setTab]=useState("pos");

  const ingCats=useMemo(()=>allCats.filter(c=>c.type==="ingredient"),[allCats]);
  const menuCats=useMemo(()=>allCats.filter(c=>c.type==="menu"),[allCats]);

  async function loadAll(){
    if(!currentBranch)return;
    setLoading(true);setInitErr("");
    try{
      const isCentral=currentBranch.type==="central";
      const[i,m,c,u,b,s,ch,ah,o,pr]=await Promise.all([
        api.getIngs(),
        api.getMenus(),
        api.getCats(),api.getUsers(),api.getBranches(),api.getSuppliers(),
        api.getCostHist(isCentral?null:currentBranch.id),
        api.getActionHist(),
        api.getOrders(isCentral?null:currentBranch.id),
        api.getAllPrinters(),
      ]);
      setIngs(i);setMenus(m);setAllCats(c);setUsers(u);setBranches(b);setSuppliers(s);
      setCostHistory(ch);setActionHistory(ah);setOrders(o);setPrinters(pr);
      if(isCentral){const ao=await api.getAllOrders();setAllOrders(ao);}
    }catch(e){setInitErr("เชื่อมต่อ Supabase ไม่ได้: "+e.message);}
    setLoading(false);
  }

  useEffect(()=>{if(currentBranch)loadAll();},[currentBranch]);

  // Periodic re-check of the logged-in user — admin disabling = auto-logout within ~60s.
  // Refs let the closure read the LATEST currentUser/currentBranch without re-creating the interval on every render.
  const userRef=useRef(currentUser);userRef.current=currentUser;
  const branchRef=useRef(currentBranch);branchRef.current=currentBranch;
  useEffect(()=>{
    if(!currentUser?.id)return;
    const tick=async()=>{
      try{
        const cu=userRef.current;const cb=branchRef.current;
        if(!cu?.id)return;
        const rows=await api.getMyUserStatus(cu.id);
        const u=Array.isArray(rows)?rows[0]:null;
        if(!u||!u.active){alert("บัญชีของคุณถูกปิดการใช้งาน — ระบบจะออกจากระบบ");setCurrentUser(null);setCurrentBranch(null);return;}
        const newPerms=normalizePerms(u.perms);
        const newAllowed=normalizeBranchIds(u.allowed_branches);
        // Live revoke: if admin removed access to current branch, kick to selector
        if(cb&&u.role!=="admin"&&newAllowed&&!newAllowed.includes(+cb.id)){
          alert("สิทธิ์เข้าสาขานี้ถูกถอนแล้ว — กลับไปเลือกสาขาใหม่");
          setCurrentBranch(null);
        }
        // Sync role/perms/allowed_branches if changed (compare normalized forms)
        const oldPerms=normalizePerms(cu.perms);const oldAllowed=normalizeBranchIds(cu.allowed_branches);
        if(u.role!==cu.role||JSON.stringify(newPerms)!==JSON.stringify(oldPerms)||JSON.stringify(newAllowed)!==JSON.stringify(oldAllowed)){
          setCurrentUser(prev=>prev?{...prev,role:u.role,perms:newPerms,name:u.name,allowed_branches:newAllowed}:prev);
        }
        // Refresh branches too — admin may have flipped allowed_perms / active on the current branch
        if(cb){
          try{
            const fresh=await api.getBranches();
            const updated=fresh.find(x=>+x.id===+cb.id);
            if(!updated||updated.active===false){
              if(updated&&updated.active===false){alert(`สาขา "${cb.name}" ถูกปิดการใช้งาน — กลับไปเลือกสาขาใหม่`);setCurrentBranch(null);}
            }else if(JSON.stringify(updated.allowed_perms)!==JSON.stringify(cb.allowed_perms)){
              setCurrentBranch(updated);
              setBranches(fresh);
            }
          }catch{}
        }
      }catch{/* ignore transient network */}
    };
    const id=setInterval(tick,60000);
    return()=>clearInterval(id);
  },[currentUser?.id]);

  const reload={
    ings:async()=>{const d=await api.getIngs();setIngs(d);},
    menus:async()=>{const d=await api.getMenus();setMenus(d);},
    cats:async()=>{const d=await api.getCats();setAllCats(d);},
    users:async()=>{const d=await api.getUsers();setUsers(d);},
    branches:async()=>{const d=await api.getBranches();setBranches(d);},
    suppliers:async()=>{const d=await api.getSuppliers();setSuppliers(d);},
    history:async()=>{const isCentral=currentBranch?.type==="central";const d=await api.getCostHist(isCentral?null:currentBranch?.id);setCostHistory(d);},
    action:async()=>{const d=await api.getActionHist();setActionHistory(d);},
    orders:async()=>{const isCentral=currentBranch?.type==="central";const d=await api.getOrders(isCentral?null:currentBranch?.id);setOrders(d);if(isCentral){const ao=await api.getAllOrders();setAllOrders(ao);}},
    printers:async()=>{const d=await api.getAllPrinters();setPrinters(d);},
  };
  const addH=useCallback(async a=>{try{await api.addActionHist({action:a,time:nowStr()});await reload.action();}catch{}},[currentBranch]);

  const TABS=[
    {id:"pos",l:"ขายหน้าร้าน",icon:I.table,perm:"pos"},
    {id:"crm",l:"CRM ลูกค้า",icon:I.users,perm:"crm"},
    {id:"ingredients",l:"วัตถุดิบ",icon:I.leaf,perm:"ingredients"},
    {id:"menus",l:"เมนู",icon:I.fire,perm:"menus"},
    {id:"sop",l:"SOP",icon:I.sop,perm:"sop"},
    {id:"summary",l:"สรุปต้นทุน",icon:I.chart,perm:"summary"},
    {id:"fssales",l:"ยอดขายรายเมนู\nตามระบบ FOODSTORY",icon:I.chart,perm:"fs_sales"},
    {id:"po",l:"เอกสาร PO",icon:I.bill,perm:"po"},
    {id:"orders",l:"สั่งวัตถุดิบ",icon:I.truck,perm:"orders"},
    {id:"history",l:"ประวัติต้นทุน",icon:I.clock,perm:"history"},
    {id:"suppliers",l:"ซัพพลาย",icon:I.truck,perm:"suppliers"},
    {id:"settings",l:"ตั้งค่า",icon:I.settings,perm:"settings"},
  ];
  // A tab is visible only if the user has the permission. Admin role sees everything.
  // Branch-level perm gating was removed — permissions are now configured per-user only.
  const visibleTabs=TABS.filter(t=>{
    if(!currentUser)return false;
    if(currentUser.role==="admin")return true;
    return hasPerm(currentUser,t.perm);
  });
  // If current tab is no longer visible (after branch switch / perm change / role swap), jump to first visible.
  // Watch the content of visibleTabs (not just length) so a like-for-like perm swap also retargets.
  const visibleTabsHash=visibleTabs.map(t=>t.id).join(",");
  useEffect(()=>{
    if(visibleTabs.length>0&&!visibleTabs.find(t=>t.id===tab))setTab(visibleTabs[0].id);
  },[visibleTabsHash]);
  const DESC={pos:"รับออเดอร์ จัดการโต๊ะ พิมพ์ QR ให้ลูกค้าสแกนสั่งอาหาร",crm:"จัดการลูกค้าประจำ สะสมแต้ม คูปอง จองโต๊ะ และวิเคราะห์ RFM",ingredients:"จัดการวัตถุดิบ ราคา สต็อก และซัพพลาย",menus:"คำนวณต้นทุนและกำไรแต่ละเมนู",sop:"ขั้นตอนมาตรฐานพร้อมรูปภาพ",summary:"สรุปต้นทุนและส่งรายการสั่งวัตถุดิบ",fs_sales:"นำเข้ายอดขายจาก FoodStory เพื่อดูเมนูที่ขายได้แต่ละวัน",po:"เปิด/แก้ไข/ปริ้น เอกสารใบสั่งซื้อวัตถุดิบ (Purchase Order)",orders:currentBranch?.type==="central"?"รับและจัดการรายการสั่งวัตถุดิบจากทุกสาขา":"รายการสั่งวัตถุดิบที่ส่งไปครัวกลาง",history:"ประวัติต้นทุนและการแก้ไข",suppliers:"รายชื่อซัพพลายเออร์และข้อมูลติดต่อ",settings:"ตั้งค่าระบบ สาขา และผู้ใช้"};

  // Check scan mode
  const params=typeof window!=="undefined"?new URLSearchParams(window.location.search):new URLSearchParams();
  const isScan=params.get("scan")==="1";
  const scanBranch=params.get("branch");
  const scanTable=params.get("table");
  const scanToken=params.get("t");
  if(isScan&&scanBranch&&scanTable){return <><style>{globalStyle}</style><CustomerPage branchId={scanBranch} tableId={scanTable} token={scanToken}/></>;}

  if(!currentUser)return <><style>{globalStyle}</style><LoginPage onLogin={u=>{setCurrentUser(u);}}/></>;
  if(!currentBranch)return <><style>{globalStyle}</style><BranchSelectorWithLoad user={currentUser} onSelect={b=>setCurrentBranch(b)} onLogout={()=>setCurrentUser(null)}/></>;

  // Diagnostic: user is logged in to a branch but no tab is visible — explain why instead of showing a blank shell.
  if(visibleTabs.length===0){
    const userPerms=getUserPerms(currentUser);
    return <><style>{globalStyle}</style><div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,#FEF3C7,#FFE4E6)`,padding:24,fontFamily:"'Sarabun',sans-serif"}}>
      <div style={{background:C.white,borderRadius:18,padding:"30px 28px",maxWidth:520,width:"100%",boxShadow:"0 10px 40px rgba(0,0,0,.12)"}}>
        <div style={{textAlign:"center",marginBottom:18}}>
          <div style={{fontSize:64,marginBottom:8}}>🚫</div>
          <h2 style={{fontSize:20,fontWeight:900,color:C.ink,margin:0}}>ไม่มีเมนูที่เข้าถึงได้</h2>
          <p style={{fontSize:13,color:C.ink3,marginTop:4}}>{currentUser.name||currentUser.username} · {currentBranch.name}</p>
        </div>
        <div style={{background:C.bg,borderRadius:12,padding:"14px 16px",marginBottom:14,border:`1px solid ${C.line}`}}>
          <div style={{fontSize:13,color:C.ink2,lineHeight:1.8}}>
            ผู้ใช้ของคุณยังไม่ได้ตั้งสิทธิ์เมนูใดเลย — กรุณาติดต่อแอดมินให้กำหนดสิทธิ์ในหัวข้อ <b>ตั้งค่า → ผู้ใช้</b>
          </div>
        </div>
        <div style={{background:C.brandLight,borderRadius:12,padding:"12px 16px",marginBottom:14,border:`1px solid ${C.brandBorder}`,fontSize:12,color:C.ink2,lineHeight:1.7}}>
          <div style={{fontWeight:800,marginBottom:6,color:C.brand}}>🔧 รายละเอียดสำหรับแอดมิน:</div>
          <div>• สิทธิ์ปัจจุบัน: <b>{userPerms.length>0?userPerms.join(", "):"ไม่มี"}</b></div>
          <div style={{marginTop:6,fontSize:11,color:C.ink3}}>ติ๊กแท็บที่ต้องการให้ผู้ใช้คนนี้เข้าถึงได้ในฟอร์มแก้ไขผู้ใช้</div>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={()=>setCurrentBranch(null)} full>← เลือกสาขาใหม่</Btn>
          <Btn v="danger" onClick={()=>{setCurrentUser(null);setCurrentBranch(null);}} full>ออกจากระบบ</Btn>
        </div>
      </div>
    </div></>;
  }

  const isCentral=currentBranch.type==="central";

  const sidebarW=240;
  const accentColor=isCentral?C.teal:C.brand;
  const accentDark=isCentral?"#0F766E":C.brandDark;

  return <>
    <style>{globalStyle}</style>
    <ConfirmDlg/>
    <div style={{display:"flex",minHeight:"100vh",background:"#F1F5F9"}}>

      {/* ── SIDEBAR ── */}
      <aside style={{width:sidebarW,background:"#0F172A",display:"flex",flexDirection:"column",position:"fixed",top:0,left:0,bottom:0,zIndex:200,overflowY:"auto"}}>

        {/* Logo */}
        <div style={{padding:"22px 18px 16px",borderBottom:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",gap:11}}>
            <div style={{width:38,height:38,background:`linear-gradient(135deg,${accentColor},${accentDark})`,borderRadius:11,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,boxShadow:`0 4px 14px ${accentColor}55`}}>
              <Ic d={isCentral?I.shop:I.fire} s={18} c="#fff" sw={2}/>
            </div>
            <div>
              <div style={{fontWeight:900,fontSize:13,color:"#F8FAFC",letterSpacing:-.2,lineHeight:1.2}}>NAIWANSOOK</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.35)",fontWeight:600,letterSpacing:1.5}}>FOODCOST</div>
            </div>
          </div>
        </div>

        {/* Branch badge */}
        <div style={{padding:"12px 14px 8px"}}>
          <div style={{background:"rgba(255,255,255,0.06)",borderRadius:10,padding:"9px 12px",border:"1px solid rgba(255,255,255,0.08)"}}>
            <div style={{fontSize:9,color:"rgba(255,255,255,0.35)",fontWeight:700,letterSpacing:1.2,textTransform:"uppercase",marginBottom:2}}>สาขาปัจจุบัน</div>
            <div style={{display:"flex",alignItems:"center",gap:6}}>
              <Ic d={isCentral?I.shop:I.branch} s={13} c={accentColor}/>
              <span style={{fontSize:13,fontWeight:800,color:"#F8FAFC",fontFamily:"'Sarabun',sans-serif"}}>{currentBranch.name}</span>
            </div>
          </div>
        </div>

        {/* Nav label */}
        <div style={{padding:"10px 18px 5px"}}>
          <span style={{fontSize:9,fontWeight:700,color:"rgba(255,255,255,0.25)",letterSpacing:1.5,textTransform:"uppercase"}}>เมนูหลัก</span>
        </div>

        {/* Nav items */}
        <nav style={{flex:1,padding:"0 10px 10px"}}>
          {visibleTabs.map(t2=>{
            const active=tab===t2.id;
            return <button key={t2.id} onClick={()=>setTab(t2.id)} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 12px",marginBottom:2,borderRadius:10,border:"none",cursor:"pointer",background:active?`rgba(${isCentral?"20,184,166":"255,107,53"},0.18)`:"transparent",transition:"all .15s",textAlign:"left",fontFamily:"'Sarabun',sans-serif"}}>
              <div style={{width:30,height:30,borderRadius:8,background:active?`rgba(${isCentral?"20,184,166":"255,107,53"},0.25)`:"rgba(255,255,255,0.05)",display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0,transition:"all .15s"}}>
                <Ic d={t2.icon} s={14} c={active?accentColor:"rgba(255,255,255,0.45)"}/>
              </div>
              <span style={{fontSize:13,fontWeight:active?700:400,color:active?"#F8FAFC":"rgba(255,255,255,0.55)",transition:"all .15s",whiteSpace:"pre-line",lineHeight:1.25}}>{t2.l}</span>
              {active&&<div style={{marginLeft:"auto",width:4,height:4,borderRadius:"50%",background:accentColor}}/>}
            </button>;
          })}
        </nav>

        {/* User section */}
        <div style={{padding:"12px 14px 20px",borderTop:"1px solid rgba(255,255,255,0.07)"}}>
          <div style={{display:"flex",alignItems:"center",gap:9,padding:"8px 10px",background:"rgba(255,255,255,0.05)",borderRadius:10,marginBottom:8}}>
            <div style={{width:32,height:32,borderRadius:"50%",background:`linear-gradient(135deg,${accentColor},${accentDark})`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}>
              <Ic d={I.user} s={14} c="#fff"/>
            </div>
            <div style={{minWidth:0}}>
              <div style={{fontSize:12,fontWeight:700,color:"#F8FAFC",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{currentUser.name||currentUser.username}</div>
              <div style={{fontSize:10,color:"rgba(255,255,255,0.4)"}}>{ROLES[currentUser.role]?.label||currentUser.role}</div>
            </div>
          </div>
          <div style={{display:"flex",gap:6}}>
            <button onClick={()=>setCurrentBranch(null)} style={{flex:1,background:"rgba(255,255,255,0.08)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,padding:"7px 0",cursor:"pointer",fontSize:11,color:"rgba(255,255,255,0.6)",fontFamily:"'Sarabun',sans-serif",fontWeight:600,display:"flex",alignItems:"center",justifyContent:"center",gap:4,transition:"background .15s"}}>
              <Ic d={I.branch} s={11} c="rgba(255,255,255,0.5)"/>เปลี่ยนสาขา
            </button>
            <button onClick={()=>{setCurrentUser(null);setCurrentBranch(null);}} title="ออกจากระบบ" style={{background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.25)",borderRadius:8,padding:"7px 10px",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"background .15s"}}>
              <Ic d={I.logout} s={13} c="#F87171"/>
            </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main style={{marginLeft:sidebarW,flex:1,minWidth:0,display:"flex",flexDirection:"column"}}>

        {/* Top bar */}
        <div style={{background:"#fff",borderBottom:"1px solid #E2E8F0",padding:"0 28px",height:58,display:"flex",alignItems:"center",justifyContent:"space-between",position:"sticky",top:0,zIndex:100,boxShadow:"0 1px 3px rgba(15,23,42,0.05)"}}>
          <div>
            <h1 style={{fontSize:18,fontWeight:800,color:"#0F172A",margin:0,letterSpacing:-.3}}>{visibleTabs.find(t2=>t2.id===tab)?.l}</h1>
            <p style={{fontSize:12,color:"#94A3B8",margin:0}}>{DESC[tab]}</p>
          </div>
          <div style={{display:"flex",alignItems:"center",gap:6}}>
            <div style={{background:`linear-gradient(135deg,${accentColor}18,${accentColor}0a)`,border:`1px solid ${accentColor}30`,borderRadius:8,padding:"5px 12px",display:"flex",alignItems:"center",gap:5}}>
              <div style={{width:7,height:7,borderRadius:"50%",background:accentColor}}/>
              <span style={{fontSize:11,fontWeight:700,color:accentColor,fontFamily:"'Sarabun',sans-serif"}}>BY BOSSMAX</span>
            </div>
          </div>
        </div>

        {/* Page content */}
        <div style={{flex:1,padding:"24px 28px 56px"}}>
          {initErr&&<ErrBox msg={initErr} onRetry={loadAll}/>}
          {loading?<Loading text="กำลังโหลดข้อมูลจาก Cloud..."/>:<>
            {tab==="crm"&&<CRMTab currentBranch={currentBranch} currentUser={currentUser} menus={menus}/>}
            {tab==="ingredients"&&<IngTab ings={ings} reload={reload.ings} ingCats={ingCats} suppliers={suppliers} currentUser={currentUser} currentBranch={currentBranch} addH={addH} branches={branches} reloadCats={reload.cats}/>}
            {tab==="menus"&&<MenuTab menus={menus} reload={reload.menus} ings={ings} menuCats={menuCats} currentUser={currentUser} currentBranch={currentBranch} addH={addH} printers={printers} branches={branches} allCats={allCats} reloadCats={reload.cats}/>}
            {tab==="sop"&&<SOPTab menus={menus} reload={reload.menus} ings={ings} currentUser={currentUser} currentBranch={currentBranch}/>}
            {tab==="summary"&&<SumTab menus={menus} ings={ings} currentBranch={currentBranch} reloadHistory={reload.history} reloadOrders={reload.orders} currentUser={currentUser} branches={branches} suppliers={suppliers}/>}
            {tab==="fssales"&&<FSSalesTab branches={branches} currentBranch={currentBranch} currentUser={currentUser} menus={menus} ings={ings} reloadMenus={reload.menus} reloadCats={reload.cats}/>}
            {tab==="po"&&<POSection branches={branches} ings={ings} currentBranch={currentBranch} currentUser={currentUser}/>}
            {tab==="orders"&&<OrderTab orders={orders} allOrders={allOrders} reload={reload.orders} ings={ings} suppliers={suppliers} currentBranch={currentBranch} currentUser={currentUser}/>}
            {tab==="history"&&<HisTab costHistory={costHistory} actionHistory={actionHistory} reloadHistory={reload.history} reloadAction={reload.action} ings={ings} currentBranch={currentBranch} reloadOrders={reload.orders} currentUser={currentUser}/>}
            {tab==="suppliers"&&<SupplierTab suppliers={suppliers} reloadSuppliers={reload.suppliers} currentUser={currentUser}/>}
            {tab==="pos"&&<POSTab menus={menus} reloadMenus={reload.menus} currentBranch={currentBranch} currentUser={currentUser} printers={printers} branches={branches} reloadPrinters={reload.printers}/>}
            {tab==="settings"&&<SettingsTab ingCats={ingCats} menuCats={menuCats} reloadCats={reload.cats} users={users} reloadUsers={reload.users} branches={branches} reloadBranches={reload.branches} suppliers={suppliers} reloadSuppliers={reload.suppliers} currentUser={currentUser} printers={printers} reloadPrinters={reload.printers} currentBranch={currentBranch}/>}
          </>}
        </div>
      </main>

    </div>
  </>;
}

// ══════════════════════════════════════════════════════
// ── PRINT HELPERS ─────────────────────────────────────
// ══════════════════════════════════════════════════════
const PAY_LABEL={cash:"💵 เงินสด",promptpay:"📲 พร้อมเพย์",transfer:"🏦 โอนธนาคาร",credit:"💳 บัตรเครดิต",debit:"💳 บัตรเดบิต",truemoney:"🟠 TrueMoney",shopeepay:"🛒 ShopeePay",linepay:"💚 LINE Pay",rabbit:"🐰 Rabbit LINE Pay",paotang:"💰 เป๋าตัง",alipay:"🅰️ Alipay",wechatpay:"💬 WeChat Pay",grabpay:"🟢 GrabPay",airpay:"✈️ AirPay",qr:"📱 QR Code",voucher:"🎫 คูปอง",other:"➕ อื่นๆ",split:"✂️ บิลแยก (ตัวอย่าง)"};
function printReceipt(order, tableNum, branchName, posSettings=null){
  const w=openPrintWindow(400,700);
  if(!w)return;
  const rows=(order.items||[]).map(i=>{const lineTotal=i.price*i.qty;const disc=i.item_discount||0;return `<tr><td style="padding:2px 4px;font-size:13px">${esc(i.name)}${i.note?`<br/><span style="font-size:11px;color:#666">★${esc(i.note)}</span>`:""}${disc>0?`<br/><span style="font-size:10px;color:#dc2626">ลด ${i.item_discount_type==="percent"?esc(i.item_discount_value)+"%":"฿"+esc(i.item_discount_value)}</span>`:""}</td><td style="padding:2px 4px;text-align:center;font-size:13px">${i.qty}</td><td style="padding:2px 4px;text-align:right;font-size:13px">${disc>0?`<s style="color:#999;font-size:11px">฿${lineTotal.toFixed(0)}</s><br/>฿${(lineTotal-disc).toFixed(0)}`:`฿${lineTotal.toFixed(0)}`}</td></tr>`;}).join("");
  const payLabel=PAY_LABEL[order.payment_method]||esc(order.payment_method||"-");
  const cashLine=order.payment_method==="cash"&&order.cash_received?`<div style="display:flex;justify-content:space-between;font-size:12px"><span>รับเงิน</span><span>฿${(+order.cash_received).toFixed(2)}</span></div><div style="display:flex;justify-content:space-between;font-size:12px"><span>เงินทอน</span><span>฿${Math.max(0,(+order.cash_received)-(order.total||0)).toFixed(2)}</span></div>`:"";
  const promoLine=order.promo_amount>0?`<div style="display:flex;justify-content:space-between;color:#7C3AED;font-size:12px"><span>🎁 ${esc(order.promo_name||"โปรโมชั่น")}</span><span>-฿${(+order.promo_amount).toFixed(2)}</span></div>`:"";
  const scLine=order.service_charge>0?`<div style="display:flex;justify-content:space-between;font-size:12px"><span>Service Charge</span><span>+฿${(+order.service_charge).toFixed(2)}</span></div>`:"";
  const vatLine=order.vat>0?`<div style="display:flex;justify-content:space-between;font-size:12px"><span>VAT ${esc(order.vat_rate||7)}%${order.vat_included?" (รวมในราคา)":""}</span><span>${order.vat_included?"":"+"}฿${(+order.vat).toFixed(2)}</span></div>`:"";
  // PromptPay QR (lazy load via google chart API)
  let qrBlock="";
  if(posSettings&&posSettings.show_qr_promptpay&&posSettings.promptpay_id&&order.payment_method!=="cash"){
    const payload=genPromptPayPayload(posSettings.promptpay_id,order.total||0);
    if(payload){
      const qrSrc=`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(payload)}`;
      qrBlock=`<div class="line"></div><div style="text-align:center"><div style="font-size:13px;font-weight:700;margin-bottom:4px">📱 สแกนพร้อมเพย์เพื่อชำระ</div><img src="${qrSrc}" style="width:160px;height:160px;margin:4px 0"/><div style="font-size:11px;color:#555">${esc(posSettings.promptpay_name||"")}</div><div style="font-size:10px;color:#888">${esc(posSettings.promptpay_id)}</div></div>`;
    }
  }
  const headerExtra=posSettings?.receipt_header?`<div style="text-align:center;font-size:11px;color:#444;white-space:pre-line;margin:4px 0">${esc(posSettings.receipt_header)}</div>`:"";
  const footerExtra=posSettings?.receipt_footer?`<div style="text-align:center;font-size:11px;color:#444;white-space:pre-line;margin-top:6px">${esc(posSettings.receipt_footer)}</div>`:"";
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Receipt</title><style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;900&display=swap');body{font-family:'Sarabun',sans-serif;width:72mm;margin:0 auto;padding:8px;font-size:13px}h2{text-align:center;font-size:16px;margin:4px 0}.line{border-top:1px dashed #000;margin:6px 0}table{width:100%;border-collapse:collapse}.tbl-num{text-align:center;font-size:22px;font-weight:900;margin:4px 0}@media print{@page{margin:0;size:72mm auto}}</style></head><body><h2>${esc(branchName)}</h2>${headerExtra}<div class="tbl-num">โต๊ะ ${esc(tableNum)}</div><div style="text-align:center;font-size:11px;color:#555">${new Date().toLocaleString("th-TH",{calendar:"gregory"})}</div><div class="line"></div><table><thead><tr><th style="text-align:left;font-size:11px">รายการ</th><th style="text-align:center;font-size:11px">จำนวน</th><th style="text-align:right;font-size:11px">ราคา</th></tr></thead><tbody>${rows}</tbody></table><div class="line"></div><div style="display:flex;justify-content:space-between"><span>ยอดรวม</span><span>฿${(+(order.subtotal||0)).toFixed(2)}</span></div>${order.discount>0?`<div style="display:flex;justify-content:space-between;color:#dc2626;font-size:12px"><span>ส่วนลดรวม</span><span>-฿${(+order.discount).toFixed(2)}</span></div>`:""}${promoLine}${scLine}${vatLine}<div style="display:flex;justify-content:space-between;font-weight:900;font-size:18px;margin-top:6px;padding-top:6px;border-top:2px solid #000"><span>รวมทั้งสิ้น</span><span>฿${(+(order.total||0)).toFixed(2)}</span></div>${cashLine}<div class="line"></div><div style="text-align:center;font-size:13px;font-weight:700">ชำระโดย: ${payLabel}</div>${qrBlock}<div style="text-align:center;font-size:11px;margin-top:8px">ขอบคุณที่ใช้บริการครับ 🙏</div>${footerExtra}<br/><script>window.onload=()=>window.print();<\/script></body></html>`);
  w.document.close();
}
// ── Bluetooth ESC-POS helpers ────────────────────────────
function getPConn(p){try{const d=JSON.parse(p.description||"{}");if(d.c==="bt")return{type:"bluetooth",btName:d.n||""};}catch{}return{type:"ip"};}
function buildKitchenESC(item,tableNum){
  const enc=new TextEncoder();const bufs=[];
  const b=(...bytes)=>bufs.push(new Uint8Array(bytes));
  const t=str=>bufs.push(enc.encode(str));
  b(0x1b,0x40);b(0x1b,0x61,0x01);
  b(0x1d,0x21,0x00);t("ใบสั่งอาหาร\n");
  b(0x1d,0x21,0x33);t(`โต๊ะ ${tableNum}\n`);
  b(0x1d,0x21,0x00);t(new Date().toLocaleString("th-TH")+"\n");
  t("================================\n");
  b(0x1d,0x21,0x11);b(0x1b,0x45,0x01);t(`${item.qty}x ${item.name}\n`);b(0x1b,0x45,0x00);
  b(0x1d,0x21,0x00);
  if(item.note){t("\n");b(0x1b,0x45,0x01);t(`★ ${item.note}\n`);b(0x1b,0x45,0x00);}
  t("================================\n");b(0x1b,0x64,0x05);b(0x1d,0x56,0x41,0x00);
  let len=0;bufs.forEach(u=>len+=u.length);const out=new Uint8Array(len);let off=0;
  bufs.forEach(u=>{out.set(u,off);off+=u.length;});return out;
}
const _BT_SVC=["000018f0-0000-1000-8000-00805f9b34fb","49535343-fe7d-4ae5-8fa9-9fafd205e455","e7810a71-73ae-499d-8c15-faa9aef0c3f2","0000ff00-0000-1000-8000-00805f9b34fb"];
const _BT_CHR=["00002af1-0000-1000-8000-00805f9b34fb","49535343-8841-881f-4a2d-13b6b6c9d39a","bef8d6c9-9c21-4c9e-b632-bd58c1009f9f","0000ff02-0000-1000-8000-00805f9b34fb"];
async function btPrint(escData,btName){
  if(!navigator.bluetooth)throw new Error("ต้องใช้ Chrome หรือ Edge บน Desktop/Android");
  const device=await navigator.bluetooth.requestDevice({filters:btName?[{name:btName}]:undefined,acceptAllDevices:!btName,optionalServices:_BT_SVC});
  const server=await device.gatt.connect();
  let char=null;
  outer:for(const su of _BT_SVC){try{const svc=await server.getPrimaryService(su);for(const cu of _BT_CHR){try{char=await svc.getCharacteristic(cu);break outer;}catch{}}try{const all=await svc.getCharacteristics();for(const c of all){if(c.properties.write||c.properties.writeWithoutResponse){char=c;break outer;}}}catch{}}catch{}}
  if(!char)throw new Error("ไม่พบ characteristic สำหรับส่งข้อมูลพิมพ์");
  for(let i=0;i<escData.length;i+=512){const s=escData.slice(i,i+512);try{if(char.properties.writeWithoutResponse)await char.writeValueWithoutResponse(s);else await char.writeValue(s);}catch{await char.writeValue(s);}await new Promise(r=>setTimeout(r,50));}
  try{device.gatt.disconnect();}catch{}return device.name;
}
// ─────────────────────────────────────────────────────────

function printKitchenWindow(item,tableNum,printer){
  const title=printer?printer.name:"ใบสั่งอาหาร";
  const w=openPrintWindow(350,500);
  if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${title} - โต๊ะ ${tableNum}</title><style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;900&display=swap');body{font-family:'Sarabun',sans-serif;width:72mm;margin:0 auto;padding:6px;color:#000}.hdr{text-align:center;font-size:13px;font-weight:700;margin:2px 0}.tbl{text-align:center;font-size:54px;font-weight:900;line-height:1;margin:6px 0;letter-spacing:1px;border:3px solid #000;padding:8px 0;border-radius:8px}.tm{text-align:center;font-size:11px;color:#444;margin:2px 0}.sep{border:0;border-top:2px dashed #000;margin:8px 0}.menu{text-align:center;font-size:24px;font-weight:900;line-height:1.2;margin:8px 0;padding:6px 4px}.qty{display:inline-block;background:#000;color:#fff;padding:2px 12px;border-radius:6px;font-size:24px;font-weight:900;margin-right:6px}.note{margin-top:8px;background:#FEF3C7;border:2px solid #000;border-radius:6px;padding:8px;font-size:15px;font-weight:700;text-align:center}.foot{text-align:center;font-size:10px;color:#666;margin-top:6px}@media print{@page{margin:0;size:72mm auto}}</style></head><body><div class="hdr">🍳 ${title}</div><div class="tbl">โต๊ะ ${tableNum}</div><div class="tm">${new Date().toLocaleString("th-TH")}</div><hr class="sep"/><div class="menu"><span class="qty">${item.qty}x</span>${item.name}</div>${item.note?`<div class="note">★ ${item.note}</div>`:""}<hr class="sep"/><div class="foot">--- สิ้นสุดรายการ ---</div><script>window.onload=()=>setTimeout(()=>window.print(),200);<\/script></body></html>`);
  w.document.close();
}
// Resolve which printer should handle this kitchen item.
// Priority: 1) menu-level override (item.printer_id) → 2) category-routed printer →
//           3) catch-all printer (categories === null) → 4) any printer (fallback)
function resolvePrinter(item,printers){
  if(!printers||printers.length===0)return null;
  if(item.printer_id){const p=printers.find(x=>x.id===+item.printer_id);if(p)return p;}
  const cat=item.category;
  if(cat){
    const byCat=printers.find(p=>Array.isArray(p.categories)&&p.categories.includes(cat));
    if(byCat)return byCat;
  }
  // catch-all: categories is null/undefined (NOT [] which means opt-out)
  const catchAll=printers.find(p=>p.categories===null||p.categories===undefined);
  if(catchAll)return catchAll;
  return null;
}
async function printKitchen(items,tableNum,printers=[]){
  // Group items by resolved printer so each printer prints one batch
  const groups=new Map();  // printer.id (or "_window") → {printer, items[]}
  for(const item of items){
    const printer=resolvePrinter(item,printers);
    const key=printer?printer.id:"_window";
    if(!groups.has(key))groups.set(key,{printer,items:[]});
    groups.get(key).items.push(item);
  }
  for(const{printer,items:gItems} of groups.values()){
    const conn=printer?getPConn(printer):{type:"ip"};
    for(const item of gItems){
      if(conn.type==="bluetooth"){
        try{await btPrint(buildKitchenESC(item,tableNum),conn.btName);}
        catch(e){alert("Bluetooth พิมพ์ไม่สำเร็จ: "+e.message+"\nใช้การพิมพ์ปกติแทน");printKitchenWindow(item,tableNum,printer);}
      }else{
        printKitchenWindow(item,tableNum,printer);
      }
      await new Promise(r=>setTimeout(r,300));
    }
  }
}

// ══════════════════════════════════════════════════════
// ── TABLE STATUS COLORS ───────────────────────────────
// ══════════════════════════════════════════════════════
const TS={
  available:{bg:C.greenLight,border:C.green,text:C.green,label:"ว่าง"},
  occupied: {bg:"#FFF7ED",border:C.brand,text:C.brand,label:"มีลูกค้า"},
  ordering: {bg:C.yellowLight,border:C.yellow,text:"#92400E",label:"กำลังสั่ง"},
  bill:     {bg:C.redLight,border:C.red,text:C.red,label:"เรียกบิล"},
  cleaning: {bg:C.lineLight,border:C.line,text:C.ink3,label:"ทำความสะอาด"},
};

// ══════════════════════════════════════════════════════
// ── POS TABLE MAP ─────────────────────────────────────
// ══════════════════════════════════════════════════════
// Compute table dimensions based on seat count and shape
function tableDims(t){
  const seats=+t.seats||4;
  if(t.w&&t.h)return{w:t.w,h:t.h};
  // auto-scale: 2 seats=70x60, 4 seats=90x80, 6 seats=110x90, 8+ seats=130x100
  if(seats<=2)return{w:70,h:60};
  if(seats<=4)return{w:90,h:80};
  if(seats<=6)return{w:110,h:90};
  return{w:130,h:100};
}
function POSTableMap({tables,activeOrders,zones=[],onSelectTable,onEditLayout}){
  const[editMode,setEditMode]=useState(false);
  const[localTables,setLocalTables]=useState(tables);
  const[dragging,setDragging]=useState(null);
  const[saving,setSaving]=useState(false);
  const[zoneFilter,setZoneFilter]=useState("all");  // "all" | zone name | "none"
  const canvasRef=useRef();
  useEffect(()=>setLocalTables(tables),[tables]);

  const zoneColorMap=useMemo(()=>{const m={};zones.forEach(z=>{m[z.name]=z.color||C.brand;});return m;},[zones]);
  function getTableOrder(tid){return activeOrders.find(o=>o.table_id===tid);}
  function getStatus(t){
    const o=getTableOrder(t.id);
    if(!o)return "available";
    if(o.status==="bill_requested")return "bill";
    return "occupied";
  }
  function onMD(e,t){
    if(!editMode)return;
    const rect=canvasRef.current.getBoundingClientRect();
    setDragging({id:t.id,ox:e.clientX-rect.left-(t.x||20),oy:e.clientY-rect.top-(t.y||20)});
    e.preventDefault();
  }
  function onMM(e){
    if(!dragging)return;
    const rect=canvasRef.current.getBoundingClientRect();
    const nx=Math.max(0,Math.round((e.clientX-rect.left-dragging.ox)/10)*10);
    const ny=Math.max(0,Math.round((e.clientY-rect.top-dragging.oy)/10)*10);
    setLocalTables(ts=>ts.map(t=>t.id===dragging.id?{...t,x:nx,y:ny}:t));
  }
  async function saveLayout(){
    setSaving(true);
    try{for(const t of localTables)await api.updatePOSTable(t.id,{x:t.x,y:t.y});}catch{}
    setSaving(false);setEditMode(false);onEditLayout();
  }

  // Zone filter
  const allZoneNames=[...new Set(tables.map(t=>t.zone).filter(Boolean))];
  const filteredTables=zoneFilter==="all"?localTables:zoneFilter==="none"?localTables.filter(t=>!t.zone):localTables.filter(t=>t.zone===zoneFilter);

  return <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
    {/* Zone filter row */}
    {allZoneNames.length>0&&<div style={{padding:"8px 16px",background:C.white,borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:6,overflowX:"auto",flexShrink:0}}>
      <span style={{fontSize:11,fontWeight:700,color:C.ink4,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>โซน:</span>
      <button onClick={()=>setZoneFilter("all")} style={{padding:"4px 12px",borderRadius:18,border:zoneFilter==="all"?`2px solid ${C.brand}`:`1px solid ${C.line}`,background:zoneFilter==="all"?C.brandLight:C.white,color:zoneFilter==="all"?C.brand:C.ink2,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>ทั้งหมด ({tables.length})</button>
      {allZoneNames.map(zn=>{const c=zoneColorMap[zn]||C.ink3;const n=tables.filter(t=>t.zone===zn).length;const active=zoneFilter===zn;return <button key={zn} onClick={()=>setZoneFilter(zn)} style={{padding:"4px 12px",borderRadius:18,border:active?`2px solid ${c}`:`1px solid ${C.line}`,background:active?`${c}22`:C.white,color:active?c:C.ink2,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap"}}><span style={{width:8,height:8,borderRadius:"50%",background:c}}/>{zn} ({n})</button>;})}
      {tables.some(t=>!t.zone)&&<button onClick={()=>setZoneFilter("none")} style={{padding:"4px 12px",borderRadius:18,border:zoneFilter==="none"?`2px solid ${C.ink3}`:`1px solid ${C.line}`,background:zoneFilter==="none"?C.lineLight:C.white,color:C.ink2,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,whiteSpace:"nowrap"}}>ไม่มีโซน ({tables.filter(t=>!t.zone).length})</button>}
    </div>}
    {/* Status legend + edit layout */}
    <div style={{padding:"10px 16px",background:C.white,borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:10,flexWrap:"wrap",flexShrink:0}}>
      {Object.entries(TS).map(([k,v])=>{const n=tables.filter(t=>getStatus(t)===k).length;return n>0?<div key={k} style={{display:"flex",alignItems:"center",gap:5,background:v.bg,border:`1px solid ${v.border}`,borderRadius:8,padding:"3px 10px"}}><div style={{width:8,height:8,borderRadius:"50%",background:v.border}}/><span style={{fontSize:11,fontWeight:700,color:v.text,fontFamily:"'Sarabun',sans-serif"}}>{v.label} ({n})</span></div>:null;})}
      <div style={{marginLeft:"auto",display:"flex",gap:8}}>
        {editMode?<><Btn v="ghost" onClick={()=>{setLocalTables(tables);setEditMode(false);}} s={{padding:"6px 12px",fontSize:12}}>ยกเลิก</Btn><Btn v="success" onClick={saveLayout} loading={saving} s={{padding:"6px 12px",fontSize:12}}>💾 บันทึก Layout</Btn></>
        :<Btn v="ghost" onClick={()=>setEditMode(true)} icon={I.drag} s={{padding:"6px 12px",fontSize:12}}>จัด Layout</Btn>}
      </div>
    </div>
    <div ref={canvasRef} onMouseMove={onMM} onMouseUp={()=>setDragging(null)} onMouseLeave={()=>setDragging(null)}
      style={{flex:1,position:"relative",overflow:"auto",background:"#f0f4f8",backgroundImage:"radial-gradient(circle,#c8d0da 1px,transparent 1px)",backgroundSize:"20px 20px",minHeight:400,cursor:editMode?"crosshair":"default"}}>
      {filteredTables.map(t=>{
        const st=getStatus(t);const sv=TS[st]||TS.available;
        const o=getTableOrder(t.id);
        const itemCount=(o?.items||[]).reduce((s,i)=>s+i.qty,0);
        const dims=tableDims(t);
        const zoneColor=t.zone?zoneColorMap[t.zone]:null;
        const borderColor=zoneColor||sv.border;
        return <div key={t.id} onMouseDown={e=>onMD(e,t)} onClick={()=>!editMode&&onSelectTable(t,o)}
          style={{position:"absolute",left:t.x||20,top:t.y||20,width:dims.w,height:dims.h,background:sv.bg,border:`2.5px solid ${borderColor}`,borderRadius:t.shape==="round"?"50%":12,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",cursor:editMode?"grab":"pointer",userSelect:"none",boxShadow:st!=="available"?`0 4px 16px ${sv.border}44`:"0 2px 8px rgba(0,0,0,.08)",transition:"box-shadow .2s",zIndex:dragging?.id===t.id?10:1}}>
          {zoneColor&&<div style={{position:"absolute",top:-3,right:-3,width:10,height:10,borderRadius:"50%",background:zoneColor,border:`2px solid ${C.white}`,boxShadow:`0 1px 3px ${zoneColor}88`}}/>}
          <div style={{fontWeight:900,fontSize:16,color:sv.text,fontFamily:"'Sarabun',sans-serif",lineHeight:1}}>T{t.table_number}</div>
          {t.label&&<div style={{fontSize:9,color:sv.text,fontFamily:"'Sarabun',sans-serif",opacity:.8,marginTop:1}}>{t.label}</div>}
          {st==="available"?<div style={{fontSize:10,color:C.green,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>{t.seats||4} ที่นั่ง</div>
          :<><div style={{fontSize:11,fontWeight:700,color:sv.text,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>{itemCount} รายการ</div><div style={{fontSize:11,color:sv.text,fontFamily:"'Sarabun',sans-serif"}}>฿{(o?.total||0).toFixed(0)}</div></>}
        </div>;
      })}
      {filteredTables.length===0&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10}}>
        <Ic d={I.table} s={56} c={C.line}/><p style={{color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontSize:15}}>{zoneFilter==="all"?"ยังไม่มีโต๊ะ — เพิ่มโต๊ะในหลังบ้าน":`ไม่มีโต๊ะใน "${zoneFilter==="none"?"ไม่มีโซน":zoneFilter}"`}</p>
      </div>}
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS ZONE MANAGER ─────────────────────────────────
// ══════════════════════════════════════════════════════
const ZONE_COLORS=["#FF6B35","#10B981","#3B82F6","#8B5CF6","#F59E0B","#EF4444","#0D9488","#EC4899","#64748B","#6366F1"];
function POSZoneManager({zones,tables,branch,reloadZones,reloadTables}){
  const[name,setName]=useState("");const[color,setColor]=useState(ZONE_COLORS[0]);
  const[saving,setSaving]=useState(false);const[editId,setEditId]=useState(null);
  const dbZoneNames=zones.map(z=>z.name);
  const legacyZones=[...new Set(tables.map(t=>t.zone).filter(Boolean).filter(z=>!dbZoneNames.includes(z)))];
  const noZone=tables.filter(t=>!t.zone);
  async function save(){
    if(!name.trim())return;
    if(!editId&&zones.find(z=>z.name===name.trim())){alert("ชื่อโซนนี้มีอยู่แล้ว");return;}
    setSaving(true);
    try{
      const sortMax=zones.reduce((m,z)=>Math.max(m,z.sort_order||0),0);
      if(editId){
        const oldName=zones.find(z=>z.id===editId)?.name;
        await api.updateZone(editId,{name:name.trim(),color});
        if(oldName&&oldName!==name.trim()){
          // sync tables.zone field
          for(const t of tables.filter(t=>t.zone===oldName))await api.updatePOSTable(t.id,{zone:name.trim()});
          await reloadTables();
        }
      }else{
        await api.addZone({branch_id:branch.id,name:name.trim(),color,sort_order:sortMax+1});
      }
      await reloadZones();
      setName("");setColor(ZONE_COLORS[0]);setEditId(null);
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }
  async function adoptLegacy(zoneName){
    setSaving(true);
    try{
      const sortMax=zones.reduce((m,z)=>Math.max(m,z.sort_order||0),0);
      await api.addZone({branch_id:branch.id,name:zoneName,color:ZONE_COLORS[zones.length%ZONE_COLORS.length],sort_order:sortMax+1});
      await reloadZones();
    }catch(e){alert("เพิ่มไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }
  async function del(z){
    const count=tables.filter(t=>t.zone===z.name).length;
    if(!await confirmDlg({title:"ลบโซน",message:`ต้องการลบโซน "${z.name}"?\n${count>0?`(โต๊ะ ${count} ตัวจะถูกย้ายไป "ไม่มีโซน")`:''}`,danger:true}))return;
    try{
      if(count>0){for(const t of tables.filter(t=>t.zone===z.name))await api.updatePOSTable(t.id,{zone:""});}
      await api.deleteZone(z.id);
      await reloadZones();await reloadTables();
    }catch(e){alert("ลบไม่สำเร็จ: "+e.message);}
  }
  function startEdit(z){setEditId(z.id);setName(z.name);setColor(z.color||ZONE_COLORS[0]);}
  return <div>
    <div style={{background:C.bg,borderRadius:12,padding:"14px 16px",marginBottom:14,border:`1px solid ${C.line}`}}>
      <div style={{fontSize:13,fontWeight:700,color:C.ink2,marginBottom:10,fontFamily:"'Sarabun',sans-serif"}}>{editId?"แก้ไขโซน":"เพิ่มโซนใหม่"}</div>
      <div style={{display:"grid",gridTemplateColumns:"2fr 3fr auto",gap:8,alignItems:"end"}}>
        <div>
          <div style={{fontSize:11,color:C.ink4,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ชื่อโซน</div>
          <input value={name} onChange={e=>setName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&save()} placeholder="เช่น Zone A, ชั้น 1, ริมสระ, VIP" style={{...iS,fontSize:13}}/>
        </div>
        <div>
          <div style={{fontSize:11,color:C.ink4,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>สีประจำโซน</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
            {ZONE_COLORS.map(c=><button key={c} onClick={()=>setColor(c)} style={{width:28,height:28,borderRadius:8,border:`3px solid ${color===c?C.ink:C.white}`,background:c,cursor:"pointer",boxShadow:`0 2px 6px ${c}66`}}/>)}
          </div>
        </div>
        <div style={{display:"flex",gap:6}}>
          {editId&&<Btn v="ghost" onClick={()=>{setEditId(null);setName("");setColor(ZONE_COLORS[0]);}} s={{padding:"9px 12px"}}>ยกเลิก</Btn>}
          <Btn onClick={save} icon={I.check} disabled={!name.trim()} loading={saving} s={{padding:"9px 16px"}}>{editId?"บันทึก":"เพิ่มโซน"}</Btn>
        </div>
      </div>
    </div>
    {zones.length===0&&legacyZones.length===0&&<div style={{textAlign:"center",padding:"40px 0",color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>
      <Ic d={I.tag} s={42} c={C.line}/><div style={{marginTop:10,fontSize:13}}>ยังไม่มีโซน — เพิ่มโซนด้านบนครับ</div>
    </div>}
    {zones.length>0&&<div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:legacyZones.length>0?14:0}}>
      {zones.map(z=>{const count=tables.filter(t=>t.zone===z.name).length;return <div key={z.id} style={{background:C.white,borderRadius:10,padding:"10px 14px",border:`1px solid ${C.line}`,borderLeft:`4px solid ${z.color||C.brand}`,display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:14,height:14,borderRadius:"50%",background:z.color||C.brand,flexShrink:0}}/>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{z.name}</div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{count} โต๊ะ {count>0&&` · ${tables.filter(t=>t.zone===z.name).map(t=>t.table_number).join(", ")}`}</div>
        </div>
        <button onClick={()=>startEdit(z)} title="แก้ไข" style={{background:C.blueLight,border:"none",borderRadius:7,padding:"5px 7px",cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={13} c={C.blue}/></button>
        <button onClick={()=>del(z)} title="ลบ" style={{background:C.redLight,border:"none",borderRadius:7,padding:"5px 7px",cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>
      </div>;})}
    </div>}
    {legacyZones.length>0&&<div style={{background:C.yellowLight,borderRadius:10,padding:"10px 14px",border:`1px solid #FDE68A`,marginBottom:14}}>
      <div style={{fontSize:12,fontWeight:700,color:"#92400E",fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>⚠️ โซนเก่าที่ยังไม่ได้ตั้งสี — กดเพื่อ adopt</div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        {legacyZones.map(z=>{const count=tables.filter(t=>t.zone===z).length;return <button key={z} onClick={()=>adoptLegacy(z)} style={{background:C.white,border:`1px solid #FDE68A`,borderRadius:8,padding:"5px 12px",cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:700,color:"#92400E"}}>{z} ({count})</button>;})}
      </div>
    </div>}
    {noZone.length>0&&<div style={{background:C.bg,borderRadius:10,padding:"10px 14px",border:`1px solid ${C.line}`}}>
      <div style={{fontWeight:700,fontSize:13,color:C.ink3,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ไม่มีโซน <span style={{fontSize:11,fontWeight:400}}>({noZone.length} โต๊ะ)</span></div>
      <div style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>{noZone.map(t=>`โต๊ะ ${t.table_number}`).join(", ")}</div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS TABLE MANAGE ──────────────────────────────────
// ══════════════════════════════════════════════════════
function POSTableManage({tables,branch,zones=[],reloadZones,onDone}){
  const[form,setForm]=useState({table_number:"",label:"",zone:"",seats:4,shape:"square",w:90,h:80});
  const[bulk,setBulk]=useState({from:1,to:10,prefix:"",zone:"",seats:4});
  const[saving,setSaving]=useState(false);const[tab,setTab]=useState("single");
  async function addSingle(){
    if(!form.table_number)return;setSaving(true);
    try{const mx=tables.reduce((m,t)=>Math.max(m,t.x||0),0);await api.addPOSTable({...form,branch_id:branch.id,status:"available",active:true,x:mx+110,y:50});setForm({table_number:"",label:"",zone:form.zone,seats:4,shape:"square",w:90,h:80});onDone();}catch(e){alert("เพิ่มไม่สำเร็จ: "+e.message);}setSaving(false);
  }
  async function addBulk(){
    setSaving(true);
    try{let col=0,row=0;for(let i=bulk.from;i<=bulk.to;i++){const num=bulk.prefix?`${bulk.prefix}${i}`:String(i);if(!tables.find(t=>t.table_number===num)){await api.addPOSTable({table_number:num,label:"",zone:bulk.zone,seats:+bulk.seats,shape:"square",w:90,h:80,branch_id:branch.id,status:"available",active:true,x:col*110+20,y:row*100+20});col++;if(col>9){col=0;row++;}}}onDone();alert(`✅ เพิ่มโต๊ะสำเร็จ!`);}catch(e){alert("เพิ่มไม่สำเร็จ");}setSaving(false);
  }
  async function delTable(id,num){if(!await confirmDlg(`ต้องการลบโต๊ะ ${num} ใช่หรือไม่?`,"ลบโต๊ะ","ยกเลิก"))return;try{await api.deletePOSTable(id);onDone();}catch{alert("ลบไม่สำเร็จ");}}

  // Zones: from DB (zones table_zones) + legacy text values still on tables
  const dbZoneNames=zones.map(z=>z.name);
  const legacyZones=[...new Set(tables.map(t=>t.zone).filter(Boolean).filter(z=>!dbZoneNames.includes(z)))];
  const allZones=[...dbZoneNames,...legacyZones];
  const grouped=allZones.map(z=>({zone:z,tables:tables.filter(t=>t.zone===z)}));
  const noZone=tables.filter(t=>!t.zone);

  return <div>
    <div style={{display:"flex",gap:8,marginBottom:14,flexWrap:"wrap"}}>
      {[{id:"single",l:"เพิ่มโต๊ะเดี่ยว"},{id:"bulk",l:"เพิ่มหลายโต๊ะ"},{id:"zones",l:`จัดการโซน (${allZones.length})`},{id:"list",l:`โต๊ะทั้งหมด (${tables.length})`}].map(t=><button key={t.id} onClick={()=>setTab(t.id)} style={{padding:"6px 14px",borderRadius:9,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13,background:tab===t.id?C.brand:"transparent",color:tab===t.id?C.white:C.ink3}}>{t.l}</button>)}
    </div>
    {tab==="single"&&<div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>หมายเลขโต๊ะ *</label><input value={form.table_number} onChange={e=>setForm(f=>({...f,table_number:e.target.value}))} placeholder="1, A1, VIP1" style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ชื่อ/Label</label><input value={form.label} onChange={e=>setForm(f=>({...f,label:e.target.value}))} placeholder="ริมหน้าต่าง" style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>โซน</label><select value={form.zone} onChange={e=>setForm(f=>({...f,zone:e.target.value}))} style={{...iS,appearance:"none"}}><option value="">— ไม่ระบุ —</option>{allZones.map(z=><option key={z} value={z}>{z}</option>)}</select></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>จำนวนที่นั่ง</label><input type="number" value={form.seats} onChange={e=>setForm(f=>({...f,seats:+e.target.value}))} style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>รูปทรง</label><select value={form.shape} onChange={e=>setForm(f=>({...f,shape:e.target.value}))} style={{...iS,appearance:"none"}}><option value="square">สี่เหลี่ยม</option><option value="round">กลม</option></select></div>
      </div>
      <Btn onClick={addSingle} icon={I.plus} disabled={!form.table_number} loading={saving}>เพิ่มโต๊ะ</Btn>
    </div>}
    {tab==="bulk"&&<div>
      <div style={{background:C.blueLight,borderRadius:10,padding:"10px 14px",marginBottom:12,fontSize:13,color:C.blue,fontFamily:"'Sarabun',sans-serif"}}>เพิ่มหลายโต๊ะพร้อมกัน ระบบจัดตำแหน่งให้อัตโนมัติครับ</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr 1fr",gap:12,marginBottom:12}}>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>โซน</label><select value={bulk.zone} onChange={e=>setBulk(f=>({...f,zone:e.target.value}))} style={{...iS,appearance:"none"}}><option value="">— ไม่ระบุ —</option>{allZones.map(z=><option key={z} value={z}>{z}</option>)}</select></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>Prefix</label><input value={bulk.prefix} onChange={e=>setBulk(f=>({...f,prefix:e.target.value}))} placeholder="A (ไม่บังคับ)" style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>เริ่มที่</label><input type="number" value={bulk.from} onChange={e=>setBulk(f=>({...f,from:+e.target.value}))} style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ถึง</label><input type="number" value={bulk.to} onChange={e=>setBulk(f=>({...f,to:+e.target.value}))} style={iS}/></div>
        <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>ที่นั่ง/โต๊ะ</label><input type="number" value={bulk.seats} onChange={e=>setBulk(f=>({...f,seats:+e.target.value}))} style={iS}/></div>
      </div>
      <div style={{marginBottom:12,fontSize:14,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>จะสร้าง <b>{Math.max(0,bulk.to-bulk.from+1)}</b> โต๊ะ ({bulk.prefix||""}{bulk.from} ถึง {bulk.prefix||""}{bulk.to})</div>
      <Btn onClick={addBulk} loading={saving} icon={I.plus}>สร้างโต๊ะทั้งหมด</Btn>
    </div>}
    {tab==="zones"&&<POSZoneManager zones={zones} tables={tables} branch={branch} reloadZones={reloadZones} reloadTables={onDone}/>}
    {tab==="list"&&<div style={{maxHeight:420,overflowY:"auto"}}>
      {[...grouped,{zone:null,tables:noZone}].filter(g=>g.tables.length>0).map(g=><div key={g.zone||"no-zone"} style={{marginBottom:14}}>
        {g.zone&&<div style={{fontSize:11,fontWeight:800,color:C.ink3,letterSpacing:1,textTransform:"uppercase",marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>📍 {g.zone}</div>}
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
          {[...g.tables].sort((a,b)=>a.table_number.localeCompare(b.table_number,undefined,{numeric:true})).map(t=><div key={t.id} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:10,padding:"9px 12px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <div><div style={{fontWeight:700,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {t.table_number}</div>{t.label&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{t.label}</div>}<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{t.seats} ที่นั่ง</div></div>
            <button onClick={()=>delTable(t.id,t.table_number)} style={{background:C.redLight,border:"none",borderRadius:7,padding:5,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>
          </div>)}
        </div>
      </div>)}
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS ORDER PANEL ───────────────────────────────────
// ══════════════════════════════════════════════════════
function POSOrderPanel({table,existingOrder,menus,reloadMenus,branch,currentUser,onClose,onDone,printers=[],shift=null,posSettings=null,promotions=[]}){
  const[items,setItems]=useState(existingOrder?.items||[]);
  const[selCat,setSelCat]=useState("ทั้งหมด");const[search,setSearch]=useState("");
  const[noteIdx,setNoteIdx]=useState(null);const[noteText,setNoteText]=useState("");
  const[saving,setSaving]=useState(false);const[showPay,setShowPay]=useState(false);
  const[payMethod,setPayMethod]=useState("cash");
  const[discMode,setDiscMode]=useState("none");
  const[discType,setDiscType]=useState("percent");
  const[discValue,setDiscValue]=useState(0);
  const[itemDisc,setItemDisc]=useState({});
  const[cashRcv,setCashRcv]=useState("");
  const[voidIdx,setVoidIdx]=useState(null);
  const[showSplitBill,setShowSplitBill]=useState(false);
  const[splitSel,setSplitSel]=useState({});

  const cats=useMemo(()=>["ทั้งหมด",...new Set(menus.map(m=>m.category))],[menus]);
  const filtered=useMemo(()=>menus.filter(m=>(selCat==="ทั้งหมด"||m.category===selCat)&&m.name.toLowerCase().includes(search.toLowerCase())),[menus,selCat,search]);
  const subtotal=useMemo(()=>items.reduce((s,i)=>s+i.price*i.qty,0),[items]);
  const itemDiscTotal=useMemo(()=>{let t=0;items.forEach((i,idx)=>{const d=itemDisc[idx];if(!d||!d.v)return;const amt=d.t==="percent"?(i.price*i.qty)*(+d.v||0)/100:+d.v||0;t+=Math.min(amt,i.price*i.qty);});return t;},[items,itemDisc]);
  const billDisc=useMemo(()=>{if(discMode!=="bill")return 0;const v=+discValue||0;const after=Math.max(0,subtotal-itemDiscTotal);return discType==="percent"?after*v/100:Math.min(v,after);},[discMode,discType,discValue,subtotal,itemDiscTotal]);
  const manualDiscount=(discMode==="item"?itemDiscTotal:0)+(discMode==="bill"?billDisc:0);

  // Promotions: auto-evaluate applicable, auto-pick best
  const menusById=useMemo(()=>{const m={};menus.forEach(x=>{m[x.id]=x;});return m;},[menus]);
  const applicablePromos=useMemo(()=>evalPromotions(promotions,{subtotal,items,menusById,now:new Date()}),[promotions,subtotal,items,menusById]);
  const[selectedPromoId,setSelectedPromoId]=useState(null);
  useEffect(()=>{
    if(selectedPromoId&&!applicablePromos.find(p=>p.id===selectedPromoId)){setSelectedPromoId(null);return;}
    if(!selectedPromoId&&applicablePromos.length>0){
      let best=null,bestAmt=0;
      applicablePromos.forEach(p=>{const a=calcPromoDiscount(p,{subtotal,items,menusById});if(a>bestAmt){bestAmt=a;best=p;}});
      if(best)setSelectedPromoId(best.id);
    }
  },[applicablePromos,subtotal]);
  const selectedPromo=applicablePromos.find(p=>p.id===selectedPromoId);
  const promoDiscount=selectedPromo?calcPromoDiscount(selectedPromo,{subtotal,items,menusById}):0;

  const totalDiscount=round2(manualDiscount+promoDiscount);
  const subAfterDisc=round2(Math.max(0,subtotal-totalDiscount));
  // Service Charge & VAT
  const scRate=posSettings?.service_charge_enabled?(+posSettings.service_charge_rate||0):0;
  const sc=round2(subAfterDisc*scRate/100);
  const vatRate=posSettings?.vat_enabled?(+posSettings.vat_rate||0):0;
  const vatIncluded=posSettings?.vat_included!==false;
  const vatBase=subAfterDisc+sc;
  const vat=round2(vatRate>0?(vatIncluded?vatBase*vatRate/(100+vatRate):vatBase*vatRate/100):0);
  const total=round2(vatIncluded?subAfterDisc+sc:subAfterDisc+sc+vat);
  const cashChange=round2(Math.max(0,(+cashRcv||0)-total));

  function addItem(m){setItems(p=>{const ex=p.find(i=>i.menu_id===m.id&&!i.note);if(ex)return p.map(i=>i.menu_id===m.id&&!i.note?{...i,qty:i.qty+1}:i);return[...p,{menu_id:m.id,name:m.name,price:m.price,qty:1,note:"",printer_id:m.printer_id||null,category:m.category||null}];});}
  function chQty(idx,d){setItems(p=>p.map((i,j)=>j===idx?{...i,qty:Math.max(0,i.qty+d)}:i).filter(i=>i.qty>0));}
  function rmItem(idx){setItems(p=>p.filter((_,i)=>i!==idx));}

  async function voidItem(idx){
    if(existingOrder?.status==="paid"){alert("ไม่สามารถยกเลิกรายการของบิลที่ชำระเงินแล้วได้\nหากต้องการคืนเงิน ใช้ปุ่ม 'รับเงินเข้า/จ่ายออก' ในเงินในลิ้นชัก");return;}
    if(!await confirmDlg({message:`ยกเลิก "${items[idx]?.name}"?`,title:"ยกเลิกรายการ",confirmLabel:"ยกเลิกรายการ",cancelLabel:"ไม่ยกเลิก",danger:true}))return;
    const newItems=items.filter((_,i)=>i!==idx);
    if(existingOrder?.id){
      try{
        const newSub=newItems.reduce((s,i)=>s+i.price*i.qty,0);
        await api.updatePOSOrder(existingOrder.id,{items:newItems,subtotal:newSub,total:newSub,discount:0,updated_at:new Date().toISOString()});
      }catch(e){alert("ยกเลิกรายการไม่สำเร็จ: "+e.message);return;}
    }
    setItems(newItems);
  }

  async function reprintItem(item){
    await printKitchen([item],table.table_number,printers);
  }

  async function cancelOrder(){
    if(!existingOrder?.id)return;
    if(existingOrder.status==="paid"){alert("ไม่สามารถยกเลิกบิลที่ชำระเงินแล้วได้\nหากต้องการคืนเงิน ใช้ปุ่ม 'จ่ายออก' ในเงินในลิ้นชัก");return;}
    if(!await confirmDlg({message:`ยกเลิกออเดอร์ทั้งหมดของโต๊ะ ${table.table_number}?`,title:"ยกเลิกออเดอร์",confirmLabel:"ยกเลิกออเดอร์",cancelLabel:"ไม่ยกเลิก",danger:true}))return;
    try{await api.updatePOSOrder(existingOrder.id,{status:"cancelled",updated_at:new Date().toISOString()});onDone();onClose();}
    catch(e){alert("เกิดข้อผิดพลาด: "+e.message);}
  }

  function reprintReceipt(){
    if(!existingOrder?.id)return;
    const pm=existingOrder.payment_method||payMethod;
    // Pull stored breakdown if available, otherwise use live computation
    const data={...existingOrder,items,subtotal,discount:existingOrder.discount||totalDiscount,total:existingOrder.total||total,payment_method:pm,
      service_charge:existingOrder.service_charge||sc,vat:existingOrder.vat||vat,vat_rate:existingOrder.vat_rate||vatRate,vat_included:existingOrder.vat_included!=null?existingOrder.vat_included:vatIncluded,
      promo_amount:existingOrder.promo_amount||promoDiscount,promo_name:existingOrder.promo_name||selectedPromo?.name};
    printReceipt(data,table.table_number,branch.name,posSettings);
  }

  async function saveOrder(){
    if(!items.length){alert("กรุณาเลือกเมนูก่อนครับ");return;}
    setSaving(true);
    try{
      const d={branch_id:branch.id,table_id:table.id,table_number:table.table_number,items,subtotal,discount:0,total:subtotal,status:"pending",ordered_by:currentUser.username,updated_at:new Date().toISOString()};
      if(existingOrder?.id)await api.updatePOSOrder(existingOrder.id,d);
      else await api.createPOSOrder(d);
      printKitchen(items,table.table_number,printers);
      onDone();onClose();
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}setSaving(false);
  }
  async function checkOut(){
    setSaving(true);
    try{
      const itemsWithDisc=items.map((i,idx)=>{const d=itemDisc[idx];if(!d||!d.v||discMode!=="item")return i;const amt=d.t==="percent"?(i.price*i.qty)*(+d.v||0)/100:Math.min(+d.v||0,i.price*i.qty);return{...i,item_discount:amt,item_discount_type:d.t,item_discount_value:+d.v};});
      const cashReceived=payMethod==="cash"?(+cashRcv||total):null;
      const promoMeta=selectedPromo?{promo_id:selectedPromo.id,promo_name:selectedPromo.name,promo_amount:promoDiscount}:{};
      await api.updatePOSOrder(existingOrder.id,{status:"paid",items:itemsWithDisc,subtotal,discount:totalDiscount,total,payment_method:payMethod,updated_at:new Date().toISOString()});
      // record cash movement if cash payment
      if(payMethod==="cash"&&shift){
        try{
          await api.addCashMovement({shift_id:shift.id,branch_id:branch.id,type:"sale",amount:total,reason:`ขายโต๊ะ ${table.table_number}`,order_id:existingOrder.id,user_id:currentUser.id,username:currentUser.username});
        }catch(err){console.error("บันทึก cash movement ไม่สำเร็จ:",err);}
      }
      printReceipt({...existingOrder,items:itemsWithDisc,subtotal,discount:totalDiscount,total,payment_method:payMethod,cash_received:cashReceived,...promoMeta,subtotal_after_disc:subAfterDisc,service_charge:sc,vat,vat_rate:vatRate,vat_included:vatIncluded},table.table_number,branch.name,posSettings);
      onDone();onClose();
    }catch(e){alert("ชำระเงินไม่สำเร็จ: "+e.message);}setSaving(false);
  }

  // Split bill: compute selected subtotal
  const splitItems=items.filter((_,i)=>splitSel[i]);
  const splitSubtotal=splitItems.reduce((s,i)=>s+i.price*i.qty,0);

  // Quick keys: pinned menus
  const quickKeys=useMemo(()=>menus.filter(m=>m.quick_key_pos!=null).sort((a,b)=>(a.quick_key_pos||0)-(b.quick_key_pos||0)),[menus]);

  return <div style={{display:"flex",height:"100%",minHeight:"75vh"}}>
    {/* Left: menu */}
    <div style={{flex:1,display:"flex",flexDirection:"column",borderRight:`1px solid ${C.line}`,minWidth:0}}>
      {quickKeys.length>0&&<div style={{padding:"7px 10px",background:`linear-gradient(135deg,${C.yellowLight},${C.brandLight})`,borderBottom:`1px solid ${C.line}`,display:"flex",gap:5,overflowX:"auto",flexShrink:0,alignItems:"center"}}>
        <span style={{fontSize:11,fontWeight:800,color:"#92400E",fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap",marginRight:4}}>⭐ ยอดนิยม</span>
        {quickKeys.map(m=><button key={m.id} onClick={()=>addItem(m)} title={m.name} style={{padding:"5px 10px",border:`1.5px solid ${C.brand}`,borderRadius:8,background:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:11,fontWeight:700,color:C.brand,whiteSpace:"nowrap",display:"flex",alignItems:"center",gap:5}}>{m.name} <span style={{color:C.brandDark,fontWeight:900}}>฿{m.price}</span></button>)}
      </div>}
      <div style={{padding:"8px 12px",borderBottom:`1px solid ${C.line}`,display:"flex",gap:5,overflowX:"auto",flexShrink:0}}>
        {cats.map(c=><button key={c} onClick={()=>setSelCat(c)} style={{padding:"4px 12px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12,background:selCat===c?C.brand:"transparent",color:selCat===c?C.white:C.ink3,whiteSpace:"nowrap"}}>{c}</button>)}
      </div>
      <div style={{padding:"6px 10px",borderBottom:`1px solid ${C.line}`,flexShrink:0}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาเมนู..." style={{...iS,padding:"7px 12px",fontSize:13}}/>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:8,display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(110px,1fr))",gap:6,alignContent:"start"}}>
        {filtered.map(m=><div key={m.id} onClick={()=>addItem(m)} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:10,padding:"8px 6px",cursor:"pointer",textAlign:"center",transition:"all .15s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.background=C.brandLight;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.line;e.currentTarget.style.background=C.white;}}>
          {m.image?<img src={m.image} alt={m.name} style={{width:"100%",height:50,objectFit:"cover",borderRadius:7,marginBottom:4}}/>:<div style={{height:40,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.food} s={26} c={C.brand}/></div>}
          <div style={{fontSize:11,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif",lineHeight:1.3,marginBottom:3}}>{m.name}</div>
          <div style={{fontSize:13,fontWeight:900,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{m.price}</div>
        </div>)}
      </div>
    </div>

    {/* Right: order panel */}
    <div style={{width:280,display:"flex",flexDirection:"column",background:C.bg,flexShrink:0}}>
      {/* Header */}
      <div style={{padding:"10px 12px",borderBottom:`1px solid ${C.line}`,background:C.white,flexShrink:0}}>
        <div style={{fontWeight:800,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {table.table_number}{table.label?` — ${table.label}`:""}</div>
        <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{table.seats} ที่นั่ง {items.length>0&&`• ${items.length} รายการ`}</div>
      </div>

      {/* Quick action bar */}
      {existingOrder?.id&&<div style={{padding:"6px 8px",borderBottom:`1px solid ${C.line}`,background:"#FFF8F6",display:"flex",gap:4,flexWrap:"wrap"}}>
        <button onClick={()=>printKitchen(items,table.table_number,printers)} title="พิมพ์ใบครัวซ้ำทั้งหมด" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"6px 4px",border:`1px solid ${C.line}`,borderRadius:7,background:C.white,cursor:"pointer",fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
          <Ic d={I.print} s={12} c={C.ink3}/>พิมพ์ครัว
        </button>
        <button onClick={reprintReceipt} title="พิมพ์ใบเสร็จซ้ำ" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"6px 4px",border:`1px solid ${C.blue}`,borderRadius:7,background:C.blueLight,cursor:"pointer",fontSize:11,color:C.blue,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
          <Ic d={I.bill} s={12} c={C.blue}/>ใบเสร็จ
        </button>
        <button onClick={()=>setShowSplitBill(true)} title="แยกบิล" style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",gap:4,padding:"6px 4px",border:`1px solid ${C.purple}`,borderRadius:7,background:C.purpleLight,cursor:"pointer",fontSize:11,color:C.purple,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
          <Ic d={I.users} s={12} c={C.purple}/>แยกบิล
        </button>
        <button onClick={cancelOrder} title="ยกเลิกออเดอร์ทั้งโต๊ะ" style={{display:"flex",alignItems:"center",justifyContent:"center",gap:3,padding:"6px 8px",border:`1px solid #FCA5A5`,borderRadius:7,background:C.redLight,cursor:"pointer",fontSize:11,color:C.red,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>
          <Ic d={I.trash} s={12} c={C.red}/>ยกเลิก
        </button>
      </div>}

      {/* Item list */}
      <div style={{flex:1,overflowY:"auto",padding:8}}>
        {items.length===0
          ?<div style={{textAlign:"center",padding:"30px 0",color:C.ink4}}><Ic d={I.food} s={36} c={C.line}/><p style={{marginTop:8,fontFamily:"'Sarabun',sans-serif",fontSize:13}}>กดเมนูทางซ้ายเพื่อเพิ่ม</p></div>
          :items.map((item,idx)=><div key={idx} style={{background:C.white,borderRadius:9,padding:"8px 10px",marginBottom:5,border:`1px solid ${C.line}`}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:3}}>
              <div style={{flex:1}}><div style={{fontSize:13,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{item.name}</div>{item.note&&<div style={{fontSize:11,color:C.ink4}}>★ {item.note}</div>}</div>
              {/* Reprint & void buttons */}
              <div style={{display:"flex",gap:2,marginLeft:4}}>
                {existingOrder?.id&&<button onClick={()=>reprintItem(item)} title="พิมพ์ซ้ำรายการนี้ไปครัว" style={{background:C.blueLight,border:"none",borderRadius:5,padding:"3px 5px",cursor:"pointer",display:"flex",alignItems:"center"}}><Ic d={I.print} s={11} c={C.blue}/></button>}
                <button onClick={()=>voidItem(idx)} title="ยกเลิกรายการนี้" style={{background:C.redLight,border:"none",borderRadius:5,padding:"3px 5px",cursor:"pointer",display:"flex",alignItems:"center"}}><Ic d={I.x} s={11} c={C.red}/></button>
              </div>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <button onClick={()=>chQty(idx,-1)} style={{width:22,height:22,borderRadius:6,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.minus} s={11}/></button>
                <span style={{fontSize:13,fontWeight:700,minWidth:18,textAlign:"center",fontFamily:"'Sarabun',sans-serif"}}>{item.qty}</span>
                <button onClick={()=>chQty(idx,1)} style={{width:22,height:22,borderRadius:6,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={11}/></button>
              </div>
              <div style={{display:"flex",alignItems:"center",gap:5}}>
                <button onClick={()=>{setNoteIdx(idx);setNoteText(item.note||"");}} style={{background:C.lineLight,border:"none",borderRadius:5,padding:"2px 6px",cursor:"pointer",fontSize:10,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>หมายเหตุ</button>
                <span style={{fontSize:12,fontWeight:700,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{(item.price*item.qty).toFixed(0)}</span>
              </div>
            </div>
          </div>)
        }
      </div>

      {/* Footer */}
      <div style={{padding:10,borderTop:`1px solid ${C.line}`,background:C.white,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
          <span style={{fontSize:14,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>รวม</span>
          <span style={{fontSize:17,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>฿{subtotal.toFixed(0)}</span>
        </div>
        <div style={{display:"flex",gap:6}}>
          {existingOrder?.id&&<Btn v="yellow" onClick={()=>setShowPay(true)} icon={I.bill} full s={{padding:"8px 10px",fontSize:13}}>💳 เช็คบิล</Btn>}
          <Btn onClick={saveOrder} icon={I.check} loading={saving} full s={{padding:"8px 10px",fontSize:13}}>{existingOrder?.id?"อัปเดต":"สั่ง"}</Btn>
        </div>
      </div>
    </div>

    {/* Note modal */}
    {noteIdx!==null&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000}}>
      <div style={{background:C.white,borderRadius:14,padding:20,width:300}}>
        <div style={{fontWeight:700,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:10}}>หมายเหตุ: {items[noteIdx]?.name}</div>
        <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="เช่น ไม่เผ็ด, ไม่ใส่ผัก..." style={{...iS,height:70,resize:"none"}}/>
        <div style={{display:"flex",gap:8,marginTop:10}}>
          <Btn v="ghost" onClick={()=>{setNoteIdx(null);setNoteText("");}} full s={{padding:"7px"}}>ยกเลิก</Btn>
          <Btn onClick={()=>{setItems(p=>p.map((i,j)=>j===noteIdx?{...i,note:noteText}:i));setNoteIdx(null);setNoteText("");}} full s={{padding:"7px"}}>บันทึก</Btn>
        </div>
      </div>
    </div>}

    {/* Split bill modal */}
    {showSplitBill&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.55)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000,padding:16}}>
      <div style={{background:C.white,borderRadius:16,width:"100%",maxWidth:380,padding:20}}>
        <div style={{fontWeight:800,fontSize:16,color:C.ink,marginBottom:4,fontFamily:"'Sarabun',sans-serif"}}>แยกบิล — โต๊ะ {table.table_number}</div>
        <div style={{fontSize:12,color:C.ink3,marginBottom:14,fontFamily:"'Sarabun',sans-serif"}}>เลือกรายการที่ต้องการแยกจ่าย</div>
        <div style={{display:"flex",flexDirection:"column",gap:6,maxHeight:280,overflowY:"auto",marginBottom:14}}>
          {items.map((item,idx)=><label key={idx} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 10px",background:splitSel[idx]?C.brandLight:C.lineLight,borderRadius:9,border:`1.5px solid ${splitSel[idx]?C.brand:C.line}`,cursor:"pointer"}}>
            <input type="checkbox" checked={!!splitSel[idx]} onChange={e=>setSplitSel(p=>({...p,[idx]:e.target.checked}))} style={{width:16,height:16,accentColor:C.brand}}/>
            <div style={{flex:1,fontFamily:"'Sarabun',sans-serif"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.ink}}>{item.qty}x {item.name}</div>
              {item.note&&<div style={{fontSize:11,color:C.ink4}}>★ {item.note}</div>}
            </div>
            <div style={{fontSize:13,fontWeight:800,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{(item.price*item.qty).toFixed(0)}</div>
          </label>)}
        </div>
        <div style={{background:C.brandLight,borderRadius:10,padding:"10px 14px",marginBottom:14,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:C.brand}}>รวมที่เลือก</span>
          <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:20,fontWeight:900,color:C.brand}}>฿{splitSubtotal.toFixed(0)}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={()=>{setShowSplitBill(false);setSplitSel({});}} full s={{padding:"9px"}}>ปิด</Btn>
          <Btn icon={I.print} onClick={()=>{if(splitItems.length===0){alert("กรุณาเลือกรายการ");return;}
            // Compute proportional SC/VAT for the split (relative to original subtotal)
            const ratio=subtotal>0?splitSubtotal/subtotal:0;
            const splitSC=sc*ratio,splitVAT=vat*ratio;
            const splitTotal=vatIncluded?splitSubtotal+splitSC:splitSubtotal+splitSC+splitVAT;
            printReceipt({items:splitItems,subtotal:splitSubtotal,discount:0,total:splitTotal,payment_method:"split",service_charge:splitSC,vat:splitVAT,vat_rate:vatRate,vat_included:vatIncluded},table.table_number,branch.name,posSettings);
          }} full s={{padding:"9px"}}>พิมพ์บิลแยก (ตัวอย่าง)</Btn>
        </div>
      </div>
    </div>}

    {showPay&&<PayModal items={items} subtotal={subtotal} discMode={discMode} setDiscMode={setDiscMode} discType={discType} setDiscType={setDiscType} discValue={discValue} setDiscValue={setDiscValue} itemDisc={itemDisc} setItemDisc={setItemDisc} itemDiscTotal={itemDiscTotal} billDisc={billDisc} totalDiscount={totalDiscount} total={total} payMethod={payMethod} setPayMethod={setPayMethod} cashRcv={cashRcv} setCashRcv={setCashRcv} cashChange={cashChange} onClose={()=>setShowPay(false)} onPay={async()=>{await checkOut();setShowPay(false);}} saving={saving} table={table} sc={sc} vat={vat} vatRate={vatRate} vatIncluded={vatIncluded} subAfterDisc={subAfterDisc} promoDiscount={promoDiscount} selectedPromo={selectedPromo} applicablePromos={applicablePromos} onSelectPromo={setSelectedPromoId} posSettings={posSettings}/>}
  </div>;
}

// ── PAYMENT MODAL ─────────────────────────────────────
const PAY_METHODS=[
  {v:"cash",l:"เงินสด",icon:"💵",c:"#10B981"},
  {v:"promptpay",l:"พร้อมเพย์",icon:"📲",c:"#1E40AF"},
  {v:"transfer",l:"โอนธนาคาร",icon:"🏦",c:"#3B82F6"},
  {v:"credit",l:"บัตรเครดิต",icon:"💳",c:"#7C3AED"},
  {v:"debit",l:"บัตรเดบิต",icon:"💳",c:"#9333EA"},
  {v:"truemoney",l:"TrueMoney",icon:"🟠",c:"#F97316"},
  {v:"shopeepay",l:"ShopeePay",icon:"🛒",c:"#EE4D2D"},
  {v:"linepay",l:"LINE Pay",icon:"💚",c:"#06C755"},
  {v:"rabbit",l:"Rabbit LINE Pay",icon:"🐰",c:"#FB923C"},
  {v:"paotang",l:"เป๋าตัง",icon:"💰",c:"#0891B2"},
  {v:"alipay",l:"Alipay",icon:"🅰️",c:"#1677FF"},
  {v:"wechatpay",l:"WeChat Pay",icon:"💬",c:"#07C160"},
  {v:"grabpay",l:"GrabPay",icon:"🟢",c:"#00B14F"},
  {v:"airpay",l:"AirPay",icon:"✈️",c:"#FB7185"},
  {v:"qr",l:"QR อื่นๆ",icon:"📱",c:"#64748B"},
  {v:"voucher",l:"คูปอง/Voucher",icon:"🎫",c:"#A16207"},
  {v:"other",l:"อื่นๆ",icon:"➕",c:"#475569"},
];
function PayModal({items,subtotal,discMode,setDiscMode,discType,setDiscType,discValue,setDiscValue,itemDisc,setItemDisc,itemDiscTotal,billDisc,totalDiscount,total,payMethod,setPayMethod,cashRcv,setCashRcv,cashChange,onClose,onPay,saving,table,sc=0,vat=0,vatRate=0,vatIncluded=true,subAfterDisc=0,promoDiscount=0,selectedPromo=null,applicablePromos=[],onSelectPromo,posSettings=null}){
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:4000,padding:12}} onClick={onClose}>
    <div onClick={e=>e.stopPropagation()} style={{background:C.white,borderRadius:18,width:"100%",maxWidth:680,maxHeight:"94vh",display:"flex",flexDirection:"column",boxShadow:"0 30px 90px rgba(0,0,0,.4)"}}>
      <div style={{padding:"14px 20px",borderBottom:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:"18px 18px 0 0",color:C.white}}>
        <div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontWeight:900,fontSize:18}}>💳 ชำระเงิน</div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,opacity:.85}}>โต๊ะ {table.table_number}{table.label?` — ${table.label}`:""}</div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.22)",border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.white,fontSize:18,fontFamily:"'Sarabun',sans-serif"}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"14px 20px"}}>
        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:8}}>📋 รายการ ({items.length})</div>
        <div style={{background:C.bg,borderRadius:12,padding:"8px 12px",marginBottom:14}}>
          {items.map((it,idx)=>{const d=itemDisc[idx];const lineTotal=it.price*it.qty;const lineDisc=discMode==="item"&&d&&d.v?(d.t==="percent"?lineTotal*(+d.v||0)/100:Math.min(+d.v||0,lineTotal)):0;return <div key={idx} style={{padding:"6px 0",borderBottom:idx<items.length-1?`1px dashed ${C.line}`:"none"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1,fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:600,color:C.ink}}>{it.qty}x {it.name}</div>
              <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:C.ink}}>฿{lineTotal.toFixed(0)}</div>
            </div>
            {discMode==="item"&&<div style={{display:"flex",gap:5,marginTop:4,alignItems:"center"}}>
              <select value={d?.t||"percent"} onChange={e=>setItemDisc(p=>({...p,[idx]:{...(p[idx]||{}),t:e.target.value,v:p[idx]?.v||0}}))} style={{...iS,padding:"3px 6px",fontSize:11,width:60,height:26}}>
                <option value="percent">%</option><option value="amount">฿</option>
              </select>
              <input type="number" value={d?.v||""} placeholder="0" onChange={e=>setItemDisc(p=>({...p,[idx]:{...(p[idx]||{t:"percent"}),v:e.target.value}}))} style={{...iS,padding:"3px 6px",fontSize:11,width:60,height:26}}/>
              {lineDisc>0&&<span style={{fontSize:11,color:C.red,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>-฿{lineDisc.toFixed(0)}</span>}
            </div>}
          </div>;})}
        </div>

        {applicablePromos.length>0&&<><div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:8}}>🎁 โปรโมชั่นที่เข้าเงื่อนไข ({applicablePromos.length})</div>
        <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:14}}>
          <button onClick={()=>onSelectPromo&&onSelectPromo(null)} style={{padding:"7px 12px",borderRadius:9,border:`2px solid ${!selectedPromo?C.brand:C.line}`,background:!selectedPromo?C.brandLight:C.white,color:!selectedPromo?C.brand:C.ink3,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12}}>ไม่ใช้</button>
          {applicablePromos.map(p=>{const sel=selectedPromo?.id===p.id;return <button key={p.id} onClick={()=>onSelectPromo&&onSelectPromo(p.id)} style={{padding:"7px 12px",borderRadius:9,border:`2px solid ${sel?C.brand:C.line}`,background:sel?C.brandLight:C.white,color:sel?C.brand:C.ink2,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12,display:"flex",flexDirection:"column",alignItems:"flex-start",gap:2}}>
            <span>🎁 {p.name}</span>
            <span style={{fontSize:10,color:sel?C.brand:C.ink4,fontWeight:600}}>{p.type==="percent"?`-${p.discount_value}%`:p.type==="amount"?`-฿${p.discount_value}`:`ราคาพิเศษ ฿${p.discount_value}`}</span>
          </button>;})}
        </div></>}
        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:8}}>🎁 ส่วนลด (ปรับเอง)</div>
        <div style={{display:"flex",gap:6,marginBottom:10}}>
          {[{v:"none",l:"ไม่มี"},{v:"bill",l:"ทั้งบิล"},{v:"item",l:"แยกแต่ละเมนู"}].map(m=><button key={m.v} onClick={()=>setDiscMode(m.v)} style={{flex:1,padding:"8px",borderRadius:10,border:`2px solid ${discMode===m.v?C.brand:C.line}`,background:discMode===m.v?C.brandLight:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12,color:discMode===m.v?C.brand:C.ink3}}>{m.l}</button>)}
        </div>
        {discMode==="bill"&&<div style={{background:C.bg,borderRadius:10,padding:10,marginBottom:14,display:"flex",gap:8,alignItems:"center"}}>
          <div style={{display:"flex",gap:4}}>
            {[{v:"percent",l:"%"},{v:"amount",l:"฿"}].map(t=><button key={t.v} onClick={()=>setDiscType(t.v)} style={{padding:"6px 12px",borderRadius:8,border:`2px solid ${discType===t.v?C.brand:C.line}`,background:discType===t.v?C.brand:C.white,color:discType===t.v?C.white:C.ink3,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:13}}>{t.l}</button>)}
          </div>
          <input type="number" value={discValue||""} placeholder="0" onChange={e=>setDiscValue(e.target.value)} style={{...iS,padding:"7px 10px",fontSize:14,fontWeight:700,flex:1}}/>
          {discType==="percent"&&<div style={{display:"flex",gap:3}}>{[5,10,15,20].map(p=><button key={p} onClick={()=>setDiscValue(p)} style={{padding:"5px 8px",border:`1px solid ${C.line}`,background:C.white,borderRadius:6,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:11,fontWeight:600,color:C.ink3}}>{p}%</button>)}</div>}
        </div>}

        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:8}}>💸 วิธีชำระเงิน</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(108px,1fr))",gap:6,marginBottom:14}}>
          {PAY_METHODS.map(m=>{const sel=payMethod===m.v;return <button key={m.v} onClick={()=>setPayMethod(m.v)} style={{padding:"10px 6px",borderRadius:10,border:`2px solid ${sel?m.c:C.line}`,background:sel?`${m.c}15`:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:11,color:sel?m.c:C.ink2,display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all .15s"}}>
            <span style={{fontSize:22}}>{m.icon}</span>
            <span>{m.l}</span>
          </button>;})}
        </div>

        {payMethod==="cash"&&<div style={{background:C.greenLight,border:`1.5px solid ${C.green}`,borderRadius:10,padding:10,marginBottom:14}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,color:C.green,marginBottom:6}}>💵 รับเงินสด</div>
          <div style={{display:"flex",gap:6,alignItems:"center"}}>
            <input type="number" value={cashRcv} placeholder={total.toFixed(0)} onChange={e=>setCashRcv(e.target.value)} style={{...iS,padding:"8px 10px",fontSize:16,fontWeight:700,flex:1}}/>
            <div style={{display:"flex",gap:3,flexWrap:"wrap"}}>{[100,500,1000].map(v=><button key={v} onClick={()=>setCashRcv(String((+cashRcv||0)+v))} style={{padding:"5px 8px",background:C.white,border:`1px solid ${C.green}`,borderRadius:6,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:11,fontWeight:700,color:C.green}}>+{v}</button>)}
            <button onClick={()=>setCashRcv(String(total))} style={{padding:"5px 8px",background:C.green,border:"none",borderRadius:6,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:11,fontWeight:700,color:C.white}}>พอดี</button></div>
          </div>
          {+cashRcv>0&&<div style={{display:"flex",justifyContent:"space-between",marginTop:8,paddingTop:8,borderTop:`1px solid ${C.green}40`}}>
            <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,color:C.ink2}}>เงินทอน</span>
            <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900,color:cashChange>=0?C.green:C.red}}>฿{cashChange.toFixed(0)}</span>
          </div>}
        </div>}
      </div>
      <div style={{padding:"12px 20px",borderTop:`1px solid ${C.line}`,background:C.bg,borderRadius:"0 0 18px 18px"}}>
        <div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}><span>ยอดรวม</span><span>฿{subtotal.toFixed(2)}</span></div>
        {(totalDiscount-promoDiscount)>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.red,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}><span>ส่วนลด (ปรับเอง)</span><span>-฿{(totalDiscount-promoDiscount).toFixed(2)}</span></div>}
        {promoDiscount>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.purple,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}><span>🎁 {selectedPromo?.name||"โปรโมชั่น"}</span><span>-฿{promoDiscount.toFixed(2)}</span></div>}
        {sc>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}><span>Service Charge {posSettings?.service_charge_rate||0}%</span><span>+฿{sc.toFixed(2)}</span></div>}
        {vat>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:3}}><span>VAT {vatRate}% {vatIncluded?"(รวมในราคา)":""}</span><span>{vatIncluded?"":"+"}฿{vat.toFixed(2)}</span></div>}
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"8px 12px",background:`linear-gradient(135deg,${C.green},#059669)`,borderRadius:10,marginBottom:10,color:C.white}}>
          <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:700}}>ยอดสุทธิ</span>
          <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:24,fontWeight:900}}>฿{total.toFixed(2)}</span>
        </div>
        <div style={{display:"flex",gap:8}}>
          <Btn v="ghost" onClick={onClose} s={{padding:"10px 16px",fontSize:13}}>ยกเลิก</Btn>
          <Btn v="success" onClick={onPay} loading={saving} full s={{padding:"10px",fontSize:14,fontWeight:800}} icon={I.check}>✅ ยืนยันชำระ & พิมพ์ใบเสร็จ</Btn>
        </div>
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS CUSTOMER PAGE (ลูกค้าสแกน QR) ────────────────
// ══════════════════════════════════════════════════════
function CustomerPage({branchId,tableId,token}){
  const[branch,setBranch]=useState(null);const[table,setTable]=useState(null);const[menus,setMenus]=useState([]);
  const[cart,setCart]=useState([]);const[selCat,setSelCat]=useState("ทั้งหมด");const[search,setSearch]=useState("");
  const[step,setStep]=useState("menu");const[sending,setSending]=useState(false);const[done,setDone]=useState(false);
  const[noteIdx,setNoteIdx]=useState(null);const[noteText,setNoteText]=useState("");
  const[myOrder,setMyOrder]=useState(null);
  const[gateError,setGateError]=useState(null);  // null | "no_token" | "bad_token" | "branch_closed"
  const[gateLoading,setGateLoading]=useState(true);
  async function loadMyOrder(){try{const ex=await api.getOrderByTable(+tableId);if(ex&&ex.length>0)setMyOrder(ex[0]);else setMyOrder(null);}catch(e){console.error("loadMyOrder",e);}}
  useEffect(()=>{
    setGateLoading(true);
    let pollId=null;
    (async()=>{
      try{
        const bs=await api.getBranches();
        const b=bs.find(x=>x.id===+branchId);
        if(!b){setGateError("bad_token");setGateLoading(false);return;}
        if(b.active===false){setGateError("branch_closed");setBranch(b);setGateLoading(false);return;}
        if(!token){setGateError("no_token");setBranch(b);setGateLoading(false);return;}
        const matches=await api.scanTable(branchId,tableId,token);
        if(!Array.isArray(matches)||matches.length===0){setGateError("bad_token");setBranch(b);setGateLoading(false);return;}
        const t=matches[0];
        const ms=await api.getMenus();
        setBranch(b);setTable(t);
        setMenus(ms.filter(m=>m.price>0&&(m.availability||{})[branchId]!=="hidden"));
        setGateError(null);
        // Only start polling order state AFTER the gate passes — don't leak existence of orders to bad-token visitors
        loadMyOrder();
        pollId=setInterval(()=>{if(!document.hidden)loadMyOrder();},15000);
      }catch(e){console.error("scan gate",e);setGateError("bad_token");}
      setGateLoading(false);
    })();
    return()=>{if(pollId)clearInterval(pollId);};
  },[branchId,tableId,token]);
  const cats=useMemo(()=>["ทั้งหมด",...new Set(menus.map(m=>m.category))],[menus]);
  const filtered=useMemo(()=>menus.filter(m=>(selCat==="ทั้งหมด"||m.category===selCat)&&m.name.toLowerCase().includes(search.toLowerCase())),[menus,selCat,search]);
  const total=cart.reduce((s,i)=>s+i.price*i.qty,0);
  const itemCount=cart.reduce((s,i)=>s+i.qty,0);
  function addToCart(m){setCart(p=>{const ex=p.find(i=>i.menu_id===m.id&&!i.note);if(ex)return p.map(i=>i.menu_id===m.id&&!i.note?{...i,qty:i.qty+1}:i);return[...p,{menu_id:m.id,name:m.name,price:m.price,qty:1,note:"",printer_id:m.printer_id||null,category:m.category||null}];});}
  function chQty(idx,d){setCart(p=>p.map((i,j)=>j===idx?{...i,qty:Math.max(0,i.qty+d)}:i).filter(i=>i.qty>0));}
  function rmCart(idx){setCart(p=>p.filter((_,i)=>i!==idx));}
  async function placeOrder(){
    setSending(true);
    try{
      // Re-validate the QR token right before submitting (token may have been rotated mid-session)
      const matches=await api.scanTable(branchId,tableId,token);
      if(!Array.isArray(matches)||matches.length===0){
        setSending(false);
        setGateError("bad_token");
        alert("QR ของโต๊ะนี้ถูกอัพเดทใหม่ — กรุณาขอ QR ปัจจุบันจากพนักงาน");
        return;
      }
      const ex=await api.getOrderByTable(+tableId);
      if(ex&&ex.length>0){
        const merged=[...ex[0].items,...cart];
        const newSub=round2(merged.reduce((s,i)=>s+i.price*i.qty,0));
        await api.updatePOSOrder(ex[0].id,{items:merged,subtotal:newSub,total:newSub,updated_at:new Date().toISOString()});
      }else{
        const data={branch_id:+branchId,table_id:+tableId,table_number:table?.table_number,items:cart,subtotal:round2(total),discount:0,total:round2(total),status:"pending",ordered_by:"customer",updated_at:new Date().toISOString()};
        await api.createPOSOrder(data);
      }
      setDone(true);
      loadMyOrder();
    }catch(e){console.error("placeOrder",e);alert("สั่งไม่สำเร็จ กรุณาลองใหม่");}
    setSending(false);
  }
  if(gateLoading)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg}}><div style={{textAlign:"center"}}><div style={{width:40,height:40,border:`4px solid ${C.brandLight}`,borderTop:`4px solid ${C.brand}`,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 12px"}}/><p style={{color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>กำลังตรวจสอบ QR...</p></div></div>;
  if(gateError){
    const messages={
      no_token:{icon:"🚫",title:"QR ไม่ถูกต้อง",msg:"QR Code นี้ไม่มีรหัสยืนยัน — กรุณาขอ QR ใหม่จากพนักงาน"},
      bad_token:{icon:"⏰",title:"QR หมดอายุแล้ว",msg:"QR Code นี้ถูกยกเลิกการใช้งานแล้ว — กรุณาขอ QR ใหม่จากพนักงาน"},
      branch_closed:{icon:"🏪",title:`${branch?.name||"สาขานี้"} ปิดอยู่`,msg:"ขออภัย ขณะนี้ร้านปิดให้บริการ — กรุณาลองใหม่ภายหลังครับ"},
    }[gateError]||{icon:"❌",title:"เข้าระบบไม่ได้",msg:"เกิดข้อผิดพลาด — กรุณาขอ QR ใหม่จากพนักงาน"};
    return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.bg,padding:24,textAlign:"center"}}>
      <div style={{fontSize:80,marginBottom:14}}>{messages.icon}</div>
      <h2 style={{fontSize:22,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>{messages.title}</h2>
      <p style={{fontSize:15,color:C.ink3,fontFamily:"'Sarabun',sans-serif",lineHeight:1.6,maxWidth:340}}>{messages.msg}</p>
    </div>;
  }
  if(!table||!branch)return <div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center",background:C.bg}}><div style={{textAlign:"center"}}><div style={{width:40,height:40,border:`4px solid ${C.brandLight}`,borderTop:`4px solid ${C.brand}`,borderRadius:"50%",animation:"spin .8s linear infinite",margin:"0 auto 12px"}}/><p style={{color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>กำลังโหลดเมนู...</p></div></div>;
  if(done)return <div style={{minHeight:"100vh",display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",background:C.greenLight,padding:24,textAlign:"center"}}>
    <div style={{fontSize:72}}>✅</div>
    <h2 style={{fontSize:22,fontWeight:900,color:C.green,fontFamily:"'Sarabun',sans-serif",marginBottom:6,marginTop:12}}>สั่งอาหารสำเร็จ!</h2>
    <p style={{fontSize:15,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:4}}>โต๊ะ {table.table_number}</p>
    <p style={{fontSize:14,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:24}}>อาหารกำลังเตรียมครับ 🍳</p>
    <div style={{display:"flex",gap:8,flexWrap:"wrap",justifyContent:"center"}}>
      <Btn v="ghost" onClick={()=>{setDone(false);setStep("myorder");}}>📋 ดูออเดอร์ของฉัน</Btn>
      <Btn onClick={()=>{setDone(false);setCart([]);setStep("menu");}}>สั่งเพิ่ม</Btn>
    </div>
  </div>;
  const myOrderItemCount=myOrder?(myOrder.items||[]).reduce((s,i)=>s+i.qty,0):0;
  return <div style={{minHeight:"100vh",background:C.bg,maxWidth:480,margin:"0 auto",display:"flex",flexDirection:"column"}}>
    <div style={{background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,padding:"14px 16px",flexShrink:0,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
      <div>
        <div style={{fontWeight:900,fontSize:17,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>{branch.name}</div>
        <div style={{fontSize:12,color:"rgba(255,255,255,.8)",fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {table.table_number}{table.label?` — ${table.label}`:""}</div>
      </div>
      {myOrder&&step!=="myorder"&&<button onClick={()=>{loadMyOrder();setStep("myorder");}} style={{background:"rgba(255,255,255,0.22)",border:"1px solid rgba(255,255,255,0.4)",borderRadius:10,padding:"6px 10px",cursor:"pointer",color:C.white,fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,display:"flex",flexDirection:"column",alignItems:"center",lineHeight:1.1}}>
        <span>📋 ออเดอร์</span>
        <span style={{fontSize:10,opacity:0.9,marginTop:2}}>{myOrderItemCount} รายการ • ฿{(myOrder.total||0).toFixed(0)}</span>
      </button>}
    </div>
    {step==="menu"&&<>
      <div style={{padding:"8px 10px",background:C.white,borderBottom:`1px solid ${C.line}`,display:"flex",gap:5,overflowX:"auto",flexShrink:0}}>
        {cats.map(c=><button key={c} onClick={()=>setSelCat(c)} style={{padding:"5px 12px",borderRadius:20,border:"none",cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12,background:selCat===c?C.brand:"transparent",color:selCat===c?C.white:C.ink3,whiteSpace:"nowrap"}}>{c}</button>)}
      </div>
      <div style={{padding:"8px 12px",background:C.white,borderBottom:`1px solid ${C.line}`,flexShrink:0}}><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="ค้นหาเมนู..." style={{...iS,padding:"9px 14px"}}/></div>
      <div style={{flex:1,overflowY:"auto",padding:10,display:"flex",flexDirection:"column",gap:8}}>
        {filtered.map(m=>{const inC=cart.find(i=>i.menu_id===m.id);const soldOut=(m.availability||{})[branchId]==="sold_out";return <div key={m.id} style={{background:C.white,borderRadius:12,overflow:"hidden",border:`1px solid ${inC?C.brand:C.line}`,display:"flex",transition:"all .15s",opacity:soldOut?0.6:1}}>
          {m.image?<img src={m.image} alt={m.name} style={{width:80,objectFit:"cover",flexShrink:0,filter:soldOut?"grayscale(80%)":""}}/>:<div style={{width:80,background:`linear-gradient(135deg,${C.brandLight},#FEF9C3)`,display:"flex",alignItems:"center",justifyContent:"center",flexShrink:0}}><Ic d={I.food} s={28} c={soldOut?C.ink4:C.brand}/></div>}
          <div style={{flex:1,padding:"10px 12px"}}>
            <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:2}}>
              <div style={{fontWeight:700,fontSize:14,color:soldOut?C.ink4:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{m.name}</div>
              {soldOut&&<span style={{fontSize:10,fontWeight:700,color:"#92400E",background:"#FEF3C7",border:"1px solid #F59E0B",borderRadius:10,padding:"1px 7px",flexShrink:0}}>วันนี้หมด</span>}
            </div>
            {m.description&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:4,lineHeight:1.4}}>{m.description}</div>}
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:16,fontWeight:900,color:soldOut?C.ink4:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{m.price}</span>
              {soldOut?<span style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>หมดแล้ว</span>:inC?<div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>chQty(cart.indexOf(inC),-1)} style={{width:26,height:26,borderRadius:7,border:`1.5px solid ${C.brand}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.minus} s={13} c={C.brand}/></button>
                <span style={{fontWeight:900,fontSize:15,minWidth:18,textAlign:"center",color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>{inC.qty}</span>
                <button onClick={()=>addToCart(m)} style={{width:26,height:26,borderRadius:7,background:C.brand,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={13} c={C.white}/></button>
              </div>:<button onClick={()=>addToCart(m)} style={{width:32,height:32,borderRadius:9,background:C.brand,border:"none",cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={17} c={C.white}/></button>}
            </div>
          </div>
        </div>;})}
      </div>
      {cart.length>0&&<div style={{padding:"10px 14px",background:C.white,borderTop:`1px solid ${C.line}`,flexShrink:0}}>
        <button onClick={()=>setStep("cart")} style={{width:"100%",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,border:"none",borderRadius:12,padding:"13px",cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <span style={{background:"rgba(255,255,255,.25)",borderRadius:20,padding:"2px 10px",fontSize:12,fontWeight:700,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>{itemCount} รายการ</span>
          <span style={{fontSize:15,fontWeight:900,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>ดูตะกร้า →</span>
          <span style={{fontSize:15,fontWeight:900,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>฿{total.toFixed(0)}</span>
        </button>
      </div>}
    </>}
    {step==="myorder"&&<>
      <div style={{flex:1,overflowY:"auto",padding:12}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:16,fontWeight:900,color:C.ink,margin:0}}>📋 ออเดอร์ของฉัน</h3>
          <button onClick={loadMyOrder} style={{background:C.lineLight,border:"none",borderRadius:8,padding:"5px 10px",cursor:"pointer",color:C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:11,fontWeight:600}}>🔄 รีเฟรช</button>
        </div>
        {!myOrder||(myOrder.items||[]).length===0?<div style={{textAlign:"center",padding:"50px 20px",color:C.ink4}}>
          <div style={{fontSize:48}}>🍽️</div>
          <p style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,marginTop:8}}>ยังไม่มีรายการสั่งครับ</p>
        </div>:<>
          <div style={{background:C.white,borderRadius:12,padding:"10px 12px",marginBottom:10,border:`1px solid ${C.line}`,fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>
            <div style={{display:"flex",justifyContent:"space-between"}}>
              <span>สถานะ:</span>
              <span style={{fontWeight:700,color:myOrder.status==="paid"?C.green:C.brand}}>{myOrder.status==="paid"?"✅ ชำระแล้ว":myOrder.status==="bill_requested"?"💰 รอชำระ":"🍳 กำลังเตรียม"}</span>
            </div>
            <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
              <span>สั่งเมื่อ:</span>
              <span>{new Date(myOrder.created_at).toLocaleTimeString("th-TH",{hour:"2-digit",minute:"2-digit"})}</span>
            </div>
          </div>
          {(myOrder.items||[]).map((it,idx)=><div key={idx} style={{background:C.white,borderRadius:10,padding:"10px 12px",marginBottom:6,border:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:700,fontSize:13,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{it.qty}x {it.name}</div>
              {it.note&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>★ {it.note}</div>}
            </div>
            <div style={{fontSize:14,fontWeight:900,color:C.brand,fontFamily:"'Sarabun',sans-serif"}}>฿{(it.price*it.qty).toFixed(0)}</div>
          </div>)}
          <div style={{background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:12,padding:"14px 16px",marginTop:10,color:C.white,fontFamily:"'Sarabun',sans-serif"}}>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:13,opacity:0.9}}><span>ยอดรวม</span><span>฿{(myOrder.subtotal||0).toFixed(0)}</span></div>
            {myOrder.discount>0&&<div style={{display:"flex",justifyContent:"space-between",fontSize:13,opacity:0.9}}><span>ส่วนลด</span><span>-฿{(myOrder.discount||0).toFixed(0)}</span></div>}
            <div style={{display:"flex",justifyContent:"space-between",fontSize:20,fontWeight:900,marginTop:6,paddingTop:6,borderTop:"1px solid rgba(255,255,255,0.3)"}}><span>รวมทั้งสิ้น</span><span>฿{(myOrder.total||0).toFixed(0)}</span></div>
          </div>
        </>}
      </div>
      <div style={{padding:"10px 14px",background:C.white,borderTop:`1px solid ${C.line}`,display:"flex",gap:8,flexShrink:0,flexWrap:"wrap"}}>
        <Btn v="ghost" onClick={()=>setStep("menu")} full s={{padding:"10px"}}>← กลับหน้าเมนู</Btn>
        {myOrder&&myOrder.status!=="paid"&&myOrder.status!=="bill_requested"&&<Btn onClick={()=>setStep("menu")} full s={{padding:"10px"}}>+ สั่งเพิ่ม</Btn>}
        {myOrder&&myOrder.status!=="paid"&&myOrder.status!=="bill_requested"&&<button onClick={async()=>{try{await api.updatePOSOrder(myOrder.id,{status:"bill_requested",updated_at:new Date().toISOString()});await loadMyOrder();alert("✅ แจ้งพนักงานแล้ว กรุณารอสักครู่");}catch{alert("เกิดข้อผิดพลาด กรุณาแจ้งพนักงาน");}}} style={{width:"100%",padding:"12px",background:`linear-gradient(135deg,${C.yellow},#D97706)`,border:"none",borderRadius:12,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:"#fff",display:"flex",alignItems:"center",justifyContent:"center",gap:8}}>💰 เรียกบิล / ขอชำระเงิน</button>}
        {myOrder&&myOrder.status==="bill_requested"&&<div style={{width:"100%",padding:"12px",background:C.yellowLight,border:`1.5px solid ${C.yellow}`,borderRadius:12,textAlign:"center",fontFamily:"'Sarabun',sans-serif",fontSize:14,fontWeight:700,color:"#92400E"}}>⏳ แจ้งพนักงานแล้ว กรุณารอสักครู่...</div>}
      </div>
    </>}
    {step==="cart"&&<>
      <div style={{flex:1,overflowY:"auto",padding:10}}>
        <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink,marginBottom:10}}>รายการที่สั่ง</h3>
        {cart.map((item,idx)=><div key={idx} style={{background:C.white,borderRadius:10,padding:"10px",marginBottom:6,border:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:8}}>
          <div style={{flex:1}}><div style={{fontWeight:700,fontSize:13,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{item.name}</div>{item.note&&<div style={{fontSize:11,color:C.ink4}}>★ {item.note}</div>}<div style={{fontSize:12,color:C.brand,fontWeight:700}}>฿{item.price} × {item.qty} = ฿{(item.price*item.qty).toFixed(0)}</div></div>
          <div style={{display:"flex",alignItems:"center",gap:5}}>
            <button onClick={()=>chQty(idx,-1)} style={{width:26,height:26,borderRadius:7,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.minus} s={12}/></button>
            <span style={{fontWeight:900,fontSize:14,minWidth:20,textAlign:"center",fontFamily:"'Sarabun',sans-serif"}}>{item.qty}</span>
            <button onClick={()=>chQty(idx,1)} style={{width:26,height:26,borderRadius:7,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.plus} s={12}/></button>
          </div>
          <button onClick={()=>rmCart(idx)} style={{background:C.redLight,border:"none",borderRadius:7,padding:5,cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={13} c={C.red}/></button>
        </div>)}
        <div style={{background:C.bg,borderRadius:10,padding:"12px",marginTop:4}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:3}}><span style={{fontSize:13,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>{itemCount} รายการ</span><span style={{fontSize:17,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>฿{total.toFixed(0)}</span></div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>*ราคายังไม่รวมค่าบริการ (ถ้ามี)</div>
        </div>
      </div>
      <div style={{padding:"10px 14px",background:C.white,borderTop:`1px solid ${C.line}`,display:"flex",gap:8,flexShrink:0}}>
        <Btn v="ghost" onClick={()=>setStep("menu")} full s={{padding:"10px"}}>← เพิ่มเมนู</Btn>
        <Btn v="success" onClick={placeOrder} loading={sending} full s={{padding:"10px"}} icon={I.check}>ยืนยันสั่งอาหาร</Btn>
      </div>
    </>}
    {noteIdx!==null&&<div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.5)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:3000}}>
      <div style={{background:C.white,borderRadius:14,padding:18,width:300}}>
        <div style={{fontWeight:700,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>หมายเหตุ: {cart[noteIdx]?.name}</div>
        <textarea value={noteText} onChange={e=>setNoteText(e.target.value)} placeholder="เช่น ไม่เผ็ด, ไม่ใส่ผัก..." style={{...iS,height:60,resize:"none"}}/>
        <div style={{display:"flex",gap:8,marginTop:8}}>
          <Btn v="ghost" onClick={()=>{setNoteIdx(null);setNoteText("");}} full s={{padding:"6px"}}>ยกเลิก</Btn>
          <Btn onClick={()=>{setCart(p=>p.map((i,j)=>j===noteIdx?{...i,note:noteText}:i));setNoteIdx(null);setNoteText("");}} full s={{padding:"6px"}}>บันทึก</Btn>
        </div>
      </div>
    </div>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS QR PAGE ───────────────────────────────────────
// ══════════════════════════════════════════════════════
function QRImg({url,size=120}){
  const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(url)}&margin=8`;
  return <img src={qrUrl} alt="QR Code" style={{width:size,height:size,borderRadius:8,border:`1px solid ${C.line}`}}/>;
}
function printTableQR(table,branch){
  const baseUrl=window.location.origin+window.location.pathname;
  const tokenPart=table.qr_token?`&t=${encodeURIComponent(table.qr_token)}`:"";
  const url=`${baseUrl}?scan=1&branch=${branch.id}&table=${table.id}${tokenPart}`;
  const qrUrl=`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(url)}&margin=10`;
  const w=openPrintWindow(340,420);
  if(!w)return;
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>QR โต๊ะ ${table.table_number}</title><style>@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;700;900&display=swap');body{font-family:'Sarabun',sans-serif;text-align:center;padding:20px;margin:0}h2{font-size:22px;margin:8px 0}p{color:#64748b;font-size:13px;margin:4px 0}.box{border:2px dashed #e2e8f0;border-radius:16px;padding:20px;display:inline-block}@media print{@page{margin:0;size:auto}}</style></head><body><div class="box"><p style="font-size:11px;font-weight:700;letter-spacing:2px;color:#94a3b8;text-transform:uppercase">${branch.name}</p><h2>โต๊ะ ${table.table_number}</h2>${table.label?`<p>${table.label}</p>`:""}<img src="${qrUrl}" style="width:200px;height:200px;margin:12px 0;border-radius:8px"/><p style="font-size:12px">สแกนเพื่อดูเมนูและสั่งอาหาร</p><p style="font-size:11px;color:#94a3b8">Scan to order</p></div><br/><script>window.onload=()=>setTimeout(()=>window.print(),500)<\/script></body></html>`);
  w.document.close();
}
function POSQRPage({branch,tables,onTablesChanged}){
  const baseUrl=window.location.origin+window.location.pathname;
  const zones=[...new Set(tables.map(t=>t.zone).filter(Boolean))];
  const grouped=[...zones.map(z=>({zone:z,tables:tables.filter(t=>t.zone===z)})),{zone:null,tables:tables.filter(t=>!t.zone)}].filter(g=>g.tables.length>0);
  const buildUrl=(t)=>`${baseUrl}?scan=1&branch=${branch.id}&table=${t.id}${t.qr_token?`&t=${encodeURIComponent(t.qr_token)}`:""}`;
  const[rotating,setRotating]=useState(false);
  async function rotateOne(t){
    if(!await confirmDlg({title:"หมุน QR ใหม่",message:`สร้าง QR ใหม่สำหรับโต๊ะ ${t.table_number}?\n\nQR เก่าจะใช้งานไม่ได้ทันที — ต้องพิมพ์ใหม่และวางที่โต๊ะ`,confirmLabel:"🔄 หมุน QR ใหม่"}))return;
    setRotating(true);
    try{await api.rotateTableToken(t.id);if(onTablesChanged)await onTablesChanged();}
    catch(e){showErr("หมุน QR ไม่สำเร็จ",e);}
    setRotating(false);
  }
  async function rotateAll(){
    if(!await confirmDlg({title:"หมุน QR ทุกโต๊ะ",message:`สร้าง QR ใหม่สำหรับทุกโต๊ะของ "${branch.name}"?\n\nQR เก่าทั้งหมดจะใช้งานไม่ได้ — ต้องพิมพ์ใหม่ทั้งหมด`,confirmLabel:"🔄 หมุนทั้งหมด",danger:true}))return;
    setRotating(true);
    try{const n=await api.rotateAllTableTokens(branch.id);if(onTablesChanged)await onTablesChanged();alert(`✅ หมุน QR ใหม่ ${n} โต๊ะเรียบร้อย`);}
    catch(e){showErr("หมุน QR ไม่สำเร็จ",e);}
    setRotating(false);
  }
  return <div style={{padding:20}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:16,gap:10,flexWrap:"wrap"}}>
      <div>
        <h2 style={{fontFamily:"'Sarabun',sans-serif",fontSize:17,fontWeight:800,color:C.ink,marginBottom:4}}>QR Code สั่งอาหาร</h2>
        <p style={{fontSize:13,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>พิมพ์ QR Code วางที่โต๊ะ ลูกค้าสแกนแล้วสั่งได้เลย · QR แต่ละใบมี token เฉพาะ</p>
      </div>
      <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
        <Btn v="ghost" s={{fontSize:12}} onClick={rotateAll} disabled={rotating} icon={I.refresh}>หมุน QR ทั้งหมด</Btn>
        <Btn v="ghost" s={{fontSize:12}} onClick={()=>{tables.forEach(t=>printTableQR(t,branch));}} icon={I.print}>พิมพ์ทั้งหมด</Btn>
      </div>
    </div>
    {grouped.map(g=><div key={g.zone||"no-zone"} style={{marginBottom:20}}>
      {g.zone&&<div style={{fontSize:12,fontWeight:800,color:C.ink3,letterSpacing:1,textTransform:"uppercase",marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>📍 {g.zone}</div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(170px,1fr))",gap:12}}>
        {g.tables.map(t=>{const url=buildUrl(t);return <div key={t.id} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:14,padding:"14px",textAlign:"center",boxShadow:"0 1px 4px rgba(0,0,0,.05)"}}>
          <div style={{fontWeight:800,fontSize:15,color:C.ink,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}>โต๊ะ {t.table_number}</div>
          {t.label&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:6}}>{t.label}</div>}
          <div style={{display:"flex",justifyContent:"center",marginBottom:8}}><QRImg url={url} size={110}/></div>
          <div style={{display:"flex",gap:4,marginBottom:4}}>
            <button onClick={()=>window.open(url,"_blank")} style={{flex:1,padding:"5px 0",border:`1px solid ${C.line}`,borderRadius:7,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:600,color:C.ink3,background:C.white}}>ทดสอบ</button>
            <button onClick={()=>printTableQR(t,branch)} style={{flex:1,padding:"5px 0",border:"none",borderRadius:7,cursor:"pointer",fontSize:11,fontFamily:"'Sarabun',sans-serif",fontWeight:700,color:C.white,background:C.brand}}>🖨 พิมพ์</button>
          </div>
          <button onClick={()=>rotateOne(t)} disabled={rotating} title="สร้าง QR ใหม่ — QR เก่าใช้ไม่ได้ทันที" style={{width:"100%",padding:"4px 0",border:`1px dashed ${C.line}`,borderRadius:7,cursor:rotating?"not-allowed":"pointer",fontSize:10,fontFamily:"'Sarabun',sans-serif",fontWeight:700,color:C.ink3,background:C.bg,opacity:rotating?.6:1}}>🔄 หมุน QR ใหม่</button>
        </div>;})}
      </div>
    </div>)}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS TAB (Main entry) ──────────────────────────────
// ══════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════
// ── POS MODE SELECTOR ─────────────────────────────────
// ══════════════════════════════════════════════════════
function POSModeSelect({onSelect,canManage=true}){
  return <div style={{minHeight:"calc(100vh - 140px)",display:"flex",alignItems:"center",justifyContent:"center",background:`linear-gradient(135deg,${C.brandLight} 0%,#FFFBEB 100%)`,margin:"-20px -24px",padding:24}}>
    <div style={{background:C.white,borderRadius:24,padding:"40px 36px",maxWidth:620,width:"100%",boxShadow:"0 30px 80px rgba(255,107,53,.18)"}}>
      <div style={{textAlign:"center",marginBottom:30}}>
        <div style={{width:68,height:68,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:20,display:"inline-flex",alignItems:"center",justifyContent:"center",marginBottom:14,boxShadow:`0 12px 28px ${C.brand}55`}}>
          <Ic d={I.shop} s={34} c={C.white}/>
        </div>
        <h2 style={{fontFamily:"'Sarabun',sans-serif",fontSize:24,fontWeight:900,color:C.ink,margin:"0 0 6px"}}>ระบบขายหน้าร้าน</h2>
        <p style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,color:C.ink3,margin:0}}>เลือกโหมดการใช้งาน</p>
      </div>
      <div style={{display:"grid",gridTemplateColumns:canManage?"1fr 1fr":"1fr",gap:14,maxWidth:canManage?"none":300,margin:canManage?0:"0 auto"}}>
        <button onClick={()=>onSelect('sale')} style={{padding:"26px 18px",border:`2px solid ${C.brandBorder}`,borderRadius:18,background:`linear-gradient(135deg,${C.white},${C.brandLight})`,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",textAlign:"left",transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.brand;e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 14px 30px ${C.brand}33`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.brandBorder;e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
          <div style={{width:48,height:48,background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,borderRadius:13,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14,fontSize:24}}>🛒</div>
          <div style={{fontSize:17,fontWeight:900,color:C.ink,marginBottom:6}}>เข้าสู่การขายหน้าร้าน</div>
          <div style={{fontSize:12,color:C.ink3,lineHeight:1.6}}>เปิดกะ • รับออเดอร์ • ชำระเงิน<br/>จัดการเงินในลิ้นชัก</div>
        </button>
        {canManage&&<button onClick={()=>onSelect('manage')} style={{padding:"26px 18px",border:`2px solid #DDD6FE`,borderRadius:18,background:`linear-gradient(135deg,${C.white},${C.purpleLight})`,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",textAlign:"left",transition:"all .2s"}} onMouseEnter={e=>{e.currentTarget.style.borderColor=C.purple;e.currentTarget.style.transform="translateY(-3px)";e.currentTarget.style.boxShadow=`0 14px 30px ${C.purple}33`;}} onMouseLeave={e=>{e.currentTarget.style.borderColor="#DDD6FE";e.currentTarget.style.transform="";e.currentTarget.style.boxShadow="";}}>
          <div style={{width:48,height:48,background:`linear-gradient(135deg,${C.purple},#7C3AED)`,borderRadius:13,display:"flex",alignItems:"center",justifyContent:"center",marginBottom:14,fontSize:24}}>⚙️</div>
          <div style={{fontSize:17,fontWeight:900,color:C.ink,marginBottom:6}}>จัดการหลังบ้าน</div>
          <div style={{fontSize:12,color:C.ink3,lineHeight:1.6}}>จัดผังโต๊ะ • ตั้งค่าเครื่องพิมพ์<br/>ประวัติกะ • รายงาน</div>
        </button>}
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── OPEN SHIFT ────────────────────────────────────────
// ══════════════════════════════════════════════════════
function OpenShiftModal({currentBranch,currentUser,onDone,onCancel}){
  const[cash,setCash]=useState("");const[note,setNote]=useState("");const[saving,setSaving]=useState(false);
  async function open(){
    const amt=+cash;if(isNaN(amt)||amt<0){alert("กรุณาใส่จำนวนเงินที่ถูกต้อง");return;}
    setSaving(true);
    try{
      const res=await api.openShift({branch_id:currentBranch.id,user_id:currentUser.id,username:currentUser.username,opening_cash:amt,opened_at:new Date().toISOString(),status:"open",notes:note||null});
      const created=Array.isArray(res)?res[0]:res;
      await api.addCashMovement({shift_id:created.id,branch_id:currentBranch.id,type:"opening",amount:amt,reason:"เปิดกะ - เงินทอนเริ่มต้น",user_id:currentUser.id,username:currentUser.username});
      onDone(created);
    }catch(e){alert("เปิดกะไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.75)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5000,padding:16}}>
    <div style={{background:C.white,borderRadius:18,width:"100%",maxWidth:460,boxShadow:"0 30px 80px rgba(0,0,0,.4)",overflow:"hidden"}}>
      <div style={{padding:"18px 22px",background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white}}>
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <div style={{fontSize:30}}>💵</div>
          <div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900}}>เปิดกะการขาย</div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,opacity:.85}}>{currentBranch.name} · {currentUser.name||currentUser.username}</div>
          </div>
        </div>
      </div>
      <div style={{padding:24}}>
        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:C.ink2,marginBottom:8}}>เงินทอนเริ่มต้นในลิ้นชัก *</div>
        <input type="number" autoFocus value={cash} onChange={e=>setCash(e.target.value)} placeholder="0" style={{...iS,fontSize:26,fontWeight:900,padding:"14px 18px",textAlign:"center",letterSpacing:1}}/>
        <div style={{display:"flex",gap:6,marginTop:8}}>
          {[500,1000,2000,3000,5000].map(v=><button key={v} onClick={()=>setCash(String(v))} style={{flex:1,padding:"7px 0",border:`1px solid ${C.line}`,borderRadius:8,background:C.white,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:11,fontWeight:700,color:C.ink2}}>฿{v.toLocaleString()}</button>)}
        </div>
        <div style={{marginTop:16}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:C.ink2,marginBottom:6}}>หมายเหตุ (ถ้ามี)</div>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="—" style={{...iS,fontSize:13}}/>
        </div>
        <div style={{display:"flex",gap:8,marginTop:20}}>
          <Btn v="ghost" onClick={onCancel} full s={{padding:"11px"}}>ยกเลิก</Btn>
          <Btn onClick={open} loading={saving} full icon={I.check} s={{padding:"11px",fontSize:14,fontWeight:800}}>เปิดกะ</Btn>
        </div>
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── CASH DRAWER MODAL ────────────────────────────────
// ══════════════════════════════════════════════════════
const CASH_TYPE_INFO={
  opening:{l:"เปิดกะ",icon:"🟢",c:"#10B981"},
  sale:{l:"ขาย (เงินสด)",icon:"💵",c:"#10B981"},
  refund:{l:"คืนเงิน",icon:"↩️",c:"#EF4444"},
  pay_in:{l:"รับเงินเข้า",icon:"⬆️",c:"#10B981"},
  pay_out:{l:"จ่ายออก",icon:"⬇️",c:"#EF4444"},
  drop:{l:"ฝาก/ถอนเซฟ",icon:"🏦",c:"#3B82F6"},
  closing:{l:"ปิดกะ",icon:"🔚",c:"#64748B"},
};
function CashDrawerModal({shift,currentBranch,currentUser,onClose}){
  const[movements,setMovements]=useState([]);const[expCats,setExpCats]=useState([]);
  const[loading,setLoading]=useState(true);const[action,setAction]=useState(null);
  const[amount,setAmount]=useState("");const[category,setCategory]=useState("");
  const[reason,setReason]=useState("");const[note,setNote]=useState("");const[saving,setSaving]=useState(false);
  async function load(){
    setLoading(true);
    try{const[m,e]=await Promise.all([api.getCashMovements(shift.id),api.getExpenseCats(currentBranch.id)]);setMovements(m);setExpCats(e);}
    catch(err){alert("โหลดไม่สำเร็จ: "+err.message);}
    setLoading(false);
  }
  useEffect(()=>{load();},[shift.id]);
  const totals=useMemo(()=>{
    let inCash=0,outCash=0,salesCash=0,refunds=0,drops=0;
    movements.forEach(m=>{const a=+m.amount||0;if(m.type==='opening'||m.type==='pay_in')inCash+=a;else if(m.type==='sale')salesCash+=a;else if(m.type==='refund')refunds+=a;else if(m.type==='pay_out')outCash+=a;else if(m.type==='drop')drops+=a;});
    return{inCash,outCash,salesCash,refunds,drops,expected:inCash+salesCash-refunds-outCash-drops};
  },[movements]);
  async function submit(){
    const amt=+amount;if(isNaN(amt)||amt<=0){alert("กรุณาใส่จำนวนเงินมากกว่า 0");return;}
    if(action==='out'&&!category){alert("กรุณาเลือกหมวดหมู่");return;}
    if(!reason.trim()){alert("กรุณาระบุเหตุผล");return;}
    setSaving(true);
    try{
      const type=action==='in'?'pay_in':action==='out'?'pay_out':'drop';
      await api.addCashMovement({shift_id:shift.id,branch_id:currentBranch.id,type,amount:amt,category:action==='out'?category:null,reason,note:note||null,user_id:currentUser.id,username:currentUser.username});
      setAmount("");setCategory("");setReason("");setNote("");setAction(null);await load();
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5000,padding:12}}>
    <div style={{background:C.white,borderRadius:18,width:"100%",maxWidth:780,maxHeight:"94vh",display:"flex",flexDirection:"column",boxShadow:"0 30px 80px rgba(0,0,0,.4)",overflow:"hidden"}}>
      <div style={{padding:"14px 22px",background:`linear-gradient(135deg,${C.green},#059669)`,color:C.white,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:26}}>💰</div>
          <div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:17,fontWeight:900}}>เงินในลิ้นชัก</div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:11,opacity:.85}}>กะ #{shift.id} · เปิดเมื่อ {new Date(shift.opened_at).toLocaleString("th-TH")}</div>
          </div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.22)",border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.white,fontSize:18}}>✕</button>
      </div>
      <div style={{padding:"14px 22px",borderBottom:`1px solid ${C.line}`,background:C.bg,flexShrink:0}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:8}}>
          {[
            {l:"เงินเริ่มต้น+เข้า",v:totals.inCash,c:C.ink2},
            {l:"ขายเงินสด",v:totals.salesCash,c:C.green},
            {l:"จ่ายออก/ฝาก",v:-(totals.outCash+totals.drops+totals.refunds),c:C.red},
            {l:"ยอดที่ควรมี",v:totals.expected,c:C.brand,bold:true},
          ].map((s,i)=><div key={i} style={{background:C.white,padding:"9px 12px",borderRadius:10,border:`1.5px solid ${s.bold?C.brandBorder:C.line}`}}>
            <div style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:600,marginBottom:3}}>{s.l}</div>
            <div style={{fontSize:s.bold?20:15,fontWeight:s.bold?900:700,color:s.c,fontFamily:"'Sarabun',sans-serif"}}>฿{(+s.v).toLocaleString()}</div>
          </div>)}
        </div>
      </div>
      {!action&&<div style={{padding:"14px 22px",borderBottom:`1px solid ${C.line}`,display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:10,flexShrink:0}}>
        {[
          {a:'in',icon:"⬆️",l:"เงินเข้า",h:"เพิ่มทอน, ใส่เงิน",c:C.green,bg:C.greenLight},
          {a:'out',icon:"⬇️",l:"จ่ายออก",h:"ค่าวัตถุดิบ, ค่าน้ำแข็ง",c:C.red,bg:C.redLight},
          {a:'drop',icon:"🏦",l:"ฝาก/ถอนเซฟ",h:"นำเงินออกจากลิ้นชัก",c:C.blue,bg:C.blueLight},
        ].map(b=><button key={b.a} onClick={()=>setAction(b.a)} style={{padding:"14px",borderRadius:12,border:`2px solid ${b.c}`,background:b.bg,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:800,textAlign:"center"}}>
          <div style={{fontSize:24,marginBottom:4}}>{b.icon}</div>
          <div style={{fontSize:13,color:b.c}}>{b.l}</div>
          <div style={{fontSize:10,color:C.ink4,fontWeight:500,marginTop:2}}>{b.h}</div>
        </button>)}
      </div>}
      {action&&<div style={{padding:"14px 22px",borderBottom:`1px solid ${C.line}`,background:action==='in'?C.greenLight:action==='out'?C.redLight:C.blueLight,flexShrink:0}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
          <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,fontWeight:800,color:action==='in'?C.green:action==='out'?C.red:C.blue}}>
            {action==='in'?"⬆️ บันทึกเงินเข้า":action==='out'?"⬇️ บันทึกจ่ายออก":"🏦 บันทึกฝาก/ถอนเซฟ"}
          </span>
          <button onClick={()=>{setAction(null);setAmount("");setCategory("");setReason("");setNote("");}} style={{background:"none",border:"none",cursor:"pointer",color:C.ink3,fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>← กลับ</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:action==='out'?"1fr 1fr":"1fr",gap:10,marginBottom:10}}>
          <div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,color:C.ink2,marginBottom:5}}>จำนวนเงิน *</div>
            <input type="number" autoFocus value={amount} onChange={e=>setAmount(e.target.value)} placeholder="0" style={{...iS,fontSize:20,fontWeight:900,padding:"10px 14px",textAlign:"center"}}/>
          </div>
          {action==='out'&&<div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,color:C.ink2,marginBottom:5}}>หมวดหมู่ *</div>
            <select value={category} onChange={e=>setCategory(e.target.value)} style={{...iS,appearance:"none",fontSize:14,padding:"11px 14px"}}>
              <option value="">— เลือกหมวด —</option>
              {expCats.map(c=><option key={c.id} value={c.name}>{c.icon||"•"} {c.name}</option>)}
            </select>
          </div>}
        </div>
        <div style={{marginBottom:10}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,color:C.ink2,marginBottom:5}}>เหตุผล *</div>
          <input value={reason} onChange={e=>setReason(e.target.value)} placeholder={action==='in'?"เช่น เพิ่มเงินทอน":action==='out'?"เช่น ซื้อมะนาว 2 กิโล":"เช่น ฝากเซฟกลางวัน"} style={{...iS,fontSize:13}}/>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,color:C.ink2,marginBottom:5}}>หมายเหตุ</div>
          <input value={note} onChange={e=>setNote(e.target.value)} placeholder="optional" style={{...iS,fontSize:13}}/>
        </div>
        <Btn onClick={submit} loading={saving} v={action==='in'?"success":action==='out'?"danger":"info"} full icon={I.check} s={{padding:"11px"}}>
          {action==='in'?"บันทึกเงินเข้า":action==='out'?"บันทึกจ่ายออก":"บันทึกฝาก/ถอน"}
        </Btn>
      </div>}
      <div style={{flex:1,overflowY:"auto",padding:"14px 22px"}}>
        <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:8}}>📋 ประวัติเคลื่อนไหว ({movements.length})</div>
        {loading?<div style={{padding:20,textAlign:"center",color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>กำลังโหลด...</div>:movements.length===0?<div style={{textAlign:"center",padding:20,color:C.ink4,fontFamily:"'Sarabun',sans-serif",fontSize:13}}>ยังไม่มีรายการ</div>:
        <div style={{display:"flex",flexDirection:"column",gap:5}}>
          {movements.map(m=>{
            const ti=CASH_TYPE_INFO[m.type]||{l:m.type,icon:"•",c:C.ink3};
            const isOut=['pay_out','drop','refund','closing'].includes(m.type);
            return <div key={m.id} style={{background:C.bg,borderRadius:9,padding:"8px 12px",display:"flex",alignItems:"center",gap:10,borderLeft:`3px solid ${ti.c}`}}>
              <div style={{fontSize:18}}>{ti.icon}</div>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",gap:6,alignItems:"baseline",flexWrap:"wrap"}}>
                  <span style={{fontSize:13,fontWeight:700,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{ti.l}</span>
                  {m.category&&<span style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>· {m.category}</span>}
                </div>
                {m.reason&&<div style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginTop:1}}>{m.reason}</div>}
                <div style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:1}}>{m.username||'-'} · {new Date(m.created_at).toLocaleString("th-TH")}</div>
              </div>
              <div style={{fontSize:15,fontWeight:900,color:isOut?C.red:C.green,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>{isOut?'-':'+'}฿{(+m.amount).toLocaleString()}</div>
            </div>;
          })}
        </div>}
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── CLOSE SHIFT (Z-REPORT) ───────────────────────────
// ══════════════════════════════════════════════════════
function printZReport({shift,totals,branch,user,note}){
  const w=openPrintWindow(420,720);
  if(!w)return;
  const fmt=(v)=>(+v||0).toLocaleString();
  const html=`<html><head><title>Z-Report กะ #${shift.id}</title>
<style>body{font-family:'Sarabun',sans-serif;padding:14px;font-size:12px;line-height:1.6;color:#000}h2,h3{margin:0 0 6px}.center{text-align:center}.row{display:flex;justify-content:space-between;padding:2px 0}.div{border-top:1px dashed #000;margin:8px 0}.bold{font-weight:900}.big{font-size:16px}</style>
</head><body>
<div class="center">
  <h2>${branch.name}</h2>
  <div class="bold">═══ Z-REPORT ═══</div>
  <div>กะ #${shift.id}</div>
  <div>${user.name||user.username}</div>
</div>
<div class="div"></div>
<div class="row"><span>เปิดกะ</span><span>${new Date(shift.opened_at).toLocaleString("th-TH")}</span></div>
<div class="row"><span>ปิดกะ</span><span>${new Date().toLocaleString("th-TH")}</span></div>
<div class="div"></div>
<h3>📊 ยอดขาย</h3>
<div class="row"><span>จำนวนบิล</span><span class="bold">${totals.orderCount} บิล</span></div>
<div class="row"><span>ยอดขายรวม</span><span class="bold">฿${fmt(totals.totalSales)}</span></div>
<div class="row"><span>&nbsp;&nbsp;• เงินสด</span><span>฿${fmt(totals.totalCash)}</span></div>
<div class="row"><span>&nbsp;&nbsp;• โอน/พร้อมเพย์</span><span>฿${fmt(totals.totalTransfer)}</span></div>
<div class="row"><span>&nbsp;&nbsp;• บัตร</span><span>฿${fmt(totals.totalCard)}</span></div>
<div class="row"><span>&nbsp;&nbsp;• อื่นๆ</span><span>฿${fmt(totals.totalOther)}</span></div>
<div class="div"></div>
<h3>💰 ลิ้นชัก</h3>
<div class="row"><span>เงินทอนเริ่มต้น</span><span>฿${fmt(totals.openingCash)}</span></div>
<div class="row"><span>+ ขายเงินสด</span><span>฿${fmt(totals.salesCash)}</span></div>
<div class="row"><span>+ รับเข้าเพิ่ม</span><span>฿${fmt(totals.payIn)}</span></div>
<div class="row"><span>- จ่ายออก</span><span>฿${fmt(totals.payOut)}</span></div>
<div class="row"><span>- ฝาก/ถอนเซฟ</span><span>฿${fmt(totals.drops)}</span></div>
<div class="row"><span>- คืนเงิน</span><span>฿${fmt(totals.refunds)}</span></div>
<div class="row bold"><span>= ยอดที่ควรมี</span><span>฿${fmt(totals.expected)}</span></div>
<div class="div"></div>
<div class="row big bold"><span>นับจริง</span><span>฿${fmt(totals.actual)}</span></div>
<div class="row big bold" style="color:${totals.diff===0?'#10B981':totals.diff>0?'#3B82F6':'#EF4444'}"><span>${totals.diff===0?'✅ ตรงเป๊ะ':totals.diff>0?'📈 เกิน':'📉 ขาด'}</span><span>${totals.diff>0?'+':''}฿${fmt(Math.abs(totals.diff))}</span></div>
${note?`<div class="div"></div><div><b>หมายเหตุ:</b> ${note}</div>`:''}
<div class="div"></div>
<div class="center" style="font-size:10px;color:#666;margin-top:10px">พิมพ์เมื่อ ${new Date().toLocaleString("th-TH")}</div>
<script>setTimeout(()=>{window.print();},300);</script>
</body></html>`;
  w.document.write(html);w.document.close();
}
function CloseShiftModal({shift,currentBranch,currentUser,onClose,onClosed}){
  const[movements,setMovements]=useState([]);const[orders,setOrders]=useState([]);
  const[loading,setLoading]=useState(true);const[actualCash,setActualCash]=useState("");
  const[note,setNote]=useState("");const[saving,setSaving]=useState(false);
  async function load(){
    setLoading(true);
    try{
      const[m,o]=await Promise.all([api.getCashMovements(shift.id),api.getPOSOrders(currentBranch.id)]);
      setMovements(m);
      const since=new Date(shift.opened_at).getTime();
      // Source of truth: orders linked via cash_movements (sale rows) PLUS any paid orders updated in shift window
      const linkedIds=new Set(m.filter(x=>x.type==='sale'&&x.order_id).map(x=>x.order_id));
      const inShift=(o||[]).filter(x=>{
        if(x.status!=='paid')return false;
        if(linkedIds.has(x.id))return true;
        const u=new Date(x.updated_at||x.created_at).getTime();
        return u>=since;
      });
      setOrders(inShift);
    }catch(e){alert("โหลดไม่สำเร็จ: "+e.message);}
    setLoading(false);
  }
  useEffect(()=>{load();},[shift.id]);
  const totals=useMemo(()=>{
    let openingCash=0,payIn=0,payOut=0,drops=0,refunds=0,salesCash=0;
    movements.forEach(m=>{const a=+m.amount||0;if(m.type==='opening')openingCash+=a;else if(m.type==='pay_in')payIn+=a;else if(m.type==='pay_out')payOut+=a;else if(m.type==='drop')drops+=a;else if(m.type==='refund')refunds+=a;else if(m.type==='sale')salesCash+=a;});
    let totalSales=0,totalCash=0,totalTransfer=0,totalCard=0,totalOther=0;
    orders.forEach(o=>{const t=+o.total||0;totalSales+=t;const pm=o.payment_method;if(pm==='cash')totalCash+=t;else if(pm==='transfer'||pm==='promptpay')totalTransfer+=t;else if(pm==='credit'||pm==='debit')totalCard+=t;else totalOther+=t;});
    const expected=openingCash+payIn+salesCash-payOut-drops-refunds;
    const actual=+actualCash||0;
    return{openingCash,payIn,payOut,drops,refunds,salesCash,totalSales,totalCash,totalTransfer,totalCard,totalOther,expected,actual,diff:actual-expected,orderCount:orders.length};
  },[movements,orders,actualCash]);
  async function closeShift(){
    if(!await confirmDlg({title:"ยืนยันปิดกะ",message:`ยอดที่ควรมี ฿${totals.expected.toLocaleString()}\nนับจริง ฿${totals.actual.toLocaleString()}\n${totals.diff===0?'ตรงเป๊ะ':totals.diff>0?`เกิน ฿${totals.diff.toLocaleString()}`:`ขาด ฿${Math.abs(totals.diff).toLocaleString()}`}\n\nต้องการปิดกะใช่หรือไม่?`,confirmLabel:"ปิดกะ",danger:true}))return;
    setSaving(true);
    try{
      // Print Z-report FIRST so a popup-blocker / printer issue doesn't strand the audit trail.
      printZReport({shift,totals,branch:currentBranch,user:currentUser,note});
      await api.addCashMovement({shift_id:shift.id,branch_id:currentBranch.id,type:"closing",amount:round2(totals.actual),reason:"ปิดกะ - นับเงินจริง",note:totals.diff!==0?`ส่วนต่าง ${totals.diff>=0?'+':''}${round2(totals.diff)}`:null,user_id:currentUser.id,username:currentUser.username});
      await api.closeShift(shift.id,{status:"closed",closed_at:new Date().toISOString(),closing_cash:round2(totals.actual),expected_cash:round2(totals.expected),cash_diff:round2(totals.diff),total_sales:round2(totals.totalSales),total_cash:round2(totals.totalCash),total_transfer:round2(totals.totalTransfer),total_card:round2(totals.totalCard),total_other:round2(totals.totalOther),total_pay_in:round2(totals.payIn),total_pay_out:round2(totals.payOut),total_drop:round2(totals.drops),order_count:totals.orderCount,notes:note||null});
      // Clear auto-print dedup so next shift starts fresh
      try{sessionStorage.removeItem("fc_printed_orders");}catch{}
      onClosed();
    }catch(e){showErr("ปิดกะไม่สำเร็จ",e);}
    setSaving(false);
  }
  return <div style={{position:"fixed",inset:0,background:"rgba(15,23,42,.7)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:5000,padding:12}}>
    <div style={{background:C.white,borderRadius:18,width:"100%",maxWidth:680,maxHeight:"94vh",display:"flex",flexDirection:"column",boxShadow:"0 30px 80px rgba(0,0,0,.4)",overflow:"hidden"}}>
      <div style={{padding:"14px 22px",background:"linear-gradient(135deg,#0F172A,#1E293B)",color:C.white,display:"flex",justifyContent:"space-between",alignItems:"center",flexShrink:0}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <div style={{fontSize:26}}>🔚</div>
          <div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:17,fontWeight:900}}>ปิดกะการขาย</div>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:11,opacity:.85}}>{currentBranch.name} · กะ #{shift.id}</div>
          </div>
        </div>
        <button onClick={onClose} style={{background:"rgba(255,255,255,.22)",border:"none",borderRadius:10,width:32,height:32,cursor:"pointer",color:C.white,fontSize:18}}>✕</button>
      </div>
      <div style={{flex:1,overflowY:"auto",padding:"18px 22px"}}>
        {loading?<div style={{padding:30,textAlign:"center",color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>กำลังโหลด...</div>:<>
        <div style={{background:C.bg,borderRadius:14,padding:14,marginBottom:14}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:10}}>📊 สรุปยอดขาย</div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
            {[
              {l:"จำนวนออเดอร์",v:`${totals.orderCount} บิล`,c:C.ink2},
              {l:"ยอดขายรวม",v:`฿${totals.totalSales.toLocaleString()}`,c:C.brand},
              {l:"เงินสด",v:`฿${totals.totalCash.toLocaleString()}`,c:C.green},
              {l:"โอน/พร้อมเพย์",v:`฿${totals.totalTransfer.toLocaleString()}`,c:C.blue},
              {l:"บัตรเครดิต/เดบิต",v:`฿${totals.totalCard.toLocaleString()}`,c:C.purple},
              {l:"อื่นๆ",v:`฿${totals.totalOther.toLocaleString()}`,c:C.ink3},
            ].map((s,i)=><div key={i} style={{background:C.white,borderRadius:10,padding:"8px 12px",border:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <span style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif",fontWeight:600}}>{s.l}</span>
              <span style={{fontSize:14,fontWeight:900,color:s.c,fontFamily:"'Sarabun',sans-serif"}}>{s.v}</span>
            </div>)}
          </div>
        </div>
        <div style={{background:C.brandLight,borderRadius:14,padding:14,marginBottom:14,border:`1.5px solid ${C.brandBorder}`}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.brand,marginBottom:10}}>💰 เงินในลิ้นชัก</div>
          <div style={{display:"flex",flexDirection:"column",gap:5}}>
            {[
              {l:"เงินทอนเริ่มต้น",v:totals.openingCash},
              {l:"+ ขายเงินสด",v:totals.salesCash},
              {l:"+ รับเข้าเพิ่ม",v:totals.payIn},
              {l:"- จ่ายออก",v:-totals.payOut},
              {l:"- ฝาก/ถอนเซฟ",v:-totals.drops},
              {l:"- คืนเงิน",v:-totals.refunds},
            ].map((s,i)=><div key={i} style={{display:"flex",justifyContent:"space-between",fontSize:13,fontFamily:"'Sarabun',sans-serif"}}>
              <span style={{color:C.ink3}}>{s.l}</span>
              <span style={{fontWeight:700,color:s.v<0?C.red:C.ink}}>฿{(+s.v).toLocaleString()}</span>
            </div>)}
            <div style={{display:"flex",justifyContent:"space-between",paddingTop:8,marginTop:4,borderTop:`1.5px dashed ${C.brand}55`,fontFamily:"'Sarabun',sans-serif"}}>
              <span style={{fontWeight:800,color:C.brand,fontSize:14}}>= ยอดที่ควรมี</span>
              <span style={{fontWeight:900,color:C.brand,fontSize:20}}>฿{totals.expected.toLocaleString()}</span>
            </div>
          </div>
        </div>
        <div style={{marginBottom:14}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:8}}>🧮 นับเงินจริงในลิ้นชัก *</div>
          <input type="number" value={actualCash} onChange={e=>setActualCash(e.target.value)} placeholder="0" style={{...iS,fontSize:24,fontWeight:900,padding:"14px 18px",textAlign:"center"}}/>
          {actualCash!==""&&<div style={{marginTop:8,padding:"10px 14px",borderRadius:10,background:totals.diff===0?C.greenLight:totals.diff>0?C.blueLight:C.redLight,border:`1.5px solid ${totals.diff===0?C.green:totals.diff>0?C.blue:C.red}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:700,color:totals.diff===0?C.green:totals.diff>0?C.blue:C.red}}>
              {totals.diff===0?"✅ ตรงเป๊ะ":totals.diff>0?"📈 เกิน":"📉 ขาด"}
            </span>
            <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900,color:totals.diff===0?C.green:totals.diff>0?C.blue:C.red}}>{totals.diff>0?'+':''}฿{Math.abs(totals.diff).toLocaleString()}</span>
          </div>}
        </div>
        <div style={{marginBottom:6}}>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:13,fontWeight:800,color:C.ink2,marginBottom:6}}>หมายเหตุปิดกะ</div>
          <textarea value={note} onChange={e=>setNote(e.target.value)} rows={2} placeholder="เช่น เงินขาด 50 บาท เพราะจ่ายลูกค้าผิด..." style={{...iS,fontSize:13,resize:"none"}}/>
        </div>
        </>}
      </div>
      <div style={{padding:"12px 22px",borderTop:`1px solid ${C.line}`,background:C.bg,display:"flex",gap:8,flexShrink:0}}>
        <Btn v="ghost" onClick={onClose} s={{padding:"11px 18px"}}>ยกเลิก</Btn>
        <Btn onClick={closeShift} v="danger" loading={saving} disabled={actualCash===""||loading} full icon={I.print} s={{padding:"11px",fontSize:14,fontWeight:800}}>🔚 ปิดกะ & พิมพ์ Z-Report</Btn>
      </div>
    </div>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS SETTINGS PANEL ───────────────────────────────
// ══════════════════════════════════════════════════════
// PromptPay payload generator (anyId QR per Bank of Thailand spec)
function genPromptPayPayload(id,amount){
  if(!id)return"";
  // Sanitize: keep digits only
  const num=String(id).replace(/\D/g,"");
  if(num.length<10)return"";
  let target=num;
  if(num.length===10)target="0066"+num.slice(1);     // 10-digit phone
  else if(num.length===13)target=num;                  // 13-digit citizen ID
  else target=num;
  const tagPP="0016A000000677010111"+(num.length===13?"02"+String(target.length).padStart(2,'0')+target:"01"+String(target.length).padStart(2,'0')+target);
  // Build TLV
  function tlv(tag,val){return tag+String(val.length).padStart(2,'0')+val;}
  let p="";
  p+=tlv("00","01");
  p+=tlv("01",amount?"12":"11");
  p+=tlv("29",tagPP);
  p+=tlv("53","764");
  if(amount)p+=tlv("54",(+amount).toFixed(2));
  p+=tlv("58","TH");
  p+="6304";
  // CRC16 CCITT-FALSE
  let crc=0xFFFF;
  for(let i=0;i<p.length;i++){crc^=p.charCodeAt(i)<<8;for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xFFFF:(crc<<1)&0xFFFF;}
  return p+crc.toString(16).toUpperCase().padStart(4,'0');
}
function POSSettingsPanel({currentBranch}){
  const[settings,setSettings]=useState(null);const[loading,setLoading]=useState(true);const[saving,setSaving]=useState(false);
  async function load(){setLoading(true);try{const s=await api.getPOSSettings(currentBranch.id);setSettings((s&&s[0])||{branch_id:currentBranch.id,vat_enabled:false,vat_rate:7,vat_included:true,service_charge_enabled:false,service_charge_rate:10,promptpay_id:"",promptpay_name:"",show_qr_promptpay:false,receipt_header:"",receipt_footer:""});}catch(e){alert("โหลดไม่สำเร็จ: "+e.message);}setLoading(false);}
  useEffect(()=>{load();},[currentBranch.id]);
  async function save(){
    setSaving(true);
    try{
      const d={...settings,branch_id:currentBranch.id,updated_at:new Date().toISOString()};
      delete d.id;
      const res=await api.upsertPOSSettings(d);
      if(Array.isArray(res)&&res[0])setSettings(res[0]);
      alert("บันทึกการตั้งค่าเรียบร้อย");
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }
  if(loading||!settings)return <Loading text="โหลดการตั้งค่า..."/>;
  function set(k,v){setSettings(s=>({...s,[k]:v}));}
  const qrPreview=settings.show_qr_promptpay&&settings.promptpay_id?genPromptPayPayload(settings.promptpay_id,100):"";
  return <div style={{maxWidth:780}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
      <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900,color:C.ink,margin:0}}>⚙️ ตั้งค่า POS — {currentBranch.name}</h3>
      <Btn onClick={save} icon={I.save} loading={saving} s={{padding:"9px 18px"}}>บันทึก</Btn>
    </div>

    {/* VAT */}
    <Card style={{padding:18,marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink}}>📊 ภาษีมูลค่าเพิ่ม (VAT)</div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>กำหนดอัตราภาษีและวิธีคิด</div>
        </div>
        <label style={{position:"relative",display:"inline-block",width:48,height:26}}>
          <input type="checkbox" checked={!!settings.vat_enabled} onChange={e=>set('vat_enabled',e.target.checked)} style={{opacity:0,width:0,height:0}}/>
          <span style={{position:"absolute",cursor:"pointer",inset:0,background:settings.vat_enabled?C.brand:"#cbd5e1",borderRadius:26,transition:".2s"}}/>
          <span style={{position:"absolute",content:"",height:20,width:20,left:settings.vat_enabled?25:3,top:3,background:C.white,borderRadius:"50%",transition:".2s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
        </label>
      </div>
      {settings.vat_enabled&&<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>อัตรา VAT (%)</div>
          <input type="number" step="0.01" value={settings.vat_rate} onChange={e=>set('vat_rate',+e.target.value)} style={{...iS,fontSize:15,fontWeight:700}}/>
        </div>
        <div>
          <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>วิธีคิด VAT</div>
          <div style={{display:"flex",gap:0,borderRadius:10,overflow:"hidden",border:`1.5px solid ${C.line}`}}>
            {[{v:true,l:"รวมในราคา (Inclusive)"},{v:false,l:"บวกเพิ่ม (Exclusive)"}].map(o=><button key={String(o.v)} onClick={()=>set('vat_included',o.v)} style={{flex:1,padding:"10px 0",border:"none",background:settings.vat_included===o.v?`linear-gradient(135deg,${C.brand},${C.brandDark})`:C.white,color:settings.vat_included===o.v?C.white:C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>{o.l}</button>)}
          </div>
        </div>
      </div>}
    </Card>

    {/* Service Charge */}
    <Card style={{padding:18,marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink}}>💼 Service Charge</div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>ค่าบริการที่จะคิดเพิ่มในบิล</div>
        </div>
        <label style={{position:"relative",display:"inline-block",width:48,height:26}}>
          <input type="checkbox" checked={!!settings.service_charge_enabled} onChange={e=>set('service_charge_enabled',e.target.checked)} style={{opacity:0,width:0,height:0}}/>
          <span style={{position:"absolute",cursor:"pointer",inset:0,background:settings.service_charge_enabled?C.brand:"#cbd5e1",borderRadius:26,transition:".2s"}}/>
          <span style={{position:"absolute",content:"",height:20,width:20,left:settings.service_charge_enabled?25:3,top:3,background:C.white,borderRadius:"50%",transition:".2s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
        </label>
      </div>
      {settings.service_charge_enabled&&<div>
        <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>อัตรา Service Charge (%)</div>
        <input type="number" step="0.01" value={settings.service_charge_rate} onChange={e=>set('service_charge_rate',+e.target.value)} style={{...iS,fontSize:15,fontWeight:700,maxWidth:200}}/>
      </div>}
    </Card>

    {/* PromptPay */}
    <Card style={{padding:18,marginBottom:14}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:12}}>
        <div>
          <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink}}>📱 PromptPay QR</div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginTop:2}}>แสดง QR PromptPay ในใบเสร็จลูกค้าสแกนจ่ายได้เลย</div>
        </div>
        <label style={{position:"relative",display:"inline-block",width:48,height:26}}>
          <input type="checkbox" checked={!!settings.show_qr_promptpay} onChange={e=>set('show_qr_promptpay',e.target.checked)} style={{opacity:0,width:0,height:0}}/>
          <span style={{position:"absolute",cursor:"pointer",inset:0,background:settings.show_qr_promptpay?C.brand:"#cbd5e1",borderRadius:26,transition:".2s"}}/>
          <span style={{position:"absolute",content:"",height:20,width:20,left:settings.show_qr_promptpay?25:3,top:3,background:C.white,borderRadius:"50%",transition:".2s",boxShadow:"0 2px 4px rgba(0,0,0,.2)"}}/>
        </label>
      </div>
      {settings.show_qr_promptpay&&<div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:8}}>
          <div>
            <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>เบอร์โทร / เลขบัตร ปชช</div>
            <input value={settings.promptpay_id||""} onChange={e=>set('promptpay_id',e.target.value)} placeholder="0812345678 หรือ 1234567890123" style={{...iS,fontSize:14,fontFamily:"monospace",letterSpacing:.5}}/>
          </div>
          <div>
            <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>ชื่อบัญชี (แสดงในใบเสร็จ)</div>
            <input value={settings.promptpay_name||""} onChange={e=>set('promptpay_name',e.target.value)} placeholder="เช่น ร้านในวันสุก" style={{...iS,fontSize:14}}/>
          </div>
        </div>
        {qrPreview&&<div style={{background:C.bg,borderRadius:10,padding:12,display:"flex",alignItems:"center",gap:14}}>
          <QRImg url={qrPreview} size={100}/>
          <div style={{fontSize:12,color:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>
            <div style={{fontWeight:700,color:C.green,marginBottom:3}}>✅ QR ใช้งานได้</div>
            <div>QR ตัวอย่าง (จำลองยอด ฿100)</div>
            <div style={{fontSize:11,marginTop:3,color:C.ink4}}>QR จริงในใบเสร็จจะถูกสร้างตามยอดบิลแต่ละครั้ง</div>
          </div>
        </div>}
        {!qrPreview&&settings.promptpay_id&&<div style={{background:C.redLight,borderRadius:10,padding:10,fontSize:12,color:C.red,fontFamily:"'Sarabun',sans-serif"}}>⚠️ เบอร์/เลขบัตรไม่ถูกต้อง (ต้อง 10 หรือ 13 หลัก)</div>}
      </div>}
    </Card>

    {/* Receipt header/footer */}
    <Card style={{padding:18}}>
      <div style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink,marginBottom:12}}>🧾 ข้อความใบเสร็จ</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <div>
          <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>หัวใบเสร็จ (Header)</div>
          <textarea rows={3} value={settings.receipt_header||""} onChange={e=>set('receipt_header',e.target.value)} placeholder="เช่น ที่อยู่ร้าน, เลขผู้เสียภาษี" style={{...iS,fontSize:13,resize:"none",lineHeight:1.5}}/>
        </div>
        <div>
          <div style={{fontSize:12,color:C.ink2,fontWeight:700,marginBottom:5,fontFamily:"'Sarabun',sans-serif"}}>ท้ายใบเสร็จ (Footer)</div>
          <textarea rows={3} value={settings.receipt_footer||""} onChange={e=>set('receipt_footer',e.target.value)} placeholder="เช่น ขอบคุณที่ใช้บริการ, FB/Line ID" style={{...iS,fontSize:13,resize:"none",lineHeight:1.5}}/>
        </div>
      </div>
    </Card>
  </div>;
}

// ══════════════════════════════════════════════════════
// ── PROMOTION MANAGER ────────────────────────────────
// ══════════════════════════════════════════════════════
const WEEKDAYS=["อา","จ","อ","พ","พฤ","ศ","ส"];
function POSPromotionManager({currentBranch,menus}){
  const[promos,setPromos]=useState([]);const[loading,setLoading]=useState(true);
  const[showForm,setShowForm]=useState(false);const[editId,setEditId]=useState(null);const[saving,setSaving]=useState(false);
  const F0={name:"",description:"",type:"percent",discount_value:10,scope:"bill",scope_value:"",min_order:0,max_discount:"",start_date:"",end_date:"",start_time:"",end_time:"",weekdays:"",active:true};
  const[F,setF]=useState(F0);
  async function load(){setLoading(true);try{const p=await api.getPromotions(currentBranch.id);setPromos(p);}catch(e){alert("โหลดไม่สำเร็จ: "+e.message);}setLoading(false);}
  useEffect(()=>{load();},[currentBranch.id]);
  const cats=useMemo(()=>[...new Set(menus.map(m=>m.category))],[menus]);
  async function save(){
    if(!F.name.trim()||!F.discount_value)return;
    setSaving(true);
    try{
      const d={...F,branch_id:currentBranch.id,discount_value:+F.discount_value,min_order:+F.min_order||0,max_discount:F.max_discount?+F.max_discount:null,start_date:F.start_date||null,end_date:F.end_date||null,start_time:F.start_time||null,end_time:F.end_time||null,weekdays:F.weekdays||null,scope_value:F.scope==="bill"?null:F.scope_value};
      if(editId)await api.updatePromotion(editId,d);else await api.addPromotion(d);
      setF(F0);setEditId(null);setShowForm(false);await load();
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setSaving(false);
  }
  async function del(p){if(!await confirmDlg({title:"ลบโปรโมชั่น",message:`ต้องการลบ "${p.name}"?`,danger:true}))return;try{await api.deletePromotion(p.id);await load();}catch{alert("ลบไม่สำเร็จ");}}
  function startEdit(p){setF({name:p.name||"",description:p.description||"",type:p.type,discount_value:p.discount_value,scope:p.scope,scope_value:p.scope_value||"",min_order:p.min_order||0,max_discount:p.max_discount||"",start_date:p.start_date||"",end_date:p.end_date||"",start_time:p.start_time||"",end_time:p.end_time||"",weekdays:p.weekdays||"",active:p.active});setEditId(p.id);setShowForm(true);}
  async function toggle(p){try{await api.updatePromotion(p.id,{active:!p.active});await load();}catch{alert("ปรับสถานะไม่สำเร็จ");}}
  function toggleWeekday(d){const arr=(F.weekdays||"").split(",").filter(Boolean);const s=String(d);const next=arr.includes(s)?arr.filter(x=>x!==s):[...arr,s];setF(f=>({...f,weekdays:next.sort().join(",")}));}
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900,color:C.ink,margin:0}}>🎁 โปรโมชั่น ({promos.length})</h3>
      <Btn onClick={()=>{setF(F0);setEditId(null);setShowForm(true);}} icon={I.plus} s={{padding:"8px 16px"}}>เพิ่มโปรโมชั่น</Btn>
    </div>
    {loading?<Loading text="โหลด..."/>:<>
      {promos.length===0&&!showForm&&<div style={{textAlign:"center",padding:50,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}><Ic d={I.tag} s={42} c={C.line}/><p style={{marginTop:10}}>ยังไม่มีโปรโมชั่น</p></div>}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
        {promos.map(p=>{
          const typeL={percent:"ส่วนลด %",amount:"ส่วนลด ฿",fixed_price:"ราคาพิเศษ"}[p.type]||p.type;
          const valL=p.type==="percent"?`${p.discount_value}%`:`฿${p.discount_value}`;
          return <Card key={p.id} style={{padding:0,overflow:"hidden",opacity:p.active?1:.5}}>
            <div style={{padding:"10px 14px",background:p.active?`linear-gradient(135deg,${C.brand}11,${C.brandLight})`:C.bg,borderBottom:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1,minWidth:0}}>
                <div style={{fontFamily:"'Sarabun',sans-serif",fontWeight:800,fontSize:14,color:C.ink,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{p.name}</div>
                <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{typeL} · <b style={{color:C.brand}}>{valL}</b></div>
              </div>
              <div style={{display:"flex",gap:4}}>
                <button onClick={()=>toggle(p)} title={p.active?"ปิด":"เปิด"} style={{background:p.active?C.greenLight:C.lineLight,border:"none",borderRadius:7,padding:"5px 9px",cursor:"pointer",fontSize:11,fontWeight:700,color:p.active?C.green:C.ink3,fontFamily:"'Sarabun',sans-serif"}}>{p.active?"ON":"OFF"}</button>
                <button onClick={()=>startEdit(p)} style={{background:C.blueLight,border:"none",borderRadius:7,padding:"5px 7px",cursor:"pointer",display:"flex"}}><Ic d={I.pencil} s={12} c={C.blue}/></button>
                <button onClick={()=>del(p)} style={{background:C.redLight,border:"none",borderRadius:7,padding:"5px 7px",cursor:"pointer",display:"flex"}}><Ic d={I.trash} s={12} c={C.red}/></button>
              </div>
            </div>
            <div style={{padding:"10px 14px",fontSize:12,color:C.ink2,fontFamily:"'Sarabun',sans-serif",lineHeight:1.7}}>
              {p.description&&<div style={{marginBottom:4}}>{p.description}</div>}
              <div>📍 {p.scope==="bill"?"ทั้งบิล":p.scope==="category"?`หมวด: ${p.scope_value}`:`เมนู: ${menus.find(m=>m.id==p.scope_value)?.name||p.scope_value}`}</div>
              {p.min_order>0&&<div>💵 ขั้นต่ำ ฿{p.min_order}</div>}
              {(p.start_date||p.end_date)&&<div>📅 {p.start_date||"—"} ถึง {p.end_date||"—"}</div>}
              {(p.start_time||p.end_time)&&<div>🕐 {p.start_time||"00:00"} - {p.end_time||"23:59"}</div>}
              {p.weekdays&&<div>📆 {p.weekdays.split(",").map(d=>WEEKDAYS[+d]).join(", ")}</div>}
            </div>
          </Card>;
        })}
      </div>
    </>}
    {showForm&&<Modal title={editId?"✏️ แก้ไขโปรโมชั่น":"➕ เพิ่มโปรโมชั่น"} onClose={()=>{setShowForm(false);setEditId(null);setF(F0);}} wide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Inp label="ชื่อโปรโมชั่น *" value={F.name} onChange={e=>setF(f=>({...f,name:e.target.value}))} placeholder="เช่น ส่วนลด Happy Hour"/>
        <Inp label="คำอธิบาย" value={F.description} onChange={e=>setF(f=>({...f,description:e.target.value}))} placeholder="รายละเอียดเพิ่มเติม"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        <Field label="ประเภท">
          <select value={F.type} onChange={e=>setF(f=>({...f,type:e.target.value}))} style={{...iS,appearance:"none"}}>
            <option value="percent">ส่วนลด %</option>
            <option value="amount">ส่วนลด ฿ (จำนวนเงิน)</option>
            <option value="fixed_price">ราคาพิเศษ ฿ (set ราคา)</option>
          </select>
        </Field>
        <Inp label={F.type==="percent"?"% ส่วนลด *":"จำนวน ฿ *"} type="number" value={F.discount_value} onChange={e=>setF(f=>({...f,discount_value:e.target.value}))}/>
        <Inp label="เพดานส่วนลด ฿ (สำหรับ %)" type="number" value={F.max_discount} onChange={e=>setF(f=>({...f,max_discount:e.target.value}))} placeholder="ไม่จำกัด"/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 2fr",gap:12}}>
        <Field label="ใช้กับ">
          <select value={F.scope} onChange={e=>setF(f=>({...f,scope:e.target.value,scope_value:""}))} style={{...iS,appearance:"none"}}>
            <option value="bill">ทั้งบิล</option>
            <option value="category">หมวดเมนู</option>
            <option value="menu">เมนูเฉพาะ</option>
          </select>
        </Field>
        {F.scope==="category"&&<Field label="หมวด"><select value={F.scope_value} onChange={e=>setF(f=>({...f,scope_value:e.target.value}))} style={{...iS,appearance:"none"}}><option value="">— เลือกหมวด —</option>{cats.map(c=><option key={c} value={c}>{c}</option>)}</select></Field>}
        {F.scope==="menu"&&<Field label="เมนู"><select value={F.scope_value} onChange={e=>setF(f=>({...f,scope_value:e.target.value}))} style={{...iS,appearance:"none"}}><option value="">— เลือกเมนู —</option>{menus.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></Field>}
        {F.scope==="bill"&&<Inp label="ยอดขั้นต่ำ ฿" type="number" value={F.min_order} onChange={e=>setF(f=>({...f,min_order:e.target.value}))}/>}
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:12}}>
        <Inp label="เริ่ม (วันที่)" type="date" value={F.start_date} onChange={e=>setF(f=>({...f,start_date:e.target.value}))}/>
        <Inp label="สิ้นสุด (วันที่)" type="date" value={F.end_date} onChange={e=>setF(f=>({...f,end_date:e.target.value}))}/>
        <Inp label="เริ่ม (เวลา)" type="time" value={F.start_time} onChange={e=>setF(f=>({...f,start_time:e.target.value}))}/>
        <Inp label="สิ้นสุด (เวลา)" type="time" value={F.end_time} onChange={e=>setF(f=>({...f,end_time:e.target.value}))}/>
      </div>
      <Field label={`เฉพาะวัน (เลือกได้หลายวัน) — ${F.weekdays?F.weekdays.split(",").map(d=>WEEKDAYS[+d]).join(", "):"ทุกวัน"}`}>
        <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>
          {WEEKDAYS.map((w,d)=>{const sel=(F.weekdays||"").split(",").includes(String(d));return <button key={d} onClick={()=>toggleWeekday(d)} style={{padding:"7px 14px",borderRadius:8,border:`2px solid ${sel?C.brand:C.line}`,background:sel?C.brandLight:C.white,color:sel?C.brand:C.ink3,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontWeight:700,fontSize:12}}>{w}</button>;})}
          {F.weekdays&&<button onClick={()=>setF(f=>({...f,weekdays:""}))} style={{padding:"7px 12px",borderRadius:8,border:"none",background:"transparent",color:C.ink4,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12}}>ล้าง</button>}
        </div>
      </Field>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,paddingTop:14,borderTop:`1px solid ${C.line}`,marginTop:8}}>
        <Btn v="ghost" onClick={()=>{setShowForm(false);setEditId(null);setF(F0);}}>ยกเลิก</Btn>
        <Btn onClick={save} loading={saving} disabled={!F.name.trim()||!F.discount_value} icon={I.check}>{editId?"บันทึก":"เพิ่มโปรโมชั่น"}</Btn>
      </div>
    </Modal>}
  </div>;
}

// Find applicable promotions for a given context
function evalPromotions(promos,context){
  const{subtotal,items,now=new Date()}=context;
  const dow=now.getDay();
  const hhmm=`${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
  const ymd=now.toLocaleDateString("en-CA",{timeZone:"Asia/Bangkok"});
  return (promos||[]).filter(p=>{
    if(!p.active)return false;
    if(p.start_date&&ymd<p.start_date)return false;
    if(p.end_date&&ymd>p.end_date)return false;
    // Time window: support overnight wrap (e.g. 22:00-02:00)
    if(p.start_time||p.end_time){
      const st=p.start_time?p.start_time.slice(0,5):"00:00";
      const et=p.end_time?p.end_time.slice(0,5):"23:59";
      const inWindow=st<=et?(hhmm>=st&&hhmm<=et):(hhmm>=st||hhmm<=et);
      if(!inWindow)return false;
    }
    if(p.weekdays&&p.weekdays.split(",").filter(Boolean).length>0&&!p.weekdays.split(",").includes(String(dow)))return false;
    if(p.scope==="bill"&&(+p.min_order||0)>subtotal)return false;
    if(p.scope==="category"){
      if(!p.scope_value)return false;
      if(!items.some(i=>{const m=context.menusById?.[i.menu_id];return m&&m.category===p.scope_value;}))return false;
    }
    if(p.scope==="menu"){
      if(!p.scope_value)return false;
      if(!items.some(i=>String(i.menu_id)===String(p.scope_value)))return false;
    }
    // For fixed_price ("set price"), require the relevant total to exceed the target,
    // otherwise the discount would be 0 and the promo is misleading.
    if(p.type==="fixed_price"){
      const fp=+p.discount_value||0;
      if(p.scope==="bill"){
        if(subtotal<=fp)return false;
      }else{
        let scopeTotal=0;
        items.forEach(i=>{const m=context.menusById?.[i.menu_id];const include=p.scope==="category"?(m&&m.category===p.scope_value):String(i.menu_id)===String(p.scope_value);if(include)scopeTotal+=i.price*i.qty;});
        if(scopeTotal<=fp)return false;
      }
    }
    return true;
  });
}
function calcPromoDiscount(promo,context){
  const{subtotal,items,menusById}=context;
  if(promo.scope==="bill"){
    let amt=promo.type==="percent"?subtotal*(+promo.discount_value)/100:promo.type==="amount"?+promo.discount_value:Math.max(0,subtotal-(+promo.discount_value));
    if(promo.max_discount&&amt>+promo.max_discount)amt=+promo.max_discount;
    return Math.min(amt,subtotal);
  }
  // category or menu scope
  let scopeTotal=0;
  items.forEach(i=>{
    const m=menusById?.[i.menu_id];const include=promo.scope==="category"?(m&&m.category===promo.scope_value):String(i.menu_id)===String(promo.scope_value);
    if(include)scopeTotal+=i.price*i.qty;
  });
  let amt=promo.type==="percent"?scopeTotal*(+promo.discount_value)/100:promo.type==="amount"?+promo.discount_value:Math.max(0,scopeTotal-(+promo.discount_value));
  if(promo.max_discount&&amt>+promo.max_discount)amt=+promo.max_discount;
  return Math.min(amt,scopeTotal);
}

// ══════════════════════════════════════════════════════
// ── POS BACK OFFICE (หลังบ้าน) ─────────────────────────
// ══════════════════════════════════════════════════════
function POSBackOffice({currentBranch,currentUser,printers,reloadPrinters,branches,zones=[],reloadZones,menus=[],onExit}){
  const[section,setSection]=useState("tables");
  const[tables,setTables]=useState([]);const[loadingT,setLoadingT]=useState(true);
  const[shifts,setShifts]=useState([]);const[loadingS,setLoadingS]=useState(false);
  async function loadTables(){setLoadingT(true);try{const t=await api.getPOSTables(currentBranch.id);setTables(t);}catch{}setLoadingT(false);}
  async function loadShifts(){setLoadingS(true);try{const s=await api.getShifts(currentBranch.id,30);setShifts(s);}catch{}setLoadingS(false);}
  useEffect(()=>{loadTables();},[]);
  useEffect(()=>{if(section==="shifts")loadShifts();},[section]);
  const SECS=[
    {id:"tables",l:"ผังโต๊ะ",icon:I.table,c:C.brand},
    {id:"printers",l:"เครื่องพิมพ์",icon:I.print,c:C.purple},
    {id:"settings",l:"ตั้งค่า POS",icon:I.settings,c:C.green},
    {id:"promotions",l:"โปรโมชั่น",icon:I.tag,c:C.yellow},
    {id:"shifts",l:"ประวัติกะ",icon:I.clock,c:C.blue},
  ];
  return <div style={{margin:"-20px -24px",display:"flex",flexDirection:"column",height:"calc(100vh - 150px)"}}>
    <div style={{padding:"0 16px",background:"linear-gradient(135deg,#0F172A,#1E293B)",borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",height:54,gap:2,flexShrink:0}}>
      <button onClick={onExit} style={{background:"rgba(255,255,255,0.1)",border:"none",color:C.white,padding:"7px 14px",borderRadius:9,cursor:"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,marginRight:14,display:"flex",alignItems:"center",gap:6}}>← กลับ</button>
      <div style={{color:C.white,fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:900,marginRight:24}}>⚙️ จัดการหลังบ้าน</div>
      {SECS.map(s=>{const active=section===s.id;return <button key={s.id} onClick={()=>setSection(s.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"0 14px",height:54,border:"none",background:active?"rgba(255,255,255,0.1)":"transparent",cursor:"pointer",fontSize:13,fontWeight:active?800:600,color:active?C.white:"rgba(255,255,255,0.5)",fontFamily:"'Sarabun',sans-serif",borderBottom:active?`3px solid ${s.c}`:"3px solid transparent",transition:"all .15s"}}><Ic d={s.icon} s={14} c={active?s.c:"rgba(255,255,255,0.5)"}/>{s.l}</button>;})}
    </div>
    <div style={{flex:1,overflow:"auto",padding:"20px 24px",background:C.bg}}>
      {section==="tables"&&(loadingT?<Loading text="โหลดโต๊ะ..."/>:<POSTableManage tables={tables} branch={currentBranch} zones={zones} reloadZones={reloadZones} onDone={loadTables}/>)}
      {section==="printers"&&<POSPrinterPanel printers={printers} reloadPrinters={reloadPrinters} branches={branches} currentUser={currentUser} menus={menus}/>}
      {section==="settings"&&<POSSettingsPanel currentBranch={currentBranch}/>}
      {section==="promotions"&&<POSPromotionManager currentBranch={currentBranch} menus={menus}/>}
      {section==="shifts"&&<POSShiftHistory shifts={shifts} loading={loadingS} reload={loadShifts}/>}
    </div>
  </div>;
}

function POSShiftHistory({shifts,loading,reload}){
  if(loading)return <Loading text="โหลดประวัติกะ..."/>;
  if(shifts.length===0)return <div style={{textAlign:"center",padding:60,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}><Ic d={I.clock} s={48} c={C.line}/><p style={{marginTop:12}}>ยังไม่มีประวัติกะ</p></div>;
  return <div>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
      <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:18,fontWeight:900,color:C.ink,margin:0}}>ประวัติกะ ({shifts.length})</h3>
      <Btn v="ghost" onClick={reload} icon={I.refresh} s={{padding:"7px 14px",fontSize:12}}>รีเฟรช</Btn>
    </div>
    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:12}}>
      {shifts.map(s=>{
        const isOpen=s.status==='open';
        return <Card key={s.id} style={{padding:0,overflow:"hidden"}}>
          <div style={{padding:"10px 14px",background:isOpen?C.greenLight:C.bg,borderBottom:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontFamily:"'Sarabun',sans-serif",fontWeight:800,fontSize:14,color:C.ink}}>กะ #{s.id}</div>
            <Chip color={isOpen?"green":"gray"}>{isOpen?"เปิดอยู่":"ปิดแล้ว"}</Chip>
          </div>
          <div style={{padding:"12px 14px",fontFamily:"'Sarabun',sans-serif",fontSize:12,color:C.ink2,lineHeight:1.7}}>
            <div>👤 {s.username||'-'}</div>
            <div>🕐 เปิด: {new Date(s.opened_at).toLocaleString("th-TH")}</div>
            {s.closed_at&&<div>🕔 ปิด: {new Date(s.closed_at).toLocaleString("th-TH")}</div>}
            <div style={{marginTop:8,paddingTop:8,borderTop:`1px dashed ${C.line}`,display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,fontSize:12}}>
              <div>เริ่มต้น: <b>฿{(+s.opening_cash||0).toLocaleString()}</b></div>
              <div>บิล: <b>{s.order_count||0}</b></div>
              <div>ขาย: <b style={{color:C.brand}}>฿{(+s.total_sales||0).toLocaleString()}</b></div>
              <div>เงินสด: <b style={{color:C.green}}>฿{(+s.total_cash||0).toLocaleString()}</b></div>
              {!isOpen&&<>
                <div>ปิดที่: <b>฿{(+s.closing_cash||0).toLocaleString()}</b></div>
                <div>ส่วนต่าง: <b style={{color:s.cash_diff===0?C.green:s.cash_diff>0?C.blue:C.red}}>{s.cash_diff>0?'+':''}฿{Math.abs(+s.cash_diff||0).toLocaleString()}</b></div>
              </>}
            </div>
            {s.notes&&<div style={{marginTop:8,padding:"6px 10px",background:C.yellowLight,borderRadius:7,fontSize:11,color:C.ink3}}>📝 {s.notes}</div>}
          </div>
        </Card>;
      })}
    </div>
  </div>;
}

// Printer panel (extracted from SettingsTab for back-office)
function POSPrinterPanel({printers,reloadPrinters,branches,currentUser,menus=[]}){
  const isAdmin=hasPerm(currentUser,"settings");
  const pF0={name:"",ip:"",port:9100,description:"",type:"kitchen",branch_id:null,active:true,conn:"ip",btName:""};
  const[pForm,setPForm]=useState(pF0);const[editPID,setEditPID]=useState(null);const[pSaving,setPSaving]=useState(false);
  const[testResults,setTestResults]=useState({});const[btScanning,setBtScanning]=useState(false);
  // Category routing state
  const[catEditP,setCatEditP]=useState(null);  // printer object being edited
  const[catSel,setCatSel]=useState(null);       // null=catch-all, [] or [names]=specific
  const[catMenuOverride,setCatMenuOverride]=useState({});  // menu_id → assigned printer_id (for override view)
  const[catSaving,setCatSaving]=useState(false);
  const allCategories=useMemo(()=>[...new Set(menus.map(m=>m.category).filter(Boolean))].sort(),[menus]);
  function openCatEdit(p){
    setCatEditP(p);
    setCatSel(p.categories===undefined||p.categories===null?null:[...p.categories]);
    // Build menu→printer override map for the menus visible
    const ov={};menus.forEach(m=>{if(m.printer_id)ov[m.id]=+m.printer_id;});
    setCatMenuOverride(ov);
  }
  async function saveCatEdit(){
    if(!catEditP)return;
    setCatSaving(true);
    try{
      await api.updatePrinter(catEditP.id,{categories:catSel});
      // Save menu-level overrides
      const updates=[];
      menus.forEach(m=>{const newPid=catMenuOverride[m.id]||null;const oldPid=m.printer_id||null;if(String(newPid)!==String(oldPid))updates.push(api.updateMenu(m.id,{printer_id:newPid}));});
      await Promise.all(updates);
      await reloadPrinters();
      setCatEditP(null);
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setCatSaving(false);
  }
  function toggleCat(c){
    setCatSel(prev=>{
      const cur=prev===null?allCategories.slice():prev;
      return cur.includes(c)?cur.filter(x=>x!==c):[...cur,c];
    });
  }
  async function testPrinter(p){
    const conn=getPConn(p);
    setTestResults(r=>({...r,[p.id]:{status:"testing"}}));
    if(conn.type==="bluetooth"){
      try{
        if(!navigator.bluetooth)throw new Error("เบราว์เซอร์ไม่รองรับ Bluetooth");
        const device=await navigator.bluetooth.requestDevice({filters:conn.btName?[{name:conn.btName}]:undefined,acceptAllDevices:!conn.btName,optionalServices:_BT_SVC});
        const server=await device.gatt.connect();await server.getPrimaryServices();device.gatt.disconnect();
        setTestResults(r=>({...r,[p.id]:{status:"ok",msg:"เชื่อมต่อ Bluetooth สำเร็จ: "+device.name}}));
      }catch(e){setTestResults(r=>({...r,[p.id]:{status:"fail",msg:e.message}}));}
      return;
    }
    // IP/Network printer: POST a real ESC-POS test page.
    // Raw thermal printers at port 9100 don't speak HTTP, so we treat AbortError after timeout
    // as success (TCP connection was accepted, bytes sent, printer printed but never replied).
    // Only TypeError "Failed to fetch" (immediate refused) is a true failure.
    const enc=new TextEncoder();
    const concat=arrs=>{const len=arrs.reduce((a,b)=>a+b.length,0);const out=new Uint8Array(len);let off=0;for(const a of arrs){out.set(a,off);off+=a.length;}return out;};
    const body=concat([
      new Uint8Array([0x1B,0x40]),                // ESC @  init
      new Uint8Array([0x1B,0x61,0x01]),           // center
      new Uint8Array([0x1B,0x21,0x30]),           // double height/width
      enc.encode("PRINTER TEST\n"),
      new Uint8Array([0x1B,0x21,0x00]),           // normal
      enc.encode("FOODCOST POS\n"),
      enc.encode((p.name||"")+"\n"),
      enc.encode(new Date().toISOString().replace("T"," ").slice(0,19)+"\n"),
      enc.encode("--------------------------------\n"),
      new Uint8Array([0x1B,0x45,0x01]),           // bold on
      enc.encode("Connection OK\n"),
      new Uint8Array([0x1B,0x45,0x00]),           // bold off
      new Uint8Array([0x0A,0x0A,0x0A,0x0A]),      // feed
      new Uint8Array([0x1D,0x56,0x42,0x00]),      // partial cut
    ]);
    const ctrl=new AbortController();const tid=setTimeout(()=>ctrl.abort(),5000);
    let connectedFast=false;
    const startedAt=Date.now();
    try{
      await fetch(`http://${p.ip}:${p.port||9100}/`,{method:"POST",mode:"no-cors",cache:"no-store",headers:{"Content-Type":"application/octet-stream"},body,signal:ctrl.signal});
      clearTimeout(tid);
      setTestResults(r=>({...r,[p.id]:{status:"ok",msg:"ส่งคำสั่งพิมพ์ทดสอบแล้ว — ตรวจที่เครื่องว่ามีกระดาษออกมาไหม"}}));
    }catch(e){
      clearTimeout(tid);
      const elapsed=Date.now()-startedAt;
      if(e.name==="AbortError"){
        // 5s timeout reached — TCP almost certainly accepted the connection (raw printer doesn't HTTP-reply)
        setTestResults(r=>({...r,[p.id]:{status:"ok",msg:"✅ ส่งคำสั่งพิมพ์แล้ว (เครื่องไม่ตอบ HTTP เป็นเรื่องปกติ) — ดูที่เครื่องว่ามีกระดาษออกมาไหม"}}));
      }else if(elapsed<300){
        // Quick TypeError = network refused
        setTestResults(r=>({...r,[p.id]:{status:"fail",msg:"เชื่อมต่อไม่ได้ — ตรวจ IP/Port หรือไฟเครื่องพิมพ์"}}));
      }else{
        setTestResults(r=>({...r,[p.id]:{status:"ok",msg:"ส่งคำสั่งไปแล้ว — ดูที่เครื่อง"}}));
      }
    }
  }
  async function scanBTPrinter(all=false){
    if(!navigator.bluetooth){alert("เบราว์เซอร์ไม่รองรับ Bluetooth ต้องใช้ Chrome/Edge");return;}
    setBtScanning(true);
    try{
      const opts=all?{acceptAllDevices:true,optionalServices:_BT_SVC}:{filters:[{namePrefix:"XP-"},{namePrefix:"Xprinter"},{namePrefix:"MTP"},{namePrefix:"MPT"},{namePrefix:"RPP"},{namePrefix:"BT Printer"},{namePrefix:"BT-Printer"},{namePrefix:"Printer"},{namePrefix:"POS"},{namePrefix:"Thermal"},{namePrefix:"SPP"},{namePrefix:"GP-"},{namePrefix:"Gprinter"},{namePrefix:"PT-"},{namePrefix:"MP-"},{namePrefix:"P80"},{namePrefix:"P58"},{namePrefix:"HOIN"},{namePrefix:"Goojprt"},{namePrefix:"GOOJPRT"},{namePrefix:"BlueTooth"},{namePrefix:"HC-"},{namePrefix:"ESC"},{namePrefix:"TP"},..._BT_SVC.map(s=>({services:[s]}))],optionalServices:_BT_SVC};
      const device=await navigator.bluetooth.requestDevice(opts);
      setPForm(f=>({...f,btName:device.name||"",conn:"bluetooth"}));
    }catch(e){
      if(e.name==="NotFoundError"&&!all){if(await confirmDlg({title:"ไม่พบเครื่องปริ้น",message:"ไม่พบอุปกรณ์ที่ตรงกับชื่อเครื่องปริ้น\nต้องการแสดงอุปกรณ์ Bluetooth ทั้งหมดไหม?",confirmLabel:"แสดงทั้งหมด",danger:false})){setBtScanning(false);scanBTPrinter(true);return;}}
      else if(e.name!=="NotFoundError"&&e.name!=="NotAllowedError")alert("เกิดข้อผิดพลาด: "+e.message);
    }
    setBtScanning(false);
  }
  async function savePrinter(){
    const isBT=pForm.conn==="bluetooth";
    if(!pForm.name||(isBT?!pForm.btName:!pForm.ip))return;
    setPSaving(true);
    try{
      const d={name:pForm.name,ip:isBT?"bluetooth":pForm.ip,port:isBT?0:+pForm.port||9100,type:pForm.type,branch_id:pForm.branch_id||null,active:true,description:isBT?JSON.stringify({c:"bt",n:pForm.btName}):pForm.description};
      if(editPID)await api.updatePrinter(editPID,d);else await api.addPrinter(d);
      await reloadPrinters();setPForm(pF0);setEditPID(null);
    }catch(e){alert("บันทึกไม่สำเร็จ: "+e.message);}
    setPSaving(false);
  }
  return <div>
    <div style={{background:"linear-gradient(135deg,#0F172A 0%,#1E293B 100%)",borderRadius:16,padding:"22px 26px",marginBottom:20,display:"flex",alignItems:"center",justifyContent:"space-between",boxShadow:"0 4px 24px rgba(15,23,42,0.18)"}}>
      <div style={{display:"flex",alignItems:"center",gap:14}}>
        <div style={{width:48,height:48,background:"linear-gradient(135deg,#6366F1,#8B5CF6)",borderRadius:14,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={I.print} s={22} c="#fff" sw={1.5}/></div>
        <div>
          <h2 style={{fontFamily:"'Sarabun',sans-serif",fontSize:20,fontWeight:900,color:"#F8FAFC",margin:0}}>เครื่องพิมพ์</h2>
          <p style={{fontSize:12,color:"rgba(255,255,255,0.45)",margin:"3px 0 0",fontFamily:"'Sarabun',sans-serif"}}>Network/Bluetooth Printer — Xprinter / ESC-POS 80mm</p>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        {[{label:"ทั้งหมด",count:printers.length,color:"#6366F1"},{label:"ครัว",count:printers.filter(p=>p.type==="kitchen").length,color:"#F59E0B"},{label:"บาร์",count:printers.filter(p=>p.type==="bar").length,color:"#10B981"},{label:"แคชเชียร์",count:printers.filter(p=>p.type==="receipt").length,color:"#3B82F6"}].map(s=><div key={s.label} style={{textAlign:"center",background:"rgba(255,255,255,0.07)",borderRadius:10,padding:"7px 14px",border:"1px solid rgba(255,255,255,0.1)"}}>
          <div style={{fontSize:18,fontWeight:900,color:s.color,lineHeight:1}}>{s.count}</div>
          <div style={{fontSize:10,color:"rgba(255,255,255,0.45)",fontFamily:"'Sarabun',sans-serif",marginTop:2}}>{s.label}</div>
        </div>)}
      </div>
    </div>
    {isAdmin&&<div style={{background:C.white,borderRadius:14,border:`1px solid ${C.line}`,marginBottom:20,overflow:"hidden",boxShadow:"0 2px 12px rgba(0,0,0,0.05)"}}>
      <div style={{padding:"14px 22px",borderBottom:`1px solid ${C.line}`,background:editPID?"#FFF7ED":"#F8FAFF",display:"flex",alignItems:"center",gap:10}}>
        <div style={{width:28,height:28,background:editPID?"#F59E0B22":"#6366F122",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center"}}><Ic d={editPID?I.pencil:I.plus} s={13} c={editPID?"#F59E0B":"#6366F1"}/></div>
        <span style={{fontFamily:"'Sarabun',sans-serif",fontSize:14,fontWeight:800,color:C.ink}}>{editPID?"แก้ไขเครื่องพิมพ์":"เพิ่มเครื่องพิมพ์ใหม่"}</span>
        {editPID&&<Chip color="yellow">กำลังแก้ไข</Chip>}
      </div>
      <div style={{padding:"18px 22px"}}>
        <div style={{display:"grid",gridTemplateColumns:"2fr 1.4fr 1fr 1fr",gap:12,marginBottom:12}}>
          <Inp label="ชื่อเครื่องพิมพ์ *" value={pForm.name} onChange={e=>setPForm(f=>({...f,name:e.target.value}))} placeholder="เช่น ครัวหลัก, บาร์"/>
          <div>
            <label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ประเภทการเชื่อมต่อ</label>
            <div style={{display:"flex",gap:0,borderRadius:10,overflow:"hidden",border:`1.5px solid ${C.line}`}}>
              {[{v:"ip",label:"🌐 IP"},{v:"bluetooth",label:"📶 BT"}].map(o=><button key={o.v} onClick={()=>setPForm(f=>({...f,conn:o.v}))} style={{flex:1,padding:"9px 0",border:"none",background:pForm.conn===o.v?`linear-gradient(135deg,${C.brand},${C.brandDark})`:C.white,color:pForm.conn===o.v?C.white:C.ink3,fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,cursor:"pointer"}}>{o.label}</button>)}
            </div>
          </div>
          <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>ประเภท</label><select value={pForm.type} onChange={e=>setPForm(f=>({...f,type:e.target.value}))} style={{...iS,appearance:"none"}}><option value="kitchen">🍳 ครัว</option><option value="bar">🍹 บาร์</option><option value="receipt">🧾 แคชเชียร์</option><option value="other">📄 อื่นๆ</option></select></div>
          <div><label style={{display:"block",fontSize:13,fontWeight:600,color:C.ink2,marginBottom:6,fontFamily:"'Sarabun',sans-serif"}}>สาขา</label><select value={pForm.branch_id||""} onChange={e=>setPForm(f=>({...f,branch_id:e.target.value?+e.target.value:null}))} style={{...iS,appearance:"none"}}><option value="">ทุกสาขา</option>{(branches||[]).map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select></div>
        </div>
        {pForm.conn==="ip"?<div style={{display:"grid",gridTemplateColumns:"1fr auto auto",gap:12,marginBottom:12,alignItems:"flex-end"}}>
          <Inp label="IP Address *" value={pForm.ip} onChange={e=>setPForm(f=>({...f,ip:e.target.value}))} placeholder="192.168.1.100"/>
          <Inp label="Port" type="number" value={pForm.port} onChange={e=>setPForm(f=>({...f,port:+e.target.value}))} placeholder="9100" style={{width:90}}/>
          <Inp label="หมายเหตุ" value={pForm.description} onChange={e=>setPForm(f=>({...f,description:e.target.value}))} placeholder="ครัวหลัก..."/>
        </div>:<div style={{marginBottom:12,background:C.bg,borderRadius:10,padding:"14px 16px",border:`1.5px dashed ${C.brand}44`}}>
          <div style={{fontSize:12,fontWeight:700,color:C.ink3,marginBottom:8,fontFamily:"'Sarabun',sans-serif"}}>อุปกรณ์ Bluetooth</div>
          {pForm.btName?<div style={{display:"flex",alignItems:"center",gap:10,marginBottom:8}}>
            <div style={{width:34,height:34,background:C.brandLight,borderRadius:9,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17}}>📶</div>
            <div><div style={{fontWeight:800,fontSize:13,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>{pForm.btName}</div><div style={{fontSize:11,color:C.green,fontWeight:600}}>✅ จับคู่แล้ว</div></div>
            <button onClick={()=>setPForm(f=>({...f,btName:""}))} style={{marginLeft:"auto",background:C.redLight,border:"none",borderRadius:7,padding:"4px 9px",cursor:"pointer",color:C.red,fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ล้าง</button>
          </div>:<div style={{color:C.ink4,fontSize:12,fontFamily:"'Sarabun',sans-serif",marginBottom:8}}>ยังไม่ได้จับคู่อุปกรณ์</div>}
          <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
            <button onClick={()=>scanBTPrinter(false)} disabled={btScanning} style={{background:`linear-gradient(135deg,${C.brand},${C.brandDark})`,color:C.white,border:"none",borderRadius:9,padding:"8px 16px",cursor:btScanning?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:700,opacity:btScanning?.6:1,display:"flex",alignItems:"center",gap:6}}>📶 {btScanning?"กำลังสแกน...":"สแกนเครื่องปริ้น"}</button>
            <button onClick={()=>scanBTPrinter(true)} disabled={btScanning} style={{background:C.white,color:C.ink2,border:`1.5px solid ${C.line}`,borderRadius:9,padding:"8px 14px",cursor:btScanning?"not-allowed":"pointer",fontFamily:"'Sarabun',sans-serif",fontSize:12,fontWeight:600,opacity:btScanning?.6:1}}>🔍 แสดงทั้งหมด</button>
          </div>
        </div>}
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          {editPID&&<Btn v="ghost" onClick={()=>{setPForm(pF0);setEditPID(null);}}>ยกเลิก</Btn>}
          <Btn onClick={savePrinter} icon={I.check} disabled={!pForm.name||(pForm.conn==="bluetooth"?!pForm.btName:!pForm.ip)} loading={pSaving} s={{minWidth:160}}>{editPID?"บันทึกการแก้ไข":"เพิ่มเครื่องพิมพ์"}</Btn>
        </div>
      </div>
    </div>}
    <div style={{marginBottom:14,display:"flex",alignItems:"center",justifyContent:"space-between"}}>
      <h3 style={{fontFamily:"'Sarabun',sans-serif",fontSize:15,fontWeight:800,color:C.ink,margin:0}}>เครื่องพิมพ์ที่เชื่อมต่อ <span style={{fontSize:12,fontWeight:600,color:C.ink4}}>({printers.length} เครื่อง)</span></h3>
      <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",background:C.blueLight,padding:"5px 12px",borderRadius:18,border:`1px solid #BFDBFE`}}>💡 ไปที่หน้า <b>เมนู</b> เพื่อกำหนดเครื่องพิมพ์ให้แต่ละเมนู</div>
    </div>
    {printers.length===0?<div style={{background:C.white,border:`2px dashed ${C.line}`,borderRadius:14,padding:"50px 20px",textAlign:"center"}}>
      <div style={{width:56,height:56,background:C.lineLight,borderRadius:18,display:"flex",alignItems:"center",justifyContent:"center",margin:"0 auto 12px"}}><Ic d={I.print} s={26} c={C.ink4}/></div>
      <div style={{fontSize:15,fontWeight:700,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginBottom:6}}>ยังไม่มีเครื่องพิมพ์</div>
      <div style={{fontSize:12,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>เพิ่มเครื่องพิมพ์แรกของคุณด้านบน</div>
    </div>:<div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(320px,1fr))",gap:14}}>
      {printers.map(p=>{
        const typeConf={kitchen:{label:"ครัว",emoji:"🍳",color:"#F59E0B",bg:"#FFFBEB",border:"#FDE68A"},bar:{label:"บาร์",emoji:"🍹",color:"#10B981",bg:"#ECFDF5",border:"#A7F3D0"},receipt:{label:"แคชเชียร์",emoji:"🧾",color:"#3B82F6",bg:"#EFF6FF",border:"#BFDBFE"},other:{label:"อื่นๆ",emoji:"📄",color:"#8B5CF6",bg:"#F5F3FF",border:"#DDD6FE"}}[p.type]||{label:p.type,emoji:"🖨️",color:C.ink3,bg:C.bg,border:C.line};
        return <div key={p.id} style={{background:C.white,border:`1px solid ${C.line}`,borderRadius:14,overflow:"hidden",boxShadow:"0 2px 8px rgba(0,0,0,0.05)"}}>
          <div style={{padding:"14px 18px 12px",borderBottom:`1px solid ${C.line}`,background:`linear-gradient(135deg,${typeConf.bg},${C.white})`,display:"flex",alignItems:"flex-start",gap:12}}>
            <div style={{width:42,height:42,background:typeConf.bg,border:`2px solid ${typeConf.border}`,borderRadius:12,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>{typeConf.emoji}</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",marginBottom:4}}>{p.name}</div>
              <div style={{display:"inline-flex",alignItems:"center",gap:5,background:typeConf.bg,border:`1px solid ${typeConf.border}`,borderRadius:18,padding:"2px 10px"}}>
                <span style={{fontSize:11,fontWeight:700,color:typeConf.color,fontFamily:"'Sarabun',sans-serif"}}>{typeConf.label}</span>
              </div>
            </div>
            {isAdmin&&<div style={{display:"flex",gap:5,flexShrink:0}}>
              <button onClick={()=>openCatEdit(p)} title="หมวดหมู่ที่รับผิดชอบ" style={{background:"#FEF3C7",border:`1px solid #FDE68A`,borderRadius:8,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}><span style={{fontSize:13}}>🍳</span><span style={{fontSize:11,color:"#92400E",fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>หมวด</span></button>
              <button onClick={()=>{const pc=getPConn(p);setPForm({name:p.name,ip:pc.type==="bluetooth"?"":p.ip,port:p.port||9100,description:pc.type==="bluetooth"?"":p.description||"",type:p.type||"kitchen",branch_id:p.branch_id,active:p.active,conn:pc.type,btName:pc.btName||""});setEditPID(p.id);}} title="แก้ไข" style={{background:C.blueLight,border:`1px solid #BFDBFE`,borderRadius:8,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}><Ic d={I.pencil} s={12} c={C.blue}/><span style={{fontSize:11,color:C.blue,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>แก้</span></button>
              <button onClick={async()=>{if(!await confirmDlg({title:"ลบเครื่องปริ้น",message:`ต้องการลบ "${p.name}" ใช่หรือไม่?`}))return;try{await api.deletePrinter(p.id);await reloadPrinters();}catch{alert("ลบไม่สำเร็จ");}}} title="ลบ" style={{background:C.redLight,border:`1px solid #FECACA`,borderRadius:8,padding:"5px 8px",cursor:"pointer",display:"flex",alignItems:"center",gap:4}}><Ic d={I.trash} s={12} c={C.red}/><span style={{fontSize:11,color:C.red,fontFamily:"'Sarabun',sans-serif",fontWeight:700}}>ลบ</span></button>
            </div>}
          </div>
          <div style={{padding:"12px 18px"}}>
            {(()=>{const tr=testResults[p.id];const dotColor=!tr?C.ink3:tr.status==="testing"?C.yellow:tr.status==="ok"?C.green:C.red;const pc=getPConn(p);const isBT=pc.type==="bluetooth";return<div style={{display:"flex",alignItems:"center",gap:10,padding:"9px 12px",background:"#F8FAFC",borderRadius:9,border:`1px solid ${tr?.status==="ok"?C.green:tr?.status==="fail"?C.red:C.line}`}}>
              <div style={{width:9,height:9,borderRadius:"50%",background:dotColor,boxShadow:`0 0 6px ${dotColor}88`,flexShrink:0,animation:tr?.status==="testing"?"pulse 1s infinite":"none"}}/>
              <div style={{flex:1,minWidth:0}}>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <span style={{fontSize:10,background:isBT?C.brandLight:C.blueLight,color:isBT?C.brand:C.blue,border:`1px solid ${isBT?C.brandBorder:"#BFDBFE"}`,borderRadius:5,padding:"1px 6px",fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>{isBT?"📶 BT":"🌐 IP"}</span>
                  <span style={{fontSize:12,fontWeight:800,color:C.ink,fontFamily:"monospace"}}>{isBT?pc.btName||"—":`${p.ip}:${p.port||9100}`}</span>
                </div>
                <div style={{fontSize:10,color:tr?.status==="ok"?C.green:tr?.status==="fail"?C.red:C.ink4,fontFamily:"'Sarabun',sans-serif",fontWeight:tr?600:400,marginTop:1}}>
                  {!tr&&(isBT?"กดทดสอบเพื่อจับคู่":"IP : Port")}
                  {tr?.status==="testing"&&"⏳ กำลังทดสอบ..."}
                  {tr?.status==="ok"&&`✅ ${tr.msg}`}
                  {tr?.status==="fail"&&`❌ ${tr.msg}`}
                </div>
              </div>
              <button onClick={()=>testPrinter(p)} disabled={testResults[p.id]?.status==="testing"} style={{padding:"5px 12px",borderRadius:7,border:`1.5px solid ${C.brand}`,background:testResults[p.id]?.status==="testing"?C.lineLight:C.brandLight,color:C.brand,cursor:testResults[p.id]?.status==="testing"?"not-allowed":"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif",whiteSpace:"nowrap"}}>{testResults[p.id]?.status==="testing"?"...":"🔌 ทดสอบ"}</button>
            </div>;})()}
            {/* Categories badge */}
            {(()=>{const cats=p.categories;const overrideCount=menus.filter(m=>+m.printer_id===p.id).length;return <div style={{marginTop:6,padding:"7px 11px",borderRadius:8,background:cats===null||cats===undefined?C.greenLight:cats.length===0?C.lineLight:"#FEF3C7",border:`1px solid ${cats===null||cats===undefined?"#86EFAC":cats.length===0?C.line:"#FDE68A"}`,fontSize:11,fontFamily:"'Sarabun',sans-serif",color:cats===null||cats===undefined?C.green:cats.length===0?C.ink4:"#92400E",display:"flex",alignItems:"center",gap:6,flexWrap:"wrap"}}>
              <span style={{fontWeight:800}}>🍳 รับผิดชอบ:</span>
              <span style={{fontWeight:600}}>{cats===null||cats===undefined?"ทุกหมวด (catch-all)":cats.length===0?"ไม่รับงานอัตโนมัติ":cats.join(", ")}</span>
              {overrideCount>0&&<span style={{marginLeft:"auto",background:C.purpleLight,color:C.purple,padding:"1px 8px",borderRadius:10,fontSize:10,fontWeight:700}}>+{overrideCount} เมนู (override)</span>}
            </div>;})()}
            {p.branch_id&&(branches||[]).find(b=>b.id===p.branch_id)&&<div style={{fontSize:11,color:C.ink3,fontFamily:"'Sarabun',sans-serif",marginTop:6,display:"flex",alignItems:"center",gap:5}}><Ic d={I.branch} s={12} c={C.ink4}/>สาขา: <b>{branches.find(b=>b.id===p.branch_id)?.name}</b></div>}
            {!p.branch_id&&<div style={{fontSize:11,color:C.teal,fontFamily:"'Sarabun',sans-serif",marginTop:6,display:"flex",alignItems:"center",gap:5}}><Ic d={I.shop} s={12} c={C.teal}/>ใช้งานได้ทุกสาขา</div>}
          </div>
        </div>;
      })}
    </div>}
    {/* Category routing modal */}
    {catEditP&&<Modal title={`🍳 หมวดหมู่ที่รับผิดชอบ — ${catEditP.name}`} onClose={()=>setCatEditP(null)} extraWide>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:18}}>
        {/* Left: category checklist */}
        <div>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div style={{fontSize:13,fontWeight:800,color:C.ink2,fontFamily:"'Sarabun',sans-serif"}}>📂 หมวดหมู่</div>
            <div style={{display:"flex",gap:6}}>
              <button onClick={()=>setCatSel(null)} style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${catSel===null?C.green:C.line}`,background:catSel===null?C.greenLight:C.white,color:catSel===null?C.green:C.ink3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ทุกหมวด (catch-all)</button>
              <button onClick={()=>setCatSel([...allCategories])} style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${C.line}`,background:C.white,color:C.ink3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>เลือกทั้งหมด</button>
              <button onClick={()=>setCatSel([])} style={{padding:"4px 10px",borderRadius:7,border:`1px solid ${C.line}`,background:C.white,color:C.ink3,cursor:"pointer",fontSize:11,fontWeight:700,fontFamily:"'Sarabun',sans-serif"}}>ล้าง</button>
            </div>
          </div>
          {catSel===null
            ?<div style={{padding:"14px 16px",background:C.greenLight,borderRadius:10,border:`1.5px solid ${C.green}`,fontSize:13,color:C.green,fontFamily:"'Sarabun',sans-serif",fontWeight:600,lineHeight:1.7}}>
              ✅ <b>Catch-all</b> — เครื่องนี้รับงานพิมพ์ทุกหมวด<br/>
              <span style={{fontSize:11,fontWeight:400}}>ใช้เป็น "เครื่องสำรอง" — ระบบจะส่งงานมาที่นี่ถ้าไม่มีเครื่องอื่น match หมวดของเมนู</span>
            </div>
            :allCategories.length===0
              ?<div style={{padding:30,textAlign:"center",color:C.ink4,fontSize:13,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีหมวดหมู่เมนู — เพิ่มหมวดในแท็บ "เมนู" ก่อน</div>
              :<div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:6,maxHeight:340,overflowY:"auto"}}>
                {allCategories.map(c=>{const has=catSel.includes(c);const count=menus.filter(m=>m.category===c).length;return <label key={c} style={{display:"flex",alignItems:"center",gap:8,padding:"8px 10px",borderRadius:8,cursor:"pointer",background:has?C.brandLight:C.white,border:`1.5px solid ${has?C.brandBorder:C.line}`,transition:"all .15s"}}>
                  <input type="checkbox" checked={has} onChange={()=>toggleCat(c)} style={{accentColor:C.brand,width:15,height:15,cursor:"pointer"}}/>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:has?800:600,color:has?C.brand:C.ink2,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c}</div>
                    <div style={{fontSize:10,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{count} เมนู</div>
                  </div>
                </label>;})}
              </div>}
        </div>
        {/* Right: per-menu override */}
        <div>
          <div style={{fontSize:13,fontWeight:800,color:C.ink2,fontFamily:"'Sarabun',sans-serif",marginBottom:10}}>🍽 Override รายเมนู (ระบุเครื่องเฉพาะ)</div>
          <div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif",marginBottom:8,lineHeight:1.5}}>เมนูที่ตั้ง override จะข้ามกฎหมวดหมู่ — ส่งไปเครื่องที่ระบุเสมอ</div>
          <div style={{maxHeight:380,overflowY:"auto",border:`1px solid ${C.line}`,borderRadius:10}}>
            <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"'Sarabun',sans-serif"}}>
              <thead style={{position:"sticky",top:0,background:C.bg,zIndex:1}}>
                <tr><th style={{padding:"8px 10px",textAlign:"left",fontSize:11,color:C.ink3,borderBottom:`1px solid ${C.line}`}}>เมนู</th><th style={{padding:"8px 10px",textAlign:"left",fontSize:11,color:C.ink3,borderBottom:`1px solid ${C.line}`,width:180}}>ส่งไปที่</th></tr>
              </thead>
              <tbody>
                {menus.map(m=>{const assigned=catMenuOverride[m.id]||"";return <tr key={m.id} style={{borderBottom:`1px solid ${C.lineLight}`}}>
                  <td style={{padding:"7px 10px",fontSize:12,color:C.ink2}}>
                    <div style={{fontWeight:600}}>{m.name}</div>
                    <div style={{fontSize:10,color:C.ink4}}>{m.category||"—"}</div>
                  </td>
                  <td style={{padding:"7px 10px"}}>
                    <select value={assigned} onChange={e=>setCatMenuOverride(prev=>({...prev,[m.id]:e.target.value?+e.target.value:null}))} style={{...iS,fontSize:11,padding:"4px 8px",height:28}}>
                      <option value="">— ตามหมวด ({m.category||"-"}) —</option>
                      {printers.map(pr=><option key={pr.id} value={pr.id}>{pr.id===catEditP.id?"⭐ ":""}{pr.name}</option>)}
                    </select>
                  </td>
                </tr>;})}
                {menus.length===0&&<tr><td colSpan={2} style={{padding:20,textAlign:"center",color:C.ink4,fontSize:12}}>ยังไม่มีเมนู</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div style={{display:"flex",justifyContent:"flex-end",gap:8,paddingTop:14,borderTop:`1px solid ${C.line}`,marginTop:14}}>
        <Btn v="ghost" onClick={()=>setCatEditP(null)}>ยกเลิก</Btn>
        <Btn onClick={saveCatEdit} loading={catSaving} icon={I.check}>บันทึก</Btn>
      </div>
    </Modal>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS SALE MODE (โหมดขายหน้าร้าน) ────────────────────
// ══════════════════════════════════════════════════════
function POSSaleMode({menus,reloadMenus,currentBranch,currentUser,printers=[],shift,zones=[],posSettings,promotions=[],onUpdateShift,onCashDrawer,onCloseShift,onExitMode}){
  const[posTab,setPosTab]=useState("tables");
  const[tables,setTables]=useState([]);const[activeOrders,setActiveOrders]=useState([]);const[allOrders,setAllOrders]=useState([]);
  const[loading,setLoading]=useState(true);
  const[selTable,setSelTable]=useState(null);const[selOrder,setSelOrder]=useState(null);
  const timerRef=useRef(null);
  const canEdit=hasPerm(currentUser,"pos");

  const printedRef=useRef(new Set(JSON.parse(sessionStorage.getItem("fc_printed_orders")||"[]")));
  const lastSigRef=useRef(new Map());
  function persistPrinted(){try{sessionStorage.setItem("fc_printed_orders",JSON.stringify([...printedRef.current]));}catch{}}
  function autoPrintNew(orders){
    orders.forEach(o=>{
      if(!o||!o.items||o.items.length===0)return;
      if(o.status==="paid"||o.status==="cancelled")return;
      const sig=JSON.stringify(o.items.map(i=>[i.menu_id,i.qty,i.note||""]));
      const lastSig=lastSigRef.current.get(o.id);
      const isFirst=!printedRef.current.has(`${o.id}:init`);
      const customerOrdered=o.ordered_by==="customer";
      if(isFirst&&customerOrdered){
        const newItems=lastSig?(()=>{try{const old=JSON.parse(lastSig);const oldMap=new Map(old.map(([m,q,n])=>[`${m}|${n}`,q]));return o.items.filter(i=>{const k=`${i.menu_id}|${i.note||""}`;return!oldMap.has(k)||oldMap.get(k)<i.qty;}).map(i=>{const k=`${i.menu_id}|${i.note||""}`;const oldQ=oldMap.get(k)||0;return{...i,qty:i.qty-oldQ};});}catch{return o.items;}})():o.items;
        if(newItems.length>0){printKitchen(newItems,o.table_number,printers);}
        printedRef.current.add(`${o.id}:init`);persistPrinted();
      }else if(lastSig&&lastSig!==sig&&customerOrdered){
        try{
          const old=JSON.parse(lastSig);const oldMap=new Map(old.map(([m,q,n])=>[`${m}|${n}`,q]));
          const newItems=o.items.filter(i=>{const k=`${i.menu_id}|${i.note||""}`;return!oldMap.has(k)||oldMap.get(k)<i.qty;}).map(i=>{const k=`${i.menu_id}|${i.note||""}`;const oldQ=oldMap.get(k)||0;return{...i,qty:i.qty-oldQ};});
          if(newItems.length>0)printKitchen(newItems,o.table_number,printers);
        }catch{}
      }
      lastSigRef.current.set(o.id,sig);
    });
  }

  async function loadTables(){const t=await api.getPOSTables(currentBranch.id);setTables(t);}
  async function loadOrders(){const o=await api.getActiveOrders(currentBranch.id);setActiveOrders(o);autoPrintNew(o);}
  async function loadAllOrders(){const o=await api.getPOSOrders(currentBranch.id);setAllOrders(o);}
  async function loadAll(){setLoading(true);try{await Promise.all([loadTables(),loadOrders()]);}catch(e){console.error(e);}setLoading(false);}

  useEffect(()=>{
    loadAll();
    timerRef.current=setInterval(()=>{if(!document.hidden)loadOrders();},15000);
    const onVis=()=>{if(!document.hidden)loadOrders();};
    document.addEventListener("visibilitychange",onVis);
    return()=>{clearInterval(timerRef.current);document.removeEventListener("visibilitychange",onVis);};
  },[]);
  useEffect(()=>{if(posTab==="orders")loadAllOrders();},[posTab]);

  const PTABS=[{id:"tables",l:"แผนผังโต๊ะ",icon:I.table},{id:"orders",l:"ออเดอร์วันนี้",icon:I.order},{id:"qr",l:"QR สั่งอาหาร",icon:I.qr}];

  if(loading)return <Loading text="กำลังโหลดข้อมูล POS..."/>;

  const todayOrders=allOrders.filter(o=>o.status==="paid"&&new Date(o.created_at).toDateString()===new Date().toDateString());
  const todayRev=todayOrders.reduce((s,o)=>s+(o.total||0),0);

  return <div style={{margin:"-20px -24px",display:"flex",flexDirection:"column",height:"calc(100vh - 150px)"}}>
    {/* Shift indicator strip */}
    <div style={{padding:"6px 16px",background:`linear-gradient(135deg,${C.green},#059669)`,color:C.white,display:"flex",alignItems:"center",gap:14,fontSize:12,fontFamily:"'Sarabun',sans-serif",flexShrink:0}}>
      <span style={{fontSize:14}}>💵</span>
      <span style={{fontWeight:700}}>กะ #{shift.id}</span>
      <span style={{opacity:.85}}>เปิดเมื่อ {new Date(shift.opened_at).toLocaleTimeString("th-TH",{hour:'2-digit',minute:'2-digit'})}</span>
      <span style={{opacity:.85}}>· ทอนเริ่มต้น ฿{(+shift.opening_cash||0).toLocaleString()}</span>
      <span style={{opacity:.85,marginLeft:"auto"}}>{shift.username}</span>
    </div>
    <div style={{padding:"0 16px",background:C.white,borderBottom:`1px solid ${C.line}`,display:"flex",alignItems:"center",height:46,gap:2,flexShrink:0}}>
      {PTABS.map(t=>{const active=posTab===t.id;return <button key={t.id} onClick={()=>setPosTab(t.id)} style={{display:"flex",alignItems:"center",gap:6,padding:"0 12px",height:46,border:"none",background:"none",cursor:"pointer",fontSize:12,fontWeight:active?800:500,color:active?C.brand:C.ink3,fontFamily:"'Sarabun',sans-serif",borderBottom:active?`2.5px solid ${C.brand}`:"2.5px solid transparent",transition:"all .15s"}}><Ic d={t.icon} s={13} c={active?C.brand:C.ink4}/>{t.l}</button>;})}
      <div style={{marginLeft:"auto",display:"flex",gap:6}}>
        <Btn v="success" onClick={onCashDrawer} icon={I.cash} s={{padding:"5px 12px",fontSize:12}}>💰 เงินในลิ้นชัก</Btn>
        {canEdit&&<Btn v="danger" onClick={onCloseShift} s={{padding:"5px 10px",fontSize:12}}>🔚 ปิดกะ</Btn>}
        <Btn v="ghost" onClick={loadAll} icon={I.refresh} s={{padding:"5px 10px",fontSize:12}}>รีเฟรช</Btn>
        <Btn v="ghost" onClick={onExitMode} s={{padding:"5px 10px",fontSize:12}}>← โหมด</Btn>
      </div>
    </div>
    <div style={{flex:1,overflow:"hidden",display:"flex",flexDirection:"column"}}>
      {posTab==="tables"&&<POSTableMap tables={tables} activeOrders={activeOrders} zones={zones} onSelectTable={(t,o)=>{if(!canEdit)return;setSelTable(t);setSelOrder(o||null);}} onEditLayout={loadAll}/>}
      {posTab==="orders"&&<div style={{overflowY:"auto",flex:1,padding:"14px 16px"}}>
        {allOrders.length===0&&<div style={{textAlign:"center",padding:"60px 0",color:C.ink4}}><Ic d={I.order} s={48} c={C.line}/><p style={{marginTop:12,fontFamily:"'Sarabun',sans-serif"}}>ยังไม่มีออเดอร์</p></div>}
        {allOrders.length>0&&<>
          <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
            {[{l:"ออเดอร์วันนี้",v:todayOrders.length,c:C.blue},{l:"รายรับวันนี้",v:`฿${todayRev.toFixed(0)}`,c:C.green},{l:"รอดำเนินการ",v:activeOrders.length,c:C.yellow}].map(s=><div key={s.l} style={{background:C.white,borderRadius:12,padding:"12px 16px",border:`1px solid ${C.line}`,display:"flex",alignItems:"center",gap:10}}><div><div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{s.l}</div><div style={{fontSize:18,fontWeight:800,color:s.c,fontFamily:"'Sarabun',sans-serif"}}>{s.v}</div></div></div>)}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(260px,1fr))",gap:10}}>
            {allOrders.map(o=>{
              const stC={pending:C.yellow,confirmed:C.green,paid:C.green,cancelled:C.ink4};
              const stL={pending:"รอยืนยัน",confirmed:"กำลังทำ",bill_requested:"เรียกบิล",paid:"ชำระแล้ว",cancelled:"ยกเลิก"};
              return <div key={o.id} style={{background:C.white,borderRadius:12,border:`1px solid ${C.line}`,overflow:"hidden"}}>
                <div style={{padding:"9px 12px",background:C.bg,borderBottom:`1px solid ${C.line}`,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                  <span style={{fontWeight:800,fontSize:14,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>โต๊ะ {o.table_number}</span>
                  <span style={{fontSize:11,fontWeight:700,color:stC[o.status]||C.ink3,background:`${stC[o.status]||C.ink3}22`,padding:"2px 8px",borderRadius:20,fontFamily:"'Sarabun',sans-serif"}}>{stL[o.status]||o.status}</span>
                </div>
                <div style={{padding:"9px 12px"}}>
                  {(o.items||[]).slice(0,3).map((i,idx)=><div key={idx} style={{display:"flex",justifyContent:"space-between",fontSize:12,fontFamily:"'Sarabun',sans-serif",marginBottom:2}}><span>{i.qty}x {i.name}</span><span style={{color:C.brand,fontWeight:700}}>฿{(i.price*i.qty).toFixed(0)}</span></div>)}
                  {(o.items||[]).length>3&&<div style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>+อีก {o.items.length-3} รายการ</div>}
                  <div style={{display:"flex",justifyContent:"space-between",marginTop:6,paddingTop:6,borderTop:`1px solid ${C.lineLight}`}}>
                    <span style={{fontSize:11,color:C.ink4,fontFamily:"'Sarabun',sans-serif"}}>{new Date(o.created_at).toLocaleTimeString("th-TH")}</span>
                    <span style={{fontSize:14,fontWeight:900,color:C.ink,fontFamily:"'Sarabun',sans-serif"}}>฿{(o.total||0).toFixed(0)}</span>
                  </div>
                </div>
              </div>;
            })}
          </div>
        </>}
      </div>}
      {posTab==="qr"&&<div style={{overflowY:"auto",flex:1}}><POSQRPage branch={currentBranch} tables={tables} onTablesChanged={loadTables}/></div>}
    </div>
    {selTable&&<Modal title={`โต๊ะ ${selTable.table_number}${selTable.label?` — ${selTable.label}`:""}`} onClose={()=>{setSelTable(null);setSelOrder(null);loadAll();}} wide>
      <div style={{display:"flex",justifyContent:"flex-end",marginBottom:10}}>
        <button onClick={()=>printTableQR(selTable,currentBranch)} style={{display:"flex",alignItems:"center",gap:6,padding:"7px 14px",borderRadius:9,border:`1px solid ${C.line}`,background:C.white,cursor:"pointer",fontSize:12,fontFamily:"'Sarabun',sans-serif",fontWeight:600,color:C.ink2}}>🖨 พิมพ์ QR โต๊ะนี้</button>
      </div>
      <POSOrderPanel table={selTable} existingOrder={selOrder} menus={menus} reloadMenus={reloadMenus} branch={currentBranch} currentUser={currentUser} shift={shift} posSettings={posSettings} promotions={promotions} onClose={()=>{setSelTable(null);setSelOrder(null);}} onDone={loadAll} printers={printers}/>
    </Modal>}
  </div>;
}

// ══════════════════════════════════════════════════════
// ── POS TAB (top-level wrapper: mode + shift) ────────
// ══════════════════════════════════════════════════════
function POSTab({menus,currentBranch,currentUser,printers=[],branches=[],reloadPrinters,reloadMenus}){
  const[mode,setMode]=useState(null);  // null | 'sale' | 'manage'
  const[shift,setShift]=useState(null);
  const[loadingShift,setLoadingShift]=useState(false);
  const[showCashDrawer,setShowCashDrawer]=useState(false);
  const[showCloseShift,setShowCloseShift]=useState(false);
  const[zones,setZones]=useState([]);
  const[posSettings,setPosSettings]=useState(null);
  const[promotions,setPromotions]=useState([]);
  async function loadZones(){try{const z=await api.getZones(currentBranch.id);setZones(z);}catch(e){console.error("loadZones",e);}}
  async function loadPosSettings(){try{const s=await api.getPOSSettings(currentBranch.id);setPosSettings(s&&s[0]?s[0]:{branch_id:currentBranch.id,vat_enabled:false,vat_rate:7,vat_included:true,service_charge_enabled:false,service_charge_rate:10});}catch{setPosSettings({branch_id:currentBranch.id,vat_enabled:false,vat_rate:7,vat_included:true,service_charge_enabled:false,service_charge_rate:10});}}
  async function loadPromotions(){try{const p=await api.getPromotions(currentBranch.id);setPromotions(p);}catch{setPromotions([]);}}
  useEffect(()=>{loadZones();loadPosSettings();loadPromotions();},[currentBranch.id]);

  useEffect(()=>{
    if(mode!=='sale'){setShift(null);return;}
    setLoadingShift(true);
    api.getActiveShift(currentBranch.id).then(s=>{
      setShift(s&&s.length?s[0]:null);
      setLoadingShift(false);
    }).catch(e=>{setLoadingShift(false);alert("โหลดข้อมูลกะไม่สำเร็จ: "+e.message);});
  },[mode,currentBranch.id]);

  const canManage=hasPerm(currentUser,"settings");
  if(mode===null)return <POSModeSelect onSelect={setMode} canManage={canManage}/>;
  if(mode==='manage'){
    if(!canManage){setMode(null);return null;}
    return <POSBackOffice currentBranch={currentBranch} currentUser={currentUser} printers={printers} reloadPrinters={reloadPrinters} branches={branches} zones={zones} reloadZones={loadZones} menus={menus} onExit={()=>{setMode(null);loadZones();loadPosSettings();loadPromotions();}}/>;
  }
  // mode === 'sale'
  if(loadingShift)return <Loading text="ตรวจสอบกะการขาย..."/>;
  if(!shift)return <OpenShiftModal currentBranch={currentBranch} currentUser={currentUser} onDone={s=>setShift(s)} onCancel={()=>setMode(null)}/>;
  return <>
    <POSSaleMode menus={menus} reloadMenus={reloadMenus} currentBranch={currentBranch} currentUser={currentUser} printers={printers} shift={shift} zones={zones} posSettings={posSettings} promotions={promotions} onUpdateShift={setShift} onCashDrawer={()=>setShowCashDrawer(true)} onCloseShift={()=>setShowCloseShift(true)} onExitMode={()=>setMode(null)}/>
    {showCashDrawer&&<CashDrawerModal shift={shift} currentBranch={currentBranch} currentUser={currentUser} onClose={()=>setShowCashDrawer(false)}/>}
    {showCloseShift&&<CloseShiftModal shift={shift} currentBranch={currentBranch} currentUser={currentUser} onClose={()=>setShowCloseShift(false)} onClosed={()=>{setShowCloseShift(false);setShowCashDrawer(false);setShift(null);setMode(null);}}/>}
  </>;
}


// BranchSelector with auto-load branches
function BranchSelectorWithLoad({user,onSelect,onLogout}){
  const[branches,setBranches]=useState([]);const[loading,setLoading]=useState(true);
  useEffect(()=>{api.getBranches().then(b=>setBranches(b)).finally(()=>setLoading(false));},[]);
  if(loading)return <><style>{globalStyle}</style><div style={{minHeight:"100vh",display:"flex",alignItems:"center",justifyContent:"center"}}><Loading text="กำลังโหลดรายการสาขา..."/></div></>;
  return <BranchSelector branches={branches} onSelect={onSelect} user={user} onLogout={onLogout}/>;
}

const globalStyle=`@import url('https://fonts.googleapis.com/css2?family=Sarabun:wght@400;500;600;700;800;900&display=swap');*{margin:0;padding:0;box-sizing:border-box}body{background:${C.bg};font-family:'Sarabun',sans-serif}@keyframes mIn{from{opacity:0;transform:scale(.94) translateY(10px)}to{opacity:1;transform:scale(1) translateY(0)}}@keyframes spin{from{transform:rotate(0deg)}to{transform:rotate(360deg)}}::-webkit-scrollbar{width:5px;height:5px}::-webkit-scrollbar-thumb{background:${C.line};border-radius:999px}input:focus,select:focus,textarea:focus{border-color:${C.brand}!important;box-shadow:0 0 0 3px ${C.brandLight}!important;outline:none}`;
