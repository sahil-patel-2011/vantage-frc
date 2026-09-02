"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, ProductHubShell } from "../../components/product-hub";
import { BUSINESS_EMBEDDED_TABS, isBusinessTab } from "./business-tabs";
import "../product-hub.css";

const BusinessClient = dynamic(() => import("./business-client"), { ssr: false });

/**
 * Business hub — ProductHubShell owns the header, workbench TabBar, tool strip,
 * hub-access and sponsors_allowed filtering; the portal client owns the data
 * and the per-tab panels. Tools with their own route redirect there.
 */
export default function BusinessHub() {
  return (
    <ProductHubShell hubId="business" embeddedTabs={BUSINESS_EMBEDDED_TABS}>
      {({ tab, orgId, selectTab }) =>
        isBusinessTab(tab) ? (
          <BusinessClient tab={tab} selectTab={selectTab} />
        ) : (
          <HubLegacyRedirect hubId="business" tab={tab} orgId={orgId} />
        )
      }
    </ProductHubShell>
  );
}
