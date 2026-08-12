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

export default async function handler(req, res) {
  if (req.method !== "GET") { res.setHeader("Allow", "GET"); return res.status(405).end(); }
  if (!SA_B64) return res.status(501).end("drive not configured");
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
              res.setHeader("Content-Type", t.headers.get("content-type") || "image/jpeg");
              res.setHeader("Content-Disposition", "inline");
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
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
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
