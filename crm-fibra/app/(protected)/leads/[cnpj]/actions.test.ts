import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorId = vi.fn();
vi.mock("@/lib/consultores", () => ({
  buscarConsultorPorId: (...args: unknown[]) => buscarConsultorPorId(...args),
}));

const atribuirLead = vi.fn();
const registrarMensagem = vi.fn();
vi.mock("@/lib/leads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/leads")>("@/lib/leads");
  return {
    ...actual,
    atribuirLead: (...args: unknown[]) => atribuirLead(...args),
    registrarMensagem: (...args: unknown[]) => registrarMensagem(...args),
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

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

import { atribuirLeadAction, registrarMensagemAction } from "./actions";
import { LeadJaAtribuidoError } from "@/lib/leads";

const consultorAtivo = {
  id: "c1",
  nome: "Ana",
  username: "ana",
  papel: "consultor" as const,
  ativo: true,
  criadoEm: "x",
  ultimoLogin: null,
};

beforeEach(() => {
  buscarConsultorPorId.mockReset();
  atribuirLead.mockReset();
  registrarMensagem.mockReset();
  cookieGet.mockReset();
  verifySessionToken.mockReset();
});

function sessaoValida() {
  cookieGet.mockReturnValue({ value: "token" });
  verifySessionToken.mockResolvedValue({ consultorId: "c1", papel: "consultor" });
  buscarConsultorPorId.mockResolvedValue(consultorAtivo);
}

describe("atribuirLeadAction", () => {
  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(atribuirLeadAction("00005087000190")).rejects.toThrow("REDIRECT:/login");
    expect(atribuirLead).not.toHaveBeenCalled();
  });

  it("chama atribuirLead com o consultor da sessão", async () => {
    sessaoValida();
    atribuirLead.mockResolvedValue(undefined);
    const resultado = await atribuirLeadAction("00005087000190");
    expect(resultado).toEqual({});
    expect(atribuirLead).toHaveBeenCalledWith({}, "00005087000190", "c1");
  });

  it("retorna erro amigável quando o lead já foi atribuído", async () => {
    sessaoValida();
    atribuirLead.mockRejectedValue(new LeadJaAtribuidoError("00005087000190"));
    const resultado = await atribuirLeadAction("00005087000190");
    expect(resultado.erro).toMatch(/já foi atribuído/);
  });
});

describe("registrarMensagemAction", () => {
  it("rejeita mensagem em branco sem chamar registrarMensagem", async () => {
    sessaoValida();
    const resultado = await registrarMensagemAction("00005087000190", "   ", "whatsapp");
    expect(resultado.erro).toBeDefined();
    expect(registrarMensagem).not.toHaveBeenCalled();
  });

  it("registra a mensagem com o texto já sem espaços nas pontas", async () => {
    sessaoValida();
    registrarMensagem.mockResolvedValue({
      id: "m1",
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      canal: "whatsapp",
      conteudo: "Oi!",
      geradoPorIa: false,
      abordagemTipo: null,
      enviadoEm: "x",
    });
    const resultado = await registrarMensagemAction("00005087000190", "  Oi!  ", "whatsapp");
    expect(resultado).toEqual({});
    expect(registrarMensagem).toHaveBeenCalledWith({}, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      canal: "whatsapp",
      conteudo: "Oi!",
    });
  });
});
