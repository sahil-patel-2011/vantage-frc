import InventoryClient from "./inventory-client";
import "./inventory.css";

export const metadata = {
  title: "Inventory & BOM",
  description: "Track parts and materials stock, locations, and per-mechanism bills of materials.",
};

export default function InventoryPage() {
  return <InventoryClient />;
}
