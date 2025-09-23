import type { NextApiRequest, NextApiResponse } from "next";
import validator from "validator";
import * as dns from "dns/promises";
import whois from "whois-json";
import axios from "axios";

type MailboxStatus = "unknown" | "valid" | "risky" | "invalid" | "catch-all";

const cache = new Map<string, { ts: number; data: any }>();
const TTL_MS = 6 * 60 * 60 * 1000;

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

async function resolveMxSafe(domain: string) {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 5000, [] as any);
    if (mx?.length) return mx.sort((a: any, b: any) => a.priority - b.priority);
  } catch {}
  try {
    const a = await withTimeout(dns.resolve4(domain), 4000, [] as any);
    if (a.length) return [{ exchange: domain, priority: 0 }];
  } catch {}
  return [];
}

async function dblCheckDomain(domain: string) {
  try {
    const a = await withTimeout(dns.resolve4(`${domain}.dbl.spamhaus.org`), 3000, [] as any);
    return { listed: a.length > 0, engine: "dbl.spamhaus.org" };
  } catch {
    return { listed: false, engine: "dbl.spamhaus.org" };
  }
}

async function rdapCreated(domain: string) {
  try {
    const r = await withTimeout(fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`), 6000, null as any);
    if (r && (r as any).ok) {
      const j: any = await (r as any).json();
      const ev: any[] = Array.isArray(j.events) ? j.events : [];
      const e = ev.find((x) => /registration|created|creation/i.test(x?.eventAction)) ||
                ev.find((x) => /registration|create/i.test(x?.eventAction));
      if (e?.eventDate) return String(e.eventDate);
    }
  } catch {}
  try {
    const info: any = await withTimeout(whois(domain, { follow: 2 }), 6000, null as any);
    const c = info?.creationDate || info?.created || info?.["Creation Date"] || info?.["created"] || null;
    return c ? String(c) : null;
  } catch {
    return null;
  }
}

async function localBaseline(email: string) {
  const formatOK = validator.isEmail(email, { allow_utf8_local_part: false });
  const domain = formatOK ? email.split("@")[1] : "";
  let mx: { exchange: string; priority: number }[] = [];
  let hasMX = false;
  let dbl = { listed: false, engine: "dbl.spamhaus.org" };
  let created: string | null = null;

  if (domain) {
    mx = await resolveMxSafe(domain);
    hasMX = mx.length > 0;
    dbl = await dblCheckDomain(domain);
    created = await rdapCreated(domain);
  }

  const mailbox: { status: MailboxStatus; catchAll?: boolean } = { status: "unknown" };
  const safeToSend = Boolean(formatOK && hasMX && !dbl.listed && mailbox.status !== "invalid");
  const list: "whitelist" | "greylist" | "blacklist" =
    !formatOK || dbl.listed ? "blacklist" : safeToSend ? "whitelist" : "greylist";

  return {
    source: "local",
    input: email,
    formatOK,
    domain,
    hasMX,
    mx,
    mailbox,
    dbl,
    whois: { created },
    verdict: {
      list,
      safeToSend,
      strict: false,
      confidence: { score: 4, band: "medium", ageDays: 0 },
    },
    notes: ["Local baseline used. Could not confirm mailbox existence."],
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();
    const hit = cache.get(email);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      return res.status(200).json(hit.data);
    }

    const formatOK = validator.isEmail(email, { allow_utf8_local_part: false });
    const domain = formatOK ? email.split("@")[1] : "";

    const [mx, dbl, created] = await Promise.all([
      domain ? resolveMxSafe(domain) : Promise.resolve([]),
      domain ? dblCheckDomain(domain) : Promise.resolve({ listed: false, engine: "dbl.spamhaus.org" }),
      domain ? rdapCreated(domain) : Promise.resolve(null),
    ]);
    const hasMX = mx.length > 0;

    const apiKey = process.env.MYEMAILVERIFIER_API_KEY;
    if (!apiKey) throw new Error("Missing MyEmailVerifier API key");

    const response = await axios.get(
      `https://client.myemailverifier.com/verifier/validate_single/${email}/${apiKey}`
    );

    const result = response.data;
    const status = result.Status || "Unknown";
    const catchAll = result.catch_all === "true";
    const greylisted = result.Greylisted === "true";

    let list: "whitelist" | "greylist" | "blacklist";
    let confidence: "high" | "medium" | "low";

    if (status === "Valid") {
      list = "whitelist";
      confidence = "high";
    } else if (status === "Catch-all" || greylisted) {
      list = "greylist";
      confidence = "medium";
    } else {
      list = "blacklist";
      confidence = "low";
    }

    const safeToSend = list === "whitelist";

    const mailbox = {
      status: status.toLowerCase() as MailboxStatus,
      catchAll,
      classification: status,
      reasons: {
        diagnosis: result.Diagnosis,
        roleBased: result.Role_Based === "true",
        disposable: result.Disposable_Domain === "true",
        freeDomain: result.Free_Domain === "true"
      }
    };

    const out = {
      source: "myemailverifier",
      input: email,
      formatOK,
      domain,
      hasMX,
      mx,
      mailbox,
      dbl,
      whois: { created },
      verdict: {
        list,
        safeToSend,
        strict: true,
        confidence: {
          score: confidence === "high" ? 9 : confidence === "medium" ? 5 : 2,
          band: confidence,
          ageDays: created ? Math.max(0, Math.floor((Date.now() - Date.parse(created)) / 86400000)) : 0,
        },
      },
      notes: [
        "Validation performed via MyEmailVerifier.",
        "Includes syntax, MX, catch-all, role, disposable, and greylist checks.",
      ],
    };

    cache.set(email, { ts: Date.now(), data: out });
    res.status(200).json(out);
  } catch (e: any) {
    const email = String(req.query.email || "").trim().toLowerCase();
    const fallback = await localBaseline(email);
    fallback.notes.push(e?.message || "verifier_error");
    res.status(200).json(fallback);
  }
}