import OrdersClient from "./orders-client";

export const metadata = {
  title: "Orders",
  description:
    "Submit purchase needs, get admin approval, then open the vendor buy link. Never enter card details here.",
};

export default function OrdersPage() {
  return <OrdersClient />;
}
