"use client";

import { useEffect, useState } from "react";
import { EmptyState, PageHeader, SoftBlockSkeleton } from "../../components/ui";
import { CreditMeter, STATUS_WORD, api, when } from "./admin-console-kit";

type ModuleItem = { id: string; label: string; status: "healthy" | "degraded" | "down" | "not_set_up"; summary: string };
type Overview = {
  health: { summary: Record<string, number>; modules: ModuleItem[]; checkedAt: string } | null;
  newFeedback: number | null;
  waitlist: { waiting: number } | null;
  teamsWaiting: Array<{ orgId: string; teamNumber: number | null; name: string; inviteEmail: string | null; inviteExpired: boolean }> | null;
  credits: {
    setupRequired: boolean;
    activeGifts: number;
    needsEye: Array<{ giftId: string; orgId: string; teamNumber: number | null; teamName: string; amountUsd: number; usedUsd: number; status: string; refusedCalls: number }>;
    degradedKeys: string[];
  } | null;
  recentActions: Array<{ id: string; at: string; summary: string; actorEmail: string | null }> | null;
};

const ORDER: Record<string, number> = { down: 0, degraded: 1, not_set_up: 2, healthy: 3 };

function teamLabel(team: { teamNumber: number | null; name: string }) {
  return team.teamNumber != null ? `Team ${team.teamNumber}` : team.name;
}

/** "Is anything wrong, and is anything waiting on me": the operator's first screen. */
export default function OverviewClient() {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const result = await api<Overview>("/api/admin/overview");
      if (result.ok) setData(result.data);
      else setError(result.error);
    })();
  }, []);

  if (error) {
    return (
      <main className="module-page admin-control ac-page">
        <PageHeader title="Overview" />
        <EmptyState soft title="The overview didn't load" description={error} />
      </main>
    );
  }
  if (!data) {
    return (
      <main className="module-page admin-control ac-page" aria-busy="true">
        <PageHeader title="Overview" />
        <SoftBlockSkeleton />
      </main>
    );
  }

  const modules = [...(data.health?.modules ?? [])].sort((a, b) => ORDER[a.status]! - ORDER[b.status]!);
  const broken = modules.filter((m) => m.status === "down" || m.status === "degraded");
  const teamsWaiting = data.teamsWaiting ?? [];
  const gifts = data.credits?.needsEye ?? [];

  const headline = broken.length
    ? `${broken.length} module${broken.length === 1 ? " needs" : "s need"} a look.`
    : data.health
      ? "Nothing is broken."
      : "Module health couldn't be checked.";

  return (
    <main className="module-page admin-control ac-page">
      <PageHeader title="Overview" description={headline} />

      <section className="ac-section" aria-labelledby="ov-health">
        <div className="ac-section-head">
          <h2 id="ov-health">Health</h2>
          {data.health ? <p className="ac-small">Checked {when(data.health.checkedAt)}</p> : null}
        </div>
        {modules.length ? (
          <ul className="ac-strip">
            {modules.map((module) => (
              <li key={module.id}>
                <a href={`/admin/health?module=${module.id}`} title={module.summary}>
                  <span className="ac-dot" data-status={module.status} aria-hidden="true" />
                  {module.label}
                  <span className="ac-muted ac-small">{STATUS_WORD[module.status]}</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-message ac-muted">Health couldn&rsquo;t be read just now. Open Health to try again.</p>
        )}
      </section>

      <section className="ac-section" aria-labelledby="ov-waiting">
        <div className="ac-section-head">
          <h2 id="ov-waiting">Waiting on you</h2>
        </div>
        <div className="ac-grid">
          <article className="ac-card" data-attention={data.newFeedback ? "" : undefined}>
            <h3>Feedback</h3>
            <strong>{data.newFeedback ?? "–"}</strong>
            <span className="ac-muted ac-small">{data.newFeedback === null ? "Couldn't count new notes." : data.newFeedback === 1 ? "new note" : "new notes"}</span>
            <a href="/admin/feedback">Read feedback</a>
          </article>
          <article className="ac-card" data-attention={data.waitlist?.waiting ? "" : undefined}>
            <h3>Waitlist</h3>
            <strong>{data.waitlist?.waiting ?? "–"}</strong>
            <span className="ac-muted ac-small">{data.waitlist ? "people not invited yet" : "The waitlist isn't reachable here."}</span>
            <a href="/admin/waitlist">Open the waitlist</a>
          </article>
          <article className="ac-card" data-attention={teamsWaiting.length ? "" : undefined}>
            <h3>Teams without an owner</h3>
            <strong>{data.teamsWaiting === null ? "–" : teamsWaiting.length}</strong>
            {teamsWaiting.length ? (
              <ul>
                {teamsWaiting.slice(0, 4).map((team) => (
                  <li key={team.orgId}>
                    <a href={`/admin/teams?team=${team.orgId}`}>{teamLabel(team)}</a>{" "}
                    <span className="ac-muted ac-small">
                      {team.inviteEmail ? (team.inviteExpired ? "invite expired" : "invite sent") : "no invite"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <span className="ac-muted ac-small">Every team&rsquo;s owner has joined.</span>
            )}
          </article>
          <article className="ac-card" data-attention={gifts.length || data.credits?.degradedKeys.length ? "" : undefined}>
            <h3>AI credit</h3>
            <strong>{data.credits ? data.credits.activeGifts : "–"}</strong>
            <span className="ac-muted ac-small">
              {data.credits?.setupRequired ? "Needs migration 0727." : data.credits ? "active gifts" : "Couldn't read gifts."}
            </span>
            {gifts.length ? (
              <ul>
                {gifts.slice(0, 3).map((gift) => (
                  <li key={gift.giftId}>
                    <a href={`/admin/ai-credits?team=${gift.orgId}`}>{teamLabel({ teamNumber: gift.teamNumber, name: gift.teamName })}</a>
                    <CreditMeter used={gift.usedUsd} total={gift.amountUsd} label={`${teamLabel({ teamNumber: gift.teamNumber, name: gift.teamName })} AI credit`} />
                  </li>
                ))}
              </ul>
            ) : null}
            {data.credits?.degradedKeys.length ? (
              <span className="ac-small">Failing key: {data.credits.degradedKeys.join(", ")}</span>
            ) : null}
            <a href="/admin/ai-credits">AI credits</a>
          </article>
        </div>
      </section>

      <section className="ac-section" aria-labelledby="ov-recent">
        <div className="ac-section-head">
          <h2 id="ov-recent">Recent admin actions</h2>
          <a className="ac-small" href="/admin/audit">
            Full audit log
          </a>
        </div>
        {data.recentActions?.length ? (
          <ul className="ac-list">
            {data.recentActions.map((action) => (
              <li key={action.id} className="ac-item">
                <div className="ac-row-main">
                  <strong>{action.summary}</strong>
                  <small>
                    {action.actorEmail ?? "A platform admin"} · {when(action.at)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-message ac-muted">{data.recentActions === null ? "The audit log couldn't be read." : "No admin actions yet."}</p>
        )}
      </section>
    </main>
  );
}
