import { loadAccountView } from "../api/account/route";
import { requirePageUser } from "../../lib/page-org";
import AccountClient from "./account-client";
import type { AccountView } from "./account-types";

export const metadata = {
  title: "Account",
};

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const user = await requirePageUser("/account");
  const account = await loadAccountView({
    user: {
      id: user.id,
      email: user.email ?? "",
      name: user.name,
      image: user.image,
    },
  }).catch(() => null);
  return <AccountClient initial={account as AccountView | null} />;
}
