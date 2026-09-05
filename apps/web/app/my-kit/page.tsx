import MyKitClient from "./my-kit-client";

/** Session-scoped, per-person data: never prerendered. */
export const dynamic = "force-dynamic";

export const metadata = {
  title: "My Kit",
  description:
    "Everything assigned to you personally — tasks, meetings, duties, scouting, hours, skills, tools, and money — composed from the surfaces that own each record.",
};

export default function MyKitPage() {
  return <MyKitClient />;
}
