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
const buscarLeadPorCnpj = vi.fn();
vi.mock("@/lib/leads", async () => {
  const actual = await vi.importActual<typeof import("@/lib/leads")>("@/lib/leads");
  return {
    ...actual,
    atribuirLead: (...args: unknown[]) => atribuirLead(...args),
    registrarMensagem: (...args: unknown[]) => registrarMensagem(...args),
    buscarLeadPorCnpj: (...args: unknown[]) => buscarLeadPorCnpj(...args),
  };
});

const criarProposta = vi.fn();
vi.mock("@/lib/propostas", async () => {
  const actual = await vi.importActual<typeof import("@/lib/propostas")>("@/lib/propostas");
  return {
    ...actual,
    criarProposta: (...args: unknown[]) => criarProposta(...args),
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

import { atribuirLeadAction, registrarMensagemAction, salvarPropostaAction } from "./actions";
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
  buscarLeadPorCnpj.mockReset();
  criarProposta.mockReset();
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
    buscarLeadPorCnpj.mockResolvedValue({ donoConsultorId: "c1" });
    const resultado = await registrarMensagemAction("00005087000190", "   ", "whatsapp");
    expect(resultado.erro).toBeDefined();
    expect(registrarMensagem).not.toHaveBeenCalled();
  });

  it("registra a mensagem com o texto já sem espaços nas pontas", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ donoConsultorId: "c1" });
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

  it("recusa registrar mensagem quando o consultor não é o dono do lead", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ donoConsultorId: "outro-consultor" });
    const resultado = await registrarMensagemAction("00005087000190", "Oi", "whatsapp");
    expect(resultado.erro).toMatch(/dono/);
    expect(registrarMensagem).not.toHaveBeenCalled();
  });
});

describe("salvarPropostaAction", () => {
  const itensValidos = [
    { catalogoPlanoId: "p1", descricao: "  400 Mega (G1 Padrão)  ", valor: 79.9 },
    { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9 },
  ];

  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(salvarPropostaAction("00005087000190", itensValidos)).rejects.toThrow("REDIRECT:/login");
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa proposta sem nenhuma linha, sem gravar nada", async () => {
    sessaoValida();
    const resultado = await salvarPropostaAction("00005087000190", []);
    expect(resultado.erro).toMatch(/pelo menos uma linha/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it.each([
    ["descrição em branco", { catalogoPlanoId: null, descricao: "   ", valor: 10 }],
    ["valor zero", { catalogoPlanoId: null, descricao: "Oferta", valor: 0 }],
    ["valor NaN", { catalogoPlanoId: null, descricao: "Oferta", valor: Number.NaN }],
    ["valor que não é número", { catalogoPlanoId: null, descricao: "Oferta", valor: "abc" as unknown as number }],
  ])("recusa linha inválida (%s) sem gravar nada", async (_nome, item) => {
    sessaoValida();
    const resultado = await salvarPropostaAction("00005087000190", [item]);
    expect(resultado.erro).toBeDefined();
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa CNPJ que não existe na base", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue(null);
    const resultado = await salvarPropostaAction("99999999999999", itensValidos);
    expect(resultado.erro).toMatch(/não encontrado/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("usa o consultor da sessão e permite salvar em lead de outro consultor", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: "outro-consultor" });
    criarProposta.mockResolvedValue({ id: "prop1" });

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado).toEqual({});
    expect(criarProposta).toHaveBeenCalledWith({}, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: [
        { catalogoPlanoId: "p1", descricao: "400 Mega (G1 Padrão)", valor: 79.9 },
        { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9 },
      ],
    });
  });

  it("quando gravar falha, devolve mensagem amigável em vez de estourar (o rascunho do consultor não pode sumir)", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockRejectedValue(new Error("banco fora do ar"));
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado.erro).toMatch(/Não foi possível salvar/);
    expect(erroNoLog).toHaveBeenCalled();
    erroNoLog.mockRestore();
  });

  it("também devolve mensagem amigável quando a consulta do lead falha", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockRejectedValue(new Error("banco fora do ar"));
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado.erro).toMatch(/Não foi possível salvar/);
    expect(criarProposta).not.toHaveBeenCalled();
    erroNoLog.mockRestore();
  });

  it("trata um catalogoPlanoId que não é texto como oferta avulsa", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });

    await salvarPropostaAction("00005087000190", [
      { catalogoPlanoId: 123 as unknown as string, descricao: "Oferta", valor: 10 },
    ]);

    expect(criarProposta).toHaveBeenCalledWith({}, expect.objectContaining({
      itens: [{ catalogoPlanoId: null, descricao: "Oferta", valor: 10 }],
    }));
  });
});
