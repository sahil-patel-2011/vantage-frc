import TeamTagsClient from "./team-tags-client";

export const metadata = {
  title: "Drive-team tags",
  description: "Qualitative tags on robots at your event.",
};

export default function TeamTagsPage() {
  return <TeamTagsClient />;
}
