"use client";

import { Button } from "../../components/ui";
import { withOrgHref } from "../../lib/nav/product-nav";
import type { HomeNowAction } from "./dashboard-home-model";
import { SetupProgress, type SetupHero } from "./first-week-card";

/**
 * "What to do now": the one thing on Home asking to be acted on.
 *
 * While it does not know yet it is a grey shape with no words — it used to say
 * "Nothing you have to do right now" first and then change its mind. While the
 * team's setup is unfinished and nothing more pressing is on, it is the next
 * setup step itself, with its button and a small progress list, instead of a
 * card pointing at a second card with the same list in it.
 */
export function DashboardNowCard({
  now,
  setupHero,
  loaded,
  orgId,
  editing,
}: {
  now: HomeNowAction;
  setupHero: SetupHero | null;
  loaded: boolean;
  orgId: string;
  editing: boolean;
}) {
  const dim = editing ? ({ inert: true, "data-edit-dim": "true" } as const) : {};
  if (!loaded) {
    return (
      <section className="dash-now dash-now-wait" aria-label="What to do now" aria-busy="true" data-testid="dash-now" {...dim}>
        <div className="dash-skel-lines" aria-hidden="true">
          <i />
          <i />
        </div>
      </section>
    );
  }
  const setupIsNext = Boolean(setupHero && now.quiet);
  if (setupHero && setupIsNext) {
    return (
      <section className="dash-now dash-now-setup" aria-label="What to do now" data-testid="dash-now" {...dim}>
        <div className="dash-now-main">
          <strong>{setupHero.title}</strong>
          {setupHero.detail ? <p>{setupHero.detail}</p> : null}
          <Button as="a" variant="primary" href={withOrgHref(setupHero.href, orgId || null)} data-testid="dash-now-cta">
            {setupHero.cta}
          </Button>
        </div>
        <SetupProgress hero={setupHero} />
      </section>
    );
  }
  return (
    <section className="dash-now" aria-label="What to do now" data-testid="dash-now" {...dim}>
      <div>
        <strong>{now.title}</strong>
        {now.detail ? <p>{now.detail}</p> : null}
      </div>
      {now.quiet ? (
        <a className="dash-now-quiet" href={withOrgHref(now.href, orgId || null)}>
          {now.cta} →
        </a>
      ) : (
        <Button as="a" variant="primary" href={withOrgHref(now.href, orgId || null)} data-testid="dash-now-cta">
          {now.cta}
        </Button>
      )}
    </section>
  );
}

/**
 * Home before the team and its board have loaded: grey shapes, no words, no
 * buttons. The page used to go through "No team selected", then the built-in
 * board with its own copy, then the real one — three screens in two seconds,
 * with a working Edit on the placeholder.
 */
export function DashboardHomeSkeleton({ greetingText }: { greetingText: string }) {
  return (
    <main className="dash-home scan-workbench scan-hub--dashboard dash-home-loading" aria-busy="true" data-testid="dash-home-skeleton">
      <header className="dash-home-header">
        <div>
          <h1 className="dash-hero-greeting">{greetingText}</h1>
          <span className="dash-skel-chip" aria-hidden="true" />
        </div>
        <div className="dash-home-actions">
          <button type="button" className="dash-edit-button" disabled aria-label="Edit (available once Home has loaded)">
            Edit
          </button>
        </div>
      </header>
      <section className="dash-now dash-now-wait" aria-label="What to do now" aria-busy="true">
        <div className="dash-skel-lines" aria-hidden="true">
          <i />
          <i />
        </div>
      </section>
      <div className="dash-skel-board" aria-hidden="true">
        <i className="is-wide" />
        <i />
        <i />
        <i />
      </div>
    </main>
  );
}
