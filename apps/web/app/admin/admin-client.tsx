"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "../../components/ui";
import {
  ADMIN_RELATED_INCLUDE,
  adminEmptyCopy,
  adminNextActions,
  adminOrgMetric,
  adminRelatedLinks,
  classifyAdminShell,
  formatAdminOrgLabel,
  type AdminShellKind,
} from "../../lib/admin";
import "./admin-flow.css";

type Organization = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string;
};

function AdminRelated({ active }: { active?: "teams" }) {
  const links = adminRelatedLinks({
    active,
    include: [...ADMIN_RELATED_INCLUDE],
  });
  return (
    <nav className="settings-inline-links admin-related" aria-label="Platform shortcuts">
      {links.map((link) => (
        <a key={link.id} href={link.href}>
          {link.label}
        </a>
      ))}
    </nav>
  );
}

function AdminNextActions({ kind }: { kind: AdminShellKind }) {
  const actions = adminNextActions(kind);
  if (actions.length === 0) return null;
  return (
    <section className="admin-next-actions" aria-label="Next actions">
      <header>
        <h2>Next actions</h2>
        <p>Real platform rows only — never DEMO org counts, plan metrics, or invented tickets.</p>
      </header>
      <ol>
        {actions.map((action) => (
          <li key={action.id} className={action.primary ? "primary" : undefined}>
            <div>
              <strong>{action.label}</strong>
              <span>{action.detail}</span>
            </div>
            <a className="app-button secondary" href={action.href}>
              Open
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
    const data = (await response.json()) as { error?: string };
    setMessage(response.ok ? "Team workspace created and owner seeded." : (data.error ?? "Create failed."));
    if (response.ok) {
      setForm({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
      await load();
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
        <AdminNextActions kind={shell} />
      </main>
    );
  }

  return (
    <main className="module-page admin-control admin-flow-page">
      <PageHeader
        breadcrumbs="Platform / Admin"
        title="Team provisioning"
        description="Closed membership: provision each team workspace and seed the first owner. Launch interest lives on the waitlist surface."
      >
        <AdminRelated active="teams" />
      </PageHeader>

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
                    {org.ownerEmail ? ` · ${org.ownerEmail}` : ""}
                  </small>
                </div>
              </article>
            ))
          )}
        </Panel>
      </section>

      <AdminNextActions kind={shell} />
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
