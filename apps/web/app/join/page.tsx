import { Suspense } from "react";
import JoinClient from "./join-client";
import "../invite/invite-flow.css";

export const metadata = {
  title: "Join a team",
};

export default function JoinPage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page invite-flow-page">
          <section className="onboarding-card invite-flow-card" aria-busy="true">
            <header className="invite-flow-header">
              <span>TEAM JOIN LINK</span>
              <h1>Loading join link…</h1>
              <p className="onboarding-sub">Checking this link. You will sign in next, then land on the team.</p>
            </header>
          </section>
        </main>
      }
    >
      <JoinClient />
    </Suspense>
  );
}
