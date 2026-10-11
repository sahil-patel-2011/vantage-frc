"use client";

import { useCallback, useEffect, useState } from "react";
import { askText, Button, EmptyState } from "../../../../components/ui";

type Pending = {
  id: string;
  userId: string;
  displayName: string;
  requestedAt: string;
  trackId: string;
  stepTitle: string;
  trackTitle: string;
  what: string;
};
type Member = { userId: string; displayName: string; tracks: Record<string, number>; lastActivityAt: string | null };
type View =
  | {
      status: "ready";
      orgId: string;
      orgName: string;
      tracks: Array<{ id: string; title: string; shortTitle?: string; steps: number }>;
      pending: Pending[];
      ownPending: number;
      members: Member[];
    }
  | { status: "error"; message: string; code: number };

function orgFromUrl(): string | null {
  try {
    return new URLSearchParams(window.location.search).get("orgId");
  } catch {
    return null;
  }
}

const when = (iso: string) => {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

/** Owners and admins: sign-offs to decide first, then how far each member has got on each track. */
export function TeamProgressClient() {
  const [view, setView] = useState<View | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const org = orgFromUrl();
    const response = await fetch(`/api/guided/team${org ? `?orgId=${encodeURIComponent(org)}` : ""}`, { cache: "no-store" }).catch(() => null);
    if (!response) {
      setView({ status: "error", message: "Couldn't reach Vantage. Check your connection and try again.", code: 0 });
      return;
    }
    const data = (await response.json().catch(() => ({}))) as View & { error?: string };
    setView(response.ok ? data : { status: "error", message: data.error ?? "Couldn't load team progress.", code: response.status });
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function decide(item: Pending, approve: boolean) {
    let note: string | null = null;
    if (!approve) {
      note = await askText({
        title: `Ask ${item.displayName} to try again?`,
        body: `“${item.stepTitle}” stays open for them, with your note.`,
        confirmLabel: "Send back",
        tone: "neutral",
        input: { label: "What to work on (optional)", placeholder: "e.g. Tighten the belt before running it", multiline: true },
      });
      if (note === null) return;
    }
    setBusy(item.id);
    const response = await fetch("/api/guided/team", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view?.status === "ready" ? view.orgId : orgFromUrl(), action: approve ? "approve" : "decline", id: item.id, note }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => ({}))) as { error?: string };
    setBusy(null);
    setNotice(
      response?.ok
        ? approve
          ? `Signed off “${item.stepTitle}” for ${item.displayName}.`
          : `Sent “${item.stepTitle}” back to ${item.displayName}.`
        : (data?.error ?? "Couldn't save that. Try again."),
    );
    await load();
  }

  return (
    <main className="module-page guided-page guided-team-page">
      <header className="app-page-header">
        <div>
          <span className="breadcrumbs">
            <a href="/learn">Code &amp; CAD</a> / <a href="/learn/guided">Checked step by step</a> / Team progress
          </span>
          <h1>Team progress</h1>
          <p>Sign off the steps software can&apos;t check, then see how far each member has got on every track.</p>
        </div>
      </header>

      {notice ? (
        <p className="guided-team-notice" role="status">
          {notice}
        </p>
      ) : null}

      {!view ? (
        <p className="guided-meta" role="status">
          Loading team progress…
        </p>
      ) : view.status === "error" ? (
        <EmptyState title={view.code === 403 ? "Owners and admins only" : "Team progress isn't available"} description={view.message} />
      ) : (
        <>
          <section className="guided-group" aria-labelledby="guided-pending">
            <h2 id="guided-pending">Waiting for a sign-off</h2>
            {view.pending.length === 0 ? (
              <p>
                Nothing waiting. When a member asks a lead to sign off a step, it shows up here.
                {view.ownPending ? ` Your own request${view.ownPending === 1 ? "" : "s"} need another owner or admin.` : ""}
              </p>
            ) : (
              <ul className="guided-pending-list">
                {view.pending.map((item) => (
                  <li key={item.id} className="app-card soft-panel">
                    <div>
                      <strong>
                        {item.displayName} · {item.stepTitle}
                      </strong>
                      <small>
                        {item.trackTitle} · asked {when(item.requestedAt)}
                      </small>
                      {item.what ? <p>Check with them: {item.what}</p> : null}
                    </div>
                    <div className="guided-actions">
                      <Button variant="secondary" disabled={busy === item.id} onClick={() => void decide(item, false)}>
                        Send back
                      </Button>
                      <Button variant="primary" disabled={busy === item.id} onClick={() => void decide(item, true)}>
                        {busy === item.id ? "Saving…" : "Sign off"}
                      </Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="guided-group" aria-labelledby="guided-members">
            <h2 id="guided-members">Steps done, by member</h2>
            {view.members.length === 0 ? (
              <p>No members to show yet. Invite your team, then share a track from Checked step by step.</p>
            ) : (
              <>
                {view.members.every((member) => Object.keys(member.tracks).length === 0) ? (
                  <p className="guided-meta">No one has finished a checked step yet. Share a track from Checked step by step to get started.</p>
                ) : null}
                <div className="guided-table-wrap" role="region" aria-labelledby="guided-members" tabIndex={0}>
                  <table className="guided-table">
                    <thead>
                      <tr>
                        <th scope="col">Member</th>
                        {view.tracks.map((track) => (
                          <th key={track.id} scope="col">
                            <a href={`/learn/guided/${track.id}`} title={track.title} aria-label={track.title}>
                              {track.shortTitle ?? track.title}
                            </a>
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {view.members.map((member) => (
                        <tr key={member.userId}>
                          <th scope="row">{member.displayName}</th>
                          {view.tracks.map((track) => {
                            const done = Math.min(member.tracks[track.id] ?? 0, track.steps);
                            const waiting = view.pending.filter((item) => item.userId === member.userId && item.trackId === track.id).length;
                            return (
                              <td key={track.id} data-done={done === track.steps ? "all" : done ? "some" : "none"}>
                                <span>{done ? `${done}/${track.steps}` : "Not started"}</span>
                                {waiting ? (
                                  <em className="guided-cell-pending">
                                    {waiting} waiting for you
                                  </em>
                                ) : null}
                                <i aria-hidden="true" style={{ width: `${(done / Math.max(1, track.steps)) * 100}%` }} />
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
