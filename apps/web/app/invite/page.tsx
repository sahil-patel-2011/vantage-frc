import { Suspense } from "react";
import InviteClient from "./invite-client";
import "./invite-flow.css";

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page invite-flow-page">
          <section className="onboarding-card invite-flow-card" aria-busy="true">
            <header className="invite-flow-header">
              <span>TEAM INVITATION</span>
              <h1>Loading invitation…</h1>
              <p className="onboarding-sub">
                Checking this invite against your verified email. Membership stays closed until accept
                succeeds.
              </p>
            </header>
          </section>
        </main>
      }
    >
      <InviteClient />
    </Suspense>
  );
}
