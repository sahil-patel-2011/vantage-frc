"use client";
import { hubHref } from "../../lib/nav/hubs";
import type { ScoutTab } from "./scouting-model";
import { TabBar } from "../../components/ui";
import { scoutingQualityHref } from "../../lib/scouting/quality-navigation";
/**
 * A scout does two things here: a match or a pit visit. Passing entries between phones is
 * opened from the sync line (it is part of "is my work sent"), and a lead's review —
 * disagreements first, then Scouting quality — is one link. Those views join the tab row only
 * while open, so there is always a selected tab and a way back.
 */
export function ScoutViewSwitcher({ tab, onChange, orgId, eventKey, embedded, lead = false }: {
  tab: ScoutTab; onChange: (id: ScoutTab) => void; orgId: string; eventKey?: string | null; embedded: boolean; lead?: boolean;
}) {
  const tasks: { id: ScoutTab; label: string }[] = [
    { id: "match", label: "Match" }, { id: "pit", label: "Pit" },
    ...(!embedded ? [{ id: "teams" as const, label: "Scouted teams" }] : []),
    ...(tab === "handoff" ? [{ id: "handoff" as const, label: "QR handoff" }] : []),
    ...(tab === "conflicts" ? [{ id: "conflicts" as const, label: "Disagreements" }] : []),
  ];
  return <div className="scout-task-row"><TabBar className="scout-task-tabs" aria-label="Scouting task" tabs={tasks} value={tab} onChange={id => onChange(id as ScoutTab)} />
    {lead && tab !== "conflicts" ? <button type="button" className="scout-task-link" onClick={() => onChange("conflicts")}>Review scouting</button> : null}
    {lead && tab === "conflicts" ? <a href={scoutingQualityHref({ orgId, eventKey: eventKey ?? undefined })}>Scouting quality</a> : null}
    {embedded && tab === "teams" ? <a href={hubHref("/competition", "teams", orgId)}>Open Teams</a> : null}</div>;
}
