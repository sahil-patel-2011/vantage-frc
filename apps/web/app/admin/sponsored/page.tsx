import SponsoredClient from "./sponsored-client";

export const metadata = {
  title: "Sponsored · Admin",
};

export const dynamic = "force-dynamic";

export default function AdminSponsoredPage() {
  return <SponsoredClient />;
}
