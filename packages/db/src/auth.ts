import { createDrizzle } from "./drizzle-client";
import { resolveAuthDatabaseUrl } from "./postgres-url";

const { db } = createDrizzle(resolveAuthDatabaseUrl());

/** Least-privilege identity store; it cannot access organizations or billing. */
export const authDb = db;
