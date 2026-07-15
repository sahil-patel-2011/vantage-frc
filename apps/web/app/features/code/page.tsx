import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../../../components/marketing/site-header";
import { CodePreview } from "../../../components/marketing/product-demos";

export const metadata: Metadata = { title: "FRC Code Review — Vantage", description: "Repository-aware FRC code risk review and human-approved unified diff proposals.", alternates: { canonical: "/features/code" } };

export default function CodeFeaturePage() {
  return <div className="marketing-site"><SiteHeader/><main className="route-page">
    <header className="route-hero split-hero"><div><span className="section-id">FRC CODE BUILDER / DEBUGGER · AVAILABLE</span><h1>Review robot-code risk before a proposal reaches hardware.</h1><p>The implemented reviewer checks diffs or file content for blocking robot loops, hard-coded CAN IDs, out-of-range motor output, missing physical units, and disabled-state actuator writes. Proposed changes remain unified diffs requiring human approval.</p></div><CodePreview/></header>
    <section className="detail-proof-grid"><article><b>01</b><h2>FRC-specific findings</h2><p>Each finding carries severity, rule name, file/line evidence, and required robot-safe checks.</p></article><article><b>02</b><h2>Versioned artifacts</h2><p>Review output and code proposals can be stored as organization-scoped artifacts with source provenance.</p></article><article><b>03</b><h2>No autonomous robot deploy</h2><p>Vantage produces a review and proposal. Teams run tests, code review, code-freeze policy, and deployment through their established tooling.</p></article></section>
  </main><SiteFooter/></div>;
}
