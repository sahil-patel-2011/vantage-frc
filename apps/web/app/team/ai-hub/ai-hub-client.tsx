"use client";

import { useEffect, useState } from "react";

type Signals = {
  members: number;
  pendingInvites: number;
  knowledgeChars: number;
  teamMemories: number;
  alumni: number;
  assistantRuns: number;
  budgetsConfigured: boolean | null;
  discordConnected: boolean | null;
};

type Data = { role: string; isAdmin: boolean; teamNumber: number | null; signals: Signals };

type Card = { title: string; blurb: string; href: string; status: string; adminOnly?: boolean };

function cards(data: Data, orgId: string): Card[] {
  const s = data.signals;
  const q = `?orgId=${orgId}`;
  return [
    {
      title: "Assistant",
      blurb: "Chat with your team-aware FRC AI. It reads your knowledge on every turn.",
      href: `/chat${q}`,
      status: s.assistantRuns > 0 ? `${s.assistantRuns} runs` : "Try it",
    },
    {
      title: "Team Knowledge",
      blurb: "One shared doc the AI always knows — robot, strategy, conventions.",
      href: `/team/knowledge${q}`,
      status: s.knowledgeChars > 100 ? "Set up" : "Empty",
    },
    {
      title: "Prompt Library",
      blurb: "Reusable prompts your team saves so good asks aren't re-invented.",
      href: `/team/prompts${q}`,
      status: "Open",
    },
    {
      title: "Team Memory",
      blurb: "Shared memories promoted from chats, with retention limits.",
      href: `/team/ai-memory${q}`,
      status: s.teamMemories > 0 ? `${s.teamMemories} saved` : "None yet",
    },
    {
      title: "AI Usage",
      blurb: "Every metered call, funding source, and blocked request.",
      href: `/team/usage${q}`,
      status: "View",
      adminOnly: true,
    },
    {
      title: "AI Runs",
      blurb: "Full run history including failures and the sources behind each answer.",
      href: `/team/ai-runs${q}`,
      status: "View",
      adminOnly: true,
    },
    {
      title: "API Budgets",
      blurb: "Hard spend and token limits enforced before every call.",
      href: `/team/budgets${q}`,
      status: s.budgetsConfigured === true ? "Configured" : s.budgetsConfigured === false ? "Not set" : "—",
      adminOnly: true,
    },
    {
      title: "Getting Started",
      blurb: "A checklist to finish setting up your workspace.",
      href: `/team/getting-started${q}`,
      status: "Open",
    },
  ];
}

export default function AiHubClient({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/team/getting-started?orgId=${orgId}`);
      const body = await response.json();
      if (!active) return;
      if (!response.ok) setMessage(body.error ?? "Unable to load AI hub");
      else {
        setMessage("");
        setData(body);
      }
      setLoading(false);
    }
    void load();
    return () => {
      active = false;
    };
  }, [orgId]);

  const list = data ? cards(data, orgId).filter((c) => data.isAdmin || !c.adminOnly) : [];

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI HUB</span>
          <h1>Your team&apos;s AI, all in one place</h1>
          <p className="app-muted">
            Everything the assistant uses and everything you can steer — knowledge, prompts, memory, usage, and
            limits. Start with the assistant; give it context and it does the rest.
          </p>
        </div>
        <nav className="intel-actions" aria-label="Team links">
          <a href={`/chat?orgId=${orgId}`}>Assistant</a>
          <a href={`/team?orgId=${orgId}`}>Team admin</a>
        </nav>
      </header>

      {message && <p role="status" className="telemetry-status">{message}</p>}
      {loading && <p className="app-muted">Loading…</p>}

      {!loading && data && (
        <section
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))",
            gap: "14px",
          }}
        >
          {list.map((card) => (
            <a
              key={card.title}
              href={card.href}
              className="intel-panel"
              style={{ display: "block", textDecoration: "none", color: "inherit" }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "8px" }}>
                <strong style={{ fontSize: "17px" }}>{card.title}</strong>
                <span style={{ color: "#16d9e8", font: "11px monospace" }}>{card.status}</span>
              </div>
              <p className="app-muted" style={{ marginTop: "6px", lineHeight: 1.5 }}>
                {card.blurb}
              </p>
            </a>
          ))}
        </section>
      )}
    </main>
  );
}
