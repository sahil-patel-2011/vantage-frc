import { Suspense } from "react";
import { ScoutingShell } from "./scouting-shell";

export const metadata = {
  title: { default: "Scouting", template: "%s · Vantage Scouting" },
  description: "Vantage Scouting — fast match entry, team lookup, match prediction and the pick list, on the same data as Vantage.",
};

export default function ScoutingLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={null}>
      <ScoutingShell>{children}</ScoutingShell>
    </Suspense>
  );
}
