import { useState, useRef, useCallback } from "react";
import * as XLSX from "xlsx";

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

// ─── Claude API（带正确请求头） ────────────────────────────────────────────────
const callClaude = async (messages, system) => {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": import.meta.env.VITE_ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-sonnet-4-20250514",
      max_tokens: 1200,
      system,
      messages,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || `HTTP ${res.status}`);
  const text = data.content?.map((b) => b.text || "").join("").trim() || "";
  const clean = text.replace(/```json[\s\S]*?```|```/g, "").trim();
  try {
    return JSON.parse(clean);
  } catch {
    throw new Error("模型返回的不是合法 JSON，请重试");
  }
};

// ─── 送货单评分匹配 ────────────────────────────────────────────────────────────
const norm = (s = "") =>
  String(s).replace(/\s+/g, "").replace(/[()（）\-\/]/g, "").toLowerCase();

const scoreMatch = (contractItem, deliveryItem) => {
  let score = 0;
  if (norm(contractItem.name) === norm(deliveryItem.name)) score += 60;
  else if (norm(deliveryItem.name).includes(norm(contractItem.name).slice(0, 3))) score += 20;
  if (norm(contractItem.spec) && norm(contractItem.spec) === norm(deliveryItem.spec)) score += 25;
  if (norm(contractItem.color) && norm(contractItem.color) === norm(deliveryItem.color)) score += 15;
  return score;
};

const findBestMatch = (contractItem, deliveryItems) => {
  let best = null, bestScore = -1;
  for (const d of deliveryItems) {
    const s = scoreMatch(contractItem, d);
    if (s > bestScore) { best = d; bestScore = s; }
  }
  return bestScore >= 60 ? best : null;
};

// ─── 结算计算 ──────────────────────────────────────────────────────────────────
const calcSettlement = (contract, items, mode) => {
  if (mode === "actual") {
    const qtys = items.map((it) => toNumber(it.delivered_qty, 0)).filter((n) => n > 0);
    const settleQty = qtys.length ? Math.min(...qtys) : 0;
    return { settleQty, totalAmt: +(settleQty * toNumber(contract.unit_price, 0)).toFixed(2) };
  }
  const settleQty = toNumber(contract.contract_qty, 0);
  return { settleQty, totalAmt: +(settleQty * toNumber(contract.unit_price, 0)).toFixed(2) };
};

// ─── Excel 导出 ────────────────────────────────────────────────────────────────
const generateExcel = (contract, items, settlement) => {
  const wb = XLSX.utils.book_new();
  const ws = {};

  const enc = XLSX.utils.encode_cell;
  const s = {
    title:   { font: { bold: true, sz: 16, name: "Arial" }, alignment: { horizontal: "center", vertical: "center" } },
    header:  { font: { bold: true, sz: 10, name: "Arial", color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "404040" } }, alignment: { horizontal: "center", vertical: "center", wrapText: true }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    label:   { font: { bold: true, sz: 10, name: "Arial" }, alignment: { horizontal: "left", vertical: "center" } },
    value:   { font: { sz: 10, name: "Arial" }, alignment: { horizontal: "left", vertical: "center" } },
    cell:    { font: { sz: 10, name: "Arial" }, alignment: { horizontal: "center", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    cellAlt: { font: { sz: 10, name: "Arial" }, fill: { fgColor: { rgb: "F2F2F2" } }, alignment: { horizontal: "center", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    cellL:   { font: { sz: 10, name: "Arial" }, alignment: { horizontal: "left", vertical: "center", wrapText: true }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    cellLA:  { font: { sz: 10, name: "Arial" }, fill: { fgColor: { rgb: "F2F2F2" } }, alignment: { horizontal: "left", vertical: "center", wrapText: true }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    sumLabel:{ font: { bold: true, sz: 10, name: "Arial" }, fill: { fgColor: { rgb: "FFF2CC" } }, alignment: { horizontal: "center", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    sumAmt:  { font: { bold: true, sz: 10, name: "Arial", color: { rgb: "CC0000" } }, fill: { fgColor: { rgb: "FFF2CC" } }, alignment: { horizontal: "center", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    light:   { font: { sz: 10, name: "Arial" }, fill: { fgColor: { rgb: "F2F2F2" } }, alignment: { horizontal: "left", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    lightC:  { font: { sz: 10, name: "Arial" }, fill: { fgColor: { rgb: "F2F2F2" } }, alignment: { horizontal: "center", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    remarkH: { font: { bold: true, sz: 10, name: "Arial", color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "404040" } }, alignment: { horizontal: "center", vertical: "center" }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
    remark:  { font: { sz: 9, name: "Arial" }, alignment: { horizontal: "left", vertical: "center", wrapText: true }, border: { top:{style:"thin"}, bottom:{style:"thin"}, left:{style:"thin"}, right:{style:"thin"} } },
  };

  // 1-based helpers
  const set = (r1, c1, v, style, numFmt) => {
    const ref = enc({ r: r1 - 1, c: c1 - 1 });
    ws[ref] = { v, t: typeof v === "number" ? "n" : "s", s: style };
    if (numFmt) ws[ref].z = numFmt;
  };
  const merge = (rs1, re1, cs1, ce1) => {
    if (!ws["!merges"]) ws["!merges"] = [];
    ws["!merges"].push({ s: { r: rs1 - 1, c: cs1 - 1 }, e: { r: re1 - 1, c: ce1 - 1 } });
  };

  const { settleQty, totalAmt } = settlement;
  const preTax = +(totalAmt / 1.13).toFixed(2);
  const taxAmt = +(totalAmt - preTax).toFixed(2);

  // Row 1: 标题
  merge(1, 1, 1, 10); set(1, 1, "对  账  单", s.title);

  // Row 2-5: 基本信息
  const info = [
    ["卖方（供应商）：", contract.seller,          "合同编号：",   contract.contract_no],
    ["买方（客户）：",   contract.buyer,           "对账日期：",   formatLocalDate()],
    ["联系人（卖方）：", contract.seller_contact,  "合同日期：",   contract.contract_date],
    ["联系人（买方）：", contract.buyer_contact,   "送货单号：",   contract.delivery_no || ""],
  ];
  info.forEach(([l1, v1, l2, v2], i) => {
    const r = 2 + i;
    merge(r, r, 1, 1); set(r, 1, l1, s.label);
    merge(r, r, 2, 6); set(r, 2, v1, s.value);
    merge(r, r, 7, 7); set(r, 7, l2, s.label);
    merge(r, r, 8, 10); set(r, 8, v2, s.value);
  });

  // Row 6: 表头
  const headers = ["序号","物料名称","规格/描述","颜色","单位","合同数量\n(套)","实送数量\n(件)","含税单价\n(元/套，13%)","含税金额\n(元)","备注"];
  headers.forEach((h, ci) => set(6, ci + 1, h, s.header));

  // 数据行
  items.forEach((item, i) => {
    const r = 7 + i;
    const isAlt = i % 2 === 1;
    const cs = isAlt ? s.cellAlt : s.cell;
    const csl = isAlt ? s.cellLA : s.cellL;
    const row = [i + 1, item.name, item.spec, item.color || "白色", item.unit || "件",
                 item.contract_qty, toNumber(item.delivered_qty, 0), "", "", item.note || ""];
    row.forEach((v, ci) => set(r, ci + 1, v, ci === 2 ? csl : cs));
  });

  // 合计行
  const sR = 7 + items.length;
  merge(sR, sR, 1, 5); set(sR, 1, "合同总金额（含税13%）", s.sumLabel);
  set(sR, 6, settleQty, s.sumLabel);
  set(sR, 7, contract.settlement_mode === "actual" ? "按实际结算" : "按合同结算", s.sumLabel);
  set(sR, 8, toNumber(contract.unit_price, 0), s.sumLabel, "¥#,##0.00");
  set(sR, 9, totalAmt, s.sumAmt, "¥#,##0.00");
  set(sR, 10, "结算金额", s.sumLabel);

  // 大写金额
  const wR = sR + 1;
  merge(wR, wR, 1, 10);
  set(wR, 1, `金额大写：${contract.amount_cn || ""}（¥${totalAmt.toLocaleString("zh-CN", { minimumFractionDigits: 2 })}，含增值税13%）`, s.light);

  // 税务拆分
  merge(sR + 2, sR + 2, 1, 6); set(sR + 2, 1, "税前金额（不含税）：", s.lightC);
  merge(sR + 2, sR + 2, 7, 9); set(sR + 2, 7, preTax, s.lightC, "¥#,##0.00");
  set(sR + 2, 10, "", s.lightC);
  merge(sR + 3, sR + 3, 1, 6); set(sR + 3, 1, "增值税额（13%）：", s.lightC);
  merge(sR + 3, sR + 3, 7, 9); set(sR + 3, 7, taxAmt, s.lightC, "¥#,##0.00");
  set(sR + 3, 10, "", s.lightC);

  // 对账说明
  const remR = sR + 5;
  merge(remR, remR, 1, 10); set(remR, 1, "对账说明", s.remarkH);
  const remarks = [
    `1. 本对账单依据采购合同（${contract.contract_no}）及送货工单（${contract.delivery_no || "—"}）编制，对账日期：${formatLocalDate()}。`,
    `2. 合同约定：${contract.product_name || ""} ${contract.contract_qty} 套，含税单价 ¥${contract.unit_price}/套（含增值税13%），合计 ¥${(contract.contract_qty * contract.unit_price).toFixed(2)}。`,
    `3. 本次结算数量：${settleQty} 套，结算金额：¥${totalAmt.toFixed(2)}（${contract.settlement_mode === "actual" ? "按实际最小送货量结算" : "按合同约定数量结算"}）。`,
    "4. 如双方对上述金额无异议，请买方于收到本对账单后5个工作日内书面确认，逾期视为认可。",
  ];
  remarks.forEach((txt, i) => {
    merge(remR + 1 + i, remR + 1 + i, 1, 10);
    set(remR + 1 + i, 1, txt, s.remark);
  });

  const totalRows = remR + 1 + remarks.length;
  ws["!cols"] = [5, 18, 22, 10, 10, 13, 13, 18, 18, 16].map((w) => ({ wch: w }));
  ws["!rows"] = Array(totalRows).fill({ hpt: 20 });
  if (ws["!rows"][0]) ws["!rows"][0] = { hpt: 32 };
  if (ws["!rows"][5]) ws["!rows"][5] = { hpt: 30 };
  ws["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: totalRows, c: 9 } });

  XLSX.utils.book_append_sheet(wb, ws, "对账单");
  XLSX.writeFile(wb, `对账单_${contract.contract_no}_${formatLocalDate()}.xlsx`, {
    cellStyles: true,
    compression: true,
  });
};

// ─── UI 组件 ───────────────────────────────────────────────────────────────────
const UploadBox = ({ label, onFile, file, accept = "image/*,.pdf,application/pdf" }) => {
  const ref = useRef();
  const onDrop = useCallback((e) => {
    e.preventDefault();
    const f = e.dataTransfer?.files[0] || e.target.files[0];
    if (!f) return;
    const maxMB = 10;
    if (f.size > maxMB * 1024 * 1024) { alert(`文件不能超过 ${maxMB}MB`); return; }
    onFile(f);
  }, [onFile]);
  return (
    <div onClick={() => ref.current.click()} onDrop={onDrop} onDragOver={(e) => e.preventDefault()}
      style={{ border: file ? "2px solid #22c55e" : "2px dashed #475569", borderRadius: 12, padding: "28px 20px",
        textAlign: "center", cursor: "pointer", background: file ? "#f0fdf4" : "#f8fafc",
        transition: "all .2s", minHeight: 110, display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 8 }}>
      <input ref={ref} type="file" accept={accept} style={{ display: "none" }} onChange={onDrop} />
      {file ? (
        <><span style={{ fontSize: 28 }}>✅</span>
          <span style={{ fontSize: 13, color: "#16a34a", fontWeight: 600 }}>{file.name}</span>
          <span style={{ fontSize: 11, color: "#86efac" }}>点击重新上传</span></>
      ) : (
        <><span style={{ fontSize: 32 }}>📄</span>
          <span style={{ fontSize: 13, color: "#64748b", fontWeight: 600 }}>{label}</span>
          <span style={{ fontSize: 11, color: "#94a3b8" }}>支持图片（JPG/PNG）或 PDF，最大 10MB</span></>
      )}
    </div>
  );
};

const Steps = ({ current }) => {
  const steps = ["上传合同", "上传送货单", "核对 & 导出"];
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", marginBottom: 32 }}>
      {steps.map((s, i) => (
        <div key={i} style={{ display: "flex", alignItems: "center" }}>
          <div style={{ width: 32, height: 32, borderRadius: "50%", fontWeight: 700, fontSize: 14,
            display: "flex", alignItems: "center", justifyContent: "center",
            background: i < current ? "#22c55e" : i === current ? "#1e293b" : "#e2e8f0",
            color: i <= current ? "#fff" : "#94a3b8", transition: "all .3s" }}>
            {i < current ? "✓" : i + 1}
          </div>
          <span style={{ marginLeft: 8, fontSize: 13, fontWeight: i === current ? 700 : 400,
            color: i === current ? "#1e293b" : i < current ? "#22c55e" : "#94a3b8" }}>{s}</span>
          {i < 2 && <div style={{ width: 36, height: 2,
            background: i < current ? "#22c55e" : "#e2e8f0", margin: "0 10px", transition: "all .3s" }} />}
        </div>
      ))}
    </div>
  );
};

const CompareTable = ({ items, onChangeInput, onBlurQty }) => (
  <div style={{ overflowX: "auto" }}>
    <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
      <thead>
        <tr style={{ background: "#1e293b", color: "#fff" }}>
          {["物料名称","规格","颜色","单位","合同数量","实送数量","差异","状态"].map((h) => (
            <th key={h} style={{ padding: "10px 12px", fontWeight: 600, whiteSpace: "nowrap" }}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {items.map((item, i) => {
          const qty = toNumber(item.delivered_qty, null);
          const diff = qty !== null ? qty - item.contract_qty : null;
          const matched = diff !== null && diff >= 0;
          return (
            <tr key={i} style={{ background: i % 2 ? "#f8fafc" : "#fff" }}>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0" }}>{item.name}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", fontSize: 11, color: "#64748b" }}>{item.spec}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0" }}>{item.color}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>{item.unit}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", textAlign: "center", fontWeight: 600 }}>{item.contract_qty}</td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>
                <input type="number" min="0"
                  value={item.delivered_qty_input ?? ""}
                  onChange={(e) => onChangeInput(i, e.target.value)}
                  onBlur={() => onBlurQty(i)}
                  style={{ width: 80, textAlign: "center", padding: "4px 6px", borderRadius: 6, fontSize: 13, outline: "none",
                    border: qty === null ? "1px solid #cbd5e1" : matched ? "1px solid #22c55e" : "1px solid #f97316",
                    background: qty === null ? "#fff" : matched ? "#f0fdf4" : "#fff7ed" }} />
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", textAlign: "center",
                color: diff === null ? "#94a3b8" : diff > 0 ? "#16a34a" : diff < 0 ? "#dc2626" : "#64748b", fontWeight: 600 }}>
                {diff === null ? "—" : diff > 0 ? `+${diff}` : diff}
              </td>
              <td style={{ padding: "8px 12px", borderBottom: "1px solid #e2e8f0", textAlign: "center" }}>
                {qty === null
                  ? <span style={{ color: "#94a3b8", fontSize: 12 }}>待录入</span>
                  : matched
                    ? <span style={{ background: "#dcfce7", color: "#16a34a", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>✓ 达标</span>
                    : <span style={{ background: "#fee2e2", color: "#dc2626", padding: "2px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600 }}>⚠ 不足</span>}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  </div>
);

// ─── 主应用 ────────────────────────────────────────────────────────────────────
export default function App() {
  const [step, setStep] = useState(0);
  const [contractFile, setContractFile] = useState(null);
  const [deliveryFile, setDeliveryFile] = useState(null);
  const [contract, setContract] = useState(null);
  const [items, setItems] = useState([]);
  const [settlementMode, setSettlementMode] = useState("contract");
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState("");

  // 数量输入：字符串态（避免清空闪刷）
  const updateQtyInput = (i, raw) =>
    setItems((prev) => prev.map((it, idx) => idx === i ? { ...it, delivered_qty_input: raw } : it));

  const commitQtyInput = (i) =>
    setItems((prev) => prev.map((it, idx) => {
      if (idx !== i) return it;
      const raw = String(it.delivered_qty_input ?? "").trim();
      if (raw === "") return { ...it, delivered_qty: null };
      const n = Number(raw);
      return { ...it, delivered_qty: Number.isFinite(n) ? n : null };
    }));

  // 解析合同
  const parseContract = async () => {
    if (!contractFile) return;
    setLoading(true); setLoadingMsg("AI 正在识别合同…"); setError("");
    try {
      const b64 = await toBase64(contractFile);
      const mime = contractFile.type || "image/jpeg";
      const isPdf = mime === "application/pdf";

      const content = isPdf
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }]
        : [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }];

      content.push({ type: "text", text: `请从这份采购合同中提取以下信息，只返回 JSON，不要其他文字：
{
  "contract_no": "合同编号",
  "contract_date": "合同日期 YYYY-MM-DD",
  "seller": "卖方公司名",
  "seller_contact": "卖方联系人和电话",
  "buyer": "买方公司名",
  "buyer_contact": "买方联系人",
  "product_name": "产品名称",
  "contract_qty": 数量（数字）,
  "unit_price": 含税单价（数字）,
  "trade_mode": "贸易方式",
  "amount_cn": "金额大写",
  "items": [
    { "name": "物料名称", "spec": "规格", "color": "颜色", "unit": "件/套", "contract_qty": 数量 }
  ]
}
如合同只有总套数没有明细，items 用一条记录代表整套产品。` });

      const raw = await callClaude([{ role: "user", content }],
        "你是专业的采购文件解析助手，只返回纯 JSON，不要 markdown，不要解释。");

      const normalized = normalizeContract(raw);
      setContract(normalized);

      const baseItems = (normalized.items.length > 0
        ? normalized.items
        : [{ name: normalized.product_name, spec: "", color: "白色", unit: "套", contract_qty: normalized.contract_qty }]
      ).map((it) => ({ ...it, delivered_qty: null, delivered_qty_input: "", note: "" }));

      setItems(baseItems);
      setStep(1);
    } catch (e) { setError("合同解析失败：" + e.message); }
    setLoading(false);
  };

  // 解析送货单
  const parseDelivery = async () => {
    if (!deliveryFile) return;
    setLoading(true); setLoadingMsg("AI 正在识别送货单…"); setError("");
    try {
      const b64 = await toBase64(deliveryFile);
      const mime = deliveryFile.type || "image/jpeg";
      const isPdf = mime === "application/pdf";
      const itemNames = items.map((it) => it.name).join("、");

      const content = isPdf
        ? [{ type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }]
        : [{ type: "image", source: { type: "base64", media_type: mime, data: b64 } }];

      content.push({ type: "text", text: `请从这份送货单/工单中提取实际送货数量，对应物料：${itemNames}。
只返回 JSON：
{
  "delivery_no": "工单/送货单号",
  "delivery_date": "日期",
  "items": [
    { "name": "物料名称", "spec": "规格", "color": "颜色", "delivered_qty": 实际数量（数字）, "note": "备注" }
  ]
}` });

      const raw = await callClaude([{ role: "user", content }],
        "你是专业的仓储送货单解析助手，只返回纯 JSON，不要 markdown。");

      const deliveryItems = raw.items || [];
      setItems((prev) => prev.map((it) => {
        const match = findBestMatch(it, deliveryItems);
        return {
          ...it,
          delivered_qty: match?.delivered_qty ?? it.delivered_qty,
          delivered_qty_input: match?.delivered_qty != null ? String(match.delivered_qty) : (it.delivered_qty_input ?? ""),
          note: match?.note || it.note,
        };
      }));
      if (raw.delivery_no) setContract((c) => ({ ...c, delivery_no: raw.delivery_no }));
      setStep(2);
    } catch (e) { setError("送货单解析失败：" + e.message); }
    setLoading(false);
  };

  const allMatched = items.length > 0 && items.every((it) => toNumber(it.delivered_qty, 0) >= it.contract_qty);
  const anyShort = items.some((it) => {
    const q = it.delivered_qty;
    return q === null || toNumber(q, 0) < it.contract_qty;
  });

  const doGenerate = () => {
    // 先 commit 所有未失焦的输入
    const committed = items.map((it) => {
      if (it.delivered_qty !== null) return it;
      const raw = String(it.delivered_qty_input ?? "").trim();
      const n = raw === "" ? null : Number(raw);
      return { ...it, delivered_qty: Number.isFinite(n) ? n : null };
    });
    const settlement = calcSettlement(contract, committed, settlementMode);
    generateExcel({ ...contract, settlement_mode: settlementMode }, committed, settlement);
  };

  return (
    <div style={{ minHeight: "100vh", background: "linear-gradient(135deg,#f0f4f8,#e8edf2)",
      fontFamily: "'PingFang SC','Hiragino Sans GB','Microsoft YaHei',sans-serif", padding: "32px 16px" }}>
      <div style={{ maxWidth: 880, margin: "0 auto" }}>

        {/* 标题 */}
        <div style={{ textAlign: "center", marginBottom: 36 }}>
          <div style={{ display: "inline-flex", alignItems: "center", gap: 12, background: "#1e293b",
            color: "#fff", padding: "10px 24px", borderRadius: 40, marginBottom: 14 }}>
            <span style={{ fontSize: 20 }}>📋</span>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: 2 }}>对账单智能生成工具</span>
          </div>
          <p style={{ color: "#64748b", fontSize: 13, margin: 0 }}>上传采购合同 → 比对送货数量 → 一键导出 Excel 对账单</p>
        </div>

        <Steps current={step} />

        <div style={{ background: "#fff", borderRadius: 16, padding: 28, boxShadow: "0 4px 24px rgba(0,0,0,.07)" }}>

          {/* STEP 0: 上传合同 */}
          {step === 0 && (
            <div>
              <h3 style={{ margin: "0 0 20px", fontSize: 16, color: "#1e293b", fontWeight: 700 }}>第一步：上传采购合同</h3>
              <UploadBox label="上传合同图片（JPG/PNG）或 PDF" onFile={setContractFile} file={contractFile} />
              {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 12, padding: "8px 12px", background: "#fef2f2", borderRadius: 8 }}>{error}</div>}
              <button onClick={parseContract} disabled={!contractFile || loading}
                style={{ marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 10, fontWeight: 700,
                  fontSize: 15, border: "none", letterSpacing: 1, cursor: contractFile && !loading ? "pointer" : "not-allowed",
                  background: contractFile && !loading ? "#1e293b" : "#e2e8f0",
                  color: contractFile && !loading ? "#fff" : "#94a3b8" }}>
                {loading ? `⏳ ${loadingMsg}` : "解析合同 →"}
              </button>
            </div>
          )}

          {/* STEP 1+: 合同已解析 */}
          {step >= 1 && contract && (
            <div>
              {/* 合同摘要 */}
              <div style={{ background: "#f8fafc", borderRadius: 10, padding: 16, marginBottom: 24, border: "1px solid #e2e8f0" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                  <h4 style={{ margin: 0, fontSize: 14, color: "#1e293b", fontWeight: 700 }}>📄 合同信息</h4>
                  <button onClick={() => { setStep(0); setContract(null); setItems([]); setError(""); }}
                    style={{ fontSize: 12, color: "#94a3b8", background: "none", border: "none", cursor: "pointer" }}>重新上传</button>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "5px 20px", fontSize: 13 }}>
                  {[["合同编号", contract.contract_no], ["合同日期", contract.contract_date],
                    ["卖方", contract.seller], ["买方", contract.buyer],
                    ["产品", contract.product_name], ["合同数量", `${contract.contract_qty} 套`],
                    ["含税单价", `¥${contract.unit_price}`], ["贸易方式", contract.trade_mode]
                  ].map(([k, v]) => (
                    <div key={k} style={{ display: "flex", gap: 6 }}>
                      <span style={{ color: "#94a3b8", minWidth: 60 }}>{k}：</span>
                      <span style={{ color: "#1e293b", fontWeight: 500 }}>{v}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* STEP 1: 上传送货单 */}
              {step === 1 && (
                <>
                  <h3 style={{ margin: "0 0 16px", fontSize: 16, color: "#1e293b", fontWeight: 700 }}>第二步：上传送货单</h3>
                  <UploadBox label="上传送货单 / 工单图片或 PDF" onFile={setDeliveryFile} file={deliveryFile} />
                  {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 12, padding: "8px 12px", background: "#fef2f2", borderRadius: 8 }}>{error}</div>}
                  <button onClick={parseDelivery} disabled={!deliveryFile || loading}
                    style={{ marginTop: 20, width: "100%", padding: "14px 0", borderRadius: 10, fontWeight: 700,
                      fontSize: 15, border: "none", letterSpacing: 1, cursor: deliveryFile && !loading ? "pointer" : "not-allowed",
                      background: deliveryFile && !loading ? "#1e293b" : "#e2e8f0",
                      color: deliveryFile && !loading ? "#fff" : "#94a3b8" }}>
                    {loading ? `⏳ ${loadingMsg}` : "解析送货单 →"}
                  </button>
                </>
              )}

              {/* STEP 2: 核对数量 */}
              {step === 2 && (
                <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
                    <h3 style={{ margin: 0, fontSize: 16, color: "#1e293b", fontWeight: 700 }}>第三步：核对数量</h3>
                    <button onClick={() => { setStep(1); setDeliveryFile(null); setError(""); }}
                      style={{ fontSize: 12, color: "#64748b", background: "#f1f5f9", border: "none", borderRadius: 6, padding: "4px 12px", cursor: "pointer" }}>
                      重新上传送货单
                    </button>
                  </div>

                  {/* 状态提示 */}
                  <div style={{ padding: "10px 16px", borderRadius: 8, marginBottom: 16, fontSize: 13, fontWeight: 600,
                    background: allMatched ? "#dcfce7" : "#fff7ed",
                    color: allMatched ? "#15803d" : "#c2410c",
                    border: `1px solid ${allMatched ? "#86efac" : "#fdba74"}` }}>
                    {allMatched
                      ? "✅ 所有物料数量已达标，可生成对账单"
                      : `⚠️ 还有 ${items.filter((it) => toNumber(it.delivered_qty, 0) < it.contract_qty).length} 项数量不足，可手动修改后继续`}
                  </div>

                  <CompareTable items={items} onChangeInput={updateQtyInput} onBlurQty={commitQtyInput} />

                  {/* 结算模式 */}
                  <div style={{ marginTop: 18, padding: "14px 16px", background: "#f8fafc", borderRadius: 10, border: "1px solid #e2e8f0" }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: "#1e293b", marginBottom: 10 }}>结算方式</div>
                    <div style={{ display: "flex", gap: 12 }}>
                      {[["contract", "按合同数量结算", `¥${(contract.contract_qty * contract.unit_price).toFixed(2)}`],
                        ["actual", "按实际最小送货量结算", `¥${(Math.min(...items.map(it => toNumber(it.delivered_qty, 0)).filter(n => n > 0), contract.contract_qty) * contract.unit_price).toFixed(2)}`]
                      ].map(([mode, label, amt]) => (
                        <div key={mode} onClick={() => setSettlementMode(mode)}
                          style={{ flex: 1, padding: "10px 14px", borderRadius: 8, cursor: "pointer", transition: "all .2s",
                            border: settlementMode === mode ? "2px solid #1e293b" : "2px solid #e2e8f0",
                            background: settlementMode === mode ? "#f0f4f8" : "#fff" }}>
                          <div style={{ fontWeight: 600, fontSize: 13, color: "#1e293b", marginBottom: 4 }}>{label}</div>
                          <div style={{ fontSize: 13, color: "#dc2626", fontWeight: 700 }}>{amt}</div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {error && <div style={{ color: "#dc2626", fontSize: 13, marginTop: 12, padding: "8px 12px", background: "#fef2f2", borderRadius: 8 }}>{error}</div>}

                  <button onClick={doGenerate}
                    style={{ marginTop: 20, width: "100%", padding: "16px 0", borderRadius: 10, fontWeight: 700,
                      fontSize: 16, border: "none", cursor: "pointer", letterSpacing: 2, color: "#fff",
                      background: "linear-gradient(135deg,#16a34a,#15803d)",
                      boxShadow: "0 4px 12px rgba(22,163,74,.3)" }}>
                    📥 生成并下载对账单 Excel
                  </button>

                  {anyShort && (
                    <p style={{ textAlign: "center", fontSize: 12, color: "#f97316", marginTop: 8, margin: "8px 0 0" }}>
                      部分数量不足，仍可导出 — 将以当前填写数量生成
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        <p style={{ textAlign: "center", fontSize: 11, color: "#cbd5e1", marginTop: 20 }}>
          深圳市源丰隆实业有限公司 · 对账单智能生成工具 v2 · 格式基于 P026010606 标准模板
        </p>
      </div>
    </div>
  );
}