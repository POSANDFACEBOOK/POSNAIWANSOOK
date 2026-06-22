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
  try {
    const tok = await accessToken();
    const r = await fetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media&supportsAllDrives=true`, {
      headers: { Authorization: `Bearer ${tok}` },
    });
    if (!r.ok) return res.status(r.status).end(await r.text());
    res.setHeader("Content-Type", r.headers.get("content-type") || "application/octet-stream");
    res.setHeader("Content-Disposition", "inline");
    res.setHeader("Cache-Control", "private, max-age=300");
    return res.status(200).end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(500).end(String((e && e.message) || e));
  }
}
