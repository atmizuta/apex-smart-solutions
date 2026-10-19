import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase-admin", () => ({
  getSupabaseAdmin: () => ({}),
}));

const buscarConsultorPorId = vi.fn();
vi.mock("@/lib/consultores", () => ({
  buscarConsultorPorId: (...args: unknown[]) => buscarConsultorPorId(...args),
}));

const criarPlano = vi.fn();
const atualizarPlano = vi.fn();
const definirPlanoAtivo = vi.fn();
vi.mock("@/lib/catalogo", async () => {
  const actual = await vi.importActual<typeof import("@/lib/catalogo")>("@/lib/catalogo");
  return {
    ...actual,
    criarPlano: (...args: unknown[]) => criarPlano(...args),
    atualizarPlano: (...args: unknown[]) => atualizarPlano(...args),
    definirPlanoAtivo: (...args: unknown[]) => definirPlanoAtivo(...args),
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

import { criarPlanoAction, atualizarPlanoAction, definirPlanoAtivoAction } from "./actions";
import { PlanoJaExisteError } from "@/lib/catalogo";

const admin = {
  id: "1",
  nome: "Admin",
  username: "admin",
  papel: "admin" as const,
  ativo: true,
  criadoEm: "x",
  ultimoLogin: null,
};

const consultorComum = { ...admin, id: "2", nome: "Ana", username: "ana", papel: "consultor" as const };

function logarComo(consultor: typeof admin | typeof consultorComum) {
  cookieGet.mockReturnValue({ value: "token" });
  verifySessionToken.mockResolvedValue({ consultorId: consultor.id, papel: consultor.papel });
  buscarConsultorPorId.mockResolvedValue(consultor);
}

function formData(campos: Record<string, string>) {
  const fd = new FormData();
  for (const [chave, valor] of Object.entries(campos)) fd.set(chave, valor);
  return fd;
}

const camposValidos = { categoria: "adicional", nome: "Claro Monitor 2", valor: "149,90", observacao: "" };

beforeEach(() => {
  buscarConsultorPorId.mockReset();
  criarPlano.mockReset();
  atualizarPlano.mockReset();
  definirPlanoAtivo.mockReset();
  cookieGet.mockReset();
  verifySessionToken.mockReset();
});

describe("criarPlanoAction", () => {
  it("redireciona pra /login quando não há sessão", async () => {
    cookieGet.mockReturnValue(undefined);
    await expect(criarPlanoAction({}, formData(camposValidos))).rejects.toThrow("REDIRECT:/login");
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("rejeita quando o consultor logado não é admin", async () => {
    logarComo(consultorComum);
    await expect(criarPlanoAction({}, formData(camposValidos))).rejects.toThrow("Apenas administradores");
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("recusa categoria fora da lista", async () => {
    logarComo(admin);
    const resultado = await criarPlanoAction({}, formData({ ...camposValidos, categoria: "inexistente" }));
    expect(resultado.erro).toMatch(/categoria/i);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("recusa nome em branco", async () => {
    logarComo(admin);
    const resultado = await criarPlanoAction({}, formData({ ...camposValidos, nome: "   " }));
    expect(resultado.erro).toMatch(/nome/i);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("recusa valor inválido", async () => {
    logarComo(admin);
    const resultado = await criarPlanoAction({}, formData({ ...camposValidos, valor: "abc" }));
    expect(resultado.erro).toMatch(/valor/i);
    expect(criarPlano).not.toHaveBeenCalled();
  });

  it("cria o plano com valor em formato brasileiro e observação em branco virando null", async () => {
    logarComo(admin);
    criarPlano.mockResolvedValue({ id: "p1" });
    const resultado = await criarPlanoAction(
      {},
      formData({ ...camposValidos, nome: "  Claro Monitor 2  ", observacao: "   " })
    );
    expect(resultado).toEqual({ sucesso: true });
    expect(criarPlano).toHaveBeenCalledWith({}, {
      categoria: "adicional",
      nome: "Claro Monitor 2",
      valor: 149.9,
      observacao: null,
      franquiaGb: null,
    });
  });

  describe("franquia (GB)", () => {
    const pos = { categoria: "pos_nacional", nome: "Pós 40GB", valor: "54,99", observacao: "" };

    it("é obrigatória nos planos Pós", async () => {
      logarComo(admin);
      const resultado = await criarPlanoAction({}, formData(pos));
      expect(resultado.erro).toMatch(/franquia/i);
      expect(criarPlano).not.toHaveBeenCalled();
    });

    it.each(["abc", "0", "4,5", "-3", "1001", "40GB", " "])("recusa franquia %j", async (franquia) => {
      logarComo(admin);
      const resultado = await criarPlanoAction({}, formData({ ...pos, franquia }));
      expect(resultado.erro).toMatch(/franquia/i);
      expect(criarPlano).not.toHaveBeenCalled();
    });

    it("grava a franquia inteira (já sem espaços) nos planos Pós", async () => {
      logarComo(admin);
      criarPlano.mockResolvedValue({ id: "p1" });
      const resultado = await criarPlanoAction({}, formData({ ...pos, franquia: " 40 " }));
      expect(resultado).toEqual({ sucesso: true });
      expect(criarPlano).toHaveBeenCalledWith({}, {
        categoria: "pos_nacional",
        nome: "Pós 40GB",
        valor: 54.99,
        observacao: null,
        franquiaGb: 40,
      });
    });

    it("ignora a franquia nas categorias que não têm", async () => {
      logarComo(admin);
      criarPlano.mockResolvedValue({ id: "p1" });
      await criarPlanoAction({}, formData({ ...camposValidos, franquia: "99" }));
      expect(criarPlano).toHaveBeenCalledWith({}, expect.objectContaining({ categoria: "adicional", franquiaGb: null }));
    });
  });

  it("devolve a mensagem amigável quando o plano já existe", async () => {
    logarComo(admin);
    criarPlano.mockRejectedValue(new PlanoJaExisteError("Claro Monitor 2"));
    const resultado = await criarPlanoAction({}, formData(camposValidos));
    expect(resultado.erro).toMatch(/Já existe um plano/);
  });
});

describe("atualizarPlanoAction", () => {
  it("rejeita quando o consultor logado não é admin", async () => {
    logarComo(consultorComum);
    await expect(atualizarPlanoAction("p1", "89,90", "")).rejects.toThrow("Apenas administradores");
    expect(atualizarPlano).not.toHaveBeenCalled();
  });

  it("recusa valor inválido sem tocar no banco", async () => {
    logarComo(admin);
    const resultado = await atualizarPlanoAction("p1", "abc", "");
    expect(resultado.erro).toMatch(/valor/i);
    expect(atualizarPlano).not.toHaveBeenCalled();
  });

  it("atualiza valor e observação (já sem espaços nas pontas)", async () => {
    logarComo(admin);
    const resultado = await atualizarPlanoAction("p1", "89,90", "  promo  ");
    expect(resultado).toEqual({});
    expect(atualizarPlano).toHaveBeenCalledWith({}, "p1", { valor: 89.9, observacao: "promo" });
  });

  it("grava observação nula quando ela fica em branco", async () => {
    logarComo(admin);
    await atualizarPlanoAction("p1", "89,90", "   ");
    expect(atualizarPlano).toHaveBeenCalledWith({}, "p1", { valor: 89.9, observacao: null });
  });
});

describe("definirPlanoAtivoAction", () => {
  it("rejeita quando o consultor logado não é admin", async () => {
    logarComo(consultorComum);
    await expect(definirPlanoAtivoAction("p1", false)).rejects.toThrow("Apenas administradores");
    expect(definirPlanoAtivo).not.toHaveBeenCalled();
  });

  it("ativa/desativa o plano pedido", async () => {
    logarComo(admin);
    const resultado = await definirPlanoAtivoAction("p1", false);
    expect(resultado).toEqual({});
    expect(definirPlanoAtivo).toHaveBeenCalledWith({}, "p1", false);
  });
});
