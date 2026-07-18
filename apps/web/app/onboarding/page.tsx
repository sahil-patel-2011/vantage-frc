import { Suspense } from "react";
import OnboardingClient from "./onboarding-client";

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page">
          <section className="onboarding-card">
            <p className="onboarding-sub">Loading onboarding…</p>
          </section>
        </main>
      }
    >
      <OnboardingClient />
    </Suspense>
  );
}
