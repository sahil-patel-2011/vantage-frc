"use client";

import type { Dispatch, SetStateAction } from "react";
import { applyVoiceTranscriptToForm, isLayoutOnlyField, type ScoutSchema } from "@vantage/scouting";
import { SCOUT_IDENTITY_LOCK_COPY } from "@vantage/scouting/identity";
import { fieldConfidenceHint, type FieldTrustSummary, type SchemaBudget } from "@vantage/scouting/trust";
import { EmptyState, FormRow, PageHeader, Panel, ToolStrip, Button } from "../../components/ui";
import { ExportButton } from "../../components/ui/export-button";
import { CopyShareLink } from "../../components/copy-share-link";
import { OfflineBanner } from "../../components/offline-banner";
import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { formatDraftSavedAgo, payloadHasDraftContent } from "../../lib/scouting/draft-autosave";
import { scoutingPostSaveNextSteps } from "../../lib/scouting/form-builder";
import { hubHref } from "../../lib/nav/hubs";
import type { QuarantinedItem } from "../../lib/scout-offline";
import {
  formatScoutingMetric,
  shouldShowScoutingRecentEntries,
  type ScoutingNextAction,
  type ScoutingShellKind,
} from "../../lib/scouting/scouting-related";
import { ScoutingNextActionsPanel, ScoutingRelatedStrip } from "./scouting-chrome";
import { Field } from "./scouting-field";
import {
  SCOUT_ENTRY_CSV_COLUMNS,
  type Bootstrap,
  type ConflictCandidate,
  type OfficialFlag,
  type ScoutTab,
} from "./scouting-model";
import { ScoutQuarantinePanel } from "./scouting-quarantine";
import ScoutHandoffPanel from "./scout-handoff-panel";
import ScoutVoiceNotesPanel from "./scout-voice-notes-panel";
import ScoutingTrustPanel from "./scouting-trust-panel";

type MatchOption = { matchKey: string; teamKey: string; label: string };
type SaveReceipt = {
  teamKey: string;
  matchKey?: string;
  entryType: "match" | "pit";
  offline: boolean;
};

export type ScoutingReadyViewProps = {
  orgId: string;
  embedded: boolean;
  online: boolean;
  fromCache: boolean;
  syncState: "idle" | "syncing" | "degraded";
  counts: { entries: number; media: number; quarantined: number };
  offlineDetail: string | undefined;
  quarantine: QuarantinedItem[];
  shell: ScoutingShellKind;
  tab: ScoutTab;
  type: "match" | "pit";
  data: Bootstrap | null;
  schema: ScoutSchema | undefined;
  formFields: ScoutSchema["definition"]["fields"];
  schemaBudget: SchemaBudget | null;
  formEmptyActions: ScoutingNextAction[];
  matchOptions: MatchOption[];
  matchKey: string;
  teamKey: string;
  payload: Record<string, unknown>;
  confidence: "high" | "normal" | "low";
  entryClientId: string;
  draftSavedAt: string | null;
  draftDirty: boolean;
  flagsByField: Map<string, OfficialFlag[]>;
  trustByField: Map<string, FieldTrustSummary>;
  liveConflicts: OfficialFlag[];
  conflicts: Array<Record<string, unknown>>;
  selectedWinners: Record<string, string>;
  message: string;
  saveReceipt: SaveReceipt | null;
  showFormula: boolean;
  formulaName: string;
  formulaWeights: Record<string, number>;
  trust: { fieldTrust: FieldTrustSummary[]; leaderboard: Array<{
    userId: string;
    name: string;
    entries: number;
    checks: number;
    matches: number;
    conflicts: number;
    accuracy: number | null;
  }> } | null;
  cheatOpen: boolean;
  shortcuts: VenueShortcut[];
  setCheatOpen: (open: boolean) => void;
  setMatchKey: (key: string) => void;
  setTeamKey: (key: string) => void;
  setPayload: Dispatch<SetStateAction<Record<string, unknown>>>;
  setConfidence: (value: "high" | "normal" | "low") => void;
  setSource: (value: "manual" | "voice") => void;
  setSelectedWinners: Dispatch<SetStateAction<Record<string, string>>>;
  setSaveReceipt: (receipt: SaveReceipt | null) => void;
  setShowFormula: Dispatch<SetStateAction<boolean>>;
  setFormulaName: (name: string) => void;
  setFormulaWeights: Dispatch<SetStateAction<Record<string, number>>>;
  onTabChange: (id: string) => void;
  sync: () => Promise<void> | void;
  retryQuarantineItem: (clientId: string) => Promise<void> | void;
  discardQuarantineItem: (clientId: string) => Promise<void> | void;
  createStarterForms: () => Promise<void> | void;
  refreshCounts: () => Promise<void> | void;
  loadConflicts: () => Promise<void> | void;
  reviewConflict: (id: string, status: "resolved" | "dismissed") => Promise<void> | void;
  attachMedia: (file: File, options?: { fieldKey?: string; tags?: string[] }) => Promise<string | null>;
  submit: () => Promise<void> | void;
  saveFormula: () => Promise<void> | void;
  setMessage: (message: string) => void;
};

