import AnnouncementsClient from "./announcements-client";
import "./announcements.css";

export const metadata = {
  title: "Announcements",
  description: "Post to the whole team, and see who has read the things that matter.",
};

export default function AnnouncementsPage() {
  return <AnnouncementsClient />;
}
