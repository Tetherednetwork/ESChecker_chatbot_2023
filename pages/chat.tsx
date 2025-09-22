// pages/chat.tsx
import React, { useEffect, useRef, useState } from "react";
import Head from "next/head";

type Cite = { label: string; url: string };
type BotOut = {
  id: number | null;
  type: string;
  severity: string;
  phase: string;
  steps: string[];
  citations: Cite[];
};
type Msg = { role: "user" | "assistant"; content: string; data?: BotOut };
type GuidanceRes = { error?: string; guidance?: string[]; examples?: string[] };

export default function Chat() {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "assistant",
      content:
        "Describe the issue. I will classify it, set severity, give steps, and cite standards.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function guidanceText(): string {
    return [
      "Please describe the issue in one clear sentence.",
      "",
      "Tips:",
      "- Say the system. Example: VPN, Wi-Fi, Outlook, Website.",
      "- Say the scope. Example: 1 user, 20 users, all users.",
      "- Say the symptom. Example: cannot login, 500 errors, slow, bounced email.",
      "- Add a recent change if known. Example: after deploy, after MFA change.",
      "",
      "Examples:",
      "• VPN fails for 20 users after MFA change.",
      "• Outlook shows 0x800CCC0E when sending.",
      "• Website returns 500 after the last deploy.",
      "• User reports phishing email with a fake Microsoft login link.",
    ].join("\n");
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userText = input.trim();

    const tooShort =
      userText.length < 15 || userText.split(/\s+/).filter(Boolean).length < 3;
    if (tooShort) {
      setMessages((m) => [
        ...m,
        { role: "user", content: userText },
        { role: "assistant", content: guidanceText() },
      ]);
      setInput("");
      return;
    }

    setMessages((m) => [...m, { role: "user", content: userText }]);
    setInput("");
    setLoading(true);
    try {
      const r = await fetch("/api/bot/advice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: userText }),
      });
      const data = await r.json();

      if (!r.ok) {
        const g = data as GuidanceRes;
        const lines: string[] = [];
        if (g.error) lines.push(g.error);
        if (Array.isArray(g.guidance) && g.guidance.length) {
          lines.push("", "Tips:");
          g.guidance.forEach((t) => lines.push("- " + t));
        }
        if (Array.isArray(g.examples) && g.examples.length) {
          lines.push("", "Examples:");
          g.examples.forEach((e) => lines.push("• " + e));
        }
        setMessages((m) => [...m, { role: "assistant", content: lines.join("\n") }]);
        return;
      }

      const out = data as BotOut;
      setMessages((m) => [...m, { role: "assistant", content: "", data: out }]);
    } catch (e: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: e.message || "Network error" },
      ]);
    } finally {
      setLoading(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const inputEl = e.target as HTMLInputElement;
    const f = inputEl.files?.[0];
    if (!f || loading) return;

    setLoading(true);
    try {
      const fd = new FormData();
      fd.append("file", f);
      const r = await fetch("/api/email/inspect", { method: "POST", body: fd });
      const data = await r.json();
      if (!r.ok) {
        setMessages((m) => [
          ...m,
          { role: "user", content: `Uploaded file: ${f.name}` },
          { role: "assistant", content: data.error || "File check failed" },
        ]);
        return;
      }
      const lines = [
        `Email check: ${String(data.verdict || "").toUpperCase()}`,
        `From: ${data.meta?.from || ""}`,
        `Subject: ${data.meta?.subject || ""}`,
        `Auth SPF/DKIM/DMARC: ${data.auth?.spf}/${data.auth?.dkim}/${data.auth?.dmarc}`,
      ];
      if (Array.isArray(data.reasons) && data.reasons.length) {
        lines.push("", "Reasons:");
        data.reasons.forEach((r: string) => lines.push("- " + r));
      }
      if (Array.isArray(data.tips) && data.tips.length) {
        lines.push("", "What to do:");
        data.tips.forEach((t: string) => lines.push("- " + t));
      }
      setMessages((m) => [
        ...m,
        { role: "user", content: `Uploaded file: ${f.name}` },
        { role: "assistant", content: lines.join("\n") },
      ]);
    } catch (err: any) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: err.message || "Upload failed" },
      ]);
    } finally {
      setLoading(false);
      if (inputEl) inputEl.value = "";
    }
  }

  function newChat() {
    setMessages([
      { role: "assistant", content: "New chat started. Describe the issue." },
    ]);
  }

  return (
    <div className="page">
      <Head>
        <title>Chat | ESChecker</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#0b1220" />

        {/* Favicons / manifest */}
        <link rel="icon" href="/favicon.ico" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />

        {/* Preload key assets */}
        <link rel="preload" as="image" href="/logo.png" />
        <link rel="preload" as="image" href="/bg-poster.jpg" />
        <link rel="preload" as="video" href="/bg.webm" type="video/webm" />
        <link rel="preload" as="video" href="/bg.mp4" type="video/mp4" />
      </Head>

      {/* Background video + overlay */}
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

      {/* Brand header */}
      <header className="brand" aria-label="brand">
        <img src="/logo.png" alt="Brand logo" className="brand-logo" width={140} height={40} />
        <span className="brand-name">ESChecker 2025</span>
      </header>

      <div className="chat-grid">
        <aside className="sidebar">
          <button className="btn" onClick={newChat}>New chat</button>
          <div className="aside-note">Chatbot for IT, Security, and Nonconformity.</div>
        </aside>

        <div className="divider" role="separator" />

        <main className="chat-main">
          <div className="topbar">Ops &amp; Security Chatbot</div>

          <div className="feed">
            {messages.map((m, i) => (
              <div key={i} className="row">
                <div className={`avatar ${m.role === "user" ? "user" : "assistant"}`}>
                  {m.role === "user" ? "U" : "A"}
                </div>

                {m.role === "assistant" && m.data ? (
                  <div className="bubble">
                    <p className="t">Type: {m.data.type}</p>
                    <p className="t">Severity: {m.data.severity}</p>
                    <p className="t">Phase: {m.data.phase}</p>

                    <p className="t">Steps:</p>
                    <ol className="ol">
                      {m.data.steps.map((s, idx) => (
                        <li key={idx}>{s}</li>
                      ))}
                    </ol>

                    <p className="t">Citations:</p>
                    <ul className="ul">
                      {m.data.citations.map((c, idx) => (
                        <li key={idx}><a href={c.url} target="_blank" rel="noreferrer">{c.label}</a></li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <pre className="bubble pre">{m.content}</pre>
                )}
              </div>
            ))}
            <div ref={bottomRef} />
          </div>

          {/* Composer (sticky on mobile) */}
          <div className="composer">
            <div className="compose-row">
              <textarea
                rows={6}
                placeholder="Example: VPN fails for 20 users after MFA change."
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="text"
              />
              <button
                className="btn send"
                onClick={send}
                disabled={loading || input.trim().length === 0}
              >
                {loading ? "Working..." : "Send"}
              </button>
            </div>

            <div className="upload-row">
              <input
                type="file"
                accept=".eml,.msg,.html"
                onChange={handleFileChange}
                disabled={loading}
              />
              <div className="small">Accepts .eml, .msg, .html</div>
            </div>

            <div className="small hint">
              The bot cites NIST, ISO 27035, MITRE, CVSS, ISO 9001, and SEV levels.
            </div>
          </div>
        </main>
      </div>

      {/* Footer */}
      <footer className="footer">
        eofolarin initiative 2024 ©{" "}
        <a href="https://www.eofolarin.com" target="_blank" rel="noreferrer">
          www.eofolarin.com
        </a>
      </footer>

      <style jsx>{`
        * { box-sizing: border-box; }

        .page {
          min-height: 100dvh;
          color: #e5e7eb;
          position: relative;
          padding-top: 64px;
          padding-bottom: max(12px, env(safe-area-inset-bottom));
          background: transparent;
          overscroll-behavior: contain;
        }

        .bg-video {
          position: fixed; inset: 0;
          width: 100vw; height: 100vh; object-fit: cover;
          z-index: 0; pointer-events: none;
          filter: brightness(0.55) contrast(1.05) saturate(1.08);
        }
        .bg-overlay {
          position: fixed; inset: 0; z-index: 1; pointer-events: none;
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

        .brand {
          position: fixed; top: 12px; left: 12px;
          display: flex; align-items: center; gap: 10px;
          padding: 8px 12px; border-radius: 12px;
          background: rgba(11,18,32,0.55);
          backdrop-filter: blur(6px);
          box-shadow: 0 6px 24px rgba(0,0,0,0.35);
          z-index: 20;
        }
        .brand-logo { max-height: 40px; display: block; object-fit: contain; }
        .brand-name { font-weight: 700; letter-spacing: .2px; }
        @media (max-width: 540px) {
          .brand { left: 50%; transform: translateX(-50%); padding: 6px 10px; }
          .brand-logo { max-height: 32px; }
          .brand-name { font-size: 14px; }
          .page { padding-top: 100px; } /* ensure logo never covers title */
        }

        /* Layout */
        .chat-grid {
          position: relative; z-index: 2;
          display: grid; grid-template-columns: 1fr; gap: 16px;
          max-width: 1400px; margin: 0 auto;
          padding: clamp(12px,4vw,24px) clamp(10px,5vw,24px) 16px;
        }
        .divider { display: none; }

        @media (min-width: 1024px) {
          .chat-grid {
            grid-template-columns: minmax(220px,280px) 1px minmax(0,1fr);
            gap: 0; --divider-gap: 12px;
          }
          .divider {
            display: block; width: 1px;
            background: rgba(255,255,255,0.12); min-height: 78vh; align-self: stretch;
          }
        }

        .sidebar {
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          padding: 14px;
          height: fit-content;
        }
        @media (min-width: 1024px) { .sidebar { margin-right: var(--divider-gap); } }
        .btn {
          background: linear-gradient(135deg,#2563eb,#7c3aed);
          border: none; color: white; border-radius: 10px;
          padding: 8px 12px; cursor: pointer;
          box-shadow: 0 6px 20px rgba(124,58,237,.35);
          font-size: 14px;
        }
        .btn:disabled { opacity: .7; cursor: default; }
        .aside-note { margin-top: 12px; font-size: 12px; color: #9ca3af; }

        .chat-main { display: flex; flex-direction: column; min-width: 0; --lane-w: min(1100px, 92vw); }
        @media (min-width: 1024px) { .chat-main { margin-left: var(--divider-gap); } }

        .topbar {
          padding: 12px 16px; font-weight: 700;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          margin-bottom: 12px;
          max-width: var(--lane-w); margin-inline: auto;
        }

        .feed {
          flex: 1; overflow-y: auto; padding: 12px;
          background: rgba(255,255,255,0.04);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 14px;
          max-width: var(--lane-w); margin: 0 auto 12px;
        }
        .row { margin-bottom: 14px; display: flex; gap: 10px; align-items: flex-start; }
        .avatar {
          width: 28px; height: 28px; border-radius: 6px;
          display: flex; align-items: center; justify-content: center;
          font-weight: 700; font-size: 12px;
        }
        .avatar.user { background: #334155; }
        .avatar.assistant { background: #1d4ed8; }

        .bubble {
          background: rgba(11,18,32,0.96);
          border: 1px solid rgba(255,255,255,0.08);
          padding: 10px; border-radius: 10px; max-width: 100%;
          overflow-wrap: anywhere; word-break: break-word;
        }
        .pre { white-space: pre-wrap; }
        .t { margin: 0 0 8px 0; }
        .ol { margin: 0 0 12px 18px; padding: 0; }
        .ul { margin: 0 0 0 18px; padding: 0; }
        .ol li, .ul li { margin-bottom: 6px; } /* ≥5px spacing on desktop */
        .bubble a { color: #93c5fd; text-decoration: none; }
        .bubble a:hover { text-decoration: underline; }

        /* Composer */
        .composer {
          position: sticky;
          bottom: max(0px, env(safe-area-inset-bottom));
          background: rgba(11,18,32,0.65);
          backdrop-filter: blur(6px);
          border: 1px solid rgba(255,255,255,0.08);
          border-radius: 12px;
          padding: 10px;
          max-width: var(--lane-w);
          margin: 0 auto;
        }
        .compose-row {
          display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 10px;
        }
        .text {
          min-height: 160px; /* bigger chatbox */
          background: #0b1220; color: #e2e8f0;
          border: 1px solid #1f2937; border-radius: 10px; padding: 12px;
          font-size: 15px; line-height: 1.5;
        }
        .btn.send {
          height: 40px; /* compact */
          padding: 0 14px;
          font-weight: 600; white-space: nowrap;
        }
        .upload-row {
          display: flex; gap: 8px; align-items: center; margin-top: 8px;
        }
        .small { font-size: 12px; color: #9ca3af; }
        .hint { margin-top: 6px; }

        /* Tighten for phones */
        @media (max-width: 640px) {
          .compose-row { grid-template-columns: 1fr; }
          .text { min-height: 120px; font-size: 14px; }
          .btn.send { width: 100%; height: 44px; }
          .row { gap: 8px; }
          .avatar { width: 26px; height: 26px; }
        }

        /* Footer */
        .footer {
          text-align: center;
          color: #91a1b6;
          font-size: 12px;
          padding: 12px 8px 18px;
          position: relative;
          z-index: 2;
          max-width: var(--lane-w);
          margin-inline: auto;
        }
        .footer a { color: #a7c0ff; text-decoration: none; }
        .footer a:hover { text-decoration: underline; }
      `}</style>
    </div>
  );
}
