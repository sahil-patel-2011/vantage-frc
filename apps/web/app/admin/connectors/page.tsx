import DataConnectorClient from "./connector-client";

export const metadata = {
  title: "Connectors · Admin",
};

/** Platform TBA connector — gated by `admin/layout.tsx` via `platform_admins`. */
export default function ConnectorsPage() {
  return <DataConnectorClient />;
}
