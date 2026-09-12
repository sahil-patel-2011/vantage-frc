"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  type BadgeTone,
  Button,
  Card,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import type { CadChangeRadarView } from "../../lib/cad-change-radar/compute-cad-change-radar";
import type { CadChangeRadarSeverity } from "../../lib/cad-change-radar/types";
import {
  CAD_CHANGE_RADAR_RELATED_INCLUDE,
  cadChangeRadarNextActions,
  cadChangeRadarRelatedLinks,
  cadChangeRadarSetupSteps,
  cadChangeRadarShellCopy,
  classifyCadChangeRadarShell,
  formatCadChangeRadarMetric,
  shouldShowCadChangeRadarSummaryTiles,
  type CadChangeRadarNextAction,
  type CadChangeRadarShellKind,
} from "../../lib/cad-change-radar/cad-change-radar-related";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./cad-change-radar.css";

function isCadChangeRadarView(value: unknown): value is CadChangeRadarView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistCadChangeRadarSnapshot(orgHint: string, data: CadChangeRadarView): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("cad-change-radar", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("cad-change-radar", "_", data);
  } catch {
    // Live Change radar already painted; IndexedDB is best-effort.
  }
}

type LiveView = Extract<CadChangeRadarView, { status: "live" }>;

const severityTone: Record<CadChangeRadarSeverity, BadgeTone> = {
  major: "danger",
  moderate: "setup",
  minor: "good",
};

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = cadChangeRadarRelatedLinks(orgId, {
    include: [...CAD_CHANGE_RADAR_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related ccr-related" aria-label="Related build tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: CadChangeRadarNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions ccr-next-actions" aria-label="Next actions">
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

function RadarShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: CadChangeRadarShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = cadChangeRadarNextActions({ orgId, shell });
  const copy = cadChangeRadarShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "cad-change-radar", orgId);
  const setup = shell === "setup" ? cadChangeRadarSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page ccr-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Change radar"}
          </>
        }
        title="Change radar"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading Change radar">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href="#cad-change-radar-snapshot">Record the first snapshot</Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function CadChangeRadarClient() {
  const [view, setView] = useState<CadChangeRadarView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<CadChangeRadarView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<CadChangeRadarView>("cad-change-radar", urlOrg || "_");
        if (!viewRef.current && cached?.data && isCadChangeRadarView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          hadCache = true;
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      setFetchFailed(false);
      setError("");
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      try {
        const response = await fetch(
          `/api/cad-change-radar${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as CadChangeRadarView | { error?: string };
        if (!response.ok || !isCadChangeRadarView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Change radar. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistCadChangeRadarSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Change radar. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setFetchFailed(true);
        }
      }
    })();
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const orgId = view && "orgId" in view ? view.orgId : null;
  const snapshotCount = view?.status === "live" ? view.snapshots.length : 0;
  const diffCount = view?.status === "live" ? view.diffs.length : 0;
  const unreadCount =
    view?.status === "live" ? view.notifications.filter((n) => !n.acknowledgedAt).length : 0;

  const shell = classifyCadChangeRadarShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    snapshotCount,
    diffCount,
  });
  const shellCopy = cadChangeRadarShellCopy(shell);
  const nextActions = cadChangeRadarNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    snapshotCount,
    diffCount,
    unreadCount,
  });
  const relatedLinks = cadChangeRadarRelatedLinks(orgId, {
    include: [...CAD_CHANGE_RADAR_RELATED_INCLUDE],
  });
  const buildHref = hubWorkbenchHref("build", "cad-change-radar", orgId);
  const showTiles = shouldShowCadChangeRadarSummaryTiles(snapshotCount, diffCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/cad-change-radar", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as CadChangeRadarView | { error?: string };
        if (!response.ok || !isCadChangeRadarView(data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistCadChangeRadarSnapshot(orgId, data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, busy],
  );

  if (shell === "loading") {
    return (
      <RadarShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Change radar" fromCache={fromCache} cachedAt={cachedAt} />
      </RadarShell>
    );
  }

  if (shell === "error") {
    return (
      <RadarShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Change radar" fromCache={fromCache} cachedAt={cachedAt} />
      </RadarShell>
    );
  }

  if (shell === "setup") {
    return (
      <RadarShell
        description={view?.status === "setup_required" ? view.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
      >
        <OfflineBanner feature="Change radar" fromCache={fromCache} cachedAt={cachedAt} />
      </RadarShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <RadarShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Change radar" fromCache={fromCache} cachedAt={cachedAt} />
      </RadarShell>
    );
  }

  return (
    <main className="module-page ccr-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Change radar"}
          </>
        }
        title="Change radar"
        description="Snapshot tracked parameters on every Onshape release, diff them automatically, and notify who it affects. Cross-check CAD, Failure log, and Prototypes."
      >
        <div className="ccr-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>
      <OfflineBanner feature="Change radar" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="app-status" role="alert">
          {error}
        </p>
      ) : null}

      <NextActionsPanel actions={nextActions} />

      {showTiles ? (
        <section className="ccr-stats" aria-label="CAD change radar counts">
          <StatTile label="Snapshots" value={formatCadChangeRadarMetric(snapshotCount, true)} />
          <StatTile label="Diffs" value={formatCadChangeRadarMetric(diffCount, true)} />
          <StatTile label="Unread alerts" value={formatCadChangeRadarMetric(unreadCount, true)} />
        </section>
      ) : null}

      <ConnectionPanel view={view} />
      <div id="cad-change-radar-alerts">
        <NotificationsPanel view={view} busy={busy} mutate={mutate} />
      </div>
      <div id="cad-change-radar-diffs">
        <DiffsPanel view={view} busy={busy} mutate={mutate} />
      </div>
      <div id="cad-change-radar-snapshot">
        <SnapshotForm view={view} busy={busy} mutate={mutate} />
      </div>
      <SubscriptionsPanel view={view} busy={busy} mutate={mutate} />
    </main>
  );
}

function ConnectionPanel({ view }: { view: LiveView }) {
  return (
    <Card
      as="section"
      aria-label="Onshape connection"
      title={view.connection.label}
      subtitle="Onshape document"
      actions={<Badge tone="good">{view.connection.status}</Badge>}
    >
      <p className="app-muted ccr-connection-meta">
        {formatCadChangeRadarMetric(view.snapshots.length, true)} tracked part(s) ·{" "}
        {formatCadChangeRadarMetric(view.diffs.length, true)} recorded release diff(s) — from real snapshots only.
      </p>
    </Card>
  );
}

function NotificationsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const unread = view.notifications.filter((n) => !n.acknowledgedAt);
  if (view.notifications.length === 0) {
    return (
      <EmptyState
        soft
        badge="No alerts yet"
        badgeTone="setup"
        title="You'll be notified here when a part you subscribe to changes"
        description="Notifications fan out automatically when a tracked part gets a new release with a diff."
      />
    );
  }
  return (
    <Card as="section" aria-label="Change notifications" title="Your alerts">
      <ul className="impact-activity-list">
        {view.notifications.slice(0, 20).map((item) => (
          <li key={item.id}>
            <div>
              <Badge tone={severityTone[item.severity]}>{item.severity.toUpperCase()}</Badge>
              <strong style={{ marginLeft: 8 }}>{item.partName}</strong>
              <span>{item.message}</span>
            </div>
            {!item.acknowledgedAt ? (
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "acknowledge-notification", notificationId: item.id })}
              >
                Acknowledge
              </button>
            ) : (
              <small className="app-muted">Acknowledged</small>
            )}
          </li>
        ))}
      </ul>
      {unread.length > 0 ? (
        <small className="app-muted">{formatCadChangeRadarMetric(unread.length, true)} unread</small>
      ) : null}
    </Card>
  );
}

function DiffsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.diffs.length === 0) {
    return (
      <EmptyState
        soft
        badge="No release diffs yet"
        badgeTone="setup"
        title="Record a revision snapshot below to start diffing releases"
        description="Diffs appear once a second snapshot of the same part is recorded — empty means nothing tracked yet."
      >
        <Button as="a" variant="primary" href="#cad-change-radar-snapshot">
          Record snapshot
        </Button>
      </EmptyState>
    );
  }
  return (
    <Card as="section" aria-label="Recent release diffs" title="Recent release diffs">
      <ul className="impact-activity-list">
        {view.diffs.map((diff) => (
          <li key={diff.id}>
            <div>
              <Badge tone={severityTone[diff.severity]}>{diff.severity.toUpperCase()}</Badge>
              <strong style={{ marginLeft: 8 }}>{diff.partName}</strong>
              <span>
                {diff.fromRevision ?? "—"} → {diff.toRevision}
              </span>
              <small>{diff.aiSummary ?? "No plain-language summary generated yet."}</small>
              <ul className="ccr-delta-list">
                {diff.changedParams.slice(0, 6).map((delta) => (
                  <li key={delta.key}>
                    {delta.key}: {delta.fromValue ?? "—"} → {delta.toValue ?? "—"}
                    {delta.percentChange != null ? ` (${delta.percentChange.toFixed(1)}%)` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <button
              type="button"
              className="text-button"
              disabled={busy}
              onClick={() => mutate({ action: "generate-summary", diffId: diff.id })}
            >
              {diff.aiSummary ? "Regenerate summary" : "Generate summary (computed from the diff)"}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function SnapshotForm({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({ partKey: "", partName: "", revision: "", massKg: "", paramsText: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      className="ccr-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.partKey.trim() || !form.partName.trim() || !form.revision.trim()) return;
        let params: Record<string, unknown> = {};
        if (form.paramsText.trim()) {
          try {
            params = JSON.parse(form.paramsText) as Record<string, unknown>;
          } catch {
            return;
          }
        }
        mutate({
          action: "record-snapshot",
          connectionId: view.connection.id,
          partKey: form.partKey,
          partName: form.partName,
          revision: form.revision,
          massKg: form.massKg ? Number(form.massKg) : undefined,
          params,
        });
        setForm(empty);
      }}
    >
      <span className="biz-overline">Record a revision</span>
      <h2>Log part-revision snapshot</h2>
      <p className="app-muted ccr-form-hint">
        Normally pushed by the Onshape release webhook — record manually to backfill or test.
      </p>
      <FormGrid min={160}>
        <FormRow label="Part key">
          <input value={form.partKey} onChange={set("partKey")} placeholder="intake-plate" required />
        </FormRow>
        <FormRow label="Part name">
          <input value={form.partName} onChange={set("partName")} placeholder="Intake Plate" required />
        </FormRow>
        <FormRow label="Revision">
          <input value={form.revision} onChange={set("revision")} placeholder="R4" required />
        </FormRow>
        <FormRow label="Mass (kg, optional)">
          <input type="number" step="0.01" value={form.massKg} onChange={set("massKg")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Tracked params (JSON, optional)">
        <textarea
          value={form.paramsText}
          onChange={set("paramsText")}
          rows={2}
          placeholder='{"envelope_length_mm": 320, "gear_ratio": 4.5}'
        />
      </FormRow>
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !form.partKey.trim() || !form.partName.trim() || !form.revision.trim()}
        >
          Record snapshot
        </Button>
      </div>
    </Panel>
  );
}

function SubscriptionsPanel({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [partKey, setPartKey] = useState("");
  const [subsystem, setSubsystem] = useState("");

  return (
    <Card as="section" aria-label="Subscriptions" title="Subscribe to a part">
      <p className="app-muted ccr-form-hint">
        Get notified when a tracked part changes — electrical, software, or any subsystem owner can subscribe.
      </p>
      <div className="ccr-subscribe-row">
        <input value={partKey} onChange={(e) => setPartKey(e.target.value)} placeholder="Part key" />
        <input value={subsystem} onChange={(e) => setSubsystem(e.target.value)} placeholder="Subsystem (optional)" />
        <Button
          variant="secondary"
          disabled={busy || !partKey.trim()}
          onClick={() => {
            mutate({ action: "subscribe", partKey, subsystem: subsystem || undefined });
            setPartKey("");
            setSubsystem("");
          }}
        >
          Subscribe
        </Button>
      </div>
      {view.mySubscriptions.length === 0 ? (
        <p className="app-muted ccr-form-hint">You are not subscribed to any parts yet.</p>
      ) : (
        <ul className="impact-activity-list">
          {view.mySubscriptions.map((sub) => (
            <li key={sub.id}>
              <div>
                <strong>{sub.partKey}</strong>
                <span>{sub.subsystem ?? "—"}</span>
              </div>
              <button
                type="button"
                className="text-button"
                disabled={busy}
                onClick={() => mutate({ action: "unsubscribe", subscriptionId: sub.id })}
              >
                Unsubscribe
              </button>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
