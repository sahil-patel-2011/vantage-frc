import {
  createCreditPackCheckout,
  createCustomerPortal,
  createPaygEnrollment,
  createPlanCheckout,
} from "@vantage/billing";
import { auth } from "@vantage/core";
import { withRls } from "@vantage/db";
import { headers } from "next/headers";

export async function POST(request: Request) {
  try {
    const session = await auth.api.getSession({ headers: await headers() });
    if (!session) return Response.json({ error: "Authentication required" }, { status: 401 });
    const body = (await request.json()) as {
      orgId?: string; action?: "subscription" | "credits" | "payg" | "portal";
      planCode?: string; packCode?: string;
    };
    if (!body.orgId || !body.action) return Response.json({ error: "Organization and billing action are required" }, { status: 400 });
    const origin = new URL(request.url).origin;
    const checkout = await withRls({ userId: session.user.id, orgId: body.orgId }, async (client) => {
      const allowed = await client.query(
        `SELECT 1 FROM memberships WHERE org_id=$1 AND user_id=$2 AND role IN ('owner','admin')`,
        [body.orgId, session.user.id],
      );
      if (!allowed.rowCount) throw new Error("Organization administrator access required");
      const urls = {
        orgId: body.orgId!,
        successUrl: `${origin}/workspace?orgId=${body.orgId}`,
        cancelUrl: `${origin}/workspace?orgId=${body.orgId}`,
      };
      if (body.action === "subscription") {
        if (!body.planCode) throw new Error("planCode is required");
        return createPlanCheckout(client, { ...urls, planCode: body.planCode });
      }
      if (body.action === "credits") {
        if (!body.packCode) throw new Error("packCode is required");
        return createCreditPackCheckout(client, { ...urls, packCode: body.packCode });
      }
      if (body.action === "payg") return createPaygEnrollment(client, urls);
      return createCustomerPortal(client, {
        orgId: body.orgId!,
        returnUrl: `${origin}/workspace?orgId=${body.orgId}`,
      });
    });
    return Response.json({ url: checkout.url });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Checkout unavailable" }, { status: 400 });
  }
}
