"use client";
import { useSearchParams } from "next/navigation";
import "../scouting/scout-flow.css";
import dynamic from "next/dynamic";
import { ScoutingTeamProfiles } from "../scouting/scouting-team-profiles";
import { ScoutingSharing } from "../scouting/scouting-sharing";
import { HubPanelSkeleton } from "../../components/product-hub";
import { TabBar } from "../../components/ui";
const IntelClient = dynamic(() => import("../intel/intel-client"), { ssr: false, loading: HubPanelSkeleton });
/** One home for the event's teams, our observations and public team lookup. */
export default function CompetitionTeams({ orgId }: { orgId: string }) {
  const params = useSearchParams();
  const view = params.get("sub") === "lookup" || (params.get("sub") !== "scouting" && params.has("team")) ? "lookup" : "scouting";
  return <section className="competition-teams">
    <div className="team-view-heading">
      <TabBar aria-label="Team view" tabs={[{id:"scouting",label:"Our scouting"},{id:"lookup",label:"Team lookup"}]} value={view} onChange={next => {
        const url = new URL(window.location.href);
        url.searchParams.set("sub", next);
        window.history.replaceState({}, "", url.pathname + url.search);
      }} />
    </div>
    {view === "scouting" ? <ScoutingTeamProfiles orgId={orgId} eventKey={null} /> : <IntelClient variant="scouting" embedded />}
    <details className="team-sharing-settings"><summary>Share scouting with other teams</summary><ScoutingSharing orgId={orgId} /></details>
  </section>;
}
