// §167: a ficha que o agente monta. Toda escrita do modelo passa por aplicar() (validação no servidor);
// faltando() decide se a ficha pode ir para "pronto". Spec seção 4. Sem rede: testado com node --test.
import { chaveTelefone, soDigitos } from "./telefone.ts";

export type Servico = "moveis" | "fibra" | "outro";
export type Modalidade = "portabilidade" | "migracao" | "nova";
export type TipoDoc = "fatura" | "comprovante_recarga" | "cnh";
export type ParteMovel = { modalidade: Modalidade; quantidade: number; numeros?: string[] };
export type Documento = { mensagem_id: string; tipo: TipoDoc };
export type Ficha = {
  nome?: string; cpf?: string; cnpj?: string; cnpj_situacao?: string;
  servicos?: Servico[];
  moveis?: { total: number; partes: ParteMovel[] };
  velocidade?: "600" | "800" | "1000" | "mais";
  cep?: string; numero_endereco?: string; outro?: string;
  sem_comprovante?: boolean;
  documentos?: Documento[];
};

const SERVICOS = ["moveis", "fibra", "outro"];
const MODALIDADES = ["portabilidade", "migracao", "nova"];
const VELOCIDADES = ["600", "800", "1000", "mais"];

export function cpfValido(v: unknown): boolean {
  const d = soDigitos(v);
  if (d.length !== 11 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i);
    const r = (s * 10) % 11;
    return r === 10 ? 0 : r;
  };
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10]);
}

export function cnpjValido(v: unknown): boolean {
  const d = soDigitos(v);
  if (d.length !== 14 || /^(\d)\1+$/.test(d)) return false;
  const dv = (n: number) => {
    const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = pesos.reduce((a, p, i) => a + p * Number(d[i]), 0) % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13]);
}

function texto(v: unknown, min: number, max: number): string | null {
  const s = String(v ?? "").trim().replace(/\s+/g, " ");
  return s.length >= min && s.length <= max ? s : null;
}

function lerPartes(v: unknown): ParteMovel[] | null {
  if (!Array.isArray(v) || !v.length) return null;
  const partes: ParteMovel[] = [];
  for (const p of v) {
    const o = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
    const q = Number(o.quantidade);
    if (!MODALIDADES.includes(String(o.modalidade)) || !Number.isInteger(q) || q < 1 || q > 100) return null;
    const parte: ParteMovel = { modalidade: o.modalidade as Modalidade, quantidade: q };
    if (o.numeros !== undefined) {
      const nums = Array.isArray(o.numeros) ? o.numeros.map(soDigitos) : [];
      if (!nums.length || nums.some((n) => !chaveTelefone(n))) return null;
      parte.numeros = nums;
    }
    partes.push(parte);
  }
  return partes;
}

export function aplicar(atual: Ficha, campos: unknown): { ficha: Ficha; erros: string[] } {
  const f: Ficha = structuredClone(atual ?? {});
  const erros: string[] = [];
  if (!campos || typeof campos !== "object" || Array.isArray(campos)) return { ficha: f, erros: ["campos deve ser um objeto"] };
  for (const [k, v] of Object.entries(campos as Record<string, unknown>)) {
    switch (k) {
      case "nome": {
        const s = texto(v, 3, 120);
        if (s && s.split(" ").length >= 2) f.nome = s; else erros.push("nome: precisa de nome e sobrenome");
        break;
      }
      case "cpf": { const d = soDigitos(v); if (cpfValido(d)) f.cpf = d; else erros.push("cpf: inválido, confira os 11 números"); break; }
      case "cnpj": {
        const d = soDigitos(v);
        if (cnpjValido(d)) { if (d !== f.cnpj) delete f.cnpj_situacao; f.cnpj = d; } else erros.push("cnpj: inválido, confira os 14 números");
        break;
      }
      case "servicos": {
        const l = Array.isArray(v) ? [...new Set(v.map(String))] : [];
        if (l.length && l.every((s) => SERVICOS.includes(s))) f.servicos = l as Servico[];
        else erros.push(`servicos: use ${SERVICOS.join(", ")}`);
        break;
      }
      case "moveis_total": {
        const n = Number(v);
        if (Number.isInteger(n) && n >= 1 && n <= 100) f.moveis = { total: n, partes: f.moveis?.partes ?? [] };
        else erros.push("moveis_total: número inteiro de 1 a 100");
        break;
      }
      case "partes": {
        const p = lerPartes(v);
        if (p) f.moveis = { total: f.moveis?.total ?? 0, partes: p };
        else erros.push("partes: cada parte precisa de modalidade (portabilidade, migracao ou nova), quantidade de 1 a 100 e, se tiver, números com DDD");
        break;
      }
      case "velocidade": { const s = String(v ?? ""); if (VELOCIDADES.includes(s)) f.velocidade = s as Ficha["velocidade"]; else erros.push("velocidade: use 600, 800, 1000 ou mais"); break; }
      case "cep": { const d = soDigitos(v); if (d.length === 8) f.cep = d; else erros.push("cep: precisa de 8 números"); break; }
      case "numero_endereco": { const s = texto(v, 1, 10); if (s) f.numero_endereco = s; else erros.push("numero_endereco: de 1 a 10 caracteres"); break; }
      case "outro": { const s = texto(v, 3, 500); if (s) f.outro = s; else erros.push("outro: descreva em 3 a 500 caracteres"); break; }
      case "sem_comprovante": { if (typeof v === "boolean") f.sem_comprovante = v; else erros.push("sem_comprovante: true ou false"); break; }
      default: erros.push(`campo desconhecido: ${k}`);
    }
  }
  return { ficha: f, erros };
}

