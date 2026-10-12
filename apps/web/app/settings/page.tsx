import { SettingsHome } from "../../components/settings-layout";

export const metadata = {
  title: "Settings",
};

/** One place for settings: You, then This team (what your role allows). */
export default function SettingsPage() {
  return <SettingsHome />;
}
