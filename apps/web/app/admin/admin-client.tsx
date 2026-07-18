"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { EmptyState, PageHeader, Panel } from "../../components/ui";

type Organization = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string;
};

function AdminClientInner() {
  const searchParams = useSearchParams();
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
  const [message, setMessage] = useState("");
  const [loaded, setLoaded] = useState(false);

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
    const response = await fetch("/api/admin/organizations");
    const data = await response.json();
    setOrganizations(data.organizations ?? []);
    setLoaded(true);
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
    const data = await response.json();
    setMessage(response.ok ? "Team workspace created and owner seeded." : data.error);
    if (response.ok) {
      setForm({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
      await load();
    }
  }

  return (
    <main className="module-page admin-control">
      <PageHeader
        breadcrumbs="Platform / Admin"
        title="Team provisioning"
        description="Closed membership: provision each team workspace and seed the first owner. Launch interest lives on the waitlist surface."
      >
        <nav className="settings-inline-links" aria-label="Platform shortcuts">
          <a href="/admin/waitlist">Waitlist</a>
          <a href="/admin/plans">Org plans</a>
          <a href="/admin/connectors">Connectors / API keys</a>
          <a href="/admin/models">Models</a>
          <a href="/admin/audit">Audit log</a>
        </nav>
      </PageHeader>

      <div className="cards">
        <article className="card">
          <span>Organizations</span>
          <strong>{loaded ? organizations.length : "…"}</strong>
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
          {!loaded ? (
            <EmptyState soft title="Loading organizations…" aria-busy />
          ) : organizations.length === 0 ? (
            <EmptyState
              soft
              title="No teams provisioned yet"
              description="Create the first workspace on the left, or start from a waitlist entry."
            >
              <a className="app-button secondary" href="/admin/waitlist">
                Open waitlist
              </a>
            </EmptyState>
          ) : (
            organizations.map((org) => (
              <article className="admin-org" key={org.id}>
                <b>#{org.teamNumber}</b>
                <div>
                  <strong>{org.name}</strong>
                  <small>
                    {org.slug} · {org.ownerEmail}
                  </small>
                </div>
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
        <main className="module-page admin-control">
          <EmptyState soft title="Loading admin…" aria-busy />
        </main>
      }
    >
      <AdminClientInner />
    </Suspense>
  );
}
