"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import "./match-strategy-cards.css";

function RelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = matchStrategyCardsRelatedLinks(orgId, {
    include: [...MATCH_STRATEGY_CARDS_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related msc-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
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

function CardsShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: MatchStrategyCardsShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = matchStrategyCardsNextActions({ orgId, shell });
  const copy = matchStrategyCardsShellCopy(shell);
  const competitionHref = hubWorkbenchHref("competition", "match-strategy-cards", orgId);
  const steps = shell === "setup" ? matchStrategyCardsSetupSteps(orgId) : [];

  return (
    <main className="module-page msc-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Strategy Cards"}
          </>
        }
        title="Match Strategy Cards"
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
          badge={shell === "setup" ? "Setup required" : copy.badge}
          badgeTone="setup"
          title={copy.title}
          description={error ?? copy.description}
        >
          {shell === "setup" ? (
            <a className="app-button" href={orgId ? withOrgHref("/workspace", orgId) : "/workspace"}>
              Choose your team
            </a>
          ) : null}
          {shell === "empty" ? (
            <>
              <a className="app-button" href={hubHref("/competition", "strategy", orgId)}>
                Open Strategy
              </a>
              <a className="app-button secondary" href={hubHref("/competition", "command", orgId)}>
                Open Command
              </a>
            </>
          ) : null}
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="msc-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Finish these once and this page fills in.</p>
          </header>
          <ul className="msc-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted msc-tip">{step.detail}</p>
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

export default function MatchStrategyCardsClient() {
  const [view, setView] = useState<MatchStrategyCardsView | null>(null);
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
    void fetch(`/api/match-strategy-cards${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as MatchStrategyCardsView | { error?: string };
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
        });
        const data = (await response.json()) as MatchStrategyCardsView | { error?: string };
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
    return <CardsShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <CardsShell
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
      <CardsShell
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
      </CardsShell>
    );
  }

  if (shell === "empty") {
    return <CardsShell description={shellCopy.description} orgId={orgId} shell="empty" />;
  }

  if (view?.status !== "live") {
    return <CardsShell description={shellCopy.description} orgId={orgId} shell="setup" />;
  }

  return (
    <main className="module-page msc-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Match Strategy Cards"}
          </>
        }
        title="Match Strategy Cards"
        description="Printable game plan for our next TBA match — roles, auto, defense, threats. Auto / backup / deploy cues come from written text only."
      >
        <div className="msc-header-actions">
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
        <section className="msc-stats" aria-label="Match Strategy Cards counts">
          <StatTile label="Scheduled" value={formatMatchStrategyCardsMetric(cardCount, true)} />
          <StatTile label="Saved plans" value={formatMatchStrategyCardsMetric(savedCount, true)} />
        </section>
      ) : null}

      <div id="match-strategy-cards-list" className="msc-layout">
        <Panel className="msc-panel">
          <span className="app-muted">
            {view.eventName ?? view.eventKey} · Team {view.teamNumber} ·{" "}
            {view.nextMatchKey
              ? `next ${view.nextMatchKey}`
              : `${view.cards.length} scheduled match(es) — no upcoming TBA match`}
          </span>
        </Panel>
        {view.cards.map((card) => (
          <StrategyCardPanel
            key={card.matchKey}
            card={card}
            eventKey={view.eventKey}
            ownTeamNumber={view.teamNumber}
            busy={busy}
            mutate={mutate}
          />
        ))}
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
