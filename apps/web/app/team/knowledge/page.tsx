import KnowledgeClient from "./knowledge-client";

export const metadata = {
  title: "Knowledge Base · Vantage",
  description:
    "Team wiki with structured handoff templates — preserve institutional knowledge across seasons.",
};

export default function TeamKnowledgePage() {
  return <KnowledgeClient />;
}
