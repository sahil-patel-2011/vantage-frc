import AiUsageClient from "./ai-usage-client";

export const metadata = {
  title: "BYOK usage",
  description:
    "Bring-your-own-key AI call counts and estimated cost from public list rates — not an invoice.",
};

export default async function TeamByokUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <AiUsageClient orgId={orgId ?? null} />;
}
