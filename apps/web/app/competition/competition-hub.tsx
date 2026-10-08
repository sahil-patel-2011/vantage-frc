"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, HubPanelSkeleton, ProductHubShell } from "../../components/product-hub";
import { ScoutingLoadingSkeleton } from "../scouting/scouting-chrome";
import "../product-hub.css";
import "../scouting/scouting.css";
import "../scouting/forms/forms.css";
import "../my-day/my-day.css";
import { PickListWorkspace } from "./pick-list-workspace";

const CommandClient = dynamic(() => import("../command/command-client"), { ssr: false, loading: HubPanelSkeleton });
const MyDayClient = dynamic(() => import("../my-day/my-day-client"), { ssr: false, loading: HubPanelSkeleton });
const StrategyClient = dynamic(() => import("../strategy/strategy-client"), { ssr: false, loading: HubPanelSkeleton });
// The scouting screen's own shape while its code downloads, not a blank panel:
// on a phone that blank was the first thing a scout saw after signing in.
const ScoutingClient = dynamic(() => import("../scouting/scouting-client"), {
  ssr: false,
  loading: () => <ScoutingLoadingSkeleton />,
});
const FormsClient = dynamic(() => import("../scouting/forms/forms-client"), { ssr: false, loading: HubPanelSkeleton });
const CompetitionTeams = dynamic(() => import("./competition-teams"), { ssr: false, loading: HubPanelSkeleton });
const MatchChecklistClient = dynamic(() => import("../match-checklist/match-checklist-client"), {
  ssr: false,
  loading: HubPanelSkeleton,
});
const PickClockClient = dynamic(() => import("../pick-clock/pick-clock-client"), { ssr: false, loading: HubPanelSkeleton });
const ChemistryClient = dynamic(() => import("../chemistry/chemistry-client"), { ssr: false, loading: HubPanelSkeleton });


/** Tab ids rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = ["command", "my-day", "teams", "strategy", "pick-clock", "chemistry", "match-checklist", "scouting", "forms", "picks"] as const;

export default function CompetitionHub() {
  return (
    <ProductHubShell hubId="competition" embeddedTabs={EMBEDDED_TABS}>
      {({ tab, orgId }) => {
        if (tab === "teams") {
          return <HubOrgGate orgId={orgId} label="Teams">{id => <CompetitionTeams orgId={id} />}</HubOrgGate>;
        }
        if (tab === "command") {
          return (
            <HubOrgGate orgId={orgId} label="Event day">
              {() => <CommandClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "my-day") {
          return (
            <HubOrgGate orgId={orgId} label="My Day">
              {() => <MyDayClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "strategy") {
          return (
            <HubOrgGate orgId={orgId} label="Strategy">
              {() => <StrategyClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "picks" || tab === "picklist-collab") return <HubOrgGate orgId={orgId} label="Pick list">{id => <PickListWorkspace key={id} orgId={id} discussionDefault={tab === "picklist-collab"} />}</HubOrgGate>;
        if (tab === "pick-clock") {
          return (
            <HubOrgGate orgId={orgId} label="Pick clock">
              {(id) => <PickClockClient orgId={id} embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "chemistry") {
          return (
            <HubOrgGate orgId={orgId} label="Chemistry">
              {(id) => <ChemistryClient orgId={id} embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "match-checklist") {
          return (
            <HubOrgGate orgId={orgId} label="Pit">
              {() => <MatchChecklistClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "scouting") {
          return (
            <HubOrgGate orgId={orgId} label="Scouting">
              {(id) => <ScoutingClient key={id} orgId={id} embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "forms") {
          return (
            <HubOrgGate orgId={orgId} label="Forms">
              {(id) => <FormsClient orgId={id} embedded />}
            </HubOrgGate>
          );
        }
        return <HubLegacyRedirect hubId="competition" tab={tab} orgId={orgId} />;
      }}
    </ProductHubShell>
  );
}
