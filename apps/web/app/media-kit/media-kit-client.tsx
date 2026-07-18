"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { mediaKitAssetKindLabel } from "../../lib/media-kit";
import type { MediaKitView } from "../../lib/media-kit/compute-media-kit";
import type { MediaKitAssetKind, MediaKitReadinessTier } from "../../lib/media-kit/types";

const ASSET_KINDS: MediaKitAssetKind[] = ["logo", "photo", "graphic", "other"];

function tierTone(tier: MediaKitReadinessTier): string {
  if (tier === "ready") return "good";
  if (tier === "partial") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MediaKitView, { status: "live" }>;

export default function MediaKitClient() {
  const [view, setView] = useState<MediaKitView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/media-kit${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MediaKitView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
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
        const response = await fetch("/api/media-kit", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as MediaKitView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/business?orgId=${encodeURIComponent(orgId)}` : "/business"}>Business</a>
            {" / Media Kit"}
          </>
        }
        title="Media Kit"
        description="Build a sponsor- and media-ready team media kit — logos, bio, mission, and a generated one-pager grounded only in what you've recorded."
      >
        {view?.status === "live" && view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                load(next);
              }}
            >
              {view.seasons.map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState title="Could not load Media Kit" description="A network or server issue prevented loading. Try again.">
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
          <ReadinessPanel view={view} />
          <ProfileForm view={view} busy={busy} mutate={mutate} />
          <AssetsPanel view={view} busy={busy} mutate={mutate} />
          <DocumentsPanel view={view} busy={busy} mutate={mutate} />
        </div>
      )}
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  return (
    <Panel aria-label="Media kit readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Media kit completeness</h2>
          {readiness.missingFields.length > 0 ? (
            <small className="app-muted">Missing: {readiness.missingFields.join(", ")}</small>
          ) : (
            <small className="app-muted">All core fields recorded.</small>
          )}
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
    </Panel>
  );
}

function ProfileForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const profile = view.profile;
  const empty = useMemo(
    () => ({
      missionStatement: profile?.missionStatement ?? "",
      teamBio: profile?.teamBio ?? "",
      foundedYear: profile?.foundedYear != null ? String(profile.foundedYear) : "",
      achievements: profile?.achievements.join("\n") ?? "",
      contactEmail: profile?.contactEmail ?? "",
      websiteUrl: profile?.websiteUrl ?? "",
    }),
    [profile],
  );
  const [form, setForm] = useState(empty);
  useEffect(() => setForm(empty), [empty]);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      onSubmit={(event) => {
        event.preventDefault();
        mutate({
          action: "save-profile",
          missionStatement: form.missionStatement || undefined,
          teamBio: form.teamBio || undefined,
          foundedYear: form.foundedYear ? Number(form.foundedYear) : undefined,
          achievements: form.achievements
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean),
          contactEmail: form.contactEmail || undefined,
          websiteUrl: form.websiteUrl || undefined,
        });
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Team profile — {view.seasonYear}</h2>
      <FormGrid min={200}>
        <FormRow label="Founded year">
          <input type="number" min={1900} max={3000} value={form.foundedYear} onChange={set("foundedYear")} />
        </FormRow>
        <FormRow label="Contact email">
          <input type="email" value={form.contactEmail} onChange={set("contactEmail")} />
        </FormRow>
        <FormRow label="Website">
          <input value={form.websiteUrl} onChange={set("websiteUrl")} placeholder="https://" />
        </FormRow>
      </FormGrid>
      <FormRow label="Mission statement">
        <textarea value={form.missionStatement} onChange={set("missionStatement")} rows={2} />
      </FormRow>
      <FormRow label="Team bio">
        <textarea value={form.teamBio} onChange={set("teamBio")} rows={3} />
      </FormRow>
      <FormRow label="Achievements (one per line)">
        <textarea value={form.achievements} onChange={set("achievements")} rows={3} />
      </FormRow>
      <div>
        <button type="submit" className="app-button" disabled={busy}>
          Save profile
        </button>
      </div>
    </Panel>
  );
}

function AssetsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(() => ({ kind: "logo" as MediaKitAssetKind, title: "", url: "", description: "" }), []);
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Assets</h2>
      {view.assets.length === 0 ? (
        <EmptyState badge="No assets yet" badgeTone="setup" title="Add your team logo and photos" />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {view.assets.map((asset) => (
            <li key={asset.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div>
                <strong>{asset.title}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {mediaKitAssetKindLabel(asset.kind)} ·{" "}
                  <a href={asset.url} target="_blank" rel="noreferrer">
                    {asset.url}
                  </a>
                </small>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "delete-asset", assetId: asset.id })}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (!form.title.trim() || !form.url.trim()) return;
          mutate({
            action: "add-asset",
            kind: form.kind,
            title: form.title,
            url: form.url,
            description: form.description || undefined,
          });
          setForm(empty);
        }}
        style={{ display: "grid", gap: 8 }}
      >
        <FormGrid min={160}>
          <FormRow label="Kind">
            <select value={form.kind} onChange={set("kind")}>
              {ASSET_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {mediaKitAssetKindLabel(kind)}
                </option>
              ))}
            </select>
          </FormRow>
          <FormRow label="Title">
            <input value={form.title} onChange={set("title")} placeholder="Primary team logo" required />
          </FormRow>
          <FormRow label="URL">
            <input value={form.url} onChange={set("url")} placeholder="https://" required />
          </FormRow>
        </FormGrid>
        <FormRow label="Description (optional)">
          <input value={form.description} onChange={set("description")} />
        </FormRow>
        <div>
          <button type="submit" className="app-button secondary" disabled={busy || !form.title.trim() || !form.url.trim()}>
            Add asset
          </button>
        </div>
      </form>
    </Panel>
  );
}

function DocumentsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  return (
    <Panel style={{ display: "grid", gap: 10 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <h2 style={{ margin: 0 }}>One-pagers</h2>
        <button
          type="button"
          className="app-button"
          disabled={busy}
          onClick={() => mutate({ action: "generate-one-pager" })}
        >
          Generate one-pager
        </button>
      </header>
      {view.documents.length === 0 ? (
        <EmptyState
          badge="No one-pagers yet"
          badgeTone="setup"
          title="Generate your first media-kit one-pager"
          description="Built only from your recorded profile and asset library."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {view.documents.map((doc) => (
            <li key={doc.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <strong>{doc.title}</strong>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => mutate({ action: "delete-document", documentId: doc.id })}
                >
                  Delete
                </button>
              </div>
              <div style={{ display: "grid", gap: 6, marginTop: 8 }}>
                {doc.sections.map((section, index) => (
                  <div key={`${doc.id}-${index}`}>
                    <strong className="app-muted">{section.heading}</strong>
                    <p style={{ margin: "2px 0 0" }}>{section.body}</p>
                  </div>
                ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}
