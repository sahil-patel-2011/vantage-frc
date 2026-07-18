"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { SPONSOR_WALL_TIERS, sponsorWallTierLabel } from "../../lib/sponsor-wall";
import type { SponsorWallView } from "../../lib/sponsor-wall/compute-sponsor-wall";
import type { SponsorWallTheme, SponsorWallTier } from "../../lib/sponsor-wall/types";

const THEME_LABEL: Record<SponsorWallTheme, string> = {
  light: "Light",
  dark: "Dark",
  team: "Team colors",
};

type LiveView = Extract<SponsorWallView, { status: "live" }>;

export default function SponsorWallClient() {
  const [view, setView] = useState<SponsorWallView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/sponsor-wall${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorWallView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
      })
      .catch(() => setFetchFailed(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/sponsor-wall", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as SponsorWallView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Sponsor Wall"}
          </>
        }
        title="Sponsor Wall"
        description="Build a public thank-you wall for your sponsors — logos, tiers, and shout-out messages, ready to publish or embed."
      >
        {orgId ? (
          <a className="app-button secondary" href={`/business?orgId=${encodeURIComponent(orgId)}`}>
            Business hub
          </a>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load the Sponsor Wall"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
        </EmptyState>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          <SettingsForm view={view} busy={busy} mutate={mutate} />
          <AddEntryForm busy={busy} mutate={mutate} />
          <WallPreview view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Sponsors", value: String(summary.totalEntries) },
    { label: "Published", value: String(summary.publishedEntries) },
    { label: "Tiers represented", value: String(summary.byTier.length) },
    { label: "Wall status", value: view.settings.published ? "Public" : "Draft" },
  ];
  return (
    <Panel>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function SettingsForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [headline, setHeadline] = useState(view.settings.headline);
  const [subtitle, setSubtitle] = useState(view.settings.subtitle ?? "");
  const [theme, setTheme] = useState<SponsorWallTheme>(view.settings.theme);
  const [published, setPublished] = useState(view.settings.published);

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({ action: "update-settings", headline, subtitle: subtitle || undefined, theme, published });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Wall settings</h2>
      <FormGrid min={160}>
        <FormRow label="Headline">
          <input value={headline} onChange={(e) => setHeadline(e.target.value)} required />
        </FormRow>
        <FormRow label="Subtitle (optional)">
          <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} />
        </FormRow>
        <FormRow label="Theme">
          <select value={theme} onChange={(e) => setTheme(e.target.value as SponsorWallTheme)}>
            {(Object.keys(THEME_LABEL) as SponsorWallTheme[]).map((t) => (
              <option key={t} value={t}>
                {THEME_LABEL[t]}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Visibility">
          <label style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={published} onChange={(e) => setPublished(e.target.checked)} />
            Published (publicly viewable)
          </label>
        </FormRow>
      </FormGrid>
      <div>
        <button type="submit" className="app-button" disabled={busy || !headline.trim()}>
          Save settings
        </button>
      </div>
    </Panel>
  );
}

function AddEntryForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      sponsorName: "",
      tier: "partner" as SponsorWallTier,
      logoUrl: "",
      websiteUrl: "",
      message: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.sponsorName.trim()) return;
        mutate({
          action: "add-entry",
          sponsorName: form.sponsorName,
          tier: form.tier,
          logoUrl: form.logoUrl || undefined,
          websiteUrl: form.websiteUrl || undefined,
          message: form.message || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add sponsor</h2>
      <FormGrid min={160}>
        <FormRow label="Sponsor name">
          <input value={form.sponsorName} onChange={set("sponsorName")} placeholder="Acme Robotics" required />
        </FormRow>
        <FormRow label="Tier">
          <select value={form.tier} onChange={set("tier")}>
            {SPONSOR_WALL_TIERS.map((tier) => (
              <option key={tier} value={tier}>
                {sponsorWallTierLabel(tier)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Logo URL (optional)">
          <input value={form.logoUrl} onChange={set("logoUrl")} placeholder="https://…" />
        </FormRow>
        <FormRow label="Website URL (optional)">
          <input value={form.websiteUrl} onChange={set("websiteUrl")} placeholder="https://…" />
        </FormRow>
      </FormGrid>
      <FormRow label="Thank-you message (optional)">
        <textarea value={form.message} onChange={set("message")} rows={2} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy || !form.sponsorName.trim()}>
          Add to wall
        </button>
      </div>
    </Panel>
  );
}

function WallPreview({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        badge="No sponsors yet"
        badgeTone="setup"
        title="Add your first sponsor to build the wall"
        description="Sponsor names, tiers, and thank-you messages appear here in the public order they'll render."
      />
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Wall preview</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.entries.map((item) => (
          <li
            key={item.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}
          >
            <div>
              {item.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.logoUrl}
                  alt={`${item.sponsorName} logo`}
                  style={{ maxHeight: 32, maxWidth: 120, display: "block", marginBottom: 4 }}
                />
              ) : null}
              <strong>{item.sponsorName}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {sponsorWallTierLabel(item.tier)}
                {item.websiteUrl ? ` · ${item.websiteUrl}` : ""}
                {item.published ? "" : " · Hidden"}
              </small>
              {item.message ? <small className="app-muted">{item.message}</small> : null}
            </div>
            <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "toggle-publish-entry", entryId: item.id, published: !item.published })}
              >
                {item.published ? "Hide" : "Show"}
              </button>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Remove "${item.sponsorName}" from the wall?`)) {
                    mutate({ action: "delete-entry", entryId: item.id });
                  }
                }}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
