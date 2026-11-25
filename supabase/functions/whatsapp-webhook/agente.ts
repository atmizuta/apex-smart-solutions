// §165: o laço do agente (Claude + ferramentas). Módulo puro: banco, Meta e Claude chegam por deps.
// Spec: docs/superpowers/specs/2026-11-24-whatsapp-agente-noturno-design.md (seções 4 e 6).
// Claude Opus 5.5: thinking sempre adaptativo (não mandar "thinking"), tool_choice forçado dá 400 (fica auto),
// sem prefill; conferir stop_reason antes de usar content. Fallback do servidor para recusa: fallbacks "default".
import { adicionarDocumento, alertas, aplicar, faltando } from "./ficha.ts";
import type { Ficha, TipoDoc } from "./ficha.ts";
import { chaveTelefone } from "./telefone.ts";
import { SISTEMA } from "./prompt.ts";

export const MODELO = "claude-opus-5-5";
export const MAX_VOLTAS = 5;
export const PRAZO_MS = 120_000;   // a Edge Function tem limite de tempo; o tick tenta de novo depois
const MIDIA_OK = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
const MAX_MIDIAS = 4;

export type Estado = "em_andamento" | "pronto" | "precisa_humano" | "encerrada";
export type Msg = { id: string; autor: "cliente" | "agente" | "consultor"; formato: string; texto: string | null; caminho: string | null; mime: string | null };
export type Contexto = {
  no_expediente: boolean; modo: "desligado" | "ensaio" | "ligado"; numeros_ensaio: string[]; max_respostas_noite: number;
  agora_texto: string; proximo_expediente: string;
  conversa: { id: string; telefone: string; estado: Estado; ficha: Ficha; respostas_noite: number; silenciosa: boolean; avisou_falha: boolean };
  lead: { nome: string | null; dono_nome: string | null } | null;
  mensagens: Msg[];
};
export type Bloco = { type: string; text?: string; id?: string; name?: string; input?: unknown; [k: string]: unknown };
export type RespostaClaude = { stop_reason: string | null; content: Bloco[] };
export type Salvar = { ficha?: Ficha; alertas?: string[]; estado?: Estado; motivo?: string };
export type DepsAgente = {
  contexto(conversa: string): Promise<Contexto>;
  travar(conversa: string): Promise<boolean>;
  liberar(conversa: string): Promise<void>;
  adiar(conversa: string): Promise<void>;          // falhou_em = agora: o tick espera 10 min
  avisouFalha(conversa: string): Promise<void>;    // a mensagem fixa de falha já saiu nesta noite
  claude(pedido: Record<string, unknown>): Promise<RespostaClaude>;
  midiaBase64(caminho: string): Promise<string>;
  salvar(conversa: string, s: Salvar): Promise<void>;
  situacaoCnpj(cnpj: string): Promise<string | null>;
  noExpediente(): Promise<boolean>;
  ultimaDoCliente(conversa: string): Promise<string | null>;
  enviar(telefone: string, texto: string): Promise<string>;
  registrarEnvio(conversa: string, wamid: string, texto: string, formato: "texto" | "aviso"): Promise<void>;
  aviso(chave: string, valor: unknown): Promise<void>;
  ms(): number;
  log(msg: string): void;
};

const CAMPOS_FICHA = {
  type: "object",
  properties: {
    nome: { type: "string", description: "Nome completo" },
    cpf: { type: "string" }, cnpj: { type: "string" },
    servicos: { type: "array", items: { type: "string", enum: ["moveis", "fibra", "outro"] } },
    moveis_total: { type: "integer", description: "Total de linhas móveis" },
    partes: {
      type: "array", description: "Divisão das linhas móveis por modalidade",
      items: { type: "object", properties: {
        modalidade: { type: "string", enum: ["portabilidade", "migracao", "nova"] },
        quantidade: { type: "integer" },
        numeros: { type: "array", items: { type: "string" }, description: "Telefones com DDD; só portabilidade e migração" },
      }, required: ["modalidade", "quantidade"] },
    },
    velocidade: { type: "string", enum: ["600", "800", "1000", "mais"] },
    cep: { type: "string" }, numero_endereco: { type: "string" },
    outro: { type: "string", description: "Descrição do outro interesse" },
    sem_comprovante: { type: "boolean", description: "true quando o cliente da migração não tem fatura nem comprovante de recarga" },
  },
};

