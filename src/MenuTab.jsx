import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C, I, Ic, iS, api, confirmDlg, globalStyle, Btn, Chip, Card, Modal, Field, Inp, TA, Sel, Loading, ErrBox, STh, ImgUp, EditedBy, ppg, menuCost, marginColor, marginLabel, nowStr, todayStr, hasPerm, ROLES, ROLE_DEFAULT_PERMS, ALL_PERMS, TIERS, tierOf, nextTier, pointsToEarn, autoTags } from "./FoodCostApp.jsx";

import { ImportMenuModal } from "./ImportModals.jsx";
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

export default MenuTab;
