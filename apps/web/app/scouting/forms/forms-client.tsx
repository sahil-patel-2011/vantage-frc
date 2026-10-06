"use client";

import { FormsResponses } from "./forms-responses";
import { scoutingGameLabel, latestScoutingYear } from "../../../lib/scouting/free-scout";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type EntryType, type FormResetBehavior, type SchemaDefinition, type ScoutSchema } from "@vantage/scouting";
import "../scouting.css";
import { OfflineBanner } from "../../../components/offline-banner";
import { ActionMenu, EmptyState, FormRow, Panel, ToolStrip, Button } from "../../../components/ui";
import { useTierDrag } from "../../../components/ui/use-tier-drag";
import "../../../components/ui/tier-drag.css";
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
  duplicateQuestion,
  needsOptionEditor,
  needsSettingsEditor,
  newDraftQuestion,
  parseOptions,
  resolveDraftPublishStatus,
  retypeQuestion,
  RESET_BEHAVIOR_OPTIONS,
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
import { FormBuilderNextActionsPanel, FormBuilderShell } from "./forms-chrome";
import { defaultQuestions, type FormBuilderMode, type SchemasPayload } from "./forms-model";
import { OptionEditor } from "./forms-option-editor";
import { FormsTabletPreview } from "./forms-tablet-preview";
import { StudioSettingsEditor } from "./forms-settings-editor";
import { CollectionSettings } from "./forms-collection-settings";
import { withOrgHref } from "../../../lib/nav/product-nav";

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

