import AiKeysClient from "./ai-keys-client";

export const metadata = {
  title: "AI API keys · Vantage",
  description:
    "Add your OpenAI, Anthropic, or Google Gemini API keys — envelope-encrypted. Free uses your keys; paid adds hosted AI cheaper than own keys.",
};

export default async function TeamAiKeysPage({
  searchParams,
}: {
  searchParams: Promise<{ orgId?: string }>;
}) {
  const { orgId } = await searchParams;
  return <AiKeysClient orgId={orgId ?? null} />;
}
