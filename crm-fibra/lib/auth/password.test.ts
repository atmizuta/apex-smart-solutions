import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword, DUMMY_HASH } from "./password";

describe("password hashing", () => {
  it("hashes a password and verifies it correctly", async () => {
    const hash = await hashPassword("minhaSenha123");
    expect(hash).not.toBe("minhaSenha123");
    expect(await verifyPassword("minhaSenha123", hash)).toBe(true);
  });

  it("rejects an incorrect password", async () => {
    const hash = await hashPassword("minhaSenha123");
    expect(await verifyPassword("senhaErrada", hash)).toBe(false);
  });

  it("DUMMY_HASH never verifies against any real password", async () => {
    expect(await verifyPassword("qualquerCoisa", DUMMY_HASH)).toBe(false);
    expect(await verifyPassword("", DUMMY_HASH)).toBe(false);
  });

  it("DUMMY_HASH is a well-formed bcrypt hash (so compare() never throws)", () => {
    expect(DUMMY_HASH).toMatch(/^\$2[aby]\$\d{2}\$.{53}$/);
  });
});