export const FERRAMENTAS = [
  { name: "salvar_ficha", description: "Guarda na ficha as informações que o cliente deu. Mande só os campos novos ou corrigidos. Devolve o que ainda falta ou os erros.",
    input_schema: { type: "object", properties: { campos: CAMPOS_FICHA }, required: ["campos"] } },
  { name: "guardar_documento", description: "Anexa à ficha uma foto ou PDF que o cliente mandou, depois de você conferir que é o documento certo e que dá para ler.",
    input_schema: { type: "object", properties: { mensagem_id: { type: "string" }, tipo: { type: "string", enum: ["fatura", "comprovante_recarga", "cnh"] } }, required: ["mensagem_id", "tipo"] } },
  { name: "pedir_humano", description: "Passa a conversa para um consultor no próximo atendimento (reclamação, cancelamento, problema técnico, irritação, pedido de pessoa ou assunto fora de vendas).",
    input_schema: { type: "object", properties: { motivo: { type: "string", description: "Uma frase curta, sem dados pessoais" } }, required: ["motivo"] } },
  { name: "ficha_completa", description: "Marca a ficha como pronta depois que o cliente confirmou o resumo. Recusa se faltar algo.",
    input_schema: { type: "object", properties: {} } },
];

export function pedido(mensagens: unknown[]): Record<string, unknown> {
  return {
    model: MODELO, max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"], fallbacks: "default",
    output_config: { effort: "medium" },
    system: [{ type: "text", text: SISTEMA, cache_control: { type: "ephemeral" } }],
    tools: FERRAMENTAS, messages: mensagens,
  };
}

export function midiasDoLote(ctx: Contexto): Msg[] {
  let i = ctx.mensagens.length;
  while (i > 0 && ctx.mensagens[i - 1].autor === "cliente") i--;
  return ctx.mensagens.slice(i).filter((m) => m.caminho && MIDIA_OK.includes(m.mime ?? "")).slice(-MAX_MIDIAS);
}

function textoCliente(m: Msg, anexada: boolean): string {
  const leg = m.texto?.trim() ? ` Legenda: ${m.texto.trim()}` : "";
  if (m.formato === "texto") return m.texto?.trim() || "(mensagem vazia)";
  if (m.formato === "imagem" || m.formato === "documento") {
    if (anexada) return `[${m.formato} anexada, mensagem_id=${m.id}]${leg}`;
    if (!m.caminho) return `[${m.formato} que não consegui baixar (grande demais ou falhou), mensagem_id=${m.id}]${leg}`;
    if (!MIDIA_OK.includes(m.mime ?? "")) return `[documento em formato que você não abre, mensagem_id=${m.id}: peça foto ou PDF]${leg}`;
    return `[${m.formato} recebida antes, mensagem_id=${m.id}]${leg}`;
  }
  if (m.formato === "audio") return "[áudio recebido: você não ouve áudios]";
  return "[mensagem de um tipo que você não lê: você só lê texto, foto e PDF]";
}

export function montarMensagens(ctx: Contexto, midias: Map<string, string>): { role: string; content: unknown }[] {
  const out: { role: string; content: unknown }[] = [];
  for (const m of ctx.mensagens) {
    if (m.autor === "cliente") {
      const partes: unknown[] = [];
      const b64 = midias.get(m.id);
      if (b64 && m.mime) {
        partes.push(m.mime === "application/pdf"
          ? { type: "document", source: { type: "base64", media_type: m.mime, data: b64 } }
          : { type: "image", source: { type: "base64", media_type: m.mime, data: b64 } });
      }
      partes.push({ type: "text", text: textoCliente(m, !!b64) });
      out.push({ role: "user", content: partes });
    } else {
      const t = (m.texto ?? "").trim();
      if (!t || !out.length) continue;   // a conversa na API começa pelo cliente
      out.push({ role: "assistant", content: m.autor === "consultor" ? `(mensagem do consultor) ${t}` : t });
    }
  }
  return out;
}

export function estadoTexto(ctx: Contexto, ficha: Ficha): string {
  const l = ctx.lead;
  const dono = l?.dono_nome ? String(l.dono_nome).trim().split(/\s+/)[0] : null;
  const f = faltando(ficha);
  return [
    `Estado da conversa (sistema). Agora: ${ctx.agora_texto}.`,
    `Próximo atendimento dos consultores: ${ctx.proximo_expediente}.`,
    l ? `O cliente já está no nosso cadastro${dono ? `; consultor responsável: ${dono}` : "; ainda sem consultor responsável"}.` : "Cliente novo.",
    ctx.conversa.respostas_noite === 0 ? "Esta é a primeira resposta da noite: apresente-se." : "Você já se apresentou nesta noite.",
    `Ficha até agora: ${JSON.stringify(ficha)}.`,
    `Falta: ${f.length ? f.join("; ") : "nada"}.`,
    `Situação da ficha: ${ctx.conversa.estado}.`,
  ].join("\n");
}

