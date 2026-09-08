import TuningClient from "./tuning-client";

export const metadata = {
  title: "Tuning log",
};

export default async function TuningPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <TuningClient orgId={orgId ?? null} />;
}
