import SharePageClient from "./share-client";
import "../../files/files.css";
import "./share.css";

export const metadata = {
  title: "Shared with you",
  description: "A file an FRC team shared with you on Vantage.",
  // A share link must not end up in search results with the team's file names
  // attached to it.
  robots: { index: false, follow: false },
};

export default async function DriveSharePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <SharePageClient token={token} />;
}
