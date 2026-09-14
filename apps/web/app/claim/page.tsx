import ClaimWorkspaceClient from "./claim-client";

export const metadata = {
  title: "Claim your team",
  description: "Self-serve FRC team claim against the official team list.",
};

export default function ClaimPage() {
  return <ClaimWorkspaceClient />;
}
