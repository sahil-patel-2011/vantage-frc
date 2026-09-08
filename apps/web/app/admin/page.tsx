import AdminClient from "./admin-client";

export const metadata = {
  title: "Global Team Manager",
};

export const dynamic = "force-dynamic";

export default function AdminPage() {
  return <AdminClient />;
}
