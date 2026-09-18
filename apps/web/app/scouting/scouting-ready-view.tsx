"use client";

import type { Dispatch, SetStateAction } from "react";
import { applyVoiceTranscriptToForm, isLayoutOnlyField, type ScoutSchema } from "@vantage/scouting";
import { SCOUT_IDENTITY_LOCK_COPY } from "@vantage/scouting/identity";
import { fieldConfidenceHint, type FieldTrustSummary, type SchemaBudget } from "@vantage/scouting/trust";
import { EmptyState, FormRow, PageHeader, Panel, ToolStrip, Button } from "../../components/ui";
import { ExportButton } from "../../components/ui/export-button";
import { CopyShareLink } from "../../components/copy-share-link";
import { OfflineBanner } from "../../components/offline-banner";
import { ASSIGNMENTS_ARE_SUGGESTIONS_COPY, groupScoutTargets } from "../../lib/scouting/scout-target";
import { ScoutTargetByHand } from "./scout-target-by-hand";
import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { formatDraftSavedAgo, payloadHasDraftContent } from "../../lib/scouting/draft-autosave";
import { scoutingPostSaveNextSteps } from "../../lib/scouting/form-builder";
import { hubHref } from "../../lib/nav/hubs";
import type { QuarantinedItem } from "../../lib/scout-offline";
import {
  formatScoutingMetric,
  shouldShowScoutingRecentEntries,
  type ScoutingShellKind,
} from "../../lib/scouting/scouting-related";
import { ScoutingRelatedStrip } from "./scouting-chrome";
import { Field } from "./scouting-field";
import {
  SCOUT_ENTRY_CSV_COLUMNS,
  type Bootstrap,
  type ConflictCandidate,
  type OfficialFlag,
  type ScoutTab,
} from "./scouting-model";
import { ScoutQuarantinePanel } from "./scouting-quarantine";
import { ScoutReportViewer } from "./scout-report-viewer";
import ScoutHandoffPanel from "./scout-handoff-panel";
import ScoutVoiceNotesPanel from "./scout-voice-notes-panel";
import ScoutingTrustPanel from "./scouting-trust-panel";

