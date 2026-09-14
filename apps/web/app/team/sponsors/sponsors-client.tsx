"use client";
import { useEffect, useMemo, useState } from "react";
import { Button, PageHeader } from "../../../components/ui";
import { SPONSOR_TIERS, SPONSOR_STATUSES, tierLabel, type SponsorTier, type SponsorStatus } from "../../../lib/sponsors";
import {
  contributionRowUsd,
  formatSponsorUsd,
  sponsorPageTotals,
  type ContributionMoneyRow,
} from "../../../lib/sponsors/totals";

type Sponsor = {
  id: string; name: string; website: string | null; tier: SponsorTier; status: SponsorStatus; industry: string | null;
  city: string | null; stateProv: string | null; notes: string | null; lifetimeContributionUsd: string;
  lastInteractionAt: string | null; needsFollowUp: boolean;
};
type Contact = { id: string; name: string; title: string | null; email: string | null; phone: string | null; isPrimary: boolean };
type Contribution = ContributionMoneyRow & {
  id: string; seasonYear: number; type: string; amountUsd: string | null; estimatedValueUsd: string | null;
  description: string | null; thankYouSentAt: string | null;
};
type Interaction = { id: string; type: string; subject: string | null; occurredAt: string; loggedByName: string };
type Prospect = { id: string; companyName: string; rationale: string | null; status: string };
type Draft = { id: string; subject: string; body: string };

const blankSponsor = { name: "", website: "", tier: "custom" as SponsorTier, status: "prospect" as SponsorStatus, industry: "", city: "", stateProv: "", notes: "" };

