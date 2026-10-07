// Lógica pura da Edge Function caderno-ia (06/10/2026, REGRAS_NEGOCIO.md §72). Sem Deno/rede/Supabase: testável com
// `node --test`. Spec: docs/superpowers/specs/2026-10-06-caderno-agenda-objecoes-design.md (seções 6.3 e 10).

export type Contexto = { qtd_linhas: number | null; valor_plano: number | null; operadora_atual: string; fidelidade_vence: string; interesse: string[]; texto: string };
export type Entrada = { objecao_chave: string | null; objecao_livre: string | null; contexto: Contexto };
export type Objecao = { chave: string; rotulo: string; fala: string; pergunta: string; alternativa: string };
export type DepsIA = {
  buscarObjecao(chave: string): Promise<Objecao | null>;
  listarObjecoes(): Promise<Objecao[]>;
  contarChamadas(uid: string, desdeIso: string): Promise<number>;
  registrarChamada(r: { consultor_id: string; objecao: string | null; status: string; ms: number }): Promise<void>;
  chamarGemini(prompt: string): Promise<string>;
  agora(): number;
};

export const LIMITE_CHAMADAS = 20;
export const JANELA_MIN = 10;

// Segunda barreira: o painel já não manda esses campos, mas o texto livre pode conter qualquer coisa.
export function mascarar(texto: string): string {
  return String(texto ?? "")
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[EMAIL]")
    .replace(/\b\d{2}\.?\d{3}\.?\d{3}\/?\d{4}-?\d{2}\b/g, "[CNPJ]")
    .replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, "[CPF]")
    .replace(/\(?\b\d{2}\)?\s?9?\d{4}[-\s]?\d{4}\b/g, (m) => {
      const d = m.replace(/\D/g, "");
      // 11 dígitos com 3º dígito diferente de 9 não é celular com DDD: trata como CPF
      if (d.length === 11 && d[2] !== "9") return "[CPF]";
      return "[TELEFONE]";
    })
    .replace(/\b\d{11}\b/g, "[CPF]")
    .replace(/\b\d{5}-\d{3}\b/g, "[CEP]");
}

const txt = (v: unknown, max: number) => String(v ?? "").trim().slice(0, max);
const num = (v: unknown) => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(String(v).replace(/\./g, "").replace(",", "."));
  return Number.isFinite(n) ? n : null;
};

export function validarEntrada(corpo: unknown): { ok: true; dados: Entrada } | { ok: false; erro: string } {
  if (!corpo || typeof corpo !== "object") return { ok: false, erro: "corpo inválido" };
  const c = corpo as Record<string, unknown>;
  const chave = c.objecao_chave == null ? null : String(c.objecao_chave);
  const livre = c.objecao_livre == null ? null : txt(c.objecao_livre, 300);
  if (chave !== null && !/^[a-z0-9_]{2,40}$/.test(chave)) return { ok: false, erro: "objeção inválida" };
  if (!chave && !livre) return { ok: false, erro: "informe a objeção" };
  const ctx = (c.contexto && typeof c.contexto === "object" ? c.contexto : {}) as Record<string, unknown>;
  return {
    ok: true,
    dados: {
      objecao_chave: chave, objecao_livre: livre || null,
      contexto: {
        qtd_linhas: num(ctx.qtd_linhas), valor_plano: num(ctx.valor_plano),
        operadora_atual: txt(ctx.operadora_atual, 40), fidelidade_vence: txt(ctx.fidelidade_vence, 10),
        interesse: Array.isArray(ctx.interesse) ? ctx.interesse.map((x) => txt(x, 20)).slice(0, 5) : [],
        texto: txt(ctx.texto, 2000),
      },
    },
  };
}

