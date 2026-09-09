import DocRolesClient from "./doc-roles-client";
import "./doc-roles.css";

export const metadata = {
  title: "Document roles",
  description: "Who can create and edit the team's docs, and who may hand that role out.",
};

export default function DocRolesPage() {
  return <DocRolesClient />;
}
