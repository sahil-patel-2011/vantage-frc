import FormsClient from "./forms-client";
import "./forms.css";

export const metadata = {
  title: "Forms",
  description:
    "Build intake, tryout, mentor, dues, travel and feedback forms, assign them, and read what the answers mean.",
};

export default function FormsPage() {
  return <FormsClient />;
}
