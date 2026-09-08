import AdminReleasesClient from "./releases-client";

export const metadata = {
  title: "Product releases",
};

export const dynamic = "force-dynamic";

export default function AdminReleasesPage() {
  return <AdminReleasesClient />;
}
