import RecognitionClient from "./recognition-client";

export const metadata = {
  title: "Recognition",
};

export default async function RecognitionPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <RecognitionClient orgId={orgId ?? null} />;
}
