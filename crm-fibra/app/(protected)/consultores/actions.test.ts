import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorId = vi.fn();
const criarConsultor = vi.fn();
const definirAtivo = vi.fn();
vi.mock("@/lib/consultores", async () => {
  const actual = await vi.importActual<typeof import("@/lib/consultores")>(
    "@/lib/consultores"
  );
  return {
    ...actual,
    buscarConsultorPorId: (...args: unknown[]) => buscarConsultorPorId(...args),
    criarConsultor: (...args: unknown[]) => criarConsultor(...args),
    definirAtivo: (...args: unknown[]) => definirAtivo(...args),
  };
});

const cookieGet = vi.fn();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: cookieGet }),
}));

const verifySessionToken = vi.fn();
vi.mock("@/lib/auth/session", () => ({
  verifySessionToken: (...args: unknown[]) => verifySessionToken(...args),
  SESSION_COOKIE_NAME: "crm_fibra_session",
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));

import { criarConsultorAction, definirAtivoAction } from "./actions";

beforeEach(() => {
  buscarConsultorPorId.mockReset();
  criarConsultor.mockReset();
  definirAtivo.mockReset();
  cookieGet.mockReset();
  verifySessionToken.mockReset();
});

function formData(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

describe("criarConsultorAction", () => {
  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(
      criarConsultorAction({}, formData({ nome: "A", username: "a", senha: "12345678" }))
    ).rejects.toThrow("REDIRECT:/login");
  });

  it("rejeita quando o consultor logado não é admin", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "consultor" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Ana",
      username: "ana",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    await expect(
      criarConsultorAction({}, formData({ nome: "A", username: "a", senha: "12345678" }))
    ).rejects.toThrow("Apenas administradores");
    expect(criarConsultor).not.toHaveBeenCalled();
  });

  it("valida senha curta antes de chamar o banco", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "admin" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Admin",
      username: "admin",
      papel: "admin",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    const result = await criarConsultorAction(
      {},
      formData({ nome: "A", username: "a", senha: "123" })
    );

    expect(result.erro).toMatch(/mín/i);
    expect(criarConsultor).not.toHaveBeenCalled();
  });

  it("admin ativo consegue criar consultor", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "admin" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Admin",
      username: "admin",
      papel: "admin",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });
    criarConsultor.mockResolvedValue({
      id: "2",
      nome: "Novo",
      username: "novo",
      papel: "consultor",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    const result = await criarConsultorAction(
      {},
      formData({ nome: "Novo", username: "novo", senha: "senha1234", papel: "consultor" })
    );

    expect(result.sucesso).toBe(true);
    expect(criarConsultor).toHaveBeenCalledWith(
      {},
      { nome: "Novo", username: "novo", senha: "senha1234", papel: "consultor" }
    );
  });
});

describe("definirAtivoAction", () => {
  it("rejeita quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(definirAtivoAction("2", false)).rejects.toThrow("REDIRECT:/login");
    expect(definirAtivo).not.toHaveBeenCalled();
  });

  it("recusa a autodesativação e não chama definirAtivo", async () => {
    cookieGet.mockReturnValue({ value: "token" });
    verifySessionToken.mockResolvedValue({ consultorId: "1", papel: "admin" });
    buscarConsultorPorId.mockResolvedValue({
      id: "1",
      nome: "Admin",
      username: "admin",
      papel: "admin",
      ativo: true,
      criadoEm: "x",
      ultimoLogin: null,
    });

    const result = await definirAtivoAction("1", false);

    expect(result).toEqual({ erro: "Você não pode desativar sua própria conta" });
    expect(definirAtivo).not.toHaveBeenCalled();
  });
});