export function montarPrompt(dados: Entrada, base: Objecao | null, todas: Objecao[]): string {
  const c = dados.contexto;
  const linhas = [
    "Você é um consultor experiente da Claro Empresas (B2B, telefonia móvel e fibra para CNPJ), em uma ligação AGORA.",
    "Escreva o que o consultor deve FALAR ao cliente, em português do Brasil, tom direto e cordial, como fala ao telefone.",
    "Regras: no máximo 3 frases na fala; nunca cite preço em R$, promoção, desconto, prazo ou condição que não esteja abaixo;",
    "franquias que podem ser citadas: 12GB, 40GB, 70GB, 100GB e 150GB (ancoragem: começar em 100GB ou 70GB).",
    "Termine com UMA pergunta de contorno para entender o motivo real.",
    "",
    "Dados do atendimento (dados pessoais já removidos):",
    `- linhas: ${c.qtd_linhas ?? "não informado"}; valor que paga hoje: ${c.valor_plano ?? "não informado"}`,
    `- operadora atual: ${c.operadora_atual || "não informada"}; fidelidade vence: ${c.fidelidade_vence || "não informado"}`,
    `- interesse: ${c.interesse.join(", ") || "não informado"}`,
    `- anotação do consultor: ${mascarar(c.texto) || "(vazia)"}`,
    "",
  ];
  if (base) {
    linhas.push(`Objeção do cliente: "${base.rotulo}".`, `Resposta aprovada pela empresa (use como base e adapte ao cliente): ${base.fala}`,
      `Pergunta aprovada: ${base.pergunta}`, `Alternativa de oferta: ${base.alternativa}`);
  } else {
    linhas.push(`O cliente disse: "${mascarar(dados.objecao_livre ?? "")}".`, "Respostas aprovadas pela empresa para outras objeções (siga o mesmo estilo):",
      ...todas.slice(0, 9).map((o) => `- ${o.rotulo}: ${o.fala}`));
  }
  linhas.push("", 'Responda SOMENTE com JSON: {"fala": "...", "pergunta": "..."}');
  return linhas.join("\n");
}

function tresFrases(s: string): string {
  const partes = s.trim().match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [];
  return partes.slice(0, 3).map((p) => p.trim()).join(" ");
}

export function lerRespostaIA(bruto: string): { fala: string; pergunta: string } | null {
  const limpo = String(bruto ?? "").replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "");
  try {
    const j = JSON.parse(limpo);
    if (!j || typeof j.fala !== "string" || !j.fala.trim()) return null;
    return { fala: tresFrases(j.fala), pergunta: typeof j.pergunta === "string" ? j.pergunta.trim() : "" };
  } catch {
    return null;
  }
}

export async function responder(corpo: unknown, uid: string, deps: DepsIA): Promise<{ status: number; body: Record<string, unknown> }> {
  const v = validarEntrada(corpo);
  if (!v.ok) return { status: 400, body: { error: v.erro } };
  const inicio = deps.agora();
  const desde = new Date(inicio - JANELA_MIN * 60000).toISOString();
  if ((await deps.contarChamadas(uid, desde)) >= LIMITE_CHAMADAS) return { status: 429, body: { error: "limite" } };
  let base: Objecao | null = null;
  let todas: Objecao[] = [];
  if (v.dados.objecao_chave) {
    base = await deps.buscarObjecao(v.dados.objecao_chave);
    if (!base) return { status: 404, body: { error: "objeção não encontrada" } };
  } else {
    todas = await deps.listarObjecoes();
  }
  const objecao = v.dados.objecao_chave ?? "livre";
  try {
    const bruto = await deps.chamarGemini(montarPrompt(v.dados, base, todas));
    const r = lerRespostaIA(bruto);
    if (!r) {
      await deps.registrarChamada({ consultor_id: uid, objecao, status: "resposta_invalida", ms: deps.agora() - inicio });
      return { status: 503, body: { error: "ia_indisponivel" } };
    }
    await deps.registrarChamada({ consultor_id: uid, objecao, status: "ok", ms: deps.agora() - inicio });
    return { status: 200, body: r };
  } catch {
    await deps.registrarChamada({ consultor_id: uid, objecao, status: "erro_ia", ms: deps.agora() - inicio });
    return { status: 503, body: { error: "ia_indisponivel" } };
  }
}
