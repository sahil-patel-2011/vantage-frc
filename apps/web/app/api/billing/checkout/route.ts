import {
  createCreditPackCheckout,
  createCustomerPortal,
  createPaygEnrollment,
  createPlanCheckout,
  isStripeNotConfigured,
} from "@vantage/billing";
import { assertOrgCapability, auth } from "@vantage/core";
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
      await assertOrgCapability(client, body.orgId!, "manage_billing");
      const urls = {
        orgId: body.orgId!,
        successUrl: `${origin}/workspace?orgId=${body.orgId}`,
        cancelUrl: `${origin}/workspace?orgId=${body.orgId}`,
      };
      if (body.action === "subscription") {
        if (!body.planCode) throw new Error("planCode is required");
        return createPlanCheckout(client, {
          ...urls,
          planCode: body.planCode,
          successUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
          cancelUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
        });
      }
      if (body.action === "credits") {
        if (!body.packCode) throw new Error("packCode is required");
        return createCreditPackCheckout(client, {
          ...urls,
          packCode: body.packCode,
          successUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
          cancelUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
        });
      }
      if (body.action === "payg") {
        return createPaygEnrollment(client, {
          ...urls,
          successUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
          cancelUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
        });
      }
      return createCustomerPortal(client, {
        orgId: body.orgId!,
        returnUrl: `${origin}/team/budgets?orgId=${body.orgId}`,
      });
    });
    return Response.json({ url: checkout.url });
  } catch (error) {
    // An upgrade click on a deployment with no Stripe keys is a setup problem,
    // not a bad request: 503 with the variable names, so the Upgrade button can
    // say what is missing instead of "Checkout unavailable".
    if (isStripeNotConfigured(error)) {
      return Response.json({ error: error.message, missingEnv: error.missingEnv }, { status: 503 });
    }
    return Response.json({ error: error instanceof Error ? error.message : "Checkout unavailable" }, { status: 400 });
  }
}
