import AdminAuditClient from "./audit-client";

export const metadata = {
  title: "Audit · Admin",
};

export const dynamic = "force-dynamic";

export default function AdminAuditPage() {
  return <AdminAuditClient />;
}
