"use client";

import dynamic from "next/dynamic";
import { HubLegacyRedirect, ProductHubShell } from "../../components/product-hub";
import { MEDIA_HUB_TABS, type MediaHubTab } from "../../lib/media";
import "../product-hub.css";

const MediaClient = dynamic(() => import("./media-client"), { ssr: false });

function isMediaTab(value: string): value is MediaHubTab {
  return (MEDIA_HUB_TABS as readonly string[]).includes(value);
}

/**
 * Media hub — ProductHubShell owns the header, TabBar, tool strip, and hub-access
 * filtering; the media client owns the workspace data and the per-tab panels.
 * Nested tools with their own route (Media library) link straight there.
 */
export default function MediaHub() {
  return (
    <ProductHubShell hubId="media" embeddedTabs={MEDIA_HUB_TABS}>
      {({ tab, orgId }) =>
        isMediaTab(tab) ? (
          <MediaClient tab={tab} />
        ) : (
          <HubLegacyRedirect hubId="media" tab={tab} orgId={orgId} />
        )
      }
    </ProductHubShell>
  );
}
