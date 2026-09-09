import BudgetClient from "./budget-client";
import "./budget.css";

export const metadata = {
  title: "Season budget",
  description: "The team's season budget and what has really been spent against it.",
};

export default function BudgetPage() {
  return <BudgetClient />;
}
