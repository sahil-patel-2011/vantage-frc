"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, HubPanelSkeleton, ProductHubShell } from "../../components/product-hub";
import KickoffClient from "../kickoff/kickoff-client";
import type { KickoffView } from "../../lib/kickoff";
import "../product-hub.css";
import "../code/code.css";
import "../kickoff/kickoff.css";
import "../robot/robot.css";

const CadWorkspace = dynamic(() => import("../cad/cad-client"), { ssr: false, loading: HubPanelSkeleton });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false, loading: HubPanelSkeleton });
const FmeaClient = dynamic(() => import("../fmea/fmea-client"), { ssr: false, loading: HubPanelSkeleton });
const PrototypeTrackerClient = dynamic(() => import("../prototype-tracker/prototype-tracker-client"), {
  ssr: false,
  loading: HubPanelSkeleton,
});
const BatteriesClient = dynamic(() => import("../batteries/batteries-client"), { ssr: false, loading: HubPanelSkeleton });
const RobotClient = dynamic(() => import("../robot/robot-client"), { ssr: false, loading: HubPanelSkeleton });

/** Tab ids rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = ["kickoff", "fmea", "prototype", "batteries", "code", "bugbot", "cad", "robot"] as const;

export default function BuildHub({
  initialTab,
  initialOrgId = null,
  initialKickoff = null,
}: {
  initialTab?: string | null;
  initialOrgId?: string | null;
  initialKickoff?: KickoffView | null;
}) {
  return (
    <ProductHubShell hubId="build" embeddedTabs={EMBEDDED_TABS} initialTab={initialTab} initialOrgId={initialOrgId}>
      {({ tab, orgId }) => {
        if (tab === "kickoff") {
          return (
            <HubOrgGate orgId={orgId} label="Kickoff">
              {() => <KickoffClient embedded initialView={initialKickoff} />}
            </HubOrgGate>
          );
        }
        if (tab === "fmea") {
          return (
            <HubOrgGate orgId={orgId} label="Robot">
              {() => <FmeaClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "prototype") {
          return (
            <HubOrgGate orgId={orgId} label="Prototypes">
              {() => <PrototypeTrackerClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "batteries") {
          return (
            <HubOrgGate orgId={orgId} label="Batteries">
              {() => <BatteriesClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "code" || tab === "bugbot") {
          return (
            <HubOrgGate orgId={orgId} label={tab === "bugbot" ? "AI Bugbot" : "Code"}>
              {(id) => <CodeClient orgId={id} embedded focusBugbot={tab === "bugbot"} />}
            </HubOrgGate>
          );
        }
        if (tab === "robot") {
          // In the hub, so the Kickoff · CAD · Code · Robot tabs stay (it used to open /robot alone).
          return (
            <HubOrgGate orgId={orgId} label="Robot">
              {() => <RobotClient embedded />}
            </HubOrgGate>
          );
        }
        if (tab === "cad") {
          return (
            <HubOrgGate orgId={orgId} label="CAD">
              {(id) => <CadWorkspace orgId={id} embedded />}
            </HubOrgGate>
          );
        }
        return <HubLegacyRedirect hubId="build" tab={tab} orgId={orgId} />;
      }}
    </ProductHubShell>
  );
}
