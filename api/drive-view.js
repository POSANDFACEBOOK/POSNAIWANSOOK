// Streams a private slip/document back from the company Google Shared Drive via the
// service account. The Drive file is NEVER made public; this authenticated proxy is
// the only reader (server fetches with alt=media and streams the bytes). Access is
// gated by the high-entropy, unguessable Drive file id — the same "unguessable URL"
// model the app's existing slip links already use. If DRIVE_VIEW_TOKEN is set, also
// require ?t=<token> for defense-in-depth.
//
// Env (Vercel only): GOOGLE_SA_KEY_B64 (SECRET), optional DRIVE_VIEW_TOKEN (SECRET).
import { JWT } from "google-auth-library";

const SA_B64 = process.env.GOOGLE_SA_KEY_B64 || "";
const VIEW_TOKEN = process.env.DRIVE_VIEW_TOKEN || "";
// ขนาดรูปย่อที่ยอมให้ขอได้ — ฝั่งแอปปัดขึ้นมาหาค่าที่ใกล้ที่สุดในชุดนี้
// ต้องเป็นชุดจำกัด ไม่ใช่ตัวเลขอิสระ ไม่งั้น CDN แคชแตกเป็นชิ้นเล็กชิ้นน้อยจนไม่ช่วยอะไร
// ไม่มี 640 โดยตั้งใจ — วัดจริง 12 ส.ค. 69: thumbnail w=640 ได้ 53,454 B แต่ไฟล์เต็ม 46,567 B
// รูปต้นทางเก็บที่ 1280px ซึ่ง Google เข้ารหัสไว้ดีกว่า thumbnail ขนาดใหญ่ ขอ 640 จึงได้ทั้ง
// ไบต์มากกว่าและความละเอียดน้อยกว่า = แย่กว่าทั้งสองทาง ค่าที่หลุดชุดนี้จะตกไปใช้ไฟล์เต็มเอง
const ALLOWED_W = new Set([64, 128, 192, 320]);

// Accept the SA key as EITHER base64-encoded JSON OR raw JSON pasted directly.
function loadSA() {
  const raw = (SA_B64 || "").trim();
  if (!raw) throw new Error("GOOGLE_SA_KEY_B64 not set");
  try { return JSON.parse(raw); } catch {}
  try { return JSON.parse(Buffer.from(raw, "base64").toString("utf8")); } catch {}
  throw new Error("GOOGLE_SA_KEY_B64 is neither valid JSON nor base64-encoded JSON");
}
let _jwt;
async function accessToken() {
  if (!_jwt) {
    const sa = loadSA();
    _jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  }
  const { token } = await _jwt.getAccessToken();
  return token;
}

