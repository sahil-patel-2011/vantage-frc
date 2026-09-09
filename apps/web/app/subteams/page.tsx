import SubteamsClient from "./subteams-client";
import "./subteams.css";

export const metadata = {
  title: "Subteams",
  description: "Who is on each subteam, and what each of them still owes.",
};

export default function SubteamsPage() {
  return <SubteamsClient />;
}
