// pages/api/email/inspect.ts
import type { NextApiRequest, NextApiResponse } from "next";
import formidable from "formidable";
import { simpleParser } from "mailparser";
import LinkifyIt from "linkify-it";
import { JSDOM } from "jsdom";
import * as dns from "dns/promises";
import * as psl from "psl";            // ← namespace import
import levenshtein from "fast-levenshtein";
import { fileTypeFromBuffer } from "file-type";

export const config = { api: { bodyParser: false } };

type Verdict = "safe" | "warning" | "phishing" | "clone" | "spam";

type Auth = { spf: string; dkim: string; dmarc: string };

function baseDomain(host: string) {
  try {
    const parsed = psl.parse(host) as any;
    if (parsed && parsed.domain) return parsed.domain as string;
  } catch {}
  return host;
}

function rootLabel(domain: string) {
  const d = baseDomain(domain);
  return d.split(".")[0] || d;
}

function sameBrand(a: string, b: string) {
  // Same base, or same root label across TLDs (ebay.com vs ebay.co.uk)
  const da = baseDomain(a);
  const db = baseDomain(b);
  if (da === db) return true;
  const ra = rootLabel(da);
  const rb = rootLabel(db);
  return ra && rb && ra === rb;
}

// Optional brand allowlist for known off-domain assets
const BRAND_ALLOW: Record<string, string[]> = {
  "ebay": ["ebaystatic.com", "ebaydesc.com", "ebayinc.com"],
  "microsoft": ["microsoftonline.com", "office.com", "live.com", "windows.com"],
  "google": ["googleusercontent.com", "gstatic.com", "withgoogle.com"],
  "apple": ["icloud.com", "appleid.apple.com"],
};

function extractLinks(text?: string, html?: string) {
  const linkify = new LinkifyIt();
  const set = new Set<string>();
  if (text) linkify.match(text)?.forEach((m) => set.add(m.url));
  if (html) {
    try {
      const dom = new JSDOM(html);
      dom.window.document.querySelectorAll("a[href]").forEach((a) => {
        const href = a.getAttribute("href") || "";
        if (!href.startsWith("mailto:")) set.add(href);
      });
    } catch {}
  }
  const urls: string[] = [];
  for (const u of set) {
    try {
      const url = new URL(u);
      if (url.protocol.startsWith("http")) urls.push(url.toString());
    } catch {}
  }
  return urls;
}

async function dnsExists(hostname: string) {
  try {
    await dns.lookup(hostname);
    return true;
  } catch {
    return false;
  }
}

function pickAuthFromHeaders(authLine?: string): Auth {
  if (!authLine) return { spf: "unknown", dkim: "unknown", dmarc: "unknown" };
  const lower = authLine.toLowerCase();
  const get = (tag: string) => {
    const m = lower.match(new RegExp(`${tag}=([a-z]+)`));
    return m ? m[1] : "unknown";
  };
  return { spf: get("spf"), dkim: get("dkim"), dmarc: get("dmarc") };
}

type ScoreInput = {
  fromDomain?: string;
  linkDomains: string[];
  auth: Auth;
  text: string;
  dnsMissingCount: number;
};

