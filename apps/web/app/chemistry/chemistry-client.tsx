"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "../../components/app-shell";
import { EmptyState, FormRow, PageHeader, Panel } from "../../components/ui";
import type { ChemistryView } from "../../lib/chemistry/load-chemistry";

type Me = { orgId?: string | null; orgName?: string | null; teamNumber?: number | null };

export default function ChemistryClient() {
  const [orgId, setOrgId] = useState("");
  const [view, setView] = useState<ChemistryView | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");

  useEffect(() => {
    const fromUrl = new URLSearchParams(window.location.search).get("orgId") ?? "";
    const teams = new URLSearchParams(window.location.search).get("teams") ?? "";
    if (teams) setDraft(teams);
    void fetch("/api/me")
      .then(async (r) => (r.ok ? ((await r.json()) as Me) : null))
      .then((data) => {
        if (!data) return;
        setOrgId(fromUrl || data.orgId || "");
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (id: string, teams?: string) => {
      if (!id) {
        setLoading(false);
        return;
      }
      const params = new URLSearchParams({ orgId: id });
      const list = (teams ?? draft).trim();
      if (list) params.set("teams", list);
      const response = await fetch(`/api/chemistry?${params}`);
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        setError(body.error ?? "Could not load chemistry");
        setLoading(false);
        return;
      }
      const data = (await response.json()) as ChemistryView;
      setView(data);
      if (!list && data.teamKeys.length) {
        setDraft(data.teamKeys.map((key) => key.replace(/^frc/i, "")).join(", "));
      }
      setError("");
      setLoading(false);
    },
    [draft],
  );

  useEffect(() => {
    if (!orgId) {
      setLoading(false);
      return;
    }
    void load(orgId);
  }, [orgId]); // eslint-disable-line react-hooks/exhaustive-deps -- initial load only

  function scoreTone(score: number | null) {
    if (score == null) return "";
    if (score >= 75) return "good";
    if (score >= 55) return "ok";
    return "risk";
  }

  if (!orgId && !loading) {
    return (
      <main className="edc-page chem-page">
        <PageHeader
          breadcrumbs="Competition / Chemistry"
          title="Select a team workspace"
          description="Open Home to choose your organization first."
        >
          <a className="app-button" href="/dashboard">
            Go to Home
          </a>
        </PageHeader>
      </main>
    );
  }

  const chemistry = view?.chemistry;

  return (
    <main className="edc-page chem-page">
      <PageHeader
        breadcrumbs="Competition / Chemistry"
        title="Alliance Chemistry"
        description="Score how well 2–3 robots complement each other — roles, EPA balance, scout reliability. Labeled MODEL, never a TBA pick fact."
      >
        <div className="edc-header-actions">
          <a className="app-button secondary" href={orgId ? `/command?orgId=${encodeURIComponent(orgId)}` : "/command"}>
            Event Day
          </a>
          <a className="app-button secondary" href={orgId ? `/strategy?orgId=${encodeURIComponent(orgId)}` : "/strategy"}>
            Strategy
          </a>
        </div>
      </PageHeader>

      {error ? <p className="edc-banner error">{error}</p> : null}

      <Panel
        as="form"
        className="chem-compose"
        style={{ minHeight: "auto" }}
        onSubmit={(event: React.FormEvent) => {
          event.preventDefault();
          void load(orgId, draft);
        }}
      >
        <header>
          <div className="edc-card-title">
            <span
              className="edc-icon"
              style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}
            >
              <Icon name="users" />
            </span>
            <div>
              <h2>Alliance seats</h2>
              <p>
                {view?.eventName
                  ? `${view.eventName} · defaults to your next alliance when blank`
                  : "Set an active event to pull next-alliance defaults"}
              </p>
            </div>
          </div>
        </header>
        <div className="chem-form">
          <FormRow label="Team numbers (2–3)">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="254, 1678, 118"
              aria-label="Alliance team numbers"
            />
          </FormRow>
          <button className="app-button" type="submit" disabled={loading || !orgId}>
            Score chemistry
          </button>
        </div>
      </Panel>

      {view?.status === "setup_required" ? (
        <EmptyState
          badge="Setup required"
          badgeTone="setup"
          title={view.message}
          description="No demo alliances — chemistry needs a real event context and reference metrics."
        >
          <ol className="strategy-setup-steps">
            <li>
              <div>
                <strong>Select active event</strong>
                <span>Event Day Command → Change event</span>
              </div>
              <a href={orgId ? `/command?orgId=${encodeURIComponent(orgId)}` : "/command"}>Open</a>
            </li>
            <li>
              <div>
                <strong>Sync TBA / Statbotics</strong>
                <span>Metrics power role complementarity</span>
              </div>
              <a href={orgId ? `/team/data?orgId=${encodeURIComponent(orgId)}` : "/team/data"}>Open</a>
            </li>
          </ol>
        </EmptyState>
      ) : null}

      {chemistry ? (
        <section className="chem-result">
          <article className={`edc-card chem-score ${scoreTone(chemistry.score)}`}>
            <header>
              <div className="edc-card-title">
                <span
                  className="edc-icon"
                  style={{ ["--tone" as string]: "#1f4fd6", ["--tone-bg" as string]: "#e4ecfc" }}
                >
                  <Icon name="bolt" />
                </span>
                <div>
                  <h2>Chemistry score</h2>
                  <p>MODEL {chemistry.modelVersion}</p>
                </div>
              </div>
            </header>
            <div className="edc-prob">
              <strong>{chemistry.score ?? "—"}</strong>
              <span>Compatibility / 100</span>
            </div>
            <div className="chem-metrics">
              <div>
                <strong>{chemistry.totalEpa ?? "—"}</strong>
                <span>Total EPA</span>
              </div>
              <div>
                <strong>{chemistry.complementarity ?? "—"}</strong>
                <span>Role fit</span>
              </div>
              <div>
                <strong>{chemistry.reliabilityBlend ?? "—"}</strong>
                <span>Scout reliability</span>
              </div>
              <div>
                <strong>{chemistry.foulRisk}</strong>
                <span>Foul risk</span>
              </div>
            </div>
            <p className="edc-caveat">{chemistry.caveats[0] ?? chemistry.caveat}</p>
          </article>

          <article className="edc-card">
            <header>
              <div className="edc-card-title">
                <span
                  className="edc-icon"
                  style={{ ["--tone" as string]: "#0f766e", ["--tone-bg" as string]: "#ccfbf1" }}
                >
                  <Icon name="target" />
                </span>
                <div>
                  <h2>Roles</h2>
                  <p>Primary phase lean from event EPA shares</p>
                </div>
              </div>
            </header>
            <ul className="chem-roles">
              {chemistry.roles.map((role) => (
                <li key={role.teamKey}>
                  <strong>{role.teamKey.replace(/^frc/i, "")}</strong>
                  <span className="edc-tags">
                    <span>{role.primaryRole}</span>
                  </span>
                  <p className="edc-muted">{role.evidence}</p>
                </li>
              ))}
            </ul>
          </article>

          <article className="edc-card">
            <header>
              <div className="edc-card-title">
                <span
                  className="edc-icon"
                  style={{ ["--tone" as string]: "#15803d", ["--tone-bg" as string]: "#dcfce7" }}
                >
                  <Icon name="stats" />
                </span>
                <div>
                  <h2>Strengths & risks</h2>
                  <p>Cited from metrics + scout ops</p>
                </div>
              </div>
            </header>
            <div className="chem-split">
              <div>
                <h3>Strengths</h3>
                <ul>
                  {chemistry.strengths.length ? (
                    chemistry.strengths.map((s) => <li key={s}>{s}</li>)
                  ) : (
                    <li className="edc-muted">None flagged yet</li>
                  )}
                </ul>
              </div>
              <div>
                <h3>Risks</h3>
                <ul>
                  {chemistry.risks.length ? (
                    chemistry.risks.map((s) => <li key={s}>{s}</li>)
                  ) : (
                    <li className="edc-muted">None flagged yet</li>
                  )}
                </ul>
              </div>
            </div>
          </article>
        </section>
      ) : view?.status === "empty" ? (
        <EmptyState soft title={view.message} description="Enter team numbers above, or set an event so we can default to your next alliance." />
      ) : loading ? (
        <EmptyState title="Loading…" description="Scoring alliance chemistry." aria-busy />
      ) : null}

      {view?.teams.length ? (
        <section className="chem-teams">
          <h2>Seat details</h2>
          <div className="chem-team-grid">
            {view.teams.map((team) => (
              <article key={team.teamKey} className="edc-card">
                <strong>
                  {team.teamNumber ?? team.teamKey}
                  {team.nickname ? ` · ${team.nickname}` : ""}
                </strong>
                <p className="edc-muted">
                  EPA {team.epaTotal != null ? Math.round(team.epaTotal * 10) / 10 : "—"}
                  {team.source ? ` · ${team.source}` : ""}
                </p>
                <p className="edc-muted">
                  Scout n={team.scoutSample}
                  {team.reliability != null ? ` · reliability ${Math.round(team.reliability)}%` : ""}
                  {team.foulRate != null ? ` · fouls ~${Math.round(team.foulRate * 10) / 10}` : ""}
                </p>
                {team.archetypes.length ? (
                  <div className="edc-tags">
                    {team.archetypes.map((a) => (
                      <span key={a}>{a}</span>
                    ))}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {view?.suggestions.length ? (
        <section className="chem-suggest">
          <h2>Try high-EPA seats</h2>
          <p className="edc-muted">Not a pick list — event metrics you can add to the scorer.</p>
          <ul className="edc-queue">
            {view.suggestions.map((s) => (
              <li key={s.teamKey}>
                <div>
                  <strong>{s.teamNumber ?? s.teamKey}</strong>
                  <span>{s.reason}</span>
                </div>
                <button
                  type="button"
                  className="edc-link"
                  onClick={() => {
                    const num = String(s.teamNumber ?? s.teamKey.replace(/^frc/i, ""));
                    const parts = draft
                      .split(/[,\s]+/)
                      .map((p) => p.trim())
                      .filter(Boolean);
                    if (!parts.includes(num) && parts.length < 3) {
                      const next = [...parts, num].join(", ");
                      setDraft(next);
                      void load(orgId, next);
                    }
                  }}
                >
                  Add
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
