"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, EmptyState, PageHeader, SoftBlockSkeleton, askConfirm } from "../../../components/ui";
import { Chevron, CreditMeter, ReauthHint, SidePanel, StatusPill, api, day, usd, when } from "../admin-console-kit";
import "../admin-console.css";

type Family = { id: "claude" | "openai" | "gemini"; label: string; models: string[]; payable: boolean };
type PoolKey = {
  id: string;
  family: Family["id"];
  provider: string;
  label: string;
  source: "env" | "vault";
  envName: string | null;
  configured: boolean;
  enabled: boolean;
  priority: number;
  lastUsedAt: string | null;
  degradedAt: string | null;
  degradedReason: string | null;
  usedUsd: number;
  calls: number;
};
type Gift = {
  giftId: string;
  orgId: string;
  teamNumber: number | null;
  teamName: string;
  family: Family["id"];
  familyLabel: string;
  amountUsd: number;
  usedUsd: number;
  remainingUsd: number;
  percentUsed: number;
  refusedCalls: number;
  calls: number;
  lastUsedAt: string | null;
  grantedAt: string;
  grantedByEmail: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
  note: string | null;
  status: "active" | "used_up" | "expired" | "revoked";
  byModel: Array<{ label: string; usedUsd: number; calls: number }>;
  byKey: Array<{ label: string; usedUsd: number; calls: number }>;
};
type Overview = {
  setupRequired: boolean;
  defaults: { amountUsd: number; maxUsd: number; family: Family["id"] };
  families: Family[];
  pool: { ready: boolean; keys: PoolKey[]; unlisted: Array<{ family: Family["id"]; name: string }> };
  gifts: Gift[];
  legacyPromo: { teamNumber: number; endsAt: string; active: boolean };
};
type Team = { id: string; name: string; teamNumber: number };

const PROVIDER_LABEL: Record<Family["id"], string> = { claude: "Anthropic (Claude)", openai: "OpenAI", gemini: "Google (Gemini)" };

function teamLabel(gift: { teamNumber: number | null; teamName: string }) {
  return gift.teamNumber != null ? `#${gift.teamNumber} · ${gift.teamName}` : gift.teamName;
}

function keyStatus(key: PoolKey): { status: string; label: string } {
  if (!key.enabled) return { status: "off", label: "Off" };
  if (!key.configured) return { status: "down", label: "Not set here" };
  if (key.degradedAt) return { status: "degraded", label: "Failing" };
  return { status: "healthy", label: key.lastUsedAt ? "Working" : "Not used yet" };
}

// ---------------------------------------------------------------------------------------------
// Give credit
// ---------------------------------------------------------------------------------------------

