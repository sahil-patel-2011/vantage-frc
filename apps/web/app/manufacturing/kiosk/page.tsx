import ShopKioskClient from "./shop-kiosk-client";
import "../shop-steps.css";

export const metadata = {
  title: "Shop kiosk",
  description: "Every part on the shop floor and the step it's on, for a tablet by the machines.",
};

export default function ShopKioskPage() {
  return <ShopKioskClient />;
}
