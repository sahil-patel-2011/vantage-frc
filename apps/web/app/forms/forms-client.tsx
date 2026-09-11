"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { OfflineBanner } from "../../components/offline-banner";
import { Badge, EmptyState, PageHeader, Panel, type BadgeTone, Button } from "../../components/ui";
import { PURPOSE_LABELS, type FormPurpose, type FormSummary } from "../../lib/forms/types";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";
import { getFeatureSnapshot, putFeatureSnapshot } from "../../lib/offline/feature-cache";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

/**
 * Carry the team into the link.
 *
 * The detail route re-resolves the team on its own, and with no hint it
 * takes the caller's alphabetically first membership. For anyone who belongs to
 * two teams — a mentor with a sister team, a student who moved — that meant
 * every form in the second team answered "Form not found", from a list that had
 * just shown it to them.
 */
function formHref(formId: string, orgId: string | undefined) {
  return orgId ? `/forms/${formId}?orgId=${encodeURIComponent(orgId)}` : `/forms/${formId}`;
}

type View = {
  status: "ready";
  orgId: string;
  orgName: string;
  canManage: boolean;
  forms: FormSummary[];
};

function isFormsView(value: unknown): value is View {
  if (!value || typeof value !== "object") return false;
  const rec = value as { status?: unknown; forms?: unknown; orgId?: unknown };
  return rec.status === "ready" && typeof rec.orgId === "string" && Array.isArray(rec.forms);
}

function formsCacheOrg(data: View, orgHint: string): string {
  return data.orgId.trim() || orgHint;
}

async function persistFormsSnapshot(orgHint: string, data: View): Promise<void> {
  const cacheOrg = formsCacheOrg(data, orgHint);
  if (!cacheOrg) return;
  try {
    await putFeatureSnapshot("forms", cacheOrg, data);
    if (!orgHint) await putFeatureSnapshot("forms", "_", data);
  } catch {
    // Live Forms already painted; IndexedDB is best-effort.
  }
}

/**
 * The purposes offered when starting a form.
 *
 * Ordered by how often an FRC team actually needs one across a season rather
 * than alphabetically, so the common case is the first thing in reach.
 */
const START_OPTIONS: Array<{ purpose: FormPurpose; blurb: string }> = [
  { purpose: "intake", blurb: "Collect new students, their guardians, and which subteams they want." },
  { purpose: "tryout", blurb: "Score driver and operator candidates on the same questions." },
  { purpose: "mentor", blurb: "Sign up mentors and track youth-protection status." },
  { purpose: "dues", blurb: "Track who has paid and who needs a quiet conversation." },
  { purpose: "travel", blurb: "Headcount, emergency contacts, dietary and medical needs." },
  { purpose: "safety", blurb: "Shop training and safety-glasses check before anyone builds." },
  { purpose: "feedback", blurb: "Weekly retro from the whole team in two minutes." },
  { purpose: "general", blurb: "Start from a blank form." },
];

/**
 * The workspace the shell sent us to.
 *
 * Every product link the shell renders goes through `withOrgHref`, so a member
 * of two teams arrives here as `/forms?orgId=…`. This client used to call
 * `/api/forms` bare, and the API falls back to the caller's first membership
 * ordered by org name — so switching workspaces and opening Forms showed the
 * other team's forms, with no way to tell.
 */
function orgParam(): string {
  if (typeof window === "undefined") return "";
  const orgId = new URLSearchParams(window.location.search).get("orgId");
  return orgId ? `orgId=${encodeURIComponent(orgId)}` : "";
}

function statusTone(status: FormSummary["status"]): BadgeTone {
  if (status === "open") return "good";
  if (status === "closed") return "neutral";
  return "setup";
}

