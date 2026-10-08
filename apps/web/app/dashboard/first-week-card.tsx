"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RoleOnboardingView, StartCheckView, StartTrackView } from "../../lib/role-onboarding/types";
import { withOrgHref } from "../../lib/nav/product-nav";
import { isMemberRole, pickFirstWeek } from "../../lib/role-onboarding/first-week-order";
import { FEATURE_API_TIMEOUT_MS } from "../../lib/nav/resolve-org";

type NextCheck = { track: StartTrackView; check: StartCheckView };

const SHOWN = 3;

/**
 * The next few unfinished first-week steps, in the order onboarding promised.
 *
 * Onboarding ends on "You're in — Home shows what to do now" and lists five
 * steps built from the person's role and crew. Home then said "Nothing you
 * have to do right now", because nothing had been assigned yet — and the five
 * steps were never seen again. This card carries them until they are done or
 * dismissed, then disappears for good.
 */
export function nextFirstWeekChecks(view: RoleOnboardingView | null, limit = SHOWN): NextCheck[] {
  if (!view || view.status !== "live") return [];
  // The same order the onboarding done screen used (lib/role-onboarding/first-week-order.ts):
  // crew and focus first, one step from each list in turn.
  return pickFirstWeek(
    view.tracks.filter((track) => !track.dismissed),
    { limit, member: isMemberRole(view.teamRole), skip: (check) => check.done },
  );
}

/**
 * The member's onboarding steps, loaded once for Home. Home needs them in two
 * places — the "what to do now" hero shows the team's next setup step, and the
 * first-week card lists a student's steps — and has to know when they have
 * arrived, so neither says "nothing to do" first and changes its mind.
 */
export function useFirstWeek(orgId: string, userId: string, role: string | null) {
  const [view, setView] = useState<RoleOnboardingView | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const scope = `${userId}:${orgId}:${role ?? "pending"}`;
  const scopeRef = useRef("");
  const mutationRef = useRef<AbortController | null>(null);
  const retry = useCallback(() => setAttempt(value => value + 1), []);

  useEffect(() => {
    scopeRef.current = scope;
    mutationRef.current?.abort();
    mutationRef.current = null;
    setBusy(null);
    setError("");
    setView(null);
    if (!orgId || !userId || !role) return;
    let cancelled = false;
    const controller = new AbortController();
    void fetch(`/api/role-onboarding?orgId=${encodeURIComponent(orgId)}`, {
      cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
    })
      .then(async response => {
        if (!response.ok) throw new Error("Couldn’t load getting-started steps.");
        const next = await response.json() as RoleOnboardingView;
        if (!next || (next.status !== "setup_required" && (next.status !== "live" || next.orgId !== orgId || !Array.isArray(next.tracks)))) throw new Error("Couldn’t load getting-started steps.");
        return next;
      })
      .catch(() => { if (!cancelled) setError("Couldn’t load getting-started steps. Your other Home widgets are still available."); return null; })
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setLoadedFor(scope);
      });
    return () => {
      cancelled = true;
      controller.abort();
      mutationRef.current?.abort();
      scopeRef.current = "";
    };
  }, [orgId, userId, role, scope, attempt]);

  const post = useCallback(
    async (payload: Record<string, unknown>, key: string) => {
      if (!orgId || !userId || !role || scopeRef.current !== scope || mutationRef.current) return;
      const controller = new AbortController();
      mutationRef.current = controller;
      setBusy(key);
      setError("");
      try {
        const response = await fetch("/api/role-onboarding", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(FEATURE_API_TIMEOUT_MS)]),
        });
        if (!response.ok) throw new Error("Couldn’t save this step.");
        const next = await response.json() as RoleOnboardingView;
        if (!next || (next.status !== "setup_required" && (next.status !== "live" || next.orgId !== orgId || !Array.isArray(next.tracks)))) throw new Error("Couldn’t confirm this step.");
        if (scopeRef.current === scope && !controller.signal.aborted) { setView(next); setLoadedFor(scope); }
      } catch {
        if (scopeRef.current === scope && !controller.signal.aborted) setError("Couldn’t confirm this step. Refresh the steps to check whether it was saved.");
      } finally {
        if (mutationRef.current === controller) { mutationRef.current = null; setBusy(null); }
      }
    },
    [orgId, userId, role, scope],
  );

  return { view: loadedFor === scope ? view : null, loaded: !orgId || loadedFor === scope, busy, post, error: loadedFor === scope ? error : "", retry };
}

const SETUP_DONE_SHOWN_MS = 24 * 60 * 60 * 1000;

/**
 * True for a day after this device saw the team's last setup step get done. The setup card
 * used to just vanish after "3 of 4 done", with nothing saying setup was finished.
 */
function useJustSetUp(orgId: string, view: RoleOnboardingView | null): boolean {
  const setup = view?.status === "live" ? view.tracks.find((track) => track.key === "team_setup") : undefined;
  const state = !setup ? null : setup.doneCount >= setup.totalCount ? "done" : "open";
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!state || !orgId) return;
    const key = `vantage.team-setup:${orgId}`;
    let show = false;
    try {
      const seen = window.localStorage.getItem(key);
      if (state === "open") {
        window.localStorage.setItem(key, "open");
      } else if (!seen || seen === "open") {
        // The first time this device sees setup finished (it may have been finished elsewhere).
        window.localStorage.setItem(key, String(Date.now()));
        show = true;
      } else if (Date.now() - Number(seen) < SETUP_DONE_SHOWN_MS) {
        show = true;
      }
    } catch {
      // No storage: no note, nothing else changes.
    }
    const frame = window.requestAnimationFrame(() => setShown(show));
    return () => window.cancelAnimationFrame(frame);
  }, [orgId, state]);
  return shown;
}

