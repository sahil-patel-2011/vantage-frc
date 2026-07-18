import { Suspense } from "react";
import InviteClient from "./invite-client";

export default function InvitePage() {
  return (
    <Suspense
      fallback={
        <main className="onboarding-page">
          <section className="onboarding-card">
            <p className="onboarding-sub">Loading invitation…</p>
          </section>
        </main>
      }
    >
      <InviteClient />
    </Suspense>
  );
}
