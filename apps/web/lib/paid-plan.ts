/** Plan codes that are free / BYOK-only — no paid-session splash. */
const FREE_OR_BYOK_PLAN_CODES = new Set(["free"]);

const ACTIVE_ENTITLEMENT_STATUSES = new Set(["active", "trialing"]);

export type OrgEntitlementSnapshot = {
  planCode: string | null | undefined;
  status: string | null | undefined;
};

/**
 * True when the org has an active/trialing entitlement that is not Free (BYOK-only).
 * Missing entitlement rows and expired/revoked statuses are treated as unpaid.
 */
export function isPayingOrgEntitlement(input: OrgEntitlementSnapshot): boolean {
  const planCode = input.planCode?.trim().toLowerCase();
  const status = input.status?.trim().toLowerCase();
  if (!planCode || !status) return false;
  if (!ACTIVE_ENTITLEMENT_STATUSES.has(status)) return false;
  return !FREE_OR_BYOK_PLAN_CODES.has(planCode);
}

export const PAID_SPLASH_SESSION_PREFIX = "vantage.paidSplash.v1";

export function paidSplashStorageKey(orgId: string): string {
  return `${PAID_SPLASH_SESSION_PREFIX}:${orgId}`;
}

export function shouldShowPaidSessionSplash(input: {
  paidOrg: boolean;
  teamNumber: number | null | undefined;
  orgId: string | null | undefined;
  alreadyShown: boolean;
}): boolean {
  return Boolean(
    input.paidOrg &&
      input.orgId &&
      input.teamNumber != null &&
      Number.isFinite(input.teamNumber) &&
      !input.alreadyShown,
  );
}
