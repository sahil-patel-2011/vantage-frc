"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
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
  FORM_BUILDER_RELATED_INCLUDE,
  addOption,
  classifyFormBuilderShell,
  definitionFromDraft,
  draftFromDefinition,
  formBuilderNextActions,
  formBuilderPublishBlockedReason,
  formBuilderPublishLabel,
  formBuilderRelatedLinks,
  formBuilderSetupSteps,
  formBuilderShellCopy,
  moveOption,
  moveQuestion,
  needsOptionEditor,
  newDraftQuestion,
  parseOptions,
  removeOption,
  resolveDraftPublishStatus,
  SCOUT_IDENTITY_LOCK_COPY,
  serializeOptions,
  updateOptionAt,
  validateDraft,
  type AnswerKind,
  type DraftQuestion,
  type FormBuilderNextAction,
  type FormBuilderShellKind,
} from "../../../lib/scouting/form-builder";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";

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

function OptionEditor({
  optionsText,
  disabled,
  kind,
  onChange,
}: {
  optionsText: string;
  disabled: boolean;
  kind: AnswerKind;
  onChange: (optionsText: string) => void;
}) {
  const options = parseOptions(optionsText);
  const rows = options.length ? options : ["", ""];

  function commit(next: string[]) {
    onChange(serializeOptions(next));
  }

  return (
    <div className="sfb-option-editor">
      <div className="sfb-option-editor-head">
        <span>Options</span>
        <small className="app-muted">
          {ANSWER_KIND_OPTIONS.find((o) => o.kind === kind)?.hint ?? "Edit choices"}
        </small>
      </div>
      <ul className="sfb-option-list">
        {rows.map((option, index) => (
          <li key={`opt-${index}`}>
            <input
              value={option}
              disabled={disabled}
              placeholder={`Option ${index + 1}`}
              aria-label={`Option ${index + 1}`}
              onChange={(event) => {
                const base = options.length ? options : ["", ""];
                commit(updateOptionAt(base, index, event.target.value));
              }}
            />
            <div className="sfb-option-actions">
              <button
                type="button"
                disabled={disabled || index === 0}
                aria-label={`Move option ${index + 1} up`}
                onClick={() => commit(moveOption(rows, index, index - 1))}
              >
                ↑
              </button>
              <button
                type="button"
                disabled={disabled || index === rows.length - 1}
                aria-label={`Move option ${index + 1} down`}
                onClick={() => commit(moveOption(rows, index, index + 1))}
              >
                ↓
              </button>
              <button
                type="button"
                disabled={disabled || rows.length <= 2}
                aria-label={`Remove option ${index + 1}`}
                onClick={() => commit(removeOption(rows, index))}
              >
                ✕
              </button>
            </div>
          </li>
        ))}
      </ul>
      <button
        type="button"
        className="app-button secondary"
        disabled={disabled}
        onClick={() => commit(addOption(options.length ? options : ["", ""], ""))}
      >
        Add option
      </button>
    </div>
  );
}

