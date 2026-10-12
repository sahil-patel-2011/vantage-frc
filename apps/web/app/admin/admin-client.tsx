"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Button, EmptyState, PageHeader, SoftBlockSkeleton, askConfirm } from "../../components/ui";
import { adminEmptyCopy, classifyAdminShell } from "../../lib/admin";
import {
  confirmationDetails,
  confirmationLines,
  ownerInviteExpired,
  type ProvisionConfirmation,
} from "../../lib/admin-analytics/provisioning";
import { Chevron, CreditMeter, ReauthHint, SidePanel, StatusPill, api, day, usd } from "./admin-console-kit";
import "./admin-flow.css";
import "./admin-console.css";

type Organization = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string | null;
  /** The latest owner invite's address, live or expired. */
  pendingOwnerEmail: string | null;
  pendingOwnerInviteExpiresAt: string | null;
  ownerInviteExpired?: boolean;
  memberCount?: number;
};

type TeamGift = {
  giftId: string;
  orgId: string;
  familyLabel: string;
  amountUsd: number;
  usedUsd: number;
  remainingUsd: number;
  status: "active" | "used_up" | "expired" | "revoked";
  refusedCalls: number;
  calls: number;
  expiresAt: string | null;
  grantedAt: string;
  note: string | null;
  byModel: Array<{ label: string; usedUsd: number; calls: number }>;
};

type CreditsPayload = {
  setupRequired: boolean;
  defaults: { amountUsd: number; family: string };
  families: Array<{ id: string; label: string; payable: boolean }>;
  gifts: TeamGift[];
};

/** Whether the owner is in, and if not, where their invite stands: what an admin checks here. */
function ownerLine(org: Organization): string {
  if (org.ownerEmail) return `Owner: ${org.ownerEmail}`;
  if (!org.pendingOwnerEmail) return "No owner yet";
  const expired = org.ownerInviteExpired || ownerInviteExpired(org.pendingOwnerInviteExpiresAt);
  const when = day(org.pendingOwnerInviteExpiresAt);
  return expired
    ? `Owner invite expired${when ? ` ${when}` : ""} · ${org.pendingOwnerEmail}`
    : `Owner invite sent to ${org.pendingOwnerEmail}${when ? `, until ${when}` : ""}`;
}

/** The form's name and web address follow the team number until someone types their own. */
function followNumber(form: { name: string; slug: string; teamNumber: string }, teamNumber: string) {
  const autoName = !form.name || form.name === `Team ${form.teamNumber}`;
  const autoSlug = !form.slug || form.slug === `team-${form.teamNumber}`;
  return {
    teamNumber,
    name: autoName ? (teamNumber ? `Team ${teamNumber}` : "") : form.name,
    slug: autoSlug ? (teamNumber ? `team-${teamNumber}` : "") : form.slug,
  };
}