export function faltando(f: Ficha): string[] {
  const m: string[] = [];
  if (!f.nome) m.push("nome completo");
  if (!f.cnpj) m.push("CNPJ");
  if (!f.cpf) m.push("CPF");
  const s = f.servicos ?? [];
  if (!s.length) m.push("tipo de serviço");
  const tem = (t: TipoDoc) => (f.documentos ?? []).some((d) => d.tipo === t);
  const partes = f.moveis?.partes ?? [];
  if (s.includes("moveis")) {
    if (!f.moveis?.total) m.push("quantidade de linhas");
    if (!partes.length) m.push("modalidade das linhas (portabilidade, migração ou linha nova)");
    else {
      const soma = partes.reduce((a, p) => a + p.quantidade, 0);
      if (f.moveis?.total && soma !== f.moveis.total) m.push(`modalidade de todas as linhas (informado ${soma} de ${f.moveis.total})`);
      for (const p of partes) {
        if (p.modalidade !== "nova" && (p.numeros?.length ?? 0) < p.quantidade) m.push(`números das linhas de ${p.modalidade === "portabilidade" ? "portabilidade" : "migração"}`);
      }
      if (partes.some((p) => p.modalidade === "portabilidade") && !tem("fatura")) m.push("fatura das linhas da portabilidade");
      if (partes.some((p) => p.modalidade === "migracao") && !tem("fatura") && !tem("comprovante_recarga") && !f.sem_comprovante) m.push("fatura ou comprovante de recarga da migração");
    }
  }
  const precisaEndereco = s.includes("fibra") || (s.includes("moveis") && partes.some((p) => p.modalidade === "nova"));
  if (precisaEndereco && (!f.cep || !f.numero_endereco)) m.push("CEP e número do endereço");
  if (s.includes("fibra")) {
    if (!f.velocidade) m.push("velocidade da internet");
    if (!tem("cnh")) m.push("CNH (foto ou digital)");
  }
  if (s.includes("outro") && !f.outro) m.push("descrição do interesse");
  return [...new Set(m)];
}

export function alertas(f: Ficha): string[] {
  const a: string[] = [];
  const temMigracao = (f.moveis?.partes ?? []).some((p) => p.modalidade === "migracao");
  if (f.sem_comprovante && temMigracao) a.push("Migração sem fatura nem comprovante de recarga");
  if (f.cnpj_situacao === "NAO_ENCONTRADO") a.push("CNPJ não encontrado na Receita");
  else if (f.cnpj_situacao && f.cnpj_situacao !== "ATIVA") a.push(`CNPJ ${f.cnpj_situacao} na Receita`);
  return a;
}

export function adicionarDocumento(f: Ficha, d: Documento): Ficha {
  return { ...f, documentos: [...(f.documentos ?? []).filter((x) => x.mensagem_id !== d.mensagem_id), d] };
}