function GivePanel({
  open,
  onClose,
  overview,
  teams,
  initialOrgId,
  onGiven,
}: {
  open: boolean;
  onClose: () => void;
  overview: Overview;
  teams: Team[];
  initialOrgId: string;
  onGiven: (text: string) => void;
}) {
  const firstPayable = overview.families.find((family) => family.payable)?.id ?? overview.defaults.family;
  const [form, setForm] = useState({ orgId: "", family: firstPayable as string, amountUsd: String(overview.defaults.amountUsd), expiresAt: "", note: "" });
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) {
      setError(null);
      setForm((current) => ({ ...current, orgId: initialOrgId || current.orgId, family: firstPayable }));
    }
  }, [open, initialOrgId, firstPayable]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    const result = await api<{ amountUsd: number }>("/api/admin/ai-credits", {
      method: "POST",
      body: JSON.stringify({
        orgId: form.orgId,
        family: form.family,
        amountUsd: form.amountUsd,
        expiresAt: form.expiresAt || undefined,
        note: form.note || undefined,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setError({ text: result.error, code: result.code });
      return;
    }
    const team = teams.find((t) => t.id === form.orgId);
    onGiven(`Gave ${team ? `Team ${team.teamNumber}` : "the team"} ${usd(result.data.amountUsd, false)} of AI credit. Its owner and admins were told.`);
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title="Give AI credit"
      description="The team's Ask AI uses it automatically, paid from your keys below. It stops at the amount, so the team is never billed."
    >
      <form className="ac-form" onSubmit={submit}>
        <label>
          Team
          <select required value={form.orgId} onChange={(event) => setForm({ ...form, orgId: event.target.value })}>
            <option value="">Choose a team</option>
            {teams.map((team) => (
              <option key={team.id} value={team.id}>
                #{team.teamNumber} · {team.name}
              </option>
            ))}
          </select>
        </label>
        <div className="ac-form-row">
          <label>
            Amount (USD)
            <input
              required
              type="number"
              inputMode="decimal"
              min={0.01}
              max={overview.defaults.maxUsd}
              step={0.01}
              value={form.amountUsd}
              onChange={(event) => setForm({ ...form, amountUsd: event.target.value })}
            />
          </label>
          <label>
            For
            <select value={form.family} onChange={(event) => setForm({ ...form, family: event.target.value })}>
              {overview.families.map((family) => (
                <option key={family.id} value={family.id} disabled={!family.payable}>
                  {family.label}
                  {family.payable ? "" : " (add a key first)"}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          Ends (optional)
          <input type="date" value={form.expiresAt} onChange={(event) => setForm({ ...form, expiresAt: event.target.value })} />
          <small>Leave empty to keep it until it&rsquo;s used up.</small>
        </label>
        <label>
          Note to the team (optional)
          <textarea maxLength={280} value={form.note} onChange={(event) => setForm({ ...form, note: event.target.value })} />
        </label>
        {error ? (
          <p className="ac-message" data-tone="error" role="alert">
            {error.text} <ReauthHint code={error.code} />
          </p>
        ) : null}
        <div className="ac-actions">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={busy || !form.orgId}>
            {busy ? "Giving…" : `Give $${form.amountUsd || "0"}`}
          </Button>
        </div>
      </form>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------------------------
// One gift
// ---------------------------------------------------------------------------------------------

function GiftPanel({ gift, onClose, onEnded }: { gift: Gift | null; onClose: () => void; onEnded: (text: string) => void }) {
  const [error, setError] = useState<{ text: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(null), [gift]);
  if (!gift) return null;

  async function end() {
    if (!gift) return;
    const ok = await askConfirm({
      title: `End ${teamLabel(gift)}'s AI credit now?`,
      body: `Ask AI stops using it at once. ${usd(gift.usedUsd)} already used stays on the record, and the team is told.`,
      confirmLabel: "End credit",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    const result = await api("/api/admin/ai-credits", { method: "DELETE", body: JSON.stringify({ giftId: gift.giftId }) });
    setBusy(false);
    if (!result.ok) setError({ text: result.error, code: result.code });
    else onEnded(`${teamLabel(gift)}'s AI credit has ended.`);
  }

  return (
    <SidePanel open onClose={onClose} title={teamLabel(gift)} description={`${usd(gift.amountUsd, false)} of ${gift.familyLabel}`}>
      <CreditMeter used={gift.usedUsd} total={gift.amountUsd} label="Credit used" />
      <dl className="ac-facts">
        <dt>Status</dt>
        <dd>
          <StatusPill status={gift.status} />
        </dd>
        <dt>Left</dt>
        <dd>{usd(gift.remainingUsd)}</dd>
        <dt>Answers</dt>
        <dd>{gift.calls}</dd>
        <dt>Stopped at cap</dt>
        <dd>{gift.refusedCalls}</dd>
        <dt>Given</dt>
        <dd>
          {day(gift.grantedAt)}
          {gift.grantedByEmail ? ` by ${gift.grantedByEmail}` : ""}
        </dd>
        <dt>Ends</dt>
        <dd>{gift.revokedAt ? `Ended ${day(gift.revokedAt)}` : gift.expiresAt ? day(gift.expiresAt) : "When it's used up"}</dd>
        {gift.lastUsedAt ? (
          <>
            <dt>Last used</dt>
            <dd>{when(gift.lastUsedAt)}</dd>
          </>
        ) : null}
        {gift.note ? (
          <>
            <dt>Note</dt>
            <dd>{gift.note}</dd>
          </>
        ) : null}
      </dl>
      <section className="ac-panel-section">
        <h3>By model</h3>
        {gift.byModel.length ? (
          <ul className="ac-steps">
            {gift.byModel.map((model) => (
              <li key={model.label}>
                {model.label}: {usd(model.usedUsd)} over {model.calls} answer{model.calls === 1 ? "" : "s"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-message ac-muted">Not used yet.</p>
        )}
      </section>
      {gift.byKey.length ? (
        <section className="ac-panel-section">
          <h3>Paid by</h3>
          <ul className="ac-steps">
            {gift.byKey.map((key) => (
              <li key={key.label}>
                {key.label}: {usd(key.usedUsd)}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {gift.status === "active" || gift.status === "used_up" ? (
        <section className="ac-panel-section">
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Close
            </Button>
            <Button variant="danger" type="button" disabled={busy} onClick={() => void end()}>
              End credit…
            </Button>
          </div>
          {error ? (
            <p className="ac-message" data-tone="error" role="alert">
              {error.text} <ReauthHint code={error.code} />
            </p>
          ) : null}
        </section>
      ) : null}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------------------------
// The operator's keys: one list, one "Add key".
// ---------------------------------------------------------------------------------------------

function KeyPool({ overview, onChanged }: { overview: Overview; onChanged: () => Promise<void> }) {
  const [form, setForm] = useState({ family: "claude" as Family["id"], label: "", mode: "paste" as "paste" | "env", secret: "", envName: "" });
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone?: "error"; code?: string } | null>(null);
  const keys = overview.pool.keys;

  async function change(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setMessage(null);
    const result = await api("/api/admin/ai-keys", { method: "PATCH", body: JSON.stringify({ id, ...body }) });
    setBusy(false);
    if (!result.ok) setMessage({ text: result.error, tone: "error", code: result.code });
    await onChanged();
  }

  async function remove(key: PoolKey) {
    const ok = await askConfirm({
      title: `Remove "${key.label}"?`,
      body: `AI credit stops using this ${PROVIDER_LABEL[key.family]} key. ${key.source === "vault" ? "The saved key is deleted from Vantage." : `${key.envName} stays in the deployment.`} Spend already recorded stays.`,
      confirmLabel: "Remove key",
      tone: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    setMessage(null);
    const result = await api("/api/admin/ai-keys", { method: "DELETE", body: JSON.stringify({ id: key.id }) });
    setBusy(false);
    setMessage(result.ok ? { text: `Removed "${key.label}".` } : { text: result.error, tone: "error", code: result.code });
    await onChanged();
  }

  async function add(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    const result = await api("/api/admin/ai-keys", {
      method: "POST",
      body: JSON.stringify({
        family: form.family,
        label: form.label,
        ...(form.mode === "env" ? { envName: form.envName } : { secret: form.secret }),
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    setMessage({ text: `Added "${form.label}". It's tried after the keys above it.` });
    setForm({ ...form, label: "", secret: "", envName: "" });
    setAdding(false);
    await onChanged();
  }

  const byFamily = (family: Family["id"]) => keys.filter((key) => key.family === family);

  return (
    <section className="ac-section" aria-labelledby="ac-keys">
      <div className="ac-section-head">
        <div>
          <h2 id="ac-keys">Keys that pay for AI credit</h2>
          <p>Your own provider keys. For each provider they&rsquo;re tried top to bottom; a key that is rate limited, failing or rejected hands over to the next.</p>
        </div>
        <Button variant="secondary" type="button" onClick={() => setAdding(true)}>
          Add key
        </Button>
      </div>

      {keys.length ? (
        <ul className="ac-list">
          {keys.map((key) => {
            const status = keyStatus(key);
            const siblings = byFamily(key.family);
            const index = siblings.findIndex((k) => k.id === key.id);
            return (
              <li key={key.id} className="ac-item">
                <span className="ac-row-badge" aria-label={`${PROVIDER_LABEL[key.family]} key ${index + 1} of ${siblings.length}`}>
                  {index + 1}
                </span>
                <div className="ac-row-main">
                  <strong>{key.label}</strong>
                  <small>
                    {PROVIDER_LABEL[key.family]} · {key.source === "env" ? key.envName : "saved key"}
                    {key.calls ? ` · ${usd(key.usedUsd)} over ${key.calls} answers` : ""}
                    {key.lastUsedAt ? ` · last used ${when(key.lastUsedAt)}` : ""}
                  </small>
                  {key.degradedReason ? <small>Last problem: {key.degradedReason} ({when(key.degradedAt)})</small> : null}
                  {!key.configured ? <small>{key.envName} isn&rsquo;t set on this deployment.</small> : null}
                </div>
                <div className="ac-item-actions">
                  <StatusPill status={status.status} label={status.label} />
                  <Button variant="ghost" size="sm" type="button" disabled={busy || index === 0} onClick={() => void change(key.id, { move: "up" })} aria-label={`Move ${key.label} up`}>
                    ↑
                  </Button>
                  <Button variant="ghost" size="sm" type="button" disabled={busy || index === siblings.length - 1} onClick={() => void change(key.id, { move: "down" })} aria-label={`Move ${key.label} down`}>
                    ↓
                  </Button>
                  <Button variant="secondary" size="sm" type="button" disabled={busy} onClick={() => void change(key.id, { enabled: !key.enabled })}>
                    {key.enabled ? "Turn off" : "Turn on"}
                  </Button>
                  <Button variant="ghost" size="sm" type="button" className="admin-org-delete" disabled={busy} onClick={() => void remove(key)}>
                    Remove…
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="ac-message ac-muted">No keys yet. Add one to give teams AI credit.</p>
      )}

      {overview.pool.unlisted.length ? (
        <p className="ac-table-note">
          Set on this deployment but not in your list: {overview.pool.unlisted.map((entry) => entry.name).join(", ")}. Add one with &ldquo;Use a deployment variable&rdquo;.
        </p>
      ) : null}

      <SidePanel
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a key"
        description="It goes to the bottom of that provider's list. Move it up to try it first."
      >
        <form className="ac-form" onSubmit={add}>
          <div className="ac-form-row">
            <label>
              Provider
              <select value={form.family} onChange={(event) => setForm({ ...form, family: event.target.value as Family["id"] })}>
                {overview.families.map((family) => (
                  <option key={family.id} value={family.id}>
                    {PROVIDER_LABEL[family.id]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Name
              <input required maxLength={80} value={form.label} onChange={(event) => setForm({ ...form, label: event.target.value })} placeholder="Main Anthropic key" />
            </label>
          </div>
          <label>
            Where the key is
            <select value={form.mode} onChange={(event) => setForm({ ...form, mode: event.target.value as "paste" | "env" })}>
              <option value="paste">Paste it here (saved encrypted)</option>
              <option value="env">Use a deployment variable</option>
            </select>
          </label>
          {form.mode === "paste" ? (
            <label>
              API key
              <input required type="password" autoComplete="off" spellCheck={false} value={form.secret} onChange={(event) => setForm({ ...form, secret: event.target.value })} />
              <small>Encrypted at rest and never shown again.</small>
            </label>
          ) : (
            <label>
              Variable name
              <input
                required
                list="ac-env-names"
                value={form.envName}
                onChange={(event) => setForm({ ...form, envName: event.target.value.toUpperCase() })}
                placeholder={form.family === "claude" ? "ANTHROPIC_API_KEY" : form.family === "openai" ? "OPENAI_API_KEY" : "GOOGLE_AI_API_KEY"}
              />
              <datalist id="ac-env-names">
                {overview.pool.unlisted.filter((entry) => entry.family === form.family).map((entry) => (
                  <option key={entry.name} value={entry.name} />
                ))}
              </datalist>
              <small>A provider key name, or one starting VANTAGE_GIFT_ for more than one.</small>
            </label>
          )}
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={() => setAdding(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Adding…" : "Add key"}
            </Button>
          </div>
          {message?.tone === "error" ? (
            <p className="ac-message" data-tone="error" role="alert">
              {message.text} <ReauthHint code={message.code} />
            </p>
          ) : null}
        </form>
      </SidePanel>

      {message ? (
        <p className="ac-message" data-tone={message.tone} role="status">
          {message.text} <ReauthHint code={message.code} />
        </p>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------------------------

function AiCreditsInner() {
  const searchParams = useSearchParams();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [teams, setTeams] = useState<Team[]>([]);
  const [error, setError] = useState("");
  const [giving, setGiving] = useState(false);
  const [openGiftId, setOpenGiftId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [showEnded, setShowEnded] = useState(false);
  const teamParam = searchParams.get("team") ?? "";

  const load = useCallback(async () => {
    const [credits, orgs] = await Promise.all([
      api<Overview>("/api/admin/ai-credits"),
      api<{ organizations: Team[] }>("/api/admin/organizations"),
    ]);
    if (credits.ok) setOverview(credits.data);
    else setError(credits.error);
    if (orgs.ok) setTeams([...(orgs.data.organizations ?? [])].sort((a, b) => a.teamNumber - b.teamNumber));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const gifts = useMemo(() => {
    const all = overview?.gifts ?? [];
    const scoped = teamParam ? all.filter((gift) => gift.orgId === teamParam) : all;
    return showEnded ? scoped : scoped.filter((gift) => gift.status === "active" || gift.status === "used_up");
  }, [overview, teamParam, showEnded]);
  const ended = (overview?.gifts ?? []).filter((gift) => gift.status === "expired" || gift.status === "revoked").length;

  if (error) {
    return (
      <main className="module-page admin-control ac-page">
        <PageHeader title="AI credits" />
        <EmptyState soft title="AI credit didn't load" description={error} />
      </main>
    );
  }
  if (!overview) {
    return (
      <main className="module-page admin-control ac-page" aria-busy="true">
        <PageHeader title="AI credits" />
        <SoftBlockSkeleton />
      </main>
    );
  }

  const totals = gifts.reduce((acc, gift) => ({ given: acc.given + gift.amountUsd, used: acc.used + gift.usedUsd }), { given: 0, used: 0 });
  const canGive = overview.families.some((family) => family.payable) && !overview.setupRequired;

  return (
    <main className="module-page admin-control ac-page">
      <PageHeader
        title="AI credits"
        description={
          overview.setupRequired
            ? "AI credit needs database migration 0727."
            : `Free AI you give a team, paid from your keys. Each gift stops at its amount.${gifts.length ? ` ${usd(totals.used)} of ${usd(totals.given)} used across ${gifts.length} gift${gifts.length === 1 ? "" : "s"}.` : ""}`
        }
      >
        <Button variant="primary" type="button" disabled={!canGive} onClick={() => setGiving(true)}>
          Give credit
        </Button>
      </PageHeader>

      {message ? (
        <p className="ac-message" role="status">
          {message}
        </p>
      ) : null}
      {!canGive && !overview.setupRequired ? (
        <p className="ac-message ac-muted">Add a key below first: it&rsquo;s what pays for the credit.</p>
      ) : null}

      <section className="ac-section" aria-labelledby="ac-gifts">
        <div className="ac-section-head">
          <h2 id="ac-gifts">{teamParam ? "This team's credit" : "Teams with credit"}</h2>
          {ended ? (
            <Button variant="ghost" size="sm" type="button" onClick={() => setShowEnded(!showEnded)}>
              {showEnded ? "Hide ended" : `Show ended (${ended})`}
            </Button>
          ) : null}
        </div>
        {gifts.length ? (
          <ul className="ac-list">
            {gifts.map((gift) => (
              <li key={gift.giftId}>
                <button type="button" className="ac-row" onClick={() => setOpenGiftId(gift.giftId)} aria-haspopup="dialog">
                  <span className="ac-row-main">
                    <strong>{teamLabel(gift)}</strong>
                    <small>
                      {gift.familyLabel}
                      {gift.refusedCalls ? ` · ${gift.refusedCalls} stopped at the cap` : ""}
                      {gift.expiresAt ? ` · ends ${day(gift.expiresAt)}` : ""}
                    </small>
                  </span>
                  <span className="ac-row-end">
                    <CreditMeter used={gift.usedUsd} total={gift.amountUsd} label={`${teamLabel(gift)} credit`} />
                    <StatusPill status={gift.status} />
                    <Chevron />
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="ac-message ac-muted">{teamParam ? "This team has no credit from Vantage." : "No team has AI credit from Vantage yet."}</p>
        )}
        {overview.legacyPromo.active ? (
          <p className="ac-table-note">
            Team {overview.legacyPromo.teamNumber} also has the earlier free promo on the sponsored model pool until {day(overview.legacyPromo.endsAt)}. It ends by itself.
          </p>
        ) : null}
      </section>

      <KeyPool overview={overview} onChanged={load} />

      <GivePanel
        open={giving}
        onClose={() => setGiving(false)}
        overview={overview}
        teams={teams}
        initialOrgId={teamParam}
        onGiven={(text) => {
          setGiving(false);
          setMessage(text);
          void load();
        }}
      />
      <GiftPanel
        gift={(overview.gifts ?? []).find((gift) => gift.giftId === openGiftId) ?? null}
        onClose={() => setOpenGiftId(null)}
        onEnded={(text) => {
          setOpenGiftId(null);
          setMessage(text);
          void load();
        }}
      />
    </main>
  );
}

export default function AiCreditsClient() {
  return (
    <Suspense fallback={<SoftBlockSkeleton />}>
      <AiCreditsInner />
    </Suspense>
  );
}
