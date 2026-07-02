import { useState, useRef, useCallback, useEffect } from "react";
import * as XLSX from "xlsx";

const SUPABASE_URL = "https://hrlxpveadoxnzqnjsxpl.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhybHhwdmVhZG94bnpxbmpzeHBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI5NTE0NjgsImV4cCI6MjA5ODUyNzQ2OH0.jfkX62RTrvSe6XNiqB_A3DmEIox6PgJNS4MYVDHVp28";
const DRAFTS_KEY = "yflcs_drafts";

// ─── 多草稿（本地存储）────────────────────────────────────────────────────────
const loadAllDrafts = () => {
  try { return JSON.parse(localStorage.getItem(DRAFTS_KEY) || "{}"); }
  catch { return {}; }
};

const saveDraft = (step, contract, items) => {
  if (!contract?.contract_no) return;
  try {
    const all = loadAllDrafts();
    all[contract.contract_no] = { step, contract, items, savedAt: new Date().toISOString() };
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {}
};

const clearDraft = (contractNo) => {
  try {
    const all = loadAllDrafts();
    delete all[contractNo];
    localStorage.setItem(DRAFTS_KEY, JSON.stringify(all));
  } catch {}
};

const clearAllDrafts = () => {
  try { localStorage.removeItem(DRAFTS_KEY); } catch {}
};

// ─── Supabase ──────────────────────────────────────────────────────────────────
const sbFetch = (path, opts = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1${path}`, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: "return=representation",
      ...(opts.headers || {}),
    },
  });

const saveStatement = async (contract, items, settlement) => {
  const res = await sbFetch("/statements", {
    method: "POST",
    body: JSON.stringify({
      contract_no: contract.contract_no,
      contract_date: contract.contract_date,
      seller: contract.seller,
      buyer: contract.buyer,
      product_name: contract.product_name,
      contract_qty: contract.contract_qty,
      unit_price: contract.unit_price,
      total_amt: settlement.totalAmt,
      settlement_mode: contract.settlement_mode || "contract",
      settle_qty: settlement.settleQty,
      delivery_no: contract.delivery_no || "",
      amount_cn: contract.amount_cn || "",
      items: items,
      operator: "我",
    }),
  });
  if (!res.ok) throw new Error("保存失败");
  return res.json();
};

const fetchStatements = async (search = "") => {
  let path = "/statements?order=created_at.desc&limit=50";
  if (search) path += `&or=(contract_no.ilike.*${search}*,buyer.ilike.*${search}*)`;
  const res = await sbFetch(path);
  if (!res.ok) throw new Error("查询失败");
  return res.json();
};

const deleteStatement = async (id) => {
  const res = await sbFetch(`/statements?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除失败");
};

// ─── 客户资料 Supabase ───────────────────────────────────────────────────────
const fetchCustomers = async () => {
  const res = await sbFetch("/customers?order=company_name.asc");
  if (!res.ok) throw new Error("获取客户失败");
  return res.json();
};

const saveCustomer = async (data) => {
  const res = await sbFetch("/customers", { method: "POST", body: JSON.stringify(data) });
  if (!res.ok) throw new Error("保存客户失败");
  return res.json();
};

const updateCustomer = async (id, data) => {
  const res = await sbFetch(`/customers?id=eq.${id}`, { method: "PATCH", body: JSON.stringify(data) });
  if (!res.ok) throw new Error("更新客户失败");
};

const deleteCustomer = async (id) => {
  const res = await sbFetch(`/customers?id=eq.${id}`, { method: "DELETE" });
  if (!res.ok) throw new Error("删除客户失败");
};

const matchCustomer = (buyerName, customers) => {
  if (!buyerName || !customers.length) return null;
  const n = (s) => String(s).replace(/\s/g,"").toLowerCase();
  return customers.find(c => n(buyerName).includes(n(c.company_name)) || n(c.company_name).includes(n(buyerName))) || null;
};

// ─── 工具函数 ──────────────────────────────────────────────────────────────────
const toBase64 = (file) =>
  new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result.split(",")[1]);
    r.onerror = rej;
    r.readAsDataURL(file);
  });

const formatLocalDate = (d = new Date()) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const toNumber = (v, fallback = 0) => {
  if (typeof v === "number") return Number.isFinite(v) ? v : fallback;
  const n = Number(String(v ?? "").replace(/[¥,\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const normalizeContract = (r) => ({
  contract_no: String(r.contract_no || "").trim(),
  contract_date: String(r.contract_date || "").trim(),
  delivery_no: String(r.delivery_no || "").trim(),
  seller: String(r.seller || "").trim(),
  seller_contact: String(r.seller_contact || "").trim(),
  buyer: String(r.buyer || "").trim(),
  buyer_contact: String(r.buyer_contact || "").trim(),
  product_name: String(r.product_name || "").trim(),
  contract_qty: toNumber(r.contract_qty, 0),
  unit_price: toNumber(r.unit_price, 0),
  trade_mode: String(r.trade_mode || "").trim(),
  amount_cn: String(r.amount_cn || "").trim(),
  items: Array.isArray(r.items)
    ? r.items.map((it) => ({
        name: String(it.name || "").trim(),
        spec: String(it.spec || "").trim(),
        color: String(it.color || "白色").trim(),
        unit: String(it.unit || "件").trim(),
        contract_qty: toNumber(it.contract_qty, 0),
      }))
    : [],
});

// ─── Claude API ────────────────────────────────────────────────────────────────
const CLAUDE_MODELS = ["claude-sonnet-5", "claude-sonnet-4-6"];

const stripJsonFences = (text = "") => String(text)
  .trim()
  .replace(/^```(?:json|JSON)?\s*/i, "")
  .replace(/```\s*$/i, "")
  .trim();

const extractJsonCandidate = (text = "") => {
  const clean = stripJsonFences(text);
  try { JSON.parse(clean); return clean; } catch {}

  const starts = [clean.indexOf("{"), clean.indexOf("[")].filter(i => i >= 0).sort((a,b) => a-b);
  if (!starts.length) return clean;

  const start = starts[0];
  const open = clean[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < clean.length; i++) {
    const ch = clean[i];
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) depth--;
    if (depth === 0) return clean.slice(start, i + 1).trim();
  }

  const last = clean.lastIndexOf(close);
  return last >= start ? clean.slice(start, last + 1).trim() : clean;
};

const parseClaudeJson = (text) => {
  const candidate = extractJsonCandidate(text);
  try { return JSON.parse(candidate); }
  catch (e) {
    console.warn("Claude raw response:", text);
    console.warn("JSON candidate:", candidate);
    throw new Error("模型返回内容无法解析为 JSON；已记录原始返回，请重试或改用手动录入");
  }
};

const callClaude = async (messages, system, maxTokens = 1800) => {
  let lastError = null;

  for (const model of CLAUDE_MODELS) {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true",
      },
      body: JSON.stringify({ model, max_tokens: maxTokens, temperature: 0, system, messages }),
    });

    const data = await res.json().catch(() => ({}));

    if (res.ok) {
      const text = data.content?.map((b) => b.text || "").join("\n").trim() || "";
      return parseClaudeJson(text);
    }

    const message = data?.error?.message || `HTTP ${res.status}`;
    lastError = new Error(`${model}: ${message}`);

    // 模型不存在/不可用时自动尝试下一个模型；余额不足、密钥错误等不重试。
    if (!/model|not found|not_found|invalid|deprecated|unavailable/i.test(message)) {
      break;
    }
  }

  throw lastError || new Error("Claude API 调用失败");
};

// ─── 结算 ──────────────────────────────────────────────────────────────────────
const calcSettlement = (contract, deliveryItems) => {
  const qtys = deliveryItems.map(it => toNumber(it.delivered_qty, 0)).filter(n => n > 0);
  const minQty = qtys.length ? Math.min(...qtys) : 0;
  const contractQty = toNumber(contract.contract_qty, 0);
  const settleQty = Math.min(minQty, contractQty);
  return {
    minQty,
    settleQty,
    canSettle: minQty >= contractQty,
    totalAmt: +(settleQty * toNumber(contract.unit_price, 0)).toFixed(2),
  };
};

