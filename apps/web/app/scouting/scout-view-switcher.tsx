"use client";
import { hubHref } from "../../lib/nav/hubs";
import type { ScoutTab } from "./scouting-model";
export function ScoutViewSwitcher({ tab, onChange, orgId, embedded, lead = false }: {
  tab: ScoutTab; onChange: (id: ScoutTab) => void; orgId: string; embedded: boolean; lead?: boolean;
}) {
  const tasks: { id: ScoutTab; label: string }[] = [
    { id: "match", label: "Scout a match" }, { id: "pit", label: "Visit a pit" },
    ...(!embedded ? [{ id: "teams" as const, label: "Scouted teams" }] : []),
    { id: "handoff", label: "Transfer by QR" },
    ...(lead ? [{ id: "trust" as const, label: "Coverage and accuracy" }, { id: "conflicts" as const, label: "Review disagreements" }] : []),
  ];
  return <div className="scout-task-row"><label className="section-select"><span className="sr-only">Scouting task</span>
    <select aria-label="Scouting task" value={tab} onChange={event => onChange(event.target.value as ScoutTab)}>{tasks.map(task => <option key={task.id} value={task.id}>{task.label}</option>)}</select>
  </label>{embedded && tab === "teams" ? <a href={hubHref("/competition", "teams", orgId)}>Open Teams</a> : null}</div>;
}
