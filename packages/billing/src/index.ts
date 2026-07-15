import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes
} from "node:crypto";
import {
  DecryptCommand,
  GenerateDataKeyCommand,
  KMSClient
} from "@aws-sdk/client-kms";
import type { PoolClient } from "@neondatabase/serverless";
import Stripe from "stripe";

export class CreditCapExceededError extends Error {
  constructor() {
    super("This organization has reached its Vantage AI credit limit.");
    this.name = "CreditCapExceededError";
  }
}

export class BillingDisabledError extends Error {
  constructor() {
    super("AI usage is currently disabled for this organization.");
    this.name = "BillingDisabledError";
  }
}

export type UsageReceipt<T> = {
  value: T;
  promptTokens: number;
  completionTokens: number;
  costUsd: number;
  model: string;
  provider: string;
};

export type MeteredAIInput<T> = {
  client: PoolClient;
  orgId: string;
  userId: string;
  feature: string;
  requestId: string;
  estimatedCostUsd: number;
  metadata?: Record<string, unknown>;
  invoke: (keySource: "platform" | "byo") => Promise<UsageReceipt<T>>;
};

/**
 * Must be called inside the same transaction established by withRls().
 * The billing row lock serializes the cap check, provider call, and ledger append.
 */
export async function meteredAI<T>(input: MeteredAIInput<T>): Promise<T> {
  if (input.estimatedCostUsd < 0) throw new Error("Estimated cost cannot be negative");
  const billing = await input.client.query<{
    tier: "free" | "starter" | "team" | "enterprise";
    credit_cap_usd: string;
    kill_switch: boolean;
    period_start: Date;
    period_end: Date;
  }>(
    `SELECT tier, credit_cap_usd, kill_switch, period_start, period_end
       FROM org_billing WHERE org_id = $1 FOR UPDATE`,
    [input.orgId]
  );
  const account = billing.rows[0];
  if (!account) throw new Error("Billing account is not configured");
  if (account.kill_switch) throw new BillingDisabledError();

  const keySource = account.tier === "free" ? "byo" : "platform";
  if (keySource === "byo") {
    const key = await input.client.query(
      "SELECT 1 FROM org_llm_keys WHERE org_id = $1 LIMIT 1",
      [input.orgId]
    );
    if (!key.rowCount) throw new Error("Free organizations must configure a BYO AI key");
  } else {
    const totals = await input.client.query<{ used: string; grants: string }>(
      `SELECT
         COALESCE((SELECT SUM(cost_usd) FROM ai_usage_events
           WHERE org_id = $1 AND created_at >= $2 AND created_at < $3), 0)::text AS used,
         COALESCE((SELECT SUM(amount_usd) FROM ai_credit_grants WHERE org_id = $1), 0)::text AS grants`,
      [input.orgId, account.period_start, account.period_end]
    );
    const used = Number(totals.rows[0]?.used ?? 0);
    const grants = Number(totals.rows[0]?.grants ?? 0);
    if (used + input.estimatedCostUsd > Number(account.credit_cap_usd) + grants) {
      throw new CreditCapExceededError();
    }
  }

  const receipt = await input.invoke(keySource);
  if (receipt.costUsd < 0) throw new Error("Provider returned a negative cost");
  await input.client.query(
    `INSERT INTO ai_usage_events
      (org_id, user_id, feature, model, provider, key_source, prompt_tokens,
       completion_tokens, total_tokens, cost_usd, request_id, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)`,
    [
      input.orgId,
      input.userId,
      input.feature,
      receipt.model,
      receipt.provider,
      keySource,
      receipt.promptTokens,
      receipt.completionTokens,
      receipt.promptTokens + receipt.completionTokens,
      receipt.costUsd,
      input.requestId,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  return receipt.value;
}

export interface KeyManagementService {
  readonly keyId: string;
  generateDataKey(): Promise<{ plaintext: Uint8Array; encrypted: Uint8Array }>;
  decryptDataKey(encrypted: Uint8Array): Promise<Uint8Array>;
}

export class AwsKmsService implements KeyManagementService {
  private readonly client: KMSClient;
  constructor(public readonly keyId: string, region = process.env.AWS_REGION) {
    if (!keyId) throw new Error("AWS KMS key ID is required");
    this.client = new KMSClient({ region });
  }

  async generateDataKey() {
    const result = await this.client.send(
      new GenerateDataKeyCommand({ KeyId: this.keyId, KeySpec: "AES_256" })
    );
    if (!result.Plaintext || !result.CiphertextBlob) throw new Error("KMS did not return key material");
    return { plaintext: result.Plaintext, encrypted: result.CiphertextBlob };
  }

  async decryptDataKey(encrypted: Uint8Array) {
    const result = await this.client.send(
      new DecryptCommand({ KeyId: this.keyId, CiphertextBlob: encrypted })
    );
    if (!result.Plaintext) throw new Error("KMS did not decrypt the data key");
    return result.Plaintext;
  }
}

/** Local-only KMS substitute. The configured passphrase is never persisted. */
export class LocalKmsService implements KeyManagementService {
  readonly keyId = "local-dev-kms";
  private readonly wrappingKey: Buffer;

  constructor(secret = process.env.DEV_KMS_MASTER_KEY ?? "change-this-local-only-key") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("LocalKmsService is forbidden in production");
    }
    this.wrappingKey = createHash("sha256").update(secret).digest();
  }

  async generateDataKey() {
    const plaintext = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.wrappingKey, nonce);
    const body = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      plaintext,
      encrypted: Buffer.concat([nonce, cipher.getAuthTag(), body])
    };
  }

  async decryptDataKey(encrypted: Uint8Array) {
    const value = Buffer.from(encrypted);
    const decipher = createDecipheriv("aes-256-gcm", this.wrappingKey, value.subarray(0, 12));
    decipher.setAuthTag(value.subarray(12, 28));
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
  }
}

