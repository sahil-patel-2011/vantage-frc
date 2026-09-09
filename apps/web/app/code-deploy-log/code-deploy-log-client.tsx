"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
  type BadgeTone,
} from "../../components/ui";
import { deployStatusLabel, deployTypeLabel } from "../../lib/code-deploy-log";
import {
  DEPLOY_STATUSES,
  DEPLOY_TYPES,
  type CodeDeployLogView,
} from "../../lib/code-deploy-log/compute-code-deploy-log";
import type { DeployStatus, DeployType } from "../../lib/code-deploy-log/types";
import {
  CODE_DEPLOY_LOG_RELATED_INCLUDE,
  classifyCodeDeployLogShell,
  codeDeployLogNextActions,
  codeDeployLogRelatedLinks,
  codeDeployLogSetupSteps,
  codeDeployLogShellCopy,
  formatCodeDeployLogMetric,
  shouldShowCodeDeployLogSummaryTiles,
  type CodeDeployLogNextAction,
  type CodeDeployLogShellKind,
} from "../../lib/code-deploy-log/code-deploy-log-related";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./code-deploy-log.css";

const statusTone: Record<DeployStatus, BadgeTone> = {
  deployed: "good",
  rolled_back: "setup",
  failed: "danger",
};

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<CodeDeployLogView, { status: "live" }>;

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = codeDeployLogRelatedLinks(orgId, {
    include: [...CODE_DEPLOY_LOG_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related cdl-related" aria-label="Related build tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: CodeDeployLogNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions cdl-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Code Coach, Code-vs-Match, and CAD — never DEMO firmware trails.</p>
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

function DeployShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: CodeDeployLogShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = codeDeployLogNextActions({ orgId, shell });
  const copy = codeDeployLogShellCopy(shell);
  const buildHref = hubWorkbenchHref("build", "code-deploy-log", orgId);
  const steps = shell === "setup" ? codeDeployLogSetupSteps(orgId) : [];

  return (
    <main className="module-page cdl-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Code Deploy Log"}
          </>
        }
        title="Code Deploy Log"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading code deploy log">
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
              <a className="app-button" href="#code-deploy-log-form">
                Log the first deploy
              </a>
              <a className="app-button secondary" href={hubHref("/build", "code", orgId)}>
                Open Code Coach
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="cdl-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Code and CAD — never DEMO firmware trails.</p>
          </header>
          <ul className="cdl-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted cdl-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      {steps.length === 0 ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function CodeDeployLogClient() {
  const [view, setView] = useState<CodeDeployLogView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
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
    void fetch(`/api/code-deploy-log${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as CodeDeployLogView | { error?: string };
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
  const deployCount = view?.status === "live" ? view.summary.totalDeploys : 0;
  const matchLinkedCount = view?.status === "live" ? view.summary.matchLinkedDeploys : 0;

  const shell = classifyCodeDeployLogShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    deployCount,
  });
  const shellCopy = codeDeployLogShellCopy(shell);
  const nextActions = codeDeployLogNextActions({
    orgId,
    shell: shell === "empty" ? "ready" : shell,
    deployCount,
    matchLinkedCount,
  });
  const relatedLinks = codeDeployLogRelatedLinks(orgId, {
    include: [...CODE_DEPLOY_LOG_RELATED_INCLUDE],
  });
  const buildHref = hubWorkbenchHref("build", "code-deploy-log", orgId);
  const showTiles = shouldShowCodeDeployLogSummaryTiles(deployCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/code-deploy-log", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        });
        const data = (await response.json()) as CodeDeployLogView | { error?: string };
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
    return <DeployShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <DeployShell
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
      <DeployShell
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
      </DeployShell>
    );
  }

  if (view?.status !== "live") {
    return <DeployShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page cdl-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={buildHref}>Build</a>
            {" / Code Deploy Log"}
          </>
        }
        title="Code Deploy Log"
        description="Track which firmware/software build ran during which match or test session — never DEMO firmware trails. Cross-check Code Coach, Code-vs-Match, and CAD."
      >
        <div className="cdl-header-actions">
          {view.seasons.length > 0 ? (
            <label className="app-muted cdl-filter">
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

      <NextActionsPanel actions={nextActions} />

      {showTiles ? (
        <Panel className="cdl-panel">
          <div className="cdl-stats">
            <StatTile label="Deploys" value={formatCodeDeployLogMetric(view.summary.totalDeploys, true)} />
            <StatTile
              label="Match-linked"
              value={formatCodeDeployLogMetric(view.summary.matchLinkedDeploys, true)}
            />
            <StatTile label="Rollback rate" value={pct(view.summary.rollbackRate)} />
            <StatTile label="Last deploy" value={view.summary.lastDeployedOn ?? "—"} />
          </div>
          {view.summary.byStatus.length > 0 ? (
            <div className="cdl-status-row">
              {view.summary.byStatus.map((row) => (
                <Badge key={row.status} tone={statusTone[row.status]}>
                  {deployStatusLabel(row.status)}: {formatCodeDeployLogMetric(row.count, true)}
                </Badge>
              ))}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <div id="code-deploy-log-form">
        <LogDeployForm busy={busy} mutate={mutate} />
      </div>
      <RecentDeploys view={view} busy={busy} mutate={mutate} />
    </main>
  );
}

function RecentDeploys({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalDeploys === 0) {
    return (
      <EmptyState
        soft
        badge="No deploys yet"
        badgeTone="setup"
        title="Log your first code deploy"
        description="Record the firmware version, commit, and match tied to each deploy so you can trace robot behavior back to code — never DEMO firmware packs."
      >
        <a className="app-button" href="#code-deploy-log-form">
          Log deploy
        </a>
      </EmptyState>
    );
  }
  return (
    <Panel id="code-deploy-log-history" className="cdl-panel">
      <h2 style={{ marginTop: 0 }}>Deploy history</h2>
      <ul className="cdl-history">
        {view.entries.slice(0, 30).map((item) => (
          <li key={item.id} className="cdl-history-row">
            <div>
              <strong>{item.firmwareVersion}</strong>{" "}
              <Badge tone={statusTone[item.status]}>{deployStatusLabel(item.status)}</Badge>
              <small className="app-muted">
                {item.deployedOn} · {deployTypeLabel(item.deployType)}
                {item.matchKey ? ` · ${item.matchKey}` : ""}
                {item.branch ? ` · ${item.branch}` : ""}
                {item.commitSha ? ` · ${item.commitSha}` : ""}
              </small>
              {item.notes ? <small className="app-muted">{item.notes}</small> : null}
            </div>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              aria-label={`Delete deploy ${item.firmwareVersion}`}
              onClick={() => {
                if (window.confirm(`Delete deploy "${item.firmwareVersion}"?`)) {
                  mutate({ action: "delete-deploy", entryId: item.id });
                }
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function LogDeployForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      deployedOn: "",
      firmwareVersion: "",
      matchKey: "",
      eventKey: "",
      commitSha: "",
      branch: "",
      deployType: "practice" as DeployType,
      status: "deployed" as DeployStatus,
      notes: "",
    }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <Panel
      as="form"
      className="cdl-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.deployedOn || !form.firmwareVersion.trim()) return;
        mutate({
          action: "log-deploy",
          deployedOn: form.deployedOn,
          firmwareVersion: form.firmwareVersion,
          matchKey: form.matchKey || undefined,
          eventKey: form.eventKey || undefined,
          commitSha: form.commitSha || undefined,
          branch: form.branch || undefined,
          deployType: form.deployType,
          status: form.status,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
    >
      <h2 style={{ margin: 0 }}>Log deploy</h2>
      <FormGrid min={160}>
        <FormRow label="Date">
          <input type="date" value={form.deployedOn} onChange={set("deployedOn")} required />
        </FormRow>
        <FormRow label="Firmware / build version">
          <input value={form.firmwareVersion} onChange={set("firmwareVersion")} placeholder="v1.4.0" required />
        </FormRow>
        <FormRow label="Match key (optional)">
          <input value={form.matchKey} onChange={set("matchKey")} placeholder="2026miket_qm10" />
        </FormRow>
        <FormRow label="Event key (optional)">
          <input value={form.eventKey} onChange={set("eventKey")} placeholder="2026miket" />
        </FormRow>
        <FormRow label="Commit SHA (optional)">
          <input value={form.commitSha} onChange={set("commitSha")} placeholder="abc1234" />
        </FormRow>
        <FormRow label="Branch (optional)">
          <input value={form.branch} onChange={set("branch")} placeholder="main" />
        </FormRow>
        <FormRow label="Deploy type">
          <select value={form.deployType} onChange={set("deployType")}>
            {DEPLOY_TYPES.map((deployType) => (
              <option key={deployType} value={deployType}>
                {deployTypeLabel(deployType)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Status">
          <select value={form.status} onChange={set("status")}>
            {DEPLOY_STATUSES.map((status) => (
              <option key={status} value={status}>
                {deployStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !form.deployedOn || !form.firmwareVersion.trim()}
        >
          Log deploy
        </Button>
      </div>
    </Panel>
  );
}
