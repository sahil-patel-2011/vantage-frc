"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Icon } from "../../components/icon";
import { EmptyState, FormRow, PageHeader, Panel, Button } from "../../components/ui";
import { OfflineBanner } from "../../components/offline-banner";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import type { ChemistryView } from "../../lib/chemistry/load-chemistry";
import {
  CHEMISTRY_RELATED_INCLUDE,
  classifyChemistryShell,
  chemistryNextActions,
  chemistryRelatedLinks,
  chemistrySetupSteps,
  chemistryShellCopy,
  formatChemistryMetric,
  shouldShowChemistrySummaryTiles,
  type ChemistryNextAction,
  type ChemistryShellKind,
} from "../../lib/chemistry/chemistry-related";
import { withOrgHref } from "../../lib/nav/product-nav";
import { fetchProductSession } from "../../lib/nav/product-session";
import { FEATURE_API_TIMEOUT_MS, readOrgIdFromSearch } from "../../lib/nav/resolve-org";
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./chemistry.css";

function isChemistryView(value: unknown): value is ChemistryView {
  if (!value || typeof value !== "object") return false;
  const row = value as Record<string, unknown>;
  return (
    (row.status === "live" || row.status === "setup_required" || row.status === "empty") &&
    typeof row.orgId === "string" &&
    Array.isArray(row.teamKeys)
  );
}

function ChemistryRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = chemistryRelatedLinks(orgId, {
    include: [...CHEMISTRY_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related chem-related" aria-label="Related competition tools">
      {links.map((link) => (
        <Button as="a" variant="secondary" key={link.id} href={link.href}>
          {link.label}
        </Button>
      ))}
    </nav>
  );
}

function ChemistryNextActionsPanel({ actions }: { actions: ChemistryNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions chem-next-actions"
      aria-label="Next actions"
    >
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

function ChemistryShell({
  orgId,
  shell,
  error,
  errorStatus,
  onRetry,
  fromCache = false,
  cachedAt = null,
  children,
}: {
  orgId?: string | null;
  shell: ChemistryShellKind;
  error?: string;
  /** HTTP status of the failed load, so an expired session offers sign-in over Retry. */
  errorStatus?: number | null;
  onRetry?: () => void;
  fromCache?: boolean;
  cachedAt?: string | null;
  children?: ReactNode;
}) {
  const copy = chemistryShellCopy(shell);
  const setup = shell === "setup" ? chemistrySetupSteps(orgId)[0] : null;
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
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <main className="module-page chem-page chem-workbench soft-gate">
      <PageHeader
        breadcrumbs="Competition / Chemistry"
        title="Alliance chemistry"
        description="Score how well 2–3 robots complement each other from synced event seats."
      >
        <ChemistryRelatedStrip orgId={orgId} />
      </PageHeader>
      <OfflineBanner feature="Chemistry" fromCache={fromCache} cachedAt={cachedAt} />
      {children}
      <EmptyState
        soft
        className="chem-empty"
        badge={failure ? undefined : shell === "setup" ? "Needs setup" : copy.badge}
        badgeTone="setup"
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <Button as="a" variant="primary" href={failure.primary.href}>
            {failure.primary.label}
          </Button>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <Button variant="secondary" type="button" onClick={onRetry}>
            Retry
          </Button>
        ) : null}
        {setup ? (
          <Button as="a" variant="primary" href={setup.href}>
            {setup.label}
          </Button>
        ) : null}
        {shell === "empty" ? (
          <Button as="a" variant="primary" href={teamDataHref}>
            Sync Team Data
          </Button>
        ) : null}
      </EmptyState>
    </main>
  );
}

