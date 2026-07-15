"use client";

import { useEffect, useState } from "react";

type Organization = {
  id: string;
  name: string;
  slug: string;
  teamNumber: number;
  ownerEmail: string;
};

export default function AdminClient() {
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [form, setForm] = useState({ name: "", slug: "", teamNumber: "", ownerEmail: "" });
  const [message, setMessage] = useState("");
  async function load() {
    const response = await fetch("/api/admin/organizations");
    const data = await response.json();
    setOrganizations(data.organizations ?? []);
  }
  useEffect(() => { void load(); }, []);
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
    <main className="content admin-control">
      <span className="eyebrow">PLATFORM OWNER / CONTROL PLANE</span>
      <h1>Team provisioning</h1>
      <div className="cards"><article className="card"><span>Organizations</span><strong>{organizations.length}</strong></article><article className="card"><span>Membership policy</span><strong>Closed</strong></article><article className="card"><span>Provisioning</span><strong>Admin only</strong></article></div>
      <section className="admin-grid">
        <form className="intel-panel" onSubmit={create}>
          <span className="eyebrow">CREATE TEAM WORKSPACE</span>
          <label>Team number<input required type="number" min="1" max="99999" value={form.teamNumber} onChange={(e) => setForm({ ...form, teamNumber: e.target.value })} /></label>
          <label>Organization name<input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label>Workspace slug<input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} /></label>
          <label>First owner’s verified email<input required type="email" value={form.ownerEmail} onChange={(e) => setForm({ ...form, ownerEmail: e.target.value })} /></label>
          <button className="primary-action">Create and seed owner</button>
          {message && <p className="auth-message">{message}</p>}
        </form>
        <section className="intel-panel"><span className="eyebrow">PROVISIONED TEAMS</span>
          {organizations.map((org) => <article className="admin-org" key={org.id}><b>#{org.teamNumber}</b><div><strong>{org.name}</strong><small>{org.slug} · {org.ownerEmail}</small></div></article>)}
        </section>
      </section>
    </main>
  );
}