export type EncryptedSecret = {
  ciphertext: string;
  nonce: string;
  authTag: string;
  encryptedDek: string;
  kmsKeyId: string;
};

export async function encryptSecret(
  plaintext: string,
  kms: KeyManagementService
): Promise<EncryptedSecret> {
  const dataKey = await kms.generateDataKey();
  try {
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", dataKey.plaintext, nonce);
    const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
    return {
      ciphertext: ciphertext.toString("base64"),
      nonce: nonce.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      encryptedDek: Buffer.from(dataKey.encrypted).toString("base64"),
      kmsKeyId: kms.keyId
    };
  } finally {
    Buffer.from(dataKey.plaintext).fill(0);
  }
}

export async function decryptSecret(
  encrypted: EncryptedSecret,
  kms: KeyManagementService
): Promise<string> {
  if (encrypted.kmsKeyId !== kms.keyId) throw new Error("KMS key mismatch");
  const dataKey = await kms.decryptDataKey(Buffer.from(encrypted.encryptedDek, "base64"));
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      dataKey,
      Buffer.from(encrypted.nonce, "base64")
    );
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
    return Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
      decipher.final()
    ]).toString("utf8");
  } finally {
    Buffer.from(dataKey).fill(0);
  }
}

export function createKms(): KeyManagementService {
  return process.env.AWS_KMS_KEY_ID
    ? new AwsKmsService(process.env.AWS_KMS_KEY_ID)
    : new LocalKmsService();
}

export function constructStripeEvent(payload: string | Buffer, signature: string): Stripe.Event {
  if (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET) {
    throw new Error("Stripe credentials are not configured");
  }
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe.webhooks.constructEvent(payload, signature, process.env.STRIPE_WEBHOOK_SECRET);
}

