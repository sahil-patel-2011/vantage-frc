"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Panel,
  SectionHeading,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { hourLogKindLabel } from "../../lib/hours-self-view";
import type { HoursSelfViewView } from "../../lib/hours-self-view/compute-hours-self-view";
import {
  HOURS_SELF_VIEW_RELATED_INCLUDE,
  classifyHoursSelfViewShell,
  formatHoursSelfViewHours,
  formatHoursSelfViewMetric,
  hoursSelfViewNextActions,
  hoursSelfViewRelatedLinks,
  hoursSelfViewSetupSteps,
  hoursSelfViewShellCopy,
  shouldShowHoursSelfViewSummaryTiles,
  type HoursSelfViewNextAction,
  type HoursSelfViewShellKind,
} from "../../lib/hours-self-view/hours-self-view-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./hours-self-view.css";

type LiveView = Extract<HoursSelfViewView, { status: "live" }>;

function fmtDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function fmtHours(minutes: number): string {
  return `${Math.round((minutes / 60) * 10) / 10}h`;
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = hoursSelfViewRelatedLinks(orgId, {
    include: [...HOURS_SELF_VIEW_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related hsv-related" aria-label="Related team tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: HoursSelfViewNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions hsv-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Attendance, Consent, and Mentor Hours — never DEMO hour totals.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function HoursShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: HoursSelfViewShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = hoursSelfViewNextActions({ orgId, shell });
  const copy = hoursSelfViewShellCopy(shell);
  const teamHref = hubWorkbenchHref("team", "hours-self-view", orgId);
  const steps = shell === "setup" ? hoursSelfViewSetupSteps(orgId) : [];

  return (
    <main className="module-page hsv-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / My Hours"}
          </>
        }
        title="My Hours"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading my hours">
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
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Open Workspace
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/team", "attendance", orgId)}>
                Open Attendance
              </a>
              <a className="app-button secondary" href={withOrgHref("/consent", orgId)}>
                Open Consent
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="hsv-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Attendance and Consent — never DEMO hour totals.</p>
          </header>
          <ul className="hsv-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted hsv-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href} aria-label={step.label}>Open</a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <NextActionsPanel actions={actions} />
    </main>
  );
}

export default function HoursSelfViewClient() {
  const [view, setView] = useState<HoursSelfViewView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    void fetch(`/api/hours-self-view${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as HoursSelfViewView | { error?: string };
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
  const entryCount = view?.status === "live" ? view.summary.totalEntries : 0;
  const kioskCount = view?.status === "live" ? view.kioskSessions.length : 0;

  const shell = classifyHoursSelfViewShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    entryCount,
  });
  const shellCopy = hoursSelfViewShellCopy(shell);
  const nextActions = hoursSelfViewNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    entryCount,
    kioskCount,
  });
  const teamHref = hubWorkbenchHref("team", "hours-self-view", orgId);
  const showTiles = shouldShowHoursSelfViewSummaryTiles(entryCount);
  const loaded = view?.status === "live";

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/hours-self-view", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        const data = (await response.json()) as HoursSelfViewView | { error?: string };
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
    return <HoursShell description={shellCopy.description} orgId={null} shell="loading" />;
  }
  if (shell === "error") {
    return (
      <HoursShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      />
    );
  }
  if (shell === "setup" || view?.status !== "live") {
    return (
      <HoursShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      />
    );
  }

  return (
    <main className="module-page hsv-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / My Hours"}
          </>
        }
        title="My Hours"
        description="Your own logged shop, meeting, and outreach time — plus who’s in the shop right now from open clock-ins. Never DEMO hour totals or a public hours leaderboard."
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {showTiles ? (
        <Panel className="hsv-panel">
          <div className="hsv-stats">
            <StatTile label="Total hours" value={formatHoursSelfViewHours(view.summary.totalHours, loaded)} />
            <StatTile label="Sessions" value={formatHoursSelfViewMetric(view.summary.totalEntries, loaded)} />
            <StatTile label="Status" value={view.summary.openEntry ? "Clocked in" : "Clocked out"} />
            {view.presentNow.length > 0 ? (
              <StatTile label="In the shop" value={formatHoursSelfViewMetric(view.presentNow.length, loaded)} />
            ) : null}
          </div>
          {view.summary.byKind.length > 0 ? (
            <ul className="hsv-kind-list">
              {view.summary.byKind.map((row) => (
                <li key={row.kind} className="hsv-kind-row">
                  <span>{hourLogKindLabel(row.kind)}</span>
                  <small className="app-muted">
                    {row.entries} session(s) · {row.hours}h
                  </small>
                </li>
              ))}
            </ul>
          ) : null}
        </Panel>
      ) : null}

      <PresencePanel view={view} />
      <BiometricGatePanel view={view} busy={busy} mutate={mutate} />
      <KioskPanel view={view} />
      <EntriesList view={view} />
      <NextActionsPanel actions={nextActions} />
    </main>
  );
}

function BiometricGatePanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const { biometricConsent, biometricGate } = view;
  return (
    <Panel className="hsv-panel" aria-label="Biometric consent gate">
      <header className="hsv-bio-header">
        <div>
          <Badge tone={biometricGate.allowed ? "good" : "setup"}>
            {biometricGate.allowed ? "Biometrics allowed" : "Biometrics blocked"}
          </Badge>
          <SectionHeading title="Biometric consent gate" />
          <small className="app-muted">{biometricGate.reason}</small>
        </div>
      </header>
      {biometricConsent ? (
        <p className="app-muted">
          {biometricConsent.isMinor ? "Minor" : "Adult"} · status: {biometricConsent.status}
          {biometricConsent.guardianName ? ` · guardian: ${biometricConsent.guardianName}` : ""}
        </p>
      ) : (
        <p className="app-muted">No consent record on file yet — never DEMO gates.</p>
      )}
      {!biometricConsent || biometricConsent.status !== "granted" ? (
        <div>
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() =>
              mutate({
                action: "record-biometric-consent",
                isMinor: true,
                status: "pending",
              })
            }
          >
            Request guardian consent
          </Button>
        </div>
      ) : null}
    </Panel>
  );
}

function PresencePanel({ view }: { view: LiveView }) {
  if (view.presentNow.length === 0) {
    return (
      <EmptyState
        soft
        badge="Shop floor"
        badgeTone="setup"
        title="Nobody clocked in"
        description="Open hour_logs sessions appear here — never a DEMO occupancy list."
      />
    );
  }
  return (
    <Panel id="hours-self-present" className="hsv-panel">
      <SectionHeading title="In the shop now" />
      <ul className="hsv-presence-list">
        {view.presentNow.map((person) => (
          <li key={person.userId} className="hsv-presence-row">
            <div>
              <strong>{person.displayName}</strong>
              <small className="app-muted hsv-block">
                {hourLogKindLabel(person.kind)} · since {fmtDateTime(person.clockIn)}
              </small>
            </div>
            <small className="app-muted">{fmtHours(person.minutesOpen)}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function KioskPanel({ view }: { view: LiveView }) {
  if (view.kioskSessions.length === 0) {
    return (
      <EmptyState
        soft
        badge="No kiosk devices"
        badgeTone="setup"
        title="No locked kiosk devices registered"
        description="An owner or admin can register a shop-floor kiosk for supervised clock-in/out — never DEMO floor units."
      />
    );
  }
  return (
    <Panel id="hours-self-kiosks" className="hsv-panel">
      <SectionHeading title="Kiosk devices" />
      <ul className="hsv-kiosk-list">
        {view.kioskSessions.map((kiosk) => (
          <li key={kiosk.id} className="hsv-kiosk-row">
            <span>{kiosk.deviceLabel}</span>
            <small className="app-muted">
              {kiosk.isLocked ? "Locked" : "Unlocked"}
              {kiosk.lastActiveAt ? ` · last active ${fmtDateTime(kiosk.lastActiveAt)}` : ""}
            </small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function EntriesList({ view }: { view: LiveView }) {
  if (view.entries.length === 0) {
    return (
      <EmptyState
        soft
        badge="No hours yet"
        badgeTone="setup"
        title="No logged hours yet"
        description="Clock in from Attendance to start building your record — never DEMO hour packs."
      />
    );
  }
  return (
    <Panel id="hours-self-entries" className="hsv-panel">
      <SectionHeading title="Recent sessions" />
      <ul className="hsv-entry-list">
        {view.entries.slice(0, 30).map((entry) => (
          <li key={entry.id} className="hsv-entry-row">
            <div>
              <strong>{hourLogKindLabel(entry.kind)}</strong>
              <small className="app-muted hsv-block">
                {fmtDateTime(entry.clockIn)}
                {entry.clockOut ? ` – ${fmtDateTime(entry.clockOut)}` : " · in progress"}
                {entry.note ? ` · ${entry.note}` : ""}
              </small>
            </div>
            <small className="app-muted">{entry.clockOut ? fmtHours(entry.minutes) : "—"}</small>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
