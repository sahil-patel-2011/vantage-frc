import { Pool } from "@neondatabase/serverless";
import { hashPassword } from "better-auth/crypto";
import {
  configuredPlatformOwnerEmail,
  isDatabaseConfigured,
  normalizeEmail,
} from "./access-policy";

export type BootstrapResult = {
  ok: true;
  email: string;
  createdUser: boolean;
  updatedPassword: boolean;
  grantedPlatformAdmin: boolean;
};

function adminConnectionString() {
  return (
    process.env.DATABASE_ADMIN_URL ||
    process.env.DATABASE_URL ||
    process.env.DATABASE_AUTH_URL ||
    null
  );
}

/**
 * Idempotent platform-owner bootstrap.
 * Password is read only from PLATFORM_OWNER_PASSWORD (never logged or returned).
 */
export async function bootstrapPlatformOwner(input?: {
  email?: string;
  password?: string;
  name?: string;
}): Promise<BootstrapResult> {
  if (!isDatabaseConfigured()) {
    throw new Error("Database is not configured. Set DATABASE_ADMIN_URL or DATABASE_URL before seeding.");
  }
  const connectionString = adminConnectionString();
  if (!connectionString) throw new Error("DATABASE_ADMIN_URL or DATABASE_URL is required for bootstrap.");

  const email = normalizeEmail(input?.email ?? configuredPlatformOwnerEmail());
  const password = input?.password ?? process.env.PLATFORM_OWNER_PASSWORD;
  if (!password || password.length < 12) {
    throw new Error("PLATFORM_OWNER_PASSWORD must be set to at least 12 characters.");
  }

  const name = (input?.name ?? process.env.PLATFORM_OWNER_NAME ?? "Platform Owner").trim() || "Platform Owner";
  const passwordHash = await hashPassword(password);
  const pool = new Pool({ connectionString });

  try {
    const existing = await pool.query<{ id: string }>(`SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1`, [
      email,
    ]);
    let userId = existing.rows[0]?.id;
    let createdUser = false;
    let updatedPassword = false;
    let grantedPlatformAdmin = false;

    if (!userId) {
      const created = await pool.query<{ id: string }>(
        `INSERT INTO users(id,email,email_verified,name,created_at,updated_at)
         VALUES(gen_random_uuid(),$1,true,$2,now(),now())
         RETURNING id`,
        [email, name],
      );
      userId = created.rows[0]!.id;
      createdUser = true;
      await pool.query(
        `INSERT INTO profiles(user_id,display_name,theme_preference) VALUES($1,$2,'light')
         ON CONFLICT (user_id) DO NOTHING`,
        [userId, name],
      );
    } else {
      await pool.query(`UPDATE users SET email_verified=true,name=COALESCE(NULLIF(name,''),$2),updated_at=now() WHERE id=$1`, [
        userId,
        name,
      ]);
    }

    const credential = await pool.query<{ id: string }>(
      `SELECT id FROM accounts WHERE user_id=$1 AND provider_id='credential' LIMIT 1`,
      [userId],
    );
    if (credential.rows[0]) {
      await pool.query(`UPDATE accounts SET password=$2,updated_at=now() WHERE id=$1`, [
        credential.rows[0].id,
        passwordHash,
      ]);
      updatedPassword = true;
    } else {
      await pool.query(
        `INSERT INTO accounts(id,account_id,provider_id,user_id,password,created_at,updated_at)
         VALUES(gen_random_uuid(),$1,'credential',$2,$3,now(),now())`,
        [userId, userId, passwordHash],
      );
      updatedPassword = true;
    }

    const admin = await pool.query(`SELECT 1 FROM platform_admins WHERE user_id=$1`, [userId]);
    if (!admin.rowCount) {
      await pool.query(`INSERT INTO platform_admins(user_id,granted_at) VALUES($1,now())`, [userId]);
      grantedPlatformAdmin = true;
    }

    return { ok: true, email, createdUser, updatedPassword, grantedPlatformAdmin };
  } finally {
    await pool.end();
  }
}
