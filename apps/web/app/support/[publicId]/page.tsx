import StorefrontClient from "./storefront-client";
import "./storefront.css";

// Loaded client-side from the public id, so the team name is not available to
// the tab here; keep the label plain rather than falling back to the marketing one.
export const metadata = {
  title: "Support this team",
  description: "Sponsorship packages for this FIRST Robotics Competition team.",
};

export default async function SupportPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <StorefrontClient publicId={publicId} />;
}
