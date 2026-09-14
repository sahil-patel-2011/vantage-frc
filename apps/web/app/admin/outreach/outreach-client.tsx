"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { adminRelatedLinks } from "../../../lib/admin";
import "../admin-flow.css";
import "../partners/partners.css";

type Outreach = {
  id: string;
  orgName: string;
  contactName: string | null;
  contactEmail: string | null;
  status: string;
  notes: string | null;
  nextActionAt: string | null;
  linkedOrgId: string | null;
};

const emptyForm = {
  orgName: "",
  contactName: "",
  contactEmail: "",
  status: "prospect",
  notes: "",
  nextActionAt: "",
  linkedOrgId: "",
};

export default function AdminOutreachClient() {
  const [rows, setRows] = useState<Outreach[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/outreach");
      const data = (await response.json()) as { outreach?: Outreach[]; error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load outreach.");
        setOk(false);
        setRows([]);
        return;
      }
      setMessage("");
      setRows(data.outreach ?? []);
    } catch {
      setMessage("Network error loading outreach.");
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(row: Outreach) {
    setEditId(row.id);
    setForm({
      orgName: row.orgName,
      contactName: row.contactName ?? "",
      contactEmail: row.contactEmail ?? "",
      status: row.status,
      notes: row.notes ?? "",
      nextActionAt: row.nextActionAt ?? "",
      linkedOrgId: row.linkedOrgId ?? "",
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editId ?? undefined,
          orgName: form.orgName,
          contactName: form.contactName.trim() || null,
          contactEmail: form.contactEmail.trim() || null,
          status: form.status,
          notes: form.notes.trim() || null,
          nextActionAt: form.nextActionAt.trim() || null,
          linkedOrgId: form.linkedOrgId.trim() || null,
        }),
      });
      const data = await response.json();
      setOk(response.ok);
      setMessage(response.ok ? "Outreach saved." : (data.error ?? "Save failed."));
      if (response.ok) {
        setEditId(null);
        setForm(emptyForm);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Remove outreach for ${name}?`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/outreach", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      setOk(response.ok);
      setMessage(response.ok ? "Outreach removed." : (data.error ?? "Delete failed."));
      if (response.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  const related = adminRelatedLinks({
    include: ["teams", "plans", "support", "releases", "waitlist", "audit"],
  });

  return (
    <main className="module-page admin-control admin-flow-page admin-partners-page">
      <PageHeader
        breadcrumbs="Platform / Outreach"
        title="Organization outreach"
        description="CRM-lite for teams and schools you are talking to — name, contact, status, notes, next action. Not Salesforce."
      >
        <nav className="admin-related" aria-label="Related admin">
          {related.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
          <Button as="a" variant="secondary" href="/admin/partners">
            App partners
          </Button>
        </nav>
      </PageHeader>

      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={(e) => void save(e)}>
          <span className="eyebrow">{editId ? "EDIT OUTREACH" : "ADD OUTREACH"}</span>
          <label>
            Organization name
            <input
              required
              value={form.orgName}
              onChange={(e) => setForm({ ...form, orgName: e.target.value })}
            />
          </label>
          <label>
            Contact name
            <input
              value={form.contactName}
              onChange={(e) => setForm({ ...form, contactName: e.target.value })}
            />
          </label>
          <label>
            Contact email
            <input
              type="email"
              value={form.contactEmail}
              onChange={(e) => setForm({ ...form, contactEmail: e.target.value })}
            />
          </label>
          <label>
            Status
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="prospect">Prospect</option>
              <option value="contacted">Contacted</option>
              <option value="demo">Demo</option>
              <option value="negotiating">Negotiating</option>
              <option value="won">Won</option>
              <option value="lost">Lost</option>
              <option value="nurture">Nurture</option>
            </select>
          </label>
          <label>
            Next action date
            <input
              type="date"
              value={form.nextActionAt}
              onChange={(e) => setForm({ ...form, nextActionAt: e.target.value })}
            />
          </label>
          <label>
            Linked org UUID (optional)
            <input
              value={form.linkedOrgId}
              onChange={(e) => setForm({ ...form, linkedOrgId: e.target.value })}
              placeholder="Provisioned org id when known"
            />
          </label>
          <label>
            Notes
            <textarea
              rows={4}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
            />
          </label>
          <div className="intel-actions">
            <button className="primary-action" disabled={busy} type="submit">
              {editId ? "Update" : "Add outreach"}
            </button>
            {editId ? (
              <Button variant="secondary" type="button" onClick={() => { setEditId(null); setForm(emptyForm); }}>
                Cancel
              </Button>
            ) : null}
          </div>
        </form>

        <Panel className="invite-list admin-partners-list">
          <span className="eyebrow">OUTREACH LEDGER</span>
          {loading ? (
            <EmptyState soft title="Opening outreach" description="Reading platform_org_outreach." />
          ) : !rows.length ? (
            <EmptyState
              soft
              badge="Empty"
              badgeTone="setup"
              title="No outreach rows yet"
              description="Add a school or team you are contacting. Counts stay empty until you log real conversations."
            />
          ) : (
            rows.map((row) => (
              <article key={row.id}>
                <div>
                  <strong>{row.orgName}</strong>
                  <small>
                    {row.status}
                    {row.nextActionAt ? ` · next ${row.nextActionAt}` : ""}
                    {row.contactName ? ` · ${row.contactName}` : ""}
                    {row.contactEmail ? ` · ${row.contactEmail}` : ""}
                  </small>
                </div>
                <div>
                  <button type="button" onClick={() => startEdit(row)}>
                    Edit
                  </button>
                  <button type="button" onClick={() => void remove(row.id, row.orgName)}>
                    Remove
                  </button>
                </div>
              </article>
            ))
          )}
        </Panel>
      </section>
    </main>
  );
}
