// Uploads a payment slip / document into the company Google Shared Drive using a
// service account, and returns the Drive file id. Files stay PRIVATE to the Shared
// Drive — never made public; viewing goes through the authenticated drive-view proxy.
//
// All Google credentials live ONLY in Vercel env vars (the GitHub repo is public):
//   GOOGLE_SA_KEY_B64  = base64 of the whole service-account JSON key  (SECRET)
//   DRIVE_FOLDER_ID    = the Shared Drive (or folder) id to upload into
// Returns 501 until those are set, so the client can fall back to Supabase.
import { JWT } from "google-auth-library";

export const config = { api: { bodyParser: false } }; // we read the raw body stream ourselves

const FOLDER_ID = process.env.DRIVE_FOLDER_ID || "";
const SA_B64 = process.env.GOOGLE_SA_KEY_B64 || "";

let _jwt;
async function accessToken() {
  if (!_jwt) {
    const sa = JSON.parse(Buffer.from(SA_B64, "base64").toString("utf8"));
    // drive.file = create + read back files this app created. Narrowest scope that works.
    _jwt = new JWT({ email: sa.client_email, key: sa.private_key, scopes: ["https://www.googleapis.com/auth/drive.file"] });
  }
  const { token } = await _jwt.getAccessToken();
  return token;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.setHeader("Allow", "POST"); return res.status(405).json({ error: "POST only" }); }
  if (!SA_B64 || !FOLDER_ID) return res.status(501).json({ error: "drive not configured" });
  try {
    const name = String(req.query.name || "upload.bin").replace(/[\r\n"\\]/g, "").slice(0, 200);
    const mime = req.headers["content-type"] || "application/octet-stream";
    if (!/^image\//.test(mime)) return res.status(415).json({ error: "image uploads only" });

    const chunks = []; let size = 0;
    for await (const c of req) { size += c.length; if (size > 10 * 1024 * 1024) return res.status(413).json({ error: "file too large (10MB max)" }); chunks.push(c); }
    const fileBuf = Buffer.concat(chunks);
    if (!fileBuf.length) return res.status(400).json({ error: "empty body" });

    const tok = await accessToken();
    // Drive v3 multipart/related upload: metadata part + media part. Files <5MB are fine
    // as multipart (slips are phone photos); >5MB would need uploadType=resumable.
    const boundary = "fcslipboundary7g3k9q2x5";
    const meta = JSON.stringify({ name, parents: [FOLDER_ID] });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mime}\r\n\r\n`),
      fileBuf,
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    const r = await fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id", {
      method: "POST",
      headers: { Authorization: `Bearer ${tok}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body,
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) return res.status(r.status).json({ error: "drive upload failed", detail: data });
    return res.status(200).json({ id: data.id }); // client stores "drive:<id>" on payment_slip_url
  } catch (e) {
    return res.status(500).json({ error: String((e && e.message) || e) });
  }
}
