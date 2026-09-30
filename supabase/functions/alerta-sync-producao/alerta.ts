// Alerta de sincronização da produção parada (NeoSales). Toda a decisão é pura e testável; o que fala com o
// banco e com o Telegram entra por dependências injetadas (ver index.ts).
//
// Regra: se a última sincronização bem-sucedida tem mais de `limiteHoras`, abre UM alerta e avisa; enquanto
// continuar parado não repete (sem spam a cada 15 min); quando volta a sincronizar, resolve e avisa que voltou.
// Se o canal (Telegram) não estiver configurado, o alerta fica registrado e o aviso pendente sai assim que o
// canal for configurado; falha ao enviar nunca derruba a execução.

export type Acao = "nada" | "abrir" | "resolver";

const HORA_MS = 3_600_000;

export function decidirAlerta(p: { agora: Date; ultimoOkEm: Date | null; alertaAberto: boolean; limiteHoras: number }): Acao {
  const horas = p.ultimoOkEm ? (p.agora.getTime() - p.ultimoOkEm.getTime()) / HORA_MS : Infinity;
  const parado = horas > p.limiteHoras;
  if (parado && !p.alertaAberto) return "abrir";
  if (!parado && p.alertaAberto) return "resolver";
  return "nada";
}

function pad(n: number): string { return String(n).padStart(2, "0"); }
function dataHoraSP(d: Date): string {
  const s = new Date(d.getTime() - 3 * HORA_MS); // São Paulo = UTC-3 fixo
  return `${pad(s.getUTCDate())}/${pad(s.getUTCMonth() + 1)} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}`;
}
function duracao(h: number): string { return h < 1 ? "menos de 1 h" : `${Math.round(h)} h`; }

export interface DadosMensagem { agora: Date; ultimoOkEm: Date | null; ultimoErro: string | null; horasParado?: number }

export function montarMensagem(tipo: "abertura" | "resolucao", d: DadosMensagem): string {
  if (tipo === "resolucao") {
    const quando = d.ultimoOkEm ? ` Última sincronização: ${dataHoraSP(d.ultimoOkEm)} (horário de SP).` : "";
    const tempo = d.horasParado !== undefined ? ` Ficou parada por cerca de ${duracao(d.horasParado)}.` : "";
    return `✅ Sincronização da produção voltou ao normal.${quando}${tempo}`;
  }
  const cabecalho = d.ultimoOkEm
    ? `⚠️ Sincronização da produção parada há ${duracao((d.agora.getTime() - d.ultimoOkEm.getTime()) / HORA_MS)}. ` +
      `Última sincronização bem-sucedida: ${dataHoraSP(d.ultimoOkEm)} (horário de SP).`
    : "⚠️ Sincronização da produção parada: nenhuma sincronização bem-sucedida registrada.";
  const erro = d.ultimoErro
    ? ` Último erro: ${d.ultimoErro.slice(0, 300)}.`
    : " Nenhum erro registrado: o agendamento (pg_cron) ou a função podem estar parados.";
  return `${cabecalho}${erro} O painel continua mostrando os dados da última sincronização. Detalhes na aba Upload Dash.`;
}

// ---------------------------------------------------------------- Telegram
function sanitizar(t: string, token: string): string { return token ? t.split(token).join("***") : t; }

export async function enviarTelegram(
  cfg: { token: string; chatId: string },
  texto: string,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  const url = `https://api.telegram.org/bot${cfg.token}/sendMessage`;
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: cfg.chatId, text: texto }), // sem parse_mode: o texto do erro vem de fora
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error("Falha de rede ao chamar o Telegram: " + sanitizar(String((e as Error).message), cfg.token));
  }
  if (!res.ok) {
    let desc = "";
    try { desc = String(((await res.json()) as { description?: string }).description ?? ""); } catch { /* corpo não-JSON */ }
    throw new Error(`Telegram recusou o envio (HTTP ${res.status}): ${sanitizar(desc, cfg.token)}`);
  }
}

// ---------------------------------------------------------------- orquestração
export interface AlertaAberto { id: number; abertoEm: Date; notificadoAbertura: boolean }

export interface DepsAlerta {
  agora(): Date;
  ultimoOkEm(): Promise<Date | null>;
  ultimoErro(): Promise<string | null>;
  alertaAberto(): Promise<AlertaAberto | null>;
  abrirAlerta(info: { ultimoOkEm: Date | null; ultimoErro: string | null }): Promise<number>;
  resolverAlerta(id: number): Promise<void>;
  marcarNotificado(id: number, tipo: "abertura" | "resolucao"): Promise<void>;
  notificar(texto: string): Promise<boolean>; // false = nenhum canal configurado
}

export interface ResultadoAlerta { acao: Acao; notificado: boolean; erroEnvio: string | null; horasSemSucesso: number | null }

export async function executarAlerta(deps: DepsAlerta, p: { limiteHoras: number }): Promise<ResultadoAlerta> {
  const agora = deps.agora();
  const ultimoOkEm = await deps.ultimoOkEm();
  const aberto = await deps.alertaAberto();
  const acao = decidirAlerta({ agora, ultimoOkEm, alertaAberto: aberto !== null, limiteHoras: p.limiteHoras });
  const horasSemSucesso = ultimoOkEm ? (agora.getTime() - ultimoOkEm.getTime()) / HORA_MS : null;
  let notificado = false;
  let erroEnvio: string | null = null;

  const tentar = async (texto: string, id: number, tipo: "abertura" | "resolucao") => {
    try {
      if (await deps.notificar(texto)) {
        await deps.marcarNotificado(id, tipo);
        notificado = true;
      }
    } catch (e) {
      erroEnvio = e instanceof Error ? e.message : String(e); // nunca derruba: fica aberto e tenta de novo na próxima
    }
  };

  if (acao === "abrir") {
    const ultimoErro = await deps.ultimoErro();
    const id = await deps.abrirAlerta({ ultimoOkEm, ultimoErro });
    await tentar(montarMensagem("abertura", { agora, ultimoOkEm, ultimoErro }), id, "abertura");
  } else if (acao === "resolver" && aberto) {
    await deps.resolverAlerta(aberto.id);
    if (aberto.notificadoAbertura) { // só avisa a recuperação de um problema que alguém chegou a ser avisado
      const horasParado = (agora.getTime() - aberto.abertoEm.getTime()) / HORA_MS + p.limiteHoras;
      await tentar(montarMensagem("resolucao", { agora, ultimoOkEm, ultimoErro: null, horasParado }), aberto.id, "resolucao");
    }
  } else if (acao === "nada" && aberto && !aberto.notificadoAbertura) {
    // alerta aberto sem aviso enviado (canal ainda não configurado, ou o envio anterior falhou): tenta de novo
    const ultimoErro = await deps.ultimoErro();
    await tentar(montarMensagem("abertura", { agora, ultimoOkEm, ultimoErro }), aberto.id, "abertura");
  }

  return { acao, notificado, erroEnvio, horasSemSucesso };
}
