"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, PageHeader, Panel, Button } from "../../components/ui";
import { KitCard, KitStats } from "../../components/ui/kit";
import {
  adminEmptyCopy,
  adminNextActions,
  adminOrgMetric,
  classifyAdminShell,
  formatAdminOrgLabel,
  type AdminShellKind,
} from "../../lib/admin";
import {
  confirmationDetails,
  confirmationLines,
  type ProvisionConfirmation,
} from "../../lib/admin-analytics/provisioning";
import "./admin-flow.css";

type Organization = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string | null;
  pendingOwnerEmail: string | null;
  pendingOwnerInviteExpiresAt: string | null;
};

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
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<number | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    const ownerEmail = searchParams.get("ownerEmail")?.trim() ?? "";
    const teamNumber = searchParams.get("teamNumber")?.trim() ?? "";
    if (ownerEmail || teamNumber) {
      setForm((current) => ({
        ...current,
        ownerEmail: ownerEmail || current.ownerEmail,
        teamNumber: teamNumber || current.teamNumber,
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

      {/* One card, three numbers, each in its own colour. People come back to
          this page for the count and read the captions once, ever — so the
          number is the large thing and the caption is the small one. */}
      {/* One number. "Closed / Membership" and "Admin only / Provisioning" never changed and
          pushed the Create a team form to the fold. */}
      <KitCard aria-label="Provisioning summary">
        <KitStats
          items={[
            {
              value: adminOrgMetric(organizations.length, true),
              label: "Teams provisioned",
              tone: "blue",
            },
          ]}
        />
      </KitCard>

      {confirmation ? (
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
              <small className="app-muted">Lost it later? Make a new one from the team&rsquo;s row below.</small>
            </div>
          ) : null}
          <details className="admin-confirmation-details">
            <summary>Details</summary>
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
            <Button as="a" variant="secondary" href="/admin/analytics">
              Open platform analytics
            </Button>
          </div>
        </Panel>
      ) : null}

      <section className="admin-grid">
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
              onChange={(event) => {
                const teamNumber = event.target.value;
                // Name and web address follow the number until someone types their own.
                const autoName = !form.name || form.name === `Team ${form.teamNumber}`;
                const autoSlug = !form.slug || form.slug === `team-${form.teamNumber}`;
                setForm({
                  ...form,
                  teamNumber,
                  name: autoName ? (teamNumber ? `Team ${teamNumber}` : "") : form.name,
                  slug: autoSlug ? (teamNumber ? `team-${teamNumber}` : "") : form.slug,
                });
              }}
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
            <summary>Advanced</summary>
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
        <Panel>
          <span className="eyebrow">Provisioned teams</span>
          {shell === "empty" ? (
            <EmptyState soft title={copy.title} description={copy.description}>
              <Button as="a" variant="secondary" href="/admin/waitlist">
                Open waitlist
              </Button>
            </EmptyState>
          ) : (
            organizations.map((org) => (
              <article className="admin-org" key={org.id} title={formatAdminOrgLabel(org)}>
                <b>#{org.teamNumber}</b>
                <div>
                  <strong>{org.name}</strong>
                  {/* Whether the owner is in, not the web address: that is what an admin checks here. */}
                  <small>
                    {org.ownerEmail
                      ? `Owner joined · ${org.ownerEmail}`
                      : org.pendingOwnerEmail
                        ? `Owner invite pending · ${org.pendingOwnerEmail}`
                        : "No owner yet"}
                  </small>
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
                {org.pendingOwnerEmail && !org.ownerEmail ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    type="button"
                    className="admin-owner-link-btn"
                    onClick={() => {
                      // A new link stops the one already sent working: a second tap says so first.
                      if (confirmOwnerLink !== org.id) return setConfirmOwnerLink(org.id);
                      setConfirmOwnerLink(null);
                      void newOwnerLink(org.id);
                    }}
                  >
                    {confirmOwnerLink === org.id ? "Make it? The old link stops working" : "Get a new owner link"}
                  </Button>
                ) : null}
              </article>
            ))
          )}
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