export default function SponsorsClient({ orgId }: { orgId: string }) {
  const [sponsors, setSponsors] = useState<Sponsor[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [orgContributions, setOrgContributions] = useState<Contribution[]>([]);
  const [contributionsLoaded, setContributionsLoaded] = useState(false);
  const [contributions, setContributions] = useState<Contribution[]>([]);
  const [interactions, setInteractions] = useState<Interaction[]>([]);
  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [message, setMessage] = useState("");
  const [sponsorForm, setSponsorForm] = useState(blankSponsor);
  const [contactForm, setContactForm] = useState({ name: "", title: "", email: "", phone: "", isPrimary: false });
  const [contributionForm, setContributionForm] = useState({ type: "cash", amountUsd: "", estimatedValueUsd: "", description: "" });
  const [interactionForm, setInteractionForm] = useState({ type: "email", subject: "", notes: "" });

  async function loadSponsors() {
    const [response, contribRes] = await Promise.all([
      fetch(`/api/sponsors?orgId=${orgId}`),
      fetch(`/api/sponsors/contributions?orgId=${orgId}`),
    ]);
    const data = await response.json();
    const contribData = await contribRes.json();
    setSponsors(data.sponsors ?? []);
    if (contribRes.ok) {
      setOrgContributions(contribData.contributions ?? []);
      setContributionsLoaded(true);
    }
    if (!response.ok) setMessage(data.error);
    else if (!contribRes.ok) setMessage(contribData.error);
  }
  async function loadProspects() {
    const response = await fetch(`/api/sponsors/prospects?orgId=${orgId}`);
    const data = await response.json();
    setProspects(data.prospects ?? []);
  }
  useEffect(() => { void loadSponsors(); void loadProspects(); }, [orgId]);

  async function loadDetail(sponsorId: string) {
    setSelectedId(sponsorId);
    setDraft(null);
    const [contactsRes, contributionsRes, interactionsRes] = await Promise.all([
      fetch(`/api/sponsors/contacts?orgId=${orgId}&sponsorId=${sponsorId}`),
      fetch(`/api/sponsors/contributions?orgId=${orgId}&sponsorId=${sponsorId}`),
      fetch(`/api/sponsors/interactions?orgId=${orgId}&sponsorId=${sponsorId}`),
    ]);
    setContacts((await contactsRes.json()).contacts ?? []);
    setContributions((await contributionsRes.json()).contributions ?? []);
    setInteractions((await interactionsRes.json()).interactions ?? []);
  }

  async function addSponsor(event: React.FormEvent) {
    event.preventDefault();
    const response = await fetch("/api/sponsors", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, ...sponsorForm }) });
    const data = await response.json();
    setMessage(response.ok ? "Sponsor added." : data.error);
    if (response.ok) { setSponsorForm(blankSponsor); await loadSponsors(); }
  }

  async function addContact(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/sponsors/contacts", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, sponsorId: selectedId, ...contactForm }) });
    const data = await response.json();
    setMessage(response.ok ? "Contact added." : data.error);
    if (response.ok) { setContactForm({ name: "", title: "", email: "", phone: "", isPrimary: false }); await loadDetail(selectedId); }
  }

  async function addContribution(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/sponsors/contributions", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, sponsorId: selectedId, seasonYear: new Date().getFullYear(), ...contributionForm }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Contribution logged." : data.error);
    if (response.ok) { setContributionForm({ type: "cash", amountUsd: "", estimatedValueUsd: "", description: "" }); await loadDetail(selectedId); await loadSponsors(); }
  }

  async function addInteraction(event: React.FormEvent) {
    event.preventDefault();
    if (!selectedId) return;
    const response = await fetch("/api/sponsors/interactions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, sponsorId: selectedId, ...interactionForm }) });
    const data = await response.json();
    setMessage(response.ok ? "Interaction logged." : data.error);
    if (response.ok) { setInteractionForm({ type: "email", subject: "", notes: "" }); await loadDetail(selectedId); await loadSponsors(); }
  }

  async function generateProspects() {
    const response = await fetch("/api/sponsors/prospects", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId }) });
    const data = await response.json();
    setMessage(response.ok ? "Generated starter prospect ideas." : data.error);
    if (response.ok) await loadProspects();
  }

  async function updateProspectStatus(id: string, status: string) {
    const response = await fetch("/api/sponsors/prospects", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, id, status }) });
    if (response.ok) await loadProspects();
  }

  async function draftMessage(kind: string) {
    if (!selectedId) return;
    const response = await fetch("/api/outreach", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ orgId, kind, sponsorId: selectedId }) });
    const data = await response.json();
    if (response.ok) setDraft(data.message); else setMessage(data.error);
  }

  async function sendDraft() {
    if (!draft) return;
    const to = window.prompt("Send to which email address?");
    if (!to) return;
    const response = await fetch("/api/outreach", {
      method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ orgId, id: draft.id, action: "send", to, subject: draft.subject, body: draft.body }),
    });
    const data = await response.json();
    setMessage(response.ok ? "Message sent." : data.error);
    if (response.ok) setDraft(data.message);
  }

  const selected = sponsors.find((s) => s.id === selectedId) ?? null;
  const { teamTotalUsd, amountBySponsorId } = useMemo(
    () => sponsorPageTotals(sponsors, orgContributions, contributionsLoaded),
    [sponsors, orgContributions, contributionsLoaded],
  );
  const selectedAmountUsd = selected ? (amountBySponsorId[selected.id] ?? 0) : 0;

  return (
    <main className="intel-app">
      <PageHeader
        breadcrumbs={
          <>
            <a href={`/team?orgId=${orgId}`}>Team</a>
            {" / Sponsors"}
          </>
        }
        title="Sponsor relationships & fundraising"
      >
        <nav className="product-hub-related" aria-label="Related money tools">
          <Button as="a" variant="secondary" href={`/team/finance?orgId=${orgId}`}>Finance</Button>
          <Button as="a" variant="secondary" href={`/team/grants?orgId=${orgId}`}>Grants</Button>
        </nav>
      </PageHeader>
      {message && <p className="telemetry-status">{message}</p>}
      <section className="metric-grid">
        <article><span>Active sponsors</span><strong>{sponsors.filter((s) => s.status === "active").length}</strong></article>
        <article><span>Team total</span><strong>{formatSponsorUsd(teamTotalUsd)}</strong></article>
        <article><span>Need follow-up</span><strong>{sponsors.filter((s) => s.needsFollowUp && s.status !== "declined").length}</strong></article>
        <article><span>Open prospects</span><strong>{prospects.filter((p) => p.status !== "dismissed").length}</strong></article>
      </section>

      <section className="admin-grid">
        <form className="intel-panel" onSubmit={addSponsor}>
          <span className="eyebrow">ADD A SPONSOR</span>
          <label>Name<input required value={sponsorForm.name} onChange={(e) => setSponsorForm({ ...sponsorForm, name: e.target.value })} /></label>
          <label>Website<input type="url" value={sponsorForm.website} onChange={(e) => setSponsorForm({ ...sponsorForm, website: e.target.value })} /></label>
          <label>Tier<select value={sponsorForm.tier} onChange={(e) => setSponsorForm({ ...sponsorForm, tier: e.target.value as SponsorTier })}>{SPONSOR_TIERS.map((t) => <option key={t} value={t}>{tierLabel(t)}</option>)}</select></label>
          <label>Status<select value={sponsorForm.status} onChange={(e) => setSponsorForm({ ...sponsorForm, status: e.target.value as SponsorStatus })}>{SPONSOR_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</select></label>
          <label>Industry<input value={sponsorForm.industry} onChange={(e) => setSponsorForm({ ...sponsorForm, industry: e.target.value })} placeholder="Manufacturing" /></label>
          <div className="budget-fields">
            <label>City<input value={sponsorForm.city} onChange={(e) => setSponsorForm({ ...sponsorForm, city: e.target.value })} /></label>
            <label>State<input value={sponsorForm.stateProv} onChange={(e) => setSponsorForm({ ...sponsorForm, stateProv: e.target.value })} /></label>
          </div>
          <label>Notes<input value={sponsorForm.notes} onChange={(e) => setSponsorForm({ ...sponsorForm, notes: e.target.value })} /></label>
          <Button type="submit" variant="primary">Add sponsor</Button>
        </form>
        <section className="intel-panel invite-list">
          <span className="eyebrow">SPONSORS</span>
          {sponsors.length === 0 && <p>No sponsors yet.</p>}
          {sponsors.map((s) => (
            <article key={s.id} onClick={() => void loadDetail(s.id)} style={{ cursor: "pointer" }}>
              <div><strong>{s.name}</strong><small>{tierLabel(s.tier)} · {s.status} · {formatSponsorUsd(amountBySponsorId[s.id] ?? 0)}{s.needsFollowUp ? " · needs follow-up" : ""}</small></div>
            </article>
          ))}
        </section>
      </section>

      {selected && (
        <section className="compare-panel">
          <span className="eyebrow">{selected.name.toUpperCase()}</span>
          <p className="telemetry-status">{formatSponsorUsd(selectedAmountUsd)} from recorded contributions</p>
          <div className="admin-grid">
            <section className="intel-panel">
              <span className="eyebrow">CONTACTS</span>
              {contacts.map((c) => <article key={c.id}><div><strong>{c.name}{c.isPrimary ? " ★" : ""}</strong><small>{c.title} · {c.email} · {c.phone}</small></div></article>)}
              <form onSubmit={addContact}>
                <label>Name<input required value={contactForm.name} onChange={(e) => setContactForm({ ...contactForm, name: e.target.value })} /></label>
                <label>Title<input value={contactForm.title} onChange={(e) => setContactForm({ ...contactForm, title: e.target.value })} /></label>
                <label>Email<input type="email" value={contactForm.email} onChange={(e) => setContactForm({ ...contactForm, email: e.target.value })} /></label>
                <label>Phone<input value={contactForm.phone} onChange={(e) => setContactForm({ ...contactForm, phone: e.target.value })} /></label>
                <label className="check-field"><input type="checkbox" checked={contactForm.isPrimary} onChange={(e) => setContactForm({ ...contactForm, isPrimary: e.target.checked })} /> Primary contact</label>
                <Button type="submit" variant="primary">Add contact</Button>
              </form>
            </section>
            <section className="intel-panel">
              <span className="eyebrow">CONTRIBUTIONS</span>
              {contributions.length === 0 && <p>No contributions logged — {formatSponsorUsd(0)}.</p>}
              {contributions.map((c) => <article key={c.id}><div><strong>{c.type === "cash" ? formatSponsorUsd(contributionRowUsd(c)) : `~${formatSponsorUsd(contributionRowUsd(c))} (${c.type})`}</strong><small>{c.seasonYear} · {c.description}{c.thankYouSentAt ? " · thanked" : ""}</small></div></article>)}
              <form onSubmit={addContribution}>
                <label>Type<select value={contributionForm.type} onChange={(e) => setContributionForm({ ...contributionForm, type: e.target.value })}><option value="cash">Cash</option><option value="in_kind">In-kind</option><option value="discount">Discount</option></select></label>
                {contributionForm.type === "cash"
                  ? <label>Amount ($)<input type="number" min="0" step="0.01" value={contributionForm.amountUsd} onChange={(e) => setContributionForm({ ...contributionForm, amountUsd: e.target.value })} /></label>
                  : <label>Estimated value ($)<input type="number" min="0" step="0.01" value={contributionForm.estimatedValueUsd} onChange={(e) => setContributionForm({ ...contributionForm, estimatedValueUsd: e.target.value })} /></label>}
                <label>Description<input value={contributionForm.description} onChange={(e) => setContributionForm({ ...contributionForm, description: e.target.value })} /></label>
                <Button type="submit" variant="primary">Log contribution</Button>
              </form>
            </section>
            <section className="intel-panel">
              <span className="eyebrow">INTERACTIONS</span>
              {interactions.map((i) => <article key={i.id}><div><strong>{i.type}</strong><small>{new Date(i.occurredAt).toLocaleDateString()} · {i.loggedByName} · {i.subject}</small></div></article>)}
              <form onSubmit={addInteraction}>
                <label>Type<select value={interactionForm.type} onChange={(e) => setInteractionForm({ ...interactionForm, type: e.target.value })}><option value="email">Email</option><option value="call">Call</option><option value="meeting">Meeting</option><option value="event_invite">Event invite</option><option value="thank_you">Thank you</option><option value="other">Other</option></select></label>
                <label>Subject<input value={interactionForm.subject} onChange={(e) => setInteractionForm({ ...interactionForm, subject: e.target.value })} /></label>
                <label>Notes<input value={interactionForm.notes} onChange={(e) => setInteractionForm({ ...interactionForm, notes: e.target.value })} /></label>
                <Button type="submit" variant="primary">Log interaction</Button>
              </form>
            </section>
          </div>
          <div className="intel-panel">
            <span className="eyebrow">DRAFT AN EMAIL</span>
            <div><button onClick={() => void draftMessage("thank_you")}>Thank-you</button><button onClick={() => void draftMessage("renewal_ask")}>Renewal ask</button><button onClick={() => void draftMessage("new_prospect_intro")}>Intro</button></div>
            {draft && (
              <div>
                <label>Subject<input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} /></label>
                <label>Body<textarea rows={8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} /></label>
                <Button type="button" variant="primary" onClick={() => void sendDraft()}>Send</Button>
              </div>
            )}
          </div>
        </section>
      )}

      <section className="intel-panel">
        <span className="eyebrow">PROSPECT IDEAS</span>
        <p>Starter categories based on who already sponsors you — heuristic suggestions, not verified live company data.</p>
        <button onClick={() => void generateProspects()}>Generate ideas</button>
        {prospects.map((p) => (
          <article key={p.id}>
            <div><strong>{p.companyName}</strong><small>{p.rationale}</small></div>
            <select value={p.status} onChange={(e) => void updateProspectStatus(p.id, e.target.value)}>
              <option value="suggested">Suggested</option><option value="reviewing">Reviewing</option><option value="contacted">Contacted</option><option value="dismissed">Dismissed</option>
            </select>
          </article>
        ))}
      </section>
    </main>
  );
}