export default function FormsClient() {
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string>("");
  const [fetchFailed, setFetchFailed] = useState(false);
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState("");
  const [fromCache, setFromCache] = useState(false);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const viewRef = useRef<View | null>(null);
  viewRef.current = view;

  const load = useCallback(async () => {
    const orgHint =
      typeof window === "undefined"
        ? ""
        : (new URLSearchParams(window.location.search).get("orgId")?.trim() ?? "");
    let hadCache = Boolean(viewRef.current);
    try {
      const cached = await getFeatureSnapshot<View>("forms", orgHint || "_");
      if (!viewRef.current && cached?.data && isFormsView(cached.data)) {
        setView(cached.data);
        setFromCache(true);
        setCachedAt(cached.cachedAt);
        hadCache = true;
      }
    } catch {
      // IndexedDB missing or blocked; live fetch still runs.
    }
    setFetchFailed(false);
    setErrorStatus(null);
    try {
      const query = orgParam();
      const response = await fetch(`/api/forms${query ? `?${query}` : ""}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data: unknown = await response.json().catch(() => null);
      if (response.status === 401 || response.status === 403) {
        setView(null);
        setFromCache(false);
        setCachedAt(null);
        setFetchFailed(true);
        setErrorStatus(response.status);
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load forms.",
        );
        return;
      }
      if (!response.ok || !isFormsView(data)) {
        if (hadCache || viewRef.current) {
          setFromCache(true);
          setError("Could not refresh Forms. Showing the last copy on this device.");
          setFetchFailed(false);
          return;
        }
        setError(
          data && typeof data === "object" && "error" in data && typeof data.error === "string"
            ? data.error
            : "Could not load forms.",
        );
        setErrorStatus(response.status);
        setFetchFailed(true);
        return;
      }
      setView(data);
      setFromCache(false);
      setCachedAt(null);
      setError("");
      await persistFormsSnapshot(orgHint, data);
    } catch {
      if (hadCache || viewRef.current) {
        setFromCache(true);
        setError("Could not refresh Forms. Showing the last copy on this device.");
        setFetchFailed(false);
        return;
      }
      setError("Could not reach the server.");
      setFetchFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function create(purpose: FormPurpose) {
    const trimmed = title.trim();
    if (!trimmed) return;
    setBusy(true);
    const query = orgParam();
    try {
      const response = await fetch(`/api/forms${query ? `?${query}` : ""}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "create_form",
          title: trimmed,
          purpose,
          // A blank form starts blank; every other purpose starts from the
          // questions a team would have written anyway.
          useStarter: purpose !== "general",
        }),
        signal: AbortSignal.timeout(FEATURE_API_TIMEOUT_MS),
      });
      const data = (await response.json()) as { formId?: string; error?: string };
      if (!response.ok || !data.formId) {
        setError(data.error ?? "Could not create the form.");
        return;
      }
      window.location.href = formHref(data.formId, view?.orgId);
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    const copy = fetchFailed
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message: error,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message: error || "Could not load forms.",
          },
        )
      : null;
    return (
      <main className="module-page forms-page">
        <PageHeader
          breadcrumbs="Team / Forms"
          title="Forms"
          description="Ask your team something, and read what the answers mean."
        />
        <OfflineBanner feature="Forms" fromCache={fromCache} cachedAt={cachedAt} />
        <EmptyState
          soft
          badge={copy ? "Not available" : undefined}
          badgeTone={copy ? "setup" : undefined}
          title={copy ? copy.title : "Loading forms…"}
          description={copy ? copy.description : "Checking your team."}
          aria-busy={!fetchFailed}
        >
          {copy?.primary ? (
            <Button as="a" variant="primary" href={copy.primary.href}>
              {copy.primary.label}
            </Button>
          ) : copy?.showRetry ? (
            <Button variant="primary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page forms-page">
      <PageHeader
        breadcrumbs="Team / Forms"
        title="Forms"
        description={`Ask ${view.orgName} something — intake, tryouts, dues, travel, safety, feedback — and read what the answers mean.`}
      />
      <OfflineBanner feature="Forms" fromCache={fromCache} cachedAt={cachedAt} />

      {error ? (
        <p className="forms-error" role="status">
          {error}
        </p>
      ) : null}

      {view.forms.length === 0 ? (
        <EmptyState
          soft
          badge="No forms yet"
          badgeTone="setup"
          title="Start with what your season needs next"
          description="Pick a purpose and Vantage writes the questions a team would normally write by hand. You can change every one of them."
        />
      ) : (
        <Panel className="forms-list-panel">
          <h2>Your forms</h2>
          <ul className="forms-list">
            {view.forms.map((form) => (
              <li key={form.id}>
                <a className="forms-list-row" href={formHref(form.id, view.orgId)}>
                  <span className="forms-list-main">
                    <strong>{form.title}</strong>
                    <small className="app-muted">
                      {PURPOSE_LABELS[form.purpose]} · {form.questionCount}{" "}
                      {form.questionCount === 1 ? "question" : "questions"}
                    </small>
                  </span>
                  <span className="forms-list-meta">
                    <Badge tone={statusTone(form.status)}>{form.status}</Badge>
                    <small>
                      {form.responseCount} {form.responseCount === 1 ? "response" : "responses"}
                      {form.assignedCount > 0 ? ` of ${form.assignedCount} assigned` : ""}
                    </small>
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      {view.canManage ? (
        <Panel className="forms-start-panel">
          <h2>Start a form</h2>
          <label className="forms-title-field">
            <span>What are you asking?</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="2027 New Member Intake"
              maxLength={160}
              autoComplete="off"
            />
          </label>
          <div className="forms-purpose-grid">
            {START_OPTIONS.map((option) => (
              <button
                key={option.purpose}
                type="button"
                className="forms-purpose"
                disabled={busy || !title.trim()}
                onClick={() => void create(option.purpose)}
              >
                <strong>{PURPOSE_LABELS[option.purpose]}</strong>
                <small>{option.blurb}</small>
              </button>
            ))}
          </div>
          {!title.trim() ? (
            <p className="app-muted forms-hint">Give the form a name first, then pick what it is for.</p>
          ) : null}
          {error ? <p role="alert" className="forms-error">{error}</p> : null}
        </Panel>
      ) : null}
    </main>
  );
}
