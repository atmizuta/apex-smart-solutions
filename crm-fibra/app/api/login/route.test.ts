import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorUsername = vi.fn();
const registrarLogin = vi.fn();
vi.mock("@/lib/consultores", () => ({
  buscarConsultorPorUsername: (...args: unknown[]) =>
    buscarConsultorPorUsername(...args),
  registrarLogin: (...args: unknown[]) => registrarLogin(...args),
}));

import { hashPassword } from "@/lib/auth/password";
import { POST } from "./route";

beforeEach(() => {
  buscarConsultorPorUsername.mockReset();
  registrarLogin.mockReset();
  process.env.CRM_FIBRA_SESSION_SECRET =
    "test-secret-key-with-at-least-32-characters!!";
});

function req(body: unknown) {
  return new Request("http://localhost/api/login", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

describe("POST /api/login", () => {
  it("retorna 400 quando faltam credenciais", async () => {
    const res = await POST(req({ username: "", senha: "" }));
    expect(res.status).toBe(400);
    expect(buscarConsultorPorUsername).not.toHaveBeenCalled();
  });

  it("retorna 401 para usuário inexistente", async () => {
    buscarConsultorPorUsername.mockResolvedValue(null);
    const res = await POST(req({ username: "fantasma", senha: "qualquer" }));
    expect(res.status).toBe(401);
  });

  it("retorna 401 para senha errada", async () => {
    const hash = await hashPassword("senhaCorreta");
    buscarConsultorPorUsername.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
      passwordHash: hash,
    });
    const res = await POST(req({ username: "ana", senha: "senhaErrada" }));
    expect(res.status).toBe(401);
  });

  it("retorna 401 para consultor desativado mesmo com senha certa", async () => {
    const hash = await hashPassword("senhaCorreta");
    buscarConsultorPorUsername.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: false,
      criadoEm: "x",
      ultimoLogin: null,
      passwordHash: hash,
    });
    const res = await POST(req({ username: "ana", senha: "senhaCorreta" }));
    expect(res.status).toBe(401);
  });

  it("retorna 200, seta cookie de sessão e registra o login para credenciais corretas", async () => {
    const hash = await hashPassword("senhaCorreta");
    buscarConsultorPorUsername.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
      passwordHash: hash,
    });
    registrarLogin.mockResolvedValue(undefined);

    const res = await POST(req({ username: "ana", senha: "senhaCorreta" }));

    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("crm_fibra_session=");
    expect(registrarLogin).toHaveBeenCalledWith(expect.anything(), "1");
  });
});
