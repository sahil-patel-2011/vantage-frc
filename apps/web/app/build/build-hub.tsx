"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";
import "../code/code.css";

const KickoffClient = dynamic(() => import("../kickoff/kickoff-client"), { ssr: false });
const CadWorkspace = dynamic(() => import("../cad/cad-client"), { ssr: false });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false });
const FmeaClient = dynamic(() => import("../fmea/fmea-client"), { ssr: false });
const PrototypeTrackerClient = dynamic(() => import("../prototype-tracker/prototype-tracker-client"), {
  ssr: false,
});
const BatteriesClient = dynamic(() => import("../batteries/batteries-client"), { ssr: false });

export default function BuildHub() {
  return (
    <ProductHubShell hubId="build">
      {({ tab, orgId }) => {
        if (tab === "kickoff") return <KickoffClient embedded />;
        if (tab === "fmea") return <FmeaClient embedded />;
        if (tab === "prototype") return <PrototypeTrackerClient embedded />;
        if (tab === "batteries") return <BatteriesClient embedded />;
        if (tab === "code" || tab === "bugbot") {
          return (
            <HubOrgGate orgId={orgId} label={tab === "bugbot" ? "AI Bugbot" : "Code"}>
              {(id) => <CodeClient orgId={id} embedded />}
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
