"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { EmptyState, PageHeader, Panel } from "../../../components/ui";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import {
  DRAFT_RELATED_INCLUDE,
  classifyDraftShell,
  draftNextActions,
  draftRelatedLinks,
  draftSetupSteps,
  draftShellCopy,
  formatDraftMetric,
  shouldShowDraftSummaryTiles,
  type DraftNextAction,
  type DraftShellKind,
} from "../../../lib/strategy/draft-related";
import type { AllianceBoardState, AllianceSlot } from "../../../lib/strategy/pick-desk";
import "./draft.css";

type DraftPickAssist = {
  pickMode: "full" | "low_data_tba";
  pickModeReason: string | null;
  scoutedTeams: number;
  teamCount: number;
  recommendation: {
    teamKey: string;
    teamNumber: number | null;
    nickname: string | null;
    headline: string;
    reasons: Array<{ label: string; tone: string }>;
    epaDrift: { label: string; divergent: boolean } | null;
  } | null;
  alternates: Array<{
    teamKey: string;
    teamNumber: number | null;
    nickname: string | null;
    headline: string;
  }>;
  epaDrifts: Array<{ teamKey: string; label: string; delta: number; divergent: boolean }>;
};

type DraftPayload = {
  orgId: string;
  eventKey: string;
  eventName: string | null;
  canEdit: boolean;
  board: {
    id: string;
    name: string;
    pickListId: string | null;
    updatedAt: string | null;
    state: AllianceBoardState;
  } | null;
  teamKeys: string[];
  pickLists: Array<{ id: string; name: string }>;
  shareTokens: Array<{
    id: string;
    expiresAt: string;
    revokedAt: string | null;
    lastUsedAt: string | null;
  }>;
  pickAssist?: DraftPickAssist | null;
  message?: string;
};

function teamNumber(teamKey: string | null) {
  if (!teamKey) return "—";
  return teamKey.replace(/^frc/, "");
}

function advanceCursor(state: AllianceBoardState): Pick<AllianceBoardState, "currentSeed" | "currentSlot"> {
  const { currentSeed, currentSlot, alliances } = state;
  if (currentSlot === "captain") {
    if (currentSeed < alliances.length) return { currentSeed: currentSeed + 1, currentSlot: "captain" };
    return { currentSeed: 1, currentSlot: "first" };
  }
  if (currentSlot === "first") {
    if (currentSeed < alliances.length) return { currentSeed: currentSeed + 1, currentSlot: "first" };
    return { currentSeed: alliances.length, currentSlot: "second" };
  }
  // second picks snake reverse
  if (currentSeed > 1) return { currentSeed: currentSeed - 1, currentSlot: "second" };
  return { currentSeed: 1, currentSlot: "second" };
}

function countFilledSlots(state: AllianceBoardState | null): number {
  if (!state) return 0;
  let filled = 0;
  for (const alliance of state.alliances) {
    for (const key of [alliance.captainTeamKey, alliance.firstPickTeamKey, alliance.secondPickTeamKey]) {
      if (key) filled += 1;
    }
  }
  return filled;
}

function DraftRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = draftRelatedLinks(orgId, {
    include: [...DRAFT_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related draft-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function DraftNextActionsPanel({ actions }: { actions: DraftNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions draft-next-actions"
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
            <a className="app-button secondary" href={action.href}>
              Open
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function DraftShell({
  orgId,
  shell,
  error,
  title,
  primary,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: DraftShellKind;
  error?: string;
  /** Overrides the canned shell heading — used when a failure was diagnosed. */
  title?: string;
  /** The action that actually resolves the failure, when one exists. */
  primary?: { label: string; href: string };
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = draftNextActions({ orgId, shell });
  const copy = draftShellCopy(shell);
  const steps = shell === "setup" ? draftSetupSteps(orgId) : [];
  const strategyHref = hubHref("/competition", "strategy", orgId);
  const pickDeskHref = withOrgHref("/strategy?tab=picks", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const commandHref = hubHref("/competition", "command", orgId);
  const teamDataHref = withOrgHref("/team/data", orgId);

  return (
    <main className="module-page strategy-draft-page draft-board-workbench soft-gate">
      <PageHeader
        breadcrumbs="Competition / Strategy / Draft"
        title="Alliance board"
        description="Draft day from synced event teams only. Mentor share links stay org-bound."
      >
        <DraftRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="draft-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : shell === "empty"
                ? "No draft board yet"
                : copy.badge
        }
        badgeTone="setup"
        title={title ?? copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {primary ? (
          <a className="app-button" href={primary.href}>
            {primary.label}
          </a>
        ) : null}
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : "/workspace"}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button" href={teamDataHref}>
              Sync event metrics
            </a>
            <a className="app-button secondary" href={strategyHref}>
              Open Strategy
            </a>
            <a className="app-button secondary" href={pickDeskHref}>
              Open Pick desk
            </a>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
          </>
        ) : null}
      </EmptyState>
      {steps.length > 0 ? (
        <Panel className="draft-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="draft-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <DraftNextActionsPanel actions={actions} />
    </main>
  );
}

export default function DraftClient() {
  const [data, setData] = useState<DraftPayload | null>(null);
  const [state, setState] = useState<AllianceBoardState | null>(null);
  const [status, setStatus] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [fetchFailed, setFetchFailed] = useState(false);
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [setupMessage, setSetupMessage] = useState("");
  const [setupOrgId, setSetupOrgId] = useState<string | null>(null);
  const [setupEventKey, setSetupEventKey] = useState<string | null>(null);
  const [orgId, setOrgId] = useState<string | null>(null);

  useEffect(() => {
    setOrgId(new URLSearchParams(window.location.search).get("orgId"));
  }, []);

  const load = useCallback(() => {
    const qs = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    setLoading(true);
    setFetchFailed(false);
    setErrorStatus(null);
    setErrorMessage(null);
    void fetch(`/api/strategy/draft${qs}`)
      .then(async (response) => {
        const payload = await response.json();
        // A rejected request (expired session, no access) used to fall through as
        // an empty board; keep the status so the shell can say what happened.
        if (!response.ok) {
          setData(null);
          setState(null);
          setSetupMessage("");
          setErrorStatus(response.status);
          setErrorMessage(typeof payload?.error === "string" ? payload.error : null);
          setFetchFailed(true);
          return;
        }
        if (payload.status === "setup_required") {
          setData(null);
          setState(null);
          setSetupMessage(payload.message ?? "Setup required");
          setSetupOrgId(typeof payload.orgId === "string" ? payload.orgId : orgId);
          setSetupEventKey(null);
          return;
        }
        const view = payload as DraftPayload;
        setSetupMessage("");
        setSetupOrgId(view.orgId);
        setSetupEventKey(view.eventKey);
        setData(view);
        setState(view.board?.state ?? null);
      })
      .catch(() => {
        setData(null);
        setState(null);
        setSetupMessage("");
        setFetchFailed(true);
      })
      .finally(() => setLoading(false));
  }, [orgId]);

  useEffect(() => {
    load();
  }, [load]);

  const shell = classifyDraftShell({
    loading,
    fetchFailed,
    status: setupMessage
      ? "setup_required"
      : data
        ? "live"
        : !loading && !fetchFailed
          ? "setup_required"
          : null,
    orgId: data?.orgId ?? setupOrgId ?? orgId,
    eventKey: data?.eventKey ?? setupEventKey,
    hasBoard: Boolean(data?.board),
    teamCount: data?.teamKeys.length ?? 0,
  });

  const taken = useMemo(() => {
    const keys = new Set<string>();
    for (const alliance of state?.alliances ?? []) {
      for (const key of [alliance.captainTeamKey, alliance.firstPickTeamKey, alliance.secondPickTeamKey]) {
        if (key) keys.add(key);
      }
    }
    return keys;
  }, [state]);

  const available = useMemo(
    () => (state?.availableTeamKeys ?? data?.teamKeys ?? []).filter((key) => !taken.has(key)),
    [state, data, taken],
  );

  async function persist(next: AllianceBoardState, action: "save" | "reset" = "save") {
    if (!data?.board || !data.canEdit) {
      setStatus("Owner or admin role required to edit draft day.");
      return;
    }
    setSaving(true);
    const response = await fetch("/api/strategy/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        orgId: data.orgId,
        boardId: data.board.id,
        action,
        state: next,
        pickListId: next.pickListId,
      }),
    });
    const body = await response.json();
    setStatus(response.ok ? "Board saved." : body.error ?? "Save failed");
    setSaving(false);
    if (response.ok && body.state) setState(body.state);
    if (response.ok) load();
  }

  function assignTeam(teamKey: string) {
    if (!state || !data?.canEdit) return;
    const alliances = state.alliances.map((slot) => ({ ...slot }));
    const target = alliances.find((slot) => slot.seed === state.currentSeed);
    if (!target) return;
    const field =
      state.currentSlot === "captain"
        ? "captainTeamKey"
        : state.currentSlot === "first"
          ? "firstPickTeamKey"
          : "secondPickTeamKey";
    if (target[field]) return;
    target[field] = teamKey;
    const cursor = advanceCursor({ ...state, alliances });
    const next: AllianceBoardState = {
      ...state,
      alliances,
      availableTeamKeys: state.availableTeamKeys.filter((key) => key !== teamKey),
      ...cursor,
    };
    setState(next);
    void persist(next);
  }

  function clearSlot(seed: number, field: keyof Omit<AllianceSlot, "seed">) {
    if (!state || !data?.canEdit) return;
    const previous = state.alliances.find((slot) => slot.seed === seed)?.[field] ?? null;
    const nextAlliances = state.alliances.map((slot) => {
      if (slot.seed !== seed) return { ...slot };
      return { ...slot, [field]: null };
    });
    const next: AllianceBoardState = {
      ...state,
      alliances: nextAlliances,
      availableTeamKeys: previous
        ? [...new Set([...state.availableTeamKeys, previous])]
        : state.availableTeamKeys,
      currentSeed: seed,
      currentSlot: field === "captainTeamKey" ? "captain" : field === "firstPickTeamKey" ? "first" : "second",
    };
    setState(next);
    void persist(next);
  }

  async function createShare() {
    if (!data?.board || !data.canEdit) return;
    setSaving(true);
    const response = await fetch("/api/strategy/draft", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: data.orgId, boardId: data.board.id, action: "share" }),
    });
    const body = await response.json();
    setSaving(false);
    if (!response.ok) {
      setStatus(body.error ?? "Share failed");
      return;
    }
    const absolute = `${window.location.origin}${body.url}`;
    setShareUrl(absolute);
    setStatus("Mentor link created (read-only, org-bound, 14 days).");
    void navigator.clipboard?.writeText(absolute);
    load();
  }

  if (shell !== "ready") {
    const failure =
      shell === "error"
        ? loadFailureCopy(
            classifyLoadFailure({
              status: errorStatus,
              message: errorMessage,
              online: typeof navigator === "undefined" ? true : navigator.onLine,
            }),
            {
              nextPath:
                typeof window === "undefined"
                  ? null
                  : `${window.location.pathname}${window.location.search}`,
              message: errorMessage,
            },
          )
        : null;
    return (
      <DraftShell
        orgId={data?.orgId ?? setupOrgId ?? orgId}
        shell={shell}
        title={failure?.title}
        primary={failure?.primary}
        error={
          failure
            ? failure.description
            : shell === "setup" && setupMessage
              ? `${setupMessage} Alliance slots stay empty until real event metrics exist.`
              : shell === "empty" && data?.message
                ? `${data.message} Cross-check Strategy, Pick desk, and Scouting.`
                : undefined
        }
        onRetry={failure?.showRetry ? () => load() : undefined}
      />
    );
  }

  if (!data || !state || !data.board) {
    return <DraftShell orgId={setupOrgId ?? orgId} shell="loading" />;
  }

  const filledSlots = countFilledSlots(state);
  const showTiles = shouldShowDraftSummaryTiles(data.teamKeys.length);
  const readyActions = draftNextActions({
    orgId: data.orgId,
    shell: "ready",
    eventKey: data.eventKey,
    hasBoard: true,
    teamCount: data.teamKeys.length,
    filledSlots,
  });
  const strategyHref = hubHref("/competition", "strategy", data.orgId);
  const pickDeskHref = withOrgHref("/strategy?tab=picks", data.orgId);
  const scoutingHref = hubHref("/competition", "scouting", data.orgId);
  const pickClockHref = withOrgHref("/pick-clock", data.orgId);

  return (
    <main className="module-page strategy-draft-page draft-board-workbench">
      <PageHeader
        breadcrumbs="Competition / Strategy / Draft"
        title="Draft day alliance board"
        description={`${data.eventName ?? data.eventKey} · captains then first picks, then reverse second picks. Only teams with synced event metrics appear in the pool. Mentor share tokens stay org-bound.`}
      >
        <div className="strategy-pick-actions">
          <DraftRelatedStrip orgId={data.orgId} />
          <a className="app-button secondary" href={strategyHref}>
            Strategy
          </a>
          <a className="app-button secondary" href={pickDeskHref}>
            Pick desk
          </a>
          <a className="app-button secondary" href={scoutingHref}>
            Scouting
          </a>
          <a className="app-button secondary" href={pickClockHref}>
            Pick clock
          </a>
        </div>
      </PageHeader>

      {showTiles ? (
        <div className="draft-kpis" aria-label="Draft board counts">
          <article>
            <strong>{formatDraftMetric(data.teamKeys.length, true)}</strong>
            <small>event teams</small>
          </article>
          <article>
            <strong>{formatDraftMetric(available.length, true)}</strong>
            <small>still available</small>
          </article>
          <article>
            <strong>{formatDraftMetric(filledSlots, true)}</strong>
            <small>filled slots</small>
          </article>
        </div>
      ) : null}

      {data.pickAssist ? (
        <section className="app-card strategy-draft-assist" aria-label="Pick assist">
          <header>
            <div>
              {data.pickAssist.pickMode === "low_data_tba" ? (
                <span className="app-badge setup">Low-data TBA</span>
              ) : (
                <span className="app-badge good">Scout-weighted</span>
              )}
              <h2>Next pick assist</h2>
              <p className="app-muted">
                {data.pickAssist.pickModeReason ??
                  `${formatDraftMetric(data.pickAssist.scoutedTeams, true)}/${formatDraftMetric(data.pickAssist.teamCount, true)} teams with scout depth · linked to pick desk`}
              </p>
            </div>
            <a className="app-button secondary" href={pickClockHref}>
              Open 45s clock
            </a>
          </header>
          {data.pickAssist.recommendation ? (
            <div className="strategy-draft-next">
              <strong>
                {teamNumber(data.pickAssist.recommendation.teamKey)}
                {data.pickAssist.recommendation.nickname
                  ? ` · ${data.pickAssist.recommendation.nickname}`
                  : ""}
              </strong>
              <span>{data.pickAssist.recommendation.headline}</span>
              {data.pickAssist.recommendation.epaDrift?.divergent ? (
                <p className="strategy-draft-drift">{data.pickAssist.recommendation.epaDrift.label}</p>
              ) : null}
              {data.canEdit ? (
                <button
                  type="button"
                  className="app-button"
                  onClick={() => assignTeam(data.pickAssist!.recommendation!.teamKey)}
                >
                  Draft this pick
                </button>
              ) : null}
            </div>
          ) : (
            <p className="app-muted">No remaining recommendations for available teams.</p>
          )}
          {data.pickAssist.alternates.length ? (
            <ul className="strategy-draft-alts">
              {data.pickAssist.alternates.map((alt) => (
                <li key={alt.teamKey}>
                  <strong>{teamNumber(alt.teamKey)}</strong>
                  <span>{alt.headline}</span>
                  {data.canEdit ? (
                    <button type="button" className="text-button" onClick={() => assignTeam(alt.teamKey)}>
                      Draft
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : null}
          {data.pickAssist.epaDrifts.length ? (
            <div className="strategy-draft-drifts">
              <h3>EPA-drift callouts</h3>
              <ul>
                {data.pickAssist.epaDrifts.map((drift) => (
                  <li key={drift.teamKey}>
                    <strong>{teamNumber(drift.teamKey)}</strong>
                    <span>{drift.label}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="strategy-draft-toolbar app-card">
        <div>
          <span className="app-badge good">Live board</span>
          <strong>
            Now selecting: Alliance {state.currentSeed} · {state.currentSlot}
          </strong>
          <small>
            Updated {data.board.updatedAt ? new Date(data.board.updatedAt).toLocaleString() : "—"}
          </small>
        </div>
        <label>
          Linked pick list
          <select
            value={state.pickListId ?? ""}
            disabled={!data.canEdit}
            onChange={(event) => {
              const next = { ...state, pickListId: event.target.value || null };
              setState(next);
              void persist(next);
            }}
          >
            <option value="">None</option>
            {data.pickLists.map((list) => (
              <option key={list.id} value={list.id}>
                {list.name}
              </option>
            ))}
          </select>
        </label>
        <div className="strategy-pick-actions">
          <button
            type="button"
            className="app-button secondary"
            disabled={!data.canEdit || saving}
            onClick={() => void persist(state, "reset")}
          >
            Reset board
          </button>
          <button
            type="button"
            className="app-button secondary"
            disabled={!data.canEdit || saving}
            onClick={() => void createShare()}
          >
            Share mentor link
          </button>
        </div>
        {shareUrl ? (
          <p className="strategy-share-url">
            <span>Read-only org-bound link</span>
            <code>{shareUrl}</code>
          </p>
        ) : null}
        <p className="draft-share-note app-muted">
          A mentor share link only opens the board from the team that created it.
        </p>
        {status ? (
          <p className="telemetry-status success" role="status">
            {status}
          </p>
        ) : null}
        {!data.canEdit ? (
          <p className="telemetry-status" role="status">
            Read-only for your role.
          </p>
        ) : null}
      </section>

      <section className="strategy-alliance-board" aria-label="Alliance selections">
        {state.alliances.map((alliance) => (
          <article
            key={alliance.seed}
            className={`app-card strategy-alliance-card${state.currentSeed === alliance.seed ? " active" : ""}`}
          >
            <header>
              <strong>Alliance {alliance.seed}</strong>
              {state.currentSeed === alliance.seed ? (
                <span className="app-badge setup">On deck · {state.currentSlot}</span>
              ) : null}
            </header>
            <ul>
              {(
                [
                  ["Captain", "captainTeamKey"],
                  ["First pick", "firstPickTeamKey"],
                  ["Second pick", "secondPickTeamKey"],
                ] as const
              ).map(([label, field]) => (
                <li key={field}>
                  <span>{label}</span>
                  <strong>{teamNumber(alliance[field])}</strong>
                  {alliance[field] && data.canEdit ? (
                    <button type="button" className="text-button" onClick={() => clearSlot(alliance.seed, field)}>
                      Clear
                    </button>
                  ) : (
                    <span />
                  )}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </section>

      <section className="app-card strategy-draft-pool">
        <header>
          <h2>Available teams</h2>
          <small>{formatDraftMetric(available.length, true)} remaining with event metrics</small>
        </header>
        {!available.length ? (
          <p className="app-muted">Pool empty — sync more event metrics or clear a slot.</p>
        ) : (
          <ul>
            {available.map((teamKey) => {
              const drift = data.pickAssist?.epaDrifts.find((row) => row.teamKey === teamKey);
              return (
                <li key={teamKey} title={drift?.label}>
                  <strong>{teamNumber(teamKey)}</strong>
                  {drift ? <span className="strategy-draft-pool-drift">EPA lag</span> : null}
                  <button
                    type="button"
                    className="app-button secondary"
                    disabled={!data.canEdit}
                    onClick={() => assignTeam(teamKey)}
                  >
                    Draft
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {data.shareTokens.length ? (
        <section className="app-card">
          <h3>Mentor share history</h3>
          <p className="app-muted draft-share-note">
            Tokens are hashed and scoped to this org&apos;s board — revoke anytime.
          </p>
          <ul className="strategy-share-history">
            {data.shareTokens.map((token) => (
              <li key={token.id}>
                <span>
                  Expires {new Date(token.expiresAt).toLocaleString()}
                  {token.revokedAt ? " · revoked" : ""}
                </span>
                {!token.revokedAt && data.canEdit ? (
                  <button
                    type="button"
                    className="text-button"
                    onClick={() => {
                      void fetch("/api/strategy/draft", {
                        method: "POST",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({
                          orgId: data.orgId,
                          action: "revoke-share",
                          tokenId: token.id,
                        }),
                      }).then(() => load());
                    }}
                  >
                    Revoke
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DraftNextActionsPanel actions={readyActions} />
    </main>
  );
}
