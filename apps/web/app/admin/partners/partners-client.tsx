"use client";

import { useCallback, useEffect, useState } from "react";
import { EmptyState, PageHeader, Panel, Button } from "../../../components/ui";
import { adminRelatedLinks } from "../../../lib/admin";
import "../admin-flow.css";
import "./partners.css";

type Sponsor = {
  id: string;
  name: string;
  logoUrl: string | null;
  websiteUrl: string | null;
  tier: "title" | "ai" | "partner" | "prospect";
  status: "prospect" | "active" | "paused" | "ended";
  outreachStatus: string;
  aiCoverage: "none" | "partner_sponsored" | "direct_keys_partner_brand";
  brandTagline: string | null;
  notes: string | null;
  sortOrder: number;
};

const emptyForm = {
  name: "",
  logoUrl: "",
  websiteUrl: "",
  tier: "ai" as Sponsor["tier"],
  status: "prospect" as Sponsor["status"],
  outreachStatus: "not_started",
  aiCoverage: "none" as Sponsor["aiCoverage"],
  brandTagline: "",
  notes: "",
  sortOrder: 0,
};

function coverageLabel(value: Sponsor["aiCoverage"]) {
  if (value === "partner_sponsored") return "Partner-sponsored AI (keys stay in env)";
  if (value === "direct_keys_partner_brand") return "Direct Anthropic/OpenAI keys · partner brand in-app";
  return "No AI framing";
}

