import type { NextApiRequest, NextApiResponse } from "next";
import * as dns from "dns/promises";
import https from "https";

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    const { host } = req.body || {};
    if (!host) return res.status(400).json({ error: "host required" });

    const start = Date.now();
    await dns.lookup(host);
    await new Promise((resolve, reject) => {
      const reqH = https.request(`https://${host}`, { method: "HEAD", timeout: 5000 }, r => { r.resume(); resolve(null); });
      reqH.on("error", reject);
      reqH.on("timeout", () => reqH.destroy(new Error("timeout")));
      reqH.end();
    });
    res.status(200).json({ host, ok: true, ms: Date.now() - start });
  } catch (e: any) {
    res.status(200).json({ host: req.body?.host, ok: false, error: e.message });
  }
}
