"use client";
import { useState } from "react";
import "../scouting/scout-flow.css";
import dynamic from "next/dynamic";
import { ScoutingTeamProfiles } from "../scouting/scouting-team-profiles";
import { ScoutingSharing } from "../scouting/scouting-sharing";
import { HubPanelSkeleton } from "../../components/product-hub";
const IntelClient = dynamic(() => import("../intel/intel-client"), { ssr: false, loading: HubPanelSkeleton });
/** One home for the event's teams, our observations and public team lookup. */
export default function CompetitionTeams({ orgId }: { orgId: string }) {
  const [view, setView] = useState(() => typeof window !== "undefined" && (new URLSearchParams(window.location.search).get("sub") === "lookup" || (new URLSearchParams(window.location.search).get("sub") !== "scouting" && new URLSearchParams(window.location.search).has("team"))) ? "lookup" : "scouting");
  return <section className="competition-teams">
    <div className="team-view-heading"><div><h2>Teams</h2><p className="app-muted">Find your next alliance partner from what your scouts observed.</p></div>
      <label className="section-select"><span className="sr-only">Team view</span><select aria-label="Team view" value={view} onChange={event => {
        const next = event.target.value;
        setView(next);
        const url = new URL(window.location.href);
        url.searchParams.set("sub", next);
        window.history.replaceState({}, "", url.pathname + url.search);
      }}>
        <option value="scouting">Our scouting</option><option value="lookup">All teams and season data</option>
      </select></label>
    </div>
    {view === "scouting" ? <ScoutingTeamProfiles orgId={orgId} eventKey={null} /> : <IntelClient variant="scouting" embedded />}
    <details className="team-sharing-settings"><summary>Share scouting with other teams</summary><ScoutingSharing orgId={orgId} /></details>
  </section>;
}
