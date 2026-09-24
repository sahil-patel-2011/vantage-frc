"use client";

import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import { alliancePartners, autoCoordinationCue, autoFlexibilityCue, deploySafetyCue, dutyPlanFromTemplate, DUTY_STANCES, dutyStanceLabel, matchLabel, renderCardText } from "../../lib/match-strategy-cards";
import type { MatchStrategyCardsView } from "../../lib/match-strategy-cards/compute-match-strategy-cards";
import {
  MATCH_STRATEGY_CARDS_RELATED_INCLUDE,
  classifyMatchStrategyCardsShell,
  formatMatchStrategyCardsMetric,
  matchStrategyCardsNextActions,
  matchStrategyCardsRelatedLinks,
  matchStrategyCardsSetupSteps,
  matchStrategyCardsShellCopy,
  shouldShowMatchStrategyCardsSummaryTiles,
  type MatchStrategyCardsNextAction,
  type MatchStrategyCardsShellKind,
} from "../../lib/match-strategy-cards/match-strategy-cards-related";
import type { MatchStrategyCard, MatchStrategyRoleAssignment } from "../../lib/match-strategy-cards/types";
import { hubHref, hubWorkbenchHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import "./match-strategy-cards.css";

function isMatchStrategyCardsView(value: unknown): value is MatchStrategyCardsView {
  if (!value || typeof value !== "object") return false;
  const status = (value as { status?: unknown }).status;
  return status === "setup_required" || status === "live";
}

async function persistStrategyCardsSnapshot(
  orgHint: string,
  data: MatchStrategyCardsView,
): Promise<void> {
  const cacheOrg =
    "orgId" in data && typeof data.orgId === "string" && data.orgId.trim() ? data.orgId : orgHint;
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("strategy-cards", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("strategy-cards", "_", data);
  } catch {
    // Live cards already painted; IndexedDB is best-effort.
  }
}

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchStrategyCardsRelatedLinks(orgId, {
    include: [...MATCH_STRATEGY_CARDS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related msc-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} href={link.href}>{link.label}</a>
      ))}
    </nav>
  );
}

function NextActionsPanel({ actions }: { actions: MatchStrategyCardsNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section className="app-card soft-panel edc-next-actions msc-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function CardsShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  action,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchStrategyCardsShellKind;
  error?: string;
  onRetry?: () => void;
  action?: { href: string; label: string } | null;
  children?: ReactNode;
}) {
  const actions = matchStrategyCardsNextActions({ orgId, shell });
  const copy = matchStrategyCardsShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "match-strategy-cards", orgId);
  const setup = shell === "setup" ? matchStrategyCardsSetupSteps(orgId)[0] : null;

  return (
    <main className="module-page msc-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match cards"}
          </>
        }
        title="Match cards"
        description={description}
      >
        <RelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading match strategy cards">
          <SoftBlockSkeleton lines={4} />
        </div>
      ) : shell === "error" ? (
        <ErrorState message={error ?? copy.description} onRetry={onRetry} />
      ) : (
        <EmptyState
          soft
          badge={shell === "setup" ? "Needs setup" : copy.badge}
          badgeTone="setup"
          title={action && orgId ? (action.label === "Set active event" ? "Set active event" : "No matches yet") : copy.title}
          description={action && orgId ? description : (error ?? copy.description)}
        >
          {action ? (
            <Button as="a" variant="primary" href={action.href}>
              {action.label}
            </Button>
          ) : setup ? (
            <Button as="a" variant="primary" href={setup.href}>
              {setup.label}
            </Button>
          ) : null}
          {shell === "empty" ? (
            <Button as="a" variant="primary" href={hubHref("/competition", "strategy", orgId)}>
              Open Strategy
            </Button>
          ) : null}
        </EmptyState>
      )}
      {shell === "ready" ? <NextActionsPanel actions={actions} /> : null}
    </main>
  );
}

