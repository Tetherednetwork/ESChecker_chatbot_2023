// pages/upload.tsx
import React, { useRef, useState } from "react";
import Head from "next/head";

type ApiRes = {
  kind: "eml" | "msg" | "html" | "raw";
  meta: { subject: string; from: string; date: string | null };
  auth: { spf: string; dkim: string; dmarc: string };
  links: string[];
  linkDomains: { domain: string; dns: boolean }[];
  verdict: "safe" | "warning" | "phishing" | "clone" | "spam";
  reasons: string[];
  tips: string[];
};
type Item =
  | { fileName: string; data: ApiRes; ts: number }
  | { fileName: string; error: string; ts: number };

function debounce<T extends (...args: any[]) => void>(fn: T, ms: number) {
  let t: any;
  return (...args: any[]) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

function EmailChecker() {
  const [q, setQ] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [res, setRes] = React.useState<any>(null);
  const [err, setErr] = React.useState<string | null>(null);

  const run = React.useMemo(
    () =>
      debounce(async (value: string) => {
        if (!value || value.length < 5 || !value.includes("@")) {
          setRes(null);
          setErr(null);
          setLoading(false);
          return;
        }
        setLoading(true);
        setErr(null);
        try {
          const r = await fetch(
            `/api/email/verify?email=${encodeURIComponent(value)}`
          );
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || "check_failed");
          setRes(j);
        } catch (e: any) {
          setErr(e.message || "error");
          setRes(null);
        } finally {
          setLoading(false);
        }
      }, 600),
    []
  );

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const v = e.target.value.trim();
    setQ(v);
    setLoading(true);
    run(v);
  }

  const badge =
    res?.verdict?.list === "blacklist"
      ? { text: "BLACKLIST", bg: "#ef4444" }
      : res?.verdict?.list === "whitelist"
      ? { text: "WHITELIST", bg: "#10b981" }
      : res?.verdict?.list === "greylist"
      ? { text: "GREYLIST", bg: "#f59e0b" }
      : null;

  return (
    <div className="ec-wrap">
      <input
        type="email"
        placeholder="Type an email to validate..."
        value={q}
        onChange={onChange}
        className="ec-input"
      />
      {loading && <span className="spin" aria-label="checking" />}
      {!loading && badge && (
        <span className="ec-badge" style={{ background: badge.bg }}>
          {badge.text}
        </span>
      )}

      {!loading && res && (
        <div className="ec-pop">
          <div><b>Domain:</b> {res.domain || "-"}</div>
          <div><b>Format:</b> {String(res.formatOK)}</div>
          <div><b>MX:</b> {res.hasMX ? "yes" : "no"}</div>
          <div>
            <b>Mailbox:</b> {res.mailbox?.status}
            {res.mailbox?.catchAll ? " (catch-all)" : ""}
          </div>
          <div><b>Blacklist (DBL):</b> {res.dbl?.listed ? "listed" : "clear"}</div>
          <div><b>Domain Created:</b> {res.whois?.created || "-"}</div>
          <div><b>Safe to send:</b> {String(res.verdict?.safeToSend)}</div>
          <div>
            <b>Confidence:</b> {res.verdict?.confidence?.band} ({res.verdict?.confidence?.score})
          </div>
        </div>
      )}
      {!loading && err && <div className="ec-pop err">{err}</div>}

      <style jsx>{`
        .ec-wrap {
          position: relative;
          display: inline-flex;
          align-items: center;
          gap: 10px;
          width: 100%;
          max-width: 540px;
          z-index: 3;
        }
        .ec-input {
          flex: 1;
          background: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #e5e7eb;
          padding: 12px 14px;
          border-radius: 12px;
          outline: none;
          font-size: 15px;
        }
        .ec-badge {
          color: white;
          font-size: 12px;
          padding: 4px 10px;
          border-radius: 999px;
          white-space: nowrap;
        }
        .spin {
          width: 18px;
          height: 18px;
          border: 2px solid rgba(255, 255, 255, 0.25);
          border-top-color: #93c5fd;
          border-radius: 50%;
          animation: rot 0.8s linear infinite;
        }
        .ec-pop {
          position: absolute;
          left: 0;
          right: 0; /* contain to input width */
          top: calc(100% + 10px);
          background: rgba(11, 18, 32, 0.96);
          border: 1px solid rgba(255, 255, 255, 0.08);
          color: #e5e7eb;
          padding: 12px 14px;
          border-radius: 12px;
          box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
          font-size: 14px;
          z-index: 4;
          max-width: 100%;
        }
        .ec-pop.err { color: #fca5a5; }
        @media (max-width: 480px) {
          .ec-pop {
            position: fixed;
            left: 16px;
            right: 16px;
            bottom: 16px;
            top: auto;
            max-width: calc(100vw - 32px);
          }
        }
        @keyframes rot { to { transform: rotate(360deg); } }
      `}</style>
    </div>
  );
}

