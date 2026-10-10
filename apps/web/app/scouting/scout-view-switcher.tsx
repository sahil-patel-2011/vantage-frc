"use client";
import { hubHref } from "../../lib/nav/hubs";
import type { ScoutTab } from "./scouting-model";
import { TabBar } from "../../components/ui";
import { scoutingQualityHref } from "../../lib/scouting/quality-navigation";
export function ScoutViewSwitcher({ tab, onChange, orgId, eventKey, embedded, lead = false }: {
  tab: ScoutTab; onChange: (id: ScoutTab) => void; orgId: string; eventKey?: string | null; embedded: boolean; lead?: boolean;
}) {
  const tasks: { id: ScoutTab; label: string }[] = [
    { id: "match", label: "Match" }, { id: "pit", label: "Pit" },
    ...(!embedded ? [{ id: "teams" as const, label: "Scouted teams" }] : []),
    { id: "handoff", label: "Transfer" },
    ...(lead ? [{ id: "conflicts" as const, label: "Review" }] : []),
  ];
  return <div className="scout-task-row"><TabBar className="scout-task-tabs" aria-label="Scouting task" tabs={tasks} value={tab} onChange={id => onChange(id as ScoutTab)} />
    {lead ? <a href={scoutingQualityHref({ orgId, eventKey: eventKey ?? undefined })}>Scouting quality</a> : null}
    {embedded && tab === "teams" ? <a href={hubHref("/competition", "teams", orgId)}>Open Teams</a> : null}</div>;
}
