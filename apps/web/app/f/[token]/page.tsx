import PublicFormClient from "./public-form-client";
import "../../forms/forms.css";
import "./public-form.css";

export const metadata = {
  title: "Form",
  description: "Answer a form shared with you by an FRC team.",
  // A shared intake link should not end up in search results with a team's
  // question set attached to it.
  robots: { index: false, follow: false },
};

export default async function PublicFormPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  return <PublicFormClient token={token} />;
}