async function copy(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// Add a team (opens in the side panel; one primary per view)
// ---------------------------------------------------------------------------------------------

function AddTeamPanel({
  open,
  onClose,
  initial,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  initial: { teamNumber: string; ownerEmail: string };
  onCreated: (confirmation: ProvisionConfirmation) => void;
}) {
  const [form, setForm] = useState({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmation, setConfirmation] = useState<ProvisionConfirmation | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setConfirmation(null);
    setCopied(false);
    setForm((current) => ({
      ...current,
      ...(initial.teamNumber ? followNumber(current, initial.teamNumber) : {}),
      ownerEmail: initial.ownerEmail || current.ownerEmail,
    }));
  }, [open, initial.teamNumber, initial.ownerEmail]);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    const slug = form.slug.trim() || (form.teamNumber ? `team-${form.teamNumber}` : "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setMessage("The web address (under Advanced) can only use lowercase letters, numbers and dashes.");
      return;
    }
    setBusy(true);
    const result = await api<ProvisionConfirmation>("/api/admin/organizations", {
      method: "POST",
      body: JSON.stringify({ ...form, slug, teamNumber: Number(form.teamNumber) }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage(result.error);
      return;
    }
    setConfirmation(result.data);
    setForm({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
    onCreated(result.data);
  }

  return (
    <SidePanel
      open={open}
      onClose={onClose}
      title={confirmation ? `${confirmation.name} (#${confirmation.teamNumber}) is ready` : "Add a team"}
      description={confirmation ? undefined : "Create the team and invite its owner by email. The owner then invites everyone else."}
    >
      {confirmation ? (
        <div className="ac-form">
          {confirmationLines(confirmation).map((line) => (
            <p key={line} className="ac-message">
              {line}
            </p>
          ))}
          {confirmation.owner.mode === "invited" && confirmation.owner.inviteUrl ? (
            <label>
              Owner invite link
              <input readOnly value={confirmation.owner.inviteUrl} onFocus={(event) => event.target.select()} />
              <small>Shown once. Lost it later? Make a new one from the team&rsquo;s panel.</small>
            </label>
          ) : null}
          <details>
            <summary data-disclosure>Details</summary>
            <ul className="ac-steps">
              {confirmationDetails(confirmation).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </details>
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={() => setConfirmation(null)}>
              Add another team
            </Button>
            {confirmation.owner.mode === "invited" && confirmation.owner.inviteUrl ? (
              <Button variant="primary" type="button" onClick={async () => setCopied(await copy(confirmation.owner.inviteUrl!))}>
                {copied ? "Copied" : "Copy invite link"}
              </Button>
            ) : (
              <Button variant="primary" type="button" onClick={onClose}>
                Done
              </Button>
            )}
          </div>
        </div>
      ) : (
        <form className="ac-form" onSubmit={create}>
          <label>
            Team number
            <input
              required
              type="number"
              inputMode="numeric"
              min={1}
              max={99999}
              value={form.teamNumber}
              onChange={(event) => setForm({ ...form, ...followNumber(form, event.target.value) })}
            />
          </label>
          <label>
            Team name
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Owner&rsquo;s email
            <input required type="email" value={form.ownerEmail} onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })} />
            <small>They get an invite by email. They don&rsquo;t need an account yet.</small>
          </label>
          <details>
            <summary data-disclosure>Advanced</summary>
            <label>
              Web address
              <input value={form.slug} onChange={(event) => setForm({ ...form, slug: event.target.value })} />
              <small>Lowercase letters, numbers and dashes. Filled in from the team number.</small>
            </label>
          </details>
          {message ? (
            <p className="ac-message" data-tone="error" role="alert">
              {message}
            </p>
          ) : null}
          <div className="ac-actions">
            <Button variant="secondary" type="button" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy}>
              {busy ? "Creating…" : "Create team & invite owner"}
            </Button>
          </div>
        </form>
      )}
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------------------------
// One team: facts and every action, in one place
// ---------------------------------------------------------------------------------------------

function TeamPanel({
  org,
  onClose,
  onChanged,
  onDeleted,
}: {
  org: Organization | null;
  onClose: () => void;
  onChanged: () => void;
  onDeleted: (org: Organization) => void;
}) {
  const [credits, setCredits] = useState<CreditsPayload | null>(null);
  const [creditsError, setCreditsError] = useState("");
  const [ownerLink, setOwnerLink] = useState<{ url?: string; note: string } | null>(null);
  const [gift, setGift] = useState({ family: "claude", amountUsd: "10", expiresAt: "", note: "" });
  const [giftOpen, setGiftOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; tone?: "error"; code?: string } | null>(null);

  const loadCredits = useCallback(async (orgId: string) => {
    setCreditsError("");
    const result = await api<CreditsPayload>(`/api/admin/ai-credits?orgId=${orgId}`);
    if (result.ok) setCredits(result.data);
    else setCreditsError(result.error);
  }, []);

  useEffect(() => {
    setCredits(null);
    setOwnerLink(null);
    setGiftOpen(false);
    setMessage(null);
    if (org) void loadCredits(org.id);
  }, [org, loadCredits]);

  if (!org) return <SidePanel open={false} onClose={onClose} title="">{null}</SidePanel>;

  const noOwner = !org.ownerEmail;
  const expired = org.ownerInviteExpired || ownerInviteExpired(org.pendingOwnerInviteExpiresAt);
  const gifts = credits?.gifts ?? [];
  const payable = (credits?.families ?? []).filter((family) => family.payable);

  async function newOwnerLink() {
    if (!org) return;
    if (!expired && org.pendingOwnerEmail) {
      const ok = await askConfirm({
        title: "Make a new owner link?",
        body: `The link already sent to ${org.pendingOwnerEmail} stops working.`,
        confirmLabel: "Make a new link",
        tone: "neutral",
      });
      if (!ok) return;
    }
    setBusy(true);
    const result = await api<{ inviteUrl?: string; emailSent?: boolean }>("/api/admin/organizations", {
      method: "PATCH",
      body: JSON.stringify({ action: "owner_link", orgId: org.id }),
    });
    setBusy(false);
    if (!result.ok || !result.data.inviteUrl) {
      setOwnerLink({ note: result.ok ? "Could not make a new link." : result.error });
      return;
    }
    const copied = await copy(result.data.inviteUrl);
    setOwnerLink({
      url: result.data.inviteUrl,
      note: `${copied ? "Copied a new owner link." : "New owner link below."} The earlier one no longer works.${result.data.emailSent ? " We emailed it too." : ""}`,
    });
    onChanged();
  }

  async function giveCredit(event: React.FormEvent) {
    event.preventDefault();
    if (!org) return;
    setBusy(true);
    setMessage(null);
    const result = await api<{ giftId: string; amountUsd: number }>("/api/admin/ai-credits", {
      method: "POST",
      body: JSON.stringify({
        orgId: org.id,
        family: gift.family,
        amountUsd: gift.amountUsd,
        expiresAt: gift.expiresAt || undefined,
        note: gift.note || undefined,
      }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    setMessage({ text: `Gave ${usd(result.data.amountUsd, false)} of AI credit. The owner and admins were told.` });
    setGiftOpen(false);
    setGift({ family: gift.family, amountUsd: "10", expiresAt: "", note: "" });
    await loadCredits(org.id);
  }

  async function endGift(entry: TeamGift) {
    const ok = await askConfirm({
      title: `End ${usd(entry.amountUsd, false)} of AI credit now?`,
      body: `Ask AI stops using it at once. ${usd(entry.usedUsd)} already used stays on the record, and the team is told.`,
      confirmLabel: "End credit",
      tone: "destructive",
    });
    if (!ok || !org) return;
    setBusy(true);
    const result = await api("/api/admin/ai-credits", { method: "DELETE", body: JSON.stringify({ giftId: entry.giftId }) });
    setBusy(false);
    setMessage(result.ok ? { text: "The credit has ended." } : { text: result.error, tone: "error", code: result.code });
    await loadCredits(org.id);
  }

  async function deleteTeam() {
    if (!org) return;
    const members = org.memberCount ?? 0;
    const ok = await askConfirm({
      title: `Delete ${org.name} (#${org.teamNumber})?`,
      body:
        members > 0
          ? `This deletes the team and everything in it for its ${members} ${members === 1 ? "member" : "members"}, who each get a note that it's gone. Their accounts stay. It can't be undone.`
          : "This team has nobody on it yet. Deleting it removes the team, its owner invite and its starter settings. It can't be undone.",
      confirmLabel: "Delete team",
      tone: "critical",
      confirmPhrase: String(org.teamNumber),
    });
    if (!ok) return;
    setBusy(true);
    const result = await api("/api/admin/organizations", {
      method: "DELETE",
      body: JSON.stringify({ orgId: org.id, confirm: String(org.teamNumber) }),
    });
    setBusy(false);
    if (!result.ok) {
      setMessage({ text: result.error, tone: "error", code: result.code });
      return;
    }
    onDeleted(org);
  }

  return (
    <SidePanel open onClose={onClose} title={`#${org.teamNumber} · ${org.name}`} description={ownerLine(org)}>
      <dl className="ac-facts">
        <dt>Members</dt>
        <dd>{org.memberCount ?? "–"}</dd>
        <dt>Web address</dt>
        <dd>{org.slug}</dd>
        <dt>Owner</dt>
        <dd>{org.ownerEmail ?? (org.pendingOwnerEmail ? `Invited: ${org.pendingOwnerEmail}${expired ? " (expired)" : ""}` : "Nobody yet")}</dd>
      </dl>

      {noOwner ? (
        <section className="ac-panel-section" aria-label="Owner invite">
          <h3>Owner invite</h3>
          <p className="ac-message ac-muted">
            {org.pendingOwnerEmail
              ? expired
                ? "The invite expired. Make a new link and send it to the owner."
                : "Lost the link? Make a new one; the old one stops working."
              : "No owner was invited. Delete the team and add it again with the owner's email."}
          </p>
          {org.pendingOwnerEmail ? (
            <div>
              <Button variant="secondary" type="button" disabled={busy} onClick={() => void newOwnerLink()}>
                Make a new owner link
              </Button>
            </div>
          ) : null}
          {ownerLink ? (
            <div className="ac-form" role="status">
              <p className="ac-message">{ownerLink.note}</p>
              {ownerLink.url ? (
                <label>
                  New owner invite link
                  <input readOnly value={ownerLink.url} onFocus={(event) => event.target.select()} />
                </label>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="ac-panel-section" aria-label="AI credit">
        <h3>AI credit</h3>
        {creditsError ? <p className="ac-message" data-tone="error">{creditsError}</p> : null}
        {!credits && !creditsError ? <p className="ac-message ac-muted">Loading…</p> : null}
        {credits?.setupRequired ? <p className="ac-message ac-muted">AI credit needs database migration 0727.</p> : null}
        {gifts.length ? (
          <ul className="ac-list">
            {gifts.map((entry) => (
              <li key={entry.giftId} className="ac-item">
                <div className="ac-row-main">
                  <strong>
                    {usd(entry.amountUsd, false)} · {entry.familyLabel}
                  </strong>
                  <CreditMeter used={entry.usedUsd} total={entry.amountUsd} label={`${entry.familyLabel} credit`} />
                  <small>
                    {entry.calls} answers{entry.refusedCalls ? ` · ${entry.refusedCalls} stopped at the cap` : ""}
                    {entry.byModel.length ? ` · ${entry.byModel.map((m) => `${m.label} ${usd(m.usedUsd)}`).join(", ")}` : ""}
                    {entry.expiresAt ? ` · ends ${day(entry.expiresAt)}` : ""}
                  </small>
                </div>
                <div className="ac-item-actions">
                  <StatusPill status={entry.status} />
                  {entry.status === "active" || entry.status === "used_up" ? (
                    <Button variant="ghost" size="sm" type="button" className="admin-org-delete" disabled={busy} onClick={() => void endGift(entry)}>
                      End…
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        ) : credits && !credits.setupRequired ? (
          <p className="ac-message ac-muted">No AI credit from Vantage. The team uses its own keys.</p>
        ) : null}

        {credits && !credits.setupRequired ? (
          giftOpen ? (
            <form className="ac-form" onSubmit={giveCredit}>
              <div className="ac-form-row">
                <label>
                  Amount (USD)
                  <input
                    required
                    type="number"
                    inputMode="decimal"
                    min={0.01}
                    max={1000}
                    step={0.01}
                    value={gift.amountUsd}
                    onChange={(event) => setGift({ ...gift, amountUsd: event.target.value })}
                  />
                </label>
                <label>
                  For
                  <select value={gift.family} onChange={(event) => setGift({ ...gift, family: event.target.value })}>
                    {credits.families.map((family) => (
                      <option key={family.id} value={family.id} disabled={!family.payable}>
                        {family.label}
                        {family.payable ? "" : " (no key)"}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label>
                Ends (optional)
                <input type="date" value={gift.expiresAt} onChange={(event) => setGift({ ...gift, expiresAt: event.target.value })} />
              </label>
              <label>
                Note to the team (optional)
                <input maxLength={280} value={gift.note} onChange={(event) => setGift({ ...gift, note: event.target.value })} placeholder="Good luck at your first regional!" />
              </label>
              <small className="ac-muted">
                Paid from your keys under AI credits. It stops at the amount: the team is never billed, and the owner and admins are told.
              </small>
              <div className="ac-actions">
                <Button variant="secondary" type="button" onClick={() => setGiftOpen(false)}>
                  Cancel
                </Button>
                <Button variant="primary" type="submit" disabled={busy || !payable.length}>
                  {busy ? "Giving…" : `Give ${gift.amountUsd ? `$${gift.amountUsd}` : "credit"}`}
                </Button>
              </div>
            </form>
          ) : (
            <div>
              <Button variant="secondary" type="button" onClick={() => setGiftOpen(true)} disabled={!payable.length}>
                Give AI credit
              </Button>
              {!payable.length ? (
                <p className="ac-message ac-muted ac-small">
                  Add a key under <a href="/admin/ai-credits">AI credits</a> first: it pays for the credit.
                </p>
              ) : null}
            </div>
          )
        ) : null}
        {message ? (
          <p className="ac-message" data-tone={message.tone} role="status">
            {message.text} <ReauthHint code={message.code} />
          </p>
        ) : null}
      </section>

      <section className="ac-panel-section" aria-label="Delete team">
        <h3>Delete team</h3>
        <p className="ac-message ac-muted">For a team made by mistake, or one whose owner never joined.</p>
        <div>
          <Button variant="danger" type="button" disabled={busy} onClick={() => void deleteTeam()}>
            Delete team…
          </Button>
        </div>
      </section>
    </SidePanel>
  );
}

// ---------------------------------------------------------------------------------------------
// The page
// ---------------------------------------------------------------------------------------------

function AdminClientInner() {
  const searchParams = useSearchParams();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [teamQuery, setTeamQuery] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState({ teamNumber: "", ownerEmail: "" });

  useEffect(() => {
    const ownerEmail = searchParams.get("ownerEmail")?.trim() ?? "";
    const teamNumber = searchParams.get("teamNumber")?.trim() ?? "";
    // From the waitlist's "Find team": the list opens filtered to that number.
    const find = searchParams.get("find")?.trim() ?? "";
    if (find) setTeamQuery(find);
    // From the Overview: open that team's panel.
    const team = searchParams.get("team")?.trim() ?? "";
    if (team) setOpenId(team);
    if (ownerEmail || teamNumber) {
      // From the waitlist's "Provision team": the add panel opens filled in.
      setPrefill({ ownerEmail, teamNumber });
      setAdding(true);
    }
  }, [searchParams]);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/organizations");
      const data = (await response.json()) as { organizations?: Organization[]; error?: string };
      setStatus(response.status);
      if (!response.ok) {
        setOrganizations([]);
        setLoadError(data.error ?? "Could not load teams.");
        return;
      }
      setOrganizations(Array.isArray(data.organizations) ? data.organizations : []);
    } catch {
      setStatus(null);
      setOrganizations([]);
      setLoadError("No connection. Check your internet and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => {
    const q = teamQuery.trim().toLowerCase();
    return organizations.filter((org) =>
      !q || [String(org.teamNumber), org.name, org.ownerEmail ?? "", org.pendingOwnerEmail ?? ""].some((part) => part.toLowerCase().includes(q)),
    );
  }, [organizations, teamQuery]);

  const shell = classifyAdminShell({ loading, status, error: loadError, organizationCount: organizations.length });
  const copyText = adminEmptyCopy(shell, loadError);
  const open = organizations.find((org) => org.id === openId) ?? null;
  const waitingOnOwner = organizations.filter((org) => !org.ownerEmail).length;

  if (loading && organizations.length === 0) {
    return (
      <main className="module-page admin-control ac-page" aria-busy="true">
        <PageHeader title="Teams" />
        <SoftBlockSkeleton />
      </main>
    );
  }

  if (shell === "forbidden" || shell === "auth_required" || shell === "setup_required") {
    return (
      <main className="module-page admin-control ac-page">
        <PageHeader title="Teams" />
        <EmptyState soft title={copyText.title} description={copyText.description}>
          <Button variant="secondary" type="button" onClick={() => void load()}>
            Try again
          </Button>
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page admin-control ac-page">
      <PageHeader
        title="Teams"
        description={
          organizations.length
            ? `${organizations.length} team${organizations.length === 1 ? "" : "s"}${waitingOnOwner ? ` · ${waitingOnOwner} waiting for an owner` : ""}. Open a team for its owner invite, AI credit and delete.`
            : "Create each team and invite its owner by email."
        }
      >
        <Button variant="primary" type="button" onClick={() => setAdding(true)}>
          Add a team
        </Button>
      </PageHeader>

      {listMessage ? (
        <p role="status" className="ac-message">
          {listMessage}
        </p>
      ) : null}

      {organizations.length === 0 ? (
        <EmptyState soft title={copyText.title} description={copyText.description}>
          <Button as="a" variant="secondary" href="/admin/waitlist">
            Open the waitlist
          </Button>
        </EmptyState>
      ) : (
        <section className="ac-section" aria-label="Teams">
          {organizations.length > 6 || teamQuery ? (
            <div className="ac-form">
              <label>
                <span className="sr-only">Find a team</span>
                <input
                  type="search"
                  value={teamQuery}
                  onChange={(event) => setTeamQuery(event.target.value)}
                  placeholder="Find a team by number, name or owner"
                  aria-label="Find a team"
                />
              </label>
            </div>
          ) : null}
          {visible.length ? (
            <ul className="ac-list">
              {visible.map((org) => (
                <li key={org.id}>
                  <button type="button" className="ac-row" onClick={() => setOpenId(org.id)} aria-haspopup="dialog">
                    <span className="ac-row-badge">#{org.teamNumber}</span>
                    <span className="ac-row-main">
                      <strong>{org.name}</strong>
                      <small>{ownerLine(org)}</small>
                    </span>
                    <span className="ac-row-end">
                      {!org.ownerEmail ? <StatusPill status="degraded" label="No owner yet" /> : null}
                      <Chevron />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="ac-message ac-muted">No team matches &ldquo;{teamQuery}&rdquo;.</p>
          )}
        </section>
      )}

      <AddTeamPanel
        open={adding}
        onClose={() => setAdding(false)}
        initial={prefill}
        onCreated={() => void load()}
      />
      <TeamPanel
        org={open}
        onClose={() => setOpenId(null)}
        onChanged={() => void load()}
        onDeleted={(org) => {
          setOpenId(null);
          setListMessage(`${org.name} (#${org.teamNumber}) is deleted.`);
          void load();
        }}
      />
    </main>
  );
}

export default function AdminClient() {
  return (
    <Suspense
      fallback={
        <main className="module-page admin-control ac-page" aria-busy="true">
          <SoftBlockSkeleton />
        </main>
      }
    >
      <AdminClientInner />
    </Suspense>
  );
}