export default function UploadPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [hint, setHint] = useState<string | null>(null);

  function verdictColor(v: ApiRes["verdict"]) {
    if (v === "safe") return "#10b981";
    if (v === "warning") return "#f59e0b";
    if (v === "spam") return "#6b7280";
    return "#ef4444";
  }

  async function handleFile(f: File) {
    setHint(null);
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/email/inspect", { method: "POST", body: fd });
      const j = await r.json();
      if (!r.ok) {
        setItems((prev) => [
          { fileName: f.name, error: j.error || "Upload failed", ts: Date.now() },
          ...prev,
        ]);
      } else {
        setItems((prev) => [
          { fileName: f.name, data: j as ApiRes, ts: Date.now() },
          ...prev,
        ]);
      }
    } catch (e: any) {
      setItems((prev) => [
        { fileName: f.name, error: e.message || "Network error", ts: Date.now() },
        ...prev,
      ]);
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function onPick() { fileRef.current?.click(); }
  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) { setHint("Choose a .eml, .msg, or .html file."); return; }
    handleFile(f);
  }
  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f) { setHint("Drop one .eml, .msg, or .html file."); return; }
    handleFile(f);
  }

  return (
    <div className="page">
      <Head>
        <title>Email Safety Checker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b1220" />

        {/* Favicons */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />

        {/* Preload brand + background assets */}
        <link rel="preload" as="image" href="/logo.png" />
        <link rel="preload" as="image" href="/bg-poster.jpg" />
        <link rel="preload" as="video" href="/bg.webm" type="video/webm" />
        <link rel="preload" as="video" href="/bg.mp4" type="video/mp4" />
      </Head>

      {/* Background video */}
      <video
        className="bg-video"
        autoPlay
        muted
        loop
        playsInline
        preload="auto"
        poster="/bg-poster.jpg"
        aria-hidden="true"
      >
        <source src="/bg.webm" type="video/webm" />
        <source src="/bg.mp4" type="video/mp4" />
      </video>
      <div className="bg-overlay" aria-hidden="true" />

      {/* Brand header with logo (PNG from /public) */}
      <header className="brand" aria-label="brand">
        <img
          src="/logo.png"
          alt="Brand logo"
          className="brand-logo"
          width={140}
          height={40}
        />
        <span className="brand-name">ESChecker 2025</span>
      </header>

      <div className="grid">
        {/* LEFT COLUMN */}
        <section className="left column">
          <h2 className="title">Email Safety Checker</h2>
          <p className="subtitle">
            SAFE. No high-risk signals.<br />
            WARNING. One risk signal.<br />
            PHISHING. Multiple risk signals or failed auth.<br />
            CLONE. Lookalike domain risk.<br />
            SPAM. Spam terms with low technical risk.
          </p>

          <div
            className={`drop ${dragOver ? "active" : ""}`}
            onDragEnter={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragOver={(e) => { e.preventDefault(); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <div className="drop-inner">
              <div className="drop-icon" aria-hidden>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 3l3.5 3.5-2 2L13 7.99V14h-2V7.99l-.5.51-2-2L12 3z" />
                  <path d="M6 14v4h12v-4h2v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4h2z" />
                </svg>
              </div>
              <div className="drop-title">Upload an email file</div>
              <div className="drop-sub">Accepts .eml, .msg, .html</div>
              <div className="cta">
                <button className="primary" onClick={onPick} disabled={loading}>
                  {loading ? "Checking…" : "Choose file"}
                </button>
                <span className="hint">or drag and drop here</span>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept=".eml,.msg,.html"
                hidden
                onChange={onInputChange}
              />
              {hint && <div className="error">{hint}</div>}
            </div>
          </div>

          <div className="resultsBox">
            {items.length === 0 ? (
              <div className="empty">
                <div className="empty-art" aria-hidden>
                  <svg width="180" height="90" viewBox="0 0 220 120" fill="none">
                    <rect x="10" y="20" width="200" height="80" rx="12" fill="rgba(255,255,255,0.06)" />
                    <rect x="25" y="35" width="170" height="14" rx="7" fill="rgba(255,255,255,0.15)" />
                    <rect x="25" y="55" width="130" height="10" rx="5" fill="rgba(255,255,255,0.1)" />
                    <rect x="25" y="73" width="90" height="10" rx="5" fill="rgba(255,255,255,0.1)" />
                  </svg>
                </div>
                <p>No results yet</p>
              </div>
            ) : (
              <div className="resultList">
                {items.map((it) => {
                  const key = `${it.fileName}-${it.ts}`;
                  if ("error" in it) {
                    return (
                      <article key={key} className="card card-error">
                        <header className="card-head">
                          <div className="file">{it.fileName}</div>
                          <span className="badge" style={{ background: "#ef4444" }}>ERROR</span>
                        </header>
                        <div className="line">
                          <span className="label">Message</span>
                          <span className="value err">{it.error}</span>
                        </div>
                      </article>
                    );
                  }
                  const d = it.data;
                  return (
                    <article key={key} className="card">
                      <header className="card-head">
                        <div className="file">{it.fileName}</div>
                        <span className="badge" style={{ background: verdictColor(d.verdict) }}>
                          {d.verdict.toUpperCase()}
                        </span>
                      </header>

                      <div className="gridInfo">
                        <div className="line"><span className="label">From</span><span className="value">{d.meta.from || "-"}</span></div>
                        <div className="line"><span className="label">Subject</span><span className="value">{d.meta.subject || "-"}</span></div>
                        <div className="line"><span className="label">Type</span><span className="value">{d.kind.toUpperCase()}</span></div>
                        <div className="line">
                          <span className="label">Auth</span>
                          <span className="value">SPF {d.auth.spf} · DKIM {d.auth.dkim} · DMARC {d.auth.dmarc}</span>
                        </div>
                      </div>

                      {d.reasons.length > 0 && (
                        <div className="block">
                          <div className="block-title">Signals</div>
                          <ul className="list">
                            {d.reasons.map((r, i) => <li key={i}>{r}</li>)}
                          </ul>
                        </div>
                      )}

                      {d.links.length > 0 && (
                        <div className="block">
                          <div className="block-title">Links</div>
                          <ul className="list">
                            {d.links.map((u, i) => (
                              <li key={i}><a href={u} target="_blank" rel="noreferrer">{u}</a></li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {d.linkDomains.length > 0 && (
                        <div className="block">
                          <div className="block-title">Domains</div>
                          <ul className="list">
                            {d.linkDomains.map((o, i) => (
                              <li key={i}>{o.domain} · DNS {o.dns ? "yes" : "no"}</li>
                            ))}
                          </ul>
                        </div>
                      )}

                      {d.tips.length > 0 && (
                        <div className="block">
                          <div className="block-title">What to do</div>
                          <ul className="list">
                            {d.tips.map((t, i) => <li key={i}>{t}</li>)}
                          </ul>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* DIVIDER */}
        <div className="divider" role="separator" />

        {/* RIGHT COLUMN */}
        <section className="right column">
          <h2 className="title small">Email Address Verification</h2>
          <p className="subtitle small">Checks if an email address is real and able to receive mail.</p>

          <div className="privacy">
            <b>Privacy:</b> <br />No test emails sent.<br />
            Probes stop before DATA.<br />
            No message content stored.<br />
            Minimal logs kept for troubleshooting
          </div>

          <div className="checkerBox">
            <EmailChecker />
          </div>
        </section>
      </div>

      <footer className="footer">
        eofolarin initiative 2024 ©{" "}
        <a href="https://www.eofolarin.com" target="_blank" rel="noreferrer">
          www.eofolarin.com
        </a>
      </footer>

      <style jsx>{`
        * { box-sizing: border-box; }

        .page {
          min-height: 100vh;
          color: #e5e7eb;
          position: relative;
          padding-top: 64px;
          background: transparent;
        }

        /* Background video and overlay */
        .bg-video {
          position: fixed;
          inset: 0;
          width: 100vw;
          height: 100vh;
          object-fit: cover;
          z-index: 0;
          filter: brightness(0.55) contrast(1.05) saturate(1.08);
          pointer-events: none;
        }
        .bg-overlay {
          position: fixed;
          inset: 0;
          z-index: 1;
          pointer-events: none;
          background:
            radial-gradient(800px 400px at 10% 10%, rgba(59,130,246,0.25), rgba(59,130,246,0) 60%),
            radial-gradient(700px 350px at 90% 20%, rgba(16,185,129,0.22), rgba(16,185,129,0) 60%),
            radial-gradient(900px 500px at 50% 100%, rgba(168,85,247,0.22), rgba(168,85,247,0) 60%);
        }
        @media (prefers-reduced-motion: reduce) {
          .bg-video { display: none; }
          .bg-overlay {
            background:
              radial-gradient(800px 400px at 10% 10%, rgba(59,130,246,0.15), transparent 60%),
              radial-gradient(700px 350px at 90% 20%, rgba(16,185,129,0.12), transparent 60%),
              radial-gradient(900px 500px at 50% 100%, rgba(168,85,247,0.12), transparent 60%),
              #0b1220;
          }
        }

        /* Brand header */
        .brand {
          position: fixed;
          top: 12px;
          left: 12px;
          display: flex;
          align-items: center;
          gap: 10px;
          padding: 8px 12px;
          border-radius: 12px;
          background: rgba(11, 18, 32, 0.55);
          backdrop-filter: blur(6px);
          box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
          z-index: 20;
        }
        .brand-logo {
          display: block;
          max-height: 40px;
          height: auto;
          width: auto;
          object-fit: contain;
        }
        .brand-name {
          font-weight: 700;
          letter-spacing: 0.2px;
          color: #e5e7eb;
        }

        /* Mobile: center and shrink brand, add extra top padding so it never covers content */
        @media (max-width: 540px) {
          .brand {
            left: 50%;
            transform: translateX(-50%);
            padding: 6px 10px;
          }
          .brand-logo { max-height: 32px; }
          .brand-name { font-size: 14px; }
          .page { padding-top: 100px; }
        }

        /* Main grid - mobile first */
        .grid {
          position: relative;
          z-index: 2;
          display: grid;
          grid-template-columns: 1fr;
          gap: 24px;
          max-width: 1200px;
          margin: 0 auto;
          padding: clamp(16px,4vw,40px) clamp(12px,5vw,24px) 80px;
        }
        .column { min-width: 0; } /* allow shrinking to avoid overflow */

        .left, .right { padding: 0; }
        .divider { display: none; }

        /* Desktop layout + space around divider */
        @media (min-width: 1024px) {
          .grid {
            grid-template-columns: minmax(0,1fr) 1px minmax(0,1fr);
            gap: 0;
            --divider-gap: 12px; /* change to 5px if you want the minimum */
          }
          .divider {
            display: block;
            width: 1px;
            background: rgba(255, 255, 255, 0.12);
            min-height: 72vh;
            align-self: stretch;
          }
          .left  { padding-right: var(--divider-gap); }
          .right { padding-left:  var(--divider-gap); }
        }

        .title {
          text-align: center;
          font-weight: 800;
          color: #8ee2c2;
          letter-spacing: 0.3px;
          margin: 8px 0 4px 0;
        }
        .title.small { color: #78d2b5; }
        .subtitle {
          text-align: center;
          color: #cbd5e1;
          font-size: 14px;
          margin-bottom: 22px;
          line-height: 1.5;
        }
        .subtitle.small { margin-bottom: 8px; }
        .privacy {
          color: #a3b0c2;
          font-size: 13px;
          line-height: 1.6;
          margin: 8px 0 22px 0;
        }

        /* Upload card */
        .drop {
          border: 1px dashed rgba(255, 255, 255, 0.2);
          border-radius: 16px;
          padding: 24px;
          background: rgba(255, 255, 255, 0.04);
          box-shadow: inset 0 10px 30px rgba(0,0,0,0.25);
          transition: border-color .2s, background .2s, transform .2s;
          max-width: 640px;
          margin: 0 auto 18px;
        }
        .drop.active {
          border-color: rgba(59,130,246,0.6);
          background: rgba(59,130,246,0.08);
          transform: translateY(-1px);
        }
        .drop-inner { text-align: center; }
        .drop-icon { color: #93c5fd; margin-bottom: 6px; }
        .drop-title { font-weight: 700; font-size: 18px; }
        .drop-sub { color: #9ca3af; font-size: 13px; margin-top: 2px; }
        .cta {
          margin-top: 10px;
          display: flex;
          gap: 12px;
          justify-content: center;
          align-items: center;
        }
        .primary {
          background: linear-gradient(135deg, #2563eb, #7c3aed);
          border: none; color: white; padding: 10px 14px; border-radius: 12px; cursor: pointer;
          box-shadow: 0 6px 20px rgba(124,58,237,0.35);
        }
        .primary:disabled { opacity: .7; cursor: default; }
        .hint { color: #94a3b8; font-size: 12px; }
        .error { color: #fca5a5; margin-top: 8px; font-size: 13px; }

        /* Results box */
        .resultsBox {
          max-width: 640px;
          width: 100%;
          box-sizing: border-box;
          overflow-x: hidden;
          margin: 12px auto 0;
          background: rgba(255, 255, 255, 0.04);
          border: 1px solid rgba(255, 255, 255, 0.08);
          border-radius: 16px;
          padding: 14px;
        }
        .empty {
          display: grid; justify-items: center; gap: 8px; padding: 16px 8px;
          color: #9ca3af;
        }
        .resultList { display: grid; gap: 12px; width: 100%; }
        .card {
          padding: 14px;
          border-radius: 14px;
          background: rgba(255, 255, 255, 0.05);
          border: 1px solid rgba(255, 255, 255, 0.08);
          animation: fadeIn 180ms ease-out;
          max-width: 100%;
          overflow-wrap: anywhere;
          word-break: break-word;
        }
        .card-error {
          border: 1px solid rgba(239,68,68,0.35);
          background: rgba(239,68,68,0.08);
        }
        .card-head {
          display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px;
        }
        .file { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .badge { color: white; font-size: 12px; padding: 4px 10px; border-radius: 999px; }
        .gridInfo {
          display: grid; grid-template-columns: repeat(auto-fit,minmax(220px,1fr)); gap: 10px 16px;
        }
        .line { display: grid; gap: 2px; min-width: 0; }
        .label { font-size: 12px; color: #9ca3af; }
        .value { font-size: 14px; white-space: normal; overflow-wrap: anywhere; word-break: break-word; }
        .value.err { color: #fca5a5; }
        .block { margin-top: 10px; }
        .block-title { font-weight: 600; margin-bottom: 6px; }
        .list { margin: 0; padding-left: 18px; color: #cbd5e1; }
        .list li { overflow-wrap: anywhere; word-break: break-word; }
        a { color: #93c5fd; text-decoration: none; display: inline-block; max-width: 100%; white-space: normal; overflow-wrap: anywhere; word-break: break-all; }
        a:hover { text-decoration: underline; }

        .checkerBox { margin-top: 12px; }

        .footer {
          text-align: center;
          color: #91a1b6;
          font-size: 12px;
          padding: 16px 12px 22px;
          position: relative;
          z-index: 2;
        }
        .footer a { color: #a7c0ff; }
      `}</style>
    </div>
  );
}