function FormBuilderRelatedStrip({ orgId }: { orgId?: string | null }) {
  const links = formBuilderRelatedLinks(orgId, {
    include: [...FORM_BUILDER_RELATED_INCLUDE],
  });
  if (!links.length) return null;
  return (
    <nav className="product-hub-related sfb-related" aria-label="Related competition tools">
      {links.map((link) => (
        <a key={link.id} className="app-button secondary" href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function FormBuilderNextActionsPanel({ actions }: { actions: FormBuilderNextAction[] }) {
  if (!actions.length) return null;
  return (
    <section
      className="app-card soft-panel edc-next-actions sfb-next-actions"
      aria-label="Next actions"
    >
      <header>
        <h2>Next actions</h2>
        <p className="app-muted">Scouting and Coverage — never DEMO fields.</p>
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

function FormBuilderShell({
  orgId,
  shell,
  entryType,
  error,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: FormBuilderShellKind;
  entryType?: EntryType;
  error?: string;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = formBuilderNextActions({ orgId, shell, entryType });
  const copy = formBuilderShellCopy(shell, { entryType });
  const steps = shell === "setup" ? formBuilderSetupSteps(orgId) : [];
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const commandHref = hubHref("/competition", "command", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const coverageHref = withOrgHref("/scouting/lineup", orgId);

  return (
    <main className="module-page sfb-page soft-gate">
      <PageHeader
        breadcrumbs="Competition / Form builder"
        title="Scouting form builder"
        description="Publish versioned match or pit schemas. Scouts and Coverage stay blank until a real version exists — never DEMO fields."
      >
        <FormBuilderRelatedStrip orgId={orgId} />
      </PageHeader>
      {children}
      <EmptyState
        soft
        className="sfb-shell-empty"
        badge={
          shell === "setup"
            ? "Setup required"
            : shell === "error"
              ? "Unavailable"
              : copy.badge
        }
        badgeTone="setup"
        title={copy.title}
        description={error ?? copy.description}
        aria-busy={shell === "loading"}
      >
        {shell === "error" && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : workspaceHref}>
            {orgId ? "Set active event" : "Select workspace"}
          </a>
        ) : null}
        {shell === "empty" ? (
          <>
            <a className="app-button secondary" href={scoutingHref}>
              Open Scouting
            </a>
            <a className="app-button secondary" href={coverageHref}>
              Open Coverage
            </a>
          </>
        ) : null}
        {shell === "setup" && steps.length > 0 ? (
          <ol className="sfb-setup-steps">
            {steps.map((step) => (
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
      </EmptyState>
      {shell !== "loading" ? <FormBuilderNextActionsPanel actions={actions} /> : null}
    </main>
  );
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
      <FormRow label={label} hint="Camera or gallery — stored per organization">
        <div className="sfb-robot-image-preview">
          <div className="sfb-robot-image-actions">
            <span className="app-button secondary" aria-disabled>
              Camera
            </span>
            <span className="app-button secondary" aria-disabled>
              Gallery
            </span>
          </div>
          <span className="app-muted">Live entry lets scouts capture or pick photos offline.</span>
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

export default function FormsClient({ orgId, embedded = false }: { orgId: string; embedded?: boolean }) {
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
        if (patch.kind === "mc" || patch.kind === "dropdown") {
          const opts = parseOptions(next.optionsText);
          if (opts.length < 2) next.optionsText = "Option A, Option B";
        }
        return next;
      }),
    );
  }

  async function publish() {
    setMessage("");
    const blocked = formBuilderPublishBlockedReason({
      canManageSchemas: Boolean(payload?.canManageSchemas),
      year,
      eventKey: payload?.eventKey,
      validation,
      acknowledgeBudget,
    });
    if (blocked) {
      setMessage(blocked);
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
      setMessage(
        `Published ${type} form v${body.version}. Open Scouting after sync — Coverage stays blank until real entries exist.`,
      );
      await load();
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  if (loadError && !payload) {
    return (
      <FormBuilderShell
        orgId={orgId}
        shell="error"
        entryType={type}
        error={loadError}
        onRetry={() => void load()}
      />
    );
  }

  if (!payload) {
    return <FormBuilderShell orgId={orgId} shell="loading" entryType={type} />;
  }

  const currentSchema = payload.schemas.find((schema) => schema.type === type);
  const publishStatus = resolveDraftPublishStatus({
    published: currentSchema
      ? { version: currentSchema.version, definition: currentSchema.definition }
      : null,
    draftTitle: title,
    draftQuestions: questions,
  });
  const shell = classifyFormBuilderShell({
    orgId,
    eventKey: payload.eventKey,
    year: payload.year ?? year,
    hasPublishedSchema: Boolean(currentSchema),
  });
  const publishBlocked = formBuilderPublishBlockedReason({
    canManageSchemas: payload.canManageSchemas,
    year,
    eventKey: payload.eventKey,
    validation,
    acknowledgeBudget,
  });
  const publishLabel = formBuilderPublishLabel({
    busy,
    entryType: type,
    status: publishStatus,
  });
  const readyActions = formBuilderNextActions({
    orgId,
    shell: "ready",
    eventKey: payload.eventKey,
    canManageSchemas: payload.canManageSchemas,
    entryType: type,
  });
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const coverageHref = withOrgHref("/scouting/lineup", orgId);
  const commandHref = hubHref("/competition", "command", orgId);

  if (shell === "setup") {
    return (
      <FormBuilderShell orgId={orgId} shell="setup" entryType={type}>
        {!payload.canManageSchemas ? (
          <EmptyState
            badge="Coach role"
            badgeTone="setup"
            title="View only"
            description="Owners and admins publish scouting forms. You can still preview drafts after an event is set."
          />
        ) : null}
      </FormBuilderShell>
    );
  }

  return (
    <main className="module-page sfb-page">
      <PageHeader
        breadcrumbs="Competition / Form builder"
        title="Scouting form builder"
        description="Configure required fields, preview, and publish versioned match or pit schemas — never DEMO fields."
      >
        <div className="sfb-toolbar">
          <FormBuilderRelatedStrip orgId={orgId} />
          <button
            type="button"
            className="app-button"
            disabled={busy || Boolean(publishBlocked)}
            title={publishBlocked ?? publishStatus.detail}
            onClick={() => void publish()}
          >
            {publishLabel}
          </button>
        </div>
      </PageHeader>

      {shell === "empty" ? (
        <EmptyState
          soft
          className="sfb-shell-empty"
          badge="Not published"
          badgeTone="setup"
          title={formBuilderShellCopy("empty", { entryType: type }).title}
          description={formBuilderShellCopy("empty", { entryType: type }).description}
        >
          <a className="app-button secondary" href={scoutingHref}>
            Open Scouting
          </a>
          <a className="app-button secondary" href={coverageHref}>
            Open Coverage
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

      <div
        className={`sfb-status sfb-status-${publishStatus.kind}`}
        role="status"
        aria-live="polite"
      >
        <span className="sfb-status-pill">{publishStatus.label}</span>
        <small className="app-muted">{publishStatus.detail}</small>
      </div>

      {publishBlocked && payload.canManageSchemas ? (
        <p className="sfb-publish-blocked" role="status">
          {publishBlocked}
          {!payload.eventKey || year == null ? (
            <>
              {" "}
              <a href={commandHref}>Set active event</a>
            </>
          ) : null}
        </p>
      ) : null}

      <div className="sfb-identity-lock" role="status">
        <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
        <strong>{SCOUT_IDENTITY_LOCK_COPY.title}</strong>
        <small className="app-muted">{SCOUT_IDENTITY_LOCK_COPY.detail}</small>
      </div>

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
              <div className="sfb-identity-lock" role="status">
                <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
                <strong>Signed-in member</strong>
                <small className="app-muted">
                  Live entry binds to membership userId — no free-text scout name field.
                </small>
              </div>
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
                    Toggle required, edit MC/dropdown options, and reorder with Move up / Move down.
                  </p>
                </div>
              </header>
              <div className="sfb-questions">
                {questions.map((question, index) => (
                  <article key={question.id} className="sfb-question">
                    <div className="sfb-question-head">
                      <strong>
                        Q{index + 1}
                        <span className="sfb-question-order"> · #{index + 1}</span>
                        {question.required ? (
                          <span className="sfb-required-badge">Required</span>
                        ) : (
                          <span className="sfb-optional-badge">Optional</span>
                        )}
                      </strong>
                      <div className="sfb-question-actions">
                        <button
                          type="button"
                          disabled={!payload.canManageSchemas || index === 0}
                          aria-label={`Move question ${index + 1} up`}
                          onClick={() => setQuestions((prev) => moveQuestion(prev, index, index - 1))}
                        >
                          Move up
                        </button>
                        <button
                          type="button"
                          disabled={!payload.canManageSchemas || index === questions.length - 1}
                          aria-label={`Move question ${index + 1} down`}
                          onClick={() => setQuestions((prev) => moveQuestion(prev, index, index + 1))}
                        >
                          Move down
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
                    {needsOptionEditor(question.kind) ? (
                      <OptionEditor
                        optionsText={question.optionsText}
                        disabled={!payload.canManageSchemas}
                        kind={question.kind}
                        onChange={(optionsText) => updateQuestion(question.id, { optionsText })}
                      />
                    ) : (
                      <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
                        {ANSWER_KIND_OPTIONS.find((o) => o.kind === question.kind)?.hint}
                      </p>
                    )}
                    <label className={`sfb-check sfb-required-toggle${question.required ? " is-on" : ""}`}>
                      <input
                        type="checkbox"
                        checked={question.required}
                        disabled={!payload.canManageSchemas}
                        onChange={(event) =>
                          updateQuestion(question.id, { required: event.target.checked })
                        }
                      />
                      <span>
                        <strong>Required</strong>
                        <small className="app-muted">
                          {question.required
                            ? "Scouts must answer before save"
                            : "Optional — scouts can skip"}
                        </small>
                      </span>
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
            <h2>Publish status</h2>
            <p className={`sfb-status-inline sfb-status-${publishStatus.kind}`}>
              <strong>{publishStatus.label}</strong>
              <span className="app-muted">{publishStatus.detail}</span>
            </p>
            <p className="app-muted" style={{ margin: "8px 0" }}>
              {publishStatus.kind === "unpublished"
                ? "Scouts will not see this form until you publish. Then open Scouting or Coverage."
                : publishStatus.kind === "draft_changes"
                  ? "Live scouting keeps the published version until you publish these edits."
                  : "This draft matches the live form. Republish only if you need a new version pin."}
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
            <div className="sfb-publish-actions">
              <button
                type="button"
                className="app-button"
                disabled={busy || Boolean(publishBlocked)}
                title={publishBlocked ?? publishStatus.detail}
                onClick={() => void publish()}
              >
                {publishLabel}
              </button>
              <a className="app-button secondary" href={scoutingHref}>
                Open Scouting
              </a>
              <a className="app-button secondary" href={coverageHref}>
                Open Coverage
              </a>
            </div>
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
          <FormBuilderNextActionsPanel actions={readyActions} />
        </aside>
      </div>
    </main>
  );
}