export default function FormsClient({ orgId, embedded = false }: { orgId: string; embedded?: boolean }) {
  const Root = embedded ? "section" : "main";
  const [payload, setPayload] = useState<SchemasPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [type, setType] = useState<EntryType>("pit");
  const [mode, setMode] = useState<FormBuilderMode>("edit");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const [title, setTitle] = useState("Pit scouting");
  const [questions, setQuestions] = useState(() => defaultQuestions("pit"));
  /**
   * The last removed question and where it sat, so Remove is recoverable.
   * Deleting a configured field — options, settings, strategy role — used to
   * throw all of it away with no way back.
   */
  const [removed, setRemoved] = useState<{ question: DraftQuestion; index: number } | null>(null);
  const [year, setYear] = useState<number | null>(null);
  const [publishing, setPublishing] = useState(false);
  const [loading, setLoading] = useState(true);
  const busy = publishing || loading;
  const loadGenerationRef = useRef(0);
  const publishingRef = useRef(false);
  const draftsRef = useRef<Partial<Record<EntryType, { title: string; questions: DraftQuestion[]; acknowledgeBudget: boolean }>>>({});
  const [message, setMessage] = useState("");
  const [acknowledgeBudget, setAcknowledgeBudget] = useState(false);
  const [published, setPublished] = useState<{ id: string; version: number } | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const payloadRef = useRef<SchemasPayload | null>(null);
  payloadRef.current = payload;

  // Drag a question by its handle (finger, mouse, or the arrow keys) instead of an up and a down
  // button on every card. One list, so a single tier.
  const canReorder = Boolean(payload?.canManageSchemas) && !busy;
  const questionDrag = useTierDrag<"questions">({
    groups: [{ tier: "questions", ids: questions.map((question) => question.id) }],
    enabled: canReorder,
    tierLabel: () => "the form",
    onMove: (id, _tier, index) =>
      setQuestions((prev) => {
        const from = prev.findIndex((question) => question.id === id);
        if (from < 0) return prev;
        const next = prev.slice();
        const [moving] = next.splice(from, 1);
        next.splice(Math.max(0, Math.min(index, next.length)), 0, moving!);
        return next;
      }),
  });

  const validation = useMemo(() => validateDraft(title, questions, type), [title, questions, type]);

  // One-shot handoff from the migrate page (undefined = not yet checked,
  // null = checked and nothing was waiting). Consumed inside loadSchemaIntoDraft
  // so the imported draft beats — rather than races — the initial schema fetch.
  const importedDraftRef = useRef<SchemaDefinition | null | undefined>(undefined);

  const loadSchemaIntoDraft = useCallback((schema: ScoutSchema | undefined, nextType: EntryType, seasonYear?: number | null) => {
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
    setQuestions(defaultQuestions(nextType, seasonYear));
  }, []);

  const load = useCallback(async (requestedYear?: number) => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    let hadCache = Boolean(payloadRef.current);
    try {
      const cached = await getFeatureSnapshot<SchemasPayload>("scout-forms", orgId || "_");
      if (generation !== loadGenerationRef.current) return;
      if (!payloadRef.current && cached?.data && isSchemasPayload(cached.data)) {
        setPayload(cached.data);
        if (cached.data.year != null) setYear(cached.data.year);
        const active = cached.data.schemas.find((schema) => schema.type === type);
        loadSchemaIntoDraft(active, type, cached.data.year);
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
      const response = await fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}${requestedYear ? `&year=${requestedYear}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const body: unknown = await response.json().catch(() => null);
      if (generation !== loadGenerationRef.current) return;
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
      if (requestedYear) draftsRef.current = {};
      if (body.year != null) setYear(body.year);
      const active = body.schemas.find((schema) => schema.type === type);
      loadSchemaIntoDraft(active, type, body.year);
      setFromCache(false);
      setCachedAt(null);
      await persistScoutFormsSnapshot(orgId, body);
    } catch {
      if (generation !== loadGenerationRef.current) return;
      if (hadCache || payloadRef.current) {
        setFromCache(true);
        setMessage("Could not refresh scout forms. Showing the last copy on this device.");
        setLoadError("");
        return;
      }
      setLoadError("Could not load scout forms.");
    } finally {
      if (generation === loadGenerationRef.current) setLoading(false);
    }
  }, [orgId, type, loadSchemaIntoDraft]);

  useEffect(() => {
    // A previous team's snapshot must never become this team's fallback.
    payloadRef.current = null;
    setPayload(null);
    setFromCache(false);
    setCachedAt(null);
    setPublished(null);
    setMessage("");
    draftsRef.current = {};
    void load();
    return () => { loadGenerationRef.current++; };
    // Mount / org only — type switches reuse the loaded schema list.
  }, [orgId]);

  const focusedQuestionId = questions.some(question => question.id === editingQuestionId)
    ? editingQuestionId : questions[0]?.id;

  function addQuestion(kind?: AnswerKind) {
    const question = newDraftQuestion(kind ? { kind, label: kind === "section" ? "Teleop" : "" } : undefined);
    setQuestions(previous => [...previous, question]);
    setEditingQuestionId(question.id);
  }

  function switchType(next: EntryType) {
    if (busy || publishingRef.current || next === type) return;
    draftsRef.current[type] = { title, questions, acknowledgeBudget };
    setType(next);
    setEditingQuestionId(null);
    setRemoved(null);
    setPublished(null);
    setMessage("");
    setAcknowledgeBudget(false);
    const draft = draftsRef.current[next];
    if (draft) {
      setTitle(draft.title);
      setQuestions(draft.questions);
      setAcknowledgeBudget(draft.acknowledgeBudget);
    } else {
      const schema = payload?.schemas.find((entry) => entry.type === next);
      loadSchemaIntoDraft(schema, next, payload?.year);
    }
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
    if (publishingRef.current) return;
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
    publishingRef.current = true;
    setPublishing(true);
    try {
      const definition: SchemaDefinition = definitionFromDraft(title, questions);
      const response = await fetch("/api/scouting/schemas", {
        method: "POST",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
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
      // The green card at the top says it once.
      setMessage("");
      await load();
      delete draftsRef.current[type];
      setPublished({ id: String(body.id), version: Number(body.version) });
    } catch {
      setMessage("Network error — try again.");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
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
    busy: publishing,
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
            badge="Needs setup"
            badgeTone="setup"
            title="Choose your team"
            description="Choose your team to view its scouting forms. A scouting lead or team admin can publish them."
          />
        ) : null}
      </FormBuilderShell>
    );
  }

  return (
    <Root className="module-page sfb-page">
      <header className="sfb-heading">{!embedded ? <h2>Scouting forms</h2> : null}<p>Build your questions. Preview the form. Review the answers.</p></header>

      <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />

      {/* Publishing was confirmed by small blue text beside a "Republish" button, with no way
          back to the setup list that sent the owner here. */}
      {published ? (
        <section className="sfb-published-card" role="status">
          <div>
            <strong>Published</strong>
            <span>Scouts see this form the next time they open Scout.</span>
          </div>
          <Button as="a" variant="primary" href={withOrgHref("/competition?tab=scouting", orgId)}>
            Open scouting
          </Button>
        </section>
      ) : null}

      {shell === "empty" ? (
        <section className="sfb-shell-empty sfb-published-card" role="status">
          <div><strong>{payload.canManageSchemas ? "Ready to publish" : "No published form yet"}</strong><span>{payload.canManageSchemas ? "Start with these questions or tailor them below." : "Ask a scouting lead or team admin to publish a form. The questions below are a preview."}</span></div>
          {/* The step people arrive for is publishing; "Open Scouting" left the page. */}
          {payload.canManageSchemas ? <Button variant="primary" type="button" disabled={busy || Boolean(publishBlocked)} title={publishBlocked ?? publishStatus.detail} onClick={() => void publish()}>
            {publishLabel}
          </Button> : null}
        </section>
      ) : null}

      {!payload.canManageSchemas ? (
        <p className="app-muted">You can preview this form and review responses. A scouting lead or team admin can edit and publish forms.</p>
      ) : null}

      {loading ? <p className="app-muted" role="status">Checking the latest forms…</p> : null}
      <fieldset className="sfb-type-switch" disabled={busy}>
        <ToolStrip
          aria-label="Form type"
          value={type}
          onChange={(id) => switchType(id as EntryType)}
          items={[
            { id: "match", label: "Match form" },
            { id: "pit", label: "Pit form" },
          ]}
        />
      </fieldset>

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

      <div className="sfb-meta">
        <FormRow label="Form title">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            disabled={!payload.canManageSchemas || busy}
            maxLength={80}
          />
        </FormRow>
        <FormRow label="Game"><select aria-label="Form game" disabled={busy} value={year ?? latestScoutingYear()} onChange={event => {
          if (publishStatus.kind !== "published" && !window.confirm("Change game? Unpublished changes to this form will be discarded.")) return;
          setPublished(null); void load(Number(event.target.value));
        }}>{Array.from(new Set([year ?? latestScoutingYear(), latestScoutingYear(), 2025, 2024])).sort((a,b) => b-a).map(value => <option key={value} value={value}>{scoutingGameLabel(value)}</option>)}</select></FormRow>
        <ToolStrip presentation="segments" aria-label="Form workspace" value={mode} onChange={id => setMode(id as FormBuilderMode)} items={[{ id: "edit", label: "Questions" }, { id: "preview", label: "Preview" }, { id: "responses", label: "Responses" }]} />
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

      <div className="sfb-layout sfb-layout-single">
        <Panel as="section" className={mode === "preview" ? "sfb-tablet-panel" : undefined}>
          {mode === "responses" ? <FormsResponses orgId={orgId} schemaId={currentSchema?.id} /> : mode === "preview" ? (
            <>
              <h2>What scouts see</h2>
              <p className="app-muted">
                The same buttons and steppers as the scout form on a phone. Scouts also pick the match and robot
                first.
              </p>
              <FormsTabletPreview title={title || "Untitled form"} questions={questions} />
            </>
          ) : (
            <>
              <header className="sfb-question-head" style={{ marginBottom: 8 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Questions</h2>
                  <p className="app-muted" style={{ margin: "4px 0 0" }}>
                    {questions.length} {questions.length === 1 ? "question" : "questions"} · Select a question to edit. Drag to reorder.
                  </p>
                </div>
                <Button variant="ghost" size="sm" type="button" aria-pressed={showAllQuestions} onClick={() => setShowAllQuestions(previous => !previous)}>
                  {showAllQuestions ? "Focus one question" : "Expand all questions"}
                </Button>
              </header>
              {removed ? (
                <div className="sfb-undo" role="status">
                  <span>
                    Removed <strong>{removed.question.label || "a question"}</strong>.
                  </span>
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      setQuestions((prev) => {
                        const next = prev.slice();
                        next.splice(Math.min(removed.index, next.length), 0, removed.question);
                        return next;
                      });
                      setRemoved(null);
                    }}
                  >
                    Undo
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    type="button"
                    aria-label="Dismiss"
                    onClick={() => setRemoved(null)}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : null}
              <div className="sfb-questions" ref={questionDrag.rootRef} data-tier-list="questions">
                <p className="sr-only" role="status" aria-live="polite">
                  {questionDrag.announcement}
                </p>
                {questions.map((question, index) => (
                  <Fragment key={question.id}>
                  {questionDrag.slotIndex("questions") === questions.slice(0, index).filter((item) => item.id !== questionDrag.drag?.id).length &&
                  questionDrag.drag?.id !== question.id ? (
                    <div className="tier-drop-slot" aria-hidden="true" />
                  ) : null}
                  <article
                    className={`sfb-question${questionDrag.drag?.id === question.id ? " is-dragging" : ""}`}
                    data-entry-id={question.id}
                  >
                    <div className="sfb-question-head">
                      <button type="button" className="sfb-question-select"
                        aria-expanded={showAllQuestions || focusedQuestionId === question.id}
                        aria-controls={`question-editor-${question.id}`}
                        onClick={() => { setShowAllQuestions(false); setEditingQuestionId(question.id); }}>
                        <span className="sfb-question-number" aria-hidden="true">{index + 1}</span>
                        <span><strong>{question.label || "Untitled question"}</strong><small>{ANSWER_KIND_OPTIONS.find(option => option.kind === question.kind)?.label}{question.required ? " · Required" : " · Optional"}</small></span>
                        <span className="sfb-question-chevron" aria-hidden="true">⌄</span>
                      </button>
                      {/*
                        Four buttons on every question became two and a menu.

                        A seven-question form put twenty-eight controls down the
                        side of the page — Move up, Move down, Duplicate, Remove,
                        seven times over — and the words that told them apart were
                        the same four words each time. Reordering is the one that
                        wants to be immediate, so it stays as a pair of arrows with
                        the sentence in its accessible name; duplicating and
                        removing are occasional and go behind the overflow, where
                        Remove also picks up the menu's confirmation step.
                      */}
                      <div className="sfb-question-actions">
                        {payload.canManageSchemas ? (
                          <button
                            type="button"
                            className="tier-drag-handle"
                            aria-label={`Move question ${index + 1}: drag, or press the up and down arrow keys`}
                            aria-disabled={busy || undefined}
                            {...questionDrag.handleProps(question.id, "questions")}
                          >
                            <span aria-hidden="true">⋮⋮</span>
                          </button>
                        ) : null}
                        <ActionMenu
                          tone="row"
                          overflowOnly
                          label={`Question ${index + 1} actions`}
                          maxSecondary={0}
                          triggerTestId={`sfb-question-more:${question.id}`}
                          actions={[
                            {
                              id: "duplicate",
                              label: "Duplicate",
                              intent: "normal",
                              disabled: !payload.canManageSchemas || busy,
                              hint: "A copy directly below, ready to edit",
                              onClick: () => {
                                const next = duplicateQuestion(questions, index);
                                setQuestions(next);
                                setEditingQuestionId(next[index + 1]?.id ?? null);
                              },
                            },
                            {
                              id: "remove",
                              label: "Remove",
                              intent: "destructive",
                              disabled: !payload.canManageSchemas || busy || questions.length <= 1,
                              hint: "Undo is offered right after",
                              onClick: () => {
                                setRemoved({ question, index });
                                setQuestions((prev) => prev.filter((entry) => entry.id !== question.id));
                              },
                            },
                          ]}
                        />
                      </div>
                    </div>
                    <div id={`question-editor-${question.id}`} className="sfb-question-editor" hidden={!showAllQuestions && focusedQuestionId !== question.id}>
                    <div className="sfb-question-grid">
                      <FormRow label="Label">
                        <input
                          value={question.label}
                          disabled={!payload.canManageSchemas || busy}
                          onChange={(event) => updateQuestion(question.id, { label: event.target.value })}
                          placeholder="What should scouts answer?"
                        />
                      </FormRow>
                      <FormRow label="Answer type">
                        <select
                          value={question.kind}
                          disabled={!payload.canManageSchemas || busy}
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
                    </div>
                    {needsOptionEditor(question.kind) ? (
                      <OptionEditor
                        optionsText={question.optionsText}
                        disabled={!payload.canManageSchemas || busy}
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
                        disabled={!payload.canManageSchemas || busy}
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
                        {/* The settings most forms never change, folded: every question showed all of them. */}
                        <details className="sfb-more">
                          <summary data-disclosure>Description, chart and advanced options</summary>
                          <CollectionSettings question={question} index={index} match={type === "match"} disabled={!payload.canManageSchemas || busy} onChange={collectionConfig => updateQuestion(question.id, { collectionConfig })} />
                          <FormRow label="Description"><input value={question.helpText ?? ""} disabled={!payload.canManageSchemas || busy} onChange={event => updateQuestion(question.id, { helpText: event.target.value })} placeholder="Optional guidance for scouts" /></FormRow>
                          <FormRow label="Response chart"><select aria-label={`Chart for question ${index+1}`} value={question.chart ?? "auto"} disabled={!payload.canManageSchemas || busy} onChange={event => updateQuestion(question.id, { chart: event.target.value as DraftQuestion["chart"] })}><option value="auto">Automatic</option><option value="bar">Answer counts</option><option value="trend">Number trend</option><option value="none">Table only</option></select></FormRow>
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
                              disabled={!payload.canManageSchemas || busy}
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
                            disabled={!payload.canManageSchemas || busy}
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
                        </details>
                        <label
                          className={`sfb-check sfb-required-toggle${question.required ? " is-on" : ""}`}
                        >
                          <input
                            type="checkbox"
                            checked={question.required}
                            disabled={!payload.canManageSchemas || busy}
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
                    </div>
                  </article>
                  </Fragment>
                ))}
                {questionDrag.slotIndex("questions") !== null &&
                questionDrag.slotIndex("questions")! >= questions.filter((item) => item.id !== questionDrag.drag?.id).length ? (
                  <div className="tier-drop-slot" aria-hidden="true" />
                ) : null}
              </div>
              <div className="sfb-add-row">
                <Button variant="secondary" type="button" disabled={!payload.canManageSchemas || busy} onClick={() => addQuestion()}>
                  Add question
                </Button>
              </div>
            </>
          )}
        </Panel>

        {mode === "edit" ? <aside className="sfb-side" style={{ display: "grid", gap: 12 }}>
          {published ? null : <Panel className="sfb-publish-bar">
            <p className={`sfb-status-inline sfb-status-${publishStatus.kind}`}>
              <strong>{publishStatus.label}</strong>
              <span className="app-muted">{publishStatus.detail}</span>
            </p>
            {publishStatus.kind === "draft_changes" ? (
              <p className="app-muted" style={{ margin: "8px 0" }}>
                Scouts keep the published form until you publish these changes.
              </p>
            ) : null}
            {currentSchema && publishStatus.kind === "draft_changes" ? (
                    <Button variant="secondary" type="button" disabled={busy} onClick={() => loadSchemaIntoDraft(currentSchema, type, year)}>
                      Undo my changes
                    </Button>
            ) : null}

            <div className="sfb-publish-actions">
              {/* Nothing published yet: the card at the top has the Publish button, said once. */}
              {shell === "empty" || publishStatus.kind === "published" ? null : (
                <Button variant="primary" type="button" disabled={busy || Boolean(publishBlocked)} title={publishBlocked ?? publishStatus.detail} onClick={() => void publish()}>
                  {publishLabel}
                </Button>
              )}
              <Button as="a" variant="secondary" href={scoutingHref}>
                Open Scouting
              </Button>
            </div>
          </Panel>}
          {/* Sixteen answer types were a catalogue on the first screen; they are what "Add a
              question" opens. */}
          <details className="app-card soft-panel sfb-add-question">
            <summary>More question types</summary>
            <p className="app-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Pick the kind of answer, then give the question a label.
            </p>
            <ul className="sfb-palette">
              {ANSWER_KIND_OPTIONS.map((option) => (
                <li key={option.kind}>
                  <button
                    type="button"
                    disabled={!payload.canManageSchemas || busy}
                    aria-label={`Add a ${option.label} question`}
                    onClick={() => addQuestion(option.kind)}
                  >
                    <strong>{option.label}</strong>
                    <small className="app-muted">{option.hint}</small>
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <FormBuilderNextActionsPanel actions={readyActions} />
        </aside> : null}
      </div>
    </Root>
  );
}
