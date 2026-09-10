"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
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

export default function WhatsNewClient() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const response = await fetch("/api/whats-new");
      const data = (await response.json()) as { releases?: Release[]; error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load What’s new.");
        setErrorStatus(response.status);
        setReleases([]);
        setFetchFailed(true);
        return;
      }
      setMessage("");
      // Real published rows only — never invent DEMO release history client-side.
      setReleases(Array.isArray(data.releases) ? data.releases : []);
    } catch {
      setMessage("Network error loading What’s new.");
      setReleases([]);
      setFetchFailed(true);
    } finally {
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
        description="Published product releases for your team’s plan. No demo history — the feed stays empty until a real note ships."
      >
        {/* Inbox lived here as well as in the related strip one line below.
            Prefs stays because the strip does not carry it — and it is labelled
            the same here as everywhere else, so one name means one place. */}
        <div className="whats-new-header-actions">
          <Button as="a" variant="secondary" href="/notifications/preferences">
            Notification prefs
          </Button>
        </div>
      </PageHeader>

      <WhatsNewRelated />

      <BetaProgramCard />

      {message && !failure ? <p className="admin-plans-message">{message}</p> : null}

      {loading ? (
        <EmptyState soft title="Loading releases…" description="Checking published notes for your plan." aria-busy />
      ) : failure ? (
        <>
          <EmptyState
            title={failure.title}
            description={failure.description}
            badge="Unavailable"
            badgeTone="setup"
          >
            <div className="whats-new-empty-actions">
              {failure.primary ? (
                <Button as="a" variant="primary" href={failure.primary.href}>
                  {failure.primary.label}
                </Button>
              ) : null}
              {failure.showRetry ? (
                <Button variant="primary" type="button" onClick={() => void load()}>
                  Retry
                </Button>
              ) : null}
            </div>
          </EmptyState>
          <NextActions releaseCount={0} unreadCount={0} />
        </>
      ) : releases.length === 0 ? (
        <>
          <EmptyState
            soft
            title="No releases for your plan yet"
            description="When Vantage publishes a release that targets your entitlement, it shows up here and in your inbox. Nothing is fabricated while the list is empty."
            badge="Empty"
          />
          {/* Pricing, Support, and prefs were all one row above this, in the
              related strip and the header — and again below, in Next actions,
              with the reason for each. */}
          <NextActions releaseCount={0} unreadCount={0} />
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