// ─── Excel ─────────────────────────────────────────────────────────────────────
const generateExcel = (contract, items, settlement) => {
  const wb = XLSX.utils.book_new();
  const ws = {};
  const enc = XLSX.utils.encode_cell;
  const ST = {
    title:   { font:{bold:true,sz:16,name:"Arial"}, alignment:{horizontal:"center",vertical:"center"} },
    header:  { font:{bold:true,sz:10,name:"Arial",color:{rgb:"FFFFFF"}}, fill:{fgColor:{rgb:"404040"}}, alignment:{horizontal:"center",vertical:"center",wrapText:true}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    label:   { font:{bold:true,sz:10,name:"Arial"}, alignment:{horizontal:"left",vertical:"center"} },
    value:   { font:{sz:10,name:"Arial"}, alignment:{horizontal:"left",vertical:"center"} },
    cell:    { font:{sz:10,name:"Arial"}, alignment:{horizontal:"center",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    cellA:   { font:{sz:10,name:"Arial"}, fill:{fgColor:{rgb:"F2F2F2"}}, alignment:{horizontal:"center",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    cellL:   { font:{sz:10,name:"Arial"}, alignment:{horizontal:"left",vertical:"center",wrapText:true}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    cellLA:  { font:{sz:10,name:"Arial"}, fill:{fgColor:{rgb:"F2F2F2"}}, alignment:{horizontal:"left",vertical:"center",wrapText:true}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    sumL:    { font:{bold:true,sz:10,name:"Arial"}, fill:{fgColor:{rgb:"FFF2CC"}}, alignment:{horizontal:"center",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    sumA:    { font:{bold:true,sz:10,name:"Arial",color:{rgb:"CC0000"}}, fill:{fgColor:{rgb:"FFF2CC"}}, alignment:{horizontal:"center",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    light:   { font:{sz:10,name:"Arial"}, fill:{fgColor:{rgb:"F2F2F2"}}, alignment:{horizontal:"left",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    lightC:  { font:{sz:10,name:"Arial"}, fill:{fgColor:{rgb:"F2F2F2"}}, alignment:{horizontal:"center",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    remarkH: { font:{bold:true,sz:10,name:"Arial",color:{rgb:"FFFFFF"}}, fill:{fgColor:{rgb:"404040"}}, alignment:{horizontal:"center",vertical:"center"}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
    remark:  { font:{sz:9,name:"Arial"}, alignment:{horizontal:"left",vertical:"center",wrapText:true}, border:{top:{style:"thin"},bottom:{style:"thin"},left:{style:"thin"},right:{style:"thin"}} },
  };
  const set = (r1,c1,v,style,numFmt) => { const ref=enc({r:r1-1,c:c1-1}); ws[ref]={v,t:typeof v==="number"?"n":"s",s:style}; if(numFmt) ws[ref].z=numFmt; };
  const merge = (rs1,re1,cs1,ce1) => { if(!ws["!merges"]) ws["!merges"]=[]; ws["!merges"].push({s:{r:rs1-1,c:cs1-1},e:{r:re1-1,c:ce1-1}}); };
  const {settleQty,totalAmt} = settlement;
  const preTax = +(totalAmt/1.13).toFixed(2);
  const taxAmt = +(totalAmt-preTax).toFixed(2);
  merge(1,1,1,10); set(1,1,"对  账  单",ST.title);
  [["卖方（供应商）：",contract.seller,"合同编号：",contract.contract_no],
   ["买方（客户）：",contract.buyer,"对账日期：",formatLocalDate()],
   ["联系人（卖方）：",contract.seller_contact||"","合同日期：",contract.contract_date],
   ["联系人（买方）：",contract.buyer_contact||"","送货单号：",contract.delivery_no||""]
  ].forEach(([l1,v1,l2,v2],i)=>{ const r=2+i; merge(r,r,1,1);set(r,1,l1,ST.label); merge(r,r,2,6);set(r,2,v1,ST.value); merge(r,r,7,7);set(r,7,l2,ST.label); merge(r,r,8,10);set(r,8,v2,ST.value); });
  ["序号","物料名称","规格/描述","颜色","单位","合同数量\n(套)","实送数量\n(件)","含税单价\n(元/套，13%)","含税金额\n(元)","备注"].forEach((h,ci)=>set(6,ci+1,h,ST.header));
  items.forEach((item,i)=>{ const r=7+i; const isA=i%2===1; [i+1,item.name,item.spec,item.color||"白色",item.unit||"件",item.contract_qty,toNumber(item.delivered_qty,0),"","",item.note||""].forEach((v,ci)=>set(r,ci+1,v,ci===2?(isA?ST.cellLA:ST.cellL):(isA?ST.cellA:ST.cell))); });
  const sR=7+items.length;
  merge(sR,sR,1,5);set(sR,1,"合同总金额（含税13%）",ST.sumL);
  set(sR,6,settleQty,ST.sumL); set(sR,7,contract.settlement_mode==="actual"?"按实际结算":"按合同结算",ST.sumL);
  set(sR,8,toNumber(contract.unit_price,0),ST.sumL,"¥#,##0.00"); set(sR,9,totalAmt,ST.sumA,"¥#,##0.00"); set(sR,10,"结算金额",ST.sumL);
  merge(sR+1,sR+1,1,10); set(sR+1,1,`金额大写：${contract.amount_cn||""}（¥${totalAmt.toLocaleString("zh-CN",{minimumFractionDigits:2})}，含增值税13%）`,ST.light);
  merge(sR+2,sR+2,1,6);set(sR+2,1,"税前金额（不含税）：",ST.lightC); merge(sR+2,sR+2,7,9);set(sR+2,7,preTax,ST.lightC,"¥#,##0.00"); set(sR+2,10,"",ST.lightC);
  merge(sR+3,sR+3,1,6);set(sR+3,1,"增值税额（13%）：",ST.lightC); merge(sR+3,sR+3,7,9);set(sR+3,7,taxAmt,ST.lightC,"¥#,##0.00"); set(sR+3,10,"",ST.lightC);
  const remR=sR+5; merge(remR,remR,1,10);set(remR,1,"对账说明",ST.remarkH);
  [`1. 本对账单依据采购合同（${contract.contract_no}）及送货工单（${contract.delivery_no||"—"}）编制，对账日期：${formatLocalDate()}。`,
   `2. 合同约定：${contract.product_name||""} ${contract.contract_qty} 套，含税单价 ¥${contract.unit_price}/套（含增值税13%），合计 ¥${(contract.contract_qty*contract.unit_price).toFixed(2)}。`,
   `3. 本次结算数量：${settleQty} 套，结算金额：¥${totalAmt.toFixed(2)}（${contract.settlement_mode==="actual"?"按实际最小送货量结算":"按合同约定数量结算"}）。`,
   "4. 如双方对上述金额无异议，请买方于收到本对账单后5个工作日内书面确认，逾期视为认可。"
  ].forEach((txt,i)=>{ merge(remR+1+i,remR+1+i,1,10); set(remR+1+i,1,txt,ST.remark); });
  const totalRows=remR+5;
  ws["!cols"]=[5,18,22,10,10,13,13,18,18,16].map(w=>({wch:w}));
  ws["!rows"]=Array(totalRows).fill({hpt:20});
  ws["!ref"]=XLSX.utils.encode_range({s:{r:0,c:0},e:{r:totalRows,c:9}});
  XLSX.utils.book_append_sheet(wb,ws,"对账单");
  XLSX.writeFile(wb,`对账单_${contract.buyer||"客户"}_${new Date().getFullYear()}年${new Date().getMonth()+1}月_${contract.contract_no}.xlsx`,{cellStyles:true,compression:true});
};

// ─── UI: UploadBox ─────────────────────────────────────────────────────────────
const UploadBox = ({ label, onFile, file }) => {
  const ref = useRef();
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0] || e.target.files[0];
    if (!f) return;
    if (f.size > 10*1024*1024) { alert("文件不能超过 10MB"); return; }
    onFile(f);
  }, [onFile]);
  return (
    <div onClick={()=>ref.current.click()} onDrop={onDrop} onDragOver={e=>e.preventDefault()}
      style={{border:file?"2px solid #22c55e":"2px dashed #475569",borderRadius:12,padding:"28px 20px",textAlign:"center",cursor:"pointer",background:file?"#f0fdf4":"#f8fafc",transition:"all .2s",minHeight:110,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:8}}>
      <input ref={ref} type="file" accept="image/*,.pdf,application/pdf" style={{display:"none"}} onChange={onDrop}/>
      {file
        ? <><span style={{fontSize:28}}>✅</span><span style={{fontSize:13,color:"#16a34a",fontWeight:600}}>{file.name}</span><span style={{fontSize:11,color:"#86efac"}}>点击重新上传</span></>
        : <><span style={{fontSize:32}}>📄</span><span style={{fontSize:13,color:"#64748b",fontWeight:600}}>{label}</span><span style={{fontSize:11,color:"#94a3b8"}}>支持图片（JPG/PNG）或 PDF，最大 10MB</span></>}
    </div>
  );
};

// ─── UI: Steps ─────────────────────────────────────────────────────────────────
const Steps = ({ current }) => (
  <div style={{display:"flex",alignItems:"center",justifyContent:"center",marginBottom:28}}>
    {["上传合同","上传送货单","核对 & 导出"].map((s,i)=>(
      <div key={i} style={{display:"flex",alignItems:"center"}}>
        <div style={{width:32,height:32,borderRadius:"50%",fontWeight:700,fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",background:i<current?"#22c55e":i===current?"#1e293b":"#e2e8f0",color:i<=current?"#fff":"#94a3b8",transition:"all .3s"}}>{i<current?"✓":i+1}</div>
        <span style={{marginLeft:8,fontSize:13,fontWeight:i===current?700:400,color:i===current?"#1e293b":i<current?"#22c55e":"#94a3b8"}}>{s}</span>
        {i<2&&<div style={{width:36,height:2,background:i<current?"#22c55e":"#e2e8f0",margin:"0 10px",transition:"all .3s"}}/>}
      </div>
    ))}
  </div>
);

// ─── UI: DeliveryTable ────────────────────────────────────────────────────────
const DeliveryTable = ({ items, contractQty, onChangeInput, onBlurQty }) => {
  const qtys = items.map(it => toNumber(it.delivered_qty, 0));
  const minQty = qtys.length ? Math.min(...qtys) : 0;
  return (
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontSize:13}}>
        <thead><tr style={{background:"#1e293b",color:"#fff"}}>
          {["物料名称","规格","颜色","实送数量","状态"].map(h=>(
            <th key={h} style={{padding:"10px 12px",fontWeight:600,whiteSpace:"nowrap"}}>{h}</th>
          ))}
        </tr></thead>
        <tbody>{items.map((item,i)=>{
          const qty = toNumber(item.delivered_qty, 0);
          const isMin = qty === minQty && qtys.filter(q=>q===minQty).length >= 1;
          const ok = qty >= contractQty;
          return (
            <tr key={i} style={{background:i%2?"#f8fafc":"#fff"}}>
              <td style={{padding:"8px 12px",borderBottom:"1px solid #e2e8f0",fontWeight:500}}>{item.name}</td>
              <td style={{padding:"8px 12px",borderBottom:"1px solid #e2e8f0",fontSize:11,color:"#64748b"}}>{item.spec}</td>
              <td style={{padding:"8px 12px",borderBottom:"1px solid #e2e8f0"}}>{item.color||""}</td>
              <td style={{padding:"8px 12px",borderBottom:"1px solid #e2e8f0",textAlign:"center"}}>
                <input type="number" min="0" value={item.delivered_qty_input??""}
                  onChange={e=>onChangeInput(i,e.target.value)} onBlur={()=>onBlurQty(i)}
                  style={{width:90,textAlign:"center",padding:"4px 8px",borderRadius:6,fontSize:13,outline:"none",fontWeight:isMin?"700":"400",
                    border:ok?"1px solid #22c55e":"1px solid #f97316",
                    background:ok?"#f0fdf4":"#fff7ed"}}/>
                {isMin && <span style={{marginLeft:6,fontSize:11,color:"#f97316",fontWeight:600}}>最小值</span>}
              </td>
              <td style={{padding:"8px 12px",borderBottom:"1px solid #e2e8f0",textAlign:"center"}}>
                {ok
                  ? <span style={{background:"#dcfce7",color:"#16a34a",padding:"2px 10px",borderRadius:20,fontSize:12,fontWeight:600}}>✓ 达标</span>
                  : <span style={{background:"#fee2e2",color:"#dc2626",padding:"2px 10px",borderRadius:20,fontSize:12,fontWeight:600}}>⚠ 不足</span>}
              </td>
            </tr>
          );
        })}</tbody>
      </table>
    </div>
  );
};

// ─── UI: CustomerPage ─────────────────────────────────────────────────────────
const CustomerPage = ({ customers, onRefresh, onBack }) => {
  const [editing, setEditing] = useState(null); // null | 'new' | customer object
  const [form, setForm] = useState({ company_name:"", contact_person:"", phone:"", address:"", products:"" });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const openNew = () => { setForm({company_name:"",contact_person:"",phone:"",address:"",products:""}); setEditing("new"); };
  const openEdit = (c) => { setForm({...c, products: Array.isArray(c.products)?c.products.map(p=>`${p.name} ¥${p.price}`).join("\n"):""}); setEditing(c); };

  const handleSave = async () => {
    if (!form.company_name.trim()) { setMsg("公司名称不能为空"); return; }
    setSaving(true);
    try {
      const products = form.products.trim().split("\n").filter(Boolean).map(line => {
        const m = line.match(/^(.+?)\s*¥([\d.]+)$/);
        return m ? { name: m[1].trim(), price: parseFloat(m[2]) } : { name: line.trim(), price: 0 };
      });
      const data = { company_name: form.company_name.trim(), contact_person: form.contact_person.trim(), phone: form.phone.trim(), address: form.address.trim(), products };
      if (editing === "new") { await saveCustomer(data); }
      else { await updateCustomer(editing.id, data); }
      setMsg("✅ 保存成功");
      setEditing(null);
      onRefresh();
    } catch(e) { setMsg("❌ "+e.message); }
    setSaving(false);
    setTimeout(()=>setMsg(""), 3000);
  };

  const handleDelete = async (id) => {
    if (!confirm("确定删除该客户？")) return;
    await deleteCustomer(id);
    onRefresh();
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:700,color:"#1e293b"}}>👥 客户资料</h3>
        <div style={{display:"flex",gap:8}}>
          <button onClick={openNew} style={{padding:"6px 16px",background:"#1e293b",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>+ 新增客户</button>
          <button onClick={onBack} style={{padding:"6px 16px",background:"#f1f5f9",color:"#1e293b",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>← 返回</button>
        </div>
      </div>

      {msg && <div style={{marginBottom:12,padding:"8px 12px",borderRadius:8,background:"#f0fdf4",color:"#16a34a",fontSize:13}}>{msg}</div>}

      {/* 编辑表单 */}
      {editing && (
        <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:20,marginBottom:20}}>
          <h4 style={{margin:"0 0 14px",fontSize:14,color:"#1e293b"}}>{editing==="new"?"新增客户":"编辑客户"}</h4>
          {[["公司名称 *","company_name"],["联系人","contact_person"],["电话","phone"],["地址","address"]].map(([label,key])=>(
            <div key={key} style={{marginBottom:10}}>
              <div style={{fontSize:12,color:"#64748b",marginBottom:4}}>{label}</div>
              <input value={form[key]} onChange={e=>setForm(f=>({...f,[key]:e.target.value}))}
                style={{width:"100%",padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none",boxSizing:"border-box"}}/>
            </div>
          ))}
          <div style={{marginBottom:12}}>
            <div style={{fontSize:12,color:"#64748b",marginBottom:4}}>常用产品及单价（每行一条，格式：产品名称 ¥单价）</div>
            <textarea value={form.products} onChange={e=>setForm(f=>({...f,products:e.target.value}))} rows={4}
              placeholder={"风扇壳料整套 ¥1.48\n充电器外壳 ¥2.50"}
              style={{width:"100%",padding:"8px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:12,outline:"none",boxSizing:"border-box",resize:"vertical"}}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button onClick={handleSave} disabled={saving}
              style={{padding:"8px 20px",background:"#1e293b",color:"#fff",border:"none",borderRadius:8,fontSize:13,fontWeight:600,cursor:"pointer"}}>
              {saving?"保存中…":"保存"}
            </button>
            <button onClick={()=>setEditing(null)} style={{padding:"8px 16px",background:"#f1f5f9",color:"#64748b",border:"none",borderRadius:8,fontSize:13,cursor:"pointer"}}>取消</button>
          </div>
        </div>
      )}

      {/* 客户列表 */}
      {customers.length === 0
        ? <div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>暂无客户资料，点击"新增客户"添加</div>
        : customers.map(c=>(
          <div key={c.id} style={{border:"1px solid #e2e8f0",borderRadius:10,padding:"14px 16px",marginBottom:10,background:"#fff"}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
              <div>
                <div style={{fontSize:14,fontWeight:700,color:"#1e293b",marginBottom:4}}>{c.company_name}</div>
                <div style={{fontSize:12,color:"#64748b",display:"flex",gap:16,flexWrap:"wrap"}}>
                  {c.contact_person && <span>👤 {c.contact_person}</span>}
                  {c.phone && <span>📞 {c.phone}</span>}
                  {c.address && <span>📍 {c.address}</span>}
                </div>
                {Array.isArray(c.products) && c.products.length > 0 && (
                  <div style={{marginTop:8,display:"flex",gap:6,flexWrap:"wrap"}}>
                    {c.products.map((p,i)=>(
                      <span key={i} style={{background:"#f1f5f9",padding:"2px 10px",borderRadius:20,fontSize:11,color:"#475569"}}>
                        {p.name} ¥{p.price}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div style={{display:"flex",gap:8,flexShrink:0}}>
                <button onClick={()=>openEdit(c)} style={{padding:"4px 12px",background:"#f1f5f9",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",color:"#1e293b"}}>编辑</button>
                <button onClick={()=>handleDelete(c.id)} style={{padding:"4px 12px",background:"#fee2e2",border:"none",borderRadius:6,fontSize:12,cursor:"pointer",color:"#dc2626"}}>删除</button>
              </div>
            </div>
          </div>
        ))
      }
    </div>
  );
};

// ─── UI: HistoryPage ───────────────────────────────────────────────────────────
const HistoryPage = ({ onBack }) => {
  const [list, setList] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(null);

  const load = async (q="") => {
    setLoading(true);
    try { setList(await fetchStatements(q)); }
    catch(e) { alert(e.message); }
    setLoading(false);
  };
  useEffect(()=>{ load(); },[]);

  const handleDelete = async (id) => {
    if(!confirm("确定删除这条记录？")) return;
    await deleteStatement(id);
    load(search);
  };

  const handleExportHistory = () => {
    const rows = list.map(r=>({
      "对账日期": r.created_at?.slice(0,10),
      "合同编号": r.contract_no,
      "买方": r.buyer,
      "产品": r.product_name,
      "合同数量": r.contract_qty,
      "结算数量": r.settle_qty,
      "含税单价": r.unit_price,
      "结算金额": r.total_amt,
      "送货单号": r.delivery_no,
      "操作人": r.operator,
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "历史记录");
    XLSX.writeFile(wb, `对账历史_${formatLocalDate()}.xlsx`);
  };

  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:20}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:700,color:"#1e293b"}}>📚 历史对账记录</h3>
        <div style={{display:"flex",gap:8}}>
          <button onClick={handleExportHistory} style={{padding:"6px 14px",background:"#f1f5f9",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",color:"#1e293b",fontWeight:600}}>导出全部</button>
          <button onClick={onBack} style={{padding:"6px 14px",background:"#1e293b",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",color:"#fff",fontWeight:600}}>+ 新建对账单</button>
        </div>
      </div>
      <div style={{display:"flex",gap:8,marginBottom:16}}>
        <input value={search} onChange={e=>setSearch(e.target.value)} onKeyDown={e=>e.key==="Enter"&&load(search)} placeholder="搜索合同号或客户名…"
          style={{flex:1,padding:"8px 12px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none"}}/>
        <button onClick={()=>load(search)} style={{padding:"8px 16px",background:"#1e293b",color:"#fff",border:"none",borderRadius:8,fontSize:13,cursor:"pointer",fontWeight:600}}>搜索</button>
      </div>
      {loading
        ? <div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>加载中…</div>
        : list.length===0
          ? <div style={{textAlign:"center",padding:40,color:"#94a3b8"}}>暂无记录</div>
          : list.map(r=>(
            <div key={r.id} style={{border:"1px solid #e2e8f0",borderRadius:10,marginBottom:10,overflow:"hidden"}}>
              <div onClick={()=>setExpanded(expanded===r.id?null:r.id)}
                style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"12px 16px",cursor:"pointer",background:expanded===r.id?"#f8fafc":"#fff"}}>
                <div style={{display:"flex",gap:16,alignItems:"center",flexWrap:"wrap"}}>
                  <span style={{fontSize:13,fontWeight:700,color:"#1e293b"}}>{r.contract_no}</span>
                  <span style={{fontSize:12,color:"#64748b"}}>{r.buyer}</span>
                  <span style={{fontSize:12,background:"#f1f5f9",padding:"2px 8px",borderRadius:12,color:"#475569"}}>{r.product_name}</span>
                </div>
                <div style={{display:"flex",gap:12,alignItems:"center"}}>
                  <span style={{fontSize:13,fontWeight:700,color:"#dc2626"}}>¥{toNumber(r.total_amt).toLocaleString("zh-CN",{minimumFractionDigits:2})}</span>
                  <span style={{fontSize:11,color:"#94a3b8"}}>{r.created_at?.slice(0,10)}</span>
                  <button onClick={e=>{e.stopPropagation();handleDelete(r.id);}} style={{background:"#fee2e2",border:"none",borderRadius:6,padding:"2px 8px",fontSize:12,color:"#dc2626",cursor:"pointer"}}>删除</button>
                  <span style={{color:"#94a3b8",fontSize:12}}>{expanded===r.id?"▲":"▼"}</span>
                </div>
              </div>
              {expanded===r.id&&(
                <div style={{padding:"12px 16px",borderTop:"1px solid #e2e8f0",background:"#f8fafc"}}>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:"6px 20px",fontSize:12,marginBottom:12}}>
                    {[["合同编号",r.contract_no],["合同日期",r.contract_date],["送货单号",r.delivery_no||"—"],
                      ["卖方",r.seller],["买方",r.buyer],["产品",r.product_name],
                      ["合同数量",`${r.contract_qty}套`],["结算数量",`${r.settle_qty}套`],["结算金额",`¥${toNumber(r.total_amt).toFixed(2)}`]
                    ].map(([k,v])=>(
                      <div key={k} style={{display:"flex",gap:6}}><span style={{color:"#94a3b8",minWidth:60}}>{k}：</span><span style={{color:"#1e293b",fontWeight:500}}>{v}</span></div>
                    ))}
                  </div>
                  {Array.isArray(r.items)&&r.items.length>0&&(
                    <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
                      <thead><tr style={{background:"#1e293b",color:"#fff"}}>
                        {["物料","规格","合同量","实送量"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"center"}}>{h}</th>)}
                      </tr></thead>
                      <tbody>{r.items.map((it,i)=>(
                        <tr key={i} style={{background:i%2?"#f1f5f9":"#fff"}}>
                          <td style={{padding:"6px 10px"}}>{it.name}</td>
                          <td style={{padding:"6px 10px",color:"#64748b",fontSize:11}}>{it.spec}</td>
                          <td style={{padding:"6px 10px",textAlign:"center"}}>{it.contract_qty}</td>
                          <td style={{padding:"6px 10px",textAlign:"center",fontWeight:600,color:toNumber(it.delivered_qty,0)>=it.contract_qty?"#16a34a":"#dc2626"}}>{toNumber(it.delivered_qty,0)}</td>
                        </tr>
                      ))}</tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          ))
      }
    </div>
  );
};

// ─── 主应用 ────────────────────────────────────────────────────────────────────
export default function App() {
  const [page, setPage] = useState("main");
  const [step, setStep] = useState(0);
  const [contractFile, setContractFile] = useState(null);
  const [deliveryFiles, setDeliveryFiles] = useState([]); // multiple delivery notes
  const [contract, setContract] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [drafts, setDrafts] = useState({}); // 所有草稿
  const [showDraftPanel, setShowDraftPanel] = useState(false);
  const [inputMode, setInputMode] = useState("upload"); // "upload" | "manual"
  const [manualForm, setManualForm] = useState({contract_no:"",contract_date:"",buyer:"",seller:"深圳市源丰隆实业有限公司",seller_contact:"梁生",buyer_contact:"",product_name:"",contract_qty:"",unit_price:"",trade_mode:"含增值税13%",amount_cn:"",delivery_no:""});
  const [manualItems, setManualItems] = useState([{name:"",spec:"",color:"白色",unit:"件",contract_qty:"",delivered_qty:"",note:""}]);
  const [customers, setCustomers] = useState([]);
  const [matchedCustomer, setMatchedCustomer] = useState(null);

  // ── 启动时加载所有草稿 + 客户 ──
  useEffect(() => {
    setDrafts(loadAllDrafts());
    fetchCustomers().then(setCustomers).catch(()=>{});
  }, []);

  // ── 自动保存草稿 ──
  useEffect(() => {
    if (step >= 1 && contract?.contract_no) {
      saveDraft(step, contract, items);
      setDrafts(loadAllDrafts());
    }
  }, [step, contract, items]);

  const resumeDraft = (draft) => {
    setStep(draft.step);
    setContract(draft.contract);
    setItems(draft.items);
    setShowDraftPanel(false);
    setPage("main");
  };

  const deleteDraft = (contractNo) => {
    clearDraft(contractNo);
    setDrafts(loadAllDrafts());
    fetchCustomers().then(setCustomers).catch(()=>{});
    // 如果删的是当前编辑中的草稿，重置
    if (contract?.contract_no === contractNo) resetAll();
  };

  const addDeliveryFiles = (files) => {
    const incoming = Array.from(files || []).filter(f => f && f.size <= 10 * 1024 * 1024);
    if (!incoming.length) return;
    setDeliveryFiles(prev => {
      const seen = new Set(prev.map(f => `${f.name}|${f.size}|${f.lastModified}`));
      const next = [...prev];
      for (const f of incoming) {
        const key = `${f.name}|${f.size}|${f.lastModified}`;
        if (!seen.has(key)) {
          seen.add(key);
          next.push(f);
        }
      }
      return next;
    });
  };

  // ── 数量输入 ──
  const updateQtyInput = (i, raw) =>
    setItems(prev => prev.map((it, idx) => idx===i ? {...it, delivered_qty_input: raw} : it));

  const commitQtyInput = (i) =>
    setItems(prev => prev.map((it, idx) => {
      if (idx!==i) return it;
      const raw = String(it.delivered_qty_input ?? "").trim();
      if (raw==="") return {...it, delivered_qty: null};
      const n = Number(raw);
      return {...it, delivered_qty: Number.isFinite(n) ? n : null};
    }));

  // ── 手动填写合同 ──
  const submitManual = () => {
    const f = manualForm;
    const contractQty = toNumber(f.contract_qty, 0);
    const unitPrice = toNumber(f.unit_price, 0);
    if (!f.contract_no.trim() || !f.buyer.trim() || contractQty <= 0 || unitPrice <= 0) {
      setError("请填写合同号、买方、有效数量和有效单价");
      return;
    }
    const normalized = normalizeContract({
      ...f,
      contract_date: f.contract_date || formatLocalDate(),
      contract_qty: contractQty,
      unit_price: unitPrice,
      items: [],
    });
    setContract(normalized);
    setItems([]);
    setManualItems([{
      name: normalized.product_name || "",
      spec: "",
      color: "白色",
      unit: "件",
      contract_qty: String(normalized.contract_qty || ""),
      delivered_qty: String(normalized.contract_qty || ""),
      note: "",
    }]);
    const mc = matchCustomer(normalized.buyer, customers);
    setMatchedCustomer(mc || null);
    setError("");
    setStep(1);
  };

  const updateManualItem = (idx, key, value) => {
    setManualItems(prev => prev.map((it, i) => i === idx ? {...it, [key]: value} : it));
  };

  const addManualItem = () => {
    setManualItems(prev => [...prev, {name:"",spec:"",color:"白色",unit:"件",contract_qty:String(contract?.contract_qty || ""),delivered_qty:"",note:""}]);
  };

  const removeManualItem = (idx) => {
    setManualItems(prev => prev.length <= 1 ? prev : prev.filter((_, i) => i !== idx));
  };

  const submitManualDelivery = () => {
    const rows = manualItems
      .map(it => {
        const deliveredQty = toNumber(it.delivered_qty, 0);
        return {
          name: String(it.name || "").trim(),
          spec: String(it.spec || "").trim(),
          color: String(it.color || "白色").trim(),
          unit: String(it.unit || "件").trim(),
          contract_qty: toNumber(it.contract_qty, contract?.contract_qty || 0),
          delivered_qty: deliveredQty,
          delivered_qty_input: deliveredQty ? String(deliveredQty) : "",
          note: String(it.note || "").trim(),
        };
      })
      .filter(it => it.name && it.delivered_qty > 0);

    if (!rows.length) {
      setError("请至少填写一条送货明细，并填写实送数量");
      return;
    }
    setItems(rows);
    setContract(c => ({...c, delivery_no: manualForm.delivery_no || c?.delivery_no || ""}));
    setError("");
    setStep(2);
  };

  const mergeDeliveryItems = (rows) => {
    const map = new Map();
    for (const it of rows) {
      const key = [it.name, it.spec, it.color || "白色", it.unit || "件"].map(v => String(v || "").replace(/\s+/g, "").toLowerCase()).join("|");
      const prev = map.get(key);
      if (prev) {
        const qty = toNumber(prev.delivered_qty, 0) + toNumber(it.delivered_qty, 0);
        prev.delivered_qty = qty;
        prev.delivered_qty_input = String(qty);
        prev.note = [prev.note, it.note].filter(Boolean).join(" / ");
      } else {
        map.set(key, {...it});
      }
    }
    return Array.from(map.values());
  };

  // ── 解析合同 ──
  const parseContract = async () => {
    if (!contractFile) return;
    setLoading(true); setLoadingMsg("AI 正在识别合同…"); setError("");
    try {
      const b64 = await toBase64(contractFile);
      const mime = contractFile.type || "image/jpeg";
      const isPdf = mime === "application/pdf";
      const content = isPdf
        ? [{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}}]
        : [{type:"image",source:{type:"base64",media_type:mime,data:b64}}];
      content.push({type:"text",text:`从这份采购合同提取信息。只输出一个JSON对象，不要任何解释、不要markdown代码块，直接以{开头以}结尾：{"contract_no":"","contract_date":"YYYY-MM-DD","seller":"","seller_contact":"","buyer":"","buyer_contact":"","product_name":"","contract_qty":0,"unit_price":0,"trade_mode":"","amount_cn":""}`});
      const raw = await callClaude([{role:"user",content}], "你是采购文件解析助手。严格只输出纯JSON，绝对不要输出任何其他文字、解释或markdown格式，第一个字符必须是{，最后一个字符必须是}。");
      const normalized = normalizeContract(raw);
      setContract(normalized);
      setItems([]); // 清空，等送货单填充
      const mc = matchCustomer(normalized.buyer, customers); setMatchedCustomer(mc || null);
      setStep(1);
    } catch(e) { setError("合同解析失败："+e.message); }
    setLoading(false);
  };

  // ── 解析送货单（支持多张）──
  const parseDelivery = async () => {
    if (!deliveryFiles.length) return;
    setLoading(true); setError("");
    try {
      let allItems = [];
      let allNos = [];
      for (let i = 0; i < deliveryFiles.length; i++) {
        const file = deliveryFiles[i];
        setLoadingMsg(`AI 正在识别第 ${i+1}/${deliveryFiles.length} 张送货单…`);
        const b64 = await toBase64(file);
        const mime = file.type || "image/jpeg";
        const isPdf = mime === "application/pdf";
        const msgContent = isPdf
          ? [{type:"document",source:{type:"base64",media_type:"application/pdf",data:b64}}]
          : [{type:"image",source:{type:"base64",media_type:mime,data:b64}}];
        msgContent.push({type:"text",text:`请读取这张中文送货单照片。照片可能横拍、竖拍、旋转90度、轻微倾斜或有阴影，请先按文字方向理解表格。

需要识别：
- delivery_no：票据右侧或标题旁的 NO / 单号，例如 06-24-01。
- delivery_date：日期，例如 2026-06-24；看不清则空字符串。
- customer_name：客户名称。
- order_no：订单号。
- items：逐行读取表格里的货物编码、货物名称、规格、单位、数量、备注。

表格规则：
- 规格栏可能是算式，如 1064×40+550 或 1064*40+550；不要计算规格栏。
- 数量必须取“数量”列最终数字，例如 43110、23150。
- 备注列数字如 41、11 不要当成数量。
- 空白行忽略。
- 看不清的字段用空字符串，不要猜。

只输出一个合法 JSON 对象，不要markdown，不要解释，不要代码块：
{"delivery_no":"","delivery_date":"","customer_name":"","order_no":"","items":[{"code":"","name":"","spec":"","unit":"件","delivered_qty":0,"remark":""}]}`});
        const raw = await callClaude([{role:"user",content:msgContent}], "你是中文送货单OCR结构化助手。必须只返回合法JSON对象，不能返回markdown、解释、前后缀文字。", 2500);
        const parsed = (raw.items || []).map(it=>{
          const qty = toNumber(it.delivered_qty ?? it.qty ?? it.quantity, 0);
          return {
            code: String(it.code || it.item_code || "").trim(),
            name: String(it.name || it.product_name || it.goods_name || "").trim(),
            spec: String(it.spec || it.specification || "").trim(),
            color: String(it.color || "白色").trim(),
            unit: String(it.unit || "件").trim(),
            contract_qty: toNumber(it.contract_qty, contract?.contract_qty || 0),
            delivered_qty: qty,
            delivered_qty_input: qty ? String(qty) : "",
            note: [raw.delivery_no, it.remark || it.note || ""].filter(Boolean).join(" / "),
          };
        }).filter(it => it.name && it.delivered_qty > 0);
        allItems = [...allItems, ...parsed];
        if (raw.delivery_no) allNos.push(raw.delivery_no);
      }
      setItems(mergeDeliveryItems(allItems));
      if (allNos.length) setContract(c=>({...c, delivery_no: allNos.join(" / ")}));
      setStep(2);
    } catch(e) { setError("送货单解析失败："+e.message); }
    setLoading(false);
  };

  // ── 生成 Excel + 保存 ──
  const doGenerate = async () => {
    const committed = items.map(it => {
      const raw = String(it.delivered_qty_input ?? "").trim();
      const n = raw==="" ? 0 : Number(raw);
      return {...it, delivered_qty: Number.isFinite(n) ? n : 0};
    });
    const s = calcSettlement(contract, committed);
    const contractWithMode = {...contract, settlement_mode: "actual"};
    generateExcel(contractWithMode, committed, s);
    clearDraft(contract.contract_no);
    setDrafts(loadAllDrafts());
    fetchCustomers().then(setCustomers).catch(()=>{});
    try {
      setSaveMsg("正在保存记录…");
      await saveStatement(contractWithMode, committed, s);
      setSaveMsg("✅ 已保存到历史记录，草稿已清除");
      setTimeout(()=>setSaveMsg(""), 4000);
    } catch(e) { setSaveMsg("⚠ 导出成功，但保存记录失败："+e.message); }
  };

  const resetAll = () => {
    if (contract?.contract_no) clearDraft(contract.contract_no);
    setDrafts(loadAllDrafts());
    fetchCustomers().then(setCustomers).catch(()=>{});
    setStep(0); setContract(null); setItems([]); setContractFile(null);
    setDeliveryFiles([]); setError(""); setSaveMsg(""); setInputMode("upload");
    setManualForm({contract_no:"",contract_date:"",buyer:"",seller:"深圳市源丰隆实业有限公司",seller_contact:"梁生",buyer_contact:"",product_name:"",contract_qty:"",unit_price:"",trade_mode:"含增值税13%",amount_cn:"",delivery_no:""});
    setManualItems([{name:"",spec:"",color:"白色",unit:"件",contract_qty:"",delivered_qty:"",note:""}]);
    setMatchedCustomer(null);
  };

  const settlement = contract && items.length > 0 ? calcSettlement(contract, items) : null;
  const canGenerate = settlement?.canSettle ?? false;


  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#f0f4f8,#e8edf2)",fontFamily:"'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif",padding:"32px 16px"}}>
      <div style={{maxWidth:880,margin:"0 auto"}}>

        {/* 标题 */}
        <div style={{textAlign:"center",marginBottom:28}}>
          <div style={{display:"inline-flex",alignItems:"center",gap:12,background:"#1e293b",color:"#fff",padding:"10px 24px",borderRadius:40,marginBottom:12}}>
            <span style={{fontSize:20}}>📋</span>
            <span style={{fontSize:15,fontWeight:700,letterSpacing:2}}>对账单智能生成工具</span>
          </div>
          <p style={{color:"#64748b",fontSize:13,margin:0}}>上传或手动录入合同 → 比对送货数量 → 一键导出 Excel 对账单</p>
        </div>

        {/* 草稿面板 */}
        {showDraftPanel && Object.keys(drafts).length > 0 && (
          <div style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:12,padding:"16px 18px",marginBottom:16}}>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
              <span style={{fontWeight:700,color:"#92400e",fontSize:14}}>📝 草稿箱（{Object.keys(drafts).length} 个）</span>
              <button onClick={()=>setShowDraftPanel(false)} style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:16}}>✕</button>
            </div>
            {Object.values(drafts).sort((a,b)=>b.savedAt.localeCompare(a.savedAt)).map(d=>(
              <div key={d.contract.contract_no} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"10px 12px",background:"#fff",borderRadius:8,marginBottom:8,border:"1px solid #fde68a"}}>
                <div>
                  <span style={{fontWeight:700,color:"#1e293b",fontSize:13}}>{d.contract.contract_no}</span>
                  <span style={{fontSize:12,color:"#64748b",marginLeft:10}}>{d.contract.buyer}</span>
                  <span style={{fontSize:11,color:"#b45309",marginLeft:10}}>
                    {["第1步","第2步","第3步"][d.step] || ""} · {new Date(d.savedAt).toLocaleString("zh-CN")}
                  </span>
                </div>
                <div style={{display:"flex",gap:8}}>
                  <button onClick={()=>resumeDraft(d)}
                    style={{padding:"4px 14px",background:"#1e293b",color:"#fff",border:"none",borderRadius:6,fontSize:12,fontWeight:600,cursor:"pointer"}}>
                    继续
                  </button>
                  <button onClick={()=>deleteDraft(d.contract.contract_no)}
                    style={{padding:"4px 10px",background:"#fee2e2",color:"#dc2626",border:"none",borderRadius:6,fontSize:12,cursor:"pointer"}}>
                    删除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* 草稿提示（有草稿但面板未展开时） */}
        {!showDraftPanel && Object.keys(drafts).length > 0 && (
          <div onClick={()=>setShowDraftPanel(true)}
            style={{background:"#fffbeb",border:"1px solid #fcd34d",borderRadius:12,padding:"10px 18px",marginBottom:16,cursor:"pointer",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <span style={{fontWeight:600,color:"#92400e",fontSize:13}}>📝 有 {Object.keys(drafts).length} 个未完成草稿</span>
            <span style={{fontSize:12,color:"#b45309"}}>点击查看 ▼</span>
          </div>
        )}

        {/* 导航 */}
        <div style={{display:"flex",justifyContent:"flex-end",marginBottom:16,gap:8}}>
          <button onClick={()=>setPage("main")}
            style={{padding:"6px 16px",borderRadius:20,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",background:page==="main"?"#1e293b":"#e2e8f0",color:page==="main"?"#fff":"#64748b"}}>
            ＋ 新建对账单
          </button>
          <button onClick={()=>setPage("history")}
            style={{padding:"6px 16px",borderRadius:20,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",background:page==="history"?"#1e293b":"#e2e8f0",color:page==="history"?"#fff":"#64748b"}}>
            📚 历史记录
          </button>
          <button onClick={()=>{setPage("customers");fetchCustomers().then(setCustomers).catch(()=>{});}}
            style={{padding:"6px 16px",borderRadius:20,border:"none",fontSize:13,fontWeight:600,cursor:"pointer",background:page==="customers"?"#1e293b":"#e2e8f0",color:page==="customers"?"#fff":"#64748b"}}>
            👥 客户资料
          </button>
        </div>

        <div style={{background:"#fff",borderRadius:16,padding:28,boxShadow:"0 4px 24px rgba(0,0,0,.07)"}}>

          {/* 历史记录 */}
          {page==="history" && <HistoryPage onBack={()=>setPage("main")}/>}

          {/* 客户资料 */}
          {page==="customers" && <CustomerPage customers={customers} onRefresh={()=>fetchCustomers().then(setCustomers).catch(()=>{})} onBack={()=>setPage("main")}/>}

          {/* 主流程 */}
          {page==="main" && (
            <>
              <Steps current={step}/>

              {/* STEP 0: 上传 / 手动录入合同 */}
              {step===0 && (
                <div>
                  <h3 style={{margin:"0 0 20px",fontSize:16,color:"#1e293b",fontWeight:700}}>第一步：建立合同资料</h3>
                  <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:18}}>
                    <button onClick={()=>{setInputMode("upload");setError("");}}
                      style={{padding:"12px 0",borderRadius:10,border:"none",fontWeight:700,cursor:"pointer",background:inputMode==="upload"?"#1e293b":"#e2e8f0",color:inputMode==="upload"?"#fff":"#64748b"}}>
                      📄 上传识别
                    </button>
                    <button onClick={()=>{setInputMode("manual");setError("");}}
                      style={{padding:"12px 0",borderRadius:10,border:"none",fontWeight:700,cursor:"pointer",background:inputMode==="manual"?"#1e293b":"#e2e8f0",color:inputMode==="manual"?"#fff":"#64748b"}}>
                      ✍️ 手动制单
                    </button>
                  </div>

                  {inputMode === "upload" ? (
                    <>
                      <UploadBox label="上传合同图片（JPG/PNG）或 PDF" onFile={setContractFile} file={contractFile}/>
                      {error&&<div style={{color:"#dc2626",fontSize:13,marginTop:12,padding:"8px 12px",background:"#fef2f2",borderRadius:8}}>{error}</div>}
                      <button onClick={parseContract} disabled={!contractFile||loading}
                        style={{marginTop:20,width:"100%",padding:"14px 0",borderRadius:10,fontWeight:700,fontSize:15,border:"none",letterSpacing:1,
                          cursor:contractFile&&!loading?"pointer":"not-allowed",
                          background:contractFile&&!loading?"#1e293b":"#e2e8f0",
                          color:contractFile&&!loading?"#fff":"#94a3b8"}}>
                        {loading?`⏳ ${loadingMsg}`:"解析合同 →"}
                      </button>
                    </>
                  ) : (
                    <div style={{background:"#f8fafc",border:"1px solid #e2e8f0",borderRadius:12,padding:18}}>
                      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
                        {[
                          ["合同编号 *","contract_no"],["合同日期","contract_date"],
                          ["买方 *","buyer"],["买方联系人","buyer_contact"],
                          ["卖方","seller"],["卖方联系人","seller_contact"],
                          ["产品名称","product_name"],["送货单号","delivery_no"],
                          ["合同数量 *","contract_qty"],["含税单价 *","unit_price"],
                          ["贸易方式","trade_mode"],["金额大写","amount_cn"],
                        ].map(([label,key])=>(
                          <div key={key}>
                            <div style={{fontSize:12,color:"#64748b",marginBottom:4}}>{label}</div>
                            <input value={manualForm[key]} onChange={e=>setManualForm(f=>({...f,[key]:e.target.value}))}
                              placeholder={key==="contract_date"?formatLocalDate():""}
                              style={{width:"100%",boxSizing:"border-box",padding:"9px 10px",border:"1px solid #e2e8f0",borderRadius:8,fontSize:13,outline:"none"}}/>
                          </div>
                        ))}
                      </div>
                      {error&&<div style={{color:"#dc2626",fontSize:13,marginTop:12,padding:"8px 12px",background:"#fef2f2",borderRadius:8}}>{error}</div>}
                      <button onClick={submitManual}
                        style={{marginTop:18,width:"100%",padding:"14px 0",borderRadius:10,fontWeight:700,fontSize:15,border:"none",cursor:"pointer",background:"#1e293b",color:"#fff"}}>
                        下一步：录入送货明细 →
                      </button>
                    </div>
                  )}
                </div>
              )}

              {step>=1 && contract && (
                <div>
                  {/* 合同摘要 */}
                  <div style={{background:"#f8fafc",borderRadius:10,padding:16,marginBottom:24,border:"1px solid #e2e8f0"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                      <h4 style={{margin:0,fontSize:14,color:"#1e293b",fontWeight:700}}>📄 合同信息</h4>
                      <button onClick={resetAll} style={{fontSize:12,color:"#94a3b8",background:"none",border:"none",cursor:"pointer"}}>重新上传合同</button>
                    </div>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:"5px 20px",fontSize:13}}>
                      {[["合同编号",contract.contract_no],["合同日期",contract.contract_date],
                        ["卖方",contract.seller],["买方",contract.buyer],
                        ["产品",contract.product_name],["合同数量",`${contract.contract_qty} 套`],
                        ["含税单价",`¥${contract.unit_price}`],["贸易方式",contract.trade_mode]
                      ].map(([k,v])=>(
                        <div key={k} style={{display:"flex",gap:6}}><span style={{color:"#94a3b8",minWidth:60}}>{k}：</span><span style={{color:"#1e293b",fontWeight:500}}>{v}</span></div>
                      ))}
                    </div>
                  </div>

                  {/* 匹配客户提示 */}
                  {matchedCustomer && (
                    <div style={{background:"#eff6ff",border:"1px solid #bfdbfe",borderRadius:10,padding:"10px 14px",marginBottom:14,fontSize:13}}>
                      <span style={{fontWeight:700,color:"#1d4ed8"}}>👥 已匹配客户：</span>
                      <span style={{color:"#1e293b",marginLeft:6}}>{matchedCustomer.company_name}</span>
                      {matchedCustomer.contact_person && <span style={{color:"#64748b",marginLeft:10}}>联系人：{matchedCustomer.contact_person}</span>}
                      {matchedCustomer.phone && <span style={{color:"#64748b",marginLeft:10}}>📞 {matchedCustomer.phone}</span>}
                      {Array.isArray(matchedCustomer.products) && matchedCustomer.products.length>0 && (
                        <div style={{marginTop:6,display:"flex",gap:6,flexWrap:"wrap"}}>
                          {matchedCustomer.products.map((p,i)=>(
                            <span key={i} style={{background:"#dbeafe",padding:"2px 8px",borderRadius:12,fontSize:11,color:"#1d4ed8"}}>{p.name} ¥{p.price}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* STEP 1: 上传或手动录入送货单 */}
                  {step===1 && (
                    inputMode === "manual" ? (
                      <>
                        <h3 style={{margin:"0 0 16px",fontSize:16,color:"#1e293b",fontWeight:700}}>第二步：手动录入送货明细</h3>
                        <div style={{overflowX:"auto",border:"1px solid #e2e8f0",borderRadius:10}}>
                          <table style={{width:"100%",borderCollapse:"collapse",fontSize:12,minWidth:760}}>
                            <thead>
                              <tr style={{background:"#1e293b",color:"#fff"}}>
                                {["物料名称*","规格","颜色","单位","合同量","实送量*","备注","操作"].map(h=><th key={h} style={{padding:"8px 10px",textAlign:"center"}}>{h}</th>)}
                              </tr>
                            </thead>
                            <tbody>
                              {manualItems.map((it,i)=>(
                                <tr key={i} style={{background:i%2?"#f8fafc":"#fff"}}>
                                  {["name","spec","color","unit","contract_qty","delivered_qty","note"].map(key=>(
                                    <td key={key} style={{padding:"6px",borderBottom:"1px solid #e2e8f0"}}>
                                      <input value={it[key] || ""} onChange={e=>updateManualItem(i,key,e.target.value)}
                                        style={{width:"100%",boxSizing:"border-box",padding:"6px 8px",border:"1px solid #e2e8f0",borderRadius:6,fontSize:12,outline:"none",textAlign:["contract_qty","delivered_qty"].includes(key)?"center":"left"}}/>
                                    </td>
                                  ))}
                                  <td style={{padding:"6px",borderBottom:"1px solid #e2e8f0",textAlign:"center"}}>
                                    <button onClick={()=>removeManualItem(i)} style={{border:"none",background:"#fee2e2",color:"#dc2626",borderRadius:6,padding:"5px 9px",cursor:"pointer"}}>删除</button>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                        <button onClick={addManualItem} style={{marginTop:10,width:"100%",padding:"10px 0",borderRadius:10,border:"1px dashed #94a3b8",background:"#f8fafc",color:"#475569",fontWeight:600,cursor:"pointer"}}>＋ 新增一条物料</button>
                        {error&&<div style={{color:"#dc2626",fontSize:13,marginTop:12,padding:"8px 12px",background:"#fef2f2",borderRadius:8}}>{error}</div>}
                        <button onClick={submitManualDelivery}
                          style={{marginTop:16,width:"100%",padding:"14px 0",borderRadius:10,fontWeight:700,fontSize:15,border:"none",cursor:"pointer",background:"#1e293b",color:"#fff"}}>
                          进入核对并生成对账单 →
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 style={{margin:"0 0 16px",fontSize:16,color:"#1e293b",fontWeight:700}}>第二步：上传送货单</h3>
                        <div
                          onClick={()=>{const inp=document.createElement("input");inp.type="file";inp.accept="image/*,.pdf,application/pdf";inp.multiple=true;inp.onchange=e=>addDeliveryFiles(e.target.files);inp.click();}}
                          onDrop={e=>{e.preventDefault();addDeliveryFiles(e.dataTransfer.files);}}
                          onDragOver={e=>e.preventDefault()}
                          style={{border:"2px dashed #475569",borderRadius:12,padding:"24px 20px",textAlign:"center",cursor:"pointer",background:"#f8fafc",minHeight:90,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6}}>
                          <span style={{fontSize:28}}>📄</span>
                          <span style={{fontSize:13,color:"#64748b",fontWeight:600}}>点击或拖拽上传送货单（可多张）</span>
                          <span style={{fontSize:11,color:"#94a3b8"}}>支持 JPG/PNG/PDF，可同时选多个文件</span>
                        </div>
                        {deliveryFiles.length>0 && (
                          <div style={{marginTop:10,display:"flex",flexDirection:"column",gap:6}}>
                            {deliveryFiles.map((f,i)=>(
                              <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"6px 12px",background:"#f0fdf4",borderRadius:8,border:"1px solid #86efac"}}>
                                <span style={{fontSize:12,color:"#16a34a",fontWeight:600}}>✅ {f.name}</span>
                                <button onClick={()=>setDeliveryFiles(prev=>prev.filter((_,idx)=>idx!==i))}
                                  style={{background:"none",border:"none",color:"#94a3b8",cursor:"pointer",fontSize:14,padding:"0 4px"}}>✕</button>
                              </div>
                            ))}
                            <button onClick={()=>setDeliveryFiles([])} style={{fontSize:11,color:"#94a3b8",background:"none",border:"none",cursor:"pointer",textAlign:"right"}}>清空全部</button>
                          </div>
                        )}
                        {error&&<div style={{color:"#dc2626",fontSize:13,marginTop:12,padding:"8px 12px",background:"#fef2f2",borderRadius:8}}>{error}</div>}
                        <button onClick={parseDelivery} disabled={!deliveryFiles.length||loading}
                          style={{marginTop:16,width:"100%",padding:"14px 0",borderRadius:10,fontWeight:700,fontSize:15,border:"none",letterSpacing:1,
                            cursor:deliveryFiles.length&&!loading?"pointer":"not-allowed",
                            background:deliveryFiles.length&&!loading?"#1e293b":"#e2e8f0",
                            color:deliveryFiles.length&&!loading?"#fff":"#94a3b8"}}>
                          {loading?`⏳ ${loadingMsg}`:`解析送货单${deliveryFiles.length>1?` (${deliveryFiles.length}张)`:""} →`}
                        </button>
                      </>
                    )
                  )}

                  {/* STEP 2: 核对数量 */}
                  {step===2 && (
                    <>
                      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                        <h3 style={{margin:0,fontSize:16,color:"#1e293b",fontWeight:700}}>第三步：核对数量</h3>
                        <button onClick={()=>{setStep(1);setDeliveryFiles([]);setError("");}}
                          style={{fontSize:12,color:"#64748b",background:"#f1f5f9",border:"none",borderRadius:6,padding:"4px 12px",cursor:"pointer"}}>
                          重新上传送货单
                        </button>
                      </div>

                      {/* 结算摘要 */}
                      {settlement && (
                        <div style={{padding:"12px 16px",borderRadius:10,marginBottom:16,
                          background:canGenerate?"#dcfce7":"#fff7ed",
                          border:`1px solid ${canGenerate?"#86efac":"#fdba74"}`}}>
                          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
                            <div>
                              <span style={{fontSize:13,fontWeight:700,color:canGenerate?"#15803d":"#c2410c"}}>
                                {canGenerate?"✅ 送货数量达标，可生成对账单":"⚠️ 最小送货量不足，请确认后再生成"}
                              </span>
                              <div style={{fontSize:12,color:"#64748b",marginTop:4}}>
                                合同数量 <b>{contract.contract_qty}</b> 套 · 送货最小值 <b style={{color:canGenerate?"#16a34a":"#dc2626"}}>{settlement.minQty}</b> 件 · 结算数量 <b>{settlement.settleQty}</b> 套
                              </div>
                            </div>
                            <div style={{fontSize:18,fontWeight:700,color:"#dc2626"}}>
                              ¥{settlement.totalAmt.toLocaleString("zh-CN",{minimumFractionDigits:2})}
                            </div>
                          </div>
                        </div>
                      )}

                      <DeliveryTable items={items} contractQty={contract.contract_qty} onChangeInput={updateQtyInput} onBlurQty={commitQtyInput}/>

                      {error&&<div style={{color:"#dc2626",fontSize:13,marginTop:12,padding:"8px 12px",background:"#fef2f2",borderRadius:8}}>{error}</div>}
                      {saveMsg&&<div style={{fontSize:13,marginTop:12,padding:"8px 12px",background:"#f0fdf4",borderRadius:8,color:"#16a34a"}}>{saveMsg}</div>}

                      {canGenerate ? (
                        <div style={{marginTop:20,padding:"16px",background:"#f0fdf4",borderRadius:12,border:"1px solid #86efac"}}>
                          <div style={{fontSize:14,fontWeight:700,color:"#15803d",marginBottom:12,textAlign:"center"}}>
                            ✅ 送货数量已达标，是否现在生成对账单？
                          </div>
                          <div style={{display:"flex",gap:12}}>
                            <button onClick={doGenerate}
                              style={{flex:1,padding:"14px 0",borderRadius:10,fontWeight:700,fontSize:15,border:"none",cursor:"pointer",color:"#fff",
                                background:"linear-gradient(135deg,#16a34a,#15803d)",boxShadow:"0 4px 12px rgba(22,163,74,.3)"}}>
                              📥 立即生成
                            </button>
                            <button onClick={()=>{}}
                              style={{flex:1,padding:"14px 0",borderRadius:10,fontWeight:600,fontSize:15,border:"1px solid #86efac",cursor:"pointer",color:"#15803d",background:"#fff"}}>
                              ✏️ 继续修改数量
                            </button>
                          </div>
                        </div>
                      ) : (
                        <div style={{marginTop:20,display:"flex",flexDirection:"column",gap:10}}>
                          <div style={{padding:"12px 16px",background:"#fff7ed",borderRadius:10,fontSize:13,color:"#c2410c",textAlign:"center",border:"1px solid #fdba74"}}>
                            送货最小值（{settlement?.minQty??0}）低于合同数量（{contract.contract_qty}），请确认数量后再生成
                          </div>
                          <button onClick={doGenerate}
                            style={{width:"100%",padding:"12px 0",borderRadius:10,fontWeight:600,fontSize:14,border:"1px solid #fdba74",cursor:"pointer",color:"#c2410c",background:"#fff7ed"}}>
                            仍要生成对账单（按实际数量）
                          </button>
                        </div>
                      )}

                      <button onClick={resetAll}
                        style={{marginTop:12,width:"100%",padding:"10px 0",borderRadius:10,fontWeight:600,fontSize:14,border:"1px solid #e2e8f0",cursor:"pointer",color:"#64748b",background:"#f8fafc"}}>
                        🔄 新建下一张对账单
                      </button>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <p style={{textAlign:"center",fontSize:11,color:"#cbd5e1",marginTop:20}}>
          深圳市源丰隆实业有限公司 · 对账单智能生成工具 v4 · 格式基于 P026010606 标准模板
        </p>
      </div>
    </div>
  );
}
