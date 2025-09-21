import type { NextApiRequest, NextApiResponse } from "next";
import validator from "validator";
import * as dns from "dns/promises";
import whois from "whois-json";
import { VerifaliaRestClient } from "verifalia";

// env
const HELO_DOMAIN = process.env.VERIFY_HELO || "check.example.com";
const MAIL_FROM = process.env.VERIFY_FROM || "postmaster@check.example.com";

const verifalia =
  process.env.VERIFALIA_USERNAME && process.env.VERIFALIA_PASSWORD
    ? new VerifaliaRestClient({
        username: process.env.VERIFALIA_USERNAME!,
        password: process.env.VERIFALIA_PASSWORD!,
      })
    : null;

// simple cache to avoid rechecking same email too often
const cache = new Map<string, { ts: number; data: any }>();
const TTL_MS = 6 * 60 * 60 * 1000;

async function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return await Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

// DNS helpers
async function resolveMxSafe(domain: string) {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), 5000, []);
    if (mx?.length) return mx.sort((a, b) => a.priority - b.priority);
  } catch {}
  try {
    const a = await withTimeout(dns.resolve4(domain), 4000, []);
    if (a.length) return [{ exchange: domain, priority: 0 }];
  } catch {}
  return [];
}

// Spamhaus DBL check (domain)
async function dblCheckDomain(domain: string) {
  try {
    const a = await withTimeout(dns.resolve4(`${domain}.dbl.spamhaus.org`), 3000, []);
    return { listed: a.length > 0, engine: "dbl.spamhaus.org" };
  } catch {
    return { listed: false, engine: "dbl.spamhaus.org" };
  }
}

// RDAP first, WHOIS fallback for created date
async function rdapCreated(domain: string) {
  try {
    const r = await withTimeout(
      fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`),
      6000,
      null as any
    );
    if (r && r.ok) {
      const j: any = await r.json();
      const ev: any[] = Array.isArray(j.events) ? j.events : [];
      const e =
        ev.find((x) => /registration|created|creation/i.test(x?.eventAction)) ||
        ev.find((x) => /registration|create/i.test(x?.eventAction));
      if (e?.eventDate) return String(e.eventDate);
    }
  } catch {}
  try {
    const info: any = await withTimeout(whois(domain, { follow: 2 }), 6000, null as any);
    const c =
      info?.creationDate ||
      info?.created ||
      info?.["Creation Date"] ||
      info?.["created"] ||
      null;
    return c ? String(c) : null;
  } catch {
    return null;
  }
}

// local, lightweight fallback when Verifalia is unavailable
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

  // local baseline can’t prove a mailbox exists. mark unknown.
  const mailbox = { status: "unknown" as const };

  const safeToSend = formatOK && hasMX && !dbl.listed && mailbox.status !== "undeliverable";
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
    verdict: { list, safeToSend, strict: false, confidence: { score: 4, band: "medium", ageDays: 0 } },
    notes: ["Local baseline used. Could not confirm mailbox existence."],
  };
}

function verifaliaSafe(entry: any) {
  // Deliverable => true
  // Risky => false by default (you can relax if you want)
  // Unknown => false
  // Undeliverable => false
  const cls = String(entry?.classification || "").toLowerCase();
  return cls === "deliverable";
}

function toList(entry: any): "whitelist" | "greylist" | "blacklist" {
  const cls = String(entry?.classification || "").toLowerCase();
  if (cls === "deliverable") return "whitelist";
  if (cls === "undeliverable") return "blacklist";
  return "greylist";
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const email = String(req.query.email || "").trim().toLowerCase();

    // cache
    const hit = cache.get(email);
    if (hit && Date.now() - hit.ts < TTL_MS) {
      return res.status(200).json(hit.data);
    }

    const formatOK = validator.isEmail(email, { allow_utf8_local_part: false });
    const domain = formatOK ? email.split("@")[1] : "";

    // always compute domain-level signals for display
    const [mx, dbl, created] = await Promise.all([
      domain ? resolveMxSafe(domain) : Promise.resolve([]),
      domain ? dblCheckDomain(domain) : Promise.resolve({ listed: false, engine: "dbl.spamhaus.org" }),
      domain ? rdapCreated(domain) : Promise.resolve(null),
    ]);
    const hasMX = mx.length > 0;

    // If no Verifalia, return local baseline
    if (!verifalia) {
      const data = await localBaseline(email);
      cache.set(email, { ts: Date.now(), data });
      return res.status(200).json(data);
    }

    // Submit to Verifalia (blocking until completed)
    const job = await verifalia.emailValidations.submit(email, {
      quality: "High",
      deduplication: "Safe",
      retention: "Transient", // no storage
      waitOptions: { // block until done, with a sane timeout
        timeout: 20000,
      },
      sender: { // improves acceptance with some providers
        emailAddress: MAIL_FROM,
        hostName: HELO_DOMAIN,
      },
    });

    const entry = job?.entries?.[0];
    const classification = entry?.classification || "Unknown";
    const status = entry?.status || "Completed";

    const safeToSend = verifaliaSafe(entry);
    const list = toList(entry);

    const out = {
      source: "verifalia",
      input: email,
      formatOK,
      domain,
      hasMX,
      mx,
      mailbox: {
        status: safeToSend ? "deliverable" : classification.toLowerCase() === "undeliverable" ? "undeliverable" : "unknown",
        classification,
        suggestedCorrection: entry?.suggestedCorrection || null,
        completed: status,
        reasons: entry?.statusHistory || entry?.entries || null,
      },
      dbl,
      whois: { created },
      verdict: {
        list,
        safeToSend,
        strict: true,
        confidence: {
          score: safeToSend ? 9 : list === "greylist" ? 5 : 2,
          band: safeToSend ? "high" : list === "greylist" ? "medium" : "low",
          ageDays: created ? Math.max(0, Math.floor((Date.now() - Date.parse(created)) / 86400000)) : 0,
        },
      },
      notes: [
        "Validation performed via Verifalia.",
        "Result reflects mailbox-level verification without sending an email.",
      ],
    };

    cache.set(email, { ts: Date.now(), data: out });
    res.status(200).json(out);
  } catch (e: any) {
    // fall back to local baseline on API error
    const email = String(req.query.email || "").trim().toLowerCase();
    const fallback = await localBaseline(email);
    fallback.notes.push(e?.message || "verifier_error");
    res.status(200).json(fallback);
  }
}
