import ClaimWorkspaceClient from "./claim-client";

export const metadata = {
  title: "Claim your team",
  description: "Self-serve FRC team claim against the TBA cache.",
};

export default function ClaimPage() {
  return <ClaimWorkspaceClient />;
}
