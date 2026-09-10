"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Button } from "../../components/ui";
import { RECOGNITION_STAGE_LABEL, SUGGESTED_AWARDS, type RecognitionStage } from "../../lib/recognition";
import { classifyLoadFailure, loadFailureCopy } from "../../lib/ui/load-failure";

type RankedNomination = { id: string; nomineeName: string; reason: string; voteCount: number };
type Award = {
  id: string;
  seasonYear: number;
  name: string;
  description: string;
  stage: RecognitionStage;
  byName: string | null;
  ranked: RankedNomination[];
  totalVotes: number;
  winnerId: string | null;
  myVote: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | {
      status: "ready";
      context: { orgId: string; role: string; canManage: boolean };
      seasonYear: number;
      awards: Award[];
    };

const NEXT_STAGE: Record<RecognitionStage, RecognitionStage | null> = {
  nominating: "voting",
  voting: "closed",
  closed: null,
};

export default function RecognitionClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  // Kept so an expired session offers sign-in instead of a Retry that cannot work.
  const [errorStatus, setErrorStatus] = useState<number | null>(null);
  const [awardName, setAwardName] = useState("");
  const [nomineeInputs, setNomineeInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const response = await fetch(
      `/api/recognition?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`,
    );
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Failed to load team awards");
      setErrorStatus(response.status);
      return;
    }
    setErrorStatus(null);
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/recognition", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: view.context.orgId, ...body }),
    });
    const data = await response.json();
    setMessage(response.ok ? okMessage : data.error);
    if (response.ok) await load();
  }

  async function createAward(name: string) {
    if (!name.trim()) return;
    await post({ action: "create_award", seasonYear, name }, "Award created.");
    setAwardName("");
  }

  async function nominate(awardId: string) {
    const name = (nomineeInputs[awardId] ?? "").trim();
    if (!name) return;
    await post({ action: "add_nomination", awardId, nomineeName: name }, "Nomination added.");
    setNomineeInputs((prev) => ({ ...prev, [awardId]: "" }));
  }

  if (!view) {
    // A failed load names its own recovery — Retry cannot fix an expired session.
    const copy = message
      ? loadFailureCopy(
          classifyLoadFailure({
            status: errorStatus,
            message,
            online: typeof navigator === "undefined" ? true : navigator.onLine,
          }),
          {
            nextPath:
              typeof window === "undefined"
                ? null
                : `${window.location.pathname}${window.location.search}`,
            message,
          },
        )
      : null;
    return (
      <main className="module-page">
        <PageHeader
          navPath="/recognition"
          title="Recognition"
          description={
            copy
              ? "Nominate teammates for your team's own end-of-season awards, then vote."
              : "Loading team awards…"
          }
        />
        {copy ? (
          <EmptyState soft badge="Unavailable" badgeTone="setup" title={copy.title} description={copy.description}>
            {copy.primary ? (
              <Button as="a" variant="primary" href={copy.primary.href}>
                {copy.primary.label}
              </Button>
            ) : null}
            {copy.showRetry ? (
              <Button variant="secondary" type="button" onClick={() => void load()}>
                Retry
              </Button>
            ) : null}
          </EmptyState>
        ) : null}
      </main>
    );
  }

  if (view.status === "setup_required") {
    return (
      <main className="module-page">
        <PageHeader
          navPath="/recognition"
          title="Recognition"
          description="Nominate teammates for your team's own end-of-season awards, then vote."
        />
        <EmptyState
          soft
          badge="Setup required"
          badgeTone="setup"
          title={view.message}
          description="Choose a team, then return here to open nominations. Empty shells stay empty."
        >
          <Button as="a" variant="primary" href="/workspace">
            Choose your team
          </Button>
        </EmptyState>
      </main>
    );
  }

  const canManage = view.context.canManage;

  return (
    <main className="module-page">
      <PageHeader
        navPath="/recognition"
        title="Recognition"
        description={`Nominate teammates, then vote — one ballot each · ${seasonYear}. These are your team's own end-of-season awards, separate from the FIRST competition awards.`}
      >
        <nav className="visit-inline-actions" aria-label="Related">
          <Button as="a" variant="secondary" href={`/team/awards${orgId ? `?orgId=${orgId}` : ""}`}>
            FIRST awards
          </Button>
          <Button as="a" variant="secondary" href="/workspace">
            Your team
          </Button>
        </nav>
      </PageHeader>
      {message ? <p className="telemetry-status" role="status">{message}</p> : null}

      {canManage ? (
        <section className="app-card soft-panel">
          <span className="app-badge">Create an award</span>
          <h2>Owner / admin</h2>
          <div className="budget-fields">
            <label>
              Award name
              <input
                value={awardName}
                onChange={(e) => setAwardName(e.target.value)}
                placeholder="Most Valuable Player"
              />
            </label>
            <Button variant="primary" type="button" onClick={() => void createAward(awardName)}>
              Create
            </Button>
          </div>
          <p>
            <small>
              Quick add:{" "}
              {SUGGESTED_AWARDS.map((s) => (
                <a
                  key={s}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    void createAward(s);
                  }}
                  style={{ marginRight: 10 }}
                >
                  {s}
                </a>
              ))}
            </small>
          </p>
        </section>
      ) : null}

      {view.awards.length === 0 ? (
        <EmptyState
          soft
          title="No team awards yet"
          description={canManage ? "Create one above to start nominations." : "No team awards have been set up yet."}
        />
      ) : null}

      {view.awards.map((award) => (
        <section className="app-card soft-panel" key={award.id}>
          <span className="app-badge">
            {RECOGNITION_STAGE_LABEL[award.stage]}
            {award.stage === "voting" ? ` · ${award.totalVotes} votes` : ""}
          </span>
          <h2>{award.name}</h2>
          {award.description ? <p className="app-muted">{award.description}</p> : null}

          {award.ranked.length === 0 ? <p className="app-muted">No nominations yet.</p> : null}
          {award.ranked.map((nom) => (
            <article key={nom.id} style={{ display: "flex", gap: 12, alignItems: "center", padding: "10px 0", borderTop: "1px solid var(--line)" }}>
              <div style={{ flex: 1 }}>
                <strong>
                  {nom.nomineeName}
                  {award.winnerId === nom.id ? " — winner" : ""}
                </strong>
                <div className="app-muted">
                  {award.stage !== "nominating"
                    ? `${nom.voteCount} vote${nom.voteCount === 1 ? "" : "s"}`
                    : "nominated"}
                  {nom.reason ? ` · ${nom.reason}` : ""}
                </div>
              </div>
              {award.stage === "voting" ? (
                <Button variant="secondary" type="button" onClick={() => void post({ action: "cast_vote", awardId: award.id, nominationId: nom.id }, "Vote recorded.") } disabled={award.myVote === nom.id}>
                  {award.myVote === nom.id ? "Your vote" : "Vote"}
                </Button>
              ) : null}
            </article>
          ))}

          {award.stage === "nominating" ? (
            <div className="budget-fields" style={{ marginTop: 12 }}>
              <label>
                Nominate someone
                <input
                  value={nomineeInputs[award.id] ?? ""}
                  onChange={(e) => setNomineeInputs((prev) => ({ ...prev, [award.id]: e.target.value }))}
                  placeholder="Teammate name"
                />
              </label>
              <Button variant="primary" type="button" onClick={() => void nominate(award.id)}>
                Nominate
              </Button>
            </div>
          ) : null}

          {canManage ? (
            <p style={{ marginTop: 12, display: "flex", gap: 8, flexWrap: "wrap" }}>
              {NEXT_STAGE[award.stage] ? (
                <Button variant="secondary" type="button" onClick={() => void post( { action: "set_stage", id: award.id, stage: NEXT_STAGE[award.stage] }, `Moved to ${NEXT_STAGE[award.stage]}.`, ) }>
                  Advance to {RECOGNITION_STAGE_LABEL[NEXT_STAGE[award.stage]!]}
                </Button>
              ) : null}
              <Button variant="secondary" type="button" onClick={() => void post({ action: "delete_award", id: award.id }, "Award deleted.")}>
                Delete
              </Button>
            </p>
          ) : null}
        </section>
      ))}
    </main>
  );
}
