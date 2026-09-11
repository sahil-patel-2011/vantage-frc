"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import {
  WHATS_NEW_RELATED_INCLUDE,
  enabledReleaseFlags,
  formatReleaseAudience,
  formatReleasePublishedAt,
  whatsNewNextActions,
  whatsNewRelatedLinks,
} from "../../lib/whats-new";
import "./whats-new.css";

type Release = {
  id: string;
  slug: string;
  title: string;
  versionLabel: string | null;
  notesMarkdown: string;
  audienceType: string;
  publishedAt: string | null;
  seenAt: string | null;
  featureFlags: Record<string, boolean>;
};

function WhatsNewRelated() {
  const links = whatsNewRelatedLinks({ include: [...WHATS_NEW_RELATED_INCLUDE] });
  return (
    <nav className="product-hub-related whats-new-related" aria-label="Related account tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

type BetaState =
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "ready"; enrolled: boolean; enrolledAt: string | null };

function BetaProgramCard() {
  const [state, setState] = useState<BetaState>({ kind: "loading" });
  const [busy, setBusy] = useState(false);

  const loadBeta = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const response = await fetch("/api/feedback/beta");
      const data = (await response.json()) as { enrolled?: boolean; enrolledAt?: string | null };
      if (!response.ok) {
        setState({ kind: "error" });
        return;
      }
      setState({ kind: "ready", enrolled: Boolean(data.enrolled), enrolledAt: data.enrolledAt ?? null });
    } catch {
      setState({ kind: "error" });
    }
  }, []);

  useEffect(() => {
    void loadBeta();
  }, [loadBeta]);

  async function toggle(join: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/feedback/beta", {
        method: join ? "POST" : "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await response.json()) as { enrolled?: boolean; enrolledAt?: string | null };
      if (response.ok) {
        setState({ kind: "ready", enrolled: Boolean(data.enrolled), enrolledAt: data.enrolledAt ?? null });
      } else {
        setState({ kind: "error" });
      }
    } catch {
      setState({ kind: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="app-card soft-panel whats-new-beta" aria-label="Beta program">
      <div className="whats-new-beta-copy">
        <h2>Join the beta</h2>
        <p>
          Get features early, tell us what breaks. Beta members see releases first —{" "}
          <a href="/report-bug">reporting a bug</a> takes one box.
        </p>
        {state.kind === "ready" && state.enrolled ? (
          <p className="whats-new-beta-status" role="status">
            You&rsquo;re in
            {state.enrolledAt
              ? ` — enrolled ${new Date(state.enrolledAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`
              : ""}
            .
          </p>
        ) : null}
        {state.kind === "error" ? (
          <p className="whats-new-beta-status">Couldn&rsquo;t load your beta status.</p>
        ) : null}
      </div>
      <div className="whats-new-beta-actions">
        {state.kind === "loading" ? (
          <span className="whats-new-beta-status" aria-busy>
            Checking…
          </span>
        ) : state.kind === "error" ? (
          <Button variant="secondary" type="button" onClick={() => void loadBeta()}>
            Retry
          </Button>
        ) : state.enrolled ? (
          <Button variant="secondary" type="button" disabled={busy} onClick={() => void toggle(false)}>
            {busy ? "Leaving…" : "Leave the beta"}
          </Button>
        ) : (
          <Button variant="primary" type="button" disabled={busy} onClick={() => void toggle(true)}>
            {busy ? "Joining…" : "Join the beta"}
          </Button>
        )}
      </div>
    </section>
  );
}

function NextActions({ releaseCount, unreadCount }: { releaseCount: number; unreadCount: number }) {
  const actions = whatsNewNextActions({ releaseCount, unreadCount });
  return (
    <section className="whats-new-next-actions app-card soft-panel" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>From published product releases for your plan only — history stays blank until a real note ships.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <Button as="a" variant="secondary" href={action.href}>
              Open
            </Button>
          </li>
        ))}
      </ol>
    </section>
  );
}

function ReleaseCard({
  release,
  onMarkSeen,
}: {
  release: Release;
  onMarkSeen: (id: string) => void;
}) {
  const published = formatReleasePublishedAt(release.publishedAt);
  const flags = enabledReleaseFlags(release.featureFlags);
  const version = release.versionLabel?.trim() ? `v${release.versionLabel.trim()}` : null;

  return (
    <article className="app-card soft-panel whats-new-card" id={release.slug}>
      <div className="whats-new-card-top">
        <div>
          <div className="whats-new-card-meta">
            <span className="eyebrow">
              {[version, published, formatReleaseAudience(release.audienceType)].filter(Boolean).join(" · ")}
            </span>
            {!release.seenAt ? <span className="app-badge">New</span> : null}
          </div>
          <h2>{release.title}</h2>
        </div>
        {!release.seenAt ? (
          <Button variant="secondary" type="button" onClick={() => onMarkSeen(release.id)}>
            Mark as read
          </Button>
        ) : (
          <span className="whats-new-seen">Seen</span>
        )}
      </div>
      <pre className="whats-new-notes">{release.notesMarkdown}</pre>
      {flags.length > 0 ? (
        <p className="whats-new-flags">Unlocks: {flags.join(", ")}</p>
      ) : null}
    </article>
  );
}

