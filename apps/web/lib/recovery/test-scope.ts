import { isLocalAcceptanceSignup } from "@vantage/core/public-signup";

/** Recovery tests must use identified operator-owned test resources. */
export function recoveryTestScope(env: NodeJS.ProcessEnv = process.env): { testRun?: string } {
  if (!isLocalAcceptanceSignup(env)) return {};
  const testRun = env.VANTAGE_LOCAL_ACCEPTANCE_ID;
  if (!testRun || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(testRun)) {
    throw new Error("Set a stable local acceptance ID before writing test recovery resources.");
  }
  return { testRun };
}
