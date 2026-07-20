"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import { HowToUseLink } from "../help/how-to-use-link";
import {
  formatMediaMetric,
  mediaReadinessPct,
  shouldShowMediaSummaryTiles,
} from "../../lib/media";
import type { MediaView } from "../../lib/media/compute-media";
import {
  MEDIA_RELATED_INCLUDE,
  classifyMediaShell,
  mediaNextActions,
  mediaRelatedLinks,
  mediaSetupSteps,
  mediaShellCopy,
  type MediaNextAction,
  type MediaShellKind,
} from "../../lib/media/media-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./media.css";

type LiveView = Extract<MediaView, { status: "live" }>;

function MediaRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = mediaRelatedLinks(orgId, {
    include: [...MEDIA_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related media-related" aria-label="Related media tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function MediaNextActionsPanel({ actions }: { actions: MediaNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions media-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Media Kit, Outreach, and Impact — never DEMO media metrics.</p>
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

function MediaShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MediaShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = mediaNextActions({ orgId, shell });
  const copy = mediaShellCopy(shell);
  const businessHref = hubHref("/business", "media", orgId);
  const steps = shell === "setup" ? mediaSetupSteps(orgId) : [];

  return (
    <main className="module-page media-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Media"}
          </>
        }
        title="Media"
        description={description}
      >
        <div className="media-header-actions">
          <HowToUseLink slug="media-workspace" />
          <MediaRelatedStrip orgId={orgId} />
        </div>
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
            <a className="app-button" href={orgId ? withOrgHref("/media-kit", orgId) : "/media-kit"}>
              Build Media Kit
            </a>
            <a
              className="app-button secondary"
              href={hubHref("/business", "outreach-calendar", orgId)}
            >
              Open Outreach Calendar
            </a>
            <a className="app-button secondary" href={hubHref("/business", "impact", orgId)}>
              Open Community Impact
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
      <MediaNextActionsPanel actions={actions} />
    </main>
  );
}

function LiveMediaWorkspace({ view }: { view: LiveView }) {
  const orgId = view.orgId;
  const showTiles = shouldShowMediaSummaryTiles({
    kit: view.kit,
    outreach: view.outreach,
    impact: view.impact,
    sponsorWall: view.sponsorWall,
  });
  const related = mediaRelatedLinks(orgId, { include: [...MEDIA_RELATED_INCLUDE] });
  const nextActions = mediaNextActions({
    orgId,
    shell: "ready",
    assetCount: view.kit.assetCount,
    upcomingCount: view.outreach.upcomingCount,
  });
  const kitHref = withOrgHref("/media-kit", orgId);
  const outreachHref = hubHref("/business", "outreach-calendar", orgId);
  const impactHref = hubHref("/business", "impact", orgId);
  const wallHref = hubHref("/business", "sponsor-wall", orgId);

  return (
    <main className="module-page media-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={hubHref("/business", "media", orgId)}>Business</a>
            {" / Media"}
          </>
        }
        title="Media"
        description={`${view.orgName}${view.teamNumber != null ? ` · Team ${view.teamNumber}` : ""} · ${view.seasonYear} press, social, and sponsor visuals — counts from recorded rows only.`}
      >
        <div className="media-header-actions">
          <HowToUseLink slug="media-workspace" />
          <nav className="product-hub-related media-related" aria-label="Related media tools">
            {related.map((link) => (
              <a key={link.id} className="app-button secondary" href={link.href}>
                {link.label}
              </a>
            ))}
          </nav>
        </div>
      </PageHeader>

      {showTiles ? (
        <Panel>
          <div className="media-stats" aria-label="Media summary">
            <div>
              <strong>{mediaReadinessPct(view.kit.readinessScore)}</strong>
              <span className="app-muted"> Kit readiness</span>
            </div>
            <div>
              <strong>{formatMediaMetric(view.kit.assetCount, true)}</strong>
              <span className="app-muted"> Assets</span>
            </div>
            <div>
              <strong>{formatMediaMetric(view.outreach.upcomingCount, true)}</strong>
              <span className="app-muted"> Upcoming outreach</span>
            </div>
            <div>
              <strong>{formatMediaMetric(view.impact.mediaActivityCount, true)}</strong>
              <span className="app-muted"> Media impact logs</span>
            </div>
            <div>
              <strong>{formatMediaMetric(view.sponsorWall.publishedEntryCount, true)}</strong>
              <span className="app-muted"> Sponsor wall entries</span>
            </div>
          </div>
        </Panel>
      ) : null}

      <div className="media-grid">
        <Panel>
          <header>
            <h2>Press kit</h2>
            <p className="app-muted">
              {view.kit.readinessTier === "ready"
                ? "Profile and logo recorded — open Media Kit to edit."
                : view.kit.missingFields.length
                  ? `Still missing: ${view.kit.missingFields.slice(0, 3).join(", ")}${view.kit.missingFields.length > 3 ? "…" : ""}`
                  : "No kit fields yet — never DEMO bios or logos."}
            </p>
          </header>
          <p>
            {formatMediaMetric(view.kit.logoCount, true)} logos ·{" "}
            {formatMediaMetric(view.kit.photoCount, true)} photos ·{" "}
            {formatMediaMetric(view.kit.documentCount, true)} one-pagers
          </p>
          {view.kit.recentAssets.length ? (
            <ul className="media-panel-list">
              {view.kit.recentAssets.map((asset) => (
                <li key={asset.id}>
                  <div>
                    <strong>{asset.title}</strong>
                    <span className="app-muted">{asset.kind}</span>
                  </div>
                  <a className="app-button secondary" href={asset.url} target="_blank" rel="noreferrer">
                    Open
                  </a>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">Asset library is empty until you add real URLs.</p>
          )}
          <a className="app-button" href={kitHref}>
            Open Media Kit
          </a>
        </Panel>

        <Panel>
          <header>
            <h2>Outreach calendar</h2>
            <p className="app-muted">
              Upcoming planned/confirmed events for {view.seasonYear} — never DEMO dates.
            </p>
          </header>
          <p>
            {formatMediaMetric(view.outreach.upcomingCount, true)} upcoming ·{" "}
            {formatMediaMetric(view.outreach.mediaCategoryCount, true)} tagged media
          </p>
          {view.outreach.upcoming.length ? (
            <ul className="media-panel-list">
              {view.outreach.upcoming.map((event) => (
                <li key={event.id}>
                  <div>
                    <strong>{event.title}</strong>
                    <span className="app-muted">
                      {event.scheduledOn} · {event.category} · {event.status}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No upcoming outreach on the calendar yet.</p>
          )}
          <a className="app-button" href={outreachHref}>
            Open Outreach Calendar
          </a>
        </Panel>

        <Panel>
          <header>
            <h2>Media impact</h2>
            <p className="app-muted">Logged activities with category media — never DEMO hours.</p>
          </header>
          <p>
            {formatMediaMetric(view.impact.mediaActivityCount, true)} activities ·{" "}
            {formatMediaMetric(view.impact.peopleReached, true)} people reached
          </p>
          {view.impact.recent.length ? (
            <ul className="media-panel-list">
              {view.impact.recent.map((row) => (
                <li key={row.id}>
                  <div>
                    <strong>{row.title}</strong>
                    <span className="app-muted">
                      {row.occurredOn} · {formatMediaMetric(row.peopleReached, true)} reached
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="app-muted">No media-category impact logs yet.</p>
          )}
          <a className="app-button" href={impactHref}>
            Open Community Impact
          </a>
        </Panel>

        <Panel>
          <header>
            <h2>Sponsor visuals</h2>
            <p className="app-muted">
              {view.sponsorWall.wallPublished
                ? "Wall is marked published — logos still come from real entries only."
                : "Wall stays unpublished until you flip it in Sponsor Wall."}
            </p>
          </header>
          <p>
            {formatMediaMetric(view.sponsorWall.publishedEntryCount, true)} published entries
          </p>
          <a className="app-button" href={wallHref}>
            Open Sponsor Wall
          </a>
        </Panel>
      </div>

      <MediaNextActionsPanel actions={nextActions} />
    </main>
  );
}

export default function MediaClient() {
  const [view, setView] = useState<MediaView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = params.get("season") ? Number(params.get("season")) : null;
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/media${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MediaView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFetchFailed(true);
          setError("error" in data && data.error ? data.error : "Could not load Media");
          return;
        }
        setView(data);
      })
      .catch(() => {
        setFetchFailed(true);
        setError("Could not load Media");
      });
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const kit = view?.status === "live" ? view.kit : null;
  const outreach = view?.status === "live" ? view.outreach : null;
  const impact = view?.status === "live" ? view.impact : null;
  const sponsorWall = view?.status === "live" ? view.sponsorWall : null;

  const shell = classifyMediaShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" || view?.status === "setup_required" ? view.orgId : null,
    assetCount: kit?.assetCount,
    documentCount: kit?.documentCount,
    readinessScore: kit?.readinessScore,
    upcomingCount: outreach?.upcomingCount,
    mediaCategoryCount: outreach?.mediaCategoryCount,
    mediaActivityCount: impact?.mediaActivityCount,
    publishedEntryCount: sponsorWall?.publishedEntryCount,
  });

  if (shell === "ready" && view?.status === "live") {
    return <LiveMediaWorkspace view={view} />;
  }

  return (
    <MediaShell
      description="Press kit, outreach dates, media impact, and sponsor visuals for business + media teammates — never DEMO metrics."
      orgId={orgId}
      shell={shell}
      error={error || undefined}
      onRetry={load}
    />
  );
}