export async function applyStripeEvent(client: PoolClient, event: Stripe.Event): Promise<void> {
  if (!event.type.startsWith("customer.subscription.")) return;
  const subscription = event.data.object as Stripe.Subscription;
  await client.query(
    `UPDATE org_billing
       SET stripe_subscription_id = $1,
           period_start = to_timestamp($2),
           period_end = to_timestamp($3),
           kill_switch = $4
     WHERE stripe_customer_id = $5`,
    [
      subscription.id,
      subscription.items.data[0]?.current_period_start ?? 0,
      subscription.items.data[0]?.current_period_end ?? 0,
      subscription.status === "canceled" || subscription.status === "unpaid",
      typeof subscription.customer === "string" ? subscription.customer : subscription.customer.id
    ]
  );
}

export function evaluateManagedUsage(input: {
  includedRemainingUsd: number;
  estimatedCostUsd: number;
  paygOnly: boolean;
  paygEnabled: boolean;
  prepaidBalanceUsd: number;
  overageUsedUsd: number;
  overageSpendCapUsd: number;
  killSwitch: boolean;
}) {
  if (input.killSwitch) return { allowed: false, bucket: "blocked" as const, reason: "kill_switch" };
  if (!input.paygOnly && input.estimatedCostUsd <= input.includedRemainingUsd)
    return { allowed: true, bucket: "included" as const };
  if (!input.paygEnabled)
    return { allowed: false, bucket: "blocked" as const, reason: "payg_not_enabled" };
  if (input.estimatedCostUsd > input.prepaidBalanceUsd)
    return { allowed: false, bucket: "blocked" as const, reason: "insufficient_prepaid_balance" };
  if (input.overageUsedUsd + input.estimatedCostUsd > input.overageSpendCapUsd)
    return { allowed: false, bucket: "blocked" as const, reason: "spend_cap" };
  return { allowed: true, bucket: "payg" as const };
}

