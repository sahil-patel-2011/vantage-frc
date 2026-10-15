"use client";

/**
 * Pieces shared by the Team lessons list, the lesson player and the editor: which team the
 * page is for, one JSON fetch helper, links, and how one step reads.
 */

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button, EmptyState, ErrorState } from "../../../components/ui";
import { MarkdownDocument } from "../../team/knowledge/markdown-document";
import { forgetMe, requestMe } from "../../../lib/nav/me-request";
import { FEATURE_API_TIMEOUT_MS, persistOrgIdInUrl, readOrgIdFromSearch } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import type { LessonStep } from "../../../lib/team-lessons/types";

export type OrgState =
  | { status: "loading" }
  | { status: "ready"; orgId: string }
  /** Signed in, but no team is active: the team chooser. */
  | { status: "none" }
  /** `/api/me` answered 401. */
  | { status: "signed-out" }
  /** No answer, or a 5xx: Vantage couldn't be reached. Not the same as having no team. */
  | { status: "error"; message: string; retry: () => void };

const ORG_UNREACHABLE = "Couldn't reach Vantage to find your team. Check your connection and try again.";

/** The team from the address, else the signed-in person's active team. */
export function useLessonOrg(): OrgState {
  const [state, setState] = useState<OrgState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => {
    // An explicit Retry skips the shared answer's backoff; the person asked to try now.
    forgetMe();
    setState({ status: "loading" });
    setAttempt((value) => value + 1);
  }, []);
  useEffect(() => {
    let cancelled = false;
    const fromUrl = readOrgIdFromSearch(window.location.search);
    if (fromUrl) {
      setState({ status: "ready", orgId: fromUrl });
      return;
    }
    void requestMe().then(({ ok, status, data }) => {
      if (cancelled) return;
      if (status === 401) return setState({ status: "signed-out" });
      if (status === 0 || status >= 500) return setState({ status: "error", message: ORG_UNREACHABLE, retry });
      const raw = ok ? (data as { orgId?: unknown } | null)?.orgId : null;
      const orgId = typeof raw === "string" ? raw.trim() : "";
      if (orgId) {
        persistOrgIdInUrl(orgId);
        setState({ status: "ready", orgId });
      } else setState({ status: "none" });
    });
    return () => {
      cancelled = true;
    };
  }, [attempt, retry]);
  return state;
}

/**
 * What a Team resources screen shows when it has no team to load for: no team chosen, signed
 * out, or Vantage unreachable. Null while loading or ready.
 */
export function LessonOrgProblem({ org, chooseText }: { org: OrgState; chooseText: string }): ReactNode {
  if (org.status === "none") {
    return (
      <EmptyState soft title="Choose your team" description={chooseText}>
        <Button as="a" variant="primary" href="/workspace">
          Choose your team
        </Button>
      </EmptyState>
    );
  }
  if (org.status === "signed-out") return <ErrorState status={401} />;
  if (org.status === "error") return <ErrorState title="Couldn't find your team" message={org.message} onRetry={org.retry} retryLabel="Try again" />;
  return null;
}

export type LessonLoadFailure = { status: number; message: string };

/**
 * A failed load. A missing lesson (404) or one this person may not open (403) offers the way
 * back, since trying again can't change the answer; everything else is an error with Try again
 * (an expired session gets Sign in again from ErrorState).
 */
export function LessonLoadError({
  error,
  title,
  onRetry,
  back,
}: {
  error: LessonLoadFailure;
  title: string;
  onRetry: () => void;
  back: { href: string; label: string };
}) {
  if (error.status === 404 || error.status === 403) {
    return (
      <EmptyState title={error.status === 404 ? "Lesson not found" : "You can't open this"} description={error.message}>
        <Button as="a" variant="secondary" href={back.href}>
          {back.label}
        </Button>
      </EmptyState>
    );
  }
  return <ErrorState title={title} message={error.message} status={error.status} onRetry={onRetry} retryLabel="Try again" />;
}

/** Skeleton placeholders in the page frame while a Team resources screen loads. */
export function LessonLoading({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="team-lesson-loading" aria-busy="true" aria-label={label}>
      <span className="sr-only" role="status">
        {label}
      </span>
      {children}
    </section>
  );
}

export type JsonResult<T> = { ok: boolean; status: number; data: T | null; error: string | null };

/** fetch + JSON with a timeout; never throws. `status` 0 means no answer arrived. */
export async function lessonFetch<T>(input: string, init?: RequestInit & { timeoutMs?: number }): Promise<JsonResult<T>> {
  try {
    const response = await fetch(input, {
      cache: "no-store",
      ...init,
      headers: init?.body ? { "content-type": "application/json", ...(init.headers ?? {}) } : init?.headers,
      signal: init?.signal ?? AbortSignal.timeout(init?.timeoutMs ?? FEATURE_API_TIMEOUT_MS),
    });
    const data = (await response.json().catch(() => null)) as (T & { error?: unknown }) | null;
    const error = !response.ok && data && typeof data.error === "string" ? data.error : null;
    return { ok: response.ok, status: response.status, data, error };
  } catch {
    return { ok: false, status: 0, data: null, error: null };
  }
}

export const lessonsHref = (orgId: string | null) => withOrgHref("/learn/team", orgId);
export const lessonHref = (id: string, orgId: string | null) => withOrgHref(`/learn/team/${id}`, orgId);
export const lessonEditHref = (id: string, orgId: string | null) => withOrgHref(`/learn/team/${id}/edit`, orgId);

/** "5 minutes ago", "3 days ago", or the date. */
export function whenText(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const at = Date.parse(iso);
  if (!Number.isFinite(at)) return "";
  const minutes = Math.round((now - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** One step as a student reads it: the text, then "When to use it" and "Example" when written. */
export function StepView({ step, number, total }: { step: LessonStep; number: number; total: number }) {
  return (
    <article className="team-lesson-step" aria-labelledby={`step-title-${step.id}`}>
      <p className="team-lesson-step-count">
        Step {number} of {total}
      </p>
      <h2 id={`step-title-${step.id}`}>{step.title.trim() || `Step ${number}`}</h2>
      <div className="team-lesson-md">
        <MarkdownDocument source={step.text} />
      </div>
      {step.whenToUse?.trim() ? (
        <aside className="team-lesson-box is-when" aria-label="When to use it">
          <h3>When to use it</h3>
          <div className="team-lesson-md">
            <MarkdownDocument source={step.whenToUse} />
          </div>
        </aside>
      ) : null}
      {step.example?.trim() ? (
        <aside className="team-lesson-box is-example" aria-label="Example">
          <h3>Example</h3>
          <div className="team-lesson-md">
            <MarkdownDocument source={step.example} />
          </div>
        </aside>
      ) : null}
    </article>
  );
}