type MatchOption = {
  matchKey: string;
  teamKey: string;
  label: string;
  /** One of yours. Sorted first and marked; never a restriction. */
  assigned?: boolean;
};
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
    {embedded ? null : (
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
      </div>
    </PageHeader>
    )}

    {/*
      Which event, whether we are online, and how much is still waiting to
      leave this phone are one question — "can I record right now, and is my
      work safe?" — so they share one line.

      They used to be two bands: a right-aligned pill with a Sync button, and
      below it an 86px card holding the event key and the sentence "Forms and
      assignments are cached on this device." On a 390×844 phone that pair cost
      144px of the 807px of chrome standing between a scout and the first form
      field. The sentence is also reassurance rather than information — the
      queue count says the same thing and says it with a number.
    */}
    <div className="scout-status-bar">
      {data?.eventKey ? <strong className="scout-status-event">Event {data.eventKey}</strong> : null}
      <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
        {online ? "Online" : "Offline"} · {formatScoutingMetric(counts.entries, true)} queued
        {embedded ? null : <> · {formatScoutingMetric(counts.media, true)} media</>}
      </span>
      <Button variant="secondary" type="button" onClick={() => void sync()}>
        Sync now
      </Button>
    </div>
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
              : "Build a scouting form for this event — anyone on the team can."
          }
        >
          {data?.canManageSchemas ? (
            <Button variant="primary" type="button" onClick={() => void createStarterForms()}>
              Create starter forms
            </Button>
          ) : (
            <Button as="a" variant="primary" href={hubHref("/competition", "forms", orgId)}>
              Open Form builder
            </Button>
          )}
        </EmptyState>
      </>
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
              {/* "Primary action: fill the form, then save." used to sit here.
                  It told someone looking at a form that the thing to do was
                  fill in the form, in the vocabulary of a design review, and
                  it cost a line above the first field on a phone. */}
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

          {/* One line, not three. On a 390px phone this block sat above the
              first field and helped push it off the bottom of the screen, on
              the page a scout opens between matches. The name is the part
              that matters every time; the reassurance about how it is enforced
              is on hover for whoever wants it. */}
          <div
            className="scout-identity-lock"
            role="status"
            title={`${SCOUT_IDENTITY_LOCK_COPY.title}. ${SCOUT_IDENTITY_LOCK_COPY.detail}`}
          >
            <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
            <strong>{data?.scoutIdentity?.displayName ?? "Signed-in member"}</strong>
          </div>

          {schemaBudget && schemaBudget.status !== "healthy" ? (
            <p className={`scout-budget-banner ${schemaBudget.status}`} role="status">
              {schemaBudget.message}
            </p>
          ) : null}

          {type === "match" ? (
            <>
              {/* Scouting is not assignment-gated. The list is a convenience:
                  your matches first, then every other robot on the schedule,
                  and a typed team number for anything not on it at all. */}
              {matchOptions.length ? (
                <FormRow
                  label="Who are you scouting?"
                  hint={
                    matchOptions.some((option) => option.assigned)
                      ? ASSIGNMENTS_ARE_SUGGESTIONS_COPY
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
                    {/* Grouped by match. Flat, a 36-match event is 216 rows in
                        one scroll, and the scout is looking for one of them
                        while the match they want is starting. */}
                    {groupScoutTargets(matchOptions).map((group) => (
                      <optgroup key={group.key} label={group.label}>
                        {group.options.map((option) => (
                          <option
                            key={`${option.matchKey}-${option.teamKey}`}
                            value={`${option.matchKey}|${option.teamKey}`}
                          >
                            {option.assigned ? `★ ${option.label} · yours` : option.label}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </FormRow>
              ) : null}

              {/* The only path at an offseason event, and on the first morning
                  of any event before the schedule lands. Previously an empty
                  dropdown meant match scouting was simply impossible. */}
              <ScoutTargetByHand
                eventKey={data?.eventKey ?? ""}
                matchKey={matchKey}
                teamKey={teamKey}
                startOpen={!matchOptions.length}
                onPick={(nextMatch, nextTeam) => {
                  setMatchKey(nextMatch);
                  setTeamKey(nextTeam);
                }}
              />
            </>
          ) : (
            <FormRow label="Team key">
              <input
                value={teamKey}
                onChange={(event) => setTeamKey(event.target.value)}
                placeholder="254"
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
            {online ? `Save this ${type}` : "Save on this phone"}
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
                    ? "Saved on this phone. It will upload when you have signal."
                    : "Saved. You can scout the next one."}
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
              Ranked by official-score checks, not form volume. Full board lives under Trust &amp; coverage.
            </p>
            {trust?.leaderboard?.length ? (
              <ol className="scout-accuracy-mini">
                {trust.leaderboard.slice(0, 5).map((scout, index) => (
                  <li key={scout.userId}>
                    <span className="scout-accuracy-rank">{index + 1}</span>
                    <div>
                      <strong>{scout.name}</strong>
                      <small className="app-muted">
                        {scout.checks} official checks · {scout.entries} entries
                      </small>
                    </div>
                    <b>{scout.accuracy == null ? "—" : `${Math.round(scout.accuracy * 100)}%`}</b>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="app-muted">Accuracy ranks appear after official score breakdowns validate entries.</p>
            )}
          </Panel>

          <Panel id="recent-entries" className="scout-activity" style={{ minHeight: "auto" }}>
            <h2 style={{ marginTop: 0 }}>Recent entries</h2>
            <p className="app-muted">
              Open a report to see the stored stats and any timed actions. Team leads can delete a report.
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
                <ScoutReportViewer
                  entries={data.recentEntries}
                  orgId={orgId}
                  canDelete={Boolean(data.canManageSchemas)}
                  onDeleted={() => void sync()}
                />
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
