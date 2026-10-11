import { LEARN_PAGE_DESCRIPTION } from "../../lib/learn/resources";
import { LearnResources } from "./learn-resources";
import "./learn-resources.css";

export const metadata = {
  title: "Learn",
  description: LEARN_PAGE_DESCRIPTION,
};

export default function LearnResourcesPage() {
  return <LearnResources />;
}
