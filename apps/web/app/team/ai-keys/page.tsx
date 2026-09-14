import AiKeysClient from "./ai-keys-client";

export const metadata = {
  title: "AI keys",
  description:
    "Add OpenAI, Anthropic, Google, or OpenRouter keys — envelope-encrypted. Free uses the OpenRouter pool or your keys; paid uses hosted Anthropic.",
};

export default async function TeamAiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <AiKeysClient orgId={orgId ?? null} />;
}
