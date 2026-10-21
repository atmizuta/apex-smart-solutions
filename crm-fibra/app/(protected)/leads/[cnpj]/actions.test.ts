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
const listarPropostasPorCnpj = vi.fn();
vi.mock("@/lib/propostas", async () => {
  const actual = await vi.importActual<typeof import("@/lib/propostas")>("@/lib/propostas");
  return {
    ...actual,
    criarProposta: (...args: unknown[]) => criarProposta(...args),
    listarPropostasPorCnpj: (...args: unknown[]) => listarPropostasPorCnpj(...args),
  };
});

const criarAbordagem = vi.fn();
vi.mock("@/lib/abordagens", () => ({
  criarAbordagem: (...args: unknown[]) => criarAbordagem(...args),
}));

const gerarJson = vi.fn();
vi.mock("@/lib/ia/gemini", async () => {
  const actual = await vi.importActual<typeof import("@/lib/ia/gemini")>("@/lib/ia/gemini");
  return {
    ...actual,
    gerarJson: (...args: unknown[]) => gerarJson(...args),
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

import {
  atribuirLeadAction,
  gerarAbordagemAction,
  registrarMensagemAction,
  salvarPropostaAction,
} from "./actions";
import { IaCotaEsgotadaError, IaIndisponivelError, IaNaoConfiguradaError } from "@/lib/ia/erros";
import { MODELO_GEMINI } from "@/lib/ia/gemini";
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
  listarPropostasPorCnpj.mockReset();
  criarAbordagem.mockReset();
  gerarJson.mockReset();
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
    { catalogoPlanoId: "p12", descricao: "  Pós 12GB — por linha  ", valor: 279.93, quantidade: 7, franquiaGb: 12 },
    { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9, quantidade: 1, franquiaGb: null },
  ];
  const situacaoValida = {
    faturasAnalisadas: 1,
    linhas: [
      {
        rotulo: "(17) ••••• 0001",
        quantidade: 1,
        planoGb: 10,
        valorUnitario: 48.49,
        consumoMb: 1000,
        origem: "fatura" as const,
        proposto: { descricao: "Pós 12GB — por linha", valorUnitario: 39.99 },
      },
    ],
  };

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
    ["descrição em branco", { catalogoPlanoId: null, descricao: "   ", valor: 10, quantidade: 1, franquiaGb: null }],
    ["valor zero", { catalogoPlanoId: null, descricao: "Oferta", valor: 0, quantidade: 1, franquiaGb: null }],
    ["valor NaN", { catalogoPlanoId: null, descricao: "Oferta", valor: Number.NaN, quantidade: 1, franquiaGb: null }],
    ["valor que não é número", { catalogoPlanoId: null, descricao: "Oferta", valor: "abc" as unknown as number, quantidade: 1, franquiaGb: null }],
    ["quantidade zero", { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 0, franquiaGb: null }],
    ["quantidade fracionada", { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1.5, franquiaGb: null }],
    ["quantidade ausente", { catalogoPlanoId: null, descricao: "Oferta", valor: 10 } as unknown as (typeof itensValidos)[number]],
    ["franquia inválida", { catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: 0 }],
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

  it("usa o consultor da sessão, normaliza os itens e permite salvar em lead de outro consultor", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: "outro-consultor" });
    criarProposta.mockResolvedValue({ id: "prop1" });

    const resultado = await salvarPropostaAction("00005087000190", itensValidos);

    expect(resultado).toEqual({});
    expect(criarProposta).toHaveBeenCalledWith({}, {
      cnpjDigits: "00005087000190",
      consultorId: "c1",
      itens: [
        { catalogoPlanoId: "p12", descricao: "Pós 12GB — por linha", valor: 279.93, quantidade: 7, franquiaGb: 12 },
        { catalogoPlanoId: null, descricao: "Oferta avulsa", valor: 59.9, quantidade: 1, franquiaGb: null },
      ],
      situacaoAtual: null,
    });
  });

  it("grava a situação atual validada junto da proposta", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });

    const resultado = await salvarPropostaAction("00005087000190", itensValidos, situacaoValida);

    expect(resultado).toEqual({});
    expect(criarProposta).toHaveBeenCalledWith({}, expect.objectContaining({ situacaoAtual: situacaoValida }));
  });

  it("recusa situação atual inválida (telefone completo no nome da linha) sem gravar nada", async () => {
    sessaoValida();
    const forjada = { ...situacaoValida, linhas: [{ ...situacaoValida.linhas[0], rotulo: "(17) 90000-0001" }] };
    const resultado = await salvarPropostaAction("00005087000190", itensValidos, forjada);
    expect(resultado.erro).toMatch(/número completo/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("recusa situação atual sem linhas e linha sem mensalidade", async () => {
    sessaoValida();
    const semLinhas = await salvarPropostaAction("00005087000190", itensValidos, { faturasAnalisadas: 0, linhas: [] });
    expect(semLinhas.erro).toMatch(/pelo menos uma linha/);

    const semValor = await salvarPropostaAction("00005087000190", itensValidos, {
      ...situacaoValida,
      linhas: [{ ...situacaoValida.linhas[0], valorUnitario: 0 }],
    });
    expect(semValor.erro).toMatch(/mensalidade/);
    expect(criarProposta).not.toHaveBeenCalled();
  });

  it("descarta campos extras da situação atual antes de gravar", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockResolvedValue({ id: "prop1" });
    const comExtra = { ...situacaoValida, linhas: [{ ...situacaoValida.linhas[0], telefoneCompleto: "17900000001" }] };

    await salvarPropostaAction("00005087000190", itensValidos, comExtra);

    const gravada = criarProposta.mock.calls[0][1].situacaoAtual;
    expect(JSON.stringify(gravada)).not.toContain("17900000001");
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

  it("o log de erro leva só mensagem e código: nunca a situação atual nem os detalhes do banco", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue({ cnpjDigits: "00005087000190", donoConsultorId: null });
    criarProposta.mockRejectedValue({
      message: "violação de restrição",
      code: "23514",
      details: "Failing row contains ((17) ••••• 0001, Pós 12GB)",
    });
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await salvarPropostaAction("00005087000190", itensValidos, situacaoValida);

    expect(resultado.erro).toMatch(/Não foi possível salvar/);
    const logado = JSON.stringify(erroNoLog.mock.calls);
    expect(logado).toContain("23514");
    expect(logado).toContain("violação de restrição");
    expect(logado).not.toContain("Failing row");
    expect(logado).not.toContain("••••• 0001");
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
      { catalogoPlanoId: 123 as unknown as string, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: null },
    ]);

    expect(criarProposta).toHaveBeenCalledWith({}, expect.objectContaining({
      itens: [{ catalogoPlanoId: null, descricao: "Oferta", valor: 10, quantidade: 1, franquiaGb: null }],
    }));
  });
});

