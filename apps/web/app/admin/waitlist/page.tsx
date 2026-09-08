import WaitlistAdminClient from "./waitlist-client";

export const metadata = {
  title: "Waitlist",
};

export const dynamic = "force-dynamic";

export default function AdminWaitlistPage() {
  return <WaitlistAdminClient />;
}