function scoreVerdict(inp: ScoreInput) {
  const reasons: string[] = [];
  const tips: string[] = [];
  let points = 0;

  const low = inp.text.toLowerCase();
  const spamPat =
    /(winner|you won|claim now|free (?:gift|bonus)|gift card|guarantee|act now|limited time|wire transfer)/;
  const spamHit = spamPat.test(low);
  if (spamHit) {
    points += 1;
    reasons.push("Spam language");
  }

  // Auth failures only influence verdict if present and fail
  if (inp.auth.spf === "fail" || inp.auth.dkim === "fail" || inp.auth.dmarc === "fail") {
    points += 3;
    reasons.push("Auth fail in headers");
  }

  // Brand/link alignment
  let misaligned: string[] = [];
  let isClone = false;

  if (inp.fromDomain) {
    const brandKey = rootLabel(inp.fromDomain);
    const allow = new Set<string>([
      baseDomain(inp.fromDomain),
      ...((BRAND_ALLOW[brandKey] || []).map(baseDomain)),
    ]);

    for (const d of inp.linkDomains) {
      const aligned = sameBrand(d, inp.fromDomain) || allow.has(baseDomain(d));
      if (!aligned) misaligned.push(d);
      // lookalike check
      if (levenshtein.get(baseDomain(d), baseDomain(inp.fromDomain)) <= 2 && !sameBrand(d, inp.fromDomain)) {
        isClone = true;
      }
    }
  }

  if (isClone) {
    points += 3;
    reasons.push("Lookalike domain similar to sender");
  }

  if (misaligned.length) {
    points += 2;
    reasons.push("Links go to other brands/domains");
  }

  if (inp.dnsMissingCount > 0) {
    points += 2;
    reasons.push("Some linked domains have no DNS");
  }

  let verdict: Verdict = "safe";
  if (points >= 5) verdict = isClone ? "clone" : "phishing";
  else if (points >= 3) verdict = "warning";
  else if (spamHit) verdict = "spam";
  else verdict = "safe";

  if (verdict === "phishing" || verdict === "clone") {
    tips.push("Do not click links", "Do not reply", "Report to IT", "Delete the email");
  } else if (verdict === "spam") {
    tips.push("Delete the email", "Block the sender");
  } else if (verdict === "warning") {
    tips.push("Verify the sender", "Hover over links to check domain");
  } else {
    tips.push("Looks OK from checks", "Still verify unexpected requests");
  }

  return { verdict, reasons, tips };
}

