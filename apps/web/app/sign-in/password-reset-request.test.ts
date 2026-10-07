import { describe, expect, it, vi } from "vitest";
import { requestPasswordResetCode } from "./password-reset-request";

describe("reset code acceptance", () => {
  it.each([400, 401, 403, 429, 500, 503])("does not advance to code entry on HTTP %i", async status => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ error: "Private provider detail" }, { status }));
    await expect(requestPasswordResetCode("scout@example.test", send)).rejects.toThrow(status === 429 ? "Wait a little" : "Could not send");
  });
  it("accepts a successful request with the expected endpoint and payload", async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ success: true }));
    await expect(requestPasswordResetCode("scout@example.test", send)).resolves.toBeUndefined();
    expect(send).toHaveBeenCalledWith("/api/auth/email-otp/request-password-reset", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ email: "scout@example.test" }), signal: expect.any(AbortSignal),
    }));
  });
  it("leaves request failures recoverable instead of claiming that mail was sent", async () => {
    await expect(requestPasswordResetCode("scout@example.test", vi.fn<typeof fetch>().mockRejectedValue(new TypeError("Network failed")))).rejects.toThrow("Network failed");
  });
});
