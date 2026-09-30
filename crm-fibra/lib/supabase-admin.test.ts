import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("getSupabaseAdmin", () => {
  const originalUrl = process.env.SUPABASE_URL;
  const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  beforeEach(() => {
    vi.resetModules();
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  });

  afterEach(() => {
    if (originalUrl) process.env.SUPABASE_URL = originalUrl;
    if (originalKey) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
  });

  it("throws a clear error when env vars are missing", async () => {
    const { getSupabaseAdmin } = await import("./supabase-admin");
    expect(() => getSupabaseAdmin()).toThrow(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set"
    );
  });

  it("returns a client once env vars are set", async () => {
    process.env.SUPABASE_URL = "https://example.supabase.co";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "fake-key-for-test";
    const { getSupabaseAdmin } = await import("./supabase-admin");
    expect(getSupabaseAdmin()).toBeTruthy();
  });
});
