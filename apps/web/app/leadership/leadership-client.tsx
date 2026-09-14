"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { EmptyState, FormGrid, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { leadershipCategoryLabel, leadershipHandoffStatusLabel } from "../../lib/leadership";
import {
  LEADERSHIP_CATEGORY_VALUES,
  LEADERSHIP_STATUS_VALUES,
  type LeadershipView,
} from "../../lib/leadership/compute-leadership";
import {
  LEADERSHIP_RELATED_INCLUDE,
  classifyLeadershipShell,
  leadershipNextActions,
  leadershipRelatedLinks,
  leadershipSetupSteps,
  leadershipShellCopy,
  shouldShowLeadershipSummaryTiles,
  type LeadershipNextAction,
  type LeadershipShellKind,
} from "../../lib/leadership/leadership-related";
import type { LeadershipCategory, LeadershipHandoffStatus, LeadershipTier } from "../../lib/leadership/types";
import { hubWorkbenchHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

function tierTone(tier: LeadershipTier): string {
  if (tier === "resilient") return "good";
  if (tier === "developing") return "setup";
  return "demo";
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

type LiveView = Extract<LeadershipView, { status: "live" }>;

function isLeadershipView(value: unknown): value is LeadershipView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function leadershipCacheOrg(data: LeadershipView, orgHint: string): string {
  switch (data.status) {
    case "setup_required":
      return data.orgId?.trim() || orgHint;
    case "live":
      return data.orgId.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistLeadershipSnapshot(
  orgHint: string,
  seasonHint: string,
  data: LeadershipView,
): Promise<void> {
  const cacheOrg = leadershipCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("leadership", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("leadership", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Leadership already painted; IndexedDB is best-effort.
  }
}

function LeadershipRelated({ orgId }: { orgId?: string | null }) {
  const links = leadershipRelatedLinks(orgId, {
    include: [...LEADERSHIP_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related" aria-label="Related team tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: LeadershipNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions" aria-label="Next actions">
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

export default function LeadershipClient() {
  const [view, setView] = useState<LeadershipView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<LeadershipView | null>(null);
  viewRef.current = view;

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback(async (seasonOverride?: number) => {
    const params = new URLSearchParams(window.location.search);
    const orgHint = params.get("orgId")?.trim() ?? "";
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const seasonHint =
      seasonQuery && Number.isFinite(seasonQuery) ? String(seasonQuery) : String(new Date().getFullYear());
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<LeadershipView>("leadership", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isLeadershipView(cached.data)) {
        setView(cached.data);
        setSeason(cached.data.seasonYear);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setError("");
    setLoadError("");
    setErrorStatus(null);
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/leadership${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      if (!response.ok || !isLeadershipView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Leadership. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFetchFailed(true);
        setErrorStatus(response.status);
        setLoadError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistLeadershipSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Leadership. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/leadership", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data: unknown = await response.json().catch(() => null);
        if (!response.ok || !isLeadershipView(data)) {
          setError(
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Something went wrong.",
          );
          return;
        }
        setView(data);
        setSeason(data.seasonYear);
        setFromCache(false);
        void persistLeadershipSnapshot(orgId, String(data.seasonYear), data);
      } catch {
        setError("Network error — please try again.");
      } finally {
        setBusy(false);
      }
    },
    [orgId, season, busy],
  );

  const teamHref = hubWorkbenchHref("team", "leadership", orgId);
  const roleCount = view?.status === "live" ? view.roles.length : 0;
  const shell: LeadershipShellKind = classifyLeadershipShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    roleCount,
  });
  const copy = leadershipShellCopy(shell);
  const actions = leadershipNextActions({ orgId, shell, roleCount });
  const setup = shell === "setup" ? leadershipSetupSteps(orgId)[0] : null;
  const showTiles = shouldShowLeadershipSummaryTiles(roleCount);

  if (!view) {
    const failure = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: loadError,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: loadError || copy.description,
          },
        )
      : null;
    const primary = failure?.primary ?? (setup ? { label: setup.label, href: setup.href } : null);
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs={
            <>
              <a href={teamHref}>Team</a>
              {" / Leadership"}
            </>
          }
          title="Leadership"
          description={copy.description}
        >
          <LeadershipRelated orgId={orgId} />
        </PageHeader>
        <OfflineBanner feature="Leadership" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          title={failure ? failure.title : copy.title}
          description={failure ? failure.description : copy.description}
          badge={copy.badge}
          badgeTone="setup"
          aria-busy={!fetchFailed}
        >
          {primary ? (
            <Button as="a" variant="primary" href={primary.href}>
              {primary.label}
            </Button>
          ) : failure?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  switch (view.status) {
    case "setup_required":
      return (
        <main className="module-page">
          <PageHeader
            breadcrumbs={
              <>
                <a href={teamHref}>Team</a>
                {" / Leadership"}
              </>
            }
            title="Leadership"
            description={copy.description}
          >
            <LeadershipRelated orgId={view.orgId} />
          </PageHeader>
          <OfflineBanner feature="Leadership" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState badge="Needs setup" badgeTone="setup" title={copy.title} description={view.message || copy.description}>
            {setup ? (
              <Button as="a" variant="primary" href={setup.href}>
                {setup.label}
              </Button>
            ) : (
              <Button as="a" variant="primary" href="/workspace">
                Choose your team
              </Button>
            )}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      view satisfies never;
      return null;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={teamHref}>Team</a>
            {" / Leadership"}
          </>
        }
        title="Leadership"
        description={copy.description}
      >
        <LeadershipRelated orgId={view.orgId} />
        {view.seasons.length > 0 ? (
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => {
                const next = Number(event.target.value);
                setSeason(next);
                void load(next);
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
      <OfflineBanner feature="Leadership" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {showTiles ? <ReadinessPanel view={view} /> : null}
        {showTiles ? <SummaryTiles view={view} /> : null}
        <CreateRoleForm busy={busy} mutate={mutate} />
        <RoleBoard view={view} busy={busy} mutate={mutate} />
        {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
      </div>
    </main>
  );
}

function ReadinessPanel({ view }: { view: LiveView }) {
  const { readiness } = view;
  return (
    <Panel aria-label="Leadership continuity readiness">
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <span className={`app-badge ${tierTone(readiness.tier)}`}>{readiness.tier.replace("_", " ").toUpperCase()}</span>
          <h2 style={{ margin: "6px 0 0" }}>Succession coverage</h2>
          <small className="app-muted">
            {view.summary.withSuccessor} of {view.summary.totalRoles} role(s) have an identified successor.
            Continuity % is derived from successor coverage and handoff stage — not a recorded team goal.
          </small>
        </div>
        <strong style={{ fontSize: "2rem" }}>{pct(readiness.score)}</strong>
      </header>
      <div style={{ display: "grid", gap: 8, marginTop: 12 }}>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
          <span className="app-muted">Successor coverage</span>
          <span className="mini-probability" aria-hidden="true">
            <i style={{ width: `${Math.max(2, readiness.coverage * 100)}%` }} />
          </span>
          <small className="app-muted" style={{ textAlign: "right" }}>{pct(readiness.coverage)}</small>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "160px 1fr 48px", gap: 8, alignItems: "center" }}>
          <span className="app-muted">Handoff progress</span>
          <span className="mini-probability" aria-hidden="true">
            <i style={{ width: `${Math.max(2, readiness.progress * 100)}%` }} />
          </span>
          <small className="app-muted" style={{ textAlign: "right" }}>{pct(readiness.progress)}</small>
        </div>
      </div>
      {readiness.recommendations.length > 0 ? (
        <div style={{ marginTop: 12 }}>
          <strong className="app-muted">Next steps</strong>
          <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {readiness.recommendations.map((rec) => (
              <li key={rec}>{rec}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const { summary } = view;
  const tiles = [
    { label: "Roles tracked", value: String(summary.totalRoles) },
    { label: "With successor", value: String(summary.withSuccessor) },
    { label: "Without successor", value: String(summary.withoutSuccessor) },
    { label: "Continuity score", value: pct(summary.continuityScore) },
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

function RoleBoard({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.summary.totalRoles === 0) {
    return (
      <EmptyState
        badge="No roles yet"
        badgeTone="setup"
        title="Add your first leadership role"
        description="Officer positions, subsystem leads, mentors — track who holds each role and who's next."
      >
        <Button as="a" variant="primary" href="#add-role">
          Add a role
        </Button>
      </EmptyState>
    );
  }
  return (
    <Panel>
      <h2 style={{ marginTop: 0 }}>Role handoff board</h2>
      <ul style={{ listStyle: "none", padding: 0, display: "grid", gap: 10 }}>
        {view.roles.map((role) => (
          <li
            key={role.id}
            style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "wrap" }}
          >
            <div>
              <strong>{role.roleTitle}</strong>
              <small className="app-muted" style={{ display: "block" }}>
                {leadershipCategoryLabel(role.category)} · Holder: {role.holderName}
              </small>
              <small className="app-muted">
                Successor: {role.successorName || "not identified"}
                {role.targetHandoffDate ? ` · target ${role.targetHandoffDate}` : ""}
              </small>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <select
                value={role.handoffStatus}
                disabled={busy}
                onChange={(event) =>
                  mutate({
                    action: "update-status",
                    roleId: role.id,
                    handoffStatus: event.target.value,
                    successorName: role.successorName,
                  })
                }
              >
                {LEADERSHIP_STATUS_VALUES.map((status) => (
                  <option key={status} value={status}>
                    {leadershipHandoffStatusLabel(status)}
                  </option>
                ))}
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(`Delete "${role.roleTitle}"?`)) {
                    mutate({ action: "delete-role", roleId: role.id });
                  }
                }}
              >
                Delete
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

function CreateRoleForm({
  busy,
  mutate,
}: {
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const empty = useMemo(
    () => ({
      roleTitle: "",
      category: "leadership" as LeadershipCategory,
      holderName: "",
      successorName: "",
      handoffStatus: "not_started" as LeadershipHandoffStatus,
      targetHandoffDate: "",
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
      id="add-role"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.roleTitle.trim() || !form.holderName.trim()) return;
        mutate({
          action: "create-role",
          roleTitle: form.roleTitle,
          category: form.category,
          holderName: form.holderName,
          successorName: form.successorName || undefined,
          handoffStatus: form.handoffStatus,
          targetHandoffDate: form.targetHandoffDate || undefined,
          notes: form.notes || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add role</h2>
      <FormGrid min={160}>
        <FormRow label="Role title">
          <input value={form.roleTitle} onChange={set("roleTitle")} placeholder="Drivetrain lead" required />
        </FormRow>
        <FormRow label="Category">
          <select value={form.category} onChange={set("category")}>
            {LEADERSHIP_CATEGORY_VALUES.map((category) => (
              <option key={category} value={category}>
                {leadershipCategoryLabel(category)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Current holder">
          <input value={form.holderName} onChange={set("holderName")} placeholder="Name" required />
        </FormRow>
        <FormRow label="Successor (optional)">
          <input value={form.successorName} onChange={set("successorName")} placeholder="Name" />
        </FormRow>
        <FormRow label="Handoff status">
          <select value={form.handoffStatus} onChange={set("handoffStatus")}>
            {LEADERSHIP_STATUS_VALUES.map((status) => (
              <option key={status} value={status}>
                {leadershipHandoffStatusLabel(status)}
              </option>
            ))}
          </select>
        </FormRow>
        <FormRow label="Target handoff date (optional)">
          <input type="date" value={form.targetHandoffDate} onChange={set("targetHandoffDate")} />
        </FormRow>
      </FormGrid>
      <FormRow label="Notes (optional)">
        <textarea value={form.notes} onChange={set("notes")} rows={2} />
      </FormRow>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.roleTitle.trim() || !form.holderName.trim()}>
          Add role
        </Button>
      </div>
    </Panel>
  );
}
