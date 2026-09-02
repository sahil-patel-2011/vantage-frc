"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, HubOrgGate, ProductHubShell } from "../../components/product-hub";
import "../product-hub.css";
import "../code/code.css";

const KickoffClient = dynamic(() => import("../kickoff/kickoff-client"), { ssr: false });
const CadWorkspace = dynamic(() => import("../cad/cad-client"), { ssr: false });
const CadVaultClient = dynamic(() => import("../cad-vault/cad-vault-client"), { ssr: false });
const CodeClient = dynamic(() => import("../code/code-client").then((m) => m.CodeClient), { ssr: false });
const FmeaClient = dynamic(() => import("../fmea/fmea-client"), { ssr: false });
const PrototypeTrackerClient = dynamic(() => import("../prototype-tracker/prototype-tracker-client"), {
  ssr: false,
});
const BatteriesClient = dynamic(() => import("../batteries/batteries-client"), { ssr: false });

/** Tab ids rendered inline below. Anything else opens its own route directly. */
const EMBEDDED_TABS = ["kickoff", "fmea", "prototype", "batteries", "code", "bugbot", "cad", "cad-vault"] as const;

export default function BuildHub() {
  return (
    <ProductHubShell hubId="build" embeddedTabs={EMBEDDED_TABS}>
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
        if (tab === "cad-vault") {
          // The vault client reads orgId from the URL the hub already carries.
          return (
            <HubOrgGate orgId={orgId} label="CAD vault">
              {() => <CadVaultClient embedded />}
            </HubOrgGate>
          );
        }
        return <HubLegacyRedirect hubId="build" tab={tab} orgId={orgId} />;
      }}
    </ProductHubShell>
  );
}