export function ScoutingReadyView({
  orgId,
  embedded,
  online,
  fromCache,
  syncState,
  counts,
  offlineDetail,
  quarantine,
  shell,
  tab,
  type,
  data,
  schema,
  formFields,
  schemaBudget,
  formEmptyActions,
  matchOptions,
  matchKey,
  teamKey,
  payload,
  confidence,
  entryClientId,
  draftSavedAt,
  draftDirty,
  flagsByField,
  trustByField,
  liveConflicts,
  conflicts,
  selectedWinners,
  message,
  saveReceipt,
  showFormula,
  formulaName,
  formulaWeights,
  trust,
  cheatOpen,
  shortcuts,
  setCheatOpen,
  setMatchKey,
  setTeamKey,
  setPayload,
  setConfidence,
  setSource,
  setSelectedWinners,
  setSaveReceipt,
  setShowFormula,
  setFormulaName,
  setFormulaWeights,
  onTabChange,
  sync,
  retryQuarantineItem,
  discardQuarantineItem,
  createStarterForms,
  refreshCounts,
  loadConflicts,
  reviewConflict,
  attachMedia,
  submit,
  saveFormula,
  setMessage,
}: ScoutingReadyViewProps) {
return (
  <main className={`module-page scout-page${embedded ? " is-embedded" : ""}`}>
    {embedded ? (
      <div className="scout-header-meta scout-header-meta-embedded">
        <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
          {online ? "Online" : "Offline"} · {formatScoutingMetric(counts.entries, true)} queued
        </span>
        <Button variant="secondary" type="button" onClick={() => void sync()}>
          Sync now
        </Button>
      </div>
    ) : (
    <PageHeader
      breadcrumbs="Competition / Scouting"
      title="Scouting"
      description="Match and pit forms stay on this device until you sync."
    >
      <div className="scout-header-meta">
        <ScoutingRelatedStrip orgId={orgId} />
        <CopyShareLink orgId={orgId} />
        <Button variant="secondary" type="button" onClick={() => window.print()}>
          Print
        </Button>
        <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
          {online ? "Online" : "Offline"} · {formatScoutingMetric(counts.entries, true)} entries ·{" "}
          {formatScoutingMetric(counts.media, true)} media
        </span>
        <Button variant="secondary" type="button" onClick={() => void sync()}>
          Sync now
        </Button>
      </div>
    </PageHeader>
    )}
    <VenueShortcutCheatsheet open={cheatOpen} onClose={() => setCheatOpen(false)} shortcuts={shortcuts} />

    <OfflineBanner
      feature="Scouting"
      fromCache={fromCache}
      force={online && syncState !== "idle" && counts.entries + counts.media > 0}
      variant={syncState === "degraded" ? "degraded" : syncState === "syncing" ? "syncing" : "offline"}
      detail={offlineDetail}
    />

    <ScoutQuarantinePanel
      items={quarantine}
      onRetry={(clientId) => void retryQuarantineItem(clientId)}
      onDiscard={(clientId) => void discardQuarantineItem(clientId)}
    />

    {shell === "empty" && tab !== "conflicts" && tab !== "handoff" && tab !== "trust" ? (
      <>
        <EmptyState
          soft
          className="scout-shell-empty"
          badge="Forms required"
          badgeTone="setup"
          title={`No ${type} scouting form yet`}
          description={
            data?.canManageSchemas
              ? "Create starter match and pit forms for this season, or build a custom form and publish it."
              : "Ask an owner or admin to publish scouting forms for this event."
          }
        >
          {data?.canManageSchemas ? (
            <div className="scout-empty-actions">
              <Button variant="primary" type="button" onClick={() => void createStarterForms()}>
                Create starter forms
              </Button>
              <Button as="a" variant="secondary" href={hubHref("/competition", "forms", orgId)}>
                Custom form builder
              </Button>
            </div>
          ) : (
            <Button as="a" variant="primary" href={hubHref("/competition", "forms", orgId)}>
              Open Form builder
            </Button>
          )}
        </EmptyState>
        <ScoutingNextActionsPanel actions={formEmptyActions} />
      </>
    ) : null}

    {data?.eventKey ? (
      <Panel className="scout-event-strip" style={{ minHeight: "auto", marginBottom: 14 }}>
        <strong>{data.eventKey}</strong>
        <span className="app-muted">Forms and assignments are cached on this device.</span>
      </Panel>
    ) : null}

    <ToolStrip
      aria-label="Scouting views"
      value={tab}
      onChange={onTabChange}
      items={[
        { id: "match", label: "Match" },
        { id: "pit", label: "Pit" },
        { id: "handoff", label: "QR handoff" },
        { id: "conflicts", label: "Conflicts" },
        { id: "trust", label: "Trust & coverage" },
      ]}
    />

    {tab === "trust" ? (
      <ScoutingTrustPanel orgId={orgId} eventKey={data?.eventKey ?? null} />
    ) : tab === "handoff" ? (
      <ScoutHandoffPanel
        orgId={orgId}
        eventKey={data?.eventKey ?? null}
        schemaId={schema?.id ?? null}
        entryType={type === "pit" ? "pit" : "match"}
        onSynced={() => {
          void refreshCounts();
          void sync();
        }}
        onMessage={setMessage}
      />
    ) : tab === "conflicts" ? (
      <Panel className="scout-conflicts-panel">
        <header className="scout-conflicts-heading">
          <div>
            <h2>Which scout was right?</h2>
            <p className="app-muted">
              Pick the winning entry for each field conflict. Coaches resolve; every decision is audited.
            </p>
          </div>
          <Button variant="secondary" type="button" onClick={() => void loadConflicts()}>
            Refresh
          </Button>
        </header>
        {conflicts.length === 0 ? (
          <p className="app-muted">
            No disagreements for this event yet. They appear when two scouts submit overlapping fields.
          </p>
        ) : (
          <ul className="scout-conflict-list">
            {conflicts.map((conflict) => {
              const id = String(conflict.id);
              const status = String(conflict.status);
              const candidates = (Array.isArray(conflict.candidates)
                ? conflict.candidates
                : []) as ConflictCandidate[];
              const selected = selectedWinners[id];
              const selectedCandidate = candidates.find((c) => c.entryId === selected);
              const audit = (Array.isArray(conflict.audit) ? conflict.audit : []) as Array<{
                id: string;
                action: string;
                actorName: string;
                createdAt: string;
              }>;
              return (
                <li key={id} className={`scout-conflict-card status-${status}`}>
                  <div className="scout-conflict-meta">
                    <strong>
                      {String(conflict.matchKey)} · {String(conflict.teamKey)}
                    </strong>
                    <span className="app-badge">{String(conflict.fieldKey)}</span>
                    <span className={`scout-conflict-status ${status}`}>{status}</span>
                  </div>
                  {status === "open" ? (
                    <>
                      <p className="scout-conflict-prompt">Who got this field right?</p>
                      <div className="scout-winner-grid" role="radiogroup" aria-label="Which scout was right">
                        {candidates.map((candidate) => {
                          const active = selected === candidate.entryId;
                          return (
                            <button
                              key={candidate.entryId}
                              type="button"
                              role="radio"
                              aria-checked={active}
                              className={`scout-winner-option${active ? " selected" : ""}`}
                              onClick={() =>
                                setSelectedWinners((prev) => ({ ...prev, [id]: candidate.entryId }))
                              }
                            >
                              <em>{candidate.scoutName ?? "Scout"}</em>
                              <strong>
                                {typeof candidate.value === "string" ||
                                typeof candidate.value === "number" ||
                                typeof candidate.value === "boolean"
                                  ? String(candidate.value)
                                  : JSON.stringify(candidate.value)}
                              </strong>
                              <small>{active ? "Selected as right" : "Tap if this scout was right"}</small>
                            </button>
                          );
                        })}
                      </div>
                      {!candidates.length ? (
                        <p className="app-muted">Entry candidates load after refresh.</p>
                      ) : null}
                      <div className="scout-conflict-actions">
                        <Button variant="primary" type="button" disabled={!selected} onClick={() => void reviewConflict(id, "resolved")}>
                          {selectedCandidate
                            ? `${selectedCandidate.scoutName ?? "Scout"} was right`
                            : "Pick a scout"}
                        </Button>
                        <Button variant="secondary" type="button" onClick={() => void reviewConflict(id, "dismissed")}>
                          Dismiss
                        </Button>
                      </div>
                    </>
                  ) : (
                    <div className="scout-conflict-resolved">
                      <p>
                        {conflict.winningScoutName
                          ? `${String(conflict.winningScoutName)} was right`
                          : `Marked ${status}`}
                      </p>
                      <small className="app-muted">
                        {conflict.reviewedByName
                          ? `Reviewed by ${String(conflict.reviewedByName)}`
                          : "Reviewed"}
                        {conflict.reviewedAt
                          ? ` · ${new Date(String(conflict.reviewedAt)).toLocaleString()}`
                          : ""}
                      </small>
                    </div>
                  )}
                  {audit.length ? (
                    <details className="scout-conflict-audit">
                      <summary>Audit trail ({audit.length})</summary>
                      <ol>
                        {audit.map((event) => (
                          <li key={event.id}>
                            <strong>{event.action}</strong>
                            <span>
                              {event.actorName} · {new Date(event.createdAt).toLocaleString()}
                            </span>
                          </li>
                        ))}
                      </ol>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    ) : (
      <div className="scout-workbench">
        <Panel as="section" className="scout-form-panel">
          <header className="scout-form-heading">
            <div>
              <h2>{schema?.definition.title ?? `No ${type} form`}</h2>
              <p className="app-muted">Primary action: fill the form, then save.</p>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
              {payloadHasDraftContent(payload) || draftSavedAt ? (
                <span
                  className={`scout-draft-chip ${draftDirty ? "dirty" : draftSavedAt ? "saved" : ""}`}
                  role="status"
                  aria-live="polite"
                >
                  {draftDirty ? "Unsaved changes" : formatDraftSavedAgo(draftSavedAt)}
                </span>
              ) : null}
              <span className="app-badge">v{schema?.version ?? "—"}</span>
            </div>
          </header>

          <div className="scout-identity-lock" role="status">
            <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
            <strong>{data?.scoutIdentity?.displayName ?? "Signed-in member"}</strong>
            <small className="app-muted">
              {SCOUT_IDENTITY_LOCK_COPY.title}
              {data?.scoutIdentity?.userId ? ` · ${data.scoutIdentity.userId.slice(0, 8)}…` : ""}.{" "}
              {SCOUT_IDENTITY_LOCK_COPY.detail}
            </small>
          </div>

          {schemaBudget && schemaBudget.status !== "healthy" ? (
            <p className={`scout-budget-banner ${schemaBudget.status}`} role="status">
              {schemaBudget.message}
            </p>
          ) : null}

          {type === "match" ? (
            <FormRow
              label="Assignment"
              hint={
                !matchOptions.length
                  ? "No assignments or synced matches yet — sync TBA after the schedule is published."
                  : undefined
              }
            >
              <select
                value={`${matchKey}|${teamKey}`}
                onChange={(event) => {
                  const [match, team] = event.target.value.split("|");
                  setMatchKey(match ?? "");
                  setTeamKey(team ?? "");
                }}
              >
                <option value="|">Select match and team</option>
                {matchOptions.map((option) => (
                  <option key={`${option.matchKey}-${option.teamKey}`} value={`${option.matchKey}|${option.teamKey}`}>
                    {option.label}
                  </option>
                ))}
              </select>
            </FormRow>
          ) : (
            <FormRow label="Team key">
              <input
                value={teamKey}
                onChange={(event) => setTeamKey(event.target.value)}
                placeholder="frc254"
              />
            </FormRow>
          )}

          {liveConflicts.length ? (
            <div className="scout-official-flags" role="status">
              <strong>Live official checks</strong>
              <ul>
                {liveConflicts.map((flag) => (
                  <li
                    key={`${flag.fieldKey}-${flag.officialSource}-${flag.status}`}
                    data-status={flag.status}
                    data-soft={flag.soft ? "true" : "false"}
                  >
                    <b>{flag.fieldKey}</b>
                    <span>{flag.detail}</span>
                    {flag.status === "conflict" ? (
                      <small>
                        Scout {JSON.stringify(flag.scoutValue)} · Official {JSON.stringify(flag.officialValue)}
                      </small>
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {formFields.map((field) => (
            <Field
              key={field.key}
              field={field}
              value={payload[field.key]}
              flags={flagsByField.get(field.key) ?? []}
              historyHint={fieldConfidenceHint(trustByField.get(field.key))}
              disagreementRate={trustByField.get(field.key)?.disagreementRate ?? null}
              orgId={orgId}
              onChange={(value) => setPayload((current) => ({ ...current, [field.key]: value }))}
              onAttachRobotImage={
                field.type === "robot_image" || field.widget === "robot_image"
                  ? (file) => attachMedia(file, { fieldKey: field.key, tags: ["robot"] })
                  : undefined
              }
            />
          ))}

          <FormRow label="Scout confidence">
            <select
              value={confidence}
              onChange={(event) => setConfidence(event.target.value as typeof confidence)}
            >
              <option value="high">High</option>
              <option value="normal">Normal</option>
              <option value="low">Low — downweighted</option>
            </select>
          </FormRow>

          <ScoutVoiceNotesPanel
            orgId={orgId}
            eventKey={data?.eventKey ?? ""}
            matchKey={matchKey}
            teamKey={teamKey}
            entryType={type}
            pendingEntryClientId={entryClientId}
            formFields={formFields
              .filter(
                (field) =>
                  field.type !== "robot_image" &&
                  field.widget !== "robot_image" &&
                  // Section headers hold no answer, so a transcript has nowhere to land.
                  !isLayoutOnlyField(field),
              )
              .map((field) => ({ key: field.key, label: field.label }))}
            onApplyToForm={(transcript, fieldKey) => {
              if (!schema) return;
              setSource("voice");
              setPayload((current) =>
                applyVoiceTranscriptToForm(schema.definition, current, transcript, {
                  fieldKey,
                }).payload,
              );
            }}
            onStatus={setMessage}
            onQueuedMedia={() => {
              void refreshCounts();
              void sync();
            }}
          />

          {type === "pit" ? (
            <label className="scout-media">
              Queue pit photo/video
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(event) => event.target.files?.[0] && void attachMedia(event.target.files[0])}
              />
            </label>
          ) : null}

          <Button variant="primary" type="button" onClick={() => void submit()}>
            Save {online ? "& sync" : "offline"}
          </Button>
          {message ? (
            <p className="form-message" role="status">
              {message}
            </p>
          ) : null}
          {saveReceipt ? (
            <div className="scout-save-receipt" role="status">
              <div className="scout-save-receipt-head">
                <span className="eyebrow">Where your data went</span>
                <strong>
                  {saveReceipt.entryType === "pit" ? "Pit" : "Match"} entry for{" "}
                  {saveReceipt.teamKey}
                  {saveReceipt.matchKey ? ` · ${saveReceipt.matchKey}` : ""}
                </strong>
                <small className="app-muted">
                  {saveReceipt.offline
                    ? "Stored in this device outbox (org-isolated). Identity stays locked to your membership."
                    : "Queued for sync into your org’s scouting tables. Identity stays locked to your membership."}
                </small>
              </div>
              <ul className="scout-save-next">
                {scoutingPostSaveNextSteps(orgId, {
                  eventKey: data?.eventKey,
                  entryType: saveReceipt.entryType,
                }).map((step) => (
                  <li key={step.id}>
                    <Button as="a" variant="secondary" href={step.href}>
                      {step.label}
                    </Button>
                    <small className="app-muted">{step.detail}</small>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                className="text-button"
                onClick={() => setSaveReceipt(null)}
              >
                Dismiss
              </button>
            </div>
          ) : null}
        </Panel>

        <aside className="scout-side">
          <Panel className="scout-activity" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Accuracy leaderboard</h2>
            <p className="app-muted">
              Ranked by TBA-checked accuracy, not form volume. Full board lives under Trust &amp; coverage.
            </p>
            {trust?.leaderboard?.length ? (
              <ol className="scout-accuracy-mini">
                {trust.leaderboard.slice(0, 5).map((scout, index) => (
                  <li key={scout.userId}>
                    <span className="scout-accuracy-rank">{index + 1}</span>
                    <div>
                      <strong>{scout.name}</strong>
                      <small className="app-muted">
                        {scout.checks} TBA checks · {scout.entries} entries
                      </small>
                    </div>
                    <b>{scout.accuracy == null ? "—" : `${Math.round(scout.accuracy * 100)}%`}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="app-muted">Accuracy ranks appear after TBA score breakdowns validate entries.</p>
            )}
          </Panel>

          <Panel className="scout-activity" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Recent entries</h2>
            <p className="app-muted">
              The newest save wins for each entry. Scout, confidence, and source stay visible.
            </p>
            {data?.recentEntries && shouldShowScoutingRecentEntries(data.recentEntries.length) ? (
              <>
                <ExportButton
                  rows={data.recentEntries}
                  columns={SCOUT_ENTRY_CSV_COLUMNS}
                  feature="Scouting entries"
                  orgLabel={data.eventKey}
                  orgId={orgId}
                  size="sm"
                  provenance={`${
                    data.eventKey ?? "Active event"
                  } — the 30 most recent synced entries only. Anything still queued offline, and the rest of the event, is in the full export.`}
                />
                <ul className="scout-entry-list">
                  {data.recentEntries.map((entry) => (
                    <li key={entry.id}>
                      <strong>
                        {entry.matchKey ?? "PIT"} · {entry.teamKey}
                      </strong>
                      <span>
                        {entry.scoutName} · {entry.source}
                      </span>
                      <small className="app-muted">
                        {entry.confidence} confidence · {new Date(entry.updatedAt).toLocaleTimeString()}
                      </small>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="app-muted">No entries yet for this event.</p>
            )}
          </Panel>

          <Panel style={{ minHeight: "auto" }}>
            <button
              type="button"
              className="text-button"
              onClick={() => setShowFormula((open) => !open)}
            >
              {showFormula ? "Hide coach formula" : "Coach value formula"}
            </button>
            {showFormula ? (
              <div className="scout-formula">
                <p className="app-muted">Optional weighted score from numeric fields. Coach role required to save.</p>
                <FormRow label="Formula name">
                  <input
                    aria-label="Formula name"
                    placeholder="e.g. Pick value"
                    value={formulaName}
                    onChange={(event) => setFormulaName(event.target.value)}
                  />
                </FormRow>
                {schema?.definition.fields
                  .filter(
                    (field) =>
                      // Counters, ratings, and sliders store plain numbers too —
                      // a tap-tallied cycle count is exactly what a pick formula wants.
                      field.type === "number" ||
                      field.type === "counter" ||
                      field.type === "rating" ||
                      field.type === "slider",
                  )
                  .map((field) => (
                    <FormRow key={field.key} label={`${field.label} weight`}>
                      <input
                        type="number"
                        value={formulaWeights[field.key] ?? 0}
                        onChange={(event) =>
                          setFormulaWeights((current) => ({
                            ...current,
                            [field.key]: event.target.valueAsNumber,
                          }))
                        }
                      />
                    </FormRow>
                  ))}
                <Button variant="secondary" type="button" onClick={() => void saveFormula()}>
                  Save formula
                </Button>
              </div>
            ) : null}
          </Panel>
        </aside>
      </div>
    )}
  </main>
);
}
