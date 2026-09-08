import WhatsNewClient from "./whats-new-client";

export const metadata = {
  title: "What’s new",
};

export const dynamic = "force-dynamic";

export default function WhatsNewPage() {
  return <WhatsNewClient />;
}
