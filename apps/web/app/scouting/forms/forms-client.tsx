"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  type EntryType,
  type SchemaDefinition,
  type ScoutSchema,
} from "@vantage/scouting";
import { EmptyState, FormRow, PageHeader, Panel, TabBar } from "../../../components/ui";
import {
  ANSWER_KIND_OPTIONS,
  DRIVETRAIN_OPTIONS_TEXT,
  definitionFromDraft,
  draftFromDefinition,
  moveQuestion,
  newDraftQuestion,
  parseOptions,
  validateDraft,
  type AnswerKind,
  type DraftQuestion,
} from "../../../lib/scouting/form-builder";

type SchemasPayload = {
  eventKey: string | null;
  year: number | null;
  schemas: ScoutSchema[];
  canManageSchemas: boolean;
};

type Mode = "edit" | "preview";

function defaultQuestions(type: EntryType): DraftQuestion[] {
  if (type === "pit") {
    return [
      newDraftQuestion({
        label: "Drivetrain",
        kind: "drivetrain",
        optionsText: DRIVETRAIN_OPTIONS_TEXT,
      }),
      newDraftQuestion({ label: "Robot images", kind: "robot_image" }),
      newDraftQuestion({ label: "Notes", kind: "free" }),
    ];
  }
  return [
    newDraftQuestion({ label: "Auto score", kind: "number" }),
    newDraftQuestion({ label: "Notes", kind: "free" }),
  ];
}