export default function AdminPartnersClient() {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [form, setForm] = useState(emptyForm);
  const [editId, setEditId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [ok, setOk] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/partners");
      const data = (await response.json()) as { sponsors?: Sponsor[]; error?: string };
      if (!response.ok) {
        setMessage(data.error ?? "Could not load partners.");
        setOk(false);
        setSponsors([]);
        return;
      }
      setMessage("");
      setSponsors(data.sponsors ?? []);
    } catch {
      setMessage("Network error loading partners.");
      setOk(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function startEdit(row: Sponsor) {
    setEditId(row.id);
    setForm({
      name: row.name,
      logoUrl: row.logoUrl ?? "",
      websiteUrl: row.websiteUrl ?? "",
      tier: row.tier,
      status: row.status,
      outreachStatus: row.outreachStatus,
      aiCoverage: row.aiCoverage,
      brandTagline: row.brandTagline ?? "",
      notes: row.notes ?? "",
      sortOrder: row.sortOrder,
    });
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/partners", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: editId ?? undefined,
          name: form.name,
          logoUrl: form.logoUrl.trim() || null,
          websiteUrl: form.websiteUrl.trim() || null,
          tier: form.tier,
          status: form.status,
          outreachStatus: form.outreachStatus,
          aiCoverage: form.aiCoverage,
          brandTagline: form.brandTagline.trim() || null,
          notes: form.notes.trim() || null,
          sortOrder: form.sortOrder,
        }),
      });
      const data = await response.json();
      setOk(response.ok);
      setMessage(response.ok ? "Partner saved." : (data.error ?? "Save failed."));
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
    if (!confirm(`Remove ${name}? Their logo disappears from AI surfaces immediately.`)) return;
    setBusy(true);
    try {
      const response = await fetch("/api/admin/partners", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      const data = await response.json();
      setOk(response.ok);
      setMessage(response.ok ? "Partner removed." : (data.error ?? "Delete failed."));
      if (response.ok) await load();
    } finally {
      setBusy(false);
    }
  }

  const related = adminRelatedLinks({
    include: ["teams", "plans", "support", "releases", "waitlist", "audit"],
  });
  const activeCount = sponsors.filter((row) => row.status === "active").length;

  return (
    <main className="module-page admin-control admin-flow-page admin-partners-page">
      <PageHeader
        breadcrumbs="Platform / Partners"
        title="App sponsors & AI partners"
        description="Track Microsoft Azure, Anthropic, OpenAI, and other partners. Partner logos appear on AI surfaces only when status is active. API keys stay in env or on the team's own keys page — never here."
      >
        <nav className="admin-related" aria-label="Related admin">
          {related.map((link) => (
            <Button as="a" variant="secondary" key={link.id} href={link.href}>
              {link.label}
            </Button>
          ))}
          <Button as="a" variant="secondary" href="/admin/outreach">
            Org outreach
          </Button>
        </nav>
      </PageHeader>

      <section className="admin-ai-smoke" aria-label="AI entry points">
        <header>
          <h2>AI tools for platform admin</h2>
          <p className="app-muted">
            Check that routing and key vaults still work.
          </p>
        </header>
        <div className="admin-ai-smoke-links">
          <Button as="a" variant="primary" href="/admin/models">
            Models &amp; keys
          </Button>
          <Button as="a" variant="secondary" href="/admin/sponsored">
            Sponsored AI policy
          </Button>
          <Button as="a" variant="secondary" href="/ai">
            Open AI hub
          </Button>
          <Button as="a" variant="secondary" href="/ai?tab=chat">
            Test AI chat
          </Button>
        </div>
      </section>

      {message ? (
        <p className={`telemetry-status${ok ? " success" : ""}`} role="status">
          {message}
        </p>
      ) : null}

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={(e) => void save(e)}>
          <span className="eyebrow">{editId ? "EDIT PARTNER" : "ADD PARTNER"}</span>
          <p className="app-muted">
            Framing: partner-sponsored Anthropic coverage, or direct keys with partner branding in-app.
          </p>
          <label>
            Name
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="Anthropic"
            />
          </label>
          <label>
            Logo URL (https)
            <input
              type="url"
              value={form.logoUrl}
              onChange={(e) => setForm({ ...form, logoUrl: e.target.value })}
              placeholder="https://…"
            />
          </label>
          <label>
            Website (https)
            <input
              type="url"
              value={form.websiteUrl}
              onChange={(e) => setForm({ ...form, websiteUrl: e.target.value })}
            />
          </label>
          <label>
            Tier
            <select
              value={form.tier}
              onChange={(e) => setForm({ ...form, tier: e.target.value as Sponsor["tier"] })}
            >
              <option value="title">Title</option>
              <option value="ai">AI</option>
              <option value="partner">Partner</option>
              <option value="prospect">Prospect</option>
            </select>
          </label>
          <label>
            Status
            <select
              value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as Sponsor["status"] })}
            >
              <option value="prospect">Prospect</option>
              <option value="active">Active (logo shown)</option>
              <option value="paused">Paused</option>
              <option value="ended">Ended</option>
            </select>
          </label>
          <label>
            Outreach
            <select
              value={form.outreachStatus}
              onChange={(e) => setForm({ ...form, outreachStatus: e.target.value })}
            >
              <option value="not_started">Not started</option>
              <option value="contacted">Contacted</option>
              <option value="in_discussion">In discussion</option>
              <option value="committed">Committed</option>
              <option value="declined">Declined</option>
              <option value="on_hold">On hold</option>
            </select>
          </label>
          <label>
            AI coverage framing
            <select
              value={form.aiCoverage}
              onChange={(e) =>
                setForm({ ...form, aiCoverage: e.target.value as Sponsor["aiCoverage"] })
              }
            >
              <option value="none">{coverageLabel("none")}</option>
              <option value="partner_sponsored">{coverageLabel("partner_sponsored")}</option>
              <option value="direct_keys_partner_brand">
                {coverageLabel("direct_keys_partner_brand")}
              </option>
            </select>
          </label>
          <label>
            Brand tagline
            <input
              value={form.brandTagline}
              onChange={(e) => setForm({ ...form, brandTagline: e.target.value })}
              maxLength={120}
              placeholder="AI with Anthropic"
            />
          </label>
          <label>
            Sort order
            <input
              type="number"
              value={form.sortOrder}
              onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })}
            />
          </label>
          <label>
            Notes
            <textarea
              rows={4}
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Outreach notes — never paste API keys"
            />
          </label>
          <div className="intel-actions">
            <button className="primary-action" disabled={busy} type="submit">
              {editId ? "Update partner" : "Add partner"}
            </button>
            {editId ? (
              <Button variant="secondary" type="button" onClick={() => { setEditId(null); setForm(emptyForm); }}>
                Cancel edit
              </Button>
            ) : null}
          </div>
        </form>

        <Panel className="invite-list admin-partners-list">
          <span className="eyebrow">PARTNER LEDGER</span>
          {loading ? (
            <EmptyState soft title="Opening partners" description="Reading platform_app_sponsors." />
          ) : !sponsors.length ? (
            <EmptyState
              soft
              badge="Empty"
              badgeTone="setup"
              title="No partners tracked yet"
              description="Add Azure, Anthropic, OpenAI, or other prospects. Their logo stays hidden until status is active."
            />
          ) : (
            <>
              <p className="app-muted">
                {activeCount} active · {sponsors.length} total — branding only for active rows.
              </p>
              {sponsors.map((row) => (
                <article key={row.id}>
                  <div>
                    <strong>{row.name}</strong>
                    <small>
                      {row.tier} · {row.status} · {row.outreachStatus} · {coverageLabel(row.aiCoverage)}
                    </small>
                    {row.brandTagline ? <small>{row.brandTagline}</small> : null}
                  </div>
                  <div>
                    <button type="button" onClick={() => startEdit(row)}>
                      Edit
                    </button>
                    <button type="button" onClick={() => void remove(row.id, row.name)}>
                      Remove
                    </button>
                  </div>
                </article>
              ))}
            </>
          )}
        </Panel>
      </section>
    </main>
  );
}
