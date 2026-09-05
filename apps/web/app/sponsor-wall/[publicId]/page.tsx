import WallClient from "./wall-client";
import "./public-wall.css";

// The wall's contents load client-side from the public id, so there is no team
// name to put in the tab here — a plain, honest label beats the marketing one.
export const metadata = {
  title: "Sponsor wall",
  description: "The sponsors backing this FIRST Robotics Competition team.",
};

export default async function PublicSponsorWallPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <WallClient publicId={publicId} />;
}