function PreviewField({ question }: { question: DraftQuestion }) {
  const options = parseOptions(question.optionsText);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;

  if (question.kind === "yesno") {
    return (
      <label className="sfb-check">
        <input type="checkbox" disabled />
        <span>{label}</span>
      </label>
    );
  }
  if (question.kind === "mc") {
    return (
      <FormRow label={label}>
        <div className="sfb-radio-row" role="radiogroup">
          {(options.length ? options : ["Option A", "Option B"]).map((option) => (
            <label key={option}>
              <input type="radio" name={question.id} disabled />
              {option}
            </label>
          ))}
        </div>
      </FormRow>
    );
  }
  if (question.kind === "dropdown" || question.kind === "drivetrain") {
    const choices =
      question.kind === "drivetrain"
        ? options.length
          ? options
          : [...DEFAULT_DRIVETRAIN_OPTIONS]
        : options;
    return (
      <FormRow label={label}>
        <select disabled defaultValue="">
          <option value="">Select…</option>
          {choices.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
      </FormRow>
    );
  }
  if (question.kind === "robot_image") {
    return (
      <FormRow label={label} hint="Upload or capture — stored per organization">
        <div className="sfb-robot-image-preview">
          <span className="app-muted">Camera / gallery picker appears on the live form</span>
          <input type="file" accept="image/*" capture="environment" disabled multiple />
        </div>
      </FormRow>
    );
  }
  if (question.kind === "free") {
    return (
      <FormRow label={label}>
        <textarea disabled placeholder="Free-text notes…" />
      </FormRow>
    );
  }
  return (
    <FormRow label={label}>
      <input
        type={question.kind === "number" ? "number" : "text"}
        disabled
        placeholder={question.kind === "number" ? "0" : "Short answer"}
      />
    </FormRow>
  );
}

export default function FormsClient({ orgId }: { orgId: string }) {
  const [payload, setPayload] = useState<SchemasPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  const [type, setType] = useState<EntryType>("match");
  const [mode, setMode] = useState<Mode>("edit");
  const [title, setTitle] = useState("Match scouting");
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => defaultQuestions("match"));
  const [year, setYear] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [acknowledgeBudget, setAcknowledgeBudget] = useState(false);
  const [published, setPublished] = useState<{ id: string; version: number } | null>(null);

  const validation = useMemo(() => validateDraft(title, questions), [title, questions]);

  const loadSchemaIntoDraft = useCallback((schema: ScoutSchema | undefined, nextType: EntryType) => {
    if (schema?.definition) {
      const draft = draftFromDefinition(schema.definition);
      setTitle(draft.title);
      setQuestions(draft.questions.length ? draft.questions : defaultQuestions(nextType));
      setYear(schema.year);
      return;
    }
    setTitle(nextType === "pit" ? "Pit scouting" : "Match scouting");
    setQuestions(defaultQuestions(nextType));
  }, []);

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const response = await fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as SchemasPayload & { error?: string };
      if (!response.ok) {
        setLoadError(body.error ?? "Could not load scouting schemas.");
        return;
      }
      setPayload(body);
      if (body.year != null) setYear(body.year);
      const active = body.schemas.find((schema) => schema.type === type);
      loadSchemaIntoDraft(active, type);
    } catch {
      setLoadError("Could not reach the schemas API.");
    }
  }, [orgId, type, loadSchemaIntoDraft]);

  useEffect(() => {
    void load();
    // Mount / org only — type switches reuse the loaded schema list.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [orgId]);

  function switchType(next: EntryType) {
    setType(next);
    setPublished(null);
    setMessage("");
    setAcknowledgeBudget(false);
    const schema = payload?.schemas.find((entry) => entry.type === next);
    loadSchemaIntoDraft(schema, next);
    if (payload?.year != null) setYear(payload.year);
  }

  function updateQuestion(id: string, patch: Partial<DraftQuestion>) {
    setQuestions((prev) =>
      prev.map((q) => {
        if (q.id !== id) return q;
        const next = { ...q, ...patch };
        if (patch.kind === "drivetrain" && !next.optionsText.trim()) {
          next.optionsText = DRIVETRAIN_OPTIONS_TEXT;
        }
        return next;
      }),
    );
  }

  async function publish() {
    setMessage("");
    if (!payload?.canManageSchemas) {
      setMessage("Owner or admin role is required to publish forms.");
      return;
    }
    if (!validation.ok) {
      setMessage(validation.errors[0] ?? "Fix the form before publishing.");
      return;
    }
    if (year == null) {
      setMessage("Select an active event so the season year is known.");
      return;
    }
    if (validation.budget.status === "over_budget" && !acknowledgeBudget) {
      setMessage("This form is over the field budget — acknowledge to publish anyway.");
      return;
    }
    setBusy(true);
    try {
      const definition: SchemaDefinition = definitionFromDraft(title, questions);
      const response = await fetch("/api/scouting/schemas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          year,
          type,
          definition,
          acknowledgeBudget: acknowledgeBudget || undefined,
        }),
      });
      const body = (await response.json()) as {
        id?: string;
        version?: number;
        error?: string;
        acknowledgeRequired?: boolean;
      };
      if (!response.ok) {
        if (body.acknowledgeRequired) {
          setAcknowledgeBudget(false);
          setMessage(body.error ?? "Acknowledge the field budget to publish.");
        } else {
          setMessage(body.error ?? "Publish failed.");
        }
        return;
      }
      setPublished({ id: String(body.id), version: Number(body.version) });
      setMessage(`Published ${type} form v${body.version}. Scouts will see it on next sync.`);
      await load();
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !payload) {
    return (
      <main className="module-page sfb-page">
        <EmptyState title="Form builder unavailable" description={loadError} badge="Error" badgeTone="">
          <button type="button" className="app-button" onClick={() => void load()}>
            Retry
          </button>
        </EmptyState>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="module-page sfb-page">
        <EmptyState title="Loading form builder…" soft aria-busy />
      </main>
    );
  }

  const currentSchema = payload.schemas.find((schema) => schema.type === type);
  const needsOptions = (kind: AnswerKind) =>
    kind === "mc" || kind === "dropdown" || kind === "drivetrain";

  return (
    <main className="module-page sfb-page">
      <PageHeader
        navPath="/scouting/forms"
        title="Scouting form builder"
        description="Add drivetrain dropdowns and robot photo fields for match or pit forms, then publish a new schema version."
      >
        <div className="sfb-toolbar">
          <a
            className="app-button secondary"
            href={`/competition?tab=scouting&orgId=${encodeURIComponent(orgId)}`}
          >
            Open scouting
          </a>
          <button
            type="button"
            className="app-button"
            disabled={busy || !payload.canManageSchemas}
            onClick={() => void publish()}
          >
            {busy ? "Publishing…" : "Publish"}
          </button>
        </div>
      </PageHeader>

      {!payload.eventKey ? (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title="No active event"
          description="Pick an active event so the season year is known before publishing custom forms."
        >
          <a className="app-button secondary" href={`/command?orgId=${encodeURIComponent(orgId)}`}>
            Select event
          </a>
        </EmptyState>
      ) : null}

      {!payload.canManageSchemas ? (
        <EmptyState
          badge="Coach role"
          badgeTone="setup"
          title="View only"
          description="Owners and admins publish scouting forms. You can still preview the draft below."
        />
      ) : null}

      <TabBar
        aria-label="Form type"
        value={type}
        onChange={(id) => switchType(id as EntryType)}
        tabs={[
          { id: "match", label: "Match form" },
          { id: "pit", label: "Pit form" },
        ]}
      />

      <div className="sfb-meta">
        <FormRow label="Form title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!payload.canManageSchemas}
            maxLength={80}
          />
        </FormRow>
        <FormRow label="Season year">
          <input value={year ?? "—"} readOnly aria-readonly />
        </FormRow>
        <FormRow label="View">
          <select
            value={mode}
            onChange={(event) => setMode(event.target.value as Mode)}
            aria-label="Edit or preview"
          >
            <option value="edit">Edit questions</option>
            <option value="preview">Preview</option>
          </select>
        </FormRow>
      </div>

      {validation.budget.status !== "healthy" ? (
        <p className={`sfb-budget ${validation.budget.status}`} role="status">
          {validation.budget.message}
        </p>
      ) : null}

      {validation.budget.status === "over_budget" && payload.canManageSchemas ? (
        <label className="sfb-check" style={{ margin: "10px 0" }}>
          <input
            type="checkbox"
            checked={acknowledgeBudget}
            onChange={(event) => setAcknowledgeBudget(event.target.checked)}
          />
          <span>I understand this form is over the accuracy budget and still want to publish.</span>
        </label>
      ) : null}

      {!validation.ok && mode === "edit" ? (
        <ul className="sfb-errors" aria-live="polite">
          {validation.errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      ) : null}

      {message ? (
        <p className="sfb-message" role="status">
          {message}
        </p>
      ) : null}

      <div className="sfb-layout">
        <Panel as="section" className={mode === "preview" ? "sfb-preview" : undefined}>
          {mode === "preview" ? (
            <>
              <h2>{title || "Untitled form"}</h2>
              <p className="app-muted">Tablet preview — answers are not saved here.</p>
              <div className="sfb-preview-fields">
                {questions.map((question) => (
                  <PreviewField key={question.id} question={question} />
                ))}
              </div>
            </>
          ) : (
            <>
              <header className="sfb-question-head" style={{ marginBottom: 8 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Questions</h2>
                  <p className="app-muted" style={{ margin: "4px 0 0" }}>
                    Use Drivetrain type and Robot images for pit (or match) forms. Reorder with Up /
                    Down.
                  </p>
                </div>
              </header>
              <div className="sfb-questions">
                {questions.map((question, index) => (
                  <article key={question.id} className="sfb-question">
                    <div className="sfb-question-head">
                      <strong>
                        Q{index + 1}
                        {question.required ? " · required" : ""}
                      </strong>
                      <div className="sfb-question-actions">
                        <button
                          type="button"
                          disabled={!payload.canManageSchemas || index === 0}
                          onClick={() => setQuestions((prev) => moveQuestion(prev, index, index - 1))}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          disabled={!payload.canManageSchemas || index === questions.length - 1}
                          onClick={() => setQuestions((prev) => moveQuestion(prev, index, index + 1))}
                        >
                          Down
                        </button>
                        <button
                          type="button"
                          disabled={!payload.canManageSchemas || questions.length <= 1}
                          onClick={() =>
                            setQuestions((prev) => prev.filter((entry) => entry.id !== question.id))
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                    <div className="sfb-question-grid">
                      <FormRow label="Label">
                        <input
                          value={question.label}
                          disabled={!payload.canManageSchemas}
                          onChange={(event) => updateQuestion(question.id, { label: event.target.value })}
                          placeholder="What should scouts answer?"
                        />
                      </FormRow>
                      <FormRow label="Answer type">
                        <select
                          value={question.kind}
                          disabled={!payload.canManageSchemas}
                          onChange={(event) =>
                            updateQuestion(question.id, { kind: event.target.value as AnswerKind })
                          }
                        >
                          {ANSWER_KIND_OPTIONS.map((option) => (
                            <option key={option.kind} value={option.kind}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormRow>
                    </div>
                    {needsOptions(question.kind) ? (
                      <FormRow
                        label="Options"
                        hint={ANSWER_KIND_OPTIONS.find((o) => o.kind === question.kind)?.hint}
                      >
                        <textarea
                          value={question.optionsText}
                          disabled={!payload.canManageSchemas}
                          onChange={(event) =>
                            updateQuestion(question.id, { optionsText: event.target.value })
                          }
                          placeholder="Comma or newline separated"
                        />
                      </FormRow>
                    ) : (
                      <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
                        {ANSWER_KIND_OPTIONS.find((o) => o.kind === question.kind)?.hint}
                      </p>
                    )}
                    <label className="sfb-check">
                      <input
                        type="checkbox"
                        checked={question.required}
                        disabled={!payload.canManageSchemas}
                        onChange={(event) =>
                          updateQuestion(question.id, { required: event.target.checked })
                        }
                      />
                      <span>Required</span>
                    </label>
                  </article>
                ))}
              </div>
              <div className="sfb-add-row">
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={!payload.canManageSchemas}
                  onClick={() => setQuestions((prev) => [...prev, newDraftQuestion()])}
                >
                  Add question
                </button>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={!payload.canManageSchemas}
                  onClick={() =>
                    setQuestions((prev) => [
                      ...prev,
                      newDraftQuestion({
                        label: "Drivetrain",
                        kind: "drivetrain",
                        optionsText: DRIVETRAIN_OPTIONS_TEXT,
                      }),
                    ])
                  }
                >
                  Add drivetrain
                </button>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={!payload.canManageSchemas}
                  onClick={() =>
                    setQuestions((prev) => [
                      ...prev,
                      newDraftQuestion({ label: "Robot images", kind: "robot_image" }),
                    ])
                  }
                >
                  Add robot images
                </button>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={!payload.canManageSchemas}
                  onClick={() => setMode("preview")}
                >
                  Preview
                </button>
              </div>
            </>
          )}
        </Panel>

        <aside className="sfb-side" style={{ display: "grid", gap: 12 }}>
          <Panel>
            <h2>Published</h2>
            <p className="app-muted" style={{ margin: "0 0 8px" }}>
              Latest schema for this season. Publish creates a new version; entries stay pinned to the
              version they used.
            </p>
            {currentSchema ? (
              <ul className="sfb-published">
                <li>
                  <span>
                    <strong>{currentSchema.definition.title}</strong>
                    <br />
                    <span className="app-muted">
                      {currentSchema.type} · v{currentSchema.version} ·{" "}
                      {currentSchema.definition.fields.length} fields
                    </span>
                  </span>
                  <button
                    type="button"
                    className="app-button secondary"
                    onClick={() => loadSchemaIntoDraft(currentSchema, type)}
                  >
                    Load
                  </button>
                </li>
              </ul>
            ) : (
              <p className="app-muted">No {type} form published yet for this season.</p>
            )}
            {published ? (
              <p className="sfb-message" style={{ marginTop: 10 }}>
                Just published v{published.version}
              </p>
            ) : null}
          </Panel>
          <Panel>
            <h2>Answer types</h2>
            <ul className="sfb-published">
              {ANSWER_KIND_OPTIONS.map((option) => (
                <li key={option.kind}>
                  <span>
                    <strong>{option.label}</strong>
                    <br />
                    <span className="app-muted">{option.hint}</span>
                  </span>
                </li>
              ))}
            </ul>
          </Panel>
        </aside>
      </div>
    </main>
  );
}
