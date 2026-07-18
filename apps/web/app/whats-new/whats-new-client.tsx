"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, PageHeader } from "../../components/ui";
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
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
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
          <button type="button" className="app-button secondary" onClick={() => onMarkSeen(release.id)}>
            Mark as read
          </button>
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

  const load = useCallback(async () => {
    setLoading(true);
    setFetchFailed(false);
    try {
      const response = await fetch("/api/whats-new");
      const data = (await response.json()) as { releases?: Release[]; error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load What’s new.");
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

  return (
    <main className="module-page whats-new-page">
      <PageHeader
        breadcrumbs="Account / What’s new"
        title="What’s new"
        description="Published product releases for your team’s plan. No demo history — the feed stays empty until a real note ships."
      >
        <div className="whats-new-header-actions">
          <a className="app-button secondary" href="/notifications">
            Inbox
          </a>
          <a className="app-button secondary" href="/notifications/preferences">
            Preferences
          </a>
        </div>
      </PageHeader>

      <WhatsNewRelated />

      {message ? <p className="admin-plans-message">{message}</p> : null}

      {loading ? (
        <EmptyState soft title="Loading releases…" description="Checking published notes for your plan." aria-busy />
      ) : fetchFailed ? (
        <>
          <EmptyState
            title="Couldn’t load What’s new"
            description="Try again, or open Support if published notes keep failing to load."
            badge="Unavailable"
            badgeTone="setup"
          >
            <div className="whats-new-empty-actions">
              <button type="button" className="app-button" onClick={() => void load()}>
                Retry
              </button>
              <a className="app-button secondary" href="/support">
                Help & Support
              </a>
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
          >
            <div className="whats-new-empty-actions">
              <a className="app-button secondary" href="/pricing">
                Pricing
              </a>
              <a className="app-button secondary" href="/support">
                Help & Support
              </a>
              <a className="app-button secondary" href="/notifications/preferences">
                Notification prefs
              </a>
            </div>
          </EmptyState>
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
