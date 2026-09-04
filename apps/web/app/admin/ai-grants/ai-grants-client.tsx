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

type RelayStatus = {
  configured: boolean;
  model: string | null;
  models: Array<{ id: string; slug: string; label: string }>;
  refusal: string | null;
};

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

type TokenBalance = {
  orgId: string;
  source: "freebuff" | "hosted_platform" | "credits";
  granted: string | number;
  spent: string | number;
  balance: string | number;
};

const TOKEN_SOURCES = [
  { id: "freebuff", label: "Freebuff (team sees free tokens only)" },
  { id: "hosted_platform", label: "Hosted platform keys" },
  { id: "credits", label: "Request credits" },
] as const;

const TOKEN_PRESETS = [10_000, 50_000, 100_000, 250_000, 1_000_000] as const;

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
  const [tokenBalances, setTokenBalances] = useState<TokenBalance[]>([]);
  const [relay, setRelay] = useState<RelayStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  const [selectedOrg, setSelectedOrg] = useState("");
  const [giftSource, setGiftSource] = useState<(typeof TOKEN_SOURCES)[number]["id"]>("freebuff");
  const [giftTokens, setGiftTokens] = useState("100000");
  const [giftReason, setGiftReason] = useState("");
  const [giftExpiryDays, setGiftExpiryDays] = useState("");
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
        setTokenBalances(data.tokenBalances ?? []);
        setRelay(data.relay ?? null);
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
          <h1>Gift tokens &amp; time-boxed AI access</h1>
          <p className="app-muted">
            Gift a chosen amount from Freebuff, hosted keys, or request credits. A
            Freebuff gift shows the team only that they have more free tokens — never
            credits. Each team keeps its own chat, memory, and coding folder.
          </p>
        </div>
        <a href="/admin/free-relay">Manage Pis →</a>
      </header>

      {message && <p className={`telemetry-status${ok ? " success" : ""}`}>{message}</p>}
      {loading && <p className="app-muted">Loading AI grants…</p>}

      {relay ? (
        <section className="intel-panel" style={{ marginTop: "1rem" }}>
          <span className="eyebrow">PI / FREEBUFF ROUTE</span>
          <p className="app-muted" style={{ marginTop: "0.5rem" }}>
            {relay.configured
              ? `Relay is configured. Default is ${relay.model ?? "deepseek/deepseek-v4-flash"}. Teams pick DeepSeek V4 Flash (free, unlimited, fast), GLM 5.3 Flash, or MiMo 2.5.`
              : relay.refusal ?? "Free relay is not configured on this deployment."}
          </p>
          <small className="app-muted">
            Models: {relay.models.map((model) => `${model.label} (${model.slug})`).join(" · ")}
          </small>
        </section>
      ) : null}

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
            {teams.map((team) => {
              const tokens = tokenBalances.filter((row) => row.orgId === team.id);
              const freebuff = tokens.find((row) => row.source === "freebuff");
              const hosted = tokens.find((row) => row.source === "hosted_platform");
              return (
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
                    {freebuff
                      ? `${num(freebuff.balance)} Freebuff free tokens`
                      : hosted
                        ? `${num(hosted.balance)} hosted free tokens`
                        : team.onCreditPlan
                          ? `${num(team.granted)} granted, ${num(team.spent)} spent`
                          : "not on a gift plan (uses its own keys)"}
                  </small>
                </div>
                <b style={{ color: Number(freebuff?.balance ?? hosted?.balance ?? team.balance) > 0 ? "#16d9e8" : undefined }}>
                  {freebuff
                    ? `${num(freebuff.balance)} free tokens`
                    : hosted
                      ? `${num(hosted.balance)} free tokens`
                      : team.onCreditPlan
                        ? `${num(team.balance)} left`
                        : "—"}
                </b>
              </article>
              );
            })}
          </section>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">GIFT TOKENS</span>
            <p className="app-muted" style={{ marginTop: "0.5rem" }}>
              Choose the source and the amount. Freebuff gifts open the Pi relay for
              that team and show them only &ldquo;you have more free tokens.&rdquo;
            </p>
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
              Source
              <select
                value={giftSource}
                onChange={(event) =>
                  setGiftSource(event.target.value as (typeof TOKEN_SOURCES)[number]["id"])
                }
              >
                {TOKEN_SOURCES.map((source) => (
                  <option key={source.id} value={source.id}>
                    {source.label}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ display: "block", marginTop: "0.5rem" }}>
              Tokens
              <input
                value={giftTokens}
                inputMode="numeric"
                onChange={(event) => setGiftTokens(event.target.value)}
              />
            </label>
            <div className="intel-actions" style={{ marginTop: "0.5rem", flexWrap: "wrap" }}>
              {TOKEN_PRESETS.map((amount) => (
                <button
                  key={amount}
                  type="button"
                  onClick={() => setGiftTokens(String(amount))}
                >
                  {num(amount)}
                </button>
              ))}
            </div>
            <label style={{ display: "block", marginTop: "0.5rem" }}>
              Expires in days (blank = never)
              <input
                value={giftExpiryDays}
                inputMode="numeric"
                onChange={(event) => setGiftExpiryDays(event.target.value)}
              />
            </label>
            <label style={{ display: "block", marginTop: "0.5rem" }}>
              Reason
              <input
                value={giftReason}
                onChange={(event) => setGiftReason(event.target.value)}
                placeholder="Kickoff week gift"
              />
            </label>
            <div className="intel-actions" style={{ marginTop: "1rem" }}>
              <button
                type="button"
                disabled={!selectedOrg || !Number(giftTokens)}
                onClick={() =>
                  void post(
                    {
                      action: "gift_tokens",
                      orgId: selectedOrg,
                      source: giftSource,
                      tokens: Number(giftTokens),
                      reason: giftReason,
                      expiresInDays: giftExpiryDays ? Number(giftExpiryDays) : undefined,
                    },
                    giftSource === "freebuff"
                      ? `Gifted ${num(giftTokens)} free tokens to ${
                          selectedTeam ? `#${selectedTeam.teamNumber}` : "the team"
                        }. They will only see free tokens.`
                      : giftSource === "credits"
                        ? `Gifted ${num(giftTokens)} request credits to ${
                            selectedTeam ? `#${selectedTeam.teamNumber}` : "the team"
                          }.`
                        : `Gifted ${num(giftTokens)} hosted free tokens to ${
                            selectedTeam ? `#${selectedTeam.teamNumber}` : "the team"
                          }.`,
                  )
                }
              >
                Gift tokens
              </button>
            </div>
          </section>

          <section className="intel-panel" style={{ marginTop: "1.5rem" }}>
            <span className="eyebrow">FREE AI FOR A TEAM</span>
            <p className="app-muted" style={{ marginTop: "0.5rem" }}>
              Only teams you select get Freebuff Coder UI (platform Pi{" "}
              <strong>frcvantagefreebuff relay</strong>, or their own Pi). Each team is a
              separate coding folder. Everyone else stays on their API keys or the credits
              you include. None / 100 requests / unlimited.
            </p>
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
            <div className="intel-actions" style={{ marginTop: "1rem", flexWrap: "wrap" }}>
              <button
                type="button"
                disabled={!selectedOrg}
                onClick={() =>
                  void post(
                    { action: "set_free_ai", orgId: selectedOrg, preset: "none" },
                    "Free AI revoked for that team.",
                  )
                }
              >
                None
              </button>
              <button
                type="button"
                disabled={!selectedOrg}
                onClick={() =>
                  void post(
                    { action: "set_free_ai", orgId: selectedOrg, preset: "credits_100" },
                    "100 request credits and a year of Free AI opened.",
                  )
                }
              >
                100 requests
              </button>
              <button
                type="button"
                disabled={!selectedOrg}
                onClick={() =>
                  void post(
                    { action: "set_free_ai", orgId: selectedOrg, preset: "unlimited" },
                    "Unlimited Free AI opened for a year.",
                  )
                }
              >
                Unlimited
              </button>
            </div>
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
