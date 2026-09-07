"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isFilled, subteamLabel } from "../../lib/roles";
import { SUBTEAMS, type RolesView } from "../../lib/roles/compute-roles";
import type { RoleMember, Subteam, TeamRole } from "../../lib/roles/types";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type LiveView = Extract<RolesView, { status: "live" }>;
type Mutate = (payload: Record<string, unknown>) => void;

/** Sentinel option for "held by someone who is not on the roster" (free text). */
const OTHER_HOLDER = "__other__";

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

  const orgId = view && "orgId" in view ? view.orgId : null;

  const load = useCallback((seasonOverride?: number) => {
    setFetchFailed(false);
    setFailureStatus(null);
    setFailureMessage("");
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const seasonQuery = seasonOverride ?? (params.get("season") ? Number(params.get("season")) : null);
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (seasonQuery) query.set("season", String(seasonQuery));
    void fetch(`/api/roles${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as RolesView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setFailureStatus(response.status);
          setFailureMessage("error" in data && data.error ? data.error : "");
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

  const mutate = useCallback<Mutate>(
    (payload) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      void fetch("/api/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, seasonYear: season ?? undefined, ...payload }),
      })
        .then(async (response) => {
          const data = (await response.json()) as RolesView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "Something went wrong.");
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setError("Network error — please try again."))
        .finally(() => setBusy(false));
    },
    [orgId, season, busy],
  );

  return (
    <main className="module-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Team / Roles</span>
          <h1>Roles &amp; Responsibilities</h1>
          <p>
            Map every role — leads and positions — to a person and what they own. Coverage gaps are surfaced so no
            responsibility falls through the cracks mid-season.
          </p>
        </div>
        {view?.status === "live" && view.seasons.length > 0 ? (
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
      </header>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        (() => {
          const copy = loadFailureCopy(
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
              message:
                failureMessage || "A network or server issue prevented loading. Try again.",
            },
          );
          return (
            <section className="app-card soft-panel">
              <h2>{copy.title}</h2>
              <p className="app-muted">{copy.description}</p>
              {copy.primary ? (
                <a className="app-button" href={copy.primary.href}>
                  {copy.primary.label}
                </a>
              ) : null}
              {copy.showRetry ? (
                <button type="button" className="app-button secondary" onClick={() => load()}>
                  Retry
                </button>
              ) : null}
            </section>
          );
        })()
      ) : view == null ? (
        <section className="app-card soft-panel">
          <h2>Loading…</h2>
          <p className="app-muted">Checking your workspace.</p>
        </section>
      ) : view.status === "setup_required" ? (
        <section className="app-card soft-panel">
          <span className="app-badge setup">Setup required</span>
          <h2>{view.message}</h2>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href} aria-label={`Open ${step.label}`}>Open</a>
              </li>
            ))}
          </ol>
        </section>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <SummaryTiles view={view} />
          {view.summary.openRoles.length > 0 ? <OpenRoles view={view} /> : null}
          {view.canManage ? (
            <AddRoleForm members={view.members} busy={busy} mutate={mutate} />
          ) : (
            <p className="app-muted" style={{ margin: 0 }}>
              Only an owner or admin can add roles or change who holds them.
            </p>
          )}
          <RoleList view={view} busy={busy} mutate={mutate} />
        </div>
      )}
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

/**
 * Member picker: a roster select with "Unassigned" and an "outside the roster"
 * escape hatch that reveals a free-text field (a parent mentor, an alumni
 * volunteer). Real members are always the first choice.
 */
function HolderPicker({
  members,
  holderUserId,
  holderName,
  disabled,
  label,
  onChange,
}: {
  members: RoleMember[];
  holderUserId: string | null;
  holderName: string;
  disabled: boolean;
  label: string;
  onChange: (next: { holderUserId: string | null; holderName: string }) => void;
}) {
  const knownMember = holderUserId != null && members.some((member) => member.userId === holderUserId);
  const selectValue = knownMember ? holderUserId : holderName.trim() ? OTHER_HOLDER : "";
  const [otherOpen, setOtherOpen] = useState(selectValue === OTHER_HOLDER);

  return (
    <div style={{ display: "grid", gap: 6, flex: "1 1 220px" }}>
      <select
        value={selectValue}
        disabled={disabled}
        aria-label={label}
        onChange={(event) => {
          const value = event.target.value;
          if (value === OTHER_HOLDER) {
            setOtherOpen(true);
            onChange({ holderUserId: null, holderName });
            return;
          }
          setOtherOpen(false);
          if (!value) {
            onChange({ holderUserId: null, holderName: "" });
            return;
          }
          onChange({ holderUserId: value, holderName: "" });
        }}
      >
        <option value="">Unassigned</option>
        {members.map((member) => (
          <option key={member.userId} value={member.userId}>
            {member.name}
            {member.role === "owner" || member.role === "admin" ? ` (${member.role})` : ""}
          </option>
        ))}
        <option value={OTHER_HOLDER}>Someone not on the roster…</option>
      </select>
      {otherOpen || selectValue === OTHER_HOLDER ? (
        <input
          value={holderName}
          disabled={disabled}
          placeholder="Name (not a Vantage member)"
          aria-label={`${label} (name)`}
          onChange={(event) => onChange({ holderUserId: null, holderName: event.target.value })}
        />
      ) : null}
    </div>
  );
}

function AddRoleForm({ members, busy, mutate }: { members: RoleMember[]; busy: boolean; mutate: Mutate }) {
  const empty = useMemo(
    () => ({
      title: "",
      subteam: "mechanical" as Subteam,
      holderUserId: null as string | null,
      holderName: "",
      isLead: false,
      responsibilities: "",
    }),
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
          holderUserId: form.holderUserId ?? undefined,
          holderName: form.holderUserId ? undefined : form.holderName || undefined,
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
        <div style={{ display: "grid", gap: 4 }}>
          <span className="app-muted">Held by</span>
          <HolderPicker
            members={members}
            holderUserId={form.holderUserId}
            holderName={form.holderName}
            disabled={busy}
            label="Held by"
            onChange={(next) => setForm((prev) => ({ ...prev, ...next }))}
          />
        </div>
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
        <button type="submit" className="app-button" disabled={busy || !form.title.trim()}>
          Add role
        </button>
      </div>
    </form>
  );
}

function RoleList({ view, busy, mutate }: { view: LiveView; busy: boolean; mutate: Mutate }) {
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
        <RoleCard key={role.id} role={role} members={view.members} canManage={view.canManage} busy={busy} mutate={mutate} />
      ))}
    </section>
  );
}

function RoleCard({
  role,
  members,
  canManage,
  busy,
  mutate,
}: {
  role: TeamRole;
  members: RoleMember[];
  canManage: boolean;
  busy: boolean;
  mutate: Mutate;
}) {
  const filled = isFilled(role);
  const [draftName, setDraftName] = useState(role.holderUserId ? "" : (role.holderName ?? ""));

  useEffect(() => {
    setDraftName(role.holderUserId ? "" : (role.holderName ?? ""));
  }, [role.holderUserId, role.holderName]);

  const commitName = () => {
    const next = draftName.trim();
    const current = role.holderUserId ? "" : (role.holderName ?? "");
    if (next !== current) mutate({ action: "update-role", roleId: role.id, holderUserId: null, holderName: next });
  };

  return (
    <article className="app-card soft-panel" style={{ borderLeft: filled ? "3px solid #1f7a3d" : "3px solid #b26a00" }}>
      <header style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start" }}>
        <div>
          <span className="app-badge demo">{subteamLabel(role.subteam)}</span>{" "}
          {role.isLead ? <span className="app-badge" style={{ background: "#c9a900", color: "#fff" }}>Lead</span> : null}
          <h2 style={{ margin: "4px 0 0", fontSize: "1.1rem" }}>{role.title}</h2>
          {role.responsibilities ? <small className="app-muted">{role.responsibilities}</small> : null}
        </div>
        <span className="app-muted" style={{ whiteSpace: "nowrap" }}>
          {filled ? (
            <>
              Held by <strong>{role.holderName}</strong>
              {!role.holderUserId ? <small> (not on roster)</small> : null}
            </>
          ) : (
            "Unfilled"
          )}
        </span>
      </header>
      {canManage ? (
        <footer style={{ display: "flex", gap: 10, alignItems: "flex-start", flexWrap: "wrap", marginTop: 10 }}>
          <span className="app-muted" style={{ alignSelf: "center" }}>
            Held by
          </span>
          <HolderPicker
            members={members}
            holderUserId={role.holderUserId}
            holderName={draftName}
            disabled={busy}
            label={`Holder of ${role.title}`}
            onChange={(next) => {
              if (next.holderUserId) {
                setDraftName("");
                mutate({ action: "update-role", roleId: role.id, holderUserId: next.holderUserId, holderName: "" });
                return;
              }
              if (!next.holderName && role.holderUserId) {
                // "Unassigned" picked while a member held it: clear the link now.
                setDraftName("");
                mutate({ action: "update-role", roleId: role.id, holderUserId: null, holderName: "" });
                return;
              }
              setDraftName(next.holderName);
              if (!next.holderName && role.holderName) {
                mutate({ action: "update-role", roleId: role.id, holderUserId: null, holderName: "" });
              }
            }}
          />
          {!role.holderUserId ? (
            <button type="button" className="app-button secondary" disabled={busy} onClick={commitName}>
              Save name
            </button>
          ) : null}
          <button
            type="button"
            className="text-button"
            disabled={busy}
            style={{ marginLeft: "auto" }}
            onClick={() => {
              if (window.confirm(`Delete "${role.title}"?`)) mutate({ action: "delete-role", roleId: role.id });
            }}
          >
            Delete
          </button>
        </footer>
      ) : null}
    </article>
  );
}