type WhatsNewView = { releases: Release[] };

function isReleaseList(value: unknown): value is Release[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (row) => row && typeof row === "object" && typeof (row as Release).id === "string",
  );
}

function isWhatsNewView(value: unknown): value is WhatsNewView {
  if (!value || typeof value !== "object") return false;
  return isReleaseList((value as WhatsNewView).releases);
}

async function persistWhatsNewSnapshot(data: WhatsNewView): Promise<void> {
  try {
    await putFeatureSnapshot("whats-new", "_", data);
  } catch {
    // Live What’s new already painted; IndexedDB is best-effort.
  }
}

export default function WhatsNewClient() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const paintedRef = useRef(false);

  const load = useCallback(async () => {
    let hadCache = paintedRef.current;
    try {
      const cached = await getFeatureSnapshot<WhatsNewView>("whats-new", "_");
      if (!paintedRef.current && cached?.data && isWhatsNewView(cached.data)) {
        setReleases(cached.data.releases);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        setLoading(false);
        paintedRef.current = true;
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    if (!hadCache) setLoading(true);
    try {
      const response = await fetch("/api/whats-new", {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      const errorMessage =
        data && typeof data === "object" && "error" in data && typeof data.error === "string"
          ? data.error
          : "";
      if (response.status === 401 || response.status === 403) {
        setReleases([]);
        paintedRef.current = false;
        setFromCache(false);
        setCachedAt(null);
        setMessage(errorMessage || "Could not load What’s new.");
        setErrorStatus(response.status);
        setFetchFailed(true);
        setLoading(false);
        return;
      }
      const next = isWhatsNewView(data)
        ? data
        : data && typeof data === "object" && isReleaseList((data as { releases?: unknown }).releases)
          ? { releases: (data as { releases: Release[] }).releases }
          : null;
      if (!response.ok || !next) {
        if (hadCache || paintedRef.current) {
          setFromCache(true);
          setMessage("Could not refresh What’s new. Showing the last copy on this device.");
          setFetchFailed(false);
          setLoading(false);
          return;
        }
        setMessage(errorMessage || "Could not load What’s new.");
        setErrorStatus(response.status);
        setReleases([]);
        setFetchFailed(true);
        setLoading(false);
        return;
      }
      setMessage("");
      setReleases(next.releases);
      paintedRef.current = true;
      setFromCache(false);
      setCachedAt(null);
      setLoading(false);
      await persistWhatsNewSnapshot(next);
    } catch {
      if (hadCache || paintedRef.current) {
        setFromCache(true);
        setMessage("Could not refresh What’s new. Showing the last copy on this device.");
        setFetchFailed(false);
        setLoading(false);
        return;
      }
      setMessage("Network error loading What’s new.");
      setReleases([]);
      setFetchFailed(true);
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function markSeen(releaseId: string) {
    await fetch("/api/whats-new", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ releaseId }),
    });
    setReleases((prev) =>
      prev.map((r) => (r.id === releaseId ? { ...r, seenAt: new Date().toISOString() } : r)),
    );
  }

  const unreadCount = useMemo(() => releases.filter((r) => !r.seenAt).length, [releases]);

  const failure = fetchFailed
    ? loadFailureCopy(
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
          message:
            message || "Try again, or open Support if published notes keep failing to load.",
        },
      )
    : null;

  return (
    <main className="module-page whats-new-page">
      <PageHeader
        breadcrumbs="Account / What’s new"
        title="What’s new"
        description="Published product releases for your team’s plan. The feed stays empty until a real note ships."
      >
      </PageHeader>

      <WhatsNewRelated />
      <OfflineBanner feature="What’s new" fromCache={fromCache} cachedAt={cachedAt} />

      <BetaProgramCard />

      {message && !failure ? <p className="admin-plans-message">{message}</p> : null}

      {loading ? (
        <EmptyState soft title="Loading releases…" description="Checking published notes for your plan." aria-busy />
      ) : failure ? (
        <EmptyState
          title={failure.title}
          description={failure.description}
          badge="Unavailable"
          badgeTone="setup"
        >
          {failure.primary ? (
            <Button as="a" variant="primary" href={failure.primary.href}>
              {failure.primary.label}
            </Button>
          ) : null}
          {failure.showRetry ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      ) : releases.length === 0 ? (
        <>
          <EmptyState
            soft
            title="No releases for your plan yet"
            description="When a release that targets your plan is published, it shows up here and in your inbox."
            badge="Empty"
          />
        </>
      ) : (
        <>
          <NextActions releaseCount={releases.length} unreadCount={unreadCount} />
          <section className="whats-new-list" aria-label="Published releases">
            {releases.map((release) => (
              <ReleaseCard key={release.id} release={release} onMarkSeen={(id) => void markSeen(id)} />
            ))}
          </section>
        </>
      )}
    </main>
  );
}