export default function MatchStrategyCardsClient() {
  const [view, setView] = useState<MatchStrategyCardsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  // One card open at a time. Sixteen full forms, each with its own blue Save, was the
  // whole schedule as a wall of textareas; the rest are one-line rows until opened.
  const [openMatchKey, setOpenMatchKey] = useState<string | null>(null);
  // Cards opened before stay mounted (hidden), so a half-written plan survives a look
  // at another match.
  const [visitedKeys, setVisitedKeys] = useState<string[]>([]);
  const viewRef = useRef<MatchStrategyCardsView | null>(null);
  viewRef.current = view;

  const load = useCallback(() => {
    void (async () => {
      const params = new URLSearchParams(window.location.search);
      const urlOrg = params.get("orgId")?.trim() ?? "";
      let hadCache = Boolean(viewRef.current);
      try {
        const cached = await getFeatureSnapshot<MatchStrategyCardsView>(
          "strategy-cards",
          urlOrg || "_",
        );
        if (!viewRef.current && cached?.data && isMatchStrategyCardsView(cached.data)) {
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
          `/api/match-strategy-cards${query.toString() ? `?${query.toString()}` : ""}`,
          {
            cache: "no-store",
            signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
          },
        );
        const data = (await response.json()) as MatchStrategyCardsView | { error?: string };
        if (!response.ok || !isMatchStrategyCardsView(data)) {
          if (hadCache || viewRef.current) {
            setFromCache(true);
            setError("Could not refresh Match cards. Showing the last copy on this device.");
            setFetchFailed(false);
          } else {
            setFetchFailed(true);
          }
          return;
        }
        setView(data);
        setFromCache(false);
        setCachedAt(null);
        await persistStrategyCardsSnapshot(urlOrg, data);
      } catch {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Match cards. Showing the last copy on this device.");
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
  const cardCount = view?.status === "live" ? view.cards.length : 0;
  const savedCount = view?.status === "live" ? view.cards.filter((c) => c.hasCard).length : 0;
  const ownTeamNumber = view?.status === "live" ? view.teamNumber : null;
  const needsAutoCoordination =
    view?.status === "live" &&
    ownTeamNumber != null &&
    view.cards.some(
      (card) =>
        autoCoordinationCue({
          partnerNumbers: alliancePartners(card.alliances, ownTeamNumber),
          autoAssignment: card.autoAssignment,
        }) != null,
    );
  const needsAutoFlexibility =
    view?.status === "live" &&
    ownTeamNumber != null &&
    view.cards.some(
      (card) =>
        autoFlexibilityCue({
          partnerNumbers: alliancePartners(card.alliances, ownTeamNumber),
          autoAssignment: card.autoAssignment,
        }) != null,
    );
  const needsDeploySafety =
    view?.status === "live" &&
    view.cards.some(
      (card) => deploySafetyCue({ gamePlan: card.gamePlan, driverNotes: card.driverNotes }) != null,
    );

  const shell = classifyMatchStrategyCardsShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
    cardCount,
  });
  const shellCopy = matchStrategyCardsShellCopy(shell);
  const nextActions = matchStrategyCardsNextActions({
    orgId,
    shell,
    cardCount,
    savedCount,
    needsAutoCoordination,
    needsAutoFlexibility,
    needsDeploySafety,
  });
  const relatedLinks = matchStrategyCardsRelatedLinks(orgId, {
    include: [...MATCH_STRATEGY_CARDS_RELATED_INCLUDE],
  });
  const competitionHref = hubWorkbenchHref("competition", "match-strategy-cards", orgId);
  const showTiles = shouldShowMatchStrategyCardsSummaryTiles(cardCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/match-strategy-cards", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
        });
        const data = (await response.json()) as MatchStrategyCardsView | { error?: string };
        if (!response.ok || !("status" in data)) {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
          return;
        }
        setView(data);
        void persistStrategyCardsSnapshot(orgId, data);
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
      <CardsShell description={shellCopy.description} orgId={null} shell="loading">
        <OfflineBanner feature="Match strategy cards" fromCache={fromCache} cachedAt={cachedAt} />
      </CardsShell>
    );
  }

  if (shell === "error") {
    return (
      <CardsShell
        description={shellCopy.description}
        orgId={orgId}
        shell="error"
        error={error || shellCopy.description}
        onRetry={() => load()}
      >
        <OfflineBanner feature="Match strategy cards" fromCache={fromCache} cachedAt={cachedAt} />
      </CardsShell>
    );
  }

  if (shell === "setup") {
    const setupView = view?.status === "setup_required" ? view : null;
    const action = !orgId
      ? { href: "/workspace", label: "Choose your team" }
      : !setupView?.eventKey
        ? { href: hubHref("/competition", "command", orgId), label: "Set active event" }
        : setupView.canSync === true
          ? { href: withOrgHref("/team/data", orgId), label: "Sync Team Data" }
          : { href: hubHref("/competition", "scouting", orgId), label: "Open Scouting" };
    return (
      <CardsShell
        description={setupView ? setupView.message : shellCopy.description}
        orgId={orgId}
        shell="setup"
        action={action}
      >
        <OfflineBanner feature="Match strategy cards" fromCache={fromCache} cachedAt={cachedAt} />
      </CardsShell>
    );
  }

  if (shell === "empty") {
    return (
      <CardsShell description={shellCopy.description} orgId={orgId} shell="empty">
        <OfflineBanner feature="Match strategy cards" fromCache={fromCache} cachedAt={cachedAt} />
      </CardsShell>
    );
  }

  if (view?.status !== "live") {
    return (
      <CardsShell description={shellCopy.description} orgId={orgId} shell="setup">
        <OfflineBanner feature="Match strategy cards" fromCache={fromCache} cachedAt={cachedAt} />
      </CardsShell>
    );
  }

  // Our matches from the next one on; the ones before it are played and fold away. With no
  // next match nothing opens by itself: a plan for a match that's over is a lookup, not a job.
  const nextIndex = view.nextMatchKey ? view.cards.findIndex((card) => card.matchKey === view.nextMatchKey) : -1;
  const nextCard = nextIndex >= 0 ? view.cards[nextIndex]! : null;
  const upcomingCards = nextIndex >= 0 ? view.cards.slice(nextIndex) : [];
  const earlierCards = nextIndex >= 0 ? view.cards.slice(0, nextIndex) : view.cards;
  const current = openMatchKey ?? nextCard?.matchKey ?? null;
  const renderCard = (card: MatchStrategyCard) => {
    const open = card.matchKey === current;
    const mounted = open || visitedKeys.includes(card.matchKey);
    return (
      <Fragment key={card.matchKey}>
        {mounted ? (
          <div hidden={!open}>
            <StrategyCardPanel
              card={card}
              eventKey={view.eventKey}
              ownTeamNumber={view.teamNumber}
              busy={busy}
              mutate={mutate}
            />
          </div>
        ) : null}
        {open ? null : (
          <button
            type="button"
            className={`msc-card-row${card.ownAllianceColor ? ` is-${card.ownAllianceColor}` : ""}`}
            onClick={() => {
              if (current) setVisitedKeys((keys) => (keys.includes(current) ? keys : [...keys, current]));
              setOpenMatchKey(card.matchKey);
            }}
            aria-label={`Open the plan for ${matchLabel(card)}`}
          >
            <strong>{matchLabel(card)}</strong>
            <span>
              {card.scheduledAt
                ? new Date(card.scheduledAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })
                : "Time TBD"}
            </span>
            <span>{card.ownAllianceColor ? `${card.ownAllianceColor === "red" ? "Red" : "Blue"} alliance` : ""}</span>
            <small>{card.hasCard ? "Plan saved" : "No plan yet"}</small>
          </button>
        )}
      </Fragment>
    );
  };

  return (
    <main className="module-page msc-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match cards"}
          </>
        }
        title="Match cards"
        description="A printable game plan for each of our matches: roles, auto, defense and the robots to watch."
      >
        <div className="msc-header-actions">
          {relatedLinks.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
        </div>
      </PageHeader>

      <OfflineBanner feature="Match strategy cards" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {/* Tips about the next plan only make sense while a match is coming. */}
      {view.nextMatchKey ? <NextActionsPanel actions={nextActions} /> : null}

      {/* Counts of scheduled matches only mean something while one is still coming. */}
      {showTiles && view.nextMatchKey ? (
        <section className="msc-stats" aria-label="Match strategy cards counts">
          <StatTile label="Scheduled" value={formatMatchStrategyCardsMetric(cardCount, true)} />
          <StatTile label="Saved plans" value={formatMatchStrategyCardsMetric(savedCount, true)} />
        </section>
      ) : null}

      <div id="match-strategy-cards-list" className="msc-layout">
        <Panel className="msc-panel">
          <span className="app-muted">
            {view.eventName ?? view.eventKey} · Team {view.teamNumber} ·{" "}
            {nextCard
              ? `next up: ${matchLabel(nextCard)}`
              : "no match of ours is coming up. Plans for earlier matches are below."}
          </span>
        </Panel>
        {upcomingCards.map(renderCard)}
        {earlierCards.length > 0 ? (
          <details className="msc-earlier" open={!nextCard && earlierCards.some((card) => card.matchKey === openMatchKey)}>
            <summary>
              {nextCard ? "Played" : "Earlier matches"} ({earlierCards.length})
            </summary>
            {earlierCards.map(renderCard)}
          </details>
        ) : null}
      </div>
    </main>
  );
}

