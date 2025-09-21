import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error("Set Supabase env vars"); process.exit(1); }
const supa = createClient(url, key, { auth: { persistSession: false } });

const items = [
  {
    slug: "phishing-initial-access",
    type: "security",
    title: "Phishing email reported",
    symptoms: ["phishing","fake login","suspicious link","credential harvest"],
    steps: [
      "Block the sender and domain in the email gateway",
      "Quarantine samples and URLs for analysis",
      "Reset credentials for any clicked users",
      "Hunt IOCs in email and endpoint logs for 7 days",
      "Notify users and send phishing guidance"
    ],
    citations: [
      { label: "NIST SP 800-61 Rev. 3", url: "https://nvlpubs.nist.gov/nistpubs/SpecialPublications/NIST.SP.800-61r3.pdf" },
      { label: "MITRE ATT&CK Matrix", url: "https://attack.mitre.org/matrices/" },
      { label: "ISO/IEC 27035 overview", url: "https://www.iso.org/standard/78973.html" }
    ]
  },
  {
    slug: "site-down-post-deploy",
    type: "it_ops",
    title: "Production site down after deploy",
    symptoms: ["down","outage","500","timeout","after deploy"],
    steps: [
      "Declare an incident and page on-call",
      "Rollback the last risky change",
      "Check health checks and error rates",
      "Post status to users",
      "Add a guardrail to prevent repeat"
    ],
    citations: [
      { label: "Incident severity levels", url: "https://www.atlassian.com/incident-management/kpis/severity-levels" }
    ]
  },
  {
    slug: "backup-nonconformity",
    type: "nonconformity",
    title: "Backup procedure not followed",
    symptoms: ["audit","backup not done","procedure gap","nonconformity"],
    steps: [
      "Contain any customer impact",
      "Perform the missed backup now",
      "Find root cause with 5-Whys",
      "Define corrective action with owner and date",
      "Verify effectiveness and record evidence"
    ],
    citations: [
      { label: "ISO 9001 documented information", url: "https://www.iso.org/iso/documented_information.pdf" }
    ]
  }
];

for (const pb of items) {
  const { error } = await supa.from("kb_playbooks").upsert(pb, { onConflict: "slug" });
  if (error) { console.error(error.message); process.exit(1); }
  console.log("Upserted", pb.slug);
}
