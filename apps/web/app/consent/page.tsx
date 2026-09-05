import ConsentClient from "./consent-client";

export const metadata = {
  title: "Consent",
};

export default async function ConsentPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <ConsentClient orgId={orgId ?? null} />;
}
