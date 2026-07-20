"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  SoftBlockSkeleton,
  StatTile,
} from "../../components/ui";
import {
  deskStatusLabel,
  pickSlotLabel,
  type AllianceSelectionDeskView,
} from "../../lib/alliance-selection-desk";
import {
  ALLIANCE_SELECTION_DESK_RELATED_INCLUDE,
  allianceSelectionDeskNextActions,
  allianceSelectionDeskRelatedLinks,
  allianceSelectionDeskSetupSteps,
  allianceSelectionDeskShellCopy,
  classifyAllianceSelectionDeskShell,
  formatAllianceSelectionDeskMetric,
  shouldShowAllianceSelectionDeskSummaryTiles,
  type AllianceSelectionDeskNextAction,
  type AllianceSelectionDeskShellKind,
} from "../../lib/alliance-selection-desk/alliance-selection-desk-related";
import type { DeskAlliance, DeskExportSnapshot, DeskSlot } from "../../lib/alliance-selection-desk/types";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import "./alliance-selection-desk.css";

type LiveView = Extract<AllianceSelectionDeskView, { status: "live" }>;
type EmptyView = Extract<AllianceSelectionDeskView, { status: "empty" }>;

function conflictTone(count: number): BadgeTone {
  if (count === 0) return "good";
  if (count <= 2) return "setup";
  return "demo";
}

function DeskRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = allianceSelectionDeskRelatedLinks(orgId, {
    include: [...ALLIANCE_SELECTION_DESK_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related alliance-desk-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function DeskNextActionsPanel({ actions }: { actions: AllianceSelectionDeskNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions alliance-desk-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Strategy, Pick list, and Pick clock — never DEMO rankings.</p>
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

function DeskShell({
  description,
  orgId,
  shell,
  error,
  onRetry,
  children,
}: {
  description: string;
  orgId?: string | null;
  shell: AllianceSelectionDeskShellKind;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = allianceSelectionDeskNextActions({ orgId, shell });
  const copy = allianceSelectionDeskShellCopy(shell);
  const competitionHref = hubHref("/competition", "alliance-selection-desk", orgId);
  const steps = shell === "setup" ? allianceSelectionDeskSetupSteps(orgId) : [];

  return (
    <main className="module-page alliance-desk-page soft-gate">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Alliance Selection Desk"}
          </>
        }
        title="Alliance Selection Desk 2.0"
        description={description}
      >
        <DeskRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      {shell === "loading" ? (
        <div aria-busy="true" aria-label="Loading alliance selection desk">
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
        </EmptyState>
      )}
      {steps.length > 0 ? (
        <Panel className="alliance-desk-panel" aria-label="Setup steps">
          <header>
            <h2>Setup steps</h2>
            <p className="app-muted">Strategy and Scouting — never DEMO rankings.</p>
          </header>
          <ul className="alliance-desk-setup-steps">
            {steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <p className="app-muted alliance-desk-tip">{step.detail}</p>
                </div>
                <a className="app-button secondary" href={step.href}>
                  Open
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}
      <DeskNextActionsPanel actions={actions} />
    </main>
  );
}

function SlotRow({
  slot,
  busy,
  onSetTeam,
  onAttachNote,
}: {
  slot: DeskSlot;
  busy: boolean;
  onSetTeam: (slotId: string, teamKey: string, rationale: string) => void;
  onAttachNote: (slotId: string, note: string) => void;
}) {
  const [team, setTeam] = useState(slot.teamNumber?.toString() ?? slot.teamKey ?? "");
  const [rationale, setRationale] = useState(slot.rationale);
  const [note, setNote] = useState("");

  useEffect(() => {
    setTeam(slot.teamNumber?.toString() ?? slot.teamKey ?? "");
    setRationale(slot.rationale);
  }, [slot.teamKey, slot.teamNumber, slot.rationale]);

  return (
    <div className="alliance-desk-slot">
      <div className="alliance-desk-slot-head">
        <strong>{pickSlotLabel(slot.pickSlot)}</strong>
        {slot.tbaRank != null ? <Badge tone="neutral">TBA #{slot.tbaRank}</Badge> : null}
        {slot.tbaEpa != null ? <Badge tone="neutral">EPA {slot.tbaEpa.toFixed(1)}</Badge> : null}
        {slot.matchScoutCount > 0 ? <Badge tone="good">{slot.matchScoutCount} match scout</Badge> : null}
        {slot.pitScoutCount > 0 ? <Badge tone="good">{slot.pitScoutCount} pit scout</Badge> : null}
        {slot.conflicts.map((c) => (
          <Badge key={c.id} tone={c.severity === "block" ? "danger" : c.severity === "warn" ? "setup" : "info"}>
            {c.code.replaceAll("_", " ")}
          </Badge>
        ))}
      </div>
      {slot.nickname ? <p className="app-muted alliance-desk-tip">{slot.nickname}</p> : null}
      <FormGrid>
        <FormRow label="Team #">
          <input value={team} onChange={(e) => setTeam(e.target.value)} placeholder="254" disabled={busy} />
        </FormRow>
        <FormRow label="Rationale">
          <input
            value={rationale}
            onChange={(e) => setRationale(e.target.value)}
            placeholder="Why this pick"
            disabled={busy}
          />
        </FormRow>
      </FormGrid>
      <div className="alliance-desk-slot-actions">
        <Button type="button" size="sm" disabled={busy} onClick={() => onSetTeam(slot.id, team, rationale)}>
          Save pick
        </Button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Attach scout note"
          disabled={busy}
          className="alliance-desk-note-input"
        />
        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy || !note.trim()}
          onClick={() => {
            onAttachNote(slot.id, note);
            setNote("");
          }}
        >
          Attach evidence
        </Button>
      </div>
      {slot.evidence.length > 0 ? (
        <ul className="app-muted alliance-desk-evidence">
          {slot.evidence.slice(0, 4).map((e) => (
            <li key={e.id}>
              [{e.sourceKind}] {e.note || "linked entry"}
              {e.createdByName ? ` — ${e.createdByName}` : ""}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function AllianceCard({
  alliance,
  busy,
  onSetTeam,
  onAttachNote,
}: {
  alliance: DeskAlliance;
  busy: boolean;
  onSetTeam: (slotId: string, teamKey: string, rationale: string) => void;
  onAttachNote: (slotId: string, note: string) => void;
}) {
  const filled = alliance.slots.filter((s) => s.teamKey).length;
  return (
    <Panel className="alliance-desk-panel">
      <div className="alliance-desk-alliance-head">
        <h3 style={{ margin: 0 }}>Alliance {alliance.seed}</h3>
        <Badge tone="neutral">
          {filled} / {alliance.slots.length} filled
        </Badge>
      </div>
      {alliance.slots.map((slot) => (
        <SlotRow key={slot.id} slot={slot} busy={busy} onSetTeam={onSetTeam} onAttachNote={onAttachNote} />
      ))}
    </Panel>
  );
}

export default function AllianceSelectionDeskClient() {
  const [view, setView] = useState<AllianceSelectionDeskView | null>(null);
  const [error, setError] = useState("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [sessionName, setSessionName] = useState("Alliance Selection");
  const [exportSnap, setExportSnap] = useState<DeskExportSnapshot | null>(null);

  const load = useCallback((overrideSession?: string | null) => {
    setFetchFailed(false);
    setError("");
    const params = new URLSearchParams(window.location.search);
    const urlOrg = params.get("orgId");
    const urlSession = overrideSession ?? params.get("sessionId");
    const query = new URLSearchParams();
    if (urlOrg) query.set("orgId", urlOrg);
    if (urlSession) query.set("sessionId", urlSession);
    void fetch(`/api/alliance-selection-desk${query.toString() ? `?${query.toString()}` : ""}`)
      .then(async (response) => {
        const data = (await response.json()) as AllianceSelectionDeskView | { error?: string };
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
  const sessionId = view && view.status === "live" ? view.session.id : null;
  const conflictCount = view?.status === "live" ? view.conflictCount : 0;
  const filledSlots =
    view?.status === "live"
      ? view.alliances.reduce((n, a) => n + a.slots.filter((s) => s.teamKey).length, 0)
      : 0;
  const sessionCount =
    view?.status === "live"
      ? view.sessions.length
      : view?.status === "empty"
        ? view.sessions.length
        : 0;

  const shell = classifyAllianceSelectionDeskShell({
    loading: view == null && !fetchFailed,
    fetchFailed,
    status: view?.status ?? null,
    orgId,
  });
  const shellCopy = allianceSelectionDeskShellCopy(shell);
  const nextActions = allianceSelectionDeskNextActions({
    orgId,
    shell,
    conflictCount,
    filledSlots,
  });
  const relatedLinks = allianceSelectionDeskRelatedLinks(orgId, {
    include: [...ALLIANCE_SELECTION_DESK_RELATED_INCLUDE],
  });
  const competitionHref = hubHref("/competition", "alliance-selection-desk", orgId);
  const showTiles = shouldShowAllianceSelectionDeskSummaryTiles(sessionCount);

  const mutate = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!orgId || busy) return null;
      setBusy(true);
      setError("");
      try {
        const response = await fetch("/api/alliance-selection-desk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, sessionId, ...payload }),
        });
        const data = (await response.json()) as
          | { view?: AllianceSelectionDeskView; snapshot?: DeskExportSnapshot; error?: string }
          | AllianceSelectionDeskView;
        if (!response.ok) {
          setError("error" in data && data.error ? String(data.error) : "Something went wrong.");
          return null;
        }
        if ("view" in data && data.view && "status" in data.view) {
          setView(data.view);
          if (data.snapshot) setExportSnap(data.snapshot);
          return data;
        }
        if ("status" in data) {
          setView(data);
          return data;
        }
        setError("Unexpected response.");
        return null;
      } catch {
        setError("Network error — please try again.");
        return null;
      } finally {
        setBusy(false);
      }
    },
    [orgId, sessionId, busy],
  );

  if (shell === "loading") {
    return <DeskShell description={shellCopy.description} orgId={null} shell="loading" />;
  }

  if (shell === "error") {
    return (
      <DeskShell
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
      <DeskShell
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
      </DeskShell>
    );
  }

  return (
    <main className="module-page alliance-desk-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={competitionHref}>Competition</a>
            {" / Alliance Selection Desk"}
          </>
        }
        title="Alliance Selection Desk 2.0"
        description="Live pick board with shared slots, scout evidence attach, TBA conflict flags, and drive-team export — never DEMO rankings. Cross-check Strategy, Collaborative Pick List, and Pick clock."
      >
        <div className="alliance-desk-header-actions">
          {view?.status === "live" ? (
            <>
              <Badge tone={conflictTone(view.conflictCount)}>
                {view.conflictCount === 0 ? "No conflicts" : `${view.conflictCount} conflict flags`}
              </Badge>
              <Badge tone="neutral">{deskStatusLabel(view.session.status)}</Badge>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={busy || view.session.status === "locked"}
                onClick={() =>
                  void mutate({
                    action: "update-session",
                    status: view.session.status === "live" ? "locked" : "live",
                  })
                }
              >
                {view.session.status === "live" ? "Lock board" : "Go live"}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={busy}
                onClick={() => void mutate({ action: "export-drive-team" })}
              >
                Export drive-team pack
              </Button>
            </>
          ) : null}
          {relatedLinks.map((link) => (
            <a key={link.id} className="app-button secondary" href={link.href}>
              {link.label}
            </a>
          ))}
        </div>
      </PageHeader>

      {error ? (
        <p role="alert" className="telemetry-status">
          {error}
        </p>
      ) : null}

      <DeskNextActionsPanel actions={nextActions} />

      {showTiles && view?.status === "live" ? (
        <section className="alliance-desk-stats" aria-label="Alliance Selection Desk counts">
          <StatTile label="Filled slots" value={formatAllianceSelectionDeskMetric(filledSlots, true)} />
          <StatTile
            label="Conflicts"
            value={formatAllianceSelectionDeskMetric(conflictCount, true)}
          />
          <StatTile
            label="Sessions"
            value={formatAllianceSelectionDeskMetric(sessionCount, true)}
          />
        </section>
      ) : null}

      {shell === "empty" && view?.status === "empty" ? (
        <div className="alliance-desk-layout">
          <EmptyState
            soft
            badge="No sessions"
            badgeTone="setup"
            title={shellCopy.title}
            description={`${(view as EmptyView).eventName ?? (view as EmptyView).eventKey} — create a session to open the 8-alliance live board. Picks stay empty until you assign teams.`}
          />
          <Panel
            id="alliance-desk-create"
            as="form"
            className="alliance-desk-panel"
            onSubmit={(e) => {
              e.preventDefault();
              void mutate({
                action: "create-session",
                eventKey: (view as EmptyView).eventKey,
                name: sessionName.trim() || "Alliance Selection",
              });
            }}
          >
            <FormRow label="Session name">
              <input value={sessionName} onChange={(e) => setSessionName(e.target.value)} disabled={busy} />
            </FormRow>
            <Button type="submit" disabled={busy}>
              Create desk session
            </Button>
          </Panel>
        </div>
      ) : view?.status === "live" ? (
        <div id="alliance-desk-board" className="alliance-desk-layout">
          <p className="app-muted alliance-desk-tip">
            {(view as LiveView).eventName ?? (view as LiveView).eventKey} · session “
            {(view as LiveView).session.name}”
          </p>

          {(view as LiveView).sessions.length > 1 ? (
            <Panel className="alliance-desk-panel">
              <h3 style={{ marginTop: 0 }}>Sessions</h3>
              <div className="alliance-desk-session-row">
                {(view as LiveView).sessions.map((s) => (
                  <Button
                    key={s.id}
                    type="button"
                    size="sm"
                    variant={s.id === (view as LiveView).session.id ? "primary" : "secondary"}
                    onClick={() => load(s.id)}
                  >
                    {s.name}
                  </Button>
                ))}
              </div>
            </Panel>
          ) : null}

          {exportSnap ? (
            <Panel id="alliance-desk-export" className="alliance-desk-panel">
              <h3 style={{ marginTop: 0 }}>Drive-team export</h3>
              <p className="app-muted">Exported {new Date(exportSnap.exportedAt).toLocaleString()}</p>
              <pre className="alliance-desk-export-pre">{JSON.stringify(exportSnap, null, 2)}</pre>
              <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
                Print Soft-UI pack
              </Button>
            </Panel>
          ) : null}

          <div className="alliance-desk-grid">
            {(view as LiveView).alliances.map((alliance) => (
              <AllianceCard
                key={alliance.seed}
                alliance={alliance}
                busy={busy || (view as LiveView).session.status === "locked"}
                onSetTeam={(slotId, teamKey, rationale) => {
                  void mutate({ action: "set-slot", slotId, teamKey, rationale });
                }}
                onAttachNote={(slotId, note) => {
                  void mutate({ action: "attach-evidence", slotId, sourceKind: "note", note });
                }}
              />
            ))}
          </div>

          {(view as LiveView).recentExports.length > 0 ? (
            <Panel className="alliance-desk-panel">
              <h3 style={{ marginTop: 0 }}>Recent exports</h3>
              <ul className="alliance-desk-evidence">
                {(view as LiveView).recentExports.map((x) => (
                  <li key={x.id} className="app-muted">
                    {new Date(x.createdAt).toLocaleString()}
                    {x.createdByName ? ` · ${x.createdByName}` : ""}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      ) : null}
    </main>
  );
}
