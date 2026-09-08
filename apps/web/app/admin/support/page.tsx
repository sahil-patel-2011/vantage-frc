import AdminSupportClient from "./support-client";

export const metadata = {
  title: "Support tickets",
};

export const dynamic = "force-dynamic";

export default function AdminSupportPage() {
  return <AdminSupportClient />;
}
