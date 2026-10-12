"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldDefinition, ScoutSchema, SyncEntry } from "@vantage/scouting";
import { isLayoutOnlyField, recordScoutAction, undoableScoutAction, undoScoutAction, validatePayload } from "@vantage/scouting";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { visibleFields } from "../../../lib/scouting/context-visible";
import { answersToSave, hasObservation } from "../../../lib/scouting/entry-answers";
import {
  clearScoutDraft,
  formatDraftSavedAgo,
  rememberActiveScoutDraft,
  scoutDraftStorageKey,
  writeScoutDraft,
} from "../../../lib/scouting/draft-autosave";
import { stepCounter } from "../../../lib/scouting/quick-scout";
import type { RobotFormChoice } from "../../../lib/scouting/robot-form";
import { MEDIA_ENABLED } from "../../../lib/media-availability";
import { queueEntry, stableClientId } from "../../../lib/scout-offline";
import type { Bootstrap } from "../../scouting/scouting-model";
import { QuickTile } from "../match/quick-scout-tiles";

export const PIT_EDITING_NOTE = "You visited this pit already. Saving replaces your earlier report.";
export const PIT_NOTHING_ANSWERED_NOTE =
  "Nothing answered yet, so this pit is not marked visited. Answer at least one question, or tap the team number at the top to skip this pit for now.";

function openingNotes(form: Extract<RobotFormChoice, { kind: "ready" }>): string | null {
  const notes = [
    form.editing ? PIT_EDITING_NOTE : null,
    form.note,
    form.from === "draft" && !form.note && !form.editing && form.draftSavedAt
      ? `Your answers for this pit are back. ${formatDraftSavedAgo(form.draftSavedAt)}.`
      : null,
  ].filter(Boolean);
  return notes.length ? notes.join(" ") : null;
}

type Group = { id: string; title: string | null; fields: FieldDefinition[] };

/** The form's own sections ("Drivetrain", "Intake"); questions before the first one need no heading. */
function groupBySection(fields: readonly FieldDefinition[]): Group[] {
  const groups: Group[] = [{ id: "_start", title: null, fields: [] }];
  for (const field of fields) {
    if (field.type === "section_header" || field.widget === "section") {
      groups.push({ id: field.key, title: field.label, fields: [] });
      continue;
    }
    if (isLayoutOnlyField(field)) continue;
    groups[groups.length - 1]!.fields.push(field);
  }
  return groups.filter((group) => group.fields.length > 0);
}

const identity = () => ({ id: crypto.randomUUID(), at: new Date().toISOString() });

/**
 * One team's pit visit: the team's own pit questions as big tiles, grouped by the form's
 * sections, saved to this phone first. A team you already visited opens your report, and
 * saving replaces it.
 */
