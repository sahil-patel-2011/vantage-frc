import { redirect } from "next/navigation";

/**
 * Retired: the commercial (pricing ladder) page only made sense for selling, and Vantage is
 * free. /api/admin/commercial stays for code that imports it; the page goes to the Overview.
 */
export default function CommercialPage() {
  redirect("/admin");
}
