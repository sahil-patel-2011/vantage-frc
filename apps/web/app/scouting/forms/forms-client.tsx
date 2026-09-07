"use client";

import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DRIVETRAIN_OPTIONS,
  FIELD_POSITION_MAX_GRID,
  FIELD_POSITION_MIN_GRID,
  RATING_MAX_STARS,
  RATING_MIN_STARS,
  type EntryType,
  type FieldVisibilityOp,
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
  conditionControllerCandidates,
  definitionFromDraft,
  draftFromDefinition,
  formatDraftSaveIndicator,
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
  type DraftSaveState,
  type FormBuilderNextAction,
  type FormBuilderShellKind,
  type StrategyFieldRole,
} from "../../../lib/scouting/form-builder";
import { VISIBILITY_OP_OPTIONS, visibleFieldsForPayload } from "../../../lib/scouting/conditional";
import type { FormDraftRow, FormTemplateRow, StarterTemplate } from "../../../lib/scouting/form-studio";
import { hubHref } from "../../../lib/nav/hubs";
import { withOrgHref } from "../../../lib/nav/product-nav";

type SchemasPayload = {
  eventKey: string | null;
  year: number | null;
  /** "event" when the active event pins the season; "season" = offseason fallback. */
  yearSource?: "event" | "season";
  schemas: ScoutSchema[];
  canManageSchemas: boolean;
};

type ServerDrafts = Partial<Record<EntryType, FormDraftRow>>;

type TemplateCatalog = {
  activeYear: number;
  templates: FormTemplateRow[];
  starters: StarterTemplate[];
};

/** Debounce for the server-side autosave — long enough to batch typing, short enough to survive a tab close. */
const AUTOSAVE_DEBOUNCE_MS = 1500;

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
        <p className="app-muted">Scouting and Coverage — never DEMO fields.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href} aria-label={action.label}>Open</a>
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
                <a href={step.href} aria-label={step.label}>Open</a>
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
 * a coach taps here is exactly what a scout will tap in the stands. Answers live
 * in the preview's own scratch map (so "show only when" can be exercised) and are
 * thrown away — nothing previewed is ever saved.
 */