export function QuickPitForm({
  orgId,
  data,
  form,
  teamKey,
  nickname,
  ownTeam = false,
  fullFormHref,
  onSaved,
  onChangeTeam,
}: {
  orgId: string;
  data: Bootstrap;
  /** The form this pit visit opens on and its starting answers (lib/scouting/robot-form.ts). */
  form: Extract<RobotFormChoice, { kind: "ready" }>;
  teamKey: string;
  nickname: string | null;
  /** Our own team's pit. */
  ownTeam?: boolean;
  fullFormHref: string;
  onSaved(saved: { teamKey: string; clientId: string }): void;
  onChangeTeam(): void;
}) {
  const schema: ScoutSchema = form.schema;
  const draftKey = scoutDraftStorageKey({
    userId: data.scoutIdentity?.userId,
    orgId,
    eventKey: data.eventKey ?? "",
    entryType: "pit",
    teamKey,
  });
  const fields = useMemo(() => schema.definition.fields.filter((field) => !isScoutIdentityField(field)), [schema]);
  const [initial] = useState(() => ({
    payload: form.payload ?? {},
    clientId: form.clientId ?? stableClientId(),
    editing: form.editing,
  }));
  const [payload, setPayload] = useState<Record<string, unknown>>(initial.payload);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(() => openingNotes(form));
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const savingRef = useRef(false);

  const visible = useMemo(() => visibleFields(fields, payload), [fields, payload]);
  const groups = useMemo(() => groupBySection(visible), [visible]);
  const answered = visible.filter((field) => !isLayoutOnlyField(field) && payload[field.key] !== undefined && payload[field.key] !== "").length;
  const answerable = visible.filter((field) => !isLayoutOnlyField(field)).length;

  // Kept on this phone after every answer, and remembered as the visit to pick up again
  // (Scouting home's "Pick up where you left off", and the "Draft" mark on the pit list).
  useEffect(() => {
    if (!dirty || !draftKey) return;
    const savedAt = writeScoutDraft(draftKey, {
      payload,
      confidence: "normal",
      matchKey: "",
      teamKey,
      clientId: initial.clientId,
      schemaId: schema.id,
      schema,
      source: "manual",
    });
    if (savedAt && data.scoutIdentity?.userId && data.eventKey) {
      rememberActiveScoutDraft(
        { userId: data.scoutIdentity.userId, orgId, eventKey: data.eventKey },
        { key: draftKey, type: "pit", matchKey: "", teamKey },
      );
    }
  }, [dirty, draftKey, payload, teamKey, initial.clientId, schema, data.scoutIdentity?.userId, data.eventKey, orgId]);

  const change = useCallback((key: string, compute: (current: unknown) => unknown) => {
    const before = payloadRef.current[key];
    const value = compute(before);
    const blank = value === undefined || value === null || value === "";
    if (JSON.stringify(blank ? undefined : value) === JSON.stringify(before ?? undefined)) return;
    const stamp = identity();
    setPayload((current) => {
      const next = { ...current };
      if (blank) delete next[key];
      else next[key] = value;
      const recorded = recordScoutAction(current, next, stamp);
      payloadRef.current = recorded;
      return recorded;
    });
    setIssues([]);
    setDirty(true);
  }, []);

  const canUndo = Boolean(undoableScoutAction(payload));
  function undo() {
    const stamp = identity();
    setPayload((current) => undoScoutAction(current, stamp));
    setDirty(true);
  }

  async function save() {
    if (savingRef.current || !data.eventKey) return;
    const answers = answersToSave(schema.definition.fields, payload);
    // A blank visit marked the pit visited with nothing in it, and nobody walked back to it.
    if (!hasObservation(answers)) {
      setIssues([]);
      setMessage(PIT_NOTHING_ANSWERED_NOTE);
      return;
    }
    const problems = validatePayload(schema.definition, answers);
    setIssues(problems);
    if (problems.length) {
      setMessage(`Not saved yet. ${problems.slice(0, 2).join(". ")}.`);
      return;
    }
    const entry: SyncEntry = {
      clientId: initial.clientId,
      orgId,
      type: "pit",
      eventKey: data.eventKey,
      teamKey,
      schemaId: schema.id,
      payload: answers,
      confidence: "normal",
      source: "manual",
      updatedAt: new Date().toISOString(),
    };
    savingRef.current = true;
    setSaving(true);
    try {
      await queueEntry(entry);
    } catch (error) {
      setMessage(error instanceof Error ? `Not saved yet. ${error.message}` : "Not saved yet. This device could not store it; keep this screen open and try again.");
      savingRef.current = false;
      setSaving(false);
      return;
    }
    clearScoutDraft(draftKey);
    savingRef.current = false;
    setSaving(false);
    onSaved({ teamKey, clientId: initial.clientId });
  }

  const invalid = new Set(fields.filter((field) => issues.some((issue) => issue.startsWith(field.label))).map((field) => field.key));

  return (
    <div className="qs-match qs-pit">
      <header className="qs-bar">
        <button type="button" className="qs-bar-robot" onClick={onChangeTeam} aria-label="Change team">
          <strong>{teamKey.replace(/^frc/, "")}</strong>
          <span>{nickname && nickname.trim().toLowerCase() !== `team ${teamKey.replace(/^frc/, "")}` ? nickname : "Pit visit"}</span>
        </button>
        <div className="qs-clock">
          <strong>
            {answered}/{answerable}
          </strong>
          <span>answered</span>
        </div>
        <button type="button" className="qs-undo" onClick={undo} disabled={!canUndo} aria-label="Undo last answer">
          <span aria-hidden="true">↶</span> Undo
        </button>
      </header>

      {message ? (
        <p className="qs-message" role="status">
          {message}
        </p>
      ) : null}

      {ownTeam ? (
        <p className="qs-message" role="note">
          This is your own team’s pit. It does not count toward the event’s pits to visit.
        </p>
      ) : null}

      <p className="qs-fineprint qs-pit-hint">
        Record what you can see and what the team tells you. Skip anything you did not get to ask.
        {/* Uploads are off for every team (lib/media-availability.ts); a scout will look for a camera. */}
        {MEDIA_ENABLED ? null : " Photos can’t be added here, so describe the robot in words instead."}
      </p>

      {groups.map((group) => (
        <section key={group.id} className="qs-section qs-pit-group" aria-label={group.title ?? "Pit questions"}>
          {group.title ? <h2>{group.title}</h2> : null}
          <div className="qs-grid">
            {group.fields.map((field) => (
              <QuickTile
                key={field.key}
                field={field}
                value={payload[field.key]}
                orgId={orgId}
                invalid={invalid.has(field.key)}
                onChange={(value) => change(field.key, () => value)}
                onStep={(delta) => change(field.key, (current) => stepCounter(field, current, delta))}
              />
            ))}
          </div>
        </section>
      ))}

      {issues.length ? (
        <div className="qs-issues" role="alert">
          <strong>Before you save</strong>
          <ul>
            {issues.slice(0, 6).map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="qs-save-bar">
        <a className="qs-link" href={fullFormHref}>
          Full form
        </a>
        <button type="button" className="qs-primary qs-save" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save pit visit"}
        </button>
      </div>
    </div>
  );
}
