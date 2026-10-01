import { mapResponse, zerarDescartes } from "./mapper.ts";
import type { Descartes, NeoRow, Registro } from "./mapper.ts";
import { calcularJanela, dividirEmBlocos, formatoNeo } from "./windows.ts";
import type { Janela, Modo } from "./windows.ts";

export interface FechamentoLog {
  ok: boolean;
  linhasApi: number;
  gravadas: number;
  removidas: number;
  descartes: Descartes;
  erro: string | null;
}

export interface Deps {
  agora(): Date;
  buscarNeo(ini: string, fim: string): Promise<NeoRow[]>;
  ultimoCursor(): Promise<Date | null>;
  gravar(itens: { reg: Registro; raw: NeoRow }[]): Promise<void>;
  remover(itemIds: number[]): Promise<void>;
  abrirLog(modo: Modo, ini: Date, fim: Date, observacao: string | null): Promise<number>;
  fecharLog(id: number, r: FechamentoLog): Promise<void>;
  marcarAtualizado(quando: Date): Promise<void>;
}

export interface ParamsSync { modo: Modo; inicio?: Date; fim?: Date }
export interface ResultadoSync extends FechamentoLog { janelaIni: Date; janelaFim: Date; observacao: string | null }

export interface LinhaLog { ok: boolean | null; modo: string; janela_fim: string | null; observacao: string | null }

// O cursor é o fim da última execução BEM-SUCEDIDA, NÃO manual e de janela COMPLETA. Uma execução diurna que
// teve a janela reduzida (observacao != null) deixou uma lacuna para trás: se ela movesse o cursor, a lacuna
// nunca seria buscada. Sem mover, a primeira execução horária da noite (sem limite de janela) a preenche.
export function escolherCursor(logs: LinhaLog[]): Date | null {
  let melhor: number | null = null;
  for (const l of logs) {
    if (l.ok !== true || l.modo === "manual" || l.observacao !== null || !l.janela_fim) continue;
    const t = new Date(l.janela_fim).getTime();
    if (Number.isFinite(t) && (melhor === null || t > melhor)) melhor = t;
  }
  return melhor === null ? null : new Date(melhor);
}

function mensagem(e: unknown): string { return e instanceof Error ? e.message : String(e); }

// Nunca lança: qualquer falha vira um log ok=false (o cursor só avança com logs ok=true).
// O upsert por item_id é idempotente: repetir uma janela é seguro.
export async function executarSync(deps: Deps, p: ParamsSync): Promise<ResultadoSync> {
  const agora = deps.agora();
  const total = zerarDescartes();
  let linhasApi = 0, gravadas = 0, removidas = 0;

  let janela: Janela;
  try {
    janela = calcularJanela({ modo: p.modo, agora, cursor: await deps.ultimoCursor(), inicio: p.inicio, fim: p.fim });
  } catch (e) {
    const id = await deps.abrirLog(p.modo, agora, agora, null);
    const r: FechamentoLog = { ok: false, linhasApi, gravadas, removidas, descartes: total, erro: mensagem(e) };
    await deps.fecharLog(id, r);
    return { ...r, janelaIni: agora, janelaFim: agora, observacao: null };
  }

  const logId = await deps.abrirLog(p.modo, janela.ini, janela.fim, janela.observacao);
  try {
    const blocos = dividirEmBlocos(janela.ini, janela.fim);
    // A NeoSales só aceita 1 consulta a cada ~2 min e esperar entre blocos estouraria o tempo da função:
    // janelas grandes (carga inicial) são divididas em várias chamadas, uma por job do cron.
    if (blocos.length > 1) {
      throw new Error("Janela maior que 35 dias: a NeoSales só aceita uma consulta a cada ~2 min, então cada execução faz uma única consulta. Divida a janela em chamadas separadas.");
    }
    for (const bloco of blocos) {
      const rows = await deps.buscarNeo(formatoNeo(bloco.ini), formatoNeo(bloco.fim));
      linhasApi += rows.length;
      const m = mapResponse(rows);
      for (const k of Object.keys(total) as (keyof Descartes)[]) total[k] += m.descartes[k];
      if (m.registros.length > 0) {
        await deps.gravar(m.registros.map((reg, i) => ({ reg, raw: m.raws[i].raw })));
        gravadas += m.registros.length;
      }
      if (m.arquivadosItemIds.length > 0) {
        await deps.remover(m.arquivadosItemIds);
        removidas += m.arquivadosItemIds.length;
      }
    }
    const r: FechamentoLog = { ok: true, linhasApi, gravadas, removidas, descartes: total, erro: null };
    await deps.fecharLog(logId, r);
    await deps.marcarAtualizado(agora);
    return { ...r, janelaIni: janela.ini, janelaFim: janela.fim, observacao: janela.observacao };
  } catch (e) {
    const r: FechamentoLog = { ok: false, linhasApi, gravadas, removidas, descartes: total, erro: mensagem(e) };
    await deps.fecharLog(logId, r);
    return { ...r, janelaIni: janela.ini, janelaFim: janela.fim, observacao: janela.observacao };
  }
}
