import AdminsClient from "./admins-client";

export const metadata = {
  title: "Platform admins",
};

export const dynamic = "force-dynamic";

/** Who runs Vantage: add, remove and hand over Platform admin. */
export default function AdminAdminsPage() {
  return <AdminsClient />;
}
