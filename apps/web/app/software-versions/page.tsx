import SoftwareVersionsClient from "./software-versions-client";

export const metadata = {
  title: "Software versions",
};

export default async function SoftwareVersionsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <SoftwareVersionsClient orgId={orgId ?? null} />;
}
