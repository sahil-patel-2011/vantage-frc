"use client";

import { useEffect, useState } from "react";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";

type Signals = {
  members: number;
  pendingInvites: number;
  knowledgeChars: number;
  teamMemories: number;
  alumni: number;
  assistantRuns: number;
  budgetsConfigured: boolean | null;
  byokKeysConfigured: boolean | null;
  discordConnected: boolean | null;
};

type Data = { role: string; isAdmin: boolean; teamNumber: number | null; signals: Signals };

type Card = { title: string; blurb: string; href: string; status: string; adminOnly?: boolean };

type Shell = "loading" | "ready" | "empty" | "error";

function cards(data: Data, orgId: string): Card[] {
  const s = data.signals;
  return [
    {
      title: "Assistant",
      blurb: "Chat with your team-aware FRC AI. It reads your knowledge on every turn.",
      href: hubHref("/ai", "chat", orgId),
      status: s.assistantRuns > 0 ? `${s.assistantRuns} runs` : "Try it",
    },
    {
      title: "Writer",
      blurb: "Grant answers and sponsor pitches from this org’s profile only — never DEMO essays.",
      href: hubHref("/ai", "writer", orgId),
      status: "Open",
    },
    {
      title: "Team Knowledge",
      blurb: "One shared doc the AI always knows — robot, strategy, conventions.",
      href: hubHref("/team", "knowledge", orgId),
      status: s.knowledgeChars > 100 ? "Set up" : "Empty",
    },
    {
      title: "Prompt Library",
      blurb: "Reusable prompts your team saves so good asks aren't re-invented.",
      href: withOrgHref("/team/prompts", orgId),
      status: "Open",
    },
    {
      title: "Team Memory",
      blurb: "Shared memories promoted from chats, with retention limits.",
      href: hubHref("/ai", "memory", orgId),
      status: s.teamMemories > 0 ? `${s.teamMemories} saved` : "None yet",
    },
    {
      title: "AI Usage",
      blurb: "Every metered call, funding source, and blocked request.",
      href: hubHref("/ai", "usage", orgId),
      status: "View",
      adminOnly: true,
    },
    {
      title: "AI Runs",
      blurb: "Full run history including failures and the sources behind each answer.",
      href: withOrgHref("/team/ai-runs", orgId),
      status: "View",
      adminOnly: true,
    },
    {
      title: "AI API keys",
      blurb: "Paste OpenAI, Anthropic, Google, or OpenRouter keys — or keep using hosted AI (OpenRouter on Free, Anthropic on paid).",
      href: withOrgHref("/team/ai-keys", orgId),
      status: s.byokKeysConfigured === true ? "Configured" : s.byokKeysConfigured === false ? "Missing" : "—",
      adminOnly: true,
    },
    {
      title: "API Budgets",
      blurb: "Hard spend and token limits enforced before every call.",
      href: hubHref("/ai", "budgets", orgId),
      status: s.budgetsConfigured === true ? "Configured" : s.budgetsConfigured === false ? "Not set" : "—",
      adminOnly: true,
    },
    {
      title: "Prompt caching",
      blurb: "Reuse stable system and context blocks to lower input cost.",
      href: `${hubHref("/ai", "budgets", orgId)}#prompt-caching`,
      status: "Manage",
      adminOnly: true,
    },
    {
      title: "Code Coach",
      blurb: "Local pattern review (free) — teach safer habits; AI chat/CAD stay metered.",
      href: hubHref("/ai", "code", orgId),
      status: "Local",
    },
    {
      title: "CAD Builder",
      blurb: "Cited briefs, allowlisted plans, human-approved geometry.",
      href: withOrgHref("/cad", orgId),
      status: "Open",
    },
    {
      title: "Getting Started",
      blurb: "A checklist to finish setting up your workspace.",
      href: withOrgHref("/team/getting-started", orgId),
      status: "Open",
    },
  ];
}

function classifyShell(input: { loading: boolean; error: string; hasData: boolean }): Shell {
  if (input.loading) return "loading";
  if (input.error.trim()) return "error";
  if (!input.hasData) return "empty";
  return "ready";
}

export default function AiHubClient({ orgId }: { orgId: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      const response = await fetch(`/api/team/getting-started?orgId=${encodeURIComponent(orgId)}`);
      const body = await response.json();
      if (!active) return;
      if (!response.ok) {
        setErrorStatus(response.status);
        setMessage(body.error ?? "Unable to load AI hub");
      } else {
        setMessage("");
        setErrorStatus(null);
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
  const shell = classifyShell({ loading, error: message, hasData: Boolean(data) });
  const aiHubHref = withOrgHref("/ai", orgId);
  const chatHref = hubHref("/ai", "chat", orgId);
  const writerHref = hubHref("/ai", "writer", orgId);
  const budgetsHref = hubHref("/ai", "budgets", orgId);

  return (
    <main className="module-page product-hub product-hub--ai ai-hub-launcher">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">AI / Launcher</span>
          <h1>Your team&apos;s AI, all in one place</h1>
          <p className="app-muted">
            Everything the assistant uses and everything you can steer — knowledge, prompts, memory, usage, and limits.
            Statuses come from real Neon rows only — never DEMO run counts.
          </p>
        </div>
        <nav className="intel-actions" aria-label="AI hub links">
          <a href={aiHubHref}>AI hub</a>
          <a href={chatHref}>Chat</a>
          <a href={writerHref}>Writer</a>
          <a href={budgetsHref}>Budgets</a>
          <a href={withOrgHref("/team", orgId)}>Team</a>
        </nav>
      </header>

      {shell === "loading" ? (
        <section className="app-card soft-panel product-hub-setup" aria-busy>
          <h2>Loading AI hub…</h2>
          <p className="app-muted">Checking org-scoped signals for this workspace.</p>
        </section>
      ) : null}

      {shell === "error"
        ? (() => {
            const copy = loadFailureCopy(
              classifyLoadFailure({
                status: errorStatus,
                message,
                online: typeof navigator === "undefined" ? true : navigator.onLine,
              }),
              {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message,
              },
            );
            return (
              <section className="app-card soft-panel product-hub-setup" role="status">
                <span className="app-badge setup">Unavailable</span>
                <h2>{copy.title}</h2>
                <p className="app-muted">{copy.description}</p>
                {copy.primary ? (
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : (
                  <a className="app-button secondary" href={aiHubHref}>
                    Open AI hub
                  </a>
                )}
              </section>
            );
          })()
        : null}

      {shell === "ready" && data ? (
        <section className="ai-hub-launcher-grid" aria-label="AI tools">
          {list.map((card) => (
            <a key={card.title} href={card.href} className="app-card soft-panel ai-hub-launcher-card">
              <div className="ai-hub-launcher-card-head">
                <strong>{card.title}</strong>
                <span className="app-muted">{card.status}</span>
              </div>
              <p className="app-muted">{card.blurb}</p>
            </a>
          ))}
        </section>
      ) : null}
    </main>
  );
}
