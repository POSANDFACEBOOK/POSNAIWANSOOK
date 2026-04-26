import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { C, I, Ic, iS, api, confirmDlg, globalStyle, Btn, Chip, Card, Modal, Field, Inp, TA, Sel, Loading, ErrBox, STh, ImgUp, EditedBy, ppg, menuCost, marginColor, marginLabel, nowStr, todayStr, hasPerm, ROLES, ROLE_DEFAULT_PERMS, ALL_PERMS, TIERS, tierOf, nextTier, pointsToEarn, autoTags } from "./FoodCostApp.jsx";

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

export { ImportIngModal, ImportMenuModal };
