/**
 * Whether a self-signup code (migration 0515) will actually let someone in, and how to say so.
 *
 * A code stops working for three independent reasons — revoked, past its expiry, or out of
 * uses — and the redeem path in `redeem_org_join_code` rejects all three. The panel has to
 * agree with that function, otherwise an owner reads "Live" next to a code that turns people
 * away. Keeping the rule here, off the component, is what lets it be tested against the
 * boundaries rather than eyeballed.
 */

export type JoinCodeLimits = {
  uses: number;
  maxUses: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
};

export type JoinCodeState = {
  label: "Live" | "Off" | "Expired" | "Used up";
  tone: "live" | "off";
};

/** Revoked beats expired beats used-up, so the owner sees the reason they can act on. */
export function joinCodeState(code: JoinCodeLimits, now: number = Date.now()): JoinCodeState {
  if (code.revokedAt) return { label: "Off", tone: "off" };
  if (code.expiresAt && new Date(code.expiresAt).getTime() <= now) {
    return { label: "Expired", tone: "off" };
  }
  if (code.maxUses !== null && code.uses >= code.maxUses) {
    return { label: "Used up", tone: "off" };
  }
  return { label: "Live", tone: "live" };
}

/**
 * "3 of 10 used · expires 3/1/2026". Unlimited codes report what has happened rather than
 * an invented ceiling, and a past expiry reads "expired" so the row is not quietly wrong.
 */
export function joinCodeLimits(code: JoinCodeLimits, now: number = Date.now()): string {
  const parts: string[] = [
    code.maxUses === null ? `${code.uses} joined` : `${code.uses} of ${code.maxUses} used`,
  ];
  if (code.expiresAt) {
    const when = new Date(code.expiresAt);
    parts.push(
      when.getTime() <= now
        ? `expired ${when.toLocaleDateString()}`
        : `expires ${when.toLocaleDateString()}`,
    );
  }
  return parts.join(" · ");
}
