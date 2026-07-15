import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../components/marketing/site-header";

export const metadata: Metadata = {
  title: "System workflow — Vantage",
  description: "How Vantage carries event context, provenance, and approved handoffs across scouting, strategy, prediction, CAD, and code.",
  alternates: { canonical: "/workflow" },
};

const stages = [
  ["1", "Reference", "Official schedules and metrics enter shared caches with source and freshness state.", "Requires setup"],
  ["2", "Observe", "Scouts capture attributed, versioned records that continue offline.", "Available"],
  ["3", "Reconcile", "Conflicts, confidence, and source differences stay visible for review.", "Available"],
  ["4", "Decide", "Strategy and prediction outputs record their input versions and outcomes.", "Available"],
  ["5", "Execute", "Approved intent moves into display, CAD, assistant, and export workflows under team policy.", "Varies by connector"],
];

export default function WorkflowPage() {
  return <div className="marketing-site"><SiteHeader /><main className="route-page">
    <header className="route-hero"><span className="section-id">SYSTEM WORKFLOW</span><h1>Shared context is the handoff layer.</h1><p>Vantage keeps global reference data separate from private team observations, then joins them only inside an authorized organization and active event. Generated output never silently replaces its source evidence.</p></header>
    <section className="flow-map" aria-label="Vantage context and provenance flow">
      {stages.map(([id,title,detail,status], index) => <article key={id}><div><b>{id}</b>{index < stages.length - 1 && <i aria-hidden="true" />}</div><section><span className="status-badge">{status}</span><h2>{title}</h2><p>{detail}</p></section></article>)}
    </section>
    <section className="workflow-principles">
      <article><span className="section-id">PROVENANCE</span><h2>Different evidence types stay different.</h2><p>Official metrics, scout observations, research findings, predictions, recommendations, and human approvals use separate records and labels. That prevents a generated claim from appearing to be an official result.</p></article>
      <article><span className="section-id">TENANCY</span><h2>Organization context is deliberate.</h2><p>Protected routes require a verified session and organization membership. Row-level context is set per transaction so pooled database connections do not carry identity between requests.</p></article>
      <article><span className="section-id">HANDOFFS</span><h2>Risky actions require confirmation.</h2><p>CAD begins with a confirmed brief; connector-backed actions report setup state; billing and provider budgets are checked before managed calls.</p></article>
    </section>
  </main><SiteFooter /></div>;
}
