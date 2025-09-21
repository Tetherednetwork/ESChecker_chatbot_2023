// pages/api/bot/advice.ts
import type { NextApiRequest, NextApiResponse } from "next";
import { embedQuery, searchPlaybooks } from "../../../lib/retrieval";

const SOURCES = {
  nist80061: { label: "NIST SP 800-61 Rev. 3", url: "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf" },
  iso27035: { label: "ISO/IEC 27035 overview", url: "https://www.iso.org/standard/78973.html" },
  mitre: { label: "MITRE ATT&CK Matrix", url: "https://attack.mitre.org/matrices/" },
  cvss: { label: "FIRST CVSS v3.1", url: "https://www.first.org/cvss/v3-1/specification-document" },
  sev: { label: "Incident severity levels", url: "https://www.atlassian.com/incident-management/kpis/severity-levels" },
  iso9001: { label: "ISO 9001 documented information", url: "https://www.iso.org/iso/documented_information.pdf" }
};

const bucket = new Map<string, { count: number; ts: number }>();
function rateLimit(req: NextApiRequest) {
  const ip = (req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() || req.socket.remoteAddress || "ip");
  const now = Date.now();
  const w = bucket.get(ip) || { count: 0, ts: now };
  if (now - w.ts > 60000) { w.count = 0; w.ts = now; }
  w.count += 1;
  bucket.set(ip, w);
  return w.count <= 30;
}

// --- New: strict input validation ---
const MIN_CHARS = 15;
const MIN_WORDS = 3;
const KW_IT = ["outage","down","timeout","500","deploy","rollback","wifi","printer","vpn","latency","cpu","disk","memory","sso","login","email","outlook","sharepoint","teams","slow"];
const KW_SEC = ["phish","phishing","malware","ransom","ddos","unauthorized","unauthorised","ioc","cve","exfil","threat","suspicious","credential","spoof","dkim","spf","dmarc"];
const KW_NC = ["nonconformity","non-conformity","audit","procedure","clause","ncr","car","capa","backup"];
function isIssueLike(text: string) {
  const t = text.trim();
  if (t.length < MIN_CHARS) return false;
  const words = t.split(/\s+/);
  if (words.length < MIN_WORDS) return false;
  const low = t.toLowerCase();
  const hit =
    [...KW_IT, ...KW_SEC, ...KW_NC].some(k => low.includes(k)) ||
    /\b(users?|clients?)\b/.test(low) ||
    /\b(error|failure|failed|cannot|can\'t|won\'t|stuck)\b/.test(low) ||
    /\b\d{3}\b/.test(low); // HTTP codes
  return !!hit;
}

function guidancePayload() {
  return {
    error: "Describe the issue in one clear sentence.",
    guidance: [
      "Say the system. Example: VPN, Wi-Fi, Outlook, Website.",
      "Say the scope. Example: 1 user, 20 users, all users.",
      "Say the symptom. Example: cannot login, 500 errors, slow, bounced email.",
      "Add a recent change if known. Example: after deploy, after MFA change."
    ],
    examples: [
      "VPN fails for 20 users after MFA change.",
      "Outlook shows 0x800CCC0E when sending.",
      "Website returns 500 after the last deploy.",
      "User reports phishing email with a fake Microsoft login link."
    ]
  };
}

function classify(t: string) {
  const s = t.toLowerCase();
  if (/\b(phish|malware|ransom|ddos|unauthori[sz]ed|ioc|cve|exfiltr|credential|spoof|dkim|spf|dmarc)\b/.test(s)) return "security";
  if (/\b(outage|down|timeout|500|deploy|rollback|cpu|disk|memory|sla|wifi|printer|vpn|login|email|outlook)\b/.test(s)) return "it_ops";
  if (/\b(nonconform|audit|procedure|clause|ncr|car|capa|backup not)\b/.test(s)) return "nonconformity";
  return "it_ops";
}

function severity(t: string) {
  const s = t.toLowerCase();
  if (/\b(all users|production down|breach|data loss|ransom)\b/.test(s)) return "SEV-1";
  if (/\b(many users|major|security risk|sensitive)\b/.test(s)) return "SEV-2";
  return "SEV-3";
}

function defaultPlan(type: string) {
  if (type === "security") {
    return {
      phase: "Detection and analysis",
      steps: [
        "Open an incident and assign an IR lead",
        "Collect indicators and evidence",
        "Contain at email, endpoint, and network",
        "Eradicate artifacts and reset affected credentials",
        "Recover services and monitor",
        "Record lessons and update detections"
      ],
      citations: [SOURCES.nist80061, SOURCES.mitre, SOURCES.iso27035]
    };
  }
  if (type === "it_ops") {
    return {
      phase: "Response",
      steps: [
        "Declare incident and page on-call",
        "Rollback the last risky change",
        "Check health checks and error rates",
        "Post user status",
        "Mitigate impact and add a guardrail",
        "Create a timeline and owners"
      ],
      citations: [SOURCES.sev]
    };
  }
  return {
    phase: "Correction and corrective action",
    steps: [
      "Contain any impact",
      "Correct the immediate error",
      "Find root cause with 5-Whys",
      "Define corrective action with owner and date",
      "Verify effectiveness and keep records",
      "Update the procedure and train the team"
    ],
    citations: [SOURCES.iso9001]
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST required" });
    if (!rateLimit(req)) return res.status(429).json({ error: "Rate limit" });

    const { text } = req.body || {};
    if (!text || typeof text !== "string") return res.status(400).json(guidancePayload());
    if (!isIssueLike(text)) return res.status(400).json(guidancePayload()); // <-- blocks “Hello”

    const type = classify(text);
    const sev = severity(text);
    let plan = defaultPlan(type);

    const qEmb = await embedQuery(text).catch(() => null);
    if (qEmb) {
      const rows = await searchPlaybooks(qEmb).catch(() => []);
      const best = rows?.[0];
      if (best && best.similarity >= 0.75) {
        plan = { phase: plan.phase, steps: best.steps, citations: best.citations };
      }
    }

    res.status(200).json({
      id: null,
      type,
      severity: sev,
      phase: plan.phase,
      steps: plan.steps,
      citations: plan.citations
    });
  } catch (e: any) {
    res.status(500).json({ error: e.message || "Server error" });
  }
}
