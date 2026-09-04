import { describe, expect, it } from "vitest";
import { isPriorityRelayRequest, PRIORITY_RELAY_TEAM_NUMBER } from "../src/priority-request";

describe("priority relay request", () => {
  it("treats team 6925 as default-fast without a separate toggle", () => {
    expect(PRIORITY_RELAY_TEAM_NUMBER).toBe(6925);
    expect(
      isPriorityRelayRequest({ priorityHeader: "", teamNumberHeader: "6925" }),
    ).toBe(true);
    expect(
      isPriorityRelayRequest({ priorityHeader: "1", teamNumberHeader: "254" }),
    ).toBe(true);
    expect(
      isPriorityRelayRequest({ priorityHeader: "", teamNumberHeader: "254" }),
    ).toBe(false);
  });
});
