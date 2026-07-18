import { Suspense } from "react";
import OnboardingClient from "./onboarding-client";
import "./onboarding-flow.css";

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page onboarding-flow-page">
          <section className="onboarding-card onboarding-flow-card" aria-busy="true" aria-labelledby="onboarding-suspense-title">
            <header className="onboarding-flow-header">
              <span>SECURE ONBOARDING</span>
              <h1 id="onboarding-suspense-title">Loading your secure session…</h1>
              <p className="onboarding-sub">
                Team access stays closed until an owner or invitation approves you.
              </p>
            </header>
            <div className="onboarding-load-shell loading">
              <p className="onboarding-load-progress" role="status">Preparing steps…</p>
            </div>
          </section>
        </main>
      }
    >
      <OnboardingClient />
    </Suspense>
  );
}
