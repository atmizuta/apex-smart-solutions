import { describe, it, expect, beforeEach } from "vitest";
import { createSessionToken, verifySessionToken } from "./session";

beforeEach(() => {
  process.env.CRM_FIBRA_SESSION_SECRET =
    "test-secret-key-with-at-least-32-characters!!";
});

describe("session tokens", () => {
  it("creates a token that verifies back to the same payload", async () => {
    const token = await createSessionToken({
      consultorId: "abc-123",
      papel: "consultor",
    });
    const payload = await verifySessionToken(token);
    expect(payload).not.toBeNull();
    expect(payload?.consultorId).toBe("abc-123");
    expect(payload?.papel).toBe("consultor");
  });

  it("rejects a tampered token", async () => {
    const token = await createSessionToken({
      consultorId: "abc-123",
      papel: "consultor",
    });
    const tampered = token.slice(0, -2) + "xx";
    expect(await verifySessionToken(tampered)).toBeNull();
  });

  it("rejects a token signed with a different secret", async () => {
    const token = await createSessionToken({
      consultorId: "abc-123",
      papel: "consultor",
    });
    process.env.CRM_FIBRA_SESSION_SECRET =
      "a-completely-different-secret-of-32-chars!!";
    expect(await verifySessionToken(token)).toBeNull();
  });

  it("rejects garbage input instead of throwing", async () => {
    expect(await verifySessionToken("not-a-jwt-at-all")).toBeNull();
  });

  it("throws a clear error at signing time if the secret is missing", async () => {
    delete process.env.CRM_FIBRA_SESSION_SECRET;
    await expect(
      createSessionToken({ consultorId: "x", papel: "admin" })
    ).rejects.toThrow("CRM_FIBRA_SESSION_SECRET");
  });
});