export default function ChemistryClient({
  orgId: initialOrgId,
}: {
  orgId?: string;
  embedded?: boolean;
} = {}) {
  const [orgId, setOrgId] = useState(initialOrgId?.trim() ?? "");
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
  const [savedPickListId, setSavedPickListId] = useState<string>("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<ChemistryView | null>(null);
  viewRef.current = view;

  useEffect(() => {
    const teams = new URLSearchParams(window.location.search).get("teams") ?? "";
    if (teams) setDraft(teams);
    const seeded = initialOrgId?.trim() || readOrgIdFromSearch(window.location.search) || "";
    if (seeded) {
      setOrgId(seeded);
      return;
    }
    void fetchProductSession().then((data) => {
      if (!data?.orgId) {
        setLoading(false);
        return;
      }
      setOrgId(data.orgId);
    });
  }, [initialOrgId]);

  const load = useCallback(
    async (id: string, teams?: string) => {
      if (!id) {
        setLoading(false);
        setFetchFailed(false);
        return;
      }
      const list = (teams ?? draft).trim();
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<ChemistryView>("chemistry", id || "_", list);
        if (!viewRef.current && cached?.data && isChemistryView(cached.data)) {
          setView(cached.data);
          setFromCache(true);
          setCachedAt(cached.cachedAt);
          setLoading(false);
          hadCache = true;
          if (!list && cached.data.teamKeys.length) {
            setDraft(cached.data.teamKeys.map((key) => key.replace(/^frc/i, "")).join(", "));
          }
        }
      } catch {
        // IndexedDB missing or blocked; live fetch still runs.
      }
      if (!hadCache) setLoading(true);
      setFetchFailed(false);
      const params = new URLSearchParams({ orgId: id });
      if (list) params.set("teams", list);
      try {
        const response = await fetch(`/api/chemistry?${params}`, {
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        if (!response.ok) {
          const body = await response.json().catch(() => ({}));
          if (response.status === 401 || response.status === 403) {
            setView(null);
            setFromCache(false);
            setCachedAt(null);
            setError(typeof body.error === "string" ? body.error : "Could not load alliance chemistry.");
            setErrorStatus(response.status);
            setFetchFailed(true);
            void clearFeatureSnapshot("chemistry", id || "_", list);
            if (id) void clearFeatureSnapshot("chemistry", id, list);
            setLoading(false);
            return;
          }
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh alliance chemistry. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setError(typeof body.error === "string" ? body.error : "Could not load alliance chemistry.");
            setErrorStatus(response.status);
            setView(null);
            setFetchFailed(true);
          }
          setLoading(false);
          return;
        }
        const data = (await response.json()) as ChemistryView;
        if (!isChemistryView(data)) {
          throw new Error("Could not load alliance chemistry.");
        }
        setView(data);
        if (!list && data.teamKeys.length) {
          setDraft(data.teamKeys.map((key) => key.replace(/^frc/i, "")).join(", "));
        }
        setError("");
        setErrorStatus(null);
        setFetchFailed(false);
        setFromCache(false);
        setCachedAt(null);
        try {
          await putFeatureSnapshot("chemistry", id || "_", data, list);
          if (!id) await putFeatureSnapshot("chemistry", "_", data, list);
        } catch {
          // Live chemistry already painted; IndexedDB is best-effort.
        }
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh alliance chemistry. Showing the last copy on this device.");
          setFetchFailed(false);
        } else {
          setError("Could not load alliance chemistry.");
          setErrorStatus(null);
          setView(null);
          setFetchFailed(true);
        }
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
      setSavedPickListId("");
      try {
        const response = await fetch("/api/chemistry", {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
        setSavedPickListId(data.promotion?.pickListId ?? "");
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
        fromCache={fromCache}
        cachedAt={cachedAt}
        error={
          shell === "error"
            ? error || "Could not load alliance chemistry."
            : shell === "setup" && view?.message
              ? `${view.message} Scores stay blank until real event metrics exist.`
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

  const pickDeskHref = withOrgHref("/strategy?tab=picks", orgId);
  const showTiles = shouldShowChemistrySummaryTiles(seatCount, hasScore);
  const readyActions = chemistryNextActions({
    orgId,
    shell: hasScore ? "ready" : "empty",
    eventKey: view?.eventKey,
    seatCount,
    hasScore,
  });
  const emptyCopy = chemistryShellCopy("empty");

  return (
    <main className="module-page chem-page chem-workbench">
      <PageHeader
        breadcrumbs="Competition / Chemistry"
        title="Alliance chemistry"
        description={
          view?.eventName
            ? `${view.eventName} · Partner fit from synced ratings and your scouting.`
            : "Score how well 2–3 robots complement each other — roles, ratings balance, scout reliability."
        }
      >
        <ChemistryRelatedStrip orgId={orgId} />
      </PageHeader>

      <OfflineBanner feature="Chemistry" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? <p className="edc-banner error">{error}</p> : null}
      {saveMessage ? (
        <p className="edc-banner" role="status">
          {saveMessage}
          {savedPickListId ? (
            <>
              {" "}
              <a className="edc-link" href={pickDeskHref}>
                Open Pick desk
              </a>
            </>
          ) : null}
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
            <small>event rating</small>
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
          <Button variant="primary" type="submit" disabled={loading || !orgId}>
            Score chemistry
          </Button>
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
                  <p>Partner fit from synced ratings</p>
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
                <span>Event rating</span>
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
              Promote writes these seats onto the same pick list the pick desk, Pick Clock, and
              Draft board read.
            </p>
            <div className="edc-header-actions">
              <Button variant="primary" type="button" disabled={Boolean(saving) || !view?.teamKeys.length} onClick={() => void saveToPickList(view?.teamKeys ?? [], "first_pick")}>
                {saving === (view?.teamKeys ?? []).join(",")
                  ? "Promoting…"
                  : "Promote partner fit"}
              </Button>
              <Button as="a" variant="secondary" href={pickDeskHref}>
                Open Pick desk
              </Button>
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
                  <p>Primary phase lean from event ratings</p>
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
              ? `${view.message} Cross-check Strategy, Pick desk, and Draft.`
              : emptyCopy.description
          }
        >
          <Button as="a" variant="primary" href={withOrgHref("/team/data", orgId)}>
            Sync Team Data
          </Button>
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
                  Rating {team.epaTotal != null ? Math.round(team.epaTotal * 10) / 10 : "—"}
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
          <h2>Teams to try</h2>
          <p className="edc-muted">
            Event metrics you can add to the scorer, or promote straight onto the same pick list
            the pick desk and Draft board read.
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

      <ChemistryNextActionsPanel actions={readyActions} />
    </main>
  );
}
