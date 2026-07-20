"use client";

import { useCallback, useEffect, useState } from "react";
import {
  Badge,
  type BadgeTone,
  Button,
  CardGridSkeleton,
  EmptyState,
  ErrorState,
  FormGrid,
  FormRow,
  PageHeader,
  Panel,
  TextBlockSkeleton,
} from "../../components/ui";
import {
  deskStatusLabel,
  pickSlotLabel,
  type AllianceSelectionDeskView,
} from "../../lib/alliance-selection-desk";
import type { DeskAlliance, DeskExportSnapshot, DeskSlot } from "../../lib/alliance-selection-desk/types";

type LiveView = Extract<AllianceSelectionDeskView, { status: "live" }>;
type EmptyView = Extract<AllianceSelectionDeskView, { status: "empty" }>;

function conflictTone(count: number): BadgeTone {
  if (count === 0) return "good";
  if (count <= 2) return "setup";
  return "demo";
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
    <div style={{ borderTop: "1px solid var(--soft-border, #e5e7eb)", paddingTop: 12, display: "grid", gap: 8 }}>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
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
      {slot.nickname ? <p className="app-muted" style={{ margin: 0 }}>{slot.nickname}</p> : null}
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
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Button type="button" size="sm" disabled={busy} onClick={() => onSetTeam(slot.id, team, rationale)}>
          Save pick
        </Button>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Attach scout note"
          disabled={busy}
          style={{ flex: 1, minWidth: "10rem" }}
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
        <ul className="app-muted" style={{ margin: 0, paddingLeft: "1.1rem" }}>
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
    <Panel>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
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

  const orgId = view && "orgId" in view ? view.orgId : null;
  const sessionId = view && view.status === "live" ? view.session.id : null;

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

  return (
    <main className="module-page">
      <PageHeader
        breadcrumbs={<>Competition / Alliance Selection Desk</>}
        title="Alliance Selection Desk 2.0"
        description="Live pick board with shared slots, scout evidence attach, TBA conflict flags, and drive-team export — never DEMO rankings."
      >
        {view?.status === "live" ? (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
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
            <Button type="button" size="sm" disabled={busy} onClick={() => void mutate({ action: "export-drive-team" })}>
              Export drive-team pack
            </Button>
          </div>
        ) : null}
      </PageHeader>

      {error ? (
        <p role="alert" style={{ color: "var(--app-danger, #c0392b)" }}>
          {error}
        </p>
      ) : null}

      {fetchFailed ? (
        <ErrorState
          title="Could not load Alliance Selection Desk"
          message="A network or server issue prevented loading. Try again."
          onRetry={() => load()}
        />
      ) : view == null ? (
        <div aria-busy="true" aria-label="Loading alliance selection desk" style={{ display: "grid", gap: 16 }}>
          <TextBlockSkeleton lines={2} />
          <CardGridSkeleton cols={2} rows={2} />
        </div>
      ) : view.status === "setup_required" ? (
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
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
      ) : view.status === "empty" ? (
        <div style={{ display: "grid", gap: 16 }}>
          <EmptyState
            soft
            badge="No sessions"
            badgeTone="setup"
            title="No selection desk sessions yet"
            description={`${(view as EmptyView).eventName ?? (view as EmptyView).eventKey} — create a session to open the 8-alliance live board. Picks stay empty until you assign teams.`}
          />
          <Panel as="form" onSubmit={(e) => {
            e.preventDefault();
            void mutate({
              action: "create-session",
              eventKey: (view as EmptyView).eventKey,
              name: sessionName.trim() || "Alliance Selection",
            });
          }}>
            <FormRow label="Session name">
              <input value={sessionName} onChange={(e) => setSessionName(e.target.value)} disabled={busy} />
            </FormRow>
            <Button type="submit" disabled={busy}>
              Create desk session
            </Button>
          </Panel>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 16 }}>
          <p className="app-muted" style={{ margin: 0 }}>
            {(view as LiveView).eventName ?? (view as LiveView).eventKey} · session “{(view as LiveView).session.name}”
          </p>

          {(view as LiveView).sessions.length > 1 ? (
            <Panel>
              <h3 style={{ marginTop: 0 }}>Sessions</h3>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
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
            <Panel>
              <h3 style={{ marginTop: 0 }}>Drive-team export</h3>
              <p className="app-muted">Exported {new Date(exportSnap.exportedAt).toLocaleString()}</p>
              <pre
                style={{
                  whiteSpace: "pre-wrap",
                  fontSize: "0.85rem",
                  maxHeight: "16rem",
                  overflow: "auto",
                  background: "var(--soft-surface-muted, #f6f6f6)",
                  padding: "0.75rem",
                }}
              >
                {JSON.stringify(exportSnap, null, 2)}
              </pre>
              <Button type="button" variant="secondary" size="sm" onClick={() => window.print()}>
                Print Soft-UI pack
              </Button>
            </Panel>
          ) : null}

          <div style={{ display: "grid", gap: 16, gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))" }}>
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
            <Panel>
              <h3 style={{ marginTop: 0 }}>Recent exports</h3>
              <ul style={{ margin: 0, paddingLeft: "1.1rem" }}>
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
      )}
    </main>
  );
}
