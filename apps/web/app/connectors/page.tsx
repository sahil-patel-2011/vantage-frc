import ConnectorsClient from "./connectors-client";

export const metadata = {
  title: "Connectors",
};

/**
 * Deliberately takes no required query string. Every other connector surface in
 * the app answers a bare visit with "Choose your team"; this page is reached
 * from the settings menu, so it resolves the caller's own membership server-side
 * and shows deployment-level configuration even when there is no team at all.
 */
export default async function ConnectorsPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId = "" } = await searchParams;
  return <ConnectorsClient key={orgId} />;
}
