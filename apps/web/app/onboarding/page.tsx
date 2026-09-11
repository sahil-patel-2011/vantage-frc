import { Suspense } from "react";
import OnboardingClient from "./onboarding-client";
import "./onboarding-flow.css";

export const metadata = {
  title: "Onboarding",
};

export default function OnboardingPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page onboarding-flow-page">
          <section className="onboarding-card onboarding-flow-card" aria-busy="true" aria-labelledby="onboarding-suspense-title">
            <header className="onboarding-flow-header">
              <span>YOUR STEPS</span>
              <h1 id="onboarding-suspense-title">Getting your steps ready…</h1>
              <p className="onboarding-sub">
                You need an invite or a team owner’s approval before you can open the team.
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