async function enviarTexto(ctx: Contexto, d: DepsAgente, texto: string, formato: "texto" | "aviso"): Promise<boolean> {
  if (await d.noExpediente()) return false;   // abriu o expediente enquanto pensava: o consultor assume
  try {
    const wamid = await d.enviar(ctx.conversa.telefone, texto);
    await d.registrarEnvio(ctx.conversa.id, wamid, texto, formato);
    return true;
  } catch (e) {
    d.log(`envio falhou: ${(e as Error).message}`);
    await d.aviso("wa_erro", { em: new Date(d.ms()).toISOString(), erro: "envio" });
    await d.adiar(ctx.conversa.id);
    return false;
  }
}

async function falhar(ctx: Contexto, d: DepsAgente, motivo: string): Promise<string> {
  await d.aviso("wa_erro", { em: new Date(d.ms()).toISOString(), erro: motivo });
  await d.adiar(ctx.conversa.id);
  if (!ctx.conversa.avisou_falha) {
    const saiu = await enviarTexto(ctx, d, `Tive um problema para responder agora, mas sua mensagem está anotada. Um consultor fala com você ${ctx.proximo_expediente}.`, "aviso");
    if (saiu) await d.avisouFalha(ctx.conversa.id);
  }
  return "falha";
}

type Saida = { ficha: Ficha; conteudo: string; erro?: boolean };

async function executar(u: Bloco, ctx: Contexto, d: DepsAgente, ficha: Ficha): Promise<Saida> {
  const conversa = ctx.conversa.id;
  const inp = (u.input && typeof u.input === "object" ? u.input : {}) as Record<string, unknown>;
  const falta = (f: Ficha) => {
    const l = faltando(f);
    return l.length ? `Ainda falta: ${l.join("; ")}.` : "A ficha tem tudo. Mande o resumo para o cliente confirmar.";
  };
  switch (u.name) {
    case "salvar_ficha": {
      const r = aplicar(ficha, inp.campos);
      if (r.ficha.cnpj && r.ficha.cnpj !== ficha.cnpj) {
        const s = await d.situacaoCnpj(r.ficha.cnpj).catch(() => null);
        if (s) r.ficha.cnpj_situacao = s;
      }
      await d.salvar(conversa, { ficha: r.ficha, alertas: alertas(r.ficha) });
      const sit = r.ficha.cnpj_situacao && r.ficha.cnpj_situacao !== "ATIVA" && r.ficha.cnpj_situacao !== ficha.cnpj_situacao
        ? " Na Receita esse CNPJ aparece como não ativo: siga com o pedido, o consultor confere." : "";
      const ini = r.erros.length ? `Não guardei: ${r.erros.join("; ")}. ` : "Guardado. ";
      return { ficha: r.ficha, conteudo: ini + falta(r.ficha) + sit, ...(r.erros.length ? { erro: true } : {}) };
    }
    case "guardar_documento": {
      const id = String(inp.mensagem_id ?? ""), tipo = String(inp.tipo ?? "");
      const m = ctx.mensagens.find((x) => x.id === id && x.autor === "cliente");
      if (!m || !m.caminho || (m.formato !== "imagem" && m.formato !== "documento")) return { ficha, conteudo: "Essa mensagem não é uma foto ou PDF desta conversa.", erro: true };
      if (!["fatura", "comprovante_recarga", "cnh"].includes(tipo)) return { ficha, conteudo: "tipo deve ser fatura, comprovante_recarga ou cnh.", erro: true };
      const f = adicionarDocumento(ficha, { mensagem_id: id, tipo: tipo as TipoDoc });
      await d.salvar(conversa, { ficha: f, alertas: alertas(f) });
      return { ficha: f, conteudo: "Documento anexado. " + falta(f) };
    }
    case "pedir_humano": {
      const motivo = String(inp.motivo ?? "").trim().slice(0, 200) || "pedido do cliente";
      await d.salvar(conversa, { estado: "precisa_humano", motivo });
      return { ficha, conteudo: `Anotado. Avise o cliente, numa mensagem curta, que um consultor fala com ele ${ctx.proximo_expediente}, e não pergunte mais nada.` };
    }
    case "ficha_completa": {
      const l = faltando(ficha);
      if (l.length) return { ficha, conteudo: `Ainda não: falta ${l.join("; ")}.`, erro: true };
      await d.salvar(conversa, { estado: "pronto" });
      return { ficha, conteudo: `Ficha pronta. Diga que o consultor chama ${ctx.proximo_expediente} para confirmar os valores e finalizar.` };
    }
    default:
      return { ficha, conteudo: `ferramenta desconhecida: ${u.name}`, erro: true };
  }
}

