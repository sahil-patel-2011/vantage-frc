import { Suspense } from "react";
import type { Metadata } from "next";
import DesktopLinkClient from "./desktop-link-client";
import "./desktop-link.css";

export const metadata: Metadata = {
  title: "Approve desktop sign-in — Vantage",
  robots: { index: false },
};

/**
 * Browser-side approval page for the desktop shell's sign-in
 * (apps/web/app/api/desktop/*). Session-gated by proxy.ts like every
 * non-public route: reaching it at all means the user is signed in (and passed
 * the email second factor when enforced).
 */
export default function DesktopLinkPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page desktop-link-page">
          <section className="onboarding-card desktop-link-card" aria-busy="true">
            <header className="desktop-link-header">
              <span>DESKTOP SIGN-IN</span>
              <h1>Checking this code…</h1>
            </header>
          </section>
        </main>
      }
    >
      <DesktopLinkClient />
    </Suspense>
  );
}
