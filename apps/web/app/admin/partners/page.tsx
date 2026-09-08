import PartnersClient from "./partners-client";

export const metadata = {
  title: "App sponsors & AI partners",
};

export const dynamic = "force-dynamic";

export default function AdminPartnersPage() {
  return <PartnersClient />;
}
