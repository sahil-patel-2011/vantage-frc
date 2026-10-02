"use client";
import type { WidgetPayload } from "../../../lib/dashboard/snapshot";
import { Button } from "../../../components/ui";
import { withOrgHref } from "../../../lib/nav/product-nav";

export function ScoutingCoverageCard({ payload, orgId }: { payload?: WidgetPayload; orgId: string }) {
  const hasEvent = payload?.status === "live";
  const data = payload?.data ?? {};
  const progress = (label: string, completed: unknown, total: unknown) => {
    if (typeof completed !== "number" || typeof total !== "number" || total <= 0) return null;
    return <div className="dash-coverage-progress"><div><strong>{label}</strong><span>{completed} / {total}</span></div><progress aria-label={label} value={Math.min(completed,total)} max={total} /></div>;
  };
  const href = (tab: string, kind: string) => withOrgHref(`/competition?tab=${tab}&scoutTab=${kind}${hasEvent ? "" : "&mode=free"}`, orgId);
  return <article className="dash-widget app-card dash-scout-card"><header><h2>Scouting</h2></header>
    {hasEvent ? <>
      {progress("Pit coverage", data.pitReports, data.scheduledTeams)}
      {progress("Match coverage", data.matchReports, data.matchSlots)}
      <p className="app-muted">{typeof data.reports === "number" ? `${data.reports} match reports` : ""}{typeof data.openDisagreements === "number" && data.openDisagreements > 0 ? ` · ${data.openDisagreements} to review` : ""}</p>
    </> : <p>Start with a pit visit, or practice scouting a match.</p>}
    <div className="dash-scout-card-actions"><Button as="a" variant="primary" href={href("scouting", "pit")}>Pit scout</Button><Button as="a" variant="secondary" href={href("scouting", "match")}>Match scout</Button></div>
    {hasEvent ? <a href={withOrgHref("/competition?tab=picks", orgId)}>Open pick list →</a> : null}
  </article>;
}
