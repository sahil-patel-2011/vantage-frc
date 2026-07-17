"use client";
import { useCallback, useEffect, useState } from "react";
import { RECOGNITION_STAGE_LABEL, SUGGESTED_AWARDS, type RecognitionStage } from "../../lib/recognition";

type RankedNomination = { id: string; nomineeName: string; reason: string; voteCount: number };
type Award = {
  id: string; seasonYear: number; name: string; description: string; stage: RecognitionStage; byName: string | null;
  ranked: RankedNomination[]; totalVotes: number; winnerId: string | null; myVote: string | null;
};
type View =
  | { status: "setup_required"; message: string }
  | { status: "ready"; context: { orgId: string; role: string; canManage: boolean }; seasonYear: number; awards: Award[] };

const NEXT_STAGE: Record<RecognitionStage, RecognitionStage | null> = { nominating: "voting", voting: "closed", closed: null };

export default function RecognitionClient({ orgId }: { orgId: string | null }) {
  const seasonYear = new Date().getFullYear();
  const [view, setView] = useState<View | null>(null);
  const [message, setMessage] = useState("");
  const [awardName, setAwardName] = useState("");
  const [nomineeInputs, setNomineeInputs] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const response = await fetch(`/api/recognition?seasonYear=${seasonYear}${orgId ? `&orgId=${orgId}` : ""}`);
    const data = (await response.json()) as View & { error?: string };
    if (!response.ok) { setMessage(data.error ?? "Failed to load team awards"); return; }
    setView(data);
  }, [orgId, seasonYear]);
  useEffect(() => { void load(); }, [load]);

  async function post(body: Record<string, unknown>, okMessage: string) {
    if (view?.status !== "ready") return;
    const response = await fetch("/api/recognition", {
      method: "POST", headers: { "content-type": "application/json" },
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

  if (!view) return <main className="intel-app"><p className="telemetry-status">{message || "Loading team awards…"}</p></main>;
  if (view.status === "setup_required") {
    return <main className="intel-app"><header className="intel-header"><div><span className="eyebrow">VANTAGE / TEAM AWARDS</span><h1>Team recognition</h1></div></header><p className="telemetry-status">{view.message}</p></main>;
  }

  const canManage = view.context.canManage;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div><span className="eyebrow">VANTAGE / TEAM AWARDS</span><h1>Team recognition — {seasonYear}</h1></div>
        <nav className="intel-actions"><a href={`/team/awards${orgId ? `?orgId=${orgId}` : ""}`}>FIRST awards</a><a href="/workspace">Workspace →</a></nav>
      </header>
      {message && <p className="telemetry-status">{message}</p>}
      <p className="telemetry-status">Nominate teammates, then vote — one ballot each. These are your team&apos;s own end-of-season awards, separate from the FIRST competition awards.</p>

      {canManage && (
        <section className="intel-panel">
          <span className="eyebrow">CREATE AN AWARD (OWNER/ADMIN)</span>
          <div className="budget-fields">
            <label>Award name<input value={awardName} onChange={(e) => setAwardName(e.target.value)} placeholder="Most Valuable Player" /></label>
            <button className="primary-action" onClick={() => void createAward(awardName)}>Create</button>
          </div>
          <p><small>Quick add: {SUGGESTED_AWARDS.map((s) => <a key={s} href="#" onClick={(e) => { e.preventDefault(); void createAward(s); }} style={{ marginRight: 10 }}>{s}</a>)}</small></p>
        </section>
      )}

      {view.awards.length === 0 && <section className="intel-panel"><p>{canManage ? "No awards yet — create one above." : "No team awards have been set up yet."}</p></section>}

      {view.awards.map((award) => (
        <section className="intel-panel" key={award.id}>
          <span className="eyebrow">{award.name.toUpperCase()} · {RECOGNITION_STAGE_LABEL[award.stage]}{award.stage === "voting" ? ` · ${award.totalVotes} votes` : ""}</span>
          {award.description && <p>{award.description}</p>}

          {award.ranked.length === 0 && <p>No nominations yet.</p>}
          {award.ranked.map((nom) => (
            <article key={nom.id}>
              <div style={{ flex: 1 }}>
                <strong>{nom.nomineeName}{award.winnerId === nom.id ? " 🏆 winner" : ""}</strong>
                <small>{award.stage !== "nominating" ? `${nom.voteCount} vote${nom.voteCount === 1 ? "" : "s"}` : "nominated"}{nom.reason ? ` · ${nom.reason}` : ""}</small>
              </div>
              <div>
                {award.stage === "voting" && (
                  <button onClick={() => void post({ action: "cast_vote", awardId: award.id, nominationId: nom.id }, "Vote recorded.")} disabled={award.myVote === nom.id}>
                    {award.myVote === nom.id ? "Your vote ✓" : "Vote"}
                  </button>
                )}
              </div>
            </article>
          ))}

          {award.stage === "nominating" && (
            <div className="budget-fields">
              <label>Nominate someone<input value={nomineeInputs[award.id] ?? ""} onChange={(e) => setNomineeInputs((prev) => ({ ...prev, [award.id]: e.target.value }))} placeholder="Teammate name" /></label>
              <button className="primary-action" onClick={() => void nominate(award.id)}>Nominate</button>
            </div>
          )}

          {canManage && (
            <p>
              {NEXT_STAGE[award.stage] && <button onClick={() => void post({ action: "set_stage", id: award.id, stage: NEXT_STAGE[award.stage] }, `Moved to ${NEXT_STAGE[award.stage]}.`)}>Advance to {NEXT_STAGE[award.stage] && RECOGNITION_STAGE_LABEL[NEXT_STAGE[award.stage]!]}</button>}
              {" "}
              <button onClick={() => void post({ action: "delete_award", id: award.id }, "Award deleted.")}>Delete</button>
            </p>
          )}
        </section>
      ))}
    </main>
  );
}
