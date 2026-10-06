"use client";
import { hubHref } from "../../lib/nav/hubs";
import type { ScoutTab } from "./scouting-model";
import { TabBar } from "../../components/ui";
export function ScoutViewSwitcher({ tab, onChange, orgId, embedded, lead = false }: {
  tab: ScoutTab; onChange: (id: ScoutTab) => void; orgId: string; embedded: boolean; lead?: boolean;
}) {
  const tasks: { id: ScoutTab; label: string }[] = [
    { id: "match", label: "Match" }, { id: "pit", label: "Pit" },
    ...(!embedded ? [{ id: "teams" as const, label: "Scouted teams" }] : []),
    { id: "handoff", label: "Transfer" },
    ...(lead ? [{ id: "trust" as const, label: "Coverage" }, { id: "conflicts" as const, label: "Review" }] : []),
  ];
  return <div className="scout-task-row"><TabBar className="scout-task-tabs" aria-label="Scouting task" tabs={tasks} value={tab} onChange={id => onChange(id as ScoutTab)} />
    {embedded && tab === "teams" ? <a href={hubHref("/competition", "teams", orgId)}>Open Teams</a> : null}</div>;
}
