import KnowledgeDraftsClient from "./knowledge-drafts-client";

export const metadata = {
  title: "Knowledge Drafts",
  description:
    "Capture-from-work review queue: accepted decisions, resolved incidents, and resolved pit repairs propose a Playbook page. Nothing publishes without a human Approve.",
};

export default function KnowledgeDraftsPage() {
  return <KnowledgeDraftsClient />;
}
