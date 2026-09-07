"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  ProgressMeter,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import type { SponsorRenewalRoiView } from "../../lib/sponsor-renewal-roi/compute-sponsor-renewal-roi";
import type { SponsorRenewalRiskTier } from "../../lib/sponsor-renewal-roi/types";
import { renderReceiptFrom, type RenderReceipt } from "../../lib/ai-render/outcome";
import { RenderAttribution } from "../../components/ui/render-attribution";
import {
  SPONSOR_RENEWAL_ROI_RELATED_INCLUDE,
  classifySponsorRenewalRoiShell,
  formatSponsorRenewalRoiMetric,
  shouldShowSponsorRenewalRoiSummaryTiles,
  sponsorRenewalRoiNextActions,
  sponsorRenewalRoiRelatedLinks,
  sponsorRenewalRoiSetupSteps,
  sponsorRenewalRoiShellCopy,
  type SponsorRenewalRoiNextAction,
  type SponsorRenewalRoiShellKind,
} from "../../lib/sponsor-renewal-roi/sponsor-renewal-roi-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./sponsor-renewal-roi.css";

type LiveView = Extract<SponsorRenewalRoiView, { status: "live" }>;
type SponsorSummary = LiveView["sponsors"][number];

function tierTone(tier: SponsorRenewalRiskTier): BadgeTone {
  if (tier === "low") return "good";
  if (tier === "moderate") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

const COMPONENT_LABEL: Record<string, string> = {
  interactionRecency: "Interaction recency",
  interactionFrequency: "Interaction frequency",
  contributionRecency: "Contribution recency",
  impactMentions: "Community-impact mentions",
  evidenceCoverage: "Evidence coverage",
  showcaseViews: "Showcase views",
};

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = sponsorRenewalRoiRelatedLinks(orgId, {
    include: [...SPONSOR_RENEWAL_ROI_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related srr-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: SponsorRenewalRoiNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions srr-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Sponsor CRM, Suite, and Impact — never DEMO churn scores.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={`Open ${action.label}`}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function RoiShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SponsorRenewalRoiShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = sponsorRenewalRoiNextActions({ orgId, shell });
  const copy = sponsorRenewalRoiShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "sponsor-renewal-roi", orgId);
  const steps = shell === "setup" ? sponsorRenewalRoiSetupSteps(orgId) : [];

  return (
    <main className="module-page srr-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Sponsor Renewal ROI"}
          </>
        }
        title="Sponsor Renewal-Risk Score & ROI Report"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading sponsor renewal ROI">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? hubHref("/business", "sponsors", orgId) : "/workspace"}>
              {orgId ? "Open Sponsor CRM" : "Select workspace"}
            </a>
          ) : null}
          {shell === "empty" ? (
            <a className="app-button" href={hubHref("/business", "sponsors", orgId)}>
              Add a sponsor
            </a>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="srr-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">CRM and Impact — never DEMO churn scores.</p>
          </header>
          <ul className="srr-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted srr-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
}

export default function SponsorRenewalRoiClient() {
  const [view, setView] = useState<SponsorRenewalRoiView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [renderReceipt, setRenderReceipt] = useState<RenderReceipt | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/sponsor-renewal-roi${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorRenewalRoiView | { error?: string };
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
  const sponsorCount = view?.status === "live" ? view.sponsors.length : 0;
  const scoredCount =
    view?.status === "live" ? view.sponsors.filter((s) => !s.risk.noLinkedActivity).length : 0;

  const shell = classifySponsorRenewalRoiShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    sponsorCount,
  });
  const shellCopy = sponsorRenewalRoiShellCopy(shell);
  const nextActions = sponsorRenewalRoiNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    sponsorCount,
    scoredCount,
  });
  const relatedLinks = sponsorRenewalRoiRelatedLinks(orgId, {
    include: [...SPONSOR_RENEWAL_ROI_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "sponsor-renewal-roi", orgId);
  const showTiles = shouldShowSponsorRenewalRoiSummaryTiles(sponsorCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>, busyKey: string) => {
      if (!orgId || busy) return;
      setBusy(busyKey);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/sponsor-renewal-roi", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SponsorRenewalRoiView | { error?: string; code?: string };
        if (!response.ok || !("status" in data)) {
          const cutoff = resolveCutoffErrorCode(response.status, data);
          if (cutoff) {
            setCutoffCode(cutoff);
            setError("AI usage limit reached — raise budgets or wait for the billing period to reset.");
            return;
          }
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        const receipt = renderReceiptFrom(data);
        if (receipt) setRenderReceipt(receipt);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(null);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return <RoiShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <RoiShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }

  if (shell === "setup" || shell === "empty") {
    return (
      <RoiShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell={shell === "empty" ? "empty" : "setup"}
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href.startsWith("/") ? (orgId ? withOrgHref(step.href, orgId) : step.href) : step.href}>
                  Open
                </a>
              </li>
            ))}
          </ol>
        ) : null}
      </RoiShell>
    );
  }

  if (view?.status !== "live") {
    return <RoiShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page srr-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Sponsor Renewal ROI"}
          </>
        }
        title="Sponsor Renewal-Risk Score & ROI Report"
        description="Churn-risk scoring and sponsor-branded ROI reports built only from logged interactions, contributions, and community-impact mentions — never DEMO churn scores. Cross-check Sponsor CRM, Suite, and Impact."
      >
        <div className="srr-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted srr-filter">
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
        <p className="app-muted" role="alert">
          {error}
        </p>
      ) : null}
      <RenderAttribution receipt={renderReceipt} feature="sponsor_renewal_roi" />
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles ? (
        <section className="srr-stats" aria-label="Sponsor renewal counts">
          <StatTile label="Sponsors" value={formatSponsorRenewalRoiMetric(sponsorCount, true)} />
          <StatTile label="Scored" value={formatSponsorRenewalRoiMetric(scoredCount, true)} />
        </section>
      ) : null}

      <div id="sponsor-renewal-roi-list" className="srr-list">
        {view.sponsors.map((sponsor) => (
          <SponsorRiskCard key={sponsor.sponsorId} sponsor={sponsor} busy={busy} mutate={mutate} />
        ))}
      </div>
    </main>
  );
}

