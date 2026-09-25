"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { applyVoiceTranscriptToForm, isLayoutOnlyField, type ScoutSchema } from "@vantage/scouting";
import { SCOUT_IDENTITY_LOCK_COPY } from "@vantage/scouting/identity";
import { fieldConfidenceHint, type FieldTrustSummary, type SchemaBudget } from "@vantage/scouting/trust";
import { MEDIA_ENABLED } from "../../lib/media-availability";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { ScoutingTeamProfiles } from "./scouting-team-profiles";
import { CopyShareLink } from "../../components/copy-share-link";
import { OfflineBanner } from "../../components/offline-banner";
import { PitTeamField, ScoutTargetChoices } from "./scout-target-by-hand";
import { VenueShortcutCheatsheet, type VenueShortcut } from "../../hooks/use-venue-shortcuts";
import { formatDraftSavedAgo, payloadHasDraftContent } from "../../lib/scouting/draft-autosave";
import { scoutContext } from "../../lib/scouting/scout-context";
import { hubHref } from "../../lib/nav/hubs";
import type { QuarantinedItem } from "../../lib/scout-offline";
import {
  formatScoutingMetric,
  scoutEventLabel,
  type ScoutingShellKind,
} from "../../lib/scouting/scouting-related";
import { ScoutingRelatedStrip } from "./scouting-chrome";
import { Field } from "./scouting-field";
import { ScoutChoice } from "./scout-choice";
import { ScoutingLeadTools } from "./scouting-lead-tools";
import {
  type Bootstrap,
  type ConflictCandidate,
  type OfficialFlag,
  type SaveReceipt,
  type ScoutTab,
} from "./scouting-model";
import { ScoutQuarantinePanel } from "./scouting-quarantine";
import ScoutHandoffPanel from "./scout-handoff-panel";
import ScoutVoiceNotesPanel from "./scout-voice-notes-panel";
import ScoutingTrustPanel from "./scouting-trust-panel";
import { ScoutingReportTemplatePicker } from "./scouting-report-template-picker";
import { NextMatchCard } from "./next-match-card";
import { MatchTimer } from "./match-timer";
import { ScoutSaveConfirmation } from "./scout-save-confirmation";
import { ScoutViewSwitcher } from "./scout-view-switcher";
import "./match-mode.css";
import "./scout-flow.css";
import { PitProgress } from "./pit-progress";

const CONFIDENCE_OPTIONS = [
  { value: "high", label: "Sure" },
  { value: "normal", label: "OK" },
  { value: "low", label: "Guessing" },
];