/** Creates a Stripe checkout only when an admin-configured Price ID exists. */
export async function createPlanCheckout(
  client: PoolClient,
  input: { orgId: string; planCode: string; successUrl: string; cancelUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const plan = await client.query<{ stripePriceId: string | null; active: boolean }>(
    `SELECT stripe_price_id AS "stripePriceId",active FROM pricing_plans WHERE code=$1`,
    [input.planCode],
  );
  if (!plan.rows[0]?.active || !plan.rows[0].stripePriceId)
    throw new Error("This plan is not configured for checkout");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  return stripe.checkout.sessions.create({
    mode: "subscription",
    customer: billing.rows[0]?.customerId ?? undefined,
    line_items: [{ price: plan.rows[0].stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: { orgId: input.orgId, planCode: input.planCode },
  });
}

export async function createCreditPackCheckout(
  client: PoolClient,
  input: { orgId: string; packCode: string; successUrl: string; cancelUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const pack = await client.query<{ stripePriceId: string | null; active: boolean }>(
    `SELECT stripe_price_id AS "stripePriceId",active FROM credit_packs WHERE code=$1`,
    [input.packCode],
  );
  if (!pack.rows[0]?.active || !pack.rows[0].stripePriceId)
    throw new Error("This credit pack is not configured for checkout");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  return new Stripe(process.env.STRIPE_SECRET_KEY).checkout.sessions.create({
    mode: "payment",
    customer: billing.rows[0]?.customerId ?? undefined,
    line_items: [{ price: pack.rows[0].stripePriceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: { kind: "credit_pack", orgId: input.orgId, packCode: input.packCode },
  });
}

export async function createPaygEnrollment(
  client: PoolClient,
  input: { orgId: string; successUrl: string; cancelUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  return new Stripe(process.env.STRIPE_SECRET_KEY).checkout.sessions.create({
    mode: "setup",
    customer: billing.rows[0]?.customerId ?? undefined,
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    client_reference_id: input.orgId,
    metadata: { kind: "payg_enrollment", orgId: input.orgId },
  });
}

export async function createCustomerPortal(
  client: PoolClient,
  input: { orgId: string; returnUrl: string },
) {
  if (!process.env.STRIPE_SECRET_KEY) throw new Error("Stripe credentials are not configured");
  const billing = await client.query<{ customerId: string | null }>(
    `SELECT stripe_customer_id AS "customerId" FROM org_billing WHERE org_id=$1`,
    [input.orgId],
  );
  if (!billing.rows[0]?.customerId) throw new Error("No Stripe customer is linked");
  return new Stripe(process.env.STRIPE_SECRET_KEY).billingPortal.sessions.create({
    customer: billing.rows[0].customerId,
    return_url: input.returnUrl,
  });
}

async function notifyOrgAdmins(
  client: PoolClient,
  orgId: string,
  type: string,
  payload: Record<string, unknown>,
) {
  await client.query(
    `INSERT INTO notifications(user_id,org_id,type,payload)
     SELECT user_id,$1,$2,$3::jsonb FROM memberships
     WHERE org_id=$1 AND role IN ('owner','admin')`,
    [orgId, type, JSON.stringify(payload)],
  );
}

/** Run inside a transaction using the least-privilege billing connection. */
export async function processStripeEvent(client: PoolClient, event: Stripe.Event) {
  const claimed = await client.query(
    `INSERT INTO stripe_webhook_events(event_id,type) VALUES($1,$2)
     ON CONFLICT(event_id) DO NOTHING`,
    [event.id, event.type],
  );
  if (!claimed.rowCount) return { duplicate: true };
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object as Stripe.Checkout.Session;
      const orgId = session.metadata?.orgId;
      if (session.metadata?.kind === "credit_pack" && orgId && session.metadata.packCode) {
        await client.query(
          `INSERT INTO wallet_ledger(org_id,amount_usd,kind,stripe_event_id,reference_id,reason)
           SELECT $1,credit_amount_usd,'purchase',$2,$3,'Vantage Usage Credits purchase'
           FROM credit_packs WHERE code=$3`,
          [orgId, event.id, session.metadata.packCode],
        );
        await notifyOrgAdmins(client, orgId, "credits.purchased", { packCode: session.metadata.packCode });
      } else if (session.metadata?.kind === "payg_enrollment" && orgId) {
        await client.query(
          `INSERT INTO org_usage_policies(org_id,payg_enabled) VALUES($1,true)
           ON CONFLICT(org_id) DO UPDATE SET payg_enabled=true,updated_at=now()`,
          [orgId],
        );
      }
    } else if (event.type.startsWith("customer.subscription.")) {
      const subscription = event.data.object as Stripe.Subscription;
      const orgId = subscription.metadata.orgId;
      const planCode = subscription.metadata.planCode;
      if (orgId && planCode) {
        const entitled = ["active", "trialing"].includes(subscription.status);
        const validUntil = subscription.items.data[0]?.current_period_end;
        await client.query(
          `INSERT INTO org_entitlements(org_id,plan_code,source,status,stripe_subscription_id,valid_until)
           VALUES($1,$2,'stripe',$3,$4,to_timestamp($5))
           ON CONFLICT(org_id) DO UPDATE SET plan_code=excluded.plan_code,source='stripe',
            status=excluded.status,stripe_subscription_id=excluded.stripe_subscription_id,
            valid_until=excluded.valid_until,updated_at=now()`,
          [orgId, planCode, entitled ? "active" : subscription.status, subscription.id, validUntil ?? 0],
        );
        await client.query(
          `INSERT INTO entitlement_events(org_id,plan_code,action,source,stripe_event_id,metadata)
           VALUES($1,$2,$3,'stripe',$4,$5::jsonb)`,
          [orgId, planCode, entitled ? "activated" : "suspended", event.id, JSON.stringify({ status: subscription.status })],
        );
        if (!entitled) await notifyOrgAdmins(client, orgId, "subscription.action_required", { status: subscription.status });
      }
      await applyStripeEvent(client, event);
    } else if (event.type === "invoice.payment_failed") {
      const invoice = event.data.object as Stripe.Invoice;
      const subscriptionId =
        typeof invoice.parent?.subscription_details?.subscription === "string"
          ? invoice.parent.subscription_details.subscription
          : invoice.parent?.subscription_details?.subscription?.id;
      if (subscriptionId) {
        const org = await client.query<{ orgId: string }>(
          `SELECT org_id AS "orgId" FROM org_entitlements WHERE stripe_subscription_id=$1`,
          [subscriptionId],
        );
        if (org.rows[0]) await notifyOrgAdmins(client, org.rows[0].orgId, "subscription.payment_failed", {});
      }
    }
    await client.query(
      `UPDATE stripe_webhook_events SET status='processed',processed_at=now() WHERE event_id=$1`,
      [event.id],
    );
    return { duplicate: false };
  } catch (error) {
    await client.query(
      `UPDATE stripe_webhook_events SET status='failed',error=$2,processed_at=now() WHERE event_id=$1`,
      [event.id, error instanceof Error ? error.message.slice(0, 500) : "Webhook failed"],
    );
    throw error;
  }
}

export async function giftUsageCredits(
  client: PoolClient,
  input: { orgId: string; amountUsd: number; actorUserId: string; reason: string },
) {
  if (!(input.amountUsd > 0) || !input.reason.trim()) throw new Error("Positive amount and reason are required");
  await client.query(
    `INSERT INTO wallet_ledger(org_id,amount_usd,kind,actor_user_id,reason)
     VALUES($1,$2,'gift',$3,$4)`,
    [input.orgId, input.amountUsd, input.actorUserId, input.reason.trim()],
  );
  await notifyOrgAdmins(client, input.orgId, "credits.gifted", {
    amountUsd: input.amountUsd,
    reason: input.reason,
  });
}

export async function grantTrial(
  client: PoolClient,
  input: { orgId: string; planCode: "managed_20" | "managed_50"; actorUserId: string },
) {
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
  await client.query(
    `INSERT INTO org_entitlements(org_id,plan_code,source,status,trial_ends_at,valid_until,updated_by)
     VALUES($1,$2,'admin_trial','active',$3,$3,$4)
     ON CONFLICT(org_id) DO UPDATE SET plan_code=excluded.plan_code,source='admin_trial',
      status='active',trial_ends_at=$3,valid_until=$3,updated_by=$4,updated_at=now()`,
    [input.orgId, input.planCode, expiresAt, input.actorUserId],
  );
  await client.query(
    `INSERT INTO entitlement_events(org_id,plan_code,action,source,expires_at,actor_user_id)
     VALUES($1,$2,'trial_granted','admin',$3,$4)`,
    [input.orgId, input.planCode, expiresAt, input.actorUserId],
  );
  await notifyOrgAdmins(client, input.orgId, "trial.granted", {
    planCode: input.planCode,
    expiresAt: expiresAt.toISOString(),
  });
  return expiresAt;
}

export async function expireTrials(client: PoolClient, now = new Date()) {
  const expired = await client.query<{ orgId: string; planCode: string }>(
    `UPDATE org_entitlements SET status='expired',updated_at=now()
     WHERE source='admin_trial' AND status='active' AND valid_until <= $1
     RETURNING org_id AS "orgId",plan_code AS "planCode"`,
    [now],
  );
  for (const trial of expired.rows) {
    await client.query(
      `INSERT INTO entitlement_events(org_id,plan_code,action,source,effective_at)
       VALUES($1,$2,'trial_expired','system',$3)`,
      [trial.orgId, trial.planCode, now],
    );
    await notifyOrgAdmins(client, trial.orgId, "trial.expired", { planCode: trial.planCode });
  }
  return expired.rowCount ?? 0;
}
