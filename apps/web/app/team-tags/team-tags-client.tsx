"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import type { TeamTagsView } from "../../lib/team-tags/compute-team-tags";
import { hubHref } from "../../lib/nav/hubs";
import { withOrgHref } from "../../lib/nav/product-nav";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";
import "./team-tags.css";

type LiveView = Extract<TeamTagsView, { status: "live" }>;

export default function TeamTagsClient() {
  const [view, setView] = useState<TeamTagsView | null>(null);
  const [error, setError] = useState("");
  // Kept so an expired session offers sign-in instead of a dead end.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const orgId = new URLSearchParams(window.location.search).get("orgId");
    const query = orgId ? `?orgId=${encodeURIComponent(orgId)}` : "";
    setErrorStatus(null);
    try {
      const response = await fetch(`/api/team-tags${query}`);
      const data = (await response.json()) as TeamTagsView | { error?: string };
      if (!response.ok || !("status" in data)) {
        setErrorStatus(response.status);
        setError("error" in data && data.error ? data.error : "Could not load drive-team tags.");
        return;
      }
      setView(data);
    } catch {
      setError("Network error — please try again.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const live = view?.status === "live" ? view : null;
  const orgId = live?.orgId ?? (view && "orgId" in view ? view.orgId : null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!live || busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/team-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "tag",
          orgId: live.orgId,
          tagId: data.get("tagId"),
          teamNumber: data.get("teamNumber"),
          notes: data.get("notes"),
        }),
      });
      const payload = (await response.json()) as TeamTagsView | { error?: string };
      if (!response.ok || !("status" in payload)) {
        throw new Error("error" in payload && payload.error ? payload.error : "Could not save tag");
      }
      setView(payload);
      form.reset();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save tag");
    } finally {
      setBusy(false);
    }
  }

  async function remove(assignmentId: string) {
    if (!live || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/team-tags", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", orgId: live.orgId, assignmentId }),
      });
      const payload = (await response.json()) as TeamTagsView;
      if (payload && "status" in payload) setView(payload);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="module-page team-tags-page">
      <PageHeader
        breadcrumbs={
          <>
            <a href={orgId ? hubHref("/competition", "scouting", orgId) : "/competition"}>Competition</a>
            {" / Drive-team tags"}
          </>
        }
        title="Drive-team tags"
        description="Label robots as you watch them. The board stays empty until someone applies a real tag — not a 1–10 scale, not TBA."
      />

      <nav className="product-hub-related" aria-label="Related qualitative tools">
        <Button as="a" variant="secondary" href={orgId ? withOrgHref("/pairwise", orgId) : "/pairwise"}>
          Pairwise ranking
        </Button>
        <Button as="a" variant="secondary" href={orgId ? hubHref("/competition", "scouting", orgId) : "/scouting"}>
          Scouting
        </Button>
        <Button as="a" variant="secondary" href={orgId ? hubHref("/competition", "pick-clock", orgId) : "/pick-clock"}>
          Pick clock
        </Button>
      </nav>

      {error && view ? <p className="app-muted" role="alert">{error}</p> : null}
      {error && !view
        ? (() => {
            const copy = loadFailureCopy(
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
                message: error,
              },
            );
            return (
              <>
                <p className="app-muted" role="alert">
                  <strong>{copy.title}</strong> — {copy.description}
                </p>
                {copy.primary ? (
                  <Button as="a" variant="primary" href={copy.primary.href}>
                    {copy.primary.label}
                  </Button>
                ) : null}
              </>
            );
          })()
        : null}
      {!view && !error ? <p className="app-muted">Loading tags…</p> : null}

      {view?.status === "setup_required" ? (
        <EmptyState badge="Setup required" badgeTone="setup" title={view.message}>
          {view.steps[0] ? (
            <Button as="a" variant="primary" href={view.steps[0].href}>
              {view.steps[0].label}
            </Button>
          ) : null}
        </EmptyState>
      ) : null}

      {live ? <LiveTags view={live} busy={busy} onSubmit={submit} onRemove={remove} /> : null}
    </main>
  );
}

function LiveTags({
  view,
  busy,
  onSubmit,
  onRemove,
}: {
  view: LiveView;
  busy: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="team-tags-stack">
      <section className="app-card soft-panel" aria-label="Next actions">
        <h2>What to do next</h2>
        <ul className="team-tags-actions">
          {view.nextActions.map((action) => (
            <li key={action.id}>
              <a className={action.primary ? "app-button" : "app-button secondary"} href={action.href}>
                {action.label}
              </a>
              <span>{action.detail}</span>
            </li>
          ))}
        </ul>
      </section>

      <Panel>
        <p className="app-muted">
          Pairwise 2.0’s tag board. Event {view.eventKey ?? "not set"} — teams in the picker come from the synced event
          schedule.
        </p>
        <form className="team-tags-form" onSubmit={onSubmit}>
          <label>
            Team
            <input
              name="teamNumber"
              list="team-tags-teams"
              inputMode="numeric"
              required
              placeholder="1678"
            />
          </label>
          <label>
            Tag
            <select name="tagId" required defaultValue={view.defs[0]?.id ?? ""}>
              {view.defs.map((def) => (
                <option key={def.id} value={def.id}>
                  {def.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            Note
            <input name="notes" placeholder="Optional — bumper lock, late auto…" />
          </label>
          <Button variant="primary" disabled={busy || !view.defs.length}>
            Tag robot
          </Button>
        </form>
        <datalist id="team-tags-teams">
          {view.eventTeams.map((team) => (
            <option key={team} value={team} />
          ))}
        </datalist>
      </Panel>

      {view.pickReasons?.length ? (
        <section className="app-card soft-panel" aria-label="Pick reasons">
          <h2>Pick reasons</h2>
          <p className="app-muted">
            What pick clock can read from tags on this event&apos;s robots. Empty until a tag is applied.
          </p>
          <ul className="team-tags-actions">
            {view.pickReasons.map((reason) => (
              <li key={`${reason.teamNumber}-${reason.tagSlug}`}>
                <strong>{reason.teamNumber}</strong>
                <span>
                  {reason.label}
                  {reason.tone === "caution" ? " · caution" : reason.tone === "strong" ? " · strong" : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="team-tags-board" aria-label="Tag board">
        {view.board.map((column) => (
          <article key={column.tagId} className="app-card">
            <header>
              <h2>{column.name}</h2>
              <span className="app-muted">{column.teams.length}</span>
            </header>
            <ul>
              {column.teams.map((team) => (
                <li key={team.assignmentId}>
                  <strong>{team.teamNumber}</strong>
                  <span>{team.notes ?? (team.matchKey ? team.matchKey : "")}</span>
                  <button type="button" className="danger" disabled={busy} onClick={() => onRemove(team.assignmentId)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          </article>
        ))}
        {!view.board.length ? (
          <EmptyState
            title="No robots tagged yet"
            description="Watch a match, then tag defense, climb, or partner fit. Counts stay at zero until you do."
          />
        ) : null}
      </section>
    </div>
  );
}
