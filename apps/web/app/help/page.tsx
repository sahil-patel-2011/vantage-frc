import HelpClient from "./help-client";

export const metadata = {
  title: "Help",
};

export const dynamic = "force-dynamic";

export default function HelpPage() {
  return <HelpClient />;
}
