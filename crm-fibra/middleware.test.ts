import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";
import { createSessionToken } from "@/lib/auth/session";

beforeEach(() => {
  process.env.CRM_FIBRA_SESSION_SECRET =
    "test-secret-key-with-at-least-32-characters!!";
});

describe("middleware", () => {
  it("deixa /login passar sem sessão", async () => {
    const req = new NextRequest("http://localhost/login");
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });

  it("redireciona pra /login quando não há cookie de sessão", async () => {
    const req = new NextRequest("http://localhost/dashboard");
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("redireciona pra /login quando o cookie é inválido", async () => {
    const req = new NextRequest("http://localhost/dashboard", {
      headers: { cookie: "crm_fibra_session=token-invalido" },
    });
    const res = await middleware(req);
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
  });

  it("deixa passar quando o cookie tem um token válido", async () => {
    const token = await createSessionToken({ consultorId: "1", papel: "consultor" });
    const req = new NextRequest("http://localhost/dashboard", {
      headers: { cookie: `crm_fibra_session=${token}` },
    });
    const res = await middleware(req);
    expect(res.status).toBe(200);
  });
});
