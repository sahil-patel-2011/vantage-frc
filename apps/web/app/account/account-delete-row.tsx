"use client";

import { useState } from "react";
import { KitRow } from "../../components/ui/kit";
import { AccountDeleteDialog } from "./teams/lifecycle-dialogs";

/**
 * "Delete account" at the end of the Account card: red, and it asks for the email address before
 * anything happens (QA A3-05; the Privacy Policy promises account deletion controls). An owner who
 * runs a team is told to hand it over or delete it first, by the server, in the dialog.
 */
export function AccountDeleteRow({ email }: { email: string | null | undefined }) {
  const [open, setOpen] = useState(false);
  if (!email) return null;
  return (
    <>
      <KitRow
        icon="trash"
        tone="red"
        title="Delete account"
        subtitle="Leave every team and remove your account for good"
        onClick={() => setOpen(true)}
        danger
      />
      {open ? <AccountDeleteDialog email={email} onClose={() => setOpen(false)} /> : null}
    </>
  );
}
