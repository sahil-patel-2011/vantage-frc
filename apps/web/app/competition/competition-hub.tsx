"use client";

import dynamic from "next/dynamic";
import { HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";
import "../scouting/scouting.css";
import "../my-day/my-day.css";

const CommandClient = dynamic(() => import("../command/command-client"), { ssr: false });
const MyDayClient = dynamic(() => import("../my-day/my-day-client"), { ssr: false });
const StrategyClient = dynamic(() => import("../strategy/strategy-client"), { ssr: false });
const ScoutingClient = dynamic(() => import("../scouting/scouting-client"), { ssr: false });
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
        if (tab === "scouting") {
          return (
            <HubOrgGate orgId={orgId} label="Scouting">
              {(id) => <ScoutingClient orgId={id} />}
            </HubOrgGate>
          );
        }
        return null;
      }}
    </ProductHubShell>
  );
}