"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";
import "../code/code.css";

const KickoffClient = dynamic(() => import("../kickoff/kickoff-client"), { ssr: false });
const CadWorkspace = dynamic(() => import("../cad/cad-client"), { ssr: false });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false });
const FmeaClient = dynamic(() => import("../fmea/fmea-client"), { ssr: false });
const BatteriesClient = dynamic(() => import("../batteries/batteries-client"), { ssr: false });

export default function BuildHub() {
  return (
    <ProductHubShell hubId="build">
      {({ tab, orgId }) => {
        if (tab === "kickoff") return <KickoffClient />;
        if (tab === "fmea") return <FmeaClient />;
        if (tab === "batteries") return <BatteriesClient />;
        if (tab === "code") {
          return (
            <HubOrgGate orgId={orgId} label="Code">
              {(id) => <CodeClient orgId={id} />}
            </HubOrgGate>
          );
        }
        if (tab === "cad") {
          return (
            <HubOrgGate orgId={orgId} label="CAD">
              {(id) => <CadWorkspace orgId={id} />}
            </HubOrgGate>
          );
        }
        return <HubLegacyRedirect hubId="build" tab={tab} orgId={orgId} />;
      }}
    </ProductHubShell>
  );
}
