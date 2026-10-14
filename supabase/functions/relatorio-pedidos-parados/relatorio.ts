// Orquestração do relatório diário de pedidos parados (spec §2, §5 e §6). Tudo o que fala com o mundo chega
// por Deps, para testar sem banco nem SMTP. Toda execução grava exatamente um registro no log.
import { diaSp, ehDiaUtil, montarPedidos, resumir } from "./regras.ts";
import type { Linha, Pedido } from "./regras.ts";
import { nomeArquivo } from "./planilha.ts";
import type { InfoPlanilha } from "./planilha.ts";
import { montarEmail } from "./email.ts";

export type Modo = "agendado" | "teste" | "reenviar";
export const MODOS: Modo[] = ["agendado", "teste", "reenviar"];
export interface Destinatarios { para: string[]; cc: string[]; ativo: boolean }
export interface Mensagem {
  para: string[]; cc: string[]; assunto: string; html: string; texto: string;
  anexo: { nome: string; bytes: Uint8Array } | null;
}
export interface RegistroEnvio {
  modo: Modo; data_ref: string; status: "enviado" | "pulado" | "erro"; motivo: string | null;
  qtd_pedidos: number | null; destinatarios: string[]; erro: string | null;
}
export interface Deps {
  agora(): Date;
  lerDestinatarios(): Promise<Destinatarios | null>;
  jaEnviouHoje(diaRef: string): Promise<boolean>;
  lerLinhas(): Promise<Linha[]>;
  ultimaSincronizacao(): Promise<Date | null>;
  gerarPlanilha(pedidos: Pedido[], info: InfoPlanilha): Promise<Uint8Array>;
  enviar(m: Mensagem): Promise<void>;
  registrar(r: RegistroEnvio): Promise<void>;
}
export interface Opcoes { modo: Modo; paraTeste?: unknown }

const MAX_ENDERECOS_TESTE = 10;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const mensagem = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function validarEmails(lista: unknown): string[] | null {
  if (!Array.isArray(lista) || lista.length === 0 || lista.length > MAX_ENDERECOS_TESTE) return null;
  const limpos = lista.map((x) => (typeof x === "string" ? x.trim() : ""));
  return limpos.every((x) => EMAIL_RE.test(x)) ? limpos : null;
}

export function ocultarSegredo(texto: string, segredo: string | undefined): string {
  return segredo ? texto.split(segredo).join("***") : texto;
}

// A denomailer não tem timeout: um SMTP travado mataria a função sem gravar o log.
export function comPrazo<T>(p: Promise<T>, ms: number, rotulo: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const prazo = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${rotulo}: tempo esgotado (${ms} ms)`)), ms);
  });
  return Promise.race([p, prazo]).finally(() => clearTimeout(timer));
}

export const TAMANHO_PAGINA = 1000;
const MAX_PAGINAS = 100;
export async function lerTodasPaginas<T>(buscar: (de: number, ate: number) => Promise<T[]>, tamanho = TAMANHO_PAGINA): Promise<T[]> {
  const todas: T[] = [];
  for (let pagina = 0; pagina < MAX_PAGINAS; pagina++) {
    const de = pagina * tamanho;
    const lote = await buscar(de, de + tamanho - 1);
    todas.push(...lote);
    if (lote.length < tamanho) return todas;
  }
  throw new Error(`leitura passou de ${MAX_PAGINAS} páginas — algo errado na consulta`);
}

export async function executarRelatorio(deps: Deps, op: Opcoes): Promise<RegistroEnvio> {
  const agora = deps.agora();
  const diaRef = diaSp(agora)!;
  const fim = async (r: Omit<RegistroEnvio, "modo" | "data_ref">): Promise<RegistroEnvio> => {
    const reg: RegistroEnvio = { modo: op.modo, data_ref: diaRef, ...r };
    await deps.registrar(reg);
    return reg;
  };
  const pulado = (motivo: string, destinatarios: string[] = []) =>
    fim({ status: "pulado", motivo, qtd_pedidos: null, destinatarios, erro: null });
  const erro = (motivo: string, msg: string, destinatarios: string[] = []) =>
    fim({ status: "erro", motivo, qtd_pedidos: null, destinatarios, erro: msg });

  if (op.modo !== "teste" && !ehDiaUtil(diaRef)) return pulado("feriado ou fim de semana");

  let para: string[];
  let cc: string[] = [];
  if (op.modo === "teste") {
    const lista = validarEmails(op.paraTeste);
    if (!lista) return erro("modo teste sem endereço válido", `informe "para" com 1 a ${MAX_ENDERECOS_TESTE} e-mails válidos`);
    para = lista;
  } else {
    let d: Destinatarios | null;
    try { d = await deps.lerDestinatarios(); } catch (e) { return erro("falha ao ler a configuração", mensagem(e)); }
    if (!d || d.para.length === 0) return erro("sem destinatário", "cadastre os destinatários em relatorio_destinatarios");
    if (!d.ativo) return pulado("envio pausado (ativo = false)", [...d.para, ...d.cc]);
    para = d.para;
    cc = d.cc;
    if (op.modo === "agendado") {
      let ja: boolean;
      try { ja = await deps.jaEnviouHoje(diaRef); } catch (e) { return erro("falha ao ler a configuração", mensagem(e), [...para, ...cc]); }
      if (ja) return pulado("já enviado hoje", [...para, ...cc]);
    }
  }
  const todos = [...para, ...cc];

  let linhas: Linha[];
  try {
    linhas = await deps.lerLinhas();
  } catch (e) {
    return erro("falha ao ler os pedidos", mensagem(e), todos);
  }
  // sem a hora da sincronização o e-mail sai mesmo assim, com o aviso de "não foi possível confirmar" (§4.1)
  const sincronizadoEm = await deps.ultimaSincronizacao().catch(() => null);

  const pedidos = montarPedidos(linhas, diaRef);
  let anexo: Mensagem["anexo"] = null;
  if (pedidos.length > 0) {
    try {
      anexo = { nome: nomeArquivo(diaRef), bytes: await deps.gerarPlanilha(pedidos, { diaRef, sincronizadoEm }) };
    } catch (e) {
      return erro("falha ao gerar a planilha", mensagem(e), todos);
    }
  }

  const email = montarEmail({ diaRef, resumo: resumir(pedidos), sincronizadoEm, agora, teste: op.modo === "teste" });
  try {
    await deps.enviar({ para, cc, ...email, anexo });
  } catch (e) {
    return erro("falha no envio (SMTP)", mensagem(e), todos);
  }
  return fim({ status: "enviado", motivo: null, qtd_pedidos: pedidos.length, destinatarios: todos, erro: null });
}
