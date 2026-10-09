"use client";

import { FormsResponses } from "./forms-responses";
import { ScoringFormulas } from "./scoring-formulas";
import { useSearchParams } from "next/navigation";
import { scoutingGameLabel, latestScoutingYear } from "../../../lib/scouting/free-scout";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { type EntryType, type FormResetBehavior, type SchemaDefinition, type ScoutSchema } from "@vantage/scouting";
import "../scouting.css";
import { OfflineBanner } from "../../../components/offline-banner";
import { ActionMenu, ConfirmProvider, EmptyState, FormRow, Panel, ToolStrip, Button, useConfirm } from "../../../components/ui";
import { useTierDrag } from "../../../components/ui/use-tier-drag";
import "../../../components/ui/tier-drag.css";
import {
  ANSWER_KIND_OPTIONS,
  DRIVETRAIN_OPTIONS_TEXT,
  IMPORTED_FORM_DRAFT_KEY,
  classifyFormBuilderShell,
  definitionFromDraft,
  draftFromDefinition,
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
import { clearFeatureSnapshot, getFeatureSnapshot, putFeatureSnapshot } from "../../../lib/offline/feature-cache";
import { FormBuilderShell } from "./forms-chrome";
import { defaultQuestions, type FormBuilderMode, type SchemasPayload } from "./forms-model";
import { OptionEditor } from "./forms-option-editor";
import { FormsTabletPreview } from "./forms-tablet-preview";
import { StudioSettingsEditor } from "./forms-settings-editor";
import { CollectionSettings } from "./forms-collection-settings";
import { FormsVisibilityEditor } from "./forms-visibility-editor";
import { formEditorPrefix, listFormEditorDrafts, removeFormEditorDraft, saveFormEditorDraft, type FormEditorDraft, type FormEditorScope } from "../../../lib/scouting/form-editor-draft";

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
  return <ConfirmProvider key={orgId}><FormsEditor orgId={orgId} embedded={embedded} /></ConfirmProvider>;
}