function StrategyCardPanel({
  card,
  eventKey,
  ownTeamNumber,
  busy,
  mutate,
}: {
  card: MatchStrategyCard;
  eventKey: string;
  ownTeamNumber: number;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  const [gamePlan, setGamePlan] = useState(card.gamePlan ?? "");
  const [autoAssignment, setAutoAssignment] = useState(card.autoAssignment ?? "");
  const [defenseFocus, setDefenseFocus] = useState(card.defenseFocus ?? "");
  const [keyThreats, setKeyThreats] = useState(card.keyThreats ?? "");
  const [driverNotes, setDriverNotes] = useState(card.driverNotes ?? "");
  const [roles, setRoles] = useState<MatchStrategyRoleAssignment[]>(
    card.roleAssignments.length ? card.roleAssignments : [{ role: "Driver", assignee: "" }],
  );

  const partners = alliancePartners(card.alliances, ownTeamNumber);
  const opponents = card.alliances.filter((a) => !a.isOwnAlliance).flatMap((a) => a.teamNumbers);
  const autoCue = autoCoordinationCue({ partnerNumbers: partners, autoAssignment });
  const flexCue = autoFlexibilityCue({ partnerNumbers: partners, autoAssignment });
  const deployCue = deploySafetyCue({ gamePlan, driverNotes });

  return (
    <Panel className={`print-strategy-card msc-panel msc-card${card.isNextMatch ? " msc-card-next" : ""}`}>
      <header className="msc-card-head">
        <div>
          <h2 style={{ margin: 0 }}>{matchLabel(card)}</h2>
          <small className="app-muted">
            {card.scheduledAt ? new Date(card.scheduledAt).toLocaleString() : "Time TBD"}
          </small>
        </div>
        <div className="msc-card-badges">
          {card.isNextMatch ? <Badge tone="info">Next match</Badge> : null}
          <Badge
            tone={
              card.ownAllianceColor === "red"
                ? "danger"
                : card.ownAllianceColor === "blue"
                  ? "info"
                  : "neutral"
            }
          >
            {card.ownAllianceColor ? card.ownAllianceColor.toUpperCase() : "TBD"} alliance
          </Badge>
        </div>
      </header>

      <div className="msc-alliances">
        {card.alliances.map((alliance) => (
          <div key={alliance.color}>
            <strong className="app-muted">
              {alliance.color.toUpperCase()} {alliance.isOwnAlliance ? "(us)" : ""}
            </strong>
            <div>{alliance.teamNumbers.length ? alliance.teamNumbers.join(", ") : "TBD"}</div>
          </div>
        ))}
      </div>

      <FormRow label="Game plan">
        <textarea value={gamePlan} onChange={(e) => setGamePlan(e.target.value)} rows={2} />
      </FormRow>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, margin: "0 0 12px" }}>
        {DUTY_STANCES.map((stance) => (
          <Button
            key={stance}
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={() => {
              const plan = dutyPlanFromTemplate({
                stance,
                ownTeamNumber,
                partnerNumbers: partners,
              });
              setGamePlan(plan.gamePlan);
              setRoles(plan.roleAssignments);
            }}
          >
            {dutyStanceLabel(stance)} duty
          </Button>
        ))}
      </div>
      <FormRow label="Auto assignment">
        <textarea value={autoAssignment} onChange={(e) => setAutoAssignment(e.target.value)} rows={2} />
      </FormRow>
      {autoCue ? (
        <p className="msc-auto-cue" role="status">
          {autoCue}
        </p>
      ) : null}
      {flexCue ? (
        <p className="msc-auto-cue" role="status">
          {flexCue}
        </p>
      ) : null}
      <FormRow label="Defense focus">
        <textarea value={defenseFocus} onChange={(e) => setDefenseFocus(e.target.value)} rows={2} />
      </FormRow>
      <FormRow label={`Key threats${opponents.length ? ` (${opponents.join(", ")})` : ""}`}>
        <textarea value={keyThreats} onChange={(e) => setKeyThreats(e.target.value)} rows={2} />
      </FormRow>
      <FormRow label={`Driver notes${partners.length ? ` (partner: ${partners.join(", ")})` : ""}`}>
        <textarea value={driverNotes} onChange={(e) => setDriverNotes(e.target.value)} rows={2} />
      </FormRow>
      {deployCue ? (
        <p className="msc-auto-cue" role="status">
          {deployCue}
        </p>
      ) : null}

      <div className="msc-roles">
        <span className="app-muted">Role assignments</span>
        {roles.map((role, index) => (
          <div key={index} className="msc-role-row">
            <input
              value={role.role}
              placeholder="Role (e.g. Driver)"
              aria-label={`Role ${index + 1}`}
              onChange={(e) =>
                setRoles((prev) => prev.map((r, i) => (i === index ? { ...r, role: e.target.value } : r)))
              }
            />
            <input
              value={role.assignee}
              placeholder="Assignee"
              aria-label={`Assignee for role ${index + 1}`}
              onChange={(e) =>
                setRoles((prev) =>
                  prev.map((r, i) => (i === index ? { ...r, assignee: e.target.value } : r)),
                )
              }
            />
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Remove role ${index + 1}`}
              onClick={() => setRoles((prev) => prev.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        ))}
        <div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setRoles((prev) => [...prev, { role: "", assignee: "" }])}
          >
            Add role
          </Button>
        </div>
      </div>

      <div className="msc-card-actions">
        <Button
          variant="primary"
          disabled={busy}
          onClick={() =>
            mutate({
              action: "save-card",
              matchKey: card.matchKey,
              eventKey,
              gamePlan,
              autoAssignment,
              defenseFocus,
              keyThreats,
              driverNotes,
              roleAssignments: roles.filter((r) => r.role.trim() || r.assignee.trim()),
            })
          }
        >
          Save card
        </Button>
        <Button variant="secondary" onClick={() => window.print()}>
          Print
        </Button>
        {card.hasCard ? (
          <Button
            variant="ghost"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete the strategy card for ${matchLabel(card)}?`)) {
                mutate({ action: "delete-card", matchKey: card.matchKey });
              }
            }}
          >
            Delete
          </Button>
        ) : null}
        <Button variant="ghost" onClick={() => void navigator.clipboard?.writeText(renderCardText(card))}>
          Copy text
        </Button>
      </div>
    </Panel>
  );
}
