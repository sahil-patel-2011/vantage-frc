import OrdersClient from "./orders-client";

export const metadata = {
  title: "Orders · Vantage",
  description:
    "Submit purchase needs, get admin approval, then open the vendor buy link — never enter card details or DEMO order totals here.",
};

export default function OrdersPage() {
  return <OrdersClient />;
}
