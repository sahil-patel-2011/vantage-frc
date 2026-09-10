"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { BusinessRelated } from "../../../components/business-related";
import { MeteredAiCutoffBanner } from "../../../components/metered-ai-cutoff-banner";
import { resolveCutoffErrorCode } from "../../../components/usage-cutoff-banner";
import { EmptyState } from "../../../components/ui";
import { classifyLoadFailure, loadFailureCopy } from "../../../lib/ui/load-failure";
import { GRANTS_WRITING_RELATED_INCLUDE } from "../../../lib/business/business-related";
import { grantsWritingNextActions } from "../../../lib/business/grants-writing-next-actions";
import {
  GRANT_DRAFT_STATUSES,
  type GrantDraftStatus,
  type GrantTemplate,
  type GrantTemplateKey,
  type GrantWritingDraft,
  type GrantWritingView,
  type GuidedFields,
} from "../../../lib/grant-writing";
import { AllocateSpend } from "./allocate-spend";
import "./grants.css";

const EMPTY_FIELDS: GuidedFields = { need: "", impact: "", budget: "", timeline: "" };

const FIELD_KEYS = ["need", "impact", "budget", "timeline"] as const;

const STATUS_LABEL: Record<GrantDraftStatus, string> = {
  draft: "Draft",
  ready: "Ready to submit",
  submitted: "Submitted",
  archived: "Archived",
};

type LiveView = Extract<GrantWritingView, { status: "live" }>;

function moneyLabel(amount: number | null | undefined): string {
  if (amount == null || !Number.isFinite(amount) || amount <= 0) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
  }).format(amount);
}

function orgQuery(orgId: string | null | undefined): string {
  return orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
}

function businessGrantsHref(orgId: string | null | undefined): string {
  const params = new URLSearchParams({ tab: "grants" });
  if (orgId) params.set("orgId", orgId);
  return `/business?${params.toString()}`;
}