function StudioPreviewField({
  question,
  value,
  onChange,
}: {
  question: DraftQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const field = useMemo(() => previewFieldForQuestion(question), [question]);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;
  return <StudioField field={field} value={value} onChange={onChange} label={label} />;
}

function PreviewField({
  question,
  value,
  onChange,
}: {
  question: DraftQuestion;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const options = parseOptions(question.optionsText);
  const label = `${question.label || "Untitled"}${question.required ? " *" : ""}`;
  const text = typeof value === "string" ? value : "";

  if (isStudioAnswerKind(question.kind)) {
    return <StudioPreviewField question={question} value={value} onChange={onChange} />;
  }
  if (question.kind === "yesno") {
    return (
      <label className="sfb-check">
        <input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} />
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
              <input
                type="radio"
                name={question.id}
                checked={value === option}
                onChange={() => onChange(option)}
              />
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
        <select value={text} onChange={(event) => onChange(event.target.value || undefined)}>
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
        <textarea
          value={text}
          placeholder="Free-text notes…"
          onChange={(event) => onChange(event.target.value || undefined)}
        />
      </FormRow>
    );
  }
  if (question.kind === "number") {
    return (
      <FormRow label={label}>
        <input
          type="number"
          value={typeof value === "number" ? value : ""}
          placeholder="0"
          onChange={(event) => onChange(event.target.value === "" ? undefined : Number(event.target.value))}
        />
      </FormRow>
    );
  }
  return (
    <FormRow label={label}>
      <input
        type="text"
        value={text}
        placeholder="Short answer"
        onChange={(event) => onChange(event.target.value || undefined)}
      />
    </FormRow>
  );
}

/** Value editor for a "show only when" condition, shaped by the controlling question. */
function ConditionValueInput({
  controller,
  value,
  disabled,
  onChange,
}: {
  controller: DraftQuestion | undefined;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  if (controller?.kind === "yesno") {
    return (
      <select value={value || "true"} disabled={disabled} aria-label="Condition value" onChange={(event) => onChange(event.target.value)}>
        <option value="true">Yes / checked</option>
        <option value="false">No / unchecked</option>
      </select>
    );
  }
  if (controller && needsOptionEditor(controller.kind)) {
    const options = parseOptions(controller.optionsText);
    const choices = options.length ? options : controller.kind === "drivetrain" ? [...DEFAULT_DRIVETRAIN_OPTIONS] : [];
    return (
      <select value={value} disabled={disabled} aria-label="Condition value" onChange={(event) => onChange(event.target.value)}>
        <option value="">Choose…</option>
        {choices.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  const numeric =
    controller?.kind === "number" ||
    controller?.kind === "counter" ||
    controller?.kind === "rating" ||
    controller?.kind === "slider" ||
    controller?.kind === "timer";
  return (
    <input
      type={numeric ? "number" : "text"}
      value={value}
      disabled={disabled}
      placeholder={numeric ? "e.g. 20" : "value"}
      aria-label="Condition value"
      onChange={(event) => onChange(event.target.value)}
    />
  );
}

/** "Start from…" — last season's published form, a saved template, or a game-pack starter. */
function StartFromDrawer({
  entryType,
  year,
  catalog,
  busy,
  canManage,
  onClose,
  onLastSeason,
  onApply,
  onDeleteTemplate,
  onReload,
}: {
  entryType: EntryType;
  year: number | null;
  catalog: TemplateCatalog | null;
  busy: boolean;
  canManage: boolean;
  onClose: () => void;
  onLastSeason: () => void;
  onApply: (source: { templateId?: string; starterId?: string; name: string }) => void;
  onDeleteTemplate: (templateId: string) => void;
  onReload: () => void;
}) {
  const templates = catalog?.templates.filter((template) => template.formKind === entryType) ?? [];
  const starters = catalog?.starters.filter((starter) => starter.formKind === entryType) ?? [];
  return (
    <Panel as="section" className="sfb-drawer" aria-label="Start from">
      <header className="sfb-drawer-head">
        <div>
          <h2>Start from…</h2>
          <p className="app-muted">
            Replaces the current {entryType} draft (autosaved, not published). Nothing goes live until you publish.
          </p>
        </div>
        <button type="button" className="app-button secondary" onClick={onClose}>
          Close
        </button>
      </header>
      <ul className="sfb-template-list">
        <li>
          <div>
            <strong>Last season&apos;s {entryType} form</strong>
            <span className="app-muted">
              Copies your newest published form from before {year ?? "this season"} — keys stay stable for strategy.
            </span>
          </div>
          <button type="button" className="app-button secondary" disabled={busy || !canManage} onClick={onLastSeason}>
            Use last season
          </button>
        </li>
        {templates.map((template) => (
          <li key={template.id}>
            <div>
              <strong>{template.name}</strong>
              <span className="app-muted">
                {template.fieldCount} fields
                {template.sourceYear ? ` · from ${template.sourceYear}` : ""}
                {template.createdByName ? ` · ${template.createdByName}` : ""}
                {template.description ? ` · ${template.description}` : ""}
              </span>
            </div>
            <div className="sfb-template-actions">
              <button
                type="button"
                className="app-button secondary"
                disabled={busy || !canManage}
                onClick={() => onApply({ templateId: template.id, name: template.name })}
              >
                Use template
              </button>
              <button
                type="button"
                className="sfb-inline-button"
                disabled={busy || !canManage}
                aria-label={`Delete template ${template.name}`}
                onClick={() => onDeleteTemplate(template.id)}
              >
                Delete
              </button>
            </div>
          </li>
        ))}
        {starters.map((starter) => (
          <li key={starter.id}>
            <div>
              <strong>{starter.name}</strong>
              <span className="app-muted">
                Built-in starter · {starter.fieldCount} fields · {starter.description}
              </span>
            </div>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy || !canManage}
              onClick={() => onApply({ starterId: starter.id, name: starter.name })}
            >
              Use starter
            </button>
          </li>
        ))}
        {!catalog ? (
          <li>
            <div>
              <strong>Loading templates…</strong>
              <span className="app-muted">Saved templates and game-pack starters appear here.</span>
            </div>
            <button type="button" className="app-button secondary" onClick={onReload}>
              Retry
            </button>
          </li>
        ) : null}
      </ul>
    </Panel>
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
  // Server-side draft (autosave / resume on any device) + "Start from…" catalog.
  const [serverDrafts, setServerDrafts] = useState<ServerDrafts>({});
  const [draftSaveState, setDraftSaveState] = useState<DraftSaveState>("idle");
  const [draftSavedAt, setDraftSavedAt] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [resumedDraft, setResumedDraft] = useState(false);
  const [startFromOpen, setStartFromOpen] = useState(false);
  const [catalog, setCatalog] = useState<TemplateCatalog | null>(null);
  const [templateName, setTemplateName] = useState("");
  // Preview scratch answers keyed by builder question id — never persisted.
  const [previewValues, setPreviewValues] = useState<Record<string, unknown>>({});
  // A load / type switch / template apply must not autosave what it just loaded.
  const skipAutosaveRef = useRef(true);

  const validation = useMemo(() => validateDraft(title, questions, type), [title, questions, type]);

  // One-shot handoff from the migrate page (undefined = not yet checked,
  // null = checked and nothing was waiting). Consumed inside loadSchemaIntoDraft
  // so the imported draft beats — rather than races — the initial schema fetch.
  const importedDraftRef = useRef<SchemaDefinition | null | undefined>(undefined);

  const loadSchemaIntoDraft = useCallback(
    (schema: ScoutSchema | undefined, nextType: EntryType, draft?: FormDraftRow | null) => {
      skipAutosaveRef.current = true;
      setResumedDraft(false);
      setPreviewValues({});
      if (importedDraftRef.current === undefined) {
        importedDraftRef.current = null;
        try {
          const raw = window.sessionStorage.getItem(IMPORTED_FORM_DRAFT_KEY);
          if (raw) {
            window.sessionStorage.removeItem(IMPORTED_FORM_DRAFT_KEY);
            const imported = JSON.parse(raw) as SchemaDefinition;
            const next = draftFromDefinition(imported);
            importedDraftRef.current = imported;
            setTitle(next.title);
            setQuestions(next.questions.length ? next.questions : defaultQuestions(nextType));
            setDraftSavedAt(null);
            setDraftSaveState("idle");
            setMessage("Imported from QRScout — review every question, then Publish. Nothing is live yet.");
            return;
          }
        } catch {
          // Malformed or blocked handoff payload: fall through to the normal load.
        }
      }
      // Resume: an autosaved draft beats the published version it was edited from.
      if (draft?.definition?.fields?.length) {
        const resumed = draftFromDefinition(draft.definition);
        setTitle(draft.title || resumed.title);
        setQuestions(resumed.questions.length ? resumed.questions : defaultQuestions(nextType));
        setYear(draft.seasonYear);
        setDraftSavedAt(draft.updatedAt);
        setDraftSaveState("saved");
        setResumedDraft(true);
        return;
      }
      setDraftSavedAt(null);
      setDraftSaveState("idle");
      if (schema?.definition) {
        const next = draftFromDefinition(schema.definition);
        setTitle(next.title);
        setQuestions(next.questions.length ? next.questions : defaultQuestions(nextType));
        setYear(schema.year);
        return;
      }
      setTitle(nextType === "pit" ? "Pit scouting" : "Match scouting");
      setQuestions(defaultQuestions(nextType));
    },
    [],
  );

  const loadDrafts = useCallback(
    async (seasonYear: number, canManage: boolean): Promise<ServerDrafts> => {
      if (!canManage) return {};
      try {
        const response = await fetch(
          `/api/scouting/form-drafts?orgId=${encodeURIComponent(orgId)}&seasonYear=${seasonYear}`,
          { cache: "no-store" },
        );
        if (!response.ok) return {};
        const body = (await response.json()) as { drafts?: FormDraftRow[] };
        const next: ServerDrafts = {};
        for (const draft of body.drafts ?? []) next[draft.formKind] = draft;
        return next;
      } catch {
        return {};
      }
    },
    [orgId],
  );

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
      const drafts = body.year != null ? await loadDrafts(body.year, body.canManageSchemas) : {};
      setServerDrafts(drafts);
      const active = body.schemas.find((schema) => schema.type === type);
      loadSchemaIntoDraft(active, type, drafts[type] ?? null);
    } catch {
      setLoadError("Could not reach the schemas API.");
    }
  }, [orgId, type, loadSchemaIntoDraft, loadDrafts]);

  useEffect(() => {
    void load();
    // Mount / org only — type switches reuse the loaded schema list.
     
  }, [orgId]);

  // "Saved · 12s ago" keeps ticking without a re-render per keystroke.
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 5_000);
    return () => window.clearInterval(id);
  }, []);

  const currentSchema = payload?.schemas.find((schema) => schema.type === type);
  const publishStatus = useMemo(
    () =>
      resolveDraftPublishStatus({
        published: currentSchema
          ? { version: currentSchema.version, definition: currentSchema.definition }
          : null,
        draftTitle: title,
        draftQuestions: questions,
      }),
    [currentSchema, title, questions],
  );

  const saveDraft = useCallback(async () => {
    if (!payload?.canManageSchemas || year == null) return;
    const headersJson = { "content-type": "application/json" };
    if (publishStatus.kind === "published") {
      // The draft equals the live form — nothing to resume later. Clear a stale server draft.
      setDraftSaveState("idle");
      setDraftSavedAt(null);
      if (serverDrafts[type]) {
        setServerDrafts((prev) => {
          const next = { ...prev };
          delete next[type];
          return next;
        });
        await fetch("/api/scouting/form-drafts", {
          method: "DELETE",
          headers: headersJson,
          body: JSON.stringify({ orgId, formKind: type, seasonYear: year }),
        }).catch(() => undefined);
      }
      return;
    }
    setDraftSaveState("saving");
    try {
      const response = await fetch("/api/scouting/form-drafts", {
        method: "PUT",
        headers: headersJson,
        body: JSON.stringify({
          orgId,
          formKind: type,
          seasonYear: year,
          title,
          definition: definitionFromDraft(title, questions),
          baseSchemaId: currentSchema?.id ?? null,
        }),
      });
      const body = (await response.json()) as { draft?: FormDraftRow; error?: string };
      if (!response.ok || !body.draft) {
        setDraftSaveState("error");
        return;
      }
      const saved = body.draft;
      setServerDrafts((prev) => ({ ...prev, [type]: saved }));
      setDraftSavedAt(saved.updatedAt);
      setDraftSaveState("saved");
    } catch {
      setDraftSaveState("error");
    }
  }, [payload?.canManageSchemas, year, publishStatus.kind, serverDrafts, type, orgId, title, questions, currentSchema?.id]);

  useEffect(() => {
    if (!payload?.canManageSchemas || year == null) return;
    if (skipAutosaveRef.current) {
      skipAutosaveRef.current = false;
      return;
    }
    setDraftSaveState("dirty");
    const handle = window.setTimeout(() => {
      void saveDraft();
    }, AUTOSAVE_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
    // Content changes schedule the save; saveDraft's identity follows the same content.
  }, [title, questions, type, year, payload?.canManageSchemas]);

  function switchType(next: EntryType) {
    setType(next);
    setPublished(null);
    setMessage("");
    setAcknowledgeBudget(false);
    setStartFromOpen(false);
    const schema = payload?.schemas.find((entry) => entry.type === next);
    loadSchemaIntoDraft(schema, next, serverDrafts[next] ?? null);
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

  function removeQuestion(id: string) {
    setQuestions((prev) =>
      prev
        .filter((entry) => entry.id !== id)
        // A question that depended on the removed one is shown again, not left dangling.
        .map((entry) => (entry.visibleWhen?.questionId === id ? { ...entry, visibleWhen: undefined } : entry)),
    );
  }

  async function loadCatalog() {
    try {
      const response = await fetch(`/api/scouting/form-templates?orgId=${encodeURIComponent(orgId)}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      setCatalog((await response.json()) as TemplateCatalog);
    } catch {
      // The drawer keeps its retry row.
    }
  }

  function openStartFrom() {
    setStartFromOpen(true);
    if (!catalog) void loadCatalog();
  }

  /** Replace the working draft with a server draft row (clone / template / starter). */
  function applyDraftRow(draft: FormDraftRow, note: string) {
    skipAutosaveRef.current = true;
    const next = draftFromDefinition(draft.definition);
    setTitle(draft.title || next.title);
    setQuestions(next.questions.length ? next.questions : defaultQuestions(type));
    setServerDrafts((prev) => ({ ...prev, [type]: draft }));
    setDraftSavedAt(draft.updatedAt);
    setDraftSaveState("saved");
    setResumedDraft(false);
    setPreviewValues({});
    setPublished(null);
    setAcknowledgeBudget(false);
    setStartFromOpen(false);
    setMessage(note);
  }

  async function startFromLastSeason() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/scouting/schemas", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, action: "clone_season", type, year }),
      });
      const body = (await response.json()) as {
        draft?: FormDraftRow;
        source?: { year: number; version: number };
        error?: string;
      };
      if (!response.ok || !body.draft) {
        setMessage(body.error ?? "No earlier-season form to clone.");
        return;
      }
      applyDraftRow(
        body.draft,
        `Started from the ${body.source?.year ?? "previous"} ${type} form (v${body.source?.version ?? "?"}). Review, then publish.`,
      );
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function applyTemplate(source: { templateId?: string; starterId?: string; name: string }) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/scouting/form-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "apply",
          formKind: type,
          seasonYear: year,
          templateId: source.templateId,
          starterId: source.starterId,
        }),
      });
      const body = (await response.json()) as { draft?: FormDraftRow; error?: string };
      if (!response.ok || !body.draft) {
        setMessage(body.error ?? "Could not apply the template.");
        return;
      }
      applyDraftRow(body.draft, `Started from “${source.name}”. Review every question, then publish.`);
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function saveAsTemplate() {
    const name = templateName.trim();
    if (!name) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/scouting/form-templates", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId,
          action: "save",
          name,
          formKind: type,
          sourceYear: year,
          definition: definitionFromDraft(title, questions),
        }),
      });
      const body = (await response.json()) as { template?: FormTemplateRow; error?: string };
      if (!response.ok || !body.template) {
        setMessage(body.error ?? "Could not save the template.");
        return;
      }
      setTemplateName("");
      setMessage(`Saved “${body.template.name}” as a ${type} template (${body.template.fieldCount} fields).`);
      await loadCatalog();
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  async function deleteTemplate(templateId: string) {
    setBusy(true);
    try {
      await fetch("/api/scouting/form-templates", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, templateId }),
      });
      await loadCatalog();
    } finally {
      setBusy(false);
    }
  }

  async function discardDraft() {
    if (year == null) return;
    setBusy(true);
    try {
      await fetch("/api/scouting/form-drafts", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId, formKind: type, seasonYear: year }),
      }).catch(() => undefined);
      setServerDrafts((prev) => {
        const next = { ...prev };
        delete next[type];
        return next;
      });
      loadSchemaIntoDraft(currentSchema, type, null);
      setMessage(
        currentSchema
          ? `Draft discarded — showing published v${currentSchema.version}.`
          : "Draft discarded — back to the starter questions.",
      );
    } finally {
      setBusy(false);
    }
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
      // The published version IS the draft now — drop the server draft so nothing "resumes".
      if (year != null && serverDrafts[type]) {
        await fetch("/api/scouting/form-drafts", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, formKind: type, seasonYear: year }),
        }).catch(() => undefined);
        setServerDrafts((prev) => {
          const next = { ...prev };
          delete next[type];
          return next;
        });
      }
      await load();
    } catch {
      setMessage("Network error — try again.");
    } finally {
      setBusy(false);
    }
  }

  // Preview: answers keyed by builder id → payload keyed by published key, so
  // "show only when" is exercised with the exact evaluator the tablet uses.
  const previewDefinition = useMemo(() => definitionFromDraft(title, questions), [title, questions]);
  const visibleQuestionIds = useMemo(() => {
    const payloadByKey: Record<string, unknown> = {};
    questions.forEach((question, index) => {
      const key = previewDefinition.fields[index]?.key;
      const value = previewValues[question.id];
      if (key && value !== undefined) payloadByKey[key] = value;
    });
    const visibleKeys = new Set(visibleFieldsForPayload(previewDefinition, payloadByKey).map((field) => field.key));
    return new Set(
      questions
        .filter((question, index) => {
          const key = previewDefinition.fields[index]?.key;
          return key ? visibleKeys.has(key) : true;
        })
        .map((question) => question.id),
    );
  }, [questions, previewDefinition, previewValues]);
  const hiddenPreviewCount = questions.length - visibleQuestionIds.size;
  const saveIndicator = formatDraftSaveIndicator(draftSaveState, draftSavedAt, nowMs);

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
  const canManage = payload.canManageSchemas;

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
          {canManage ? (
            <span className={`sfb-autosave sfb-autosave-${draftSaveState}`} role="status" aria-live="polite">
              {saveIndicator}
            </span>
          ) : null}
          <button type="button" className="app-button secondary" disabled={!canManage} onClick={openStartFrom}>
            Start from…
          </button>
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
          {canManage ? (
            <button type="button" className="app-button" onClick={openStartFrom}>
              Start from last season or a template
            </button>
          ) : null}
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

      {startFromOpen ? (
        <StartFromDrawer
          entryType={type}
          year={year}
          catalog={catalog}
          busy={busy}
          canManage={canManage}
          onClose={() => setStartFromOpen(false)}
          onLastSeason={() => void startFromLastSeason()}
          onApply={(source) => void applyTemplate(source)}
          onDeleteTemplate={(templateId) => void deleteTemplate(templateId)}
          onReload={() => void loadCatalog()}
        />
      ) : null}

      <div
        className={`sfb-status sfb-status-${publishStatus.kind}`}
        role="status"
        aria-live="polite"
      >
        <span className="sfb-status-pill">{publishStatus.label}</span>
        <small className="app-muted">{publishStatus.detail}</small>
      </div>

      {resumedDraft ? (
        <p className="sfb-message sfb-resumed" role="status">
          Resumed your unsaved {type} draft
          {draftSavedAt ? ` from ${new Date(draftSavedAt).toLocaleString()}` : ""}.{" "}
          <button type="button" className="sfb-inline-button" disabled={busy} onClick={() => void discardDraft()}>
            Discard it and reload the published form
          </button>
        </p>
      ) : null}

      {publishBlocked && payload.canManageSchemas ? (
        <p className="sfb-publish-blocked" role="status">
          {publishBlocked}
          {year == null ? (
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
        <FormRow
          label="Season year"
          hint={
            payload.yearSource === "season"
              ? "No active event yet — authoring for the upcoming season"
              : payload.eventKey
                ? `From active event ${payload.eventKey}`
                : undefined
          }
        >
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
              <p className="app-muted">
                Tablet preview — answers are not saved here.
                {hiddenPreviewCount
                  ? ` ${hiddenPreviewCount} question${hiddenPreviewCount === 1 ? "" : "s"} hidden by “show only when” — answer the controlling questions to reveal them.`
                  : ""}
              </p>
              <div className="sfb-identity-lock" role="status">
                <span className="eyebrow">{SCOUT_IDENTITY_LOCK_COPY.eyebrow}</span>
                <strong>Signed-in member</strong>
                <small className="app-muted">
                  Live entry binds to membership userId — no free-text scout name field.
                </small>
              </div>
              <div className="sfb-preview-fields">
                {questions
                  .filter((question) => visibleQuestionIds.has(question.id))
                  .map((question) => (
                    <PreviewField
                      key={question.id}
                      question={question}
                      value={previewValues[question.id]}
                      onChange={(value) =>
                        setPreviewValues((prev) => {
                          const next = { ...prev };
                          if (value === undefined) delete next[question.id];
                          else next[question.id] = value;
                          return next;
                        })
                      }
                    />
                  ))}
              </div>
              {Object.keys(previewValues).length ? (
                <button type="button" className="app-button secondary" onClick={() => setPreviewValues({})}>
                  Clear preview answers
                </button>
              ) : null}
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
                        {question.visibleWhen ? <span className="sfb-conditional-badge">Conditional</span> : null}
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
                          onClick={() => removeQuestion(question.id)}
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
                        <FormRow
                          label="Show only when"
                          hint={
                            question.visibleWhen
                              ? "Hidden while the condition is false — a hidden required question never blocks a save."
                              : "Always shown. Pick a controlling question to make this conditional."
                          }
                        >
                          <div className="sfb-condition">
                            <select
                              value={question.visibleWhen?.questionId ?? ""}
                              disabled={!payload.canManageSchemas}
                              aria-label={`Controlling question for question ${index + 1}`}
                              onChange={(event) => {
                                const questionId = event.target.value;
                                updateQuestion(question.id, {
                                  visibleWhen: questionId
                                    ? {
                                        questionId,
                                        op: question.visibleWhen?.op ?? "truthy",
                                        value: question.visibleWhen?.value,
                                      }
                                    : undefined,
                                });
                              }}
                            >
                              <option value="">Always shown</option>
                              {conditionControllerCandidates(questions, question.id).map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                  {candidate.label || "Untitled"}
                                </option>
                              ))}
                            </select>
                            {question.visibleWhen ? (
                              <>
                                <select
                                  value={question.visibleWhen.op}
                                  disabled={!payload.canManageSchemas}
                                  aria-label={`Condition for question ${index + 1}`}
                                  onChange={(event) =>
                                    updateQuestion(question.id, {
                                      visibleWhen: {
                                        ...question.visibleWhen!,
                                        op: event.target.value as FieldVisibilityOp,
                                      },
                                    })
                                  }
                                >
                                  {VISIBILITY_OP_OPTIONS.map((option) => (
                                    <option key={option.op} value={option.op}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                                {VISIBILITY_OP_OPTIONS.find((option) => option.op === question.visibleWhen!.op)
                                  ?.needsValue ? (
                                  <ConditionValueInput
                                    controller={questions.find(
                                      (candidate) => candidate.id === question.visibleWhen!.questionId,
                                    )}
                                    value={question.visibleWhen.value ?? ""}
                                    disabled={!payload.canManageSchemas}
                                    onChange={(value) =>
                                      updateQuestion(question.id, {
                                        visibleWhen: { ...question.visibleWhen!, value },
                                      })
                                    }
                                  />
                                ) : null}
                              </>
                            ) : null}
                          </div>
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
                                ? question.visibleWhen
                                  ? "Scouts must answer when it is shown"
                                  : "Scouts must answer before save"
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
                  ? "Live scouting keeps the published version until you publish these edits. Your draft autosaves here and resumes on any device."
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
                    onClick={() => loadSchemaIntoDraft(currentSchema, type, null)}
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
            <h2>Templates</h2>
            <p className="app-muted" style={{ margin: "0 0 10px", fontSize: 13 }}>
              Keep this draft to start next season from it. Built-in starters come from the game pack.
            </p>
            <div className="sfb-template-save">
              <input
                value={templateName}
                disabled={!canManage || busy}
                maxLength={80}
                placeholder={`e.g. ${year ?? ""} ${type} v1`.trim()}
                aria-label="Template name"
                onChange={(event) => setTemplateName(event.target.value)}
              />
              <button
                type="button"
                className="app-button secondary"
                disabled={!canManage || busy || !templateName.trim() || !questions.length}
                onClick={() => void saveAsTemplate()}
              >
                Save as template
              </button>
            </div>
            <button type="button" className="app-button secondary" disabled={!canManage} onClick={openStartFrom}>
              Start from…
            </button>
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
