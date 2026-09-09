import FormDetailClient from "./form-detail-client";
import "../forms.css";

export const metadata = {
  title: "Form",
  description: "Build the questions, collect answers, and read what they mean.",
};

export default async function FormDetailPage({
  params,
}: {
  params: Promise<{ formId: string }>;
}) {
  const { formId } = await params;
  return <FormDetailClient formId={formId} />;
}
