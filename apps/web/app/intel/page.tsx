import { withPagePaint } from "../../lib/page-org";
import IntelClient from "./intel-client";
import "./intel.css";

export const metadata = {
  title: "Research",
};

export const dynamic = "force-dynamic";

export default async function IntelPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  const resolved = await withPagePaint("/intel", orgId, async ({ orgId: id }) => id);
  return <IntelClient initialOrgId={resolved} />;
}
