"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";

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

export default function WhatsNewClient() {
  const [releases, setReleases] = useState<Release[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/whats-new");
      const data = (await response.json()) as { releases?: Release[]; error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load What’s new.");
        setReleases([]);
        return;
      }
      setMessage("");
      setReleases(data.releases ?? []);
    } catch {
      setMessage("Network error loading What’s new.");
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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Account / What’s new"
        title="What’s new"
        description="Product releases for your team’s plan. Manage email and inbox prefs anytime."
      >
        <a className="app-button secondary" href="/notifications">
          Inbox
        </a>
        <a className="app-button secondary" href="/notifications/preferences">
          Preferences
        </a>
      </PageHeader>

      {message ? <p className="admin-plans-message">{message}</p> : null}

      {loading ? (
        <Panel>
          <p className="admin-empty">Loading releases…</p>
        </Panel>
      ) : releases.length === 0 ? (
        <EmptyState
          title="No releases for your plan yet"
          description="When Vantage publishes a release that targets your entitlement, it shows up here and in your inbox."
        />
      ) : (
        releases.map((release) => (
          <Panel key={release.id} id={release.slug}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: "1rem", flexWrap: "wrap" }}>
              <div>
                <span className="eyebrow">
                  {release.versionLabel ? `v${release.versionLabel}` : "Release"}
                  {release.publishedAt ? ` · ${new Date(release.publishedAt).toLocaleDateString()}` : ""}
                </span>
                <h2 style={{ margin: "0.35rem 0 0.5rem", fontSize: "1.25rem" }}>{release.title}</h2>
              </div>
              {!release.seenAt ? (
                <button type="button" className="app-button secondary" onClick={() => void markSeen(release.id)}>
                  Mark as read
                </button>
              ) : (
                <span className="app-muted">Seen</span>
              )}
            </div>
            <pre
              style={{
                whiteSpace: "pre-wrap",
                fontFamily: "inherit",
                margin: 0,
                color: "var(--soft-ink)",
                lineHeight: 1.55,
              }}
            >
              {release.notesMarkdown}
            </pre>
            {Object.keys(release.featureFlags).some((k) => release.featureFlags[k]) ? (
              <p className="app-muted" style={{ marginTop: "0.75rem" }}>
                Unlocks:{" "}
                {Object.keys(release.featureFlags)
                  .filter((k) => release.featureFlags[k])
                  .join(", ")}
              </p>
            ) : null}
          </Panel>
        ))
      )}
    </main>
  );
}
