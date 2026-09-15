import ClaimWorkspaceClient from "./claim-client";

export const metadata = {
  title: "Claim your team",
  description: "Coaches: create your team account, then share a join link.",
};

export default function ClaimPage() {
  return <ClaimWorkspaceClient />;
}
