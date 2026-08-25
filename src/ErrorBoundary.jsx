import React from "react";

// ══════════════════════════════════════════════════════════════════════════
// ตัวกันจอขาว
//
// React มีกติกาว่า ถ้าคอมโพเนนต์ไหนโยน error ตอนเรนเดอร์แล้วไม่มีใครรับไว้
// React จะ "ถอดทั้งต้นไม้ทิ้ง" = หน้าจอว่างเปล่า ไม่มีข้อความ ไม่มีปุ่ม
// พนักงานเห็นแค่จอขาวและใช้งานอะไรไม่ได้เลยทั้งระบบ
//
// เกิดจริง 25/08/2569: พิมพ์ชื่อตัวแปรผิดจุดเดียว (isCentral แทน isCentralBranch)
// ทำให้ทั้งแอปใช้ไม่ได้ ทั้งที่ส่วนอื่นอีก 99% ไม่ได้พังเลย
//
// ตัวนี้รับ error ไว้แล้วแสดงข้อความที่อ่านรู้เรื่อง + ปุ่มลองใหม่
// ใช้ครอบ 2 ชั้น:
//   1. ครอบทั้งแอป (main.jsx)      — กันจอขาวสนิท
//   2. ครอบเนื้อหาแต่ละแท็บ         — แท็บเดียวพัง แท็บอื่นยังทำงานต่อได้
//      สำคัญกับร้านอาหาร: ถ้าแท็บ PO พัง ก็ยังขายหน้าร้าน/นับสต็อกได้อยู่
// ══════════════════════════════════════════════════════════════════════════
export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  componentDidCatch(err, info) {
    // ส่งเข้า console ให้ตามรอยได้ (Vercel Observability เก็บ error ฝั่ง client ไว้)
    console.error("[ErrorBoundary]", this.props.where || "app", err, info?.componentStack);
  }

  render() {
    const { err } = this.state;
    if (!err) return this.props.children;

    const scope = this.props.where;          // ชื่อแท็บ ถ้าครอบแค่แท็บเดียว
    const whole = !scope;                    // ไม่ระบุ = ครอบทั้งแอป
    const msg = String((err && err.message) || err || "ไม่ทราบสาเหตุ");

    const S = {
      wrap: {
        padding: whole ? "48px 20px" : "28px 18px",
        minHeight: whole ? "100vh" : "auto",
        display: "flex", alignItems: "center", justifyContent: "center",
        background: whole ? "#FFF7ED" : "transparent",
        fontFamily: "'Sarabun',sans-serif",
      },
      card: {
        background: "#fff", borderRadius: 16, padding: "26px 24px",
        maxWidth: 520, width: "100%",
        border: "1px solid #FED7AA", boxShadow: "0 8px 28px rgba(15,23,42,.08)",
      },
      h: { fontSize: 17, fontWeight: 800, color: "#9A3412", margin: "0 0 6px" },
      p: { fontSize: 13.5, color: "#475569", lineHeight: 1.7, margin: "0 0 14px" },
      pre: {
        fontSize: 11.5, color: "#7C2D12", background: "#FFF7ED",
        border: "1px solid #FED7AA", borderRadius: 10, padding: "9px 12px",
        margin: "0 0 16px", whiteSpace: "pre-wrap", wordBreak: "break-word",
        fontFamily: "ui-monospace,monospace", maxHeight: 130, overflow: "auto",
      },
      row: { display: "flex", gap: 8, flexWrap: "wrap" },
      btn: {
        padding: "10px 18px", borderRadius: 10, border: "none", cursor: "pointer",
        fontSize: 13.5, fontWeight: 800, fontFamily: "'Sarabun',sans-serif",
        background: "#EA580C", color: "#fff",
      },
      ghost: {
        padding: "10px 18px", borderRadius: 10, cursor: "pointer",
        fontSize: 13.5, fontWeight: 700, fontFamily: "'Sarabun',sans-serif",
        background: "transparent", color: "#475569", border: "1px solid #CBD5E1",
      },
    };

    return (
      <div style={S.wrap}>
        <div style={S.card}>
          <h2 style={S.h}>⚠️ {scope ? `หน้า "${scope}" มีปัญหา` : "ระบบขัดข้อง"}</h2>
          <p style={S.p}>
            {scope
              ? "หน้านี้เปิดไม่ได้ชั่วคราว — แท็บอื่นยังใช้งานได้ตามปกติ กดแท็บอื่นเพื่อทำงานต่อได้เลย"
              : "เกิดข้อผิดพลาดที่ทำให้แสดงหน้าไม่ได้ ลองโหลดใหม่อีกครั้ง ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบพร้อมข้อความด้านล่าง"}
          </p>
          <pre style={S.pre}>{msg}</pre>
          <div style={S.row}>
            <button style={S.btn} onClick={() => this.setState({ err: null })}>ลองใหม่</button>
            <button style={S.ghost} onClick={() => window.location.reload()}>โหลดหน้าใหม่ทั้งหมด</button>
          </div>
        </div>
      </div>
    );
  }
}