// Multipart parser (.msg/.eml/.html)
async function parseMultipart(
  req: NextApiRequest
): Promise<{ raw?: string; fileBuf?: Buffer; filename?: string }> {
  const form = formidable({
    multiples: false,
    maxFileSize: 20 * 1024 * 1024,
    keepExtensions: true,
  });

  return await new Promise((resolve, reject) => {
    form.parse(req, async (err, fields, files) => {
      if (err) return reject(err);

      let raw: string | undefined;
      const rawField = (fields as any).raw;
      if (typeof rawField === "string") raw = rawField;
      else if (Array.isArray(rawField) && typeof rawField[0] === "string") raw = rawField[0];

      let fileEntry: any =
        (files as any).file ??
        (files as any).files ??
        Object.values(files)[0];

      if (Array.isArray(fileEntry)) fileEntry = fileEntry[0];

      if (fileEntry && fileEntry.filepath) {
        const fs = await import("fs/promises");
        const buf = await fs.readFile(fileEntry.filepath);
        resolve({ raw, fileBuf: buf, filename: fileEntry.originalFilename || "" });
      } else {
        resolve({ raw });
      }
    });
  });
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    let raw = "";
    let fileBuf: Buffer | undefined;
    let filename = "";

    const ct = req.headers["content-type"] || "";
    if (ct.includes("multipart/form-data")) {
      const out = await parseMultipart(req);
      raw = out.raw || "";
      fileBuf = out.fileBuf;
      filename = out.filename || "";
    } else {
      const chunks: Buffer[] = [];
      for await (const c of req) chunks.push(c as Buffer);
      const bodyStr = Buffer.concat(chunks).toString("utf8");
      const body = bodyStr ? JSON.parse(bodyStr) : {};
      raw = body.raw || "";
    }

    if (!fileBuf && !raw) {
      return res.status(400).json({ error: "No email provided" });
    }

    let kind: "eml" | "msg" | "html" | "raw" = "raw";
    let meta = { subject: "", from: "", date: null as any };
    let text = "";
    let html = "";
    let auth: Auth = { spf: "unknown", dkim: "unknown", dmarc: "unknown" };

    // 1) Parse content
    if (fileBuf) {
      const ft = await fileTypeFromBuffer(fileBuf).catch(() => null);
      const ext = (filename.split(".").pop() || "").toLowerCase();

      if (ext === "msg" || ft?.mime === "application/vnd.ms-outlook" || ft?.ext === "msg") {
        kind = "msg";
        try {
          const { default: MSGReader } = await import("msgreader");
          const reader = new MSGReader(new Uint8Array(fileBuf));
          const info = reader.getFileData();
          meta.subject = info.subject || "";
          meta.from = info.senderEmail || "";
          text = info.body || "";
          html = info.bodyHTML || "";
          auth = { spf: "n/a", dkim: "n/a", dmarc: "n/a" }; // .msg has no auth
        } catch {
          return res.status(400).json({ error: "MSG parsing failed. Export as .eml and try again." });
        }
      } else if (ext === "html" || (ft && ft.mime?.startsWith("text/html"))) {
        kind = "html";
        html = fileBuf.toString("utf8");
        auth = { spf: "n/a", dkim: "n/a", dmarc: "n/a" };
      } else {
        // EML
        kind = "eml";
        const parsed = await simpleParser(fileBuf);
        meta.subject = parsed.subject || "";
        const fromAddr = parsed.from?.value?.[0];
        meta.from = fromAddr?.address || "";
        meta.date = parsed.date || null;
        text = parsed.text || "";
        html = parsed.html || "";
        const headers = Object.fromEntries(parsed.headers);
        const authHeader =
          (headers["authentication-results"] as string) ||
          (headers["received-spf"] as string) ||
          "";
        auth = pickAuthFromHeaders(authHeader);
      }
    } else {
      // Raw body fallback
      kind = "raw";
      try {
        const parsed = await simpleParser(Buffer.from(raw, "utf8"));
        meta.subject = parsed.subject || "";
        const fromAddr = parsed.from?.value?.[0];
        meta.from = fromAddr?.address || "";
        meta.date = parsed.date || null;
        text = parsed.text || "";
        html = parsed.html || "";
        const headers = Object.fromEntries(parsed.headers);
        const authHeader =
          (headers["authentication-results"] as string) ||
          (headers["received-spf"] as string) ||
          "";
        auth = pickAuthFromHeaders(authHeader);
        kind = "eml";
      } catch {
        if (raw.trim().startsWith("<")) {
          kind = "html";
          html = raw;
        } else {
          kind = "raw";
          text = raw;
        }
        auth = { spf: "n/a", dkim: "n/a", dmarc: "n/a" };
      }
    }

    // 2) Links and domains
    const links = extractLinks(text, html);
    const linkDomains = Array.from(
      new Set(
        links
          .map((u) => {
            try {
              return baseDomain(new URL(u).hostname);
            } catch {
              return "";
            }
          })
          .filter(Boolean)
      )
    );

    const dnsStatus: Record<string, boolean> = {};
    await Promise.all(
      linkDomains.map(async (d) => {
        dnsStatus[d] = await dnsExists(d);
      })
    );
    const dnsMissingCount = Object.values(dnsStatus).filter((v) => v === false).length;

    const senderHost = meta.from.includes("@") ? meta.from.split("@")[1] : "";
    const senderDomain = senderHost ? baseDomain(senderHost) : undefined;

    // 3) Score a verdict with alignment
    const { verdict, reasons, tips } = scoreVerdict({
      fromDomain: senderDomain,
      linkDomains,
      auth,
      text: (text || "") + " " + (html || ""),
      dnsMissingCount,
    });

    // 4) Add positive confirmation if safe
    const positives: string[] = [];
    if (verdict === "safe") {
      if (senderDomain && linkDomains.every((d) => sameBrand(d, senderDomain))) {
        positives.push("Links align with sender brand");
      }
      if (auth.spf === "pass" || auth.dkim === "pass" || auth.dmarc === "pass") {
        positives.push("At least one auth signal passes");
      }
      if (positives.length) reasons.unshift(...positives);
    }

    return res.status(200).json({
      kind,
      meta,
      auth,
      links,
      linkDomains: linkDomains.map((d) => ({ domain: d, dns: dnsStatus[d] ?? false })),
      verdict,
      reasons,
      tips,
    });
  } catch (e: any) {
    return res.status(500).json({ error: e.message || "Server error" });
  }
}
