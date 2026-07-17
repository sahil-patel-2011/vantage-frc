import { Suspense } from "react";
import OnboardingClient from "./onboarding-client";

export default function OnboardingPage() {
  return (
    <Suspense fallback={<main className="shell-page"><p>Loading onboarding…</p></main>}>
      <OnboardingClient />
    </Suspense>
  );
}
