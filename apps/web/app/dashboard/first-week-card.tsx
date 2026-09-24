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

export function FirstWeekCard({ orgId }: { orgId: string }) {
  const [view, setView] = useState<RoleOnboardingView | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    void fetch(`/api/role-onboarding?orgId=${encodeURIComponent(orgId)}`)
      .then((response) => (response.ok ? (response.json() as Promise<RoleOnboardingView>) : null))
      .then((next) => {
        if (!cancelled) setView(next);
      })
      .catch(() => undefined);
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

  if (!view || view.status !== "live" || view.totalCount === 0) return null;
  const left = view.totalCount - view.doneCount;
  const setup = view.tracks.find((track) => track.key === "team_setup" && !track.dismissed);
  const settingUp = Boolean(setup && setup.doneCount < setup.totalCount);
  // While the team itself isn't set up, that is the whole card: an owner's own
  // "first week" steps can wait until there is a team for them to happen in.
  const next =
    settingUp && setup
      ? setup.checks.filter((check) => !check.done).slice(0, SHOWN).map((check) => ({ track: setup, check }))
      : nextFirstWeekChecks(view);
  if (next.length === 0) return null;

  return (
    <section className="dash-first-week" aria-label={settingUp ? "Set up your team" : "Your first week"}>
      <header>
        <strong>{settingUp ? "Set up your team" : "Your first week"}</strong>
        <span>
          {settingUp && setup
            ? `${setup.doneCount} of ${setup.totalCount} done`
            : `${view.doneCount} of ${view.totalCount} done · ${left} to go`}
        </span>
      </header>
      <ol>
        {next.map(({ track, check }) => {
          const key = `${track.key}:${check.key}`;
          return (
            <li key={key}>
              <input
                type="checkbox"
                aria-label={`Mark "${check.label}" done`}
                checked={false}
                disabled={busy === key}
                onChange={() => void post({ action: "check", trackKey: track.key, checkKey: check.key }, key)}
              />
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
        See every step
      </a>
    </section>
  );
}