// 28 ต.ค. 69: ส่งไฟล์กลับแบบที่เบราว์เซอร์รันโค้ดในไฟล์ไม่ได้ — ไฟล์นี้เสิร์ฟจากโดเมนแอปเอง
// เดิมส่งทุกไฟล์ inline ด้วยชนิดที่ Drive เก็บไว้ ⟹ SVG/HTML ที่อัปขึ้นมา (ปลายทางอัปไม่มีรหัส) เปิดแล้วสคริปต์รัน
// ในโดเมนแอป อ่านรหัสใน localStorage ได้ (nw_broadcast_key ฯลฯ)
//  · รูปแบบพิกเซล = inline ตามเดิม (แสดงใน <img> ได้เหมือนเดิมทุกอย่าง) + sandbox
//  · PDF = inline (เปิดดูในเบราว์เซอร์ได้) — ไม่ใส่ sandbox เพราะ Chrome ไม่ยอมเปิด PDF ในหน้าที่ถูก sandbox
//  · อย่างอื่นทั้งหมด = ดาวน์โหลด (attachment) ไม่เปิดในหน้า · ชนิดนอกรายการ Office = application/octet-stream
//  · ทุกแบบ nosniff = ห้ามเบราว์เซอร์เดาชนิดเองจากเนื้อไฟล์
// รายการชนิดต้องตรงกับ api/drive-upload.js (มีด่านตรวจใน tools/check-code.mjs)
const RASTER_TYPES = ["image/jpeg", "image/jpg", "image/pjpeg", "image/png", "image/webp", "image/gif", "image/heic", "image/heif", "image/avif", "image/bmp", "image/tiff"];
const DOC_TYPES = [
  "application/pdf",
  "application/msword", "application/vnd.ms-excel", "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
];
const SANDBOX_CSP = "default-src 'none'; style-src 'unsafe-inline'; sandbox";
// 29 ต.ค. 69: ไฟล์สำรองข้อมูล (api/backup.js อัปขึ้น Drive เป็น application/gzip — ปลายทางอัปของแอปรับ gzip ไม่ได้)
// เดิมตกไปเป็น octet-stream ไม่มีชื่อไฟล์ ⟹ เบราว์เซอร์เซฟเป็น "drive-view" ไม่มีนามสกุล เจ้าของจำไม่ได้ว่าเป็นไฟล์สำรอง
// ยังเป็นดาวน์โหลด + nosniff + sandbox เหมือนชนิดอื่น · ชื่อไฟล์จากแอป (?fn=) ใช้ได้เฉพาะตัวอักษรปลอดภัยที่ลงท้าย .json.gz
// นอกนั้นใช้ backup-<id>.json.gz (ใส่ชื่ออะไรมาก็ไม่ได้ชื่อ .html/.exe จากโดเมนแอป)
const GZIP_TYPES = ["application/gzip", "application/x-gzip"];
export function gzipName(id, fn) {
  const f = String(fn || "");
  if (/^[A-Za-z0-9][A-Za-z0-9._-]{0,150}\.json\.gz$/.test(f)) return f;
  return `backup-${String(id || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80) || "file"}.json.gz`;
}
export function viewHeaders(stored, id, fn) {
  const t = String(stored || "").split(";")[0].trim().toLowerCase();
  if (RASTER_TYPES.includes(t)) return { "Content-Type": t, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SANDBOX_CSP };
  if (t === "application/pdf") return { "Content-Type": t, "Content-Disposition": "inline", "X-Content-Type-Options": "nosniff" };
  if (GZIP_TYPES.includes(t)) return { "Content-Type": t, "Content-Disposition": `attachment; filename="${gzipName(id, fn)}"`, "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SANDBOX_CSP };
  return { "Content-Type": DOC_TYPES.includes(t) ? t : "application/octet-stream", "Content-Disposition": "attachment", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": SANDBOX_CSP };
}

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).end(); }
  if (!SA_B64) return res.status(501).end("drive not configured");
  res.setHeader("X-Content-Type-Options", "nosniff");
  const id = String(req.query.id || "");
  if (!/^[A-Za-z0-9_-]{10,}$/.test(id)) return res.status(400).end("bad id");
  if (VIEW_TOKEN && req.query.t !== VIEW_TOKEN) return res.status(403).end("forbidden");
  // ?w=<px> → ส่งรูปย่อแทนไฟล์เต็ม รูปในระบบเก็บที่ 1280px (~45 KB) แต่การ์ด/รายการ
  // แสดงจริงแค่ 30–88 px คือใหญ่เกินจำเป็นราว 15–25 เท่า และนั่นคือทั้งไบต์และ CPU
  // จำกัดเป็นชุดค่าตายตัว ไม่รับตัวเลขอิสระ เพราะทุกค่าที่ต่างกันคือ cache entry ใหม่
  // ปล่อยให้ใส่อะไรก็ได้ = แคชแตกเป็นพันชิ้น แล้วก็กลับไปวิ่งหา origin เหมือนเดิม
  const W = ALLOWED_W.has(+req.query.w) ? +req.query.w : 0;
  try {
    const tok = await accessToken();
    // รูปย่อ: ขอ thumbnailLink จาก metadata แล้วเปลี่ยนขนาดท้าย URL (=s220 → =s<W>)
    // ถ้าพลาดตรงไหนก็ตาม ให้ตกไปใช้ไฟล์เต็มเสมอ — รูปไม่ขึ้นแย่กว่ารูปใหญ่ไป
    if (W) {
      try {
        const m = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=thumbnailLink&supportsAllDrives=true`, {
          headers: { Authorization: `Bearer ${tok}` },
        });
        if (m.ok) {
          const link = (await m.json()).thumbnailLink || "";
          if (link) {
            const sized = link.replace(/=s\d+(-c)?$/, `=s${W}`);
            const t = await fetch(sized);
            if (t.ok) {
              for (const [k, v] of Object.entries(viewHeaders(t.headers.get("content-type") || "image/jpeg"))) res.setHeader(k, v);
              res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
              return res.status(200).end(Buffer.from(await t.arrayBuffer()));
            }
          }
        }
      } catch { /* ตกไปใช้ไฟล์เต็มด้านล่าง */ }
    }
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return res.status(r.status).end(await r.text());
    for (const [k, v] of Object.entries(viewHeaders(r.headers.get("content-type"), id, req.query.fn))) res.setHeader(k, v);
    // ⚠️ เคยเป็น "private, max-age=300" ซึ่งสั่งไม่ให้ CDN แคชเลย แคชแค่ในเบราว์เซอร์ 5 นาที
    // ผลคือรูปทุกใบในระบบ (846 รูป) วิ่งผ่านฟังก์ชันนี้ใหม่แทบทุกครั้งที่มีคนเปิดหน้า
    // ฟังก์ชันต้องไปดึงจาก Drive → โหลดทั้งไฟล์เข้าหน่วยความจำ → ส่งออก
    // = กิน Fluid Active CPU และ Fast Origin Transfer มหาศาล จน Vercel หยุดให้บริการ
    // (9 ส.ค. 69: CPU 11h57m/4h · Origin Transfer 28.21GB/10GB — เกินเพดานฟรีทั้งคู่)
    //
    // public + immutable ให้ CDN แคชแทน ฟังก์ชันจึงถูกเรียกครั้งเดียวต่อรูปต่อ edge
    // ปลอดภัยเท่าเดิม เพราะโมเดลของ endpoint นี้คือ "URL เดารหัสไม่ได้" อยู่แล้ว
    // (ดูคอมเมนต์หัวไฟล์) ใครมี URL ก็เปิดได้อยู่แล้วตั้งแต่ต้น การแคชไม่ได้เปิดอะไรเพิ่ม
    // immutable ใช้ได้เพราะไฟล์ใน Drive หนึ่ง id = เนื้อหาเดิมเสมอ เปลี่ยนรูป = อัปไฟล์ใหม่ได้ id ใหม่
    res.setHeader("Cache-Control", "public, max-age=31536000, s-maxage=31536000, immutable");
    return res.status(200).end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(500).end(String((e && e.message) || e));
  }
}
