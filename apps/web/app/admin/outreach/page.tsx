import OutreachClient from "./outreach-client";

export const metadata = {
  title: "Organization outreach",
};

export const dynamic = "force-dynamic";

export default function AdminOutreachPage() {
  return <OutreachClient />;
}