export default function GrantsClient({ orgId: orgIdProp }: { orgId?: string }) {
  const [view, setView] = useState<GrantWritingView | null>(null);
  const [fetchFailed, setFetchFailed] = useState(false);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [cutoffCode, setCutoffCode] = useState<string | null>(null);
  const [season, setSeason] = useState<number | null>(null);
  const [templateKey, setTemplateKey] = useState<GrantTemplateKey>("community_foundation");
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [funderName, setFunderName] = useState("");
  const [askAmountUsd, setAskAmountUsd] = useState("");
  const [fields, setFields] = useState<GuidedFields>(EMPTY_FIELDS);
  const [body, setBody] = useState("");

  const resolvedOrgId =
    view && view.status === "live"
      ? view.orgId
      : view && view.orgId
        ? view.orgId
        : orgIdProp ?? null;

  const applyDraft = useCallback((draft: GrantWritingDraft) => {
    setSelectedDraftId(draft.id);
    setTemplateKey(draft.templateKey);
    setFunderName(draft.funderName ?? "");
    setAskAmountUsd(draft.askAmountUsd != null ? String(draft.askAmountUsd) : "");
    setFields(draft.fields);
    setBody(draft.body);
  }, []);

  const load = useCallback(
    (seasonOverride?: number) => {
      setFetchFailed(false);
      setError("");
      setErrorStatus(null);
      setCutoffCode(null);
      const params = new URLSearchParams(window.location.search);
      const urlOrg = orgIdProp ?? params.get("orgId");
      const seasonQuery = seasonOverride ?? (params.get("seasonYear") ? Number(params.get("seasonYear")) : null);
      const query = new URLSearchParams();
      if (urlOrg) query.set("orgId", urlOrg);
      if (seasonQuery) query.set("seasonYear", String(seasonQuery));
      void fetch(`/api/grants/writing${query.toString() ? `?${query.toString()}` : ""}`)
        .then(async (response) => {
          const data = (await response.json()) as GrantWritingView | { error?: string };
          if (!response.ok || !("status" in data)) {
            setError("error" in data && data.error ? data.error : "");
            setErrorStatus(response.status);
            setFetchFailed(true);
            return;
          }
          setView(data);
          setSeason(data.seasonYear);
        })
        .catch(() => setFetchFailed(true));
    },
    [orgIdProp],
  );

  useEffect(() => {
    load();
  }, [load]);

  const live = view?.status === "live" ? view : null;

  const selectedDraft = useMemo(() => {
    if (!live || !selectedDraftId) return null;
    return live.drafts.find((draft) => draft.id === selectedDraftId) ?? null;
  }, [live, selectedDraftId]);

  const activeTemplate = useMemo((): GrantTemplate | null => {
    if (!live) return null;
    return live.templates.find((template) => template.key === templateKey) ?? live.templates[0] ?? null;
  }, [live, templateKey]);

  const provenance = selectedDraft?.provenance ?? [];

  async function mutate(payload: Record<string, unknown>, okMessage?: string) {
    if (!live || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    if (payload.action === "ai_assist") setCutoffCode(null);
    try {
      const response = await fetch("/api/grants/writing", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          orgId: live.orgId,
          seasonYear: season ?? live.seasonYear,
          ...payload,
        }),
      });
      const data = (await response.json()) as GrantWritingView | { error?: string; code?: string; reason?: string };
      if (!response.ok || !("status" in data)) {
        const cutoff = resolveCutoffErrorCode(response.status, {
          code: "code" in data ? data.code : undefined,
          reason: "reason" in data ? data.reason : undefined,
          error: "error" in data ? data.error : undefined,
        });
        if (cutoff) {
          setCutoffCode(cutoff);
          setError("");
        } else {
          setError("error" in data && data.error ? data.error : "Something went wrong.");
        }
        return;
      }
      setView(data);
      setSeason(data.seasonYear);
      if (data.status === "live") {
        if (payload.action === "compose" && data.drafts[0]) {
          applyDraft(data.drafts[0]);
        } else if (payload.action === "ai_assist" && data.drafts[0]) {
          applyDraft(data.drafts[0]);
        } else if (payload.action === "delete") {
          const next = data.drafts[0] ?? null;
          if (next) applyDraft(next);
          else {
            setSelectedDraftId(null);
            setFields(EMPTY_FIELDS);
            setBody("");
            setFunderName("");
            setAskAmountUsd("");
          }
        } else if (typeof payload.draftId === "string") {
          const draft = data.drafts.find((item) => item.id === payload.draftId) ?? data.drafts[0] ?? null;
          if (draft) applyDraft(draft);
        }
      }
      if (okMessage) setNotice(okMessage);
    } catch {
      setError("Network error — please try again.");
    } finally {
      setBusy(false);
    }
  }

  function selectTemplate(template: GrantTemplate) {
    setTemplateKey(template.key);
    setNotice("");
  }

  function selectDraft(draft: GrantWritingDraft) {
    applyDraft(draft);
    setNotice("");
  }

  const readyCount = live?.drafts.filter((draft) => draft.status === "ready").length ?? 0;

  if (fetchFailed) {
    const kind = classifyLoadFailure({
      status: errorStatus,
      message: error,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
    });
    const copy = loadFailureCopy(kind, {
      nextPath:
        typeof window === "undefined"
          ? null
          : `${window.location.pathname}${window.location.search}`,
      message:
        error ||
        "A network or server issue prevented loading. Award totals stay blank until real applications are recorded.",
    });
    return (
      <main className="module-page gwe-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Grants</span>
            <h1>Grant writing</h1>
            <p className="app-muted">{copy.description}</p>
          </div>
        </header>
        <EmptyState
          soft
          badge={
            kind === "auth"
              ? "Signed out"
              : kind === "forbidden"
                ? "No access"
                : kind === "offline"
                  ? "Offline"
                  : "Retry"
          }
          title={copy.title}
          description={copy.description}
        >
          {copy.primary ? (
            <a className="app-button" href={copy.primary.href}>
              {copy.primary.label}
            </a>
          ) : null}
          {copy.showRetry ? (
            <button type="button" className="app-button secondary" onClick={() => load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="module-page gwe-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Grants</span>
            <h1>Grant writing</h1>
          </div>
        </header>
        <EmptyState soft title="Loading grant writing…" description="Opening this team’s narrative drafts." aria-busy />
      </main>
    );
  }

  if (view.status === "setup_required") {
    const setupOrg = view.orgId ?? orgIdProp ?? null;
    const nextActions = grantsWritingNextActions({ orgId: setupOrg, draftCount: 0 });
    return (
      <main className="module-page gwe-page">
        <header className="app-page-header">
          <div>
            <span className="breadcrumbs">Business / Grants</span>
            <h1>Grant writing</h1>
            <p className="app-muted">
              Guided need · impact · budget · timeline narratives from THIS organization&apos;s profile and impact log
              only.
            </p>
          </div>
        </header>
        {setupOrg ? (
          <BusinessRelated
            orgId={setupOrg}
            include={GRANTS_WRITING_RELATED_INCLUDE}
            ariaLabel="Related fundraising tools"
          />
        ) : null}
        <EmptyState soft badge="Setup required" badgeTone="setup" title={view.message}>
          <ol className="strategy-setup-steps">
            {view.steps.map((step) => (
              <li key={step.id}>
                <div>
                  <strong>{step.label}</strong>
                  <span>{step.detail}</span>
                </div>
                <a href={step.href}>Open</a>
              </li>
            ))}
          </ol>
          {nextActions.length ? (
            <ol className="gwe-next-actions">
              {nextActions.map((action) => (
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
          ) : null}
        </EmptyState>
      </main>
    );
  }

  return (
    <GrantWritingWorkspace
      view={view}
      season={season}
      busy={busy}
      error={error}
      notice={notice}
      cutoffCode={cutoffCode}
      templateKey={templateKey}
      activeTemplate={activeTemplate}
      selectedDraft={selectedDraft}
      selectedDraftId={selectedDraftId}
      funderName={funderName}
      askAmountUsd={askAmountUsd}
      fields={fields}
      body={body}
      provenance={provenance}
      readyCount={readyCount}
      resolvedOrgId={resolvedOrgId}
      onSeasonChange={(next) => {
        setSeason(next);
        setSelectedDraftId(null);
        setFields(EMPTY_FIELDS);
        setBody("");
        setCutoffCode(null);
        load(next);
      }}
      onSelectTemplate={selectTemplate}
      onSelectDraft={selectDraft}
      onFunderNameChange={setFunderName}
      onAskAmountChange={setAskAmountUsd}
      onFieldsChange={setFields}
      onMutate={mutate}
    />
  );
}

function GrantWritingWorkspace({
  view,
  season,
  busy,
  error,
  notice,
  cutoffCode,
  templateKey,
  activeTemplate,
  selectedDraft,
  selectedDraftId,
  funderName,
  askAmountUsd,
  fields,
  body,
  provenance,
  readyCount,
  resolvedOrgId,
  onSeasonChange,
  onSelectTemplate,
  onSelectDraft,
  onFunderNameChange,
  onAskAmountChange,
  onFieldsChange,
  onMutate,
}: {
  view: LiveView;
  season: number | null;
  busy: boolean;
  error: string;
  notice: string;
  cutoffCode: string | null;
  templateKey: GrantTemplateKey;
  activeTemplate: GrantTemplate | null;
  selectedDraft: GrantWritingDraft | null;
  selectedDraftId: string | null;
  funderName: string;
  askAmountUsd: string;
  fields: GuidedFields;
  body: string;
  provenance: GrantWritingDraft["provenance"];
  readyCount: number;
  resolvedOrgId: string | null;
  onSeasonChange: (season: number) => void;
  onSelectTemplate: (template: GrantTemplate) => void;
  onSelectDraft: (draft: GrantWritingDraft) => void;
  onFunderNameChange: (value: string) => void;
  onAskAmountChange: (value: string) => void;
  onFieldsChange: (fields: GuidedFields) => void;
  onMutate: (payload: Record<string, unknown>, okMessage?: string) => Promise<void>;
}) {
  const teamLabel =
    view.teamNumber != null ? `FRC ${view.teamNumber}` : view.orgName ?? "This workspace";

  const nextActions = grantsWritingNextActions({
    orgId: view.orgId,
    draftCount: view.drafts.length,
    readyCount,
    impactActivities: view.impactSummary.activities,
    communityHours: view.communityHours,
  });

  return (
    <main className="module-page gwe-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">Business / Grants</span>
          <h1>Grant writing</h1>
          <p className="app-muted">
            Compose org-isolated grant narratives from guided fields — onboarding location, team description, and
            Community Impact evidence for {teamLabel}. Asks and awards stay blank until you enter amounts.
          </p>
        </div>
        <div className="gwe-toolbar">
          <label className="app-muted" style={{ display: "flex", gap: 6, alignItems: "center" }}>
            Season
            <select
              value={season ?? view.seasonYear}
              onChange={(event) => onSeasonChange(Number(event.target.value))}
            >
              {(view.seasons.length ? view.seasons : [view.seasonYear]).map((year) => (
                <option key={year} value={year}>
                  {year}
                </option>
              ))}
            </select>
          </label>
          <nav className="intel-actions" aria-label="Grant writing links">
            <a href={businessGrantsHref(resolvedOrgId)}>Business · Grants</a>
            <a href={`/impact${orgQuery(resolvedOrgId)}`}>Impact</a>
            <a href={`/writer${orgQuery(resolvedOrgId)}`}>Writer</a>
          </nav>
        </div>
      </header>

      <BusinessRelated
        orgId={view.orgId}
        include={GRANTS_WRITING_RELATED_INCLUDE}
        ariaLabel="Related fundraising tools"
      />

      <AllocateSpend orgId={view.orgId} seasonYear={season ?? view.seasonYear} />

      {error ? (
        <p className="telemetry-status" role="alert">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="telemetry-status" role="status">
          {notice}
        </p>
      ) : null}

      {nextActions.length ? (
        <section className="app-card soft-panel gwe-next-actions-panel" aria-label="Next actions">
          <header>
            <span className="eyebrow">Next actions</span>
            <h2>Keep writing grounded in this team&apos;s evidence</h2>
            <p className="app-muted">Only impact, awards, and asks you recorded — metered AI hard-stops at plan cutoffs.</p>
          </header>
          <ol className="gwe-next-actions">
            {nextActions.map((action) => (
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
      ) : null}

      <section className="gwe-kpis" aria-label="Grant writing summary">
        <article className="gwe-kpi">
          <span>Saved drafts</span>
          <strong>{view.drafts.length}</strong>
        </article>
        <article className="gwe-kpi">
          <span>Ready to submit</span>
          <strong>{readyCount}</strong>
        </article>
        <article className="gwe-kpi">
          <span>Impact activities</span>
          <strong>{view.impactSummary.activities}</strong>
        </article>
        <article className="gwe-kpi">
          <span>Community hours</span>
          <strong>{view.communityHours}</strong>
        </article>
        <article className="gwe-kpi">
          <span>Season goals</span>
          <strong>{view.seasonGoals.length}</strong>
        </article>
        <article className="gwe-kpi">
          <span>Awards on file</span>
          <strong>{view.awardCount}</strong>
        </article>
        <article className="gwe-kpi">
          <span>Location</span>
          <strong>{view.location ?? "—"}</strong>
        </article>
      </section>

      <div className="gwe-layout">
        <aside className="gwe-templates app-card soft-panel">
          <span className="eyebrow">Templates</span>
          <p className="app-muted">Pick a funder style — prompts update in the editor.</p>
          <ul className="gwe-template-list">
            {view.templates.map((template) => (
              <li key={template.key}>
                <button
                  type="button"
                  className={template.key === templateKey ? "gwe-template active" : "gwe-template"}
                  onClick={() => onSelectTemplate(template)}
                >
                  <strong>{template.label}</strong>
                  <span>{template.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        </aside>

        <section className="gwe-editor app-card soft-panel">
          <span className="eyebrow">Guided fields</span>
          <h2>{activeTemplate?.label ?? "Narrative"}</h2>
          {activeTemplate ? <p className="app-muted">{activeTemplate.summary}</p> : null}

          <MeteredAiCutoffBanner
            orgId={view.orgId}
            errorCode={cutoffCode}
            compact
            className="gwe-cutoff"
          />

          <div className="gwe-meta">
            <label className="gwe-field">
              <span>Funder</span>
              <input
                value={funderName}
                onChange={(event) => onFunderNameChange(event.target.value)}
                placeholder="Community Foundation"
              />
            </label>
            <label className="gwe-field">
              <span>Ask amount ($)</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={askAmountUsd}
                onChange={(event) => onAskAmountChange(event.target.value)}
                placeholder="Enter your ask"
              />
              <small>Optional — leave blank rather than inventing an award total.</small>
            </label>
          </div>

          {FIELD_KEYS.map((key) => (
            <label key={key} className="gwe-field">
              <span>{activeTemplate?.headings[key] ?? key}</span>
              <textarea
                rows={4}
                value={fields[key]}
                placeholder={activeTemplate?.prompts[key]}
                onChange={(event) => onFieldsChange({ ...fields, [key]: event.target.value })}
              />
            </label>
          ))}

          <div className="gwe-actions">
            <button
              type="button"
              className="app-button"
              disabled={busy}
              onClick={() =>
                void onMutate(
                  {
                    action: "compose",
                    templateKey,
                    funderName: funderName || undefined,
                    askAmountUsd: askAmountUsd || undefined,
                    need: fields.need,
                    impact: fields.impact,
                    budget: fields.budget,
                    timeline: fields.timeline,
                  },
                  "Narrative composed and saved.",
                )
              }
            >
              {busy ? "Composing…" : "Compose & save"}
            </button>
            <button
              type="button"
              className="app-button secondary"
              disabled={busy}
              onClick={() =>
                void onMutate(
                  {
                    action: "ai_assist",
                    templateKey,
                    funderName: funderName || undefined,
                    askAmountUsd: askAmountUsd || undefined,
                    need: fields.need,
                    impact: fields.impact,
                    budget: fields.budget,
                    timeline: fields.timeline,
                  },
                  "Metered AI assist draft saved (this org only).",
                )
              }
            >
              {busy ? "Assisting…" : "AI assist (metered)"}
            </button>
            {selectedDraft ? (
              <>
                <select
                  aria-label="Draft status"
                  value={selectedDraft.status}
                  disabled={busy}
                  onChange={(event) =>
                    void onMutate(
                      {
                        action: "set_status",
                        draftId: selectedDraft.id,
                        status: event.target.value,
                      },
                      "Status updated.",
                    )
                  }
                >
                  {GRANT_DRAFT_STATUSES.map((status) => (
                    <option key={status} value={status}>
                      {STATUS_LABEL[status]}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="app-button secondary"
                  disabled={busy}
                  onClick={() =>
                    void onMutate({ action: "delete", draftId: selectedDraft.id }, "Draft deleted.")
                  }
                >
                  Delete draft
                </button>
              </>
            ) : null}
          </div>

          <div className="gwe-preview">
            <span className="eyebrow">Composed narrative</span>
            {body ? (
              <textarea rows={14} value={body} readOnly aria-label="Composed grant narrative" />
            ) : (
              <p className="app-muted">
                Compose from at least one guided field to generate a draft. Evidence from Impact and onboarding profile
                is woven in automatically — award $ never appears unless you enter an ask.
              </p>
            )}
          </div>

          {provenance.length ? (
            <div className="gwe-prov">
              <span className="eyebrow">Provenance</span>
              <ul>
                {provenance.map((item, index) => (
                  <li key={`${item.label}-${index}`}>
                    <strong>{item.label}</strong>
                    <span>{item.value}</span>
                    <small>{item.source}</small>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </section>

        <aside className="gwe-drafts app-card soft-panel">
          <span className="eyebrow">Draft library</span>
          <p className="app-muted">
            {view.drafts.length
              ? `${view.drafts.length} saved for ${season ?? view.seasonYear}`
              : `No drafts for ${season ?? view.seasonYear} yet.`}
          </p>
          <div className="gwe-draft-list">
            {view.drafts.length === 0 ? (
              <EmptyState
                soft
                className="gwe-empty"
                title="No drafts yet"
                description="Compose from the editor or open Writer for a metered grant answer. Amounts stay empty until you type them."
              >
                <div className="gwe-links">
                  <a className="app-button secondary" href={businessGrantsHref(view.orgId)}>
                    Business · Grants
                  </a>
                  <a className="app-button secondary" href={`/writer${orgQuery(view.orgId)}`}>
                    Writer
                  </a>
                  <a className="app-button secondary" href={`/fundraisers${orgQuery(view.orgId)}`}>
                    Fundraisers
                  </a>
                </div>
              </EmptyState>
            ) : (
              view.drafts.map((draft) => (
                <button
                  key={draft.id}
                  type="button"
                  className={draft.id === selectedDraftId ? "gwe-draft-item active" : "gwe-draft-item"}
                  onClick={() => onSelectDraft(draft)}
                >
                  <strong>{draft.title}</strong>
                  <span className={`gwe-status gwe-status-${draft.status}`}>{STATUS_LABEL[draft.status]}</span>
                  <span>
                    {moneyLabel(draft.askAmountUsd)}
                    {draft.funderName ? ` · ${draft.funderName}` : ""}
                  </span>
                  <span>
                    {draft.source === "ai" ? "AI assist" : "Template"} · Updated{" "}
                    {new Date(draft.updatedAt).toLocaleDateString()}
                  </span>
                </button>
              ))
            )}
          </div>
        </aside>
      </div>
    </main>
  );
}
