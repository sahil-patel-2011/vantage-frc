import StorefrontClient from "./storefront-client";
import "./storefront.css";

export default async function SupportPage({ params }: { params: Promise<{ publicId: string }> }) {
  const { publicId } = await params;
  return <StorefrontClient publicId={publicId} />;
}
