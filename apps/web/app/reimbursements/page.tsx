import ReimbursementsClient from "./reimbursements-client";

export const metadata = {
  title: "Reimbursements",
  description:
    "File out-of-pocket claims with a receipt photo, approve and pay them, and see the season's budget versus actual spend.",
};

export default function ReimbursementsPage() {
  return <ReimbursementsClient />;
}
