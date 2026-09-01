"use client";

import { useCallback, useEffect, useState } from "react";

type Team = {
  id: string;
  name: string;
  teamNumber: number;
  tier: string | null;
  granted: string;
  spent: string;
  balance: string;
  onCreditPlan: boolean;
};

type Weight = { requestKind: string; credits: number; description: string };

type AccessGrant = {
  id: string;
  orgId: string;
  teamNumber: number;
  accessKind: string;
  startsAt: string;
  endsAt: string;
  revokedAt: string | null;
  note: string;
};

/** Every kind, so an existing row still renders with a readable name. */
const ACCESS_LABELS: Record<string, string> = {
  platform_relay: "Platform free relay",
  sponsored_pool: "Sponsored provider pool",
  hosted_platform: "Hosted platform keys",
};

/**
 * Only what the metering path honours. `sponsored_pool` is excluded on purpose: no
 * resolver reads it, so opening that window would look like it worked and change
 * nothing for the team.
 */
const GRANTABLE_KINDS = ["platform_relay", "hosted_platform"] as const;

const num = (value: unknown) => Number(value ?? 0).toLocaleString();

export default function AiGrantsClient() {
  const [teams, setTeams] = useState<Team[]>([]);
  const [weights, setWeights] = useState<Weight[]>([]);
  const [accessGrants, setAccessGrants] = useState<AccessGrant[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  const [selectedOrg, setSelectedOrg] = useState("");
  const [credits, setCredits] = useState("500");
  const [creditReason, setCreditReason] = useState("");
  const [creditExpiryDays, setCreditExpiryDays] = useState("");
  const [accessKind, setAccessKind] = useState("platform_relay");
  const [accessDays, setAccessDays] = useState("14");
  const [accessNote, setAccessNote] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/ai-grants");
      const data = await response.json();
      if (!response.ok) {
        setMessage(data.error ?? "Unable to load AI grants");
        setOk(false);
      } else {
        setTeams(data.teams ?? []);
        setWeights(data.weights ?? []);
        setAccessGrants(data.accessGrants ?? []);
        if (!selectedOrg && data.teams?.[0]) setSelectedOrg(data.teams[0].id);
      }
    } catch {
      setMessage("Could not reach the server.");
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, [selectedOrg]);

  // `load` is keyed on the selected team, so this also refetches when that changes.
  useEffect(() => {
    void load();
  }, [load]);

  async function post(body: Record<string, unknown>, successCopy: string) {
    const response = await fetch("/api/admin/ai-grants", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = await response.json();
    setOk(response.ok);
    setMessage(response.ok ? successCopy : (data.error ?? "Update failed"));
    if (response.ok) await load();
  }

  const selectedTeam = teams.find((team) => team.id === selectedOrg) ?? null;

  return (
    <main className="intel-app">
      <header className="intel-header">
        <div>
          <span className="eyebrow">VANTAGE / AI FUNDING</span>
          <h1>Request credits &amp; time-boxed AI access</h1>
          <p className="app-muted">
            Push AI request credits to one team, or open a temporary window onto a
            platform-owned model path. One request spends one credit at the base weight;
            an agent run spends more because it makes more model calls. A team with no
            grants is not on the credit plan and is never blocked by this budget — it
            uses its own keys.
          </p>
        </div>
        <a href="/admin/sponsored">Sponsored economics →</a>
      </header>

      {message && <p className={`telemetry-status${ok ? " success" : ""}`}>{message}</p>}
      {loading && <p className="app-muted">Loading AI grants…</p>}

      {!loading && !teams.length && (
        <section className="intel-panel">
          <span className="eyebrow">NO TEAMS YET</span>
          <p className="app-muted">
            No workspaces exist to fund. Provision a team on the{" "}
            <a href="/admin">Global Team Manager</a> first.
          </p>
        </section>
      )}

      {!loading && teams.length > 0 && (
        <>
          <section className="intel-panel">
            <span className="eyebrow">CREDIT WEIGHTS</span>
            <p className="app-muted" style={{ marginTop: "0.5rem" }}>
              What one call of each kind costs. Editable here so the chat-versus-agentic
              ratio can change without a deploy.
            </p>
            <div className="metric-grid" style={{ marginTop: "1rem" }}>
              {weights.map((weight) => (
                <article key={weight.requestKind}>
                  <span>{weight.requestKind}</span>
                  <strong>{weight.credits}</strong>
                  <small className="app-muted">{weight.description}</small>
                  <div className="intel-actions" style={{ marginTop: "0.5rem" }}>
                    <input
                      aria-label={`Credits for ${weight.requestKind}`}
                      defaultValue={weight.credits}
                      inputMode="numeric"
                      style={{ width: "5rem" }}
                      onBlur={(event) => {
                        const next = Number(event.target.value);
                        if (!Number.isInteger(next) || next === weight.credits) return;
                        void post(
                          {
                            action: "set_weight",
                            requestKind: weight.requestKind,
                            credits: next,
                          },
                          `${weight.requestKind} now costs ${next} credit(s).`,
                        );
                      }}
                    />
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">TEAM BALANCES</span>
            {teams.map((team) => (
              <article
                className="admin-org"
                key={team.id}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                  gap: "12px",
                }}
              >
                <div>
                  <strong>
                    #{team.teamNumber} {team.name}
                  </strong>
                  <small>
                    {team.tier ?? "no billing row"} ·{" "}
                    {team.onCreditPlan
                      ? `${num(team.granted)} granted, ${num(team.spent)} spent`
                      : "not on the credit plan (uses its own keys)"}
                  </small>
                </div>
                <b style={{ color: Number(team.balance) > 0 ? "#16d9e8" : undefined }}>
                  {team.onCreditPlan ? `${num(team.balance)} left` : "—"}
                </b>
              </article>
            ))}
          </section>

          <section className="admin-grid" style={{ marginTop: "1.5rem" }}>
            <section className="intel-panel">
              <span className="eyebrow">PUSH REQUEST CREDITS</span>
              <label style={{ display: "block", marginTop: "0.75rem" }}>
                Team
                <select
                  value={selectedOrg}
                  onChange={(event) => setSelectedOrg(event.target.value)}
                >
                  {teams.map((team) => (
                    <option key={team.id} value={team.id}>
                      #{team.teamNumber} {team.name}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginTop: "0.5rem" }}>
                Credits
                <input
                  value={credits}
                  inputMode="numeric"
                  onChange={(event) => setCredits(event.target.value)}
                />
              </label>
              <label style={{ display: "block", marginTop: "0.5rem" }}>
                Expires in days (blank = never)
                <input
                  value={creditExpiryDays}
                  inputMode="numeric"
                  onChange={(event) => setCreditExpiryDays(event.target.value)}
                />
              </label>
              <label style={{ display: "block", marginTop: "0.5rem" }}>
                Reason
                <input
                  value={creditReason}
                  onChange={(event) => setCreditReason(event.target.value)}
                  placeholder="Beta thank-you"
                />
              </label>
              <div className="intel-actions" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  disabled={!selectedOrg || !Number(credits)}
                  onClick={() =>
                    void post(
                      {
                        action: "grant_credits",
                        orgId: selectedOrg,
                        credits: Number(credits),
                        reason: creditReason,
                        expiresInDays: creditExpiryDays ? Number(creditExpiryDays) : undefined,
                      },
                      `Granted ${num(credits)} credits to ${
                        selectedTeam ? `#${selectedTeam.teamNumber}` : "the team"
                      }.`,
                    )
                  }
                >
                  Grant credits
                </button>
              </div>
            </section>

            <section className="intel-panel">
              <span className="eyebrow">OPEN A TIME-BOXED AI WINDOW</span>
              <p className="app-muted" style={{ marginTop: "0.5rem" }}>
                Lets this team run on a platform-owned model path until the window closes.
                Their own keys still win when configured.
              </p>
              <label style={{ display: "block", marginTop: "0.75rem" }}>
                Path
                <select
                  value={accessKind}
                  onChange={(event) => setAccessKind(event.target.value)}
                >
                  {GRANTABLE_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {ACCESS_LABELS[value]}
                    </option>
                  ))}
                </select>
              </label>
              <label style={{ display: "block", marginTop: "0.5rem" }}>
                Days
                <input
                  value={accessDays}
                  inputMode="numeric"
                  onChange={(event) => setAccessDays(event.target.value)}
                />
              </label>
              <label style={{ display: "block", marginTop: "0.5rem" }}>
                Note
                <input
                  value={accessNote}
                  onChange={(event) => setAccessNote(event.target.value)}
                  placeholder="Champs week trial"
                />
              </label>
              <div className="intel-actions" style={{ marginTop: "1rem" }}>
                <button
                  type="button"
                  disabled={!selectedOrg || !Number(accessDays)}
                  onClick={() =>
                    void post(
                      {
                        action: "grant_access",
                        orgId: selectedOrg,
                        accessKind,
                        days: Number(accessDays),
                        note: accessNote,
                      },
                      `${ACCESS_LABELS[accessKind]} opened for ${accessDays} days.`,
                    )
                  }
                >
                  Open window
                </button>
              </div>
            </section>
          </section>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">AI ACCESS WINDOWS</span>
            {!accessGrants.length && (
              <p className="app-muted">No team has been granted a platform AI path yet.</p>
            )}
            {accessGrants.map((grant) => {
              const active = !grant.revokedAt && new Date(grant.endsAt) > new Date();
              return (
                <article
                  className="admin-org"
                  key={grant.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "baseline",
                    gap: "12px",
                  }}
                >
                  <div>
                    <strong style={{ color: active ? "#16d9e8" : "#ffb936" }}>
                      #{grant.teamNumber} · {ACCESS_LABELS[grant.accessKind] ?? grant.accessKind}
                    </strong>
                    <small>
                      {grant.revokedAt
                        ? `revoked ${new Date(grant.revokedAt).toLocaleDateString()}`
                        : `${active ? "ends" : "ended"} ${new Date(grant.endsAt).toLocaleString()}`}
                      {grant.note ? ` · ${grant.note}` : ""}
                    </small>
                  </div>
                  {active && (
                    <button
                      type="button"
                      className="danger-action"
                      onClick={() =>
                        void post(
                          { action: "revoke_access", grantId: grant.id },
                          "Access window revoked.",
                        )
                      }
                    >
                      Revoke
                    </button>
                  )}
                </article>
              );
            })}
          </section>
        </>
      )}
    </main>
  );
}
