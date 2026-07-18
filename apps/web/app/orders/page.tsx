import OrdersClient from "./orders-client";
import "./orders.css";

export const metadata = {
  title: "Orders · Vantage",
  description: "Submit purchase needs, get admin approval, and buy on the vendor site — never enter card details here.",
};

export default function OrdersPage() {
  return <OrdersClient />;
}