/** Smooth unless the phone asks for less motion. */
function smoothOrInstant(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

type MatchOption = {
  matchKey: string;
  teamKey: string;
  label: string;
  /** One of yours. Sorted first and marked; never a restriction. */
  assigned?: boolean;
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
  /** Robots saved on this phone since the page opened, before the server list catches up. */
  savedHere: Array<{ matchKey: string; teamKey: string }>;
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
  /** "Uploaded 1 entry" — shown by the queue count, not under Save. */
  syncNote: string | null;
  saveReceipt: SaveReceipt | null;
  /** Put the entry just saved back in the form. */
  fixLastSave?: () => void;
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
  savedHere,
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
  syncNote,
  saveReceipt,
  fixLastSave,
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
  const context =
    type === "match" ? scoutContext({ matches: data?.matches ?? [], matchKey, teamKey }) : null;
  const canSave = Boolean(schema) && (type === "match" ? Boolean(matchKey && teamKey) : Boolean(teamKey));
  // What the card counts as scouted. The server list only refreshes on reload,
  // so after Save the card still thought the match just saved was next, and
  // showed "Back to next" on the match Save had moved to.
  const recentEntries = data?.recentEntries;
  const scouted = useMemo(() => [...(recentEntries ?? []), ...savedHere], [recentEntries, savedHere]);
  const formStartRef = useRef<HTMLSpanElement | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);
  const scrollToFormPending = useRef(false);

  // While a robot's form is open, a phone gives it the whole screen: the floating tab bar sat
  // on its + buttons and Save (soft-ui.css hides the bar under this class). The picker keeps it.
  const formOpen = Boolean(context);
  useEffect(() => {
    document.body.classList.toggle("is-scouting-form", formOpen);
    return () => document.body.classList.remove("is-scouting-form");
  }, [formOpen]);

  // Tapping a robot tile used to only outline the tile; the form it opened
  // started about 1,300px further down, under the match list, the typed-team
  // box and a card of focus buttons. Now the tap is the start of the form.
  const scrollToForm = useCallback(() => {
    formStartRef.current?.scrollIntoView({ behavior: smoothOrInstant(), block: "start" });
  }, []);
  const pickRobot = useCallback(
    (nextMatch: string, nextTeam: string) => {
      if (nextMatch === matchKey && nextTeam === teamKey) {
        scrollToForm();
        return;
      }
      // The bar and anchor render with the new pick; scroll once they exist.
      scrollToFormPending.current = true;
      setMatchKey(nextMatch);
      setTeamKey(nextTeam);
    },
    [matchKey, teamKey, scrollToForm, setMatchKey, setTeamKey],
  );
  useEffect(() => {
    if (!scrollToFormPending.current) return;
    scrollToFormPending.current = false;
    window.requestAnimationFrame(scrollToForm);
  }, [matchKey, teamKey, scrollToForm]);

  // The robot picked for you on arrival: selected, but the page stays where it is.
  const autoPickRobot = useCallback(
    (nextMatch: string, nextTeam: string) => {
      setMatchKey(nextMatch);
      setTeamKey(nextTeam);
    },
    [setMatchKey, setTeamKey],
  );

  const backToPicker = useCallback(() => {
    document
      .getElementById("scout-robot-picker")
      ?.scrollIntoView({ behavior: smoothOrInstant(), block: "start" });
  }, []);

  // After Save the scout is at the bottom of a cleared form. Take them to the
  // confirmation, which sits directly over the next robot to tap.
  const savedAt = saveReceipt?.savedAt;
  useEffect(() => {
    if (!savedAt) return;
    window.requestAnimationFrame(() => {
      document
        .getElementById("scout-save-confirmation")
        ?.scrollIntoView({ behavior: smoothOrInstant(), block: "start" });
    });
  }, [savedAt]);

// Inside the Competition hub there is already a <main>; one landmark, not two nested.
const Root = embedded ? "section" : "main";
return (
  <Root className={`module-page scout-page${embedded ? " is-embedded" : ""}`}>
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
      {scoutEventLabel({ eventName: data?.eventName, eventKey: data?.eventKey }) ? (
        <strong className="scout-status-event">
          {scoutEventLabel({ eventName: data?.eventName, eventKey: data?.eventKey })}
        </strong>
      ) : null}
      <span className={`scout-sync-pill ${online ? "online" : "offline"}`}>
        {online ? "Online" : "Offline"} · {formatScoutingMetric(counts.entries, true)} queued
        {embedded || counts.media === 0 ? null : <> · {formatScoutingMetric(counts.media, true)} files</>}
      </span>
      {/* Saving already sends an entry when there is signal. The button is for
          the moment something is actually waiting to go. */}
      {counts.entries + counts.media > 0 || syncState === "degraded" ? (
        <Button variant="secondary" type="button" onClick={() => void sync()}>
          Sync now
        </Button>
      ) : null}
      {syncNote ? (
        <span className="scout-sync-note" role="status">
          {syncNote}
        </span>
      ) : null}
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

    {shell === "empty" && tab !== "conflicts" && tab !== "handoff" && tab !== "trust" && tab !== "teams" ? (
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
              : // A student's job is to scout, not to design the form: say who sets it up and
                // that it will appear right here.
                `Your team hasn't published a ${type} scouting form yet. Ask a mentor or team lead to publish one — it shows up here as soon as they do.`
          }
        >
          {data?.canManageSchemas ? (
            <Button variant="primary" type="button" onClick={() => void createStarterForms()}>
              Create starter forms
            </Button>
          ) : (
            <Button as="a" variant="primary" href={hubHref("/team", "messages", orgId)}>
              Message your team
            </Button>
          )}
        </EmptyState>
      </>
    ) : null}

    <ScoutViewSwitcher
      tab={tab}
      onChange={onTabChange}
      orgId={orgId}
      embedded={embedded}
      lead={Boolean(data?.canManageSchemas)}
    />

    {tab === "teams" ? (
      /* The one screen that answers what the scouting was *for*. Everything
         else under this strip is about the process — coverage, conflicts,
         trust — and a team could finish a weekend able to say "94% covered"
         and unable to say which robot to pick. */
      <ScoutingTeamProfiles orgId={orgId} eventKey={data?.eventKey ?? null} />
    ) : tab === "trust" ? (
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
              {/* Whose name goes on the entry, as one quiet line. It was a
                  boxed "SCOUTING AS" card between the title and the robots. */}
              <p
                className="scout-identity-line"
                title={`${SCOUT_IDENTITY_LOCK_COPY.title}. ${SCOUT_IDENTITY_LOCK_COPY.detail}`}
              >
                {SCOUT_IDENTITY_LOCK_COPY.eyebrow}{" "}
                <strong>{data?.scoutIdentity?.displayName ?? "you"}</strong>
              </p>
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
              {/* The form's version number ("V1") meant nothing to a scout; the
                  form builder and the entry viewer still show it. */}
            </div>
          </header>

          {schemaBudget && schemaBudget.status !== "healthy" ? (
            <p className={`scout-budget-banner ${schemaBudget.status}`} role="status">
              {schemaBudget.message}
            </p>
          ) : null}

          {saveReceipt ? (
            <ScoutSaveConfirmation receipt={saveReceipt} onDismiss={() => setSaveReceipt(null)} onFix={fixLastSave} />
          ) : null}

          {type === "match" ? (
            <div id="scout-robot-picker" className="scout-robot-picker">
              {/* Scouting is not assignment-gated. The list is a convenience:
                  your matches first, then every other robot on the schedule,
                  and a typed team number for anything not on it at all. */}
              {data?.matches?.length ? (
                <NextMatchCard
                  matches={data.matches}
                  scouted={scouted}
                  assignments={data.assignments ?? []}
                  matchKey={matchKey}
                  teamKey={teamKey}
                  onPick={pickRobot}
                  onAutoPick={autoPickRobot}
                />
              ) : null}
              {data?.matches?.length ? (
                // With the robot tiles on screen, the full list and the typed
                // team are the exception. Open, they put about 300px between
                // the tile a scout just tapped and the form it opens.
                <details className="scout-other-target">
                  <summary>Another match, or a team that isn’t listed</summary>
                  <ScoutTargetChoices
                    matchOptions={matchOptions}
                    hasSchedule
                    eventKey={data?.eventKey ?? ""}
                    matchKey={matchKey}
                    teamKey={teamKey}
                    onPick={pickRobot}
                  />
                </details>
              ) : (
                <ScoutTargetChoices
                  matchOptions={matchOptions}
                  hasSchedule={false}
                  eventKey={data?.eventKey ?? ""}
                  matchKey={matchKey}
                  teamKey={teamKey}
                  onPick={pickRobot}
                />
              )}
            </div>
          ) : (
            <>
              <PitProgress orgId={orgId} teamKey={teamKey} onTeamKey={setTeamKey} />
              <PitTeamField teamKey={teamKey} onTeamKey={setTeamKey} />
            </>
          )}

          {type === "match" && context ? (
            <>
              {/* Where "Scout team 1323" lands. The bar under it sticks to the
                  top while the form scrolls, so the robot being counted, and
                  the match clock, stay in sight the whole way down. */}
              <span id="scout-form-start" className="scout-form-start" ref={formStartRef} aria-hidden="true" />
              <div className="scout-context-bar" role="group" aria-label="Robot you are scouting">
                <div className="scout-context-line">
                  <p>
                    <span className="scout-context-eyebrow">Scouting</span>{" "}
                    <strong>{context.teamNumber}</strong>
                    {context.matchLabel ? <> · {context.matchLabel}</> : null}
                    {context.stationLabel ? <span className="scout-context-station"> · {context.stationLabel}</span> : null}
                  </p>
                  <button type="button" className="scout-context-change" onClick={backToPicker}>
                    Change
                  </button>
                </div>
                {formFields.length ? (
                  <MatchTimer fields={formFields} resetKey={`${matchKey}|${teamKey}`} />
                ) : null}
              </div>
            </>
          ) : null}

          {type === "match" && formFields.length ? (
            <ScoutingReportTemplatePicker
              key={`${matchKey}-${teamKey}`}
              fields={formFields}
            />
          ) : null}

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

          {formFields.filter((field) => MEDIA_ENABLED || (field.type !== "robot_image" && field.widget !== "robot_image")).map((field) => (
            <Field
              key={field.key}
              anchorId={`scout-field-${encodeURIComponent(field.key)}`}
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

          {/* Stored as high / normal / low; a "Guessing" entry counts for less
              when the team's numbers are added up. */}
          <ScoutChoice
            label="How sure are you?"
            options={CONFIDENCE_OPTIONS}
            value={confidence}
            allowClear={false}
            onChange={(next) => {
              if (next === "high" || next === "normal" || next === "low") setConfidence(next);
            }}
          />

          {MEDIA_ENABLED ? <ScoutVoiceNotesPanel
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
          /> : null}

          {MEDIA_ENABLED && type === "pit" ? (
            <label className="scout-media">
              Queue pit photo/video
              <input
                type="file"
                accept="image/*,video/*"
                onChange={(event) => event.target.files?.[0] && void attachMedia(event.target.files[0])}
              />
            </label>
          ) : null}

          {/* Disabled, and saying why, until there is a robot to save it
              against. It used to accept the tap and answer with an error line
              below the button, after the scout had filled in the whole form. */}
          <Button
            variant="primary"
            type="button"
            className="scout-save-button"
            disabled={!canSave}
            onClick={() => {
              // Saving at "AUTO 0:02" was allowed without a word; a nudge, not a block. The nudge
              // was a browser confirm, whose Cancel looked like Save doing nothing on a phone: now
              // the button asks, and a second tap saves.
              if (document.documentElement.dataset.scoutTimer === "running" && !confirmRunning) {
                setConfirmRunning(true);
                return;
              }
              setConfirmRunning(false);
              void submit();
            }}
          >
            {confirmRunning && canSave
              ? "Tap again to save"
              : !canSave
              ? type === "match"
                ? "Pick a robot above to save"
                : "Type a team number above to save"
              : online
                ? `Save this ${type}`
                : "Save on this phone"}
          </Button>
          {confirmRunning ? (
            <p className="form-message scout-running-note" role="status">
              Match clock still running. Tap again to save now, or{" "}
              <button type="button" className="text-button" onClick={() => setConfirmRunning(false)}>
                keep counting
              </button>
            </p>
          ) : null}
          {message ? (
            <p className="form-message" role="status">
              {message}
            </p>
          ) : null}
        </Panel>

        <ScoutingLeadTools
          orgId={orgId}
          data={data}
          schema={schema}
          trust={trust}
          showFormula={showFormula}
          formulaName={formulaName}
          formulaWeights={formulaWeights}
          setShowFormula={setShowFormula}
          setFormulaName={setFormulaName}
          setFormulaWeights={setFormulaWeights}
          saveFormula={saveFormula}
          sync={sync}
        />
      </div>
    )}
  </Root>
);
}
