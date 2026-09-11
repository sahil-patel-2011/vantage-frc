"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";

const CommandClient = dynamic(() => import("../command/command-client"), { ssr: false });
const MyDayClient = dynamic(() => import("../my-day/my-day-client"), { ssr: false });
const StrategyClient = dynamic(() => import("../strategy/strategy-client"), { ssr: false });
const ScoutingClient = dynamic(() => import("../scouting/scouting-client"), { ssr: false });
const FormsClient = dynamic(() => import("../scouting/forms/forms-client"), { ssr: false });
const MatchChecklistClient = dynamic(() => import("../match-checklist/match-checklist-client"), {
  ssr: false,
});
const PickClockClient = dynamic(() => import("../pick-clock/pick-clock-client"), { ssr: false });
const ChemistryClient = dynamic(() => import("../chemistry/chemistry-client"), { ssr: false });

/** Tab ids rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = ["command", "my-day", "strategy", "pick-clock", "chemistry", "match-checklist", "scouting", "forms"] as const;

export default function CompetitionHub() {
  return (
    <ProductHubShell hubId="competition" embeddedTabs={EMBEDDED_TABS}>
      {({ tab, orgId }) => {
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
              {(id) => <ScoutingClient orgId={id} embedded />}
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
