"use client";

/**
 * Pieces shared by the Team lessons list, the lesson player and the editor: which team the
 * page is for, one JSON fetch helper, links, and how one step reads.
 */

import { useEffect, useState } from "react";
import { MarkdownDocument } from "../../team/knowledge/markdown-document";
import { FEATURE_API_TIMEOUT_MS, fetchActiveOrgId, persistOrgIdInUrl, readOrgIdFromSearch } from "../../../lib/nav/resolve-org";
import { withOrgHref } from "../../../lib/nav/product-nav";
import type { LessonStep } from "../../../lib/team-lessons/types";

export type OrgState = { status: "loading" } | { status: "ready"; orgId: string } | { status: "none" };

/** The team from the address, else the signed-in person's active team. */
export function useLessonOrg(): OrgState {
  const [state, setState] = useState<OrgState>({ status: "loading" });
  useEffect(() => {
    let cancelled = false;
    const fromUrl = readOrgIdFromSearch(window.location.search);
    if (fromUrl) {
      setState({ status: "ready", orgId: fromUrl });
      return;
    }
    void fetchActiveOrgId()
      .then((orgId) => {
        if (cancelled) return;
        if (orgId) {
          persistOrgIdInUrl(orgId);
          setState({ status: "ready", orgId });
        } else setState({ status: "none" });
      })
      .catch(() => {
        if (!cancelled) setState({ status: "none" });
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return state;
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
