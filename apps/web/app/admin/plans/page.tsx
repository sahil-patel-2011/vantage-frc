import { redirect } from "next/navigation";

/**
 * Retired: org plans and Stripe price wiring only made sense for selling, and Vantage is free.
 * The client and /api/admin/plans stay for any code that still reads them; the page goes to the
 * Overview. AI for a team is now gifted credit (/admin/ai-credits).
 */
export default function AdminPlansPage() {
  redirect("/admin");
}
