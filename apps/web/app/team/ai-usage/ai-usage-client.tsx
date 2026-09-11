"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, PageHeader, SoftBlockSkeleton, Button } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
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

const KEY_SOURCE_LABELS: Record<string, string> = {
  platform: "Hosted",
  byo: "Your key",
  local: "This computer",
  local_cli: "This computer",
};

function money(n: number) {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n === 0) return "$0.00";
  if (n < 0.01) return `$${n.toFixed(4)}`;
  return `$${n.toFixed(2)}`;
}

function keySourceLabel(key: string) {
  return KEY_SOURCE_LABELS[key] ?? key;
}

function isUsagePayload(value: unknown): value is Payload {
  if (!value || typeof value !== "object") return false;
  const row = value as Payload;
  return typeof row.windowDays === "number" && Boolean(row.summary) && Boolean(row.rates);
}

async function persistUsageSnapshot(orgId: string, data: Payload): Promise<void> {
  try {
    await putFeatureSnapshot("ai-usage", orgId, data);
  } catch {
    // Live usage already painted; IndexedDB is best-effort.
  }
}

export default function AiUsageClient({ orgId }: { orgId: string | null }) {
  const [payload, setPayload] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(Boolean(orgId));
  const [error, setError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const paintedRef = useRef(false);

  const load = useCallback(async () => {
    if (!orgId) {
      setLoading(false);
      setPayload(null);
      paintedRef.current = false;
      return;
    }
    let hadCache = paintedRef.current;
    try {
      const cached = await getFeatureSnapshot<Payload>("ai-usage", orgId);
      if (cached?.data && isUsagePayload(cached.data)) {
        if (!paintedRef.current) {
          setPayload(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoading(false);
          paintedRef.current = true;
          hadCache = true;
        }
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    if (!hadCache) setLoading(true);
    setError("");
    setErrorStatus(null);
    try {
      const response = await fetch(
        `/api/organizations/ai-usage?orgId=${encodeURIComponent(orgId)}&days=30`,
        { cache: "no-store", signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS) },
      );
      const data: unknown = await response.json().catch(() => null);
      const errorMessage =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "";
      if (response.status === 401 || response.status === 403) {
        paintedRef.current = false;
        setPayload(null);
        setFromCache(false);
        setCachedAt(null);
        setError(errorMessage || "Could not load your key usage");
        setErrorStatus(response.status);
        setLoading(false);
        return;
      }
      if (!response.ok || !isUsagePayload(data)) {
        if (hadCache || paintedRef.current) {
          setFromCache(true);
          setError("");
          setLoading(false);
          return;
        }
        setError(errorMessage || "Could not load your key usage");
        setErrorStatus(response.status);
        setPayload(null);
        setLoading(false);
        return;
      }
      setError("");
      setErrorStatus(null);
      setPayload(data);
      paintedRef.current = true;
      setFromCache(false);
      setCachedAt(null);
      setLoading(false);
      await persistUsageSnapshot(orgId, data);
    } catch {
      if (hadCache || paintedRef.current) {
        setFromCache(true);
        setError("");
        setLoading(false);
        return;
      }
      setError("Could not load your key usage");
      setErrorStatus(null);
      setPayload(null);
      setLoading(false);
    }
  }, [orgId]);

  useEffect(() => {
    void load();
  }, [load]);

  const aiHub = hubHref("/ai", "chat", orgId);
  const showError = Boolean(error) && !payload;

  return (
    <main className="module-page ai-usage-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={aiHub}>AI</a>
            {" / Your keys usage"}
          </>
        }
        navPath="/team/ai-usage"
        title="Your keys usage"
        description="Calls made with your own API keys or a local connector. Estimated $ from public list rates — not an invoice. Empty until those calls exist."
      />
      <OfflineBanner fromCache={fromCache} cachedAt={cachedAt} feature="Your keys usage" />

      <nav className="product-hub-related" aria-label="Related">
        <Button as="a" variant="secondary" href={orgId ? withOrgHref("/team/ai-keys", orgId) : "/team/ai-keys"}>
          AI API keys
        </Button>
        <Button as="a" variant="secondary" href={orgId ? withOrgHref("/team/usage", orgId) : "/team/usage"}>
          All AI usage
        </Button>
        <Button as="a" variant="secondary" href={orgId ? withOrgHref("/account", orgId) : "/account"}>
          Account
        </Button>
      </nav>

      {!orgId ? (
        <EmptyState
          soft
          badge="Needs setup"
          badgeTone="setup"
          title="Choose your team"
          description="Choose your team, then return here."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      ) : null}

      {loading && !payload ? (
        <div aria-busy="true">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : null}

      {showError
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
              <EmptyState badge="Error" badgeTone="setup" title={copy.title} description={copy.description}>
                {copy.primary ? (
                  <Button as="a" variant="primary" href={copy.primary.href}>
                    {copy.primary.label}
                  </Button>
                ) : null}
                {copy.showRetry ? (
                  <Button variant="secondary" type="button" onClick={() => void load()}>
                    Retry
                  </Button>
                ) : null}
              </EmptyState>
            );
          })()
        : null}

      {payload && !(loading && !fromCache) ? (
        <>
          <section className="app-card soft-panel ai-usage-disclaimer" role="note">
            <span className="eyebrow">Estimate only</span>
            <p>{payload.rates.disclaimer}</p>
          </section>

          {payload.empty ? (
            <EmptyState
              soft
              title="No calls with your keys yet"
              description="Nothing to show until your own API key or a local connector is used. Add a key under AI API keys, then try Chat, Writer, or CAD."
            >
              <Button as="a" variant="primary" href={withOrgHref("/team/ai-keys", orgId ?? "")}>
                Open AI API keys
              </Button>
            </EmptyState>
          ) : (
            <>
              <section className="ai-usage-summary" aria-label="Summary">
                <article className="app-card soft-panel">
                  <span className="eyebrow">Calls · {payload.windowDays}d</span>
                  <strong>{payload.summary.calls}</strong>
                </article>
                <article className="app-card soft-panel">
                  <span className="eyebrow">Tokens</span>
                  <strong>{payload.summary.totalTokens.toLocaleString()}</strong>
                </article>
                <article className="app-card soft-panel">
                  <span className="eyebrow">Estimated $</span>
                  <strong>{money(payload.summary.estimatedUsd)}</strong>
                </article>
              </section>

              <section className="app-card soft-panel">
                <span className="eyebrow">By model</span>
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
                <span className="eyebrow">Recent</span>
                <ul className="ai-usage-list">
                  {payload.events.map((row) => (
                    <li key={row.id}>
                      <div>
                        <strong>
                          {row.feature} · {row.model}
                        </strong>
                        <span className="app-muted">
                          {new Date(row.createdAt).toLocaleString()} · {keySourceLabel(row.keySource)} ·{" "}
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
