import AdminClient from "../admin-client";

export const metadata = {
  title: "Teams · Platform admin",
};

export const dynamic = "force-dynamic";

/** Every team; each opens a panel with its owner invite, AI credit and delete. */
export default function AdminTeamsPage() {
  return <AdminClient />;
}