function FormsEditor({ orgId, embedded }: { orgId: string; embedded: boolean }) {
  const confirm = useConfirm();
  const searchParams = useSearchParams();
  const [formulaOpen, setFormulaOpen] = useState(false);
  const requestedFormulas = searchParams.get("formulas") === "1";
  useEffect(() => { if (requestedFormulas) setFormulaOpen(true); }, [requestedFormulas]);
  const Root = embedded ? "section" : "main";
  const [payload, setPayload] = useState<SchemasPayload | null>(null);
  const [loadedOrg, setLoadedOrg] = useState(orgId);
  const [loadError, setLoadError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [type, setType] = useState<EntryType>("pit");
  const [mode, setMode] = useState<FormBuilderMode>("edit");
  const [editingQuestionId, setEditingQuestionId] = useState<string | null>(null);
  const [showAllQuestions, setShowAllQuestions] = useState(false);
  const questionFocusRef = useRef<string | null>(null);
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
  const currentOrgRef = useRef(orgId);
  currentOrgRef.current = orgId;
  const editorIdRef = useRef<string | null>(null);
  const draftScopeRef = useRef<string | null>(null);
  const baseSchemaIdRef = useRef<string | null>(null);
  const recoveredDraftRef = useRef<FormEditorDraft | null>(null);
  const writtenDraftRef = useRef<FormEditorDraft | null>(null);
  const [draftChoices, setDraftChoices] = useState<FormEditorDraft[]>([]);
  const [draftError, setDraftError] = useState("");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [publicationConflict, setPublicationConflict] = useState(false);
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
  const previewDefinition = useMemo(() => definitionFromDraft(title, questions), [title, questions]);
  const currentSchema = loadedOrg === orgId ? payload?.schemas.find(schema => schema.type === type) : undefined;
  const publishStatus = resolveDraftPublishStatus({
    published: currentSchema ? { version: currentSchema.version, definition: currentSchema.definition } : null,
    draftTitle: title,
    draftQuestions: questions,
  });
  const publicationConfirmed = Boolean(published && publishStatus.kind === "published" && published.id === currentSchema?.id);
  const hasUnsavedChanges = Boolean(loadedOrg === orgId && payload?.canManageSchemas && !loading && publishStatus.kind !== "published");
  const storedDraft = writtenDraftRef.current ?? recoveredDraftRef.current;
  const draftNeedsProtection = hasUnsavedChanges && (!storedDraft || storedDraft.title !== title || storedDraft.questions !== questions || storedDraft.acknowledgeBudget !== acknowledgeBudget || Boolean(draftError));
  useEffect(() => {
    if (!draftNeedsProtection) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [draftNeedsProtection]);

  // One-shot handoff from the migrate page (undefined = not yet checked,
  // null = checked and nothing was waiting). Consumed inside loadSchemaIntoDraft
  // so the imported draft beats — rather than races — the initial schema fetch.
  const importedDraftRef = useRef<SchemaDefinition | null | undefined>(undefined);

  const loadSchemaIntoDraft = useCallback((schema: ScoutSchema | undefined, nextType: EntryType, seasonYear?: number | null, restore = true) => {
    const data = payloadRef.current;
    const nextYear = schema?.year ?? seasonYear;
    const scope: FormEditorScope | null = data?.userId && nextYear ? { userId: data.userId, orgId, year: nextYear, type: nextType } : null;
    editorIdRef.current = null;
    draftScopeRef.current = scope ? formEditorPrefix(scope) : null;
    baseSchemaIdRef.current = schema?.id ?? null;
    recoveredDraftRef.current = null;
    writtenDraftRef.current = null;
    setDraftSavedAt(null);
    setDraftError("");
    setPublicationConflict(false);
    setAcknowledgeBudget(false);
    let drafts: FormEditorDraft[] = [];
    if (scope && data?.canManageSchemas) {
      try { drafts = listFormEditorDrafts(window.localStorage, scope); }
      catch { setDraftError("Draft storage is unavailable. Keep this editor open until you publish."); }
    }
    setDraftChoices(drafts);
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
    if (restore && drafts[0] && data?.canManageSchemas) {
      const draft = drafts[0];
      recoveredDraftRef.current = draft;
      baseSchemaIdRef.current = draft.baseSchemaId;
      setTitle(draft.title);
      setQuestions(draft.questions);
      setAcknowledgeBudget(draft.acknowledgeBudget);
      setDraftSavedAt(draft.savedAt);
      setPublicationConflict(draft.baseSchemaId !== (schema?.id ?? null));
      setMessage("Your unpublished draft was restored from this device.");
      return;
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
  }, [orgId]);

  const saveCurrentDraft = useCallback((): boolean => {
    if (busy || !payload?.canManageSchemas) return true;
    if (!hasUnsavedChanges) {
      // Manually reverting every edit must also retire this editor's old
      // autosave; otherwise a reload resurrects changes the lead removed.
      if (!writtenDraftRef.current && !recoveredDraftRef.current) return true;
      try {
        if (writtenDraftRef.current) removeFormEditorDraft(window.localStorage, writtenDraftRef.current);
        if (recoveredDraftRef.current) removeFormEditorDraft(window.localStorage, recoveredDraftRef.current);
        writtenDraftRef.current = null; recoveredDraftRef.current = null;
        setDraftSavedAt(null); setDraftError("");
        if (payload.userId && year) setDraftChoices(listFormEditorDrafts(window.localStorage, { userId: payload.userId, orgId, year, type }));
        return true;
      } catch { setDraftError("The old saved draft could not be removed. Keep this editor open and try again."); return false; }
    }
    const userId = payload?.userId;
    if (!userId || !year) { setDraftError("Your account must finish loading before this draft can be saved. Keep the editor open."); return false; }
    const scope: FormEditorScope = { userId, orgId, year, type };
    if (draftScopeRef.current !== formEditorPrefix(scope)) return false;
    try {
      editorIdRef.current ??= crypto.randomUUID();
      const draft: FormEditorDraft = { ...scope, format: 1, editorId: editorIdRef.current, savedAt: new Date().toISOString(), baseSchemaId: baseSchemaIdRef.current, title, questions, acknowledgeBudget };
      saveFormEditorDraft(window.localStorage, draft);
      writtenDraftRef.current = draft;
      // The copy is durable before retiring the exact recovered revision.
      const recovered = recoveredDraftRef.current;
      if (recovered && recovered.editorId !== draft.editorId) removeFormEditorDraft(window.localStorage, recovered);
      recoveredDraftRef.current = null;
      setDraftSavedAt(draft.savedAt);
      setDraftError("");
      setDraftChoices(listFormEditorDrafts(window.localStorage, scope));
      return true;
    } catch { setDraftError("This draft could not be saved on your device. Keep the editor open and publish before leaving or changing forms."); return false; }
  }, [hasUnsavedChanges, busy, payload?.canManageSchemas, payload?.userId, year, orgId, type, title, questions, acknowledgeBudget]);

  useEffect(() => { saveCurrentDraft(); }, [saveCurrentDraft]);

  const load = useCallback(async (requestedYear?: number, restoreDraft = true) => {
    const generation = ++loadGenerationRef.current;
    setLoading(true);
    let hadCache = Boolean(payloadRef.current);
    let cacheAllowed = true;
    let keepImportedDraft = false;
    void getFeatureSnapshot<SchemasPayload>("scout-forms", orgId || "_").then(cached => {
      if (!cacheAllowed || generation !== loadGenerationRef.current) return;
      if (!payloadRef.current && cached?.data && isSchemasPayload(cached.data)) {
        payloadRef.current = cached.data;
        setPayload(cached.data);
        if (cached.data.year != null) setYear(cached.data.year);
        const active = cached.data.schemas.find((schema) => schema.type === type);
        loadSchemaIntoDraft(active, type, cached.data.year);
        keepImportedDraft = Boolean(importedDraftRef.current);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
        setLoadError("");
      }
    }).catch(() => { /* Optional snapshots never hold up the live request. */ });
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
        cacheAllowed = false;
        payloadRef.current = null;
        setPayload(null);
        setFromCache(false);
        setCachedAt(null);
        void clearFeatureSnapshot("scout-forms", orgId || "_").catch(() => { /* Revoked data is already hidden. */ });
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
      cacheAllowed = false;
      payloadRef.current = body;
      setPayload(body);
      if (body.year != null) setYear(body.year);
      const active = body.schemas.find((schema) => schema.type === type);
      if (!keepImportedDraft || requestedYear) loadSchemaIntoDraft(active, type, body.year, restoreDraft);
      else if (body.userId && body.year) {
        draftScopeRef.current = formEditorPrefix({ userId: body.userId, orgId, year: body.year, type });
        baseSchemaIdRef.current = active?.id ?? null;
      }
      setFromCache(false);
      setCachedAt(null);
      void persistScoutFormsSnapshot(orgId, body);
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
    setLoadedOrg(orgId);
    setPayload(null);
    setFromCache(false);
    setCachedAt(null);
    setPublished(null);
    setMessage("");
    void load();
    return () => { loadGenerationRef.current++; };
    // Mount / org only — type switches reuse the loaded schema list.
  }, [orgId]);

  const focusedQuestionId = questions.some(question => question.id === editingQuestionId)
    ? editingQuestionId : questions[0]?.id;
  const answerQuestionCount = questions.filter(question => question.kind !== "section").length;

  useEffect(() => {
    const id = questionFocusRef.current;
    if (!id || mode !== "edit") return;
    questionFocusRef.current = null;
    const editor = document.getElementById(`question-editor-${id}`);
    editor?.scrollIntoView({ block: "center", behavior: "instant" });
    editor?.querySelector<HTMLInputElement>("input:not([disabled])")?.focus({ preventScroll: true });
  }, [focusedQuestionId, questions.length, mode]);

  function addQuestion(kind?: AnswerKind) {
    const question = newDraftQuestion(kind ? { kind, label: kind === "section" ? "Teleop" : "" } : undefined);
    setQuestions(previous => {
      const next = previous.slice();
      const index = previous.findIndex(item => item.id === focusedQuestionId);
      next.splice(index < 0 ? next.length : index + 1, 0, question);
      return next;
    });
    questionFocusRef.current = question.id;
    setEditingQuestionId(question.id);
  }

  function switchType(next: EntryType) {
    if (busy || publishingRef.current || next === type) return;
    if (!saveCurrentDraft()) return;
    setType(next);
    setEditingQuestionId(null);
    setRemoved(null);
    setPublished(null);
    setMessage("");
    setAcknowledgeBudget(false);
    const schema = payload?.schemas.find((entry) => entry.type === next);
    loadSchemaIntoDraft(schema, next, payload?.year);
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

  async function discardChanges() {
    if (busy || !(await confirm({ title: "Discard these unpublished changes?", body: "This removes this editor’s saved draft and restores the published form. Other open editors keep their drafts.", confirmLabel: "Discard changes", tone: "destructive" }))) return;
    try {
      if (writtenDraftRef.current) removeFormEditorDraft(window.localStorage, writtenDraftRef.current);
      if (recoveredDraftRef.current) removeFormEditorDraft(window.localStorage, recoveredDraftRef.current);
    } catch { setDraftError("The saved draft could not be removed. Your current changes are still open."); return; }
    loadSchemaIntoDraft(currentSchema, type, year, false);
    setMessage("");
  }

  function restoreDraft(editorId: string) {
    const draft = draftChoices.find(item => item.editorId === editorId);
    if (!draft || busy || !saveCurrentDraft()) return;
    editorIdRef.current = null;
    writtenDraftRef.current = null;
    recoveredDraftRef.current = draft;
    baseSchemaIdRef.current = draft.baseSchemaId;
    setTitle(draft.title); setQuestions(draft.questions); setAcknowledgeBudget(draft.acknowledgeBudget);
    setDraftSavedAt(draft.savedAt); setPublished(null);
    setPublicationConflict(draft.baseSchemaId !== (currentSchema?.id ?? null));
    setMessage("Saved draft restored. Review the questions before publishing.");
  }

  async function keepDraftOverLatest() {
    if (busy || !currentSchema || baseSchemaIdRef.current === currentSchema.id) return;
    const accepted = await confirm({
      title: `Use this draft after version ${currentSchema.version}?`,
      body: `The latest form is “${currentSchema.definition.title}”. Its questions are shown below for comparison. Continuing keeps your draft's questions; it does not merge the other lead's edits. Publishing will create a new version, and existing reports keep their original questions.`,
      confirmLabel: "Keep my draft", tone: "neutral",
    });
    if (!accepted) return;
    baseSchemaIdRef.current = currentSchema.id;
    setPublicationConflict(false);
    saveCurrentDraft();
    setMessage("Your draft is ready for review against the latest version. Publish when the questions are correct.");
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
    if (publishingRef.current || loading) return;
    if (publicationConflict) { setMessage("Review the latest published form before publishing this older draft."); return; }
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
    const generation = loadGenerationRef.current;
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
          baseSchemaId: baseSchemaIdRef.current,
          acknowledgeBudget: acknowledgeBudget || undefined,
        }),
      });
      const body = (await response.json()) as {
        id?: string;
        version?: number;
        error?: string;
        acknowledgeRequired?: boolean;
        definition?: SchemaDefinition;
      };
      if (currentOrgRef.current !== orgId || generation !== loadGenerationRef.current) return;
      if (!response.ok) {
        if (response.status === 409) setPublicationConflict(true);
        if (body.acknowledgeRequired) {
          setAcknowledgeBudget(false);
          setMessage(body.error ?? "Acknowledge the field budget to publish.");
        } else {
          setMessage(body.error ?? "Publish failed.");
        }
        return;
      }
      if (typeof body.id !== "string" || !body.id || !Number.isInteger(body.version) || Number(body.version) < 1) {
        throw new Error("Publication could not be confirmed");
      }
      // The acknowledged version becomes the local baseline immediately. A
      // refresh failure must not turn a confirmed publish into another POST.
      const schema: ScoutSchema = { id: body.id, version: Number(body.version), orgId, year: year!, type, definition: body.definition ?? definition };
      const nextPayload = payload ? { ...payload, schemas: [...payload.schemas.filter(entry => entry.type !== type), schema] } : null;
      if (nextPayload) {
        setPayload(nextPayload);
        payloadRef.current = nextPayload;
        void persistScoutFormsSnapshot(orgId, nextPayload);
      }
      // Assign the stored field keys to the editor before another rename can
      // generate a different key and disconnect already-collected answers.
      let cleanupFailed = false;
      try {
        if (writtenDraftRef.current) removeFormEditorDraft(window.localStorage, writtenDraftRef.current);
        if (recoveredDraftRef.current) removeFormEditorDraft(window.localStorage, recoveredDraftRef.current);
      } catch { cleanupFailed = true; }
      loadSchemaIntoDraft(schema, type, year, false);
      if (cleanupFailed) setDraftError("Publication succeeded, but the old device draft could not be removed.");
      setMessage("");
      setPublished({ id: body.id, version: Number(body.version) });
    } catch {
      if (currentOrgRef.current !== orgId || generation !== loadGenerationRef.current) return;
      setMessage("Could not confirm publication. Check the published form in another tab before retrying; your draft is still here.");
    } finally {
      publishingRef.current = false;
      setPublishing(false);
    }
  }

  if (loadedOrg === orgId && loadError && !payload) {
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

  if (!payload || loadedOrg !== orgId) {
    return (
      <FormBuilderShell orgId={orgId} shell="loading" entryType={type}>
        <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />
      </FormBuilderShell>
    );
  }

  const shell = classifyFormBuilderShell({
    orgId,
    eventKey: payload.eventKey,
    year: payload.year ?? year,
    hasPublishedSchema: Boolean(currentSchema),
  });
  const publishBlocked = publicationConflict ? "Review the newer published form before publishing." : formBuilderPublishBlockedReason({
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
      <header className="sfb-heading">{!embedded ? <h1>Scouting forms</h1> : null}<p>Build your questions. Preview the form. Review the answers.</p></header>

      <div className="sfb-document-actions" role="group" aria-label="Form publication">
        <div className="sfb-action-status" role="status"><strong>{publishStatus.label}</strong><span>{publishStatus.detail}</span></div>
        <ActionMenu overflowOnly label="Form options" actions={[
          { id: "scoring", label: "Scoring formulas", onClick: () => setFormulaOpen(true) },
          ...(payload.canManageSchemas && publishStatus.kind !== "published" ? [{ id: "scout", label: "Open scouting", href: scoutingHref }] : []),
          { id: "assign", label: payload.canManageSchemas ? "Assign scouts" : "View assignments", href: hubHref("/competition", "scout-coverage-live", orgId) },
          ...(currentSchema && publishStatus.kind === "draft_changes" && payload.canManageSchemas ? [{ id: "discard", label: "Undo my changes", disabled: busy, onClick: () => void discardChanges() }] : []),
        ]} />
        {payload.canManageSchemas && publishStatus.kind !== "published" ? <Button variant="primary" type="button" disabled={busy || Boolean(publishBlocked)} title={publishBlocked ?? publishStatus.detail} aria-describedby={publishBlocked ? "sfb-publish-reason" : undefined} onClick={() => void publish()}>{publishLabel}</Button>
          : <Button as="a" variant={publicationConfirmed ? "primary" : "secondary"} href={scoutingHref}>Open scouting</Button>}
      </div>

      <ScoringFormulas key={`${orgId}:${payload.userId ?? "unknown"}`} open={formulaOpen} orgId={orgId} userId={payload.userId} schema={payload.schemas.find(schema => schema.type === "match")} canManage={payload.canManageSchemas} onClose={() => {
        setFormulaOpen(false);
        if (requestedFormulas) { const url = new URL(window.location.href); url.searchParams.delete("formulas"); window.history.replaceState(window.history.state, "", url); }
      }} />

      <OfflineBanner feature="Scout forms" fromCache={fromCache} cachedAt={cachedAt} />

      {draftError ? <p className="sfb-publish-blocked" role="alert">{draftError}</p> : null}
      {publicationConflict ? <section className="sfb-conflict app-card soft-panel" aria-label="Form version conflict">
        <p role="alert"><strong>A newer form is published.</strong> Your draft remains saved separately.</p>
        {currentSchema && baseSchemaIdRef.current !== currentSchema.id ? <>
          <h2>Published version {currentSchema.version}: {currentSchema.definition.title}</h2>
          <p className="app-muted">Compare these published questions with your draft below. Keeping your draft does not merge another lead’s changes.</p>
          <ol>{currentSchema.definition.fields.map(field => <li key={field.key}>{field.label}{field.required ? " · Required" : ""}</li>)}</ol>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void keepDraftOverLatest()}>Keep my draft over this version</Button>
        </> : null}
        <Button type="button" variant="ghost" disabled={busy} onClick={() => { if (saveCurrentDraft()) void load(year ?? undefined, false); }}>Review latest form</Button>
      </section> : null}
      {payload.canManageSchemas && draftChoices.some(draft => draft.editorId !== editorIdRef.current) ? <details className="app-card soft-panel"><summary>Saved drafts on this device</summary><p className="app-muted">Drafts are private to your account, team, game and form type.</p>{draftChoices.filter(draft => draft.editorId !== editorIdRef.current).map(draft => <Button key={draft.editorId} type="button" variant="secondary" disabled={busy} onClick={() => restoreDraft(draft.editorId)}>{draft.title || "Untitled form"} · {new Date(draft.savedAt).toLocaleString()}</Button>)}</details> : null}

      {/* Publishing was confirmed by small blue text beside a "Republish" button, with no way
          back to the setup list that sent the owner here. */}
      {publicationConfirmed ? (
        <section className="sfb-published-card" role="status">
          <div>
            <strong>Published</strong>
            <span>Scouts see this form the next time they open Scout.</span>
          </div>
        </section>
      ) : null}

      {shell === "empty" ? (
        <section className="sfb-shell-empty sfb-published-card" role="status">
          <div><strong>{payload.canManageSchemas ? "Ready to publish" : "No published form yet"}</strong><span>{payload.canManageSchemas ? "Start with these questions or tailor them below." : "Ask a scouting lead or team admin to publish a form. The questions below are a preview."}</span></div>
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
        <p id="sfb-publish-reason" className="sfb-publish-blocked" role="status">
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
          if (!saveCurrentDraft()) return;
          setPublished(null); void load(Number(event.target.value));
        }}>{Array.from(new Set([year ?? latestScoutingYear(), latestScoutingYear(), 2025, 2024])).sort((a,b) => b-a).map(value => <option key={value} value={value}>{scoutingGameLabel(value)}</option>)}</select></FormRow>
      </div>
      <div className="sfb-workspace-bar">
        <ToolStrip presentation="segments" aria-label="Form workspace" value={mode} onChange={id => setMode(id as FormBuilderMode)} items={[{ id: "edit", label: "Questions" }, { id: "preview", label: "Preview" }, { id: "responses", label: "Responses" }]} />
        <p className={`sfb-document-state sfb-status-${publishStatus.kind}`} role="status"><strong>{publishStatus.label}</strong><span>{publishStatus.kind === "published" ? "Live for your team" : draftError ? "Draft not saved — keep this editor open" : draftSavedAt ? "Draft saved on this device · not yet published" : "Saving draft on this device…"}</span></p>
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
        <Panel as="section" className={mode === "preview" ? "sfb-tablet-panel" : mode === "edit" ? "sfb-question-document" : undefined}>
          {mode === "responses" ? <FormsResponses orgId={orgId} schemaId={currentSchema?.id} /> : mode === "preview" ? (
            <>
              <h2>What scouts see</h2>
              <p className="app-muted">
                The same buttons and steppers as the scout form on a phone. Scouts also pick the match and robot
                first.
              </p>
              <FormsTabletPreview key={`${year}:${type}`} type={type} title={title || "Untitled form"} questions={questions} />
            </>
          ) : (
            <>
              <header className="sfb-question-head" style={{ marginBottom: 8 }}>
                <div>
                  <h2 style={{ margin: 0 }}>Questions</h2>
                  <p className="app-muted" style={{ margin: "4px 0 0" }}>
                    {answerQuestionCount} {answerQuestionCount === 1 ? "question" : "questions"} · Select to edit. Drag to reorder.
                  </p>
                </div>
                <Button variant="ghost" size="sm" type="button" aria-pressed={showAllQuestions} onClick={() => setShowAllQuestions(previous => !previous)}>
                  {showAllQuestions ? "Focus one question" : "Expand all questions"}
                </Button>
              </header>
              <div className="sfb-edit-tools">
                <label><span>Jump to question</span><select aria-label="Jump to question" value={focusedQuestionId ?? ""} onChange={event => {
                  questionFocusRef.current = event.target.value;
                  setShowAllQuestions(false); setEditingQuestionId(event.target.value);
                }}>{questions.map((question, index) => <option key={question.id} value={question.id}>{index + 1}. {question.label || "Untitled question"}{question.kind === "section" ? " · Section" : ""}</option>)}</select></label>
                <Button variant="secondary" type="button" disabled={!payload.canManageSchemas || busy} onClick={() => addQuestion()}>Add question</Button>
              </div>
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
                    data-expanded={showAllQuestions || focusedQuestionId === question.id}
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
                    {showAllQuestions || focusedQuestionId === question.id ? <>
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
                          <FormsVisibilityEditor rule={question.visibleWhen} fieldKey={previewDefinition.fields[index]!.key} fields={previewDefinition.fields} disabled={!payload.canManageSchemas || busy} onChange={visibleWhen => setQuestions(previous => {
                            // Conditions reference stable keys, so later label edits cannot break them.
                            const definition = definitionFromDraft(title, previous);
                            return previous.map((item, i) => ({ ...item, key: definition.fields[i]!.key, ...(item.id === question.id ? { visibleWhen } : {}) }));
                          })} />
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
                    </> : null}
                    </div>
                  </article>
                  </Fragment>
                ))}
                {questionDrag.slotIndex("questions") !== null &&
                questionDrag.slotIndex("questions")! >= questions.filter((item) => item.id !== questionDrag.drag?.id).length ? (
                  <div className="tier-drop-slot" aria-hidden="true" />
                ) : null}
              </div>
            </>
          )}
        </Panel>

      </div>
    </Root>
  );
}
