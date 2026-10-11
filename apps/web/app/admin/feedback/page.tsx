import AdminFeedbackClient from "./feedback-client";

export const metadata = {
  title: "Feedback",
};

export const dynamic = "force-dynamic";

export default function AdminFeedbackPage() {
  return <AdminFeedbackClient />;
}
