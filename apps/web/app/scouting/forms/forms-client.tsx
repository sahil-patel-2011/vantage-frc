"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  FIELD_POSITION_MAX_GRID,
  FIELD_POSITION_MIN_GRID,
  RATING_MAX_STARS,
  RATING_MIN_STARS,
  type EntryType,
  type FormResetBehavior,
  type SchemaDefinition,
  type ScoutSchema,
} from "@vantage/scouting";
import { StudioField } from "../studio-fields";
import "../scouting.css";
import { EmptyState, FormRow, PageHeader, Panel, TabBar } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import {
  ANSWER_KIND_OPTIONS,
  DRIVETRAIN_OPTIONS_TEXT,
  FORM_BUILDER_RELATED_INCLUDE,
  IMPORTED_FORM_DRAFT_KEY,
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
  isStudioAnswerKind,
  moveOption,
  moveQuestion,
  needsOptionEditor,
  needsSettingsEditor,
  newDraftQuestion,
  parseOptions,
  parseSubCounters,
  previewFieldForQuestion,
  removeOption,
  resolveDraftPublishStatus,
  retypeQuestion,
  RESET_BEHAVIOR_OPTIONS,
  SCOUT_IDENTITY_LOCK_COPY,
  serializeOptions,
  STRATEGY_ROLE_OPTIONS,
  detectedRoleForQuestion,
  updateOptionAt,
  validateDraft,
  type AnswerKind,
  type DraftFieldSettings,
  type DraftQuestion,
  type FormBuilderNextAction,
  type FormBuilderShellKind,
  type StrategyFieldRole,
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
      newDraftQuestion({
        label: "Programming language",
        kind: "dropdown",
        optionsText: "java, c++, python, labview, other",
      }),
      newDraftQuestion({ label: "Drivetrain motors", kind: "short" }),
      newDraftQuestion({ label: "Driver seasons of experience", kind: "number" }),
      newDraftQuestion({ label: "Coach seasons of experience", kind: "number" }),
      newDraftQuestion({ label: "Robot images", kind: "robot_image" }),
      newDraftQuestion({ label: "Notes", kind: "free", role: "notes" }),
    ];
  }
  // Default roles so an untouched starter form feeds strategy out of the box.
  return [
    newDraftQuestion({ label: "Auto score", kind: "number", role: "auto_score" }),
    newDraftQuestion({ label: "Teleop score", kind: "number", role: "teleop_score" }),
    newDraftQuestion({
      label: "Endgame",
      kind: "dropdown",
      optionsText: "none, partial, full",
      role: "endgame",
    }),
    newDraftQuestion({ label: "Notes", kind: "free", role: "notes" }),
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
        <p className="app-muted">Each one opens the page where you finish the work.</p>
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
  errorStatus,
  onRetry,
  children,
}: {
  orgId?: string | null;
  shell: FormBuilderShellKind;
  entryType?: EntryType;
  error?: string;
  /** HTTP status of the failed load, so an expired session can offer sign-in. */
  errorStatus?: number | null;
  onRetry?: () => void;
  children?: ReactNode;
}) {
  const actions = formBuilderNextActions({ orgId, shell, entryType });
  const copy = formBuilderShellCopy(shell, { entryType });
  const steps = shell === "setup" ? formBuilderSetupSteps(orgId) : [];
  const failure =
    shell === "error"
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus ?? null,
            message: error ?? null,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error ?? null,
          },
        )
      : null;
  const workspaceHref = orgId ? withOrgHref("/workspace", orgId) : "/workspace";
  const commandHref = hubHref("/competition", "command", orgId);
  const scoutingHref = hubHref("/competition", "scouting", orgId);
  const coverageHref = withOrgHref("/scouting/lineup", orgId);

  return (
    <main className="module-page sfb-page soft-gate">
      <PageHeader
        breadcrumbs="Competition / Form builder"
        title="Scouting form builder"
        description="Publish versioned match or pit schemas. Scouts and Coverage stay blank until a real version exists."
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
        title={failure ? failure.title : copy.title}
        description={failure ? failure.description : (error ?? copy.description)}
        aria-busy={shell === "loading"}
      >
        {failure?.primary ? (
          <a className="app-button" href={failure.primary.href}>
            {failure.primary.label}
          </a>
        ) : null}
        {failure?.showRetry && onRetry ? (
          <button type="button" className="app-button secondary" onClick={onRetry}>
            Retry
          </button>
        ) : null}
        {shell === "setup" ? (
          <a className="app-button" href={orgId ? commandHref : workspaceHref}>
            {orgId ? "Set active event" : "Choose your team"}
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

/**
 * Config editor for the studio answer types.
 *
 * Everything here writes into the draft's `settings`, which `definitionFromDraft`
 * serializes into the published `config` — the exact bag the entry renderers and
 * the server-side validator both read. One source of truth for "what is in range".
 */
function StudioSettingsEditor({
  question,
  disabled,
  onChange,
}: {
  question: DraftQuestion;
  disabled: boolean;
  onChange(settings: DraftFieldSettings): void;
}) {
  const settings = question.settings ?? {};
  const patch = (next: DraftFieldSettings) => onChange({ ...settings, ...next });
  const numberOr = (raw: string, fallback: number) => {
    const value = Number(raw);
    return Number.isFinite(value) ? value : fallback;
  };

  if (question.kind === "counter" || question.kind === "multi_counter") {
    const subCounters = parseSubCounters(settings.subCountersText);
    return (
      <div className="sfb-settings">
        {question.kind === "multi_counter" ? (
          <FormRow
            label="Named counters"
            hint={
              subCounters.length
                ? `${subCounters.length} counter${subCounters.length === 1 ? "" : "s"}: ${subCounters
                    .map((counter) => counter.label)
                    .join(" · ")}`
                : "Add at least one — comma separated (e.g. High, Mid, Low)"
            }
          >
            <input
              value={settings.subCountersText ?? ""}
              disabled={disabled}
              placeholder="High, Mid, Low"
              aria-label="Named counters"
              onChange={(event) => patch({ subCountersText: event.target.value })}
            />
          </FormRow>
        ) : null}
        <FormRow label="Bulk step buttons" hint="Comma separated; the first one is the big primary tap">
          <input
            value={settings.counterStepsText ?? ""}
            disabled={disabled}
            placeholder="1, 5, 10"
            aria-label="Counter step buttons"
            onChange={(event) => patch({ counterStepsText: event.target.value })}
          />
        </FormRow>
        <FormRow label="Max" hint="Blank for no cap — the server rejects anything above it">
          <input
            type="number"
            value={settings.maxText ?? ""}
            disabled={disabled}
            placeholder="No cap"
            aria-label="Counter maximum"
            onChange={(event) => patch({ maxText: event.target.value })}
          />
        </FormRow>
        <label className="sfb-check">
          <input
            type="checkbox"
            checked={Boolean(settings.allowNegative)}
            disabled={disabled}
            onChange={(event) => patch({ allowNegative: event.target.checked })}
          />
          <span>
            <strong>Allow negative counts</strong>
            <small className="app-muted">Off by default — a tally cannot go below zero</small>
          </span>
        </label>
      </div>
    );
  }

  if (question.kind === "timer") {
    return (
      <div className="sfb-settings">
        <FormRow
          label="Stopwatch mode"
          hint={
            settings.timerMode === "total"
              ? "Start-stop adds to one running total"
              : "Each start-stop records a lap; the total and average come from the laps"
          }
        >
          <select
            value={settings.timerMode ?? "lap"}
            disabled={disabled}
            aria-label="Stopwatch mode"
            onChange={(event) => patch({ timerMode: event.target.value === "total" ? "total" : "lap" })}
          >
            <option value="lap">Laps — one per start-stop</option>
            <option value="total">Total — one running clock</option>
          </select>
        </FormRow>
      </div>
    );
  }

  if (question.kind === "rating") {
    return (
      <div className="sfb-settings">
        <FormRow label="Stars" hint={`Between ${RATING_MIN_STARS} and ${RATING_MAX_STARS}`}>
          <input
            type="number"
            min={RATING_MIN_STARS}
            max={RATING_MAX_STARS}
            value={settings.ratingMax ?? 5}
            disabled={disabled}
            aria-label="Rating stars"
            onChange={(event) => patch({ ratingMax: numberOr(event.target.value, 5) })}
          />
        </FormRow>
      </div>
    );
  }

  if (question.kind === "slider") {
    return (
      <div className="sfb-settings">
        <FormRow label="Min">
          <input
            type="number"
            value={settings.sliderMin ?? 0}
            disabled={disabled}
            aria-label="Slider minimum"
            onChange={(event) => patch({ sliderMin: numberOr(event.target.value, 0) })}
          />
        </FormRow>
        <FormRow label="Max">
          <input
            type="number"
            value={settings.sliderMax ?? 10}
            disabled={disabled}
            aria-label="Slider maximum"
            onChange={(event) => patch({ sliderMax: numberOr(event.target.value, 10) })}
          />
        </FormRow>
        <FormRow label="Step" hint="Must be positive and no wider than the range">
          <input
            type="number"
            value={settings.sliderStep ?? 1}
            disabled={disabled}
            aria-label="Slider step"
            onChange={(event) => patch({ sliderStep: numberOr(event.target.value, 1) })}
          />
        </FormRow>
        <FormRow label="Low end label" hint="Optional — shown under the left end">
          <input
            value={settings.sliderMinLabel ?? ""}
            disabled={disabled}
            placeholder="e.g. Never"
            aria-label="Slider low label"
            onChange={(event) => patch({ sliderMinLabel: event.target.value })}
          />
        </FormRow>
        <FormRow label="High end label" hint="Optional — shown under the right end">
          <input
            value={settings.sliderMaxLabel ?? ""}
            disabled={disabled}
            placeholder="e.g. Every cycle"
            aria-label="Slider high label"
            onChange={(event) => patch({ sliderMaxLabel: event.target.value })}
          />
        </FormRow>
      </div>
    );
  }

  if (question.kind === "field_position") {
    return (
      <div className="sfb-settings">
        <FormRow
          label="Grid columns"
          hint={`${FIELD_POSITION_MIN_GRID}–${FIELD_POSITION_MAX_GRID}. Only cell numbers are stored — no game art, so the form survives the next reveal.`}
        >
          <input
            type="number"
            min={FIELD_POSITION_MIN_GRID}
            max={FIELD_POSITION_MAX_GRID}
            value={settings.gridCols ?? 6}
            disabled={disabled}
            aria-label="Field grid columns"
            onChange={(event) => patch({ gridCols: numberOr(event.target.value, 6) })}
          />
        </FormRow>
        <FormRow label="Grid rows" hint={`${FIELD_POSITION_MIN_GRID}–${FIELD_POSITION_MAX_GRID}`}>
          <input
            type="number"
            min={FIELD_POSITION_MIN_GRID}
            max={FIELD_POSITION_MAX_GRID}
            value={settings.gridRows ?? 3}
            disabled={disabled}
            aria-label="Field grid rows"
            onChange={(event) => patch({ gridRows: numberOr(event.target.value, 3) })}
          />
        </FormRow>
      </div>
    );
  }

  return null;
}

/**
 * Live preview of one studio field.
 *
 * It renders the real entry control against the real published config, so what
 * a coach taps here is exactly what a scout will tap in the stands. State is
 * local and thrown away — nothing previewed is ever saved.
 */
function StudioPreviewField({ question }: { question: DraftQuestion }) {
  const field = useMemo(() => previewFieldForQuestion(question), [question]);
  const [value, setValue] = useState<unknown>(undefined);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;
  return <StudioField field={field} value={value} onChange={setValue} label={label} />;
}

function PreviewField({ question }: { question: DraftQuestion }) {
  const options = parseOptions(question.optionsText);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;

  if (isStudioAnswerKind(question.kind)) {
    return <StudioPreviewField question={question} />;
  }
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

export default function FormsClient({ orgId }: { orgId: string; embedded?: boolean }) {
  const [payload, setPayload] = useState<SchemasPayload | null>(null);
  const [loadError, setLoadError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [loadErrorStatus, setLoadErrorStatus] = useState<number | null>(null);
  const [type, setType] = useState<EntryType>("match");
  const [mode, setMode] = useState<Mode>("edit");
  const [title, setTitle] = useState("Match scouting");
  const [questions, setQuestions] = useState<DraftQuestion[]>(() => defaultQuestions("match"));
  const [year, setYear] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [acknowledgeBudget, setAcknowledgeBudget] = useState(false);
  const [published, setPublished] = useState<{ id: string; version: number } | null>(null);

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
    setLoadError("");
    setLoadErrorStatus(null);
    try {
      const response = await fetch(`/api/scouting/schemas?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      const body = (await response.json()) as SchemasPayload & { error?: string };
      if (!response.ok) {
        setLoadErrorStatus(response.status);
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
        description="Configure required fields, preview, and publish versioned match or pit schemas."
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
