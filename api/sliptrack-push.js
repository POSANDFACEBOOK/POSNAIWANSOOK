// Vercel Serverless Function — proxies PO confirm events to SlipTrack ingest API.
// Keeps SLIPTRACK_API_KEY server-side only (never shipped to the browser bundle).
//
// Required env var (set in Vercel → Settings → Environment Variables):
//   SLIPTRACK_API_KEY = <bearer token>
//
// Client calls:  POST /api/sliptrack-push?upsert=1   (upsert flag optional)
// Body shape: same as SlipTrack /api/ingest body, minus source/kind (we add them).

const SLIPTRACK_URL = "https://sliptrack-pro.vercel.app/api/ingest";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.SLIPTRACK_API_KEY;
  if (!apiKey) {
    return res
      .status(500)
      .json({ error: "SLIPTRACK_API_KEY not configured on the server" });
  }

  const body = req.body || {};

  // Hard-required fields per SlipTrack spec
  const required = ["external_id", "datetime", "amount", "from_branch", "to_branch"];
  for (const k of required) {
    if (body[k] === undefined || body[k] === null || body[k] === "") {
      return res.status(400).json({ error: `Missing required field: ${k}` });
    }
  }
  if (!(Number(body.amount) > 0)) {
    return res.status(400).json({ error: "amount must be > 0" });
  }
  if (String(body.from_branch).trim() === String(body.to_branch).trim()) {
    return res.status(400).json({ error: "from_branch must differ from to_branch" });
  }

  const upsert = req.query && req.query.upsert === "1";
  const url = `${SLIPTRACK_URL}${upsert ? "?upsert=1" : ""}`;

  const payload = {
    source: "food_cost",
    kind: "food_cost_po",
    external_id: String(body.external_id),
    datetime: String(body.datetime),
    amount: Number(body.amount),
    from_branch: String(body.from_branch).trim(),
    to_branch: String(body.to_branch).trim(),
    description: body.description || undefined,
    category: body.category || "ต้นทุนอาหาร",
    reference_no: body.reference_no || String(body.external_id),
    items: Array.isArray(body.items) ? body.items : undefined,
  };

  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    // Mirror upstream status so client can decide whether to retry.
    return res.status(r.status).json(data);
  } catch (err) {
    return res
      .status(502)
      .json({ error: "Upstream fetch failed", message: err && err.message });
  }
}
