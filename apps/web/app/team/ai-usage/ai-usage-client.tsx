"use client";

import { useEffect, useState } from "react";
import { PageHeader, SoftBlockSkeleton } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import "./ai-usage.css";

type Payload = {
  windowDays: number;
  empty: boolean;
  summary: {
    calls: number;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    estimatedUsd: number;
  };
  byModel: Array<{
    provider: string;
    model: string;
    calls: number;
    promptTokens: number;
    completionTokens: number;
    estimatedUsd: number;
  }>;
  events: Array<{
    id: string;
    createdAt: string;
    feature: string;
    provider: string;
    model: string;
    keySource: string;
    promptTokens: number;
    completionTokens: number;
    estimatedUsd: number;
  }>;
  rates: { snapshotDate: string; disclaimer: string };
  error?: string;
};

function money(n: number) {
  if (!Number.isFinite(n) || n <= 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

export default function AiUsageClient({ orgId }: { orgId: string | null }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      setPayload(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const response = await fetch(
          `/api/organizations/ai-usage?orgId=${encodeURIComponent(orgId)}&days=30`,
        );
        const data = (await response.json()) as Payload;
        if (cancelled) return;
        if (!response.ok) {
          setError(data.error ?? "Could not load BYOK usage");
          setErrorStatus(response.status);
          setPayload(null);
        } else {
          setError("");
          setErrorStatus(null);
          setPayload(data);
        }
      } catch {
        if (!cancelled) {
          setError("Could not load BYOK usage");
          setErrorStatus(null);
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const aiHub = hubHref("/ai", "chat", orgId);

  return (
    <main className="module-page ai-usage-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHub}>AI</a>
            {" / BYOK usage"}
          </>
        }
        navPath="/team/ai-usage"
        title="BYOK usage"
        description="Real bring-your-own-key and local connector calls from the usage ledger. Estimated $ from public list rates — not an invoice. Empty until BYOK calls exist."
      />

      <nav className="product-hub-related" aria-label="Related">
        <a className="app-button secondary" href={orgId ? withOrgHref("/team/ai-keys", orgId) : "/team/ai-keys"}>
          AI API keys
        </a>
        <a className="app-button secondary" href={orgId ? withOrgHref("/team/usage", orgId) : "/team/usage"}>
          All AI usage
        </a>
        <a className="app-button secondary" href={orgId ? withOrgHref("/account", orgId) : "/account"}>
          Account
        </a>
      </nav>

      {!orgId ? (
        <section className="app-card soft-panel" role="status">
          <h2>Choose a workspace</h2>
          <p className="app-muted">Open Workspace, pick your organization, then return here.</p>
          <a className="app-button primary" href="/workspace">
            Choose workspace
          </a>
        </section>
      ) : null}

      {loading ? (
        <div aria-busy="true">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : null}

      {error
        ? (() => {
            const copy = loadFailureCopy(
              classifyLoadFailure({
                status: errorStatus,
                message: error,
                online: typeof navigator === "undefined" ? true : navigator.onLine,
              }),
              {
                nextPath:
                  typeof window === "undefined"
                    ? null
                    : `${window.location.pathname}${window.location.search}`,
                message: error,
              },
            );
            return (
              <section className="app-card soft-panel" role="alert">
                <h2>{copy.title}</h2>
                <p className="app-muted">{copy.description}</p>
                {copy.primary ? (
                  <a className="app-button" href={copy.primary.href}>
                    {copy.primary.label}
                  </a>
                ) : null}
                {copy.showRetry ? (
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() => window.location.reload()}
                  >
                    Retry
                  </button>
                ) : null}
              </section>
            );
          })()
        : null}

      {payload && !loading ? (
        <>
          <section className="app-card soft-panel ai-usage-disclaimer" role="note">
            <span className="eyebrow">ESTIMATE ONLY</span>
            <p>{payload.rates.disclaimer}</p>
          </section>

          {payload.empty ? (
            <section className="app-card soft-panel" role="status">
              <h2>No BYOK calls yet</h2>
              <p className="app-muted">
                This page stays empty until real BYOK or local connector calls are recorded. No DEMO
                metrics. Add keys at AI API keys, then use Chat, Writer, or CAD.
              </p>
              <a className="app-button primary" href={withOrgHref("/team/ai-keys", orgId)}>
                Open AI API keys
              </a>
            </section>
          ) : (
            <>
              <section className="ai-usage-summary" aria-label="Summary">
                <article className="app-card soft-panel">
                  <span className="eyebrow">CALLS · {payload.windowDays}D</span>
                  <strong>{payload.summary.calls}</strong>
                </article>
                <article className="app-card soft-panel">
                  <span className="eyebrow">TOKENS</span>
                  <strong>{payload.summary.totalTokens.toLocaleString()}</strong>
                </article>
                <article className="app-card soft-panel">
                  <span className="eyebrow">EST. LIST $</span>
                  <strong>{money(payload.summary.estimatedUsd)}</strong>
                </article>
              </section>

              <section className="app-card soft-panel">
                <span className="eyebrow">BY MODEL</span>
                <ul className="ai-usage-list">
                  {payload.byModel.map((row) => (
                    <li key={`${row.provider}-${row.model}`}>
                      <div>
                        <strong>
                          {row.provider} / {row.model}
                        </strong>
                        <span className="app-muted">
                          {row.calls} calls · {(row.promptTokens + row.completionTokens).toLocaleString()}{" "}
                          tokens
                        </span>
                      </div>
                      <span>{money(row.estimatedUsd)}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section className="app-card soft-panel">
                <span className="eyebrow">RECENT</span>
                <ul className="ai-usage-list">
                  {payload.events.map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>
                          {row.feature} · {row.model}
                        </strong>
                        <span className="app-muted">
                          {new Date(row.createdAt).toLocaleString()} · {row.keySource} ·{" "}
                          {row.promptTokens + row.completionTokens} tokens
                        </span>
                      </div>
                      <span>{money(row.estimatedUsd)}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </>
          )}
        </>
      ) : null}
    </main>
  );
}
