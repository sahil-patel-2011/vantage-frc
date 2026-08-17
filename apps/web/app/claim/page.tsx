import ClaimWorkspaceClient from "./claim-client";

export const metadata = {
  title: "Claim your team · Vantage",
  description: "Self-serve FRC team workspace claim against the TBA cache.",
};

export default function ClaimPage() {
  return <ClaimWorkspaceClient />;
}
