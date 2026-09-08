import IntegrationsClient from "./integrations-client";

export const metadata = {
  title: "Integrations · Admin",
};

/** Platform-admin integration health — gated by `admin/layout.tsx` via `platform_admins`. */
export default function IntegrationsPage() {
  return <IntegrationsClient />;
}
