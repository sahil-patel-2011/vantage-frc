"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type EntryType, type FormResetBehavior, type SchemaDefinition, type ScoutSchema } from "@vantage/scouting";
import "../scouting.css";
import { OfflineBanner } from "../../../components/offline-banner";
import { EmptyState, FormRow, PageHeader, Panel, ToolStrip, Button } from "../../../components/ui";
import {
  ANSWER_KIND_OPTIONS,
  DRIVETRAIN_OPTIONS_TEXT,
  IMPORTED_FORM_DRAFT_KEY,
  classifyFormBuilderShell,
  definitionFromDraft,
  draftFromDefinition,
  formBuilderNextActions,
  formBuilderPublishBlockedReason,
  formBuilderPublishLabel,
  formBuilderShellCopy,
  moveQuestion,
  needsOptionEditor,
  needsSettingsEditor,
  newDraftQuestion,
  parseOptions,
  resolveDraftPublishStatus,
  retypeQuestion,
  RESET_BEHAVIOR_OPTIONS,
  SCOUT_IDENTITY_LOCK_COPY,
  STRATEGY_ROLE_OPTIONS,
  detectedRoleForQuestion,
  validateDraft,
  type AnswerKind,
  type DraftQuestion,
  type StrategyFieldRole,
} from "../../../lib/scouting/form-builder";
import { hubHref } from "../../../lib/nav/hubs";
import { FEATURE_API_TIMEOUT_MS } from "../../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { FormBuilderNextActionsPanel, FormBuilderRelatedStrip, FormBuilderShell } from "./forms-chrome";
import { defaultQuestions, type FormBuilderMode, type SchemasPayload } from "./forms-model";
import { OptionEditor } from "./forms-option-editor";
import { PreviewField } from "./forms-preview";
import { StudioSettingsEditor } from "./forms-settings-editor";

function isSchemasPayload(value: unknown): value is SchemasPayload {
  if (!value || typeof value !== "object") return false;
  const body = value as SchemasPayload;
  return Array.isArray(body.schemas) && typeof body.canManageSchemas === "boolean";
}

async function persistScoutFormsSnapshot(orgId: string, data: SchemasPayload): Promise<void> {
  const cacheOrg = orgId.trim();
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("scout-forms", cacheOrg, data);
  } catch {
    // Live scout forms already painted; IndexedDB is best-effort.
  }
}