async function rodar(ctx: Contexto, d: DepsAgente, ultimaId: string): Promise<string> {
  const conversa = ctx.conversa.id;
  let ficha: Ficha = ctx.conversa.ficha ?? {};
  const midias = new Map<string, string>();
  for (const m of midiasDoLote(ctx)) {
    try { midias.set(m.id, await d.midiaBase64(m.caminho!)); } catch { d.log(`mídia ${m.id} não abriu`); }
  }
  const msgs: unknown[] = montarMensagens(ctx, midias);
  msgs.push({ role: "system", content: estadoTexto(ctx, ficha) });
  const inicio = d.ms();
  let texto = "";
  for (let volta = 0; ; volta++) {
    if (volta >= MAX_VOLTAS || d.ms() - inicio > PRAZO_MS) return await falhar(ctx, d, "voltas");
    let r: RespostaClaude;
    try {
      r = await d.claude(pedido(msgs));
    } catch (e1) {
      d.log(`claude falhou: ${(e1 as Error).message}`);
      try { r = await d.claude(pedido(msgs)); } catch (e2) { d.log(`claude falhou de novo: ${(e2 as Error).message}`); return await falhar(ctx, d, "claude"); }
    }
    if (r.stop_reason === "refusal") {
      await d.salvar(conversa, { estado: "precisa_humano", motivo: "o modelo não respondeu (recusa)" });
      await enviarTexto(ctx, d, `Sua mensagem está anotada. Um consultor fala com você ${ctx.proximo_expediente}.`, "texto");
      return "recusa";
    }
    if (r.stop_reason === "max_tokens") return await falhar(ctx, d, "max_tokens");
    msgs.push({ role: "assistant", content: r.content });   // conteúdo inteiro, sem editar (thinking preservado)
    const usos = r.content.filter((b) => b.type === "tool_use");
    if (!usos.length) {
      texto = r.content.filter((b) => b.type === "text").map((b) => String(b.text ?? "").trim()).filter(Boolean).join("\n\n");
      break;
    }
    const resultados: unknown[] = [];
    for (const u of usos) {
      const s = await executar(u, ctx, d, ficha);
      ficha = s.ficha;
      resultados.push({ type: "tool_result", tool_use_id: u.id, content: s.conteudo, ...(s.erro ? { is_error: true } : {}) });
    }
    msgs.push({ role: "user", content: resultados });   // todos os resultados numa mensagem só
  }
  if (!texto) { await d.adiar(conversa); return "sem_texto"; }
  if ((await d.ultimaDoCliente(conversa)) !== ultimaId) return "nova_mensagem";   // o tick responde a mais nova
  return (await enviarTexto(ctx, d, texto, "texto")) ? "respondeu" : "nao_enviou";
}

export async function atender(conversa: string, d: DepsAgente, esperado?: string): Promise<string> {
  const ctx = await d.contexto(conversa);
  const c = ctx.conversa;
  if (ctx.no_expediente) return "expediente";
  if (ctx.modo === "desligado") return "desligado";
  if (ctx.modo === "ensaio") {
    const lista = ctx.numeros_ensaio.map(chaveTelefone).filter(Boolean);
    if (!lista.includes(chaveTelefone(c.telefone))) return "fora_do_ensaio";
  }
  if (c.silenciosa) return "silencio";
  const ultima = ctx.mensagens.at(-1);
  if (!ultima || ultima.autor !== "cliente") return "sem_mensagem_nova";
  if (esperado && ultima.id !== esperado) return "nova_mensagem";
  if (!(await d.travar(conversa))) return "travada";
  try {
    if (c.respostas_noite >= ctx.max_respostas_noite) {
      await d.salvar(conversa, { estado: "precisa_humano", motivo: "limite de respostas da noite" });
      await enviarTexto(ctx, d, `Anotei tudo por aqui. Um consultor fala com você ${ctx.proximo_expediente}.`, "texto");
      return "limite";
    }
    return await rodar(ctx, d, ultima.id);
  } finally {
    await d.liberar(conversa);
  }
}
