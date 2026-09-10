"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  EmptyState,
  ErrorState,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile, Button } from "../../components/ui";
import type { GrantEligibilityView } from "../../lib/grant-eligibility-matcher/compute-grant-eligibility-matcher";
import type { GrantMatch } from "../../lib/grant-eligibility-matcher/types";
import {
  GRANT_ELIGIBILITY_MATCHER_RELATED_INCLUDE,
  classifyGrantEligibilityMatcherShell,
  formatGrantEligibilityMatcherMetric,
  grantEligibilityMatcherNextActions,
  grantEligibilityMatcherRelatedLinks,
  grantEligibilityMatcherSetupSteps,
  grantEligibilityMatcherShellCopy,
  shouldShowGrantEligibilityMatcherSummaryTiles,
  type GrantEligibilityMatcherNextAction,
  type GrantEligibilityMatcherShellKind,
} from "../../lib/grant-eligibility-matcher/grant-eligibility-matcher-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./grant-eligibility-matcher.css";

type LiveView = Extract<GrantEligibilityView, { status: "live" }>;

function formatMoney(min: number | null, max: number | null): string {
  if (min == null && max == null) return "Amount not specified";
  const fmt = (n: number) => `$${n.toLocaleString()}`;
  if (min != null && max != null) return min === max ? fmt(min) : `${fmt(min)} – ${fmt(max)}`;
  return fmt((min ?? max) as number);
}

function deadlineLabel(match: GrantMatch): string | null {
  if (!match.grant.deadlineDate) {
    return match.grant.deadlineType === "rolling" ? "Rolling deadline" : null;
  }
  const days = match.daysUntilDeadline;
  if (days == null) return match.grant.deadlineDate;
  if (days < 0) return `Deadline passed (${match.grant.deadlineDate})`;
  if (days === 0) return "Deadline today";
  return `Due in ${days} day(s) — ${match.grant.deadlineDate}`;
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = grantEligibilityMatcherRelatedLinks(orgId, {
    include: [...GRANT_ELIGIBILITY_MATCHER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related gem-related" aria-label="Related business tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: GrantEligibilityMatcherNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions gem-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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

function MatcherShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: GrantEligibilityMatcherShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = grantEligibilityMatcherNextActions({ orgId, shell });
  const copy = grantEligibilityMatcherShellCopy(shell);
  const businessHref = hubWorkbenchHref("business", "grant-eligibility-matcher", orgId);
  const steps = shell === "setup" ? grantEligibilityMatcherSetupSteps(orgId) : [];

  return (
    <main className="module-page gem-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Grant Eligibility Matcher"}
          </>
        }
        title="Grant Eligibility Matcher"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading grant eligibility matcher">
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
            <Button as="a" variant="primary" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>Choose your team</Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href="#grant-eligibility-profile">Complete team profile</Button>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="gem-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="gem-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted gem-tip">{step.detail}</p>
                </div>
                <Button as="a" variant="secondary" href={step.href}>
                  Open
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function GrantEligibilityMatcherClient() {
  const [view, setView] = useState<GrantEligibilityView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showIneligible, setShowIneligible] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/grant-eligibility-matcher${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as GrantEligibilityView | { error?: string };
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const eligibleCount = view?.status === "live" ? view.eligible.length : 0;
  const catalogSize = view?.status === "live" ? view.catalogSize : 0;
  const deadlineCount = view?.status === "live" ? view.upcomingDeadlines.length : 0;

  const shell = classifyGrantEligibilityMatcherShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    eligibleCount,
    catalogSize,
  });
  const shellCopy = grantEligibilityMatcherShellCopy(shell);
  const nextActions = grantEligibilityMatcherNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    eligibleCount,
    deadlineCount,
  });
  const relatedLinks = grantEligibilityMatcherRelatedLinks(orgId, {
    include: [...GRANT_ELIGIBILITY_MATCHER_RELATED_INCLUDE],
  });
  const businessHref = hubWorkbenchHref("business", "grant-eligibility-matcher", orgId);
  const showTiles = shouldShowGrantEligibilityMatcherSummaryTiles(eligibleCount, catalogSize);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/grant-eligibility-matcher", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as GrantEligibilityView | { error?: string };
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

  if (shell === "loading") {
    return <MatcherShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <MatcherShell
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
      <MatcherShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        {view?.status === "setup_required" && view.steps.length > 0 ? (
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
        ) : null}
      </MatcherShell>
    );
  }

  if (view?.status !== "live") {
    return <MatcherShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page gem-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Grant Eligibility Matcher"}
          </>
        }
        title="Grant Eligibility Matcher"
        description="Grants your team actually qualifies for, matched against your recorded team profile — with a deadline radar. Distinct from Grant Report. Cross-check Grants, Grant Report, and Impact."
      >
        <div className="gem-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p className="impact-status" role="alert">
          {error}
        </p>
      ) : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles ? (
        <section className="gem-stats" aria-label="Grant eligibility counts">
          <StatTile label="Catalog" value={formatGrantEligibilityMatcherMetric(catalogSize, true)} />
          <StatTile label="Eligible" value={formatGrantEligibilityMatcherMetric(eligibleCount, true)} />
          <StatTile
            label="Upcoming deadlines"
            value={formatGrantEligibilityMatcherMetric(deadlineCount, true)}
          />
        </section>
      ) : null}

      <div id="grant-eligibility-profile">
        <ProfilePanel view={view} busy={busy} mutate={mutate} />
      </div>
      {view.upcomingDeadlines.length > 0 ? (
        <div id="grant-eligibility-deadlines">
          <DeadlineRadar view={view} />
        </div>
      ) : null}
      <div id="grant-eligibility-list">
        <EligibleGrants view={view} busy={busy} mutate={mutate} />
      </div>
      <IneligibleGrants view={view} show={showIneligible} setShow={setShowIneligible} />
    </main>
  );
}

function ProfilePanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { profile } = view;
  const [employersInput, setEmployersInput] = useState(profile.mentorEmployers.join(", "));

  return (
    <section className="app-card soft-panel gem-panel" aria-label="Team eligibility profile">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Team profile used for matching</span>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {formatGrantEligibilityMatcherMetric(view.catalogSize, true)} grant(s) in the catalog ·{" "}
            {formatGrantEligibilityMatcherMetric(view.eligible.length, true)} eligible
          </h2>
        </div>
      </header>
      <div className="soft-snapshot-grid">
        <StatTile label="Rookie year" value={profile.rookieYear ?? "—"} />
        <StatTile label="Region" value={profile.region ?? "—"} />
        <StatTile label="Students" value={profile.studentCount ?? "—"} />
        <StatTile label="Mentors" value={profile.mentorCount ?? "—"} />
        <StatTile label="Demographics narrative" value={profile.hasDemographicsFocus ? "Yes" : "—"} />
      </div>
      {profile.missingFields.length > 0 ? (
        <p className="app-muted gem-missing">
          Missing: {profile.missingFields.join(", ")}. Add these in Team settings for more accurate matches.
        </p>
      ) : null}
      <Panel
        as="form"
        className="gem-employers"
        onSubmit={(event) => {
          event.preventDefault();
          const mentorEmployers = employersInput
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          mutate({ action: "set-mentor-employers", mentorEmployers });
        }}
      >
        <FormRow label="Mentor employers (comma-separated)">
          <input
            value={employersInput}
            onChange={(event) => setEmployersInput(event.target.value)}
            placeholder="Boeing, Dow Chemical, BAE Systems"
          />
        </FormRow>
        <div>
          <Button variant="secondary" type="submit" disabled={busy}>
            Save mentor employers
          </Button>
        </div>
      </Panel>
    </section>
  );
}

function DeadlineRadar({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel gem-panel" aria-label="Deadline radar">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Deadline radar</span>
          <h2 style={{ margin: 0, fontSize: 16 }}>Eligible grants closing within 45 days</h2>
        </div>
      </header>
      <ul className="impact-activity-list">
        {view.upcomingDeadlines.map((match) => (
          <li key={match.id}>
            <div>
              <strong>{match.grant.name}</strong>
              <span>
                {match.grant.funder} · {formatMoney(match.grant.amountMin, match.grant.amountMax)}
              </span>
              <small>{deadlineLabel(match)}</small>
            </div>
            {match.grant.applicationUrl ? (
              <Button as="a" variant="secondary" href={match.grant.applicationUrl} target="_blank" rel="noreferrer">
                Apply
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function EligibleGrants({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.eligible.length === 0) {
    return (
      <EmptyState
        soft
        badge="No matches yet"
        badgeTone="setup"
        title="No grants match your recorded team profile"
        description="Complete your team profile (rookie year, region, mentor employers, demographics) to surface grants you qualify for."
      >
        <Button as="a" variant="primary" href="#grant-eligibility-profile">
          Complete profile
        </Button>
      </EmptyState>
    );
  }
  return (
    <section className="app-card soft-panel gem-panel" aria-label="Eligible grants">
      <h2>Grants you qualify for</h2>
      <ul className="impact-activity-list">
        {view.eligible.map((match) => (
          <li key={match.id}>
            <div>
              <strong>{match.grant.name}</strong>
              <span>
                {match.grant.funder} · {formatMoney(match.grant.amountMin, match.grant.amountMax)} · {match.score}%
                match
              </span>
              {match.grant.description ? <small>{match.grant.description}</small> : null}
              {match.matchedReasons.length > 0 ? <small>{match.matchedReasons.join(" · ")}</small> : null}
              {deadlineLabel(match) ? <small>{deadlineLabel(match)}</small> : null}
            </div>
            <div className="gem-row-actions">
              {match.grant.applicationUrl ? (
                <Button as="a" variant="secondary" href={match.grant.applicationUrl} target="_blank" rel="noreferrer">
                  Apply
                </Button>
              ) : null}
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "dismiss-match", matchId: match.id })}
              >
                Dismiss
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function IneligibleGrants({
  view,
  show,
  setShow,
}: {
  view: LiveView;
  show: boolean;
  setShow: (v: boolean) => void;
}) {
  const grants = useMemo(() => view.ineligible, [view.ineligible]);
  if (grants.length === 0) return null;
  return (
    <section className="app-card soft-panel gem-panel" aria-label="Ineligible grants">
      <header className="biz-card-head">
        <div>
          <span className="biz-overline">Not yet eligible</span>
          <h2 style={{ margin: 0, fontSize: 16 }}>
            {formatGrantEligibilityMatcherMetric(grants.length, true)} grant(s) your profile doesn&apos;t yet match
          </h2>
        </div>
        <Button variant="secondary" type="button" onClick={() => setShow(!show)}>
          {show ? "Hide" : "Show"}
        </Button>
      </header>
      {show ? (
        <ul className="impact-activity-list">
          {grants.map((match) => (
            <li key={match.id}>
              <div>
                <strong>{match.grant.name}</strong>
                <span>
                  {match.grant.funder} · {formatMoney(match.grant.amountMin, match.grant.amountMax)}
                </span>
                <small>{match.unmetReasons.join(" · ")}</small>
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
