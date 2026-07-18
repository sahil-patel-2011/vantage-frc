"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import { matchLabel, renderCardText } from "../../lib/match-strategy-cards";
import type { MatchStrategyCardsView } from "../../lib/match-strategy-cards/compute-match-strategy-cards";
import type { MatchStrategyCard, MatchStrategyRoleAssignment } from "../../lib/match-strategy-cards/types";

type LiveView = Extract<MatchStrategyCardsView, { status: "live" }>;

export default function MatchStrategyCardsClient() {
  const [view, setView] = useState<MatchStrategyCardsView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  const orgId = view && "orgId" in view ? view.orgId : null;

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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? `/competition?orgId=${encodeURIComponent(orgId)}` : "/competition"}>Competition</a>
            {" / Match Strategy Cards"}
          </>
        }
        title="Match Strategy Cards"
        description="Printable per-match game plans for the drive team — roles, auto assignment, defense focus, key threats."
      >
        {orgId ? (
          <a className="app-button secondary" href={`/competition?orgId=${encodeURIComponent(orgId)}`}>
            Competition hub
          </a>
        ) : null}
      </PageHeader>

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <EmptyState
          title="Could not load Match Strategy Cards"
          description="A network or server issue prevented loading. Try again."
        >
          <button type="button" className="app-button secondary" onClick={() => load()}>
            Retry
          </button>
        </EmptyState>
      ) : view == null ? (
        <EmptyState title="Loading…" description="Checking your workspace." aria-busy />
      ) : view.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
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
        </EmptyState>
      ) : (
        <CardList view={view} busy={busy} mutate={mutate} />
      )}
    </main>
  );
}

function CardList({
  view,
  busy,
  mutate,
}: {
  view: LiveView;
  busy: boolean;
  mutate: (payload: Record<string, unknown>) => void;
}) {
  if (view.cards.length === 0) {
    return (
      <EmptyState
        badge="No matches yet"
        badgeTone="setup"
        title="No scheduled matches found"
        description="Once the match schedule is synced for your active event, cards will appear here."
      />
    );
  }
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <Panel>
        <span className="app-muted">
          {view.eventName ?? view.eventKey} · Team {view.teamNumber} · {view.cards.length} scheduled match(es)
        </span>
      </Panel>
      {view.cards.map((card) => (
        <StrategyCardPanel key={card.matchKey} card={card} eventKey={view.eventKey} busy={busy} mutate={mutate} />
      ))}
    </div>
  );
}

function StrategyCardPanel({
  card,
  eventKey,
  busy,
  mutate,
}: {
  card: MatchStrategyCard;
  eventKey: string;
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

  const partners = card.alliances
    .find((a) => a.isOwnAlliance)
    ?.teamNumbers.filter((n) => n !== card.alliances.find((x) => x.isOwnAlliance)?.teamNumbers[0]) ?? [];
  const opponents = card.alliances.filter((a) => !a.isOwnAlliance).flatMap((a) => a.teamNumbers);

  return (
    <Panel className="print-strategy-card" style={{ display: "grid", gap: 12 }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <h2 style={{ margin: 0 }}>{matchLabel(card)}</h2>
          <small className="app-muted">
            {card.scheduledAt ? new Date(card.scheduledAt).toLocaleString() : "Time TBD"}
          </small>
        </div>
        <span className={`app-badge ${card.ownAllianceColor === "red" ? "demo" : "good"}`}>
          {card.ownAllianceColor ? card.ownAllianceColor.toUpperCase() : "TBD"} alliance
        </span>
      </header>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 8 }}>
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
      <FormRow label="Auto assignment">
        <textarea value={autoAssignment} onChange={(e) => setAutoAssignment(e.target.value)} rows={2} />
      </FormRow>
      <FormRow label="Defense focus">
        <textarea value={defenseFocus} onChange={(e) => setDefenseFocus(e.target.value)} rows={2} />
      </FormRow>
      <FormRow label={`Key threats${opponents.length ? ` (${opponents.join(", ")})` : ""}`}>
        <textarea value={keyThreats} onChange={(e) => setKeyThreats(e.target.value)} rows={2} />
      </FormRow>
      <FormRow label={`Driver notes${partners.length ? ` (partner: ${partners.join(", ")})` : ""}`}>
        <textarea value={driverNotes} onChange={(e) => setDriverNotes(e.target.value)} rows={2} />
      </FormRow>

      <div style={{ display: "grid", gap: 6 }}>
        <span className="app-muted">Role assignments</span>
        {roles.map((role, index) => (
          <div key={index} style={{ display: "flex", gap: 8 }}>
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
                setRoles((prev) => prev.map((r, i) => (i === index ? { ...r, assignee: e.target.value } : r)))
              }
            />
            <button
              type="button"
              className="text-button"
              onClick={() => setRoles((prev) => prev.filter((_, i) => i !== index))}
            >
              Remove
            </button>
          </div>
        ))}
        <div>
          <button
            type="button"
            className="app-button secondary"
            onClick={() => setRoles((prev) => [...prev, { role: "", assignee: "" }])}
          >
            Add role
          </button>
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          type="button"
          className="app-button"
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
        </button>
        <button type="button" className="app-button secondary" onClick={() => window.print()}>
          Print
        </button>
        {card.hasCard ? (
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              if (window.confirm(`Delete the strategy card for ${matchLabel(card)}?`)) {
                mutate({ action: "delete-card", matchKey: card.matchKey });
              }
            }}
          >
            Delete
          </button>
        ) : null}
        <button
          type="button"
          className="text-button"
          onClick={() => void navigator.clipboard?.writeText(renderCardText(card))}
        >
          Copy text
        </button>
      </div>
    </Panel>
  );
}
