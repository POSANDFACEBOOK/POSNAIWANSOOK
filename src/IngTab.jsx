import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C, I, Ic, iS, api, confirmDlg, globalStyle, Btn, Chip, Card, Modal, Field, Inp, TA, Sel, Loading, ErrBox, STh, ImgUp, EditedBy, ppg, menuCost, marginColor, marginLabel, nowStr, todayStr, hasPerm, ROLES, ROLE_DEFAULT_PERMS, ALL_PERMS, TIERS, tierOf, nextTier, pointsToEarn, autoTags } from "./FoodCostApp.jsx";

import { ImportIngModal } from "./ImportModals.jsx";
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


export default IngTab;
