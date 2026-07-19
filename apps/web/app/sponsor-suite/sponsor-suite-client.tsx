"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { UsageCutoffBanner, resolveCutoffErrorCode } from "../../components/usage-cutoff-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel } from "../../components/ui";
import { reminderKindLabel, tierLabel } from "../../lib/sponsor-suite";
import type { SponsorSuiteView } from "../../lib/sponsor-suite/compute-sponsor-suite";
import {
  SPONSOR_SUITE_RELATED_INCLUDE,
  classifySponsorSuiteShell,
  formatSponsorSuiteMetric,
  shouldShowSponsorSuiteSummaryTiles,
  sponsorSuiteNextActions,
  sponsorSuiteRelatedLinks,
  sponsorSuiteSetupSteps,
  sponsorSuiteShellCopy,
  type SponsorSuiteNextAction,
  type SponsorSuiteShellKind,
} from "../../lib/sponsor-suite/sponsor-suite-related";
import type { SponsorSuiteDeckKind, SponsorSuiteReminderKind } from "../../lib/sponsor-suite/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./sponsor-suite.css";

const DECK_KINDS: SponsorSuiteDeckKind[] = ["pitch", "renewal"];
const REMINDER_KINDS: SponsorSuiteReminderKind[] = ["thank_you", "renewal"];

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<SponsorSuiteView, { status: "live" }>;

function SponsorSuiteRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = sponsorSuiteRelatedLinks(orgId, {
    include: [...SPONSOR_SUITE_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sponsor-suite-related" aria-label="Related business tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function SponsorSuiteNextActionsPanel({ actions }: { actions: SponsorSuiteNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions sponsor-suite-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Sponsor CRM and Sponsorship — never DEMO fundraising metrics.</p>
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

function SponsorSuiteShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: SponsorSuiteShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = sponsorSuiteNextActions({ orgId, shell });
  const copy = sponsorSuiteShellCopy(shell);
  const businessHref = hubHref("/business", "sponsor-suite", orgId);
  const steps = shell === "setup" ? sponsorSuiteSetupSteps(orgId) : [];

  return (
    <main className="module-page sponsor-suite-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Sponsor Suite"}
          </>
        }
        title="Sponsor Suite"
        description={description}
      >
        <SponsorSuiteRelatedStrip orgId={orgId} />
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
                ? "No sponsors yet"
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
            <a className="app-button" href={hubHref("/business", "sponsors", orgId)}>
              Open Sponsor CRM
            </a>
            <a className="app-button secondary" href={hubHref("/business", "sponsorship", orgId)}>
              Open Sponsorship
            </a>
            <a className="app-button secondary" href={hubHref("/business", "sponsor-wall", orgId)}>
              Open Sponsor Wall
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
      <SponsorSuiteNextActionsPanel actions={actions} />
    </main>
  );
}

export default function SponsorSuiteClient() {
  const [view, setView] = useState<SponsorSuiteView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);

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
    void fetch(`/api/sponsor-suite${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as SponsorSuiteView | { error?: string };
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
  const deckCount = view?.status === "live" ? view.decks.length : 0;
  const reminderCount = view?.status === "live" ? view.reminders.length : 0;
  const roiReportCount = view?.status === "live" ? view.roiReports.length : 0;
  const hasGoal = view?.status === "live" ? view.goal.goalUsd != null : false;

  const shell = classifySponsorSuiteShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId: view?.status === "live" || view?.status === "setup_required" ? view.orgId : null,
    sponsorCount,
    deckCount,
    reminderCount,
    roiReportCount,
    hasGoal,
  });
  const shellCopy = sponsorSuiteShellCopy(shell);
  const nextActions = sponsorSuiteNextActions({
    orgId,
    shell,
    sponsorCount,
    deckCount,
  });
  const relatedLinks = sponsorSuiteRelatedLinks(orgId, {
    include: [...SPONSOR_SUITE_RELATED_INCLUDE],
  });
  const businessHref = hubHref("/business", "sponsor-suite", orgId);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      setCutoffCode(null);
      try {
        const response = await fetch("/api/sponsor-suite", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as SponsorSuiteView | { error?: string; code?: string };
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
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  if (shell === "loading") {
    return <SponsorSuiteShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <SponsorSuiteShell
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
      <SponsorSuiteShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  if (view?.status !== "live") {
    return <SponsorSuiteShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page sponsor-suite-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={businessHref}>Business</a>
            {" / Sponsor Suite"}
          </>
        }
        title="Sponsor Suite"
        description="Generate pitch/renewal decks, an end-of-season ROI report, and thank-you/renewal reminders — grounded in your recorded sponsors and contributions. Never DEMO fundraising metrics. Deck and ROI generation are metered."
      >
        <div className="sponsor-suite-header-actions">
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

      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <SponsorSuiteNextActionsPanel actions={nextActions} />

      {shouldShowSponsorSuiteSummaryTiles({
        sponsorCount,
        deckCount,
        reminderCount,
        hasGoal,
      }) ? (
        <section className="sponsor-suite-stats" aria-label="Sponsor suite counts">
          <div>
            <strong>{formatSponsorSuiteMetric(sponsorCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Sponsors
            </span>
          </div>
          <div>
            <strong>
              {view.goal.goalUsd != null ? `$${view.goal.actualUsd.toLocaleString()}` : "—"}
            </strong>
            <span className="app-muted" style={{ display: "block" }}>
              Raised
            </span>
          </div>
          <div>
            <strong>{formatSponsorSuiteMetric(deckCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Decks
            </span>
          </div>
          <div>
            <strong>{formatSponsorSuiteMetric(reminderCount, true)}</strong>
            <span className="app-muted" style={{ display: "block" }}>
              Reminders
            </span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <EmptyState
          soft
          badge="No sponsors yet"
          badgeTone="setup"
          title={shellCopy.title}
          description={shellCopy.description}
        >
          <a className="app-button" href={hubHref("/business", "sponsors", orgId)}>
            Open Sponsor CRM
          </a>
          <a className="app-button secondary" href="#sponsor-suite-goal">
            Set a season goal
          </a>
        </EmptyState>
      ) : null}

      <div className="sponsor-suite-layout">
        <GoalPanel view={view} busy={busy} mutate={mutate} />
        <RemindersPanel view={view} busy={busy} mutate={mutate} />
        <DeckPanel view={view} busy={busy} mutate={mutate} cutoffCode={cutoffCode} orgId={orgId} />
        <RoiPanel view={view} busy={busy} mutate={mutate} cutoffCode={cutoffCode} orgId={orgId} />
      </div>
    </main>
  );
}

function GoalPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { goal } = view;
  const [draftGoal, setDraftGoal] = useState("");
  return (
    <Panel id="sponsor-suite-goal">
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h2 style={{ margin: 0 }}>Fundraising goal — {view.seasonYear}</h2>
          <small className="app-muted">
            Actual is computed live from recorded sponsor contributions — never DEMO raised totals.
          </small>
        </div>
        <strong style={{ fontSize: "1.6rem" }}>
          {goal.goalUsd != null ? pct(goal.attainmentPct ?? 0) : "No goal set"}
        </strong>
      </header>
      {goal.goalUsd != null || goal.actualUsd > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
            gap: 12,
            marginTop: 12,
          }}
        >
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>
              ${goal.actualUsd.toLocaleString()}
            </strong>
            <span className="app-muted">Raised</span>
          </div>
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>
              {goal.goalUsd != null ? `$${goal.goalUsd.toLocaleString()}` : "—"}
            </strong>
            <span className="app-muted">Goal</span>
          </div>
          <div>
            <strong style={{ fontSize: "1.4rem", display: "block" }}>
              {goal.remainingUsd != null ? `$${goal.remainingUsd.toLocaleString()}` : "—"}
            </strong>
            <span className="app-muted">Remaining</span>
          </div>
        </div>
      ) : null}
      {goal.goalUsd != null ? (
        <span className="mini-probability" aria-hidden="true" style={{ display: "block", marginTop: 10 }}>
          <i style={{ width: `${Math.min(100, Math.max(2, (goal.attainmentPct ?? 0) * 100))}%` }} />
        </span>
      ) : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          const value = Number(draftGoal);
          if (!Number.isFinite(value) || value < 0) return;
          mutate({ action: "set-goal", goalUsd: value });
          setDraftGoal("");
        }}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", marginTop: 12, flexWrap: "wrap" }}
      >
        <FormRow label={`Set ${view.seasonYear} goal ($)`}>
          <input
            type="number"
            min={0}
            value={draftGoal}
            onChange={(event) => setDraftGoal(event.target.value)}
            placeholder={goal.goalUsd != null ? String(goal.goalUsd) : "5000"}
          />
        </FormRow>
        <button type="submit" className="app-button secondary" disabled={busy || !draftGoal}>
          Save goal
        </button>
      </form>
    </Panel>
  );
}

function RemindersPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [sponsorId, setSponsorId] = useState("");
  const [kind, setKind] = useState<SponsorSuiteReminderKind>("thank_you");
  const [dueOn, setDueOn] = useState("");

  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Thank-you / renewal reminders</h2>
      {view.reminders.length === 0 ? (
        <EmptyState
          soft
          badge="No reminders"
          badgeTone="setup"
          title="No pending reminders"
          description="Create a thank-you or renewal reminder for a real CRM sponsor — never invent DEMO follow-ups."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
          {view.reminders.map((reminder) => (
            <li
              key={reminder.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                alignItems: "flex-start",
              }}
            >
              <div>
                <strong>{reminder.sponsorName}</strong>
                <small className="app-muted" style={{ display: "block" }}>
                  {reminderKindLabel(reminder.kind)} · due {reminder.dueOn}
                  {reminder.note ? ` · ${reminder.note}` : ""}
                </small>
              </div>
              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    mutate({ action: "resolve-reminder", reminderId: reminder.id, status: "sent" })
                  }
                >
                  Mark sent
                </button>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    mutate({
                      action: "resolve-reminder",
                      reminderId: reminder.id,
                      status: "dismissed",
                    })
                  }
                >
                  Dismiss
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {view.sponsors.length === 0 ? (
        <p className="app-muted" style={{ marginTop: 12 }}>
          Add sponsors in{" "}
          <a href={hubHref("/business", "sponsors", view.orgId)}>Business · Sponsors</a> before
          creating reminders.
        </p>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!sponsorId || !dueOn) return;
            mutate({ action: "create-reminder", sponsorId, kind, dueOn });
            setDueOn("");
          }}
          style={{ marginTop: 12 }}
        >
          <FormGrid min={140}>
            <FormRow label="Sponsor">
              <select value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}>
                <option value="">Select…</option>
                {view.sponsors.map((sponsor) => (
                  <option key={sponsor.id} value={sponsor.id}>
                    {sponsor.name}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Kind">
              <select
                value={kind}
                onChange={(event) => setKind(event.target.value as SponsorSuiteReminderKind)}
              >
                {REMINDER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {reminderKindLabel(k)}
                  </option>
                ))}
              </select>
            </FormRow>
            <FormRow label="Due">
              <input type="date" value={dueOn} onChange={(event) => setDueOn(event.target.value)} />
            </FormRow>
          </FormGrid>
          <button
            type="submit"
            className="app-button secondary"
            disabled={busy || !sponsorId || !dueOn}
            style={{ marginTop: 8 }}
          >
            Add reminder
          </button>
        </form>
      )}
    </Panel>
  );
}

function DeckPanel({
  view,
  busy,
  mutate,
  cutoffCode,
  orgId,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  cutoffCode: string | null;
  orgId: string | null;
}) {
  const [sponsorId, setSponsorId] = useState("");
  const [kind, setKind] = useState<SponsorSuiteDeckKind>("pitch");

  return (
    <Panel id="sponsor-suite-decks">
      <h2 style={{ marginTop: 0 }}>Pitch / renewal decks</h2>
      <p className="app-muted" style={{ marginTop: 0 }}>
        Metered generation grounded in recorded sponsors — UsageCutoffBanner appears when budgets
        hard-stop.
      </p>
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}
      <form
        onSubmit={(event) => {
          event.preventDefault();
          mutate({ action: "generate-deck", sponsorId: sponsorId || undefined, kind });
        }}
        style={{ display: "flex", gap: 8, alignItems: "flex-end", flexWrap: "wrap" }}
      >
        <FormRow label="Sponsor (optional)">
          <select value={sponsorId} onChange={(event) => setSponsorId(event.target.value)}>
            <option value="">General prospect</option>
            {view.sponsors.map((sponsor) => (
              <option key={sponsor.id} value={sponsor.id}>
                {sponsor.name} ({tierLabel(sponsor.tier)})
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Kind">
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as SponsorSuiteDeckKind)}
          >
            {DECK_KINDS.map((k) => (
              <option key={k} value={k}>
                {k === "pitch" ? "Pitch" : "Renewal"}
              </option>
            ))}
          </select>
        </FormRow>
        <button type="submit" className="app-button" disabled={busy}>
          Generate deck
        </button>
      </form>

      {view.decks.length === 0 ? (
        <EmptyState
          soft
          badge="No decks yet"
          badgeTone="setup"
          title="Generate your first sponsor deck"
          description="Pitch and renewal outlines are grounded in your recorded sponsor history and season goal — never invent DEMO asks."
        />
      ) : (
        <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 14, marginTop: 12 }}>
          {view.decks.map((deck) => (
            <li key={deck.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  gap: 8,
                  alignItems: "flex-start",
                }}
              >
                <strong>{deck.title}</strong>
                <button
                  type="button"
                  className="text-button"
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm(`Delete "${deck.title}"?`)) {
                      mutate({ action: "delete-deck", deckId: deck.id });
                    }
                  }}
                >
                  Delete
                </button>
              </div>
              <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                {deck.sections.map((section) => (
                  <div key={section.heading}>
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

function RoiPanel({
  view,
  busy,
  mutate,
  cutoffCode,
  orgId,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
  cutoffCode: string | null;
  orgId: string | null;
}) {
  return (
    <Panel>
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0 }}>End-of-season ROI report — {view.seasonYear}</h2>
        <button
          type="button"
          className="app-button secondary"
          disabled={busy}
          onClick={() => mutate({ action: "generate-roi-report" })}
        >
          Generate report
        </button>
      </header>
      <p className="app-muted">
        Metered ROI narrative from recorded sponsor_contributions only — never invent DEMO raised
        totals.
      </p>
      {orgId && cutoffCode ? <UsageCutoffBanner orgId={orgId} errorCode={cutoffCode} compact /> : null}

      {view.roiReports.length === 0 ? (
        <EmptyState
          soft
          badge="No reports yet"
          badgeTone="setup"
          title="Generate an ROI report"
          description="Summarizes recorded sponsor_contributions for this season against your fundraising goal — never DEMO attainment."
        />
      ) : (
        <div style={{ display: "grid", gap: 14, marginTop: 12 }}>
          {view.roiReports.map((report) => (
            <div key={report.id} className="app-card soft-panel" style={{ padding: 12 }}>
              <p style={{ margin: 0 }}>{report.narrative}</p>
              <ul
                className="factor-table"
                style={{ listStyle: "none", padding: 0, marginTop: 10, display: "grid", gap: 6 }}
              >
                {report.lines.map((line) => (
                  <li
                    key={line.sponsorId}
                    style={{ display: "flex", justifyContent: "space-between", gap: 8 }}
                  >
                    <span>
                      {line.sponsorName}{" "}
                      <small className="app-muted">({tierLabel(line.tier)})</small>
                    </span>
                    <small className="app-muted">
                      ${line.totalContributedUsd.toLocaleString()} · {line.contributionCount}{" "}
                      contribution(s)
                    </small>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
