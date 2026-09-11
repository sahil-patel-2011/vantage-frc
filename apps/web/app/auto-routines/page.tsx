import AutoRoutinesClient from "./auto-routines-client";

export const metadata = {
  title: "Auto routines",
};

export default async function AutoRoutinesPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <AutoRoutinesClient orgId={orgId ?? null} />;
}