function SponsorRiskCard({
  sponsor,
  busy,
  mutate,
}: {
  sponsor: SponsorSummary;
  busy: string | null;
  mutate: (payload: Record<string, unknown>, busyKey: string) => void;
}) {
  const { risk } = sponsor;
  const components = Object.entries(risk.components).filter(([, v]) => v !== null) as Array<[string, number]>;
  const busyKey = `report-${sponsor.sponsorId}`;

  return (
    <section className="app-card soft-panel srr-card" aria-label={`${sponsor.sponsorName} renewal risk`}>
      <header className="biz-card-head srr-card-head">
        <div>
          <span className="biz-overline">
            {sponsor.tier} · {sponsor.status}
          </span>
          <h2 style={{ margin: "4px 0" }}>{sponsor.sponsorName}</h2>
        </div>
        {!risk.noLinkedActivity ? (
          <div className="srr-score">
            <Badge tone={tierTone(risk.tier)}>{risk.tier.toUpperCase()} RISK</Badge>
            <div className="srr-score-value">{pct(risk.score)}</div>
          </div>
        ) : null}
      </header>

      {risk.noLinkedActivity ? (
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title="No linked activity for this sponsor yet"
          description="Log a sponsor interaction, contribution, or community-impact mention naming this sponsor to compute a renewal-risk score — never a fabricated placeholder score."
        />
      ) : (
        <>
          <div className="srr-components">
            {components.map(([key, value]) => (
              <ProgressMeter key={key} label={COMPONENT_LABEL[key] ?? key} value={Math.round(value * 100)} />
            ))}
          </div>
          <small className="app-muted">
            {risk.daysSinceLastInteraction !== null
              ? `Last interaction ${risk.daysSinceLastInteraction}d ago`
              : "No interactions logged"}
            {risk.daysSinceLastContribution !== null
              ? ` · Last contribution ${risk.daysSinceLastContribution}d ago`
              : " · No contributions logged"}
            {risk.components.showcaseViews === null ? " · Showcase views not tracked" : ""}
          </small>
        </>
      )}

      <div>
        <button
          type="button"
          className="app-button"
          disabled={busy !== null}
          onClick={() => mutate({ action: "generate-report", sponsorId: sponsor.sponsorId }, busyKey)}
        >
          {busy === busyKey ? "Generating…" : sponsor.latestReport ? "Regenerate ROI report" : "Generate ROI report"}
        </button>
      </div>

      {sponsor.latestReport ? (
        <Panel className="srr-panel">
          <strong>{sponsor.latestReport.title}</strong>
          <div className="srr-report-sections">
            {sponsor.latestReport.sections.map((section) => (
              <div key={section.heading}>
                <strong>{section.heading}</strong>
                <p style={{ margin: "2px 0 0" }}>{section.body}</p>
              </div>
            ))}
          </div>
          <button
            type="button"
            className="text-button"
            disabled={busy !== null}
            onClick={() => {
              if (window.confirm("Delete this report?")) {
                mutate({ action: "delete-report", reportId: sponsor.latestReport!.id }, busyKey);
              }
            }}
          >
            Delete report
          </button>
        </Panel>
      ) : null}
    </section>
  );
}
