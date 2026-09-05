"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Icon } from "../../components/app-shell";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { ChemistryView } from "../../lib/chemistry/load-chemistry";
import {
  classifyChemistryShell,
  chemistryShellCopy,
  formatChemistryMetric,
  shouldShowChemistrySummaryTiles,
  type ChemistryShellKind,
} from "../../lib/chemistry/chemistry-related";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./chemistry.css";

type Me = { orgId?: string | null; orgName?: string | null; teamNumber?: number | null };

function ChemistryShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: ChemistryShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session offers sign-in over Retry. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const copy = chemistryShellCopy(shell);
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error,
          },
        )
      : null;
  const commandHref = hubHref("/competition", "command", orgId);
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <main className="module-page chem-page chem-workbench soft-gate">
      <PageHeader
        breadcrumbs="Competition / Chemistry"
        title="Alliance chemistry"
        description="Score how well 2–3 robots complement each other from synced TBA/Statbotics seats — never DEMO chemistry scores."
      />
      {children}
      <EmptyState
        soft
        className="chem-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No chemistry score yet"
                : copy.badge
        }
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : "/workspace"}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? <a className="app-button" href={teamDataHref}>Sync event metrics</a> : null}
      </EmptyState>
    </main>
  );
}

export default function ChemistryClient(_props: { embedded?: boolean } = {}) {
  const [orgId, setOrgId] = useState("");
  const [view, setView] = useState<ChemistryView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  // Promotion to the ONE pick list: which team keys are in flight, and the last outcome.
  const [saving, setSaving] = useState<string>("");
  const [saveMessage, setSaveMessage] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId") ?? "";
    const teams = new URLSearchParams(window.location.search).get("teams") ?? "";
    if (teams) setDraft(teams);
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setOrgId(fromUrl || data.orgId || "");
      })
      .catch(() => {
        setLoading(false);
      });
  }, []);

  const load = useCallback(
    async (id: string, teams?: string) => {
      if (!id) {
        setLoading(false);
        setFetchFailed(false);
        return;
      }
      setLoading(true);
      setFetchFailed(false);
      const params = new URLSearchParams({ orgId: id });
      const list = (teams ?? draft).trim();
      if (list) params.set("teams", list);
      try {
        const response = await fetch(`/api/chemistry?${params}`);
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          setError(body.error ?? "Could not load chemistry");
          setErrorStatus(response.status);
          setView(null);
          setFetchFailed(true);
          setLoading(false);
          return;
        }
        const data = (await response.json()) as ChemistryView;
        setView(data);
        if (!list && data.teamKeys.length) {
          setDraft(data.teamKeys.map((key) => key.replace(/^frc/i, "")).join(", "));
        }
        setError("");
        setErrorStatus(null);
        setFetchFailed(false);
      } catch {
        setError("Could not load chemistry");
        setErrorStatus(null);
        setView(null);
        setFetchFailed(true);
      } finally {
        setLoading(false);
      }
    },
    [draft],
  );

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    void load(orgId);
  }, [orgId]);  

  /**
   * Promote chemistry candidates onto the ONE pick list. Idempotent server-side, so a double tap
   * updates the same entry instead of duplicating it.
   */
  const saveToPickList = useCallback(
    async (teamKeys: string[], bucket: "first_pick" | "second_pick" | "unranked") => {
      if (!orgId || !teamKeys.length) return;
      const busyKey = teamKeys.join(",");
      setSaving(busyKey);
      setSaveMessage("");
      try {
        const response = await fetch("/api/chemistry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            orgId,
            action: "promote-partner-fit",
            teamKeys,
            bucket,
            selection: draft
              .split(/[,\s]+/)
              .map((part) => part.trim())
              .filter(Boolean),
          }),
        });
        const data = (await response.json()) as ChemistryView & {
          error?: string;
          promotion?: { message: string; pickListId?: string };
        };
        if (!response.ok) {
          setSaveMessage(data.error ?? "Could not save to the pick list.");
          return;
        }
        setView(data);
        setSaveMessage(data.promotion?.message ?? "Saved to the pick list.");
      } catch {
        setSaveMessage("Network error — nothing was saved to the pick list.");
      } finally {
        setSaving("");
      }
    },
    [draft, orgId],
  );

  function scoreTone(score: number | null) {
    if (score == null) return "";
    if (score >= 75) return "good";
    if (score >= 55) return "ok";
    return "risk";
  }

  const chemistry = view?.chemistry ?? null;
  const hasScore = chemistry?.score != null;
  const seatCount = view?.teamKeys.length ?? 0;
  const shell = classifyChemistryShell({
    loading,
    fetchFailed,
    status: view?.status ?? (!orgId && !loading ? "setup_required" : null),
    orgId: view?.orgId ?? (orgId || null),
    eventKey: view?.eventKey ?? null,
    seatCount,
    hasScore,
  });

  // Full Soft-UI shells when the surface cannot score yet (setup / error / initial empty without event).
  if (shell === "loading" || shell === "error" || shell === "setup") {
    return (
      <ChemistryShell
        orgId={view?.orgId ?? (orgId || null)}
        shell={shell}
        errorStatus={errorStatus}
        error={
          shell === "error"
            ? error || "Could not load alliance chemistry."
            : shell === "setup" && view?.message
              ? `${view.message} Scores stay blank until real event metrics exist — never DEMO chemistry scores.`
              : undefined
        }
        onRetry={
          shell === "error" && orgId
            ? () => {
                void load(orgId);
              }
            : undefined
        }
      />
    );
  }

  const showTiles = shouldShowChemistrySummaryTiles(seatCount, hasScore);
  const emptyCopy = chemistryShellCopy("empty");

  return (
    <main className="module-page chem-page chem-workbench">
      <PageHeader
        breadcrumbs="Competition / Chemistry"
        title="Alliance chemistry"
        description={
          view?.eventName
            ? `${view.eventName} · MODEL fit from synced EPA and scout reliability — never DEMO chemistry scores.`
            : "Score how well 2–3 robots complement each other — roles, EPA balance, scout reliability. Labeled MODEL, never a TBA pick fact."
        }
      >
        <div className="chem-heading">
        </div>
      </PageHeader>

      {error ? <p className="edc-banner error">{error}</p> : null}
      {saveMessage ? (
        <p className="edc-banner" role="status">
          {saveMessage}
        </p>
      ) : null}

      {showTiles && chemistry ? (
        <div className="chem-kpis" aria-label="Chemistry counts">
          <article>
            <strong>{formatChemistryMetric(seatCount, true)}</strong>
            <small>alliance seats</small>
          </article>
          <article>
            <strong>{formatChemistryMetric(chemistry.score, true)}</strong>
            <small>chemistry / 100</small>
          </article>
          <article>
            <strong>
              {chemistry.totalEpa != null ? String(Math.round(chemistry.totalEpa * 10) / 10) : "—"}
            </strong>
            <small>total EPA</small>
          </article>
        </div>
      ) : null}

      <Panel
        as="form"
        className="chem-compose chem-panel"
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void load(orgId, draft);
        }}
      >
        <header>
          <div className="edc-card-title">
            <span
              className="edc-icon"
              style={{ ["--tone" as string]: "#1457d9", ["--tone-bg" as string]: "#e4ecfc" }}
            >
              <Icon name="users" />
            </span>
            <div>
              <h2>Alliance seats</h2>
              <p>
                {view?.eventName
                  ? `${view.eventName} · defaults to your next alliance when blank`
                  : "Set an active event to pull next-alliance defaults"}
              </p>
            </div>
          </div>
        </header>
        <div className="chem-form">
          <FormRow label="Team numbers (2–3)">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="254, 1678, 118"
              aria-label="Alliance team numbers"
            />
          </FormRow>
          <button className="app-button" type="submit" disabled={loading || !orgId}>
            Score chemistry
          </button>
        </div>
      </Panel>

      {hasScore && chemistry ? (
        <section className="chem-result">
          <article className={`edc-card chem-score ${scoreTone(chemistry.score)}`}>
            <header>
              <div className="edc-card-title">
                <span
                  className="edc-icon"
                  style={{ ["--tone" as string]: "#1457d9", ["--tone-bg" as string]: "#e4ecfc" }}
                >
                  <Icon name="bolt" />
                </span>
                <div>
                  <h2>Chemistry score</h2>
                  <p>MODEL {chemistry.modelVersion}</p>
                </div>
              </div>
            </header>
            <div className="edc-prob">
              <strong>{chemistry.score ?? "—"}</strong>
              <span>Compatibility / 100</span>
            </div>
            <div className="chem-metrics">
              <div>
                <strong>{chemistry.totalEpa ?? "—"}</strong>
                <span>Total EPA</span>
              </div>
              <div>
                <strong>{chemistry.complementarity ?? "—"}</strong>
                <span>Role fit</span>
              </div>
              <div>
                <strong>{chemistry.reliabilityBlend ?? "—"}</strong>
                <span>Scout reliability</span>
              </div>
              <div>
                <strong>{chemistry.foulRisk}</strong>
                <span>Foul risk</span>
              </div>
            </div>
            <p className="edc-caveat">{chemistry.caveats[0] ?? chemistry.caveat}</p>
            <p className="edc-muted">
              Promote writes these seats onto the same pick_lists row the pick desk, Pick Clock,
              and Draft board read — MODEL partner fit only, never DEMO scores.
            </p>
            <div className="edc-header-actions">
              <button
                type="button"
                className="app-button"
                disabled={Boolean(saving) || !view?.teamKeys.length}
                onClick={() => void saveToPickList(view?.teamKeys ?? [], "first_pick")}
              >
                {saving === (view?.teamKeys ?? []).join(",")
                  ? "Promoting…"
                  : "Promote partner fit"}
              </button>
            </div>
          </article>

          <article className="edc-card">
            <header>
              <div className="edc-card-title">
                <span
                  className="edc-icon"
                  style={{ ["--tone" as string]: "#0f766e", ["--tone-bg" as string]: "#ccfbf1" }}
                >
                  <Icon name="target" />
                </span>
                <div>
                  <h2>Roles</h2>
                  <p>Primary phase lean from event EPA shares</p>
                </div>
              </div>
            </header>
            <ul className="chem-roles">
              {chemistry.roles.map((role) => (
                <li key={role.teamKey}>
                  <strong>{role.teamKey.replace(/^frc/i, "")}</strong>
                  <span className="edc-tags">
                    <span>{role.primaryRole}</span>
                  </span>
                  <p className="edc-muted">{role.evidence}</p>
                </li>
              ))}
            </ul>
          </article>

          <article className="edc-card">
            <header>
              <div className="edc-card-title">
                <span
                  className="edc-icon"
                  style={{ ["--tone" as string]: "#15803d", ["--tone-bg" as string]: "#dcfce7" }}
                >
                  <Icon name="stats" />
                </span>
                <div>
                  <h2>Strengths & risks</h2>
                  <p>Cited from metrics + scout ops</p>
                </div>
              </div>
            </header>
            <div className="chem-split">
              <div>
                <h3>Strengths</h3>
                <ul>
                  {chemistry.strengths.length ? (
                    chemistry.strengths.map((s) => <li key={s}>{s}</li>)
                  ) : (
                    <li className="edc-muted">None flagged yet</li>
                  )}
                </ul>
              </div>
              <div>
                <h3>Risks</h3>
                <ul>
                  {chemistry.risks.length ? (
                    chemistry.risks.map((s) => <li key={s}>{s}</li>)
                  ) : (
                    <li className="edc-muted">None flagged yet</li>
                  )}
                </ul>
              </div>
            </div>
          </article>
        </section>
      ) : (
        <EmptyState
          soft
          className="chem-empty"
          badge={emptyCopy.badge}
          badgeTone="setup"
          title={view?.message ?? emptyCopy.title}
          description={
            view?.status === "empty"
              ? `${view.message} Cross-check Strategy, Pick desk, and Draft — never DEMO chemistry scores.`
              : emptyCopy.description
          }
        >
        </EmptyState>
      )}

      {view?.teams.length ? (
        <section className="chem-teams">
          <h2>Seat details</h2>
          <div className="chem-team-grid">
            {view.teams.map((team) => (
              <article key={team.teamKey} className="edc-card">
                <strong>
                  {team.teamNumber ?? team.teamKey}
                  {team.nickname ? ` · ${team.nickname}` : ""}
                </strong>
                <p className="edc-muted">
                  EPA {team.epaTotal != null ? Math.round(team.epaTotal * 10) / 10 : "—"}
                  {team.source ? ` · ${team.source}` : ""}
                </p>
                <p className="edc-muted">
                  Scout n={team.scoutSample}
                  {team.reliability != null ? ` · reliability ${Math.round(team.reliability)}%` : ""}
                  {team.foulRate != null ? ` · fouls ~${Math.round(team.foulRate * 10) / 10}` : ""}
                </p>
                {team.archetypes.length ? (
                  <div className="edc-tags">
                    {team.archetypes.map((a) => (
                      <span key={a}>{a}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view?.suggestions.length ? (
        <section className="chem-suggest">
          <h2>Try high-EPA seats</h2>
          <p className="edc-muted">
            Event metrics you can add to the scorer, or promote straight onto the pick_lists spine
            the pick desk and Draft board read. Never DEMO seats.
          </p>
          <ul className="edc-queue">
            {view.suggestions.map((s) => (
              <li key={s.teamKey}>
                <div>
                  <strong>{s.teamNumber ?? s.teamKey}</strong>
                  <span>{s.reason}</span>
                </div>
                <button
                  type="button"
                  className="edc-link"
                  onClick={() => {
                    const num = String(s.teamNumber ?? s.teamKey.replace(/^frc/i, ""));
                    const parts = draft
                      .split(/[,\s]+/)
                      .map((p) => p.trim())
                      .filter(Boolean);
                    if (!parts.includes(num) && parts.length < 3) {
                      const next = [...parts, num].join(", ");
                      setDraft(next);
                      void load(orgId, next);
                    }
                  }}
                >
                  Add
                </button>
                <button
                  type="button"
                  className="edc-link"
                  disabled={Boolean(saving)}
                  onClick={() => void saveToPickList([s.teamKey], "second_pick")}
                >
                  {saving === s.teamKey ? "Promoting…" : "Promote to pick list"}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </main>
  );
}
