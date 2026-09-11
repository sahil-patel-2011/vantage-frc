import dynamic from "next/dynamic";

const TeamHub = dynamic(() => import("./team-hub"));

export const metadata = {
  title: "Team",
  description: "Calendar, chat, people, work, and the playbook.",
};

export default function TeamPage() {
  return <TeamHub />;
}
