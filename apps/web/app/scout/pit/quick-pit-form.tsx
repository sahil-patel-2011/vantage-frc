"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FieldDefinition, ScoutSchema, SyncEntry } from "@vantage/scouting";
import { isLayoutOnlyField, recordScoutAction, undoableScoutAction, undoScoutAction, validatePayload } from "@vantage/scouting";
import { isScoutIdentityField } from "@vantage/scouting/identity";
import { visibleFields } from "../../../lib/scouting/context-visible";
import { answersToSave } from "../../../lib/scouting/entry-answers";
import { clearScoutDraft, readScoutDraft, scoutDraftStorageKey, writeScoutDraft } from "../../../lib/scouting/draft-autosave";
import { stepCounter } from "../../../lib/scouting/quick-scout";
import { queueEntry, stableClientId } from "../../../lib/scout-offline";
import { myReports, type Bootstrap } from "../../scouting/scouting-model";
import { QuickTile } from "../match/quick-scout-tiles";

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
  schema,
  teamKey,
  nickname,
  fullFormHref,
  onSaved,
  onChangeTeam,
}: {
  orgId: string;
  data: Bootstrap;
  schema: ScoutSchema;
  teamKey: string;
  nickname: string | null;
  fullFormHref: string;
  onSaved(teamKey: string): void;
  onChangeTeam(): void;
}) {
  const draftKey = scoutDraftStorageKey({
    userId: data.scoutIdentity?.userId,
    orgId,
    eventKey: data.eventKey ?? "",
    entryType: "pit",
    teamKey,
  });
  const fields = useMemo(() => schema.definition.fields.filter((field) => !isScoutIdentityField(field)), [schema]);
  const [initial] = useState(() => {
    const draft = readScoutDraft(draftKey);
    if (draft && (!draft.schemaId || draft.schemaId === schema.id)) {
      return { payload: draft.payload, clientId: draft.clientId ?? stableClientId(), editing: false };
    }
    const earlier = myReports(data).find((entry) => entry.type === "pit" && entry.teamKey === teamKey);
    if (earlier?.payload && (!earlier.schemaId || earlier.schemaId === schema.id)) {
      return { payload: earlier.payload, clientId: earlier.clientId ?? stableClientId(), editing: true };
    }
    return { payload: {}, clientId: stableClientId(), editing: false };
  });
  const [payload, setPayload] = useState<Record<string, unknown>>(initial.payload);
  const [dirty, setDirty] = useState(false);
  const [issues, setIssues] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(
    initial.editing ? "You visited this pit already. Saving replaces your earlier report." : null,
  );
  const payloadRef = useRef(payload);
  payloadRef.current = payload;
  const savingRef = useRef(false);

  const visible = useMemo(() => visibleFields(fields, payload), [fields, payload]);
  const groups = useMemo(() => groupBySection(visible), [visible]);
  const answered = visible.filter((field) => !isLayoutOnlyField(field) && payload[field.key] !== undefined && payload[field.key] !== "").length;
  const answerable = visible.filter((field) => !isLayoutOnlyField(field)).length;

  useEffect(() => {
    if (!dirty || !draftKey) return;
    writeScoutDraft(draftKey, {
      payload,
      confidence: "normal",
      matchKey: "",
      teamKey,
      clientId: initial.clientId,
      schemaId: schema.id,
      schema,
      source: "manual",
    });
  }, [dirty, draftKey, payload, teamKey, initial.clientId, schema]);

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
    onSaved(teamKey);
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

      <p className="qs-fineprint qs-pit-hint">Record what you can see and what the team tells you. Skip anything you did not get to ask.</p>

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
          Open the full form
        </a>
        <button type="button" className="qs-primary qs-save" onClick={() => void save()} disabled={saving}>
          {saving ? "Saving…" : "Save pit visit"}
        </button>
      </div>
    </div>
  );
}
