"use client";

import dynamic from "next/dynamic";
import { HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";
import "../scouting/scouting.css";
import "../scouting/forms/forms.css";
import "../my-day/my-day.css";

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

export default function CompetitionHub() {
  return (
    <ProductHubShell hubId="competition">
      {({ tab, orgId }) => {
        if (tab === "command") return <CommandClient />;
        if (tab === "my-day") return <MyDayClient />;
        if (tab === "strategy") return <StrategyClient />;
        if (tab === "pick-clock") return <PickClockClient />;
        if (tab === "chemistry") return <ChemistryClient />;
        if (tab === "match-checklist") return <MatchChecklistClient />;
        if (tab === "scouting") {
          return (
            <HubOrgGate orgId={orgId} label="Scouting">
              {(id) => <ScoutingClient orgId={id} />}
            </HubOrgGate>
          );
        }
        if (tab === "forms") {
          return (
            <HubOrgGate orgId={orgId} label="Form builder">
              {(id) => <FormsClient orgId={id} />}
            </HubOrgGate>
          );
        }
        return null;
      }}
    </ProductHubShell>
  );
}
