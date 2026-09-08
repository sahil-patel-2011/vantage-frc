import NotebookClient from "./notebook-client";

export const metadata = {
  title: "Engineering notebook",
};

export default async function NotebookPage({ searchParams }: { searchParams: Promise<{ orgId?: string }> }) {
  const { orgId } = await searchParams;
  return <NotebookClient orgId={orgId ?? null} />;
}
