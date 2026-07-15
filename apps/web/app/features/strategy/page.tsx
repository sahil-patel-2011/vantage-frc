import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { StrategyPreview } from "../../../components/marketing/product-demos";

export const metadata: Metadata = { title: "Strategy Engine — Vantage", description: "Implemented FRC prediction, what-if analysis, playbooks, provenance, and post-match accuracy tracking.", alternates: { canonical: "/features/strategy" } };

export default function StrategyFeaturePage() {
  return <div className="marketing-site"><SiteHeader/><main className="route-page">
    <header className="route-hero split-hero"><div><span className="section-id">WIN / LOSS + STRATEGY ENGINE · AVAILABLE</span><h1>Turn probability into a plan the drive team can inspect.</h1><p>Vantage combines weighted season signals with organization scouting, reliability, foul exposure, and source-linked research adjustments. It reports intervals, factors, caveats, what-if assumptions, playbook priorities, and outcome accuracy.</p></div><StrategyPreview/></header>
    <section className="detail-proof-grid"><article><b>01</b><h2>Prediction with limits</h2><p>Red/blue probabilities, effective sample size, confidence interval, model version, key factors, and sparse-data caveats.</p></article><article><b>02</b><h2>Explicit what-if</h2><p>Point deltas are recorded as assumptions so a changed probability never masquerades as an observed result.</p></article><article><b>03</b><h2>Playbook + debrief</h2><p>Alliance priorities, risks, role checkpoints, and post-match prompts stay linked to the factors that produced them.</p></article></section>
  </main><SiteFooter/></div>;
}