export type SetupHero = {
  title: string;
  detail: string;
  href: string;
  cta: string;
  doneCount: number;
  totalCount: number;
  steps: { key: string; label: string; done: boolean; href: string }[];
};

/*
  The button each setup step puts on the hero. The step's own label is the
  heading ("Invite your team"); the button says what tapping it does.
*/
const SETUP_STEP_ACTION: Record<string, { cta: string; href?: string }> = {
  invite: { cta: "Invite people", href: "/team/admin?invite=1" },
  event: { cta: "Pick your event" },
  scouting: { cta: "Set up scouting form" },
  calendar: { cta: "Add practice" },
};

/**
 * The team's next setup step as Home's hero, with the whole list as progress.
 * It used to be two cards side by side saying the same thing: a hero reading
 * "Your next step is in the list just below" with no button, and the list,
 * whose next step was a small text link.
 */
export function setupHeroFrom(view: RoleOnboardingView | null): SetupHero | null {
  if (!view || view.status !== "live") return null;
  const setup = view.tracks.find((track) => track.key === "team_setup" && !track.dismissed);
  if (!setup || setup.doneCount >= setup.totalCount) return null;
  const next = setup.checks.find((check) => !check.done);
  if (!next) return null;
  const action = SETUP_STEP_ACTION[next.key];
  return {
    title: next.label,
    // The step's detail, without the bookkeeping sentence about when it ticks.
    detail: next.detail.replace(/\s*Ticks once[^.]*\.\s*$/i, "").trim(),
    href: action?.href ?? next.href ?? "/start",
    cta: action?.cta ?? next.label,
    doneCount: setup.doneCount,
    totalCount: setup.totalCount,
    steps: setup.checks.map((check) => ({
      key: check.key,
      label: check.label,
      done: check.done,
      href: SETUP_STEP_ACTION[check.key]?.href ?? check.href ?? "/start",
    })),
  };
}

/**
 * The setup steps as a small progress list inside the hero. Steps still to do are links: they
 * looked like a list you could tap, and "Pick your event" did nothing when tapped.
 */
export function SetupProgress({ hero, orgId }: { hero: SetupHero; orgId?: string | null }) {
  return (
    <div className="dash-setup-progress">
      <span>
        {hero.doneCount} of {hero.totalCount} done
      </span>
      <ol>
        {hero.steps.map((step) => (
          <li key={step.key} data-done={step.done ? "true" : "false"}>
            <i aria-hidden="true">{step.done ? "✓" : ""}</i>
            {step.done ? (
              <span>
                {step.label}
                <span className="dash-live-region"> (done)</span>
              </span>
            ) : (
              <a href={withOrgHref(step.href, orgId ?? null)}>{step.label}</a>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * A member's first-week steps. While the team itself is still being set up,
 * the hero carries those steps, so this card steps aside rather than repeat
 * them beside it.
 */
export function FirstWeekCard({
  orgId,
  view,
  busy,
  post,
}: {
  orgId: string;
  view: RoleOnboardingView | null;
  busy: string | null;
  post: (payload: Record<string, unknown>, key: string) => Promise<void>;
}) {
  const justSetUp = useJustSetUp(orgId, view);
  if (!view || view.status !== "live" || view.totalCount === 0) return null;
  if (setupHeroFrom(view)) return null;
  const left = view.totalCount - view.doneCount;
  const next = nextFirstWeekChecks(view);
  const setupNote = justSetUp ? (
    <p className="dash-setup-done" role="status">
      <b aria-hidden="true">✓</b>
      <span>
        <strong>Your team is set up.</strong> Your team setup steps are complete.
      </span>
    </p>
  ) : null;
  if (next.length === 0) return setupNote ? <section className="dash-first-week" aria-label="Team setup">{setupNote}</section> : null;
  // Right after setup, the celebration stands alone: a second list starting at "4 of 11" read
  // as the setup starting over. The rest is one quiet link until the next visit.
  if (setupNote) {
    return (
      <section className="dash-first-week is-celebrating" aria-label="Team setup">
        {setupNote}
        <a className="dash-first-week-all" href={withOrgHref("/start", orgId)}>
          {`Next: ${left} more ${left === 1 ? "step" : "steps"} for your first week →`}
        </a>
      </section>
    );
  }
  // The list shows the next few; the link says how many more there are.
  const more = left - next.length;

  return (
    <details className="dash-first-week" aria-label="Your first week">
      <summary><strong>Getting started</strong><span>{left} {left === 1 ? "step" : "steps"} remaining</span></summary>
      {setupNote}
      <header>
        <strong>Your first week</strong>
        <span>{`${view.doneCount} of ${view.totalCount} done · ${left} to go`}</span>
      </header>
      <ol>
        {next.map(({ track, check }) => {
          const key = `${track.key}:${check.key}`;
          return (
            <li key={key}>
              {/* A 44px tap area around the box, so a thumb can tick it. */}
              <label className="dash-first-week-tick">
                <input
                  type="checkbox"
                  aria-label={`Mark "${check.label}" done`}
                  checked={false}
                  disabled={Boolean(busy)}
                  onChange={() => void post({ action: "check", trackKey: track.key, checkKey: check.key }, key)}
                />
              </label>
              <div>
                {check.href ? (
                  <a href={withOrgHref(check.href, orgId)}>{check.label}</a>
                ) : (
                  <span>{check.label}</span>
                )}
                <small>{check.detail}</small>
              </div>
            </li>
          );
        })}
      </ol>
      <a className="dash-first-week-all" href={withOrgHref("/start", orgId)}>
        {more > 0 ? `See ${more} more ${more === 1 ? "step" : "steps"}` : "See every step"}
      </a>
    </details>
  );
}
