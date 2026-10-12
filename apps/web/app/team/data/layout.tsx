import { SettingsLayout } from "../../../components/settings-layout";

/** Settings: this page sits in the one Settings frame (the list beside it on wider screens). */
export default function Layout({ children }: { children: React.ReactNode }) {
  return <SettingsLayout>{children}</SettingsLayout>;
}
