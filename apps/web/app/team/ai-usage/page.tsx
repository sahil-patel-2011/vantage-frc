import AiUsageClient from "./ai-usage-client";

export const metadata = {
  title: "Your keys usage",
  description:
    "AI call counts from your own keys and estimated cost from public list rates — not an invoice.",
};

export default async function TeamByokUsagePage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <AiUsageClient orgId={orgId ?? null} />;
}
