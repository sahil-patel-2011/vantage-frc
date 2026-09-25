import AdminClient from "./admin-client";

export const metadata = {
  title: "Platform admin",
};

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminClient />;
}
