import AdminPlansClient from "./plans-client";

export const metadata = {
  title: "Org plans",
};

export const dynamic = "force-dynamic";

export default function AdminPlansPage() {
  return <AdminPlansClient />;
}