describe("gerarAbordagemAction", () => {
  const leadFicticio = {
    cnpjDigits: "11222333000181",
    razaoSocial: "Padaria Pão Quente Ltda",
    cidade: "Campinas",
    ddd: "19",
    tel1: "1935737700",
    tel2: "",
    telefoneContato: "19991002213",
    email: "contato@padaria.example",
    cepCabeado: "CEP Cabeado",
    linhasFixas: 0,
    linhasVoz: 4,
    valorContrato: 399.9,
    arpu: 99.97,
    camadaFibra: "fibra_candidato",
    camadaRenovacao: "apto_agora",
    donoConsultorId: null,
  };

  const propostaRecente = {
    id: "prop-nova",
    cnpjDigits: "11222333000181",
    consultorId: "c1",
    criadoEm: "2026-10-13T12:00:00Z",
    total: 154.89,
    itens: [
      { id: "i1", catalogoPlanoId: null, descricao: "Pós 100GB — por linha", valor: 89.99, ordem: 0 },
      { id: "i2", catalogoPlanoId: null, descricao: "Oferta avulsa combinada", valor: 64.9, ordem: 1 },
    ],
  };

  const propostaAntiga = {
    id: "prop-antiga",
    cnpjDigits: "11222333000181",
    consultorId: "c2",
    criadoEm: "2026-10-01T12:00:00Z",
    total: 39.99,
    itens: [{ id: "i3", catalogoPlanoId: null, descricao: "Pós 12GB antigo", valor: 39.99, ordem: 0 }],
  };

  const etapas = {
    abordagem: "Olá! Aqui é da Apex, revenda Claro Empresas.",
    sondagem: "Hoje quantas linhas a empresa usa?",
    maleficios: "A renovação já está liberada e ainda não foi aproveitada.",
    beneficios: "Com a proposta, a empresa passa para planos maiores.",
    finalizacao: "Posso fechar hoje?",
  };
  const respostaDoModelo = JSON.stringify(etapas);

  function preparar(propostas: unknown[] = []) {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue(leadFicticio);
    listarPropostasPorCnpj.mockResolvedValue(propostas);
    gerarJson.mockResolvedValue(respostaDoModelo);
    criarAbordagem.mockResolvedValue({ id: "a1" });
  }

  it("redireciona pra /login quando não há sessão, sem chamar a IA", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(gerarAbordagemAction("11222333000181")).rejects.toThrow("REDIRECT:/login");
    expect(gerarJson).not.toHaveBeenCalled();
  });

  it("recusa CNPJ que não existe na base, sem chamar a IA", async () => {
    sessaoValida();
    buscarLeadPorCnpj.mockResolvedValue(null);
    const resultado = await gerarAbordagemAction("99999999999999");
    expect(resultado.erro).toMatch(/não encontrado/);
    expect(gerarJson).not.toHaveBeenCalled();
    expect(criarAbordagem).not.toHaveBeenCalled();
  });

  it("sem proposta: gera sem preços e grava proposta_id nulo com o consultor da sessão", async () => {
    preparar([]);

    const resultado = await gerarAbordagemAction("11222333000181");

    expect(resultado).toEqual({});
    expect(gerarJson).toHaveBeenCalledTimes(1);
    expect(gerarJson.mock.calls[0][0].usuario).toContain("Não há proposta salva");
    expect(criarAbordagem).toHaveBeenCalledWith({}, {
      cnpjDigits: "11222333000181",
      consultorId: "c1",
      propostaId: null,
      etapas,
      modelo: MODELO_GEMINI,
    });
  });

  it("com propostas: usa a mais recente no pedido e grava o id dela", async () => {
    preparar([propostaRecente, propostaAntiga]);

    await gerarAbordagemAction("11222333000181");

    const { usuario } = gerarJson.mock.calls[0][0];
    expect(usuario).toContain("Pós 100GB — por linha");
    expect(usuario).not.toContain("Pós 12GB antigo");
    expect(criarAbordagem).toHaveBeenCalledWith({}, expect.objectContaining({ propostaId: "prop-nova" }));
  });

  it("o pedido à IA não leva CNPJ, telefone nem e-mail do lead", async () => {
    preparar([propostaRecente]);

    await gerarAbordagemAction("11222333000181");

    const pedido = JSON.stringify(gerarJson.mock.calls[0][0]);
    for (const proibido of ["11222333000181", "1935737700", "19991002213", "contato@padaria.example"]) {
      expect(pedido).not.toContain(proibido);
    }
  });

  it.each([
    ["chave ausente", new IaNaoConfiguradaError(), /não está configurada/],
    ["cota esgotada", new IaCotaEsgotadaError(), /limite da IA/],
    ["IA sobrecarregada", new IaIndisponivelError(), /sobrecarregada/],
  ])("falha da IA (%s): mensagem amigável e nada é salvo", async (_nome, erro, esperado) => {
    preparar([]);
    gerarJson.mockRejectedValue(erro);
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await gerarAbordagemAction("11222333000181");

    expect(resultado.erro).toMatch(esperado);
    expect(criarAbordagem).not.toHaveBeenCalled();
    erroNoLog.mockRestore();
  });

  it("resposta fora do formato: mensagem amigável e nada é salvo", async () => {
    preparar([]);
    gerarJson.mockResolvedValue("isso não é JSON");
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await gerarAbordagemAction("11222333000181");

    expect(resultado.erro).toMatch(/roteiro utilizável/);
    expect(criarAbordagem).not.toHaveBeenCalled();
    erroNoLog.mockRestore();
  });

  it("erro do banco ao salvar: mensagem genérica e o erro real vai para o log do servidor", async () => {
    preparar([]);
    criarAbordagem.mockRejectedValue(new Error("banco fora do ar"));
    const erroNoLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const resultado = await gerarAbordagemAction("11222333000181");

    expect(resultado.erro).toMatch(/Não foi possível gerar a abordagem/);
    expect(erroNoLog).toHaveBeenCalled();
    erroNoLog.mockRestore();
  });
});
