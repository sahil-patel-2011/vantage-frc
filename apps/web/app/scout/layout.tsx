import { Suspense } from "react";
import { ScoutingShell } from "./scouting-shell";

export const metadata = {
  title: { default: "Scouting", template: "%s · Vantage Scouting" },
  description: "Vantage Scouting — fast match entry, team lookup, match prediction and the pick list, on the same data as Vantage.",
  // Its own installable app: "Add to Home Screen" from Scouting opens Scouting, not Vantage's
  // home, with shortcuts straight to match entry, team lookup and the pick list.
  manifest: "/scout.webmanifest",
  appleWebApp: { capable: true, title: "Scouting", statusBarStyle: "default" as const },
};

export default function ScoutingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ScoutingShell>{children}</ScoutingShell>
    </Suspense>
  );
}
