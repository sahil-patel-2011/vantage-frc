import JoinByCodeClient from "./join-client";

export const metadata = {
  title: "Join your team · Vantage",
  description: "Join an existing FRC team workspace with the code your team leader gave you.",
};

export default function JoinPage() {
  return <JoinByCodeClient />;
}
