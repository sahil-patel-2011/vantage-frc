import { describe, expect, it } from "vitest";
import { recoveryTestScope } from "./test-scope";

describe("identified local recovery resources", () => {
  const local: NodeJS.ProcessEnv = { NODE_ENV: "development", VANTAGE_LOCAL_ACCEPTANCE_SIGNUP: "1",
    BETTER_AUTH_URL: "http://127.0.0.1:3417", DATABASE_URL: "postgres://test_admin@127.0.0.1/vantage_release_test" };
  it("requires a stable identifier during local acceptance and never scopes production from a test flag", () => {
    expect(() => recoveryTestScope(local)).toThrow(/stable local acceptance ID/);
    const id = "c604d935-2aef-4808-a823-d4f6c3361264";
    expect(recoveryTestScope({ ...local, VANTAGE_LOCAL_ACCEPTANCE_ID: id })).toEqual({ testRun: id });
    expect(recoveryTestScope({ ...local, NODE_ENV: "production", VANTAGE_LOCAL_ACCEPTANCE_ID: id })).toEqual({});
    expect(() => recoveryTestScope({ ...local, VANTAGE_LOCAL_ACCEPTANCE_ID: "invalid" })).toThrow();
  });
});
