import { redirect } from "next/navigation";

/** Legacy Settings nav path — Soft-UI tickets live at `/support`. */
export default function HelpRedirectPage() {
  redirect("/support");
}
