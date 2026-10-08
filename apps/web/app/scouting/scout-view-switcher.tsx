"use client";
import { hubHref } from "../../lib/nav/hubs";
import type { ScoutTab } from "./scouting-model";
import { TabBar } from "../../components/ui";
export function ScoutViewSwitcher({ tab, onChange, orgId, embedded, lead = false, recording = false }: {
  tab: ScoutTab; onChange: (id: ScoutTab) => void; orgId: string; embedded: boolean; lead?: boolean; recording?: boolean;
}) {
  const tasks: { id: ScoutTab; label: string }[] = [
    { id: "match", label: "Match" }, { id: "pit", label: "Pit" },
    ...(!embedded && !recording ? [{ id: "teams" as const, label: "Scouted teams" }] : []),
    ...(!recording ? [{ id: "handoff" as const, label: "Transfer" }] : []),
    ...(lead && !recording ? [{ id: "trust" as const, label: "Coverage" }, { id: "conflicts" as const, label: "Data review" }] : []),
  ];
  return <div className="scout-task-row"><TabBar className="scout-task-tabs" aria-label="Scouting task" tabs={tasks} value={tab} onChange={id => onChange(id as ScoutTab)} />
    {embedded && tab === "teams" ? <a href={hubHref("/competition", "teams", orgId)}>Open Teams</a> : null}</div>;
}
