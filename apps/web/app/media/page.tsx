import { redirect } from "next/navigation";
import { MEDIA_HUB_TABS } from "../../lib/media";
import { hubById, hubLegacyHref } from "../../lib/nav/hubs";
import MediaClient from "./media-client";

export default async function MediaPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; orgId?: string }>;
}) {
  const { tab, orgId } = await searchParams;
  if (tab && !(MEDIA_HUB_TABS as readonly string[]).includes(tab)) {
    const nested = hubById("media").tabs.find((entry) => entry.id === tab);
    if (nested?.legacyHref) {
      redirect(hubLegacyHref(nested, orgId ?? null));
    }
  }
  return <MediaClient />;
}
