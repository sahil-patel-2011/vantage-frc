import WallClient from "./wall-client";
import "./public-wall.css";

export default async function PublicSponsorWallPage({
  params,
}: {
  params: Promise<{ publicId: string }>;
}) {
  const { publicId } = await params;
  return <WallClient publicId={publicId} />;
}
