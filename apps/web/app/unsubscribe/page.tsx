import UnsubscribeClient from "./unsubscribe-client";

export default async function UnsubscribePage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; category?: string }>;
}) {
  const params = await searchParams;
  return <UnsubscribeClient token={params.token?.trim() ?? ""} category={params.category?.trim() ?? "all"} />;
}
