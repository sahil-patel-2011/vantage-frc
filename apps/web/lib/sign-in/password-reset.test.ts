import { describe, expect, it, vi } from "vitest";
import { requestPasswordResetCode } from "./password-reset";
describe("password reset request confirmation", () => {
  it.each([400, 401, 429, 500, 503])("does not report delivery after HTTP %s", async status => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ error: "Unavailable" }, { status }));
    await expect(requestPasswordResetCode("recipient@example.com", fetcher)).rejects.toThrow();
  });
  it("uses the requested recipient and bounded request before advancing", async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ success: true }));
    await expect(requestPasswordResetCode("recipient@example.com", fetcher)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledWith("/api/auth/email-otp/request-password-reset", expect.objectContaining({
      method: "POST", credentials: "include", body: JSON.stringify({ email: "recipient@example.com" }), signal: expect.any(AbortSignal),
    }));
  });
  it("preserves a transport failure instead of advancing to a code that was not confirmed", async () => {
    await expect(requestPasswordResetCode("recipient@example.com", vi.fn().mockRejectedValue(new TypeError("Network")))).rejects.toThrow("Network");
  });
});
