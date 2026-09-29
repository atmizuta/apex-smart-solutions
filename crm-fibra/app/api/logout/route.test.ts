import { describe, it, expect } from "vitest";
import { POST } from "./route";

describe("POST /api/logout", () => {
  it("limpa o cookie de sessão", async () => {
    const res = await POST();
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("crm_fibra_session=");
    expect(setCookie).toMatch(/max-age=0/i);
  });
});
