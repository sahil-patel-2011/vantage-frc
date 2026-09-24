"use client";

import { useCallback, useEffect, useState } from "react";
import type { RoleOnboardingView, StartCheckView, StartTrackView } from "../../lib/role-onboarding/types";
import { withOrgHref } from "../../lib/nav/product-nav";

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
const SOURCE_ORDER: Record<string, number> = { subteam: 0, focus: 1, role: 2, manual: 3, welcome: 4 };

/** The team's own setup (owners and admins) comes before anyone's personal path. */
function sourceRank(track: StartTrackView): number {
  return track.key === "team_setup" ? -1 : (SOURCE_ORDER[track.source] ?? 5);
}

export function nextFirstWeekChecks(view: RoleOnboardingView | null, limit = SHOWN): NextCheck[] {
  if (!view || view.status !== "live") return [];
  // The person's own crew and focus first — a programming student's first
  // step is their track, not the generic welcome — then one step from each
  // list in turn, the way onboarding's "first five minutes" reads.
  const queues = view.tracks
    .filter((track) => !track.dismissed)
    .sort((a, b) => sourceRank(a) - sourceRank(b))
    .map((track) => ({ track, checks: track.checks.filter((check) => !check.done) }));
  const out: NextCheck[] = [];
  while (out.length < limit && queues.some((queue) => queue.checks.length > 0)) {
    for (const queue of queues) {
      const check = queue.checks.shift();
      if (!check) continue;
      out.push({ track: queue.track, check });
      if (out.length >= limit) break;
    }
  }
  return out;
}

/**
 * The member's onboarding steps, loaded once for Home. Home needs them in two
 * places — the "what to do now" hero shows the team's next setup step, and the
 * first-week card lists a student's steps — and has to know when they have
 * arrived, so neither says "nothing to do" first and changes its mind.
 */
export function useFirstWeek(orgId: string) {
  const [view, setView] = useState<RoleOnboardingView | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/role-onboarding?orgId=${encodeURIComponent(orgId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<RoleOnboardingView>) : null))
      .catch(() => null)
      .then((next) => {
        if (cancelled) return;
        setView(next);
        setLoadedFor(orgId);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const post = useCallback(
    async (payload: Record<string, unknown>, key: string) => {
      setBusy(key);
      try {
        const response = await fetch("/api/role-onboarding", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ orgId, ...payload }),
        });
        if (response.ok) setView((await response.json()) as RoleOnboardingView);
      } finally {
        setBusy(null);
      }
    },
    [orgId],
  );

  return { view, loaded: !orgId || loadedFor === orgId, busy, post };
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
  if (!view || view.status !== "live" || view.totalCount === 0) return null;
  if (setupHeroFrom(view)) return null;
  const left = view.totalCount - view.doneCount;
  const next = nextFirstWeekChecks(view);
  if (next.length === 0) return null;
  // The list shows the next few; the link says how many more there are.
  const more = left - next.length;

  return (
    <section className="dash-first-week" aria-label="Your first week">
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
                  disabled={busy === key}
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
    </section>
  );
}