export default function FormsClient({ orgId }: { orgId: string; embedded?: boolean }) {
  const [payload, setPayload] = useState<SchemasPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [type, setType] = useState<EntryType>("match");
  const [mode, setMode] = useState<FormBuilderMode>("edit");
  const [title, setTitle] = useState("Match scouting");
  const [questions, setQuestions] = useState(() => defaultQuestions("match"));
  const [year, setYear] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [acknowledgeBudget, setAcknowledgeBudget] = useState(false);
  const [published, setPublished] = useState<{ id: string; version: number } | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const payloadRef = useRef<SchemasPayload | null>(null);
  payloadRef.current = payload;

  const validation = useMemo(() => validateDraft(title, questions, type), [title, questions, type]);

  // One-shot handoff from the migrate page (undefined = not yet checked,
  // null = checked and nothing was waiting). Consumed inside loadSchemaIntoDraft
  // so the imported draft beats — rather than races — the initial schema fetch.
  const importedDraftRef = useRef<SchemaDefinition | null | undefined>(undefined);

  const loadSchemaIntoDraft = useCallback((schema: ScoutSchema | undefined, nextType: EntryType) => {
    if (importedDraftRef.current === undefined) {
      importedDraftRef.current = null;
      try {
        const raw = window.sessionStorage.getItem(IMPORTED_FORM_DRAFT_KEY);
        if (raw) {
          window.sessionStorage.removeItem(IMPORTED_FORM_DRAFT_KEY);
          const imported = JSON.parse(raw) as SchemaDefinition;
          const draft = draftFromDefinition(imported);
          importedDraftRef.current = imported;
          setTitle(draft.title);
          setQuestions(draft.questions.length ? draft.questions : defaultQuestions(nextType));
          setMessage("Imported from QRScout — review every question, then Publish. Nothing is live yet.");
          return;
        }
      } catch {
        // Malformed or blocked handoff payload: fall through to the normal load.
      }
    }
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
    let hadCache = Boolean(payloadRef.current);
    try {
      const cached = await getFeatureSnapshot<SchemasPayload>("scout-forms", orgId || "_");
      if (!payloadRef.current && cached?.data && isSchemasPayload(cached.data)) {
        setPayload(cached.data);
        if (cached.data.year != null) setYear(cached.data.year);
        const active = cached.data.schemas.find((schema) => schema.type === type);
        loadSchemaIntoDraft(active, type);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setLoadError("");
    setLoadErrorStatus(null);
    try {
      const response = await fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setPayload(null);
        setFromCache(false);
        setCachedAt(null);
        setLoadErrorStatus(response.status);
        setLoadError(
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Could not load scout forms.",
        );
        return;
      }
      if (!response.ok || !isSchemasPayload(body)) {
        if (hadCache || payloadRef.current) {
          setFromCache(true);
          setMessage("Could not refresh scout forms. Showing the last copy on this device.");
          setLoadError("");
          return;
        }
        setLoadErrorStatus(response.status);
        setLoadError(
          body && typeof body === "object" && "error" in body && typeof body.error === "string"
            ? body.error
            : "Could not load scout forms.",
        );
        return;
      }
      setPayload(body);
      if (body.year != null) setYear(body.year);
      const active = body.schemas.find((schema) => schema.type === type);
      loadSchemaIntoDraft(active, type);
      setFromCache(false);
      setCachedAt(null);
      await persistScoutFormsSnapshot(orgId, body);
    } catch {
      if (hadCache || payloadRef.current) {
        setFromCache(true);
        setMessage("Could not refresh scout forms. Showing the last copy on this device.");
        setLoadError("");
        return;
      }
      setLoadError("Could not load scout forms.");
    }
  }, [orgId, type, loadSchemaIntoDraft]);

  useEffect(() => {
    void load();
    // Mount / org only — type switches reuse the loaded schema list.
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

  /**
   * Change a question's answer type. Goes through `retypeQuestion` so the new
   * kind gets sensible defaults while the stored key stays put — renaming or
   * retyping a published field must never orphan the payloads saved under it.
   */
  function retypeQuestionById(id: string, kind: AnswerKind) {
    setQuestions((prev) => prev.map((q) => (q.id === id ? retypeQuestion(q, kind) : q)));
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
        errorStatus={loadErrorStatus}
        onRetry={() => void load()}
      >
        <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />
      </FormBuilderShell>
    );
  }

  if (!payload) {
    return (
      <FormBuilderShell orgId={orgId} shell="loading" entryType={type}>
        <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />
      </FormBuilderShell>
    );
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
  const commandHref = hubHref("/competition", "command", orgId);

  if (shell === "setup") {
    return (
      <FormBuilderShell orgId={orgId} shell="setup" entryType={type}>
        <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />
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
        description="Configure required fields, preview, and publish match or pit forms."
      >
        <div className="sfb-toolbar">
          <FormBuilderRelatedStrip orgId={orgId} />
          <Button variant="primary" type="button" disabled={busy || Boolean(publishBlocked)} title={publishBlocked ?? publishStatus.detail} onClick={() => void publish()}>
            {publishLabel}
          </Button>
        </div>
      </PageHeader>

      <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />

      {shell === "empty" ? (
        <EmptyState
          soft
          className="sfb-shell-empty"
          badge="Not published"
          badgeTone="setup"
          title={formBuilderShellCopy("empty", { entryType: type }).title}
          description={formBuilderShellCopy("empty", { entryType: type }).description}
        >
          <Button as="a" variant="primary" href={scoutingHref}>
            Open Scouting
          </Button>
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

      <ToolStrip
        aria-label="Form type"
        value={type}
        onChange={(id) => switchType(id as EntryType)}
        items={[
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
            onChange={(event) => setMode(event.target.value as FormBuilderMode)}
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

      {validation.pitClaim.status === "claimed_scoring" ? (
        <p className="sfb-budget caution" role="status">
          {validation.pitClaim.message}
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
                            retypeQuestionById(question.id, event.target.value as AnswerKind)
                          }
                        >
                          {ANSWER_KIND_OPTIONS.map((option) => (
                            <option key={option.kind} value={option.kind}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                      </FormRow>
                      <FormRow
                        label="Feeds strategy as"
                        hint={
                          question.role === "none"
                            ? detectedRoleForQuestion(question) !== "none"
                              ? `Detected: ${
                                  STRATEGY_ROLE_OPTIONS.find(
                                    (option) => option.role === detectedRoleForQuestion(question),
                                  )?.label ?? detectedRoleForQuestion(question)
                                }`
                              : "Not mapped — pick a role so answers reach strategy and pick tools"
                            : STRATEGY_ROLE_OPTIONS.find((option) => option.role === question.role)
                                ?.hint
                        }
                      >
                        <select
                          value={question.role}
                          disabled={!payload.canManageSchemas}
                          aria-label={`Strategy mapping for question ${index + 1}`}
                          onChange={(event) =>
                            updateQuestion(question.id, {
                              role: event.target.value as StrategyFieldRole,
                            })
                          }
                        >
                          {STRATEGY_ROLE_OPTIONS.map((option) => (
                            <option key={option.role} value={option.role}>
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
                    {needsSettingsEditor(question.kind) ? (
                      <StudioSettingsEditor
                        question={question}
                        disabled={!payload.canManageSchemas}
                        onChange={(settings) => updateQuestion(question.id, { settings })}
                      />
                    ) : null}
                    {question.kind === "section" ? (
                      <p className="app-muted" style={{ margin: 0, fontSize: 13 }}>
                        Layout only — this heading groups every question under it until the next
                        section, and it stores no answer.
                      </p>
                    ) : (
                      <>
                        <FormRow
                          label="After a save"
                          hint={
                            RESET_BEHAVIOR_OPTIONS.find(
                              (option) => option.behavior === question.reset,
                            )?.hint
                          }
                        >
                          <select
                            value={question.reset}
                            disabled={!payload.canManageSchemas}
                            aria-label={`After-save behavior for question ${index + 1}`}
                            onChange={(event) =>
                              updateQuestion(question.id, {
                                reset: event.target.value as FormResetBehavior,
                              })
                            }
                          >
                            {RESET_BEHAVIOR_OPTIONS.map((option) => (
                              <option key={option.behavior} value={option.behavior}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </FormRow>
                        <label
                          className={`sfb-check sfb-required-toggle${question.required ? " is-on" : ""}`}
                        >
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
                      </>
                    )}
                  </article>
                ))}
              </div>
              <div className="sfb-add-row">
                <Button variant="secondary" type="button" disabled={!payload.canManageSchemas} onClick={() => setQuestions((prev) => [...prev, newDraftQuestion()])}>
                  Add question
                </Button>
                <Button variant="secondary" type="button" disabled={!payload.canManageSchemas} onClick={() => setQuestions((prev) => [ ...prev, newDraftQuestion({ label: "Drivetrain", kind: "drivetrain", optionsText: DRIVETRAIN_OPTIONS_TEXT, }), ]) }>
                  Add drivetrain
                </Button>
                <Button variant="secondary" type="button" disabled={!payload.canManageSchemas} onClick={() => setQuestions((prev) => [ ...prev, newDraftQuestion({ label: "Robot images", kind: "robot_image" }), ]) }>
                  Add robot images
                </Button>
                <Button variant="secondary" type="button" disabled={!payload.canManageSchemas} onClick={() => setMode("preview")}>
                  Preview
                </Button>
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
                  <Button variant="secondary" type="button" onClick={() => loadSchemaIntoDraft(currentSchema, type)}>
                    Load
                  </Button>
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
              <Button variant="primary" type="button" disabled={busy || Boolean(publishBlocked)} title={publishBlocked ?? publishStatus.detail} onClick={() => void publish()}>
                {publishLabel}
              </Button>
              <Button as="a" variant="secondary" href={scoutingHref}>
                Open Scouting
              </Button>
            </div>
          </Panel>
          <Panel>
            <h2>Answer types</h2>
            <p className="app-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Tap one to add a question of that type, then give it a label.
            </p>
            <ul className="sfb-palette">
              {ANSWER_KIND_OPTIONS.map((option) => (
                <li key={option.kind}>
                  <button
                    type="button"
                    disabled={!payload.canManageSchemas}
                    aria-label={`Add a ${option.label} question`}
                    onClick={() =>
                      setQuestions((prev) => [
                        ...prev,
                        newDraftQuestion({
                          kind: option.kind,
                          label: option.kind === "section" ? "Teleop" : "",
                        }),
                      ])
                    }
                  >
                    <strong>{option.label}</strong>
                    <small className="app-muted">{option.hint}</small>
                  </button>
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
