"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { mediaKitAssetKindLabel } from "../../lib/media-kit";
import type { MediaKitView } from "../../lib/media-kit/compute-media-kit";
import {
  MEDIA_KIT_RELATED_INCLUDE,
  classifyMediaKitShell,
  formatMediaKitMetric,
  mediaKitNextActions,
  mediaKitRelatedLinks,
  mediaKitSetupSteps,
  mediaKitShellCopy,
  shouldShowMediaKitSummaryTiles,
  type MediaKitNextAction,
  type MediaKitShellKind,
} from "../../lib/media-kit/media-kit-related";
import type { MediaKitAssetKind, MediaKitReadinessTier } from "../../lib/media-kit/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./media-kit.css";

const ASSET_KINDS: MediaKitAssetKind[] = ["logo", "photo", "graphic", "other"];

function tierTone(tier: MediaKitReadinessTier): string {
  if (tier === "ready") return "good";
  if (tier === "partial") return "setup";
  return "setup";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<MediaKitView, { status: "live" }>;

function MediaKitRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = mediaKitRelatedLinks(orgId, {
    include: [...MEDIA_KIT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related media-kit-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function MediaKitNextActionsPanel({ actions }: { actions: MediaKitNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions media-kit-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Sponsor Suite and Outreach — never DEMO media metrics.</p>
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

function MediaKitShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MediaKitShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = mediaKitNextActions({ orgId, shell });
  const copy = mediaKitShellCopy(shell);
  const steps = shell === "setup" ? mediaKitSetupSteps(orgId) : [];

  return (
    <main className="module-page media-kit-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? withOrgHref("/media", orgId) : "/media"}>Media</a>
            {" / Media Kit"}
          </>
        }
        title="Media Kit"
        description={description}
      >
        <MediaKitRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No media yet"
                : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
            Open Workspace
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href="#media-kit-profile">
              Save team profile
            </a>
            <a className="app-button secondary" href={hubHref("/business", "sponsor-suite", orgId)}>
              Open Sponsor Suite
            </a>
            <a
              className="app-button secondary"
              href={hubHref("/business", "outreach-calendar", orgId)}
            >
              Open Outreach Calendar
            </a>
          </>
        ) : null}
      </EmptyState>
      {shell === "setup" && steps.length > 0 ? (
        <ol className="strategy-setup-steps">
          {steps.map((step) => (
            <li key={step.id}>
              <div>
                <strong>{step.label}</strong>
                <span>{step.detail}</span>
              </div>
              <a href={step.href}>Open</a>
            </li>
          ))}
        </ol>
      ) : null}
      <MediaKitNextActionsPanel actions={actions} />
    </main>
  );
}

export default function MediaKitClient() {
  const [view, setView] = useState<MediaKitView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery =
      seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const assetCount = view?.status === "live" ? view.assets.length : 0;
  const documentCount = view?.status === "live" ? view.documents.length : 0;
  const readinessScore = view?.status === "live" ? view.readiness.score : 0;

  const shell = classifyMediaKitShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" || view?.status === "setup_required" ? view.orgId : null,
    assetCount,
    documentCount,
    readinessScore,
  });
  const shellCopy = mediaKitShellCopy(shell);
  const nextActions = mediaKitNextActions({
    orgId,
    shell,
    assetCount,
    documentCount,
  });
  const relatedLinks = mediaKitRelatedLinks(orgId, {
    include: [...MEDIA_KIT_RELATED_INCLUDE],
  });

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

  if (shell === "loading") {
    return <MediaKitShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <MediaKitShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup") {
    return (
      <MediaKitShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <MediaKitShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page media-kit-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={withOrgHref("/media", orgId)}>Media</a>
            {" / Media Kit"}
          </>
        }
        title="Media Kit"
        description="Build a sponsor- and media-ready team media kit — logos, bio, mission, and a generated one-pager grounded only in what you've recorded. Never DEMO media metrics."
      >
        <div className="media-kit-header-actions">
          {view.seasons.length > 0 ? (
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
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <MediaKitNextActionsPanel actions={nextActions} />

      {shouldShowMediaKitSummaryTiles({ assetCount, documentCount, readinessScore }) ? (
        <section className="media-kit-stats" aria-label="Media kit counts">
          <div>
            <strong>{pct(view.readiness.score)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Completeness
            </span>
          </div>
          <div>
            <strong>{formatMediaKitMetric(assetCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Assets
            </span>
          </div>
          <div>
            <strong>{formatMediaKitMetric(documentCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              One-pagers
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No media yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href="#media-kit-profile">
            Save team profile
          </a>
          <a className="app-button secondary" href="#media-kit-assets">
            Add a logo
          </a>
        </EmptyState>
      ) : null}

      <div className="media-kit-layout">
        {shell === "ready" ? <ReadinessPanel view={view} /> : null}
        <ProfileForm view={view} busy={busy} mutate={mutate} />
        <AssetsPanel view={view} busy={busy} mutate={mutate} />
        <DocumentsPanel view={view} busy={busy} mutate={mutate} />
      </div>
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  return (
    <Panel aria-label="Media kit readiness">
      <header
        style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}
      >
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>
            {readiness.tier.replace("_", " ").toUpperCase()}
          </span>
          <h2 style={{ margin: "6px 0 0" }}>Media kit completeness</h2>
          {readiness.missingFields.length > 0 ? (
            <small className="app-muted">Missing: {readiness.missingFields.join(", ")}</small>
          ) : (
            <small className="app-muted">All core fields recorded — never DEMO claims.</small>
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
      id="media-kit-profile"
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
  const empty = useMemo(
    () => ({ kind: "logo" as MediaKitAssetKind, title: "", url: "", description: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel id="media-kit-assets" style={{ display: "grid", gap: 10 }}>
      <h2 style={{ margin: 0 }}>Assets</h2>
      {view.assets.length === 0 ? (
        <EmptyState
          soft
          badge="No assets yet"
          badgeTone="setup"
          title="Add your team logo and photos"
          description="Asset library stays empty until you add real URLs — never DEMO logos."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 8 }}>
          {view.assets.map((asset) => (
            <li
              key={asset.id}
              style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}
            >
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
          <button
            type="submit"
            className="app-button secondary"
            disabled={busy || !form.title.trim() || !form.url.trim()}
          >
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
    <Panel id="media-kit-documents" style={{ display: "grid", gap: 10 }}>
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
          soft
          badge="No one-pagers yet"
          badgeTone="setup"
          title="Generate your first media-kit one-pager"
          description="Built only from your recorded profile and asset library — never invent DEMO claims."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 12 }}>
          {view.documents.map((doc) => (
            <li key={doc.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
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
