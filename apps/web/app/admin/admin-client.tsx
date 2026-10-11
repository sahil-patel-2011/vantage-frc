"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, PageHeader, Panel, Button, askConfirm } from "../../components/ui";
import {
  adminEmptyCopy,
  adminNextActions,
  classifyAdminShell,
  formatAdminOrgLabel,
  type AdminShellKind,
} from "../../lib/admin";
import {
  confirmationDetails,
  confirmationLines,
  ownerInviteExpired,
  type ProvisionConfirmation,
} from "../../lib/admin-analytics/provisioning";
import { OutageContactsLine } from "./outage-contacts";
import "./admin-flow.css";

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

function shortDate(value: string | null | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Whether the owner is in, and if not, where their invite stands: what an admin checks here. */
function ownerLine(org: Organization): string {
  if (org.ownerEmail) return `Owner joined · ${org.ownerEmail}`;
  if (!org.pendingOwnerEmail) return "No owner yet";
  const expired = org.ownerInviteExpired || ownerInviteExpired(org.pendingOwnerInviteExpiresAt);
  const when = shortDate(org.pendingOwnerInviteExpiresAt);
  return expired
    ? `Owner invite expired${when ? ` ${when}` : ""} · ${org.pendingOwnerEmail}`
    : `Owner invite pending${when ? `, until ${when}` : ""} · ${org.pendingOwnerEmail}`;
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

function AdminNextActions({ kind }: { kind: AdminShellKind }) {
  const actions = adminNextActions(kind);
  if (actions.length === 0) return null;
  return (
    <section className="admin-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Each one opens the page where you finish the work.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <a className="edc-next-action" href={action.href}>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

function AdminClientInner() {
  const searchParams = useSearchParams();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<ProvisionConfirmation | null>(null);
  const [copied, setCopied] = useState(false);
  // A fresh owner link per team row, made on request (the first one is never stored).
  const [ownerLinks, setOwnerLinks] = useState<Record<string, { url?: string; note: string }>>({});
  const [confirmOwnerLink, setConfirmOwnerLink] = useState<string | null>(null);
  const [teamQuery, setTeamQuery] = useState("");
  const [listMessage, setListMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const ownerEmail = searchParams.get("ownerEmail")?.trim() ?? "";
    const teamNumber = searchParams.get("teamNumber")?.trim() ?? "";
    // From the waitlist's "Find team": the list opens filtered to that number.
    const find = searchParams.get("find")?.trim() ?? "";
    if (find) setTeamQuery(find);
    if (ownerEmail || teamNumber) {
      // From the waitlist's "Provision team": the name and web address follow the number exactly
      // as they do when the number is typed (QA A2-09: the name stayed empty).
      setForm((current) => ({
        ...current,
        ...(teamNumber ? followNumber(current, teamNumber) : {}),
        ownerEmail: ownerEmail || current.ownerEmail,
      }));
    }
  }, [searchParams]);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const response = await fetch("/api/admin/organizations");
      const data = (await response.json()) as {
        organizations?: Organization[];
        error?: string;
      };
      setStatus(response.status);
      if (!response.ok) {
        setOrganizations([]);
        setLoadError(data.error ?? "Could not load organizations.");
        return;
      }
      // Real organization rows only — never invent DEMO provisioned teams.
      setOrganizations(Array.isArray(data.organizations) ? data.organizations : []);
      setLoadError(null);
    } catch {
      setStatus(null);
      setOrganizations([]);
      setLoadError("Network error loading organizations.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function create(event: React.FormEvent) {
    event.preventDefault();
    // The web address sits folded under Advanced, where the browser cannot point at it, so
    // it is filled in and checked here rather than with required/pattern on the input.
    const slug = form.slug.trim() || (form.teamNumber ? `team-${form.teamNumber}` : "");
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      setMessage("The web address (under Advanced) can only use lowercase letters, numbers and dashes.");
      return;
    }
    const response = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, slug, teamNumber: Number(form.teamNumber) }),
    });
    const data = (await response.json()) as ProvisionConfirmation & { error?: string };
    if (!response.ok) {
      setMessage(data.error ?? "Create failed.");
      // "Team 6925 already has a team. Find it in the list": find it for them.
      if (response.status === 409 && form.teamNumber) setTeamQuery(form.teamNumber);
      return;
    }
    setMessage("");
    setCopied(false);
    setConfirmation(data);
    setForm({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
    await load();
  }

  async function newOwnerLink(orgId: string) {
    setOwnerLinks((current) => ({ ...current, [orgId]: { note: "Making a new link…" } }));
    const response = await fetch("/api/admin/organizations", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "owner_link", orgId }),
    });
    const data = (await response.json().catch(() => ({}))) as { inviteUrl?: string; emailSent?: boolean; error?: string };
    if (!response.ok || !data.inviteUrl) {
      setOwnerLinks((current) => ({ ...current, [orgId]: { note: data.error ?? "Could not make a new link." } }));
      return;
    }
    let copiedNow = false;
    try {
      await navigator.clipboard.writeText(data.inviteUrl);
      copiedNow = true;
    } catch {
      // Clipboard blocked: the link is shown to copy by hand.
    }
    setOwnerLinks((current) => ({
      ...current,
      [orgId]: {
        url: data.inviteUrl,
        note: `${copiedNow ? "Copied a new owner link." : "New owner link below."} The earlier one no longer works.${data.emailSent ? " We emailed it too." : ""}`,
      },
    }));
  }

  /** A team made by mistake, or one whose owner never joined: nobody else can delete it. */
  async function deleteOrg(org: Organization) {
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
    const response = await fetch("/api/admin/organizations", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId: org.id, confirm: String(org.teamNumber) }),
    }).catch(() => null);
    const data = response ? ((await response.json().catch(() => ({}))) as { error?: string }) : {};
    if (!response?.ok) {
      setListMessage(data.error ?? "The team wasn't deleted. Try again.");
      return;
    }
    setListMessage(`${org.name} (#${org.teamNumber}) is deleted.`);
    if (confirmation?.id === org.id) setConfirmation(null);
    await load();
  }

  async function copyInviteLink(url: string) {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const shell = classifyAdminShell({
    loading,
    status,
    error: loadError,
    organizationCount: organizations.length,
  });
  const copy = adminEmptyCopy(shell, loadError);
  const blocked = shell === "forbidden" || shell === "auth_required" || shell === "setup_required";

  if (loading) {
    return (
      <main className="module-page admin-control admin-flow-page">
        <EmptyState soft title={copy.title} description={copy.description} aria-busy />
      </main>
    );
  }

  if (blocked) {
    return (
      <main className="module-page admin-control admin-flow-page">
        <PageHeader breadcrumbs="Platform / Admin" title={copy.title} description={copy.description}>
          {copy.badge ? <span className="admin-shell-badge">{copy.badge}</span> : null}
        </PageHeader>
        <EmptyState soft title={copy.title} description={copy.description}>
          {shell === "setup_required" ? (
            <Button variant="secondary" type="button" onClick={() => void load()}>
              Retry
            </Button>
          ) : null}
        </EmptyState>
        <AdminNextActions kind={shell} />
      </main>
    );
  }

  return (
    <main className="module-page admin-control admin-flow-page">
      <PageHeader
        breadcrumbs="Platform admin / Teams"
        title="Platform admin"
        description="Create each team and invite its owner by email. The owner then invites everyone else."
      />
      {/* The count lives in the list heading ("Teams (27)"); alone in a full-width card it pushed
          Create a team down. The outage contact line sits under the list for the same reason. */}

      <section className="admin-grid">
        {confirmation ? (
          // In the form's place: one next step at a time, and one blue button on the page (the
          // form's "Create team" sat below this one's "Copy invite link"; QA A2-18).
          <Panel className="admin-provision-confirmation" aria-label="Team created">
            <span className="eyebrow">Team created</span>
            <h2>
              {confirmation.name} (#{confirmation.teamNumber}) is ready.
            </h2>
            {confirmationLines(confirmation).map((line) => (
              <p key={line}>{line}</p>
            ))}
            {confirmation.owner.mode === "invited" && confirmation.owner.inviteUrl ? (
              <div className="admin-invite-link">
                <label>
                  Owner invite link
                  <input readOnly value={confirmation.owner.inviteUrl} onFocus={(event) => event.target.select()} />
                </label>
                <Button variant="primary" type="button" onClick={() => void copyInviteLink(confirmation.owner.inviteUrl!)}>
                  {copied ? "Copied" : "Copy invite link"}
                </Button>
                <small className="app-muted">Lost it later? Make a new one from the team&rsquo;s row in the list.</small>
              </div>
            ) : null}
            <details className="admin-confirmation-details">
              <summary data-disclosure>Details</summary>
              <ul>
                {confirmationDetails(confirmation).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            </details>
            <div className="admin-confirmation-actions">
              <Button variant="secondary" type="button" onClick={() => setConfirmation(null)}>
                Create another team
              </Button>
            </div>
          </Panel>
        ) : (
        <Panel as="form" onSubmit={create}>
          <span className="eyebrow">Create a team</span>
          <label>
            Team number
            <input
              required
              type="number"
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
            <input
              required
              type="email"
              value={form.ownerEmail}
              onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })}
            />
            <small className="app-muted">They get an invite by email. They don&rsquo;t need an account yet.</small>
          </label>
          <details className="admin-advanced">
            <summary data-disclosure>Advanced</summary>
            <label>
              Web address
              <input
                value={form.slug}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
              />
              <small className="app-muted">Lowercase letters, numbers and dashes. Filled in from the team number.</small>
            </label>
          </details>
          <button className="primary-action" type="submit">
            Create team &amp; invite owner
          </button>
          {message ? <p className="auth-message">{message}</p> : null}
        </Panel>
        )}
        <Panel>
          <div className="admin-teams-head">
            <h2>Teams ({organizations.length})</h2>
            {/* Also shown while a search is in effect, so a filter set for the admin can be cleared. */}
            {organizations.length > 6 || teamQuery ? (
              <input
                type="search"
                value={teamQuery}
                onChange={(event) => setTeamQuery(event.target.value)}
                placeholder="Find a team by number, name or owner"
                aria-label="Find a team"
              />
            ) : null}
          </div>
          {listMessage ? <p role="status" className="admin-list-status">{listMessage}</p> : null}
          {shell === "empty" ? (
            <EmptyState soft title={copy.title} description={copy.description}>
              <Button as="a" variant="secondary" href="/admin/waitlist">
                Open waitlist
              </Button>
            </EmptyState>
          ) : (
            // The team just made comes first; then whatever matches the search.
            [...organizations]
              .sort((a, b) =>
                confirmation ? Number(b.teamNumber === confirmation.teamNumber) - Number(a.teamNumber === confirmation.teamNumber) : 0,
              )
              .filter((org) => {
                const q = teamQuery.trim().toLowerCase();
                if (!q) return true;
                return [String(org.teamNumber), org.name, org.ownerEmail ?? "", org.pendingOwnerEmail ?? ""].some((part) =>
                  part.toLowerCase().includes(q),
                );
              })
              .map((org) => (
              <article className="admin-org" key={org.id} title={formatAdminOrgLabel(org)}>
                <b>#{org.teamNumber}</b>
                <div>
                  <strong>{org.name}</strong>
                  {/* Whether the owner is in, not the web address: that is what an admin checks here. */}
                  <small>{ownerLine(org)}</small>
                  {ownerLinks[org.id] ? (
                    <small role="status" className="admin-owner-link">
                      {ownerLinks[org.id]!.note}
                      {/* A full-width field with its own Copy button: a 180px box cut the link off at
                          "invite?t" and there was no way to copy it but selecting by hand. */}
                      {ownerLinks[org.id]!.url ? (
                        <span className="admin-owner-link-row">
                          <input readOnly value={ownerLinks[org.id]!.url} onFocus={(event) => event.target.select()} aria-label="New owner invite link" />
                          <Button variant="secondary" size="sm" type="button" onClick={() => void copyInviteLink(ownerLinks[org.id]!.url!)}>
                            Copy
                          </Button>
                        </span>
                      ) : null}
                    </small>
                  ) : null}
                </div>
                <span className="admin-org-actions">
                  {org.pendingOwnerEmail && !org.ownerEmail ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      type="button"
                      className="admin-owner-link-btn"
                      onClick={() => {
                        // A new link stops a live one already sent working: a second tap says so
                        // first. An expired link already doesn't work, so one tap is enough.
                        const expired = org.ownerInviteExpired || ownerInviteExpired(org.pendingOwnerInviteExpiresAt);
                        if (!expired && confirmOwnerLink !== org.id) return setConfirmOwnerLink(org.id);
                        setConfirmOwnerLink(null);
                        void newOwnerLink(org.id);
                      }}
                    >
                      {confirmOwnerLink === org.id ? "Tap again to replace the old link" : "Get a new owner link"}
                    </Button>
                  ) : null}
                  <Button variant="ghost" size="sm" type="button" className="admin-org-delete" onClick={() => void deleteOrg(org)}>
                    Delete…
                  </Button>
                </span>
              </article>
            ))
          )}
          <OutageContactsLine />
        </Panel>
      </section>
    </main>
  );
}

export default function AdminClient() {
  return (
    <Suspense
      fallback={
        <main className="module-page admin-control admin-flow-page">
          <EmptyState soft title="Loading admin…" aria-busy />
        </main>
      }
    >
      <AdminClientInner />
    </Suspense>
  );
}
