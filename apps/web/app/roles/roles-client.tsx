"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Button, EmptyState, PageHeader } from "../../components/ui";
import { isFilled, subteamLabel } from "../../lib/roles";
import { SUBTEAMS, type RolesView } from "../../lib/roles/compute-roles";
import type { Subteam, TeamRole } from "../../lib/roles/types";
import { hubHref } from "../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<RolesView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

function isRolesView(value: unknown): value is RolesView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

function rolesCacheOrg(data: RolesView, orgHint: string): string {
  switch (data.status) {
    case "live":
      return data.orgId.trim() || orgHint;
    case "setup_required":
      return data.orgId?.trim() || orgHint;
    default: {
      data satisfies never;
      return orgHint;
    }
  }
}

async function persistRolesSnapshot(orgHint: string, seasonHint: string, data: RolesView): Promise<void> {
  const cacheOrg = rolesCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  const seasonKey = String(data.seasonYear);
  try {
    await putFeatureSnapshot("roles", cacheOrg, data, seasonHint || seasonKey);
    if (!orgHint) await putFeatureSnapshot("roles", "_", data, seasonHint || seasonKey);
  } catch {
    // Live Season roles already painted; IndexedDB is best-effort.
  }
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function RolesClient() {
  const [view, setView] = useState<RolesView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [failureStatus, setFailureStatus] = useState<number | null>(null);
  const [failureMessage, setFailureMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [season, setSeason] = useState<number | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<RolesView | null>(null);
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
      const cached = await getFeatureSnapshot<RolesView>("roles", orgHint || "_", seasonHint);
      if (!viewRef.current && cached?.data && isRolesView(cached.data)) {
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
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    try {
      const query = new URLSearchParams();
      if (orgHint) query.set("orgId", orgHint);
      if (seasonQuery) query.set("season", String(seasonQuery));
      const response = await fetch(`/api/roles${query.toString() ? `?${query.toString()}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setFailureStatus(response.status);
        setFailureMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        void clearFeatureSnapshot("roles", orgHint || "_", seasonHint);
        if (orgHint) void clearFeatureSnapshot("roles", orgHint, seasonHint);
        return;
      }
      if (!response.ok || !isRolesView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Season roles. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setFailureStatus(response.status);
        setFailureMessage(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "",
        );
        setFetchFailed(true);
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      setFromCache(false);
      setCachedAt(null);
      await persistRolesSnapshot(orgHint, seasonHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Season roles. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      })
        .then(async (response) => {
          const data = (await response.json()) as RolesView | { error?: string };
          if (!response.ok || !isRolesView(data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
          setFromCache(false);
          void persistRolesSnapshot(orgId, String(data.seasonYear), data);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  const related = (
    <nav className="product-hub-related" aria-label="Related people tools">
      <Button as="a" variant="secondary" href={hubHref("/team", "attendance", orgId)}>
        Attendance
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/training", orgId)}>
        Training
      </Button>
      <Button as="a" variant="secondary" href={withOrgHref("/subteams", orgId)}>
        Subteams
      </Button>
    </nav>
  );

  if (!view) {
    const copy = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: failureStatus,
            message: failureMessage,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: failureMessage || "A network or server issue prevented loading. Try again.",
          },
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          breadcrumbs="Team / Roles"
          title="Roles & Responsibilities"
          description="Map every role — leads and positions — to a person and what they own."
        >
          {related}
        </PageHeader>
        <OfflineBanner feature="Season roles" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          title={copy ? copy.title : "Loading…"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : copy?.showRetry ? (
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
            breadcrumbs="Team / Roles"
            title="Roles & Responsibilities"
            description="Map every role — leads and positions — to a person and what they own."
          >
            {related}
          </PageHeader>
          <OfflineBanner feature="Season roles" fromCache={fromCache} cachedAt={cachedAt} />
          <EmptyState soft badge="Needs setup" badgeTone="setup" title={view.message}>
            {view.steps[0] ? (
              <Button as="a" variant="primary" href={view.steps[0].href}>
                {view.steps[0].label}
              </Button>
            ) : null}
          </EmptyState>
        </main>
      );
    case "live":
      break;
    default: {
      const data: never = view;
      return data satisfies never;
    }
  }

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs="Team / Roles"
        title="Roles & Responsibilities"
        description="Map every role — leads and positions — to a person and what they own. Coverage gaps are surfaced so no responsibility falls through the cracks mid-season."
      >
        {related}
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

      <OfflineBanner feature="Season roles" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <SummaryTiles view={view} />
        {view.summary.openRoles.length > 0 ? <OpenRoles view={view} /> : null}
        {view.unlinkedHolders.length > 0 ? <UnlinkedHolders view={view} /> : null}
        {view.canManage ? (
          <>
            <AddRoleForm busy={busy} members={view.members} mutate={mutate} />
            <RoleList view={view} busy={busy} mutate={mutate} />
          </>
        ) : (
          <>
            <p className="app-muted">
              Roles are set by an owner or admin. You can see who holds what, but not change it.
            </p>
            <RoleList view={view} busy readOnly mutate={mutate} />
          </>
        )}
      </div>
    </main>
  );
}

function SummaryTiles({ view }: { view: LiveView }) {
  const s = view.summary;
  const tiles = [
    { label: "Roles", value: String(s.total) },
    { label: "Filled", value: `${s.filled}/${s.total}` },
    { label: "Coverage", value: pct(s.coverage) },
    { label: "Leads staffed", value: `${s.leadsFilled}/${s.leadsTotal}` },
  ];
  return (
    <section className="app-card soft-panel">
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))", gap: 12 }}>
        {tiles.map((tile) => (
          <div key={tile.label}>
            <strong style={{ fontSize: "1.6rem", display: "block" }}>{tile.value}</strong>
            <span className="app-muted">{tile.label}</span>
          </div>
        ))}
      </div>
      {s.bySubteam.length > 0 ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}>
          {s.bySubteam.map((row) => (
            <span
              key={row.subteam}
              className={`app-badge ${row.filled === row.total ? "good" : row.filled === 0 ? "setup" : "demo"}`}
            >
              {subteamLabel(row.subteam)}: {row.filled}/{row.total}
            </span>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function OpenRoles({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel" style={{ borderLeft: "3px solid #b26a00" }}>
      <h2 style={{ marginTop: 0 }}>Unfilled roles</h2>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.summary.openRoles.map((role) => (
          <li key={role.id}>
            <strong>{role.title}</strong>
            {role.isLead ? <span style={{ color: "#c9a900" }}> ★ lead</span> : null}
            <small className="app-muted"> · {subteamLabel(role.subteam)}</small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddRoleForm({
  busy,
  members,
  mutate,
}: {
  busy: boolean;
  members: LiveView["members"];
  mutate: Mutate;
}) {
  const empty = useMemo(
    () => ({ title: "", subteam: "mechanical" as Subteam, holderUserId: "", isLead: false, responsibilities: "" }),
    [],
  );
  const [form, setForm] = useState(empty);
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
    setForm((prev) => ({ ...prev, [key]: event.target.value }));

  return (
    <form
      className="app-card soft-panel"
      onSubmit={(event) => {
        event.preventDefault();
        if (!form.title.trim()) return;
        mutate({
          action: "create-role",
          title: form.title,
          subteam: form.subteam,
          holderUserId: form.holderUserId || null,
          isLead: form.isLead,
          responsibilities: form.responsibilities || undefined,
        });
        setForm(empty);
      }}
      style={{ display: "grid", gap: 10 }}
    >
      <h2 style={{ margin: 0 }}>Add role</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        <label style={{ display: "grid", gap: 4, gridColumn: "1 / -1" }}>
          <span className="app-muted">Role title</span>
          <input value={form.title} onChange={set("title")} placeholder="Drivetrain lead" required />
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Subteam</span>
          <select value={form.subteam} onChange={set("subteam")}>
            {SUBTEAMS.map((subteam) => (
              <option key={subteam} value={subteam}>
                {subteamLabel(subteam)}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Held by</span>
          <select value={form.holderUserId} onChange={set("holderUserId")}>
            <option value="">Unassigned</option>
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        <label style={{ display: "flex", gap: 6, alignItems: "center", alignSelf: "end" }}>
          <input type="checkbox" checked={form.isLead} onChange={(e) => setForm((prev) => ({ ...prev, isLead: e.target.checked }))} />
          <span className="app-muted">Lead role</span>
        </label>
      </div>
      <label style={{ display: "grid", gap: 4 }}>
        <span className="app-muted">Responsibilities (optional)</span>
        <input value={form.responsibilities} onChange={set("responsibilities")} placeholder="Owns drivetrain design, build, and driver practice" />
      </label>
      <div>
        <Button variant="primary" type="submit" disabled={busy || !form.title.trim()}>
          Add role
        </Button>
      </div>
    </form>
  );
}

function UnlinkedHolders({ view }: { view: LiveView }) {
  return (
    <section className="app-card soft-panel" style={{ borderLeft: "3px solid #b26a00" }}>
      <h2 style={{ marginTop: 0 }}>Holders not linked to a member</h2>
      <p className="app-muted">
        These names do not match exactly one person on the roster, so they stay unlinked.
        Retype the name the way it appears on the roster, or leave it if the holder is a mentor,
        parent volunteer, or alum.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 6 }}>
        {view.unlinkedHolders.map((holder) => (
          <li key={holder.id}>
            <strong>{holder.holderName}</strong>
            <small className="app-muted">
              {" "}
              · {holder.title} ·{" "}
              {holder.holderLink === "ambiguous"
                ? "more than one member has this name"
                : "no roster match"}
            </small>
          </li>
        ))}
      </ul>
    </section>
  );
}

function RoleList({
  view,
  busy,
  mutate,
  readOnly = false,
}: {
  view: LiveView;
  busy: boolean;
  mutate: Mutate;
  readOnly?: boolean;
}) {
  if (view.roles.length === 0) {
    return (
      <section className="app-card soft-panel">
        <span className="app-badge setup">No roles yet</span>
        <h2>Map your team</h2>
        <p className="app-muted">Add the roles your team needs this season, then assign each to a person.</p>
      </section>
    );
  }
  return (
    <section style={{ display: "grid", gap: 12 }}>
      {view.roles.map((role) => (
        <RoleCard
          key={role.id}
          role={role}
          members={view.members}
          busy={busy}
          mutate={mutate}
          readOnly={readOnly}
        />
      ))}
    </section>
  );
}

function RoleCard({
  role,
  members,
  busy,
  mutate,
  readOnly = false,
}: {
  role: TeamRole;
  members: LiveView["members"];
  busy: boolean;
  mutate: Mutate;
  readOnly?: boolean;
}) {
  const filled = isFilled(role);
  return (
    <article className="app-card soft-panel" style={{ borderLeft: filled ? "3px solid #1f7a3d" : "3px solid #b26a00" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge demo">{subteamLabel(role.subteam)}</span>{" "}
          {role.isLead ? <span className="app-badge" style={{ background: "#c9a900", color: "#fff" }}>Lead</span> : null}
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>{role.title}</h2>
          {role.responsibilities ? <small className="app-muted">{role.responsibilities}</small> : null}
        </div>
      </header>
      <footer style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", marginTop: 10 }}>
        <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center", flex: "1 1 200px" }}>
          Held by
          <select
            value={role.holderUserId ?? ""}
            disabled={busy || readOnly}
            aria-label={`Holder of ${role.title}`}
            onChange={(event) => {
              mutate({
                action: "update-role",
                roleId: role.id,
                holderUserId: event.target.value || null,
                holderName: null,
              });
            }}
            style={{ flex: 1 }}
          >
            <option value="">Unassigned</option>
            {role.holderName && !role.holderUserId ? (
              <option value="" disabled>
                Legacy: {role.holderName}
              </option>
            ) : null}
            {members.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.name}
              </option>
            ))}
          </select>
        </label>
        {role.holderName && !role.holderUserId ? (
          <small className="app-muted">
            {role.holderLink === "ambiguous" ? "Name shared by more than one member" : "Not on the roster"}
          </small>
        ) : null}
        {readOnly ? null : (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete "${role.title}"?`)) mutate({ action: "delete-role", roleId: role.id });
            }}
          >
            Delete
          </button>
        )}
      </footer>
    </article>
  );
}
