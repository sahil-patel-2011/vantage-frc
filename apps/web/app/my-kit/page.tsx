import MyKitClient from "./my-kit-client";

/** Session-scoped, per-person data: never prerendered. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Kit",
  description:
    "What you personally need tonight from real assignments and packing that belong to you — never a template kit.",
};

export default function MyKitPage() {
  return <MyKitClient />;
}
