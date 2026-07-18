import type { Metadata } from "next";
import { Suspense } from "react";
import OfflineClient from "./offline-client";
import "./offline.css";

export const metadata: Metadata = {
  title: "Offline · Vantage",
  description: "Vantage offline shell — reopen scouting and team tools from a prior visit.",
  robots: { index: false, follow: false },
};

/** Public navigation shell for cold offline loads (service-worker fallback). */
export default function OfflinePage() {
  return (
    <Suspense
      fallback={
        <main className="offline-shell">
          <p className="offline-shell-brand">Vantage</p>
          <h1>Loading offline shell…</h1>
        </main>
      }
    >
      <OfflineClient />
    </Suspense>
  );
}
