"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import {
  adminEmptyCopy,
  adminOrgMetric,
  classifyAdminShell,
  formatAdminOrgLabel,
} from "../../lib/admin";
import {
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

function AdminClientInner() {
  const searchParams = useSearchParams();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
  const [message, setMessage] = useState("");
  const [confirmation, setConfirmation] = useState<ProvisionConfirmation | null>(null);
  const [copied, setCopied] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
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
    const response = await fetch("/api/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...form, teamNumber: Number(form.teamNumber) }),
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

  /**
   * Deleting a workspace cascades every row it owns and cannot be undone, so the API
   * demands the team number back as a second factor. Asking for it here — rather than a
   * yes/no dialog — is what makes an accidental click on the wrong row survivable.
   */
  async function removeOrg(org: Organization) {
    const typed = window.prompt(
      `Permanently delete ${org.name} and every row it owns?\n\nThis cannot be undone. Type the team number (${org.teamNumber}) to confirm.`,
    );
    if (typed === null) return;
    if (typed.trim() !== String(org.teamNumber)) {
      setMessage("Delete cancelled — the team number did not match.");
      return;
    }
    setRemoving(org.id);
    setMessage("");
    try {
      const response = await fetch("/api/admin/organizations", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ orgId: org.id, confirmTeamNumber: org.teamNumber }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Delete failed.");
        return;
      }
      setMessage(`Deleted ${org.name}.`);
      await load();
    } catch {
      setMessage("Network error deleting the workspace.");
    } finally {
      setRemoving(null);
    }
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
            <button type="button" className="app-button secondary" onClick={() => void load()}>
              Retry
            </button>
          ) : null}
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="module-page admin-control admin-flow-page">
      <PageHeader
        breadcrumbs="Platform / Global Team Manager"
        title="Global Team Manager"
        description="Closed membership: provision each real team workspace and seed the first owner by exact verified email. Never DEMO organizations — waitlist interest stays on the waitlist surface."
      />

      <div className="cards" aria-label="Provisioning summary">
        <article className="card">
          <span>Organizations</span>
          <strong>{adminOrgMetric(organizations.length, true)}</strong>
        </article>
        <article className="card">
          <span>Membership</span>
          <strong>Closed</strong>
        </article>
        <article className="card">
          <span>Provisioning</span>
          <strong>Admin only</strong>
        </article>
      </div>

      {confirmation ? (
        <Panel className="admin-provision-confirmation" aria-label="Workspace created">
          <span className="eyebrow">Workspace created</span>
          <h2>
            #{confirmation.teamNumber} {confirmation.name}
          </h2>
          <ul>
            {confirmationLines(confirmation).map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          {confirmation.owner.mode === "invited" && confirmation.owner.inviteUrl ? (
            <div className="admin-invite-link">
              <label>
                One-time owner invite link (shown once — it is not stored)
                <input readOnly value={confirmation.owner.inviteUrl} onFocus={(event) => event.target.select()} />
              </label>
              <button
                type="button"
                className="app-button secondary"
                onClick={() => void copyInviteLink(confirmation.owner.inviteUrl!)}
              >
                {copied ? "Copied" : "Copy link"}
              </button>
            </div>
          ) : null}
          <div className="admin-confirmation-actions">
            <button type="button" className="app-button" onClick={() => setConfirmation(null)}>
              Provision another team
            </button>
            <a className="app-button secondary" href="/admin/analytics">
              Open platform analytics
            </a>
          </div>
        </Panel>
      ) : null}

      <section className="admin-grid">
        <Panel as="form" onSubmit={create}>
          <span className="eyebrow">Create workspace</span>
          <label>
            Team number
            <input
              required
              type="number"
              min={1}
              max={99999}
              value={form.teamNumber}
              onChange={(event) => setForm({ ...form, teamNumber: event.target.value })}
            />
          </label>
          <label>
            Organization name
            <input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} />
          </label>
          <label>
            Workspace slug
            <input
              required
              pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
              value={form.slug}
              onChange={(event) => setForm({ ...form, slug: event.target.value })}
            />
          </label>
          <label>
            First owner’s verified email
            <input
              required
              type="email"
              value={form.ownerEmail}
              onChange={(event) => setForm({ ...form, ownerEmail: event.target.value })}
            />
          </label>
          <button className="primary-action" type="submit">
            Create and seed owner
          </button>
          {message ? <p className="auth-message">{message}</p> : null}
        </Panel>
        <Panel>
          <span className="eyebrow">Provisioned teams</span>
          {shell === "empty" ? (
            <EmptyState soft title={copy.title} description={copy.description}>
              <a className="app-button secondary" href="/admin/waitlist">
                Open waitlist
              </a>
            </EmptyState>
          ) : (
            organizations.map((org) => (
              <article className="admin-org" key={org.id} title={formatAdminOrgLabel(org)}>
                <b>#{org.teamNumber}</b>
                <div>
                  <strong>{org.name}</strong>
                  <small>
                    {org.slug}
                    {org.ownerEmail
                      ? ` · ${org.ownerEmail}`
                      : org.pendingOwnerEmail
                        ? ` · owner invite pending: ${org.pendingOwnerEmail}`
                        : " · no owner yet"}
                  </small>
                </div>
                <button
                  type="button"
                  className="admin-org-remove"
                  disabled={removing === org.id}
                  onClick={() => void removeOrg(org)}
                  aria-label={`Delete ${org.name}`}
                >
                  {removing === org.id ? "Deleting…" : "Delete"}
                </button>
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
