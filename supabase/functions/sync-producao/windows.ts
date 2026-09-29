// Janelas de consulta da API de produção do NeoSales. Horário de São Paulo = UTC-3 fixo.
// Regra da API: de dia (a mensagem de erro diz 05:00–22:00, a doc diz 06:00–22:00) a janela pode ter
// no máximo 90 min; de madrugada (22:01–05:59 segundo a doc) não há limite. Somos conservadores nas duas bordas.
export type Modo = "horario" | "reconciliar" | "backfill" | "manual";
export interface Janela { ini: Date; fim: Date; observacao: string | null }

const MIN = 60_000;
const HORA = 60 * MIN;
export const OVERLAP_MS = 15 * MIN;       // sobreposição entre execuções, cobre atraso de atualização
export const DIA_MAX_MS = 85 * MIN;       // margem sobre os 90 min da API
export const SEM_CURSOR_MS = 60 * MIN;

function sp(d: Date): Date { return new Date(d.getTime() - 3 * HORA); } // campos UTC do resultado = hora de SP
function pad(n: number): string { return String(n).padStart(2, "0"); }

export function formatoNeo(d: Date): string {
  const s = sp(d);
  return `${s.getUTCFullYear()}-${pad(s.getUTCMonth() + 1)}-${pad(s.getUTCDate())} ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`;
}

export function parseFormatoNeo(s: string): Date {
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!m) throw new Error(`Data fora do formato 'YYYY-MM-DD HH:mm:ss': ${s}`);
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] + 3, +m[5], +m[6]));
}

export function formatoPainel(d: Date): string {
  const s = sp(d);
  return `${pad(s.getUTCDate())}/${pad(s.getUTCMonth() + 1)}/${s.getUTCFullYear()}, ${pad(s.getUTCHours())}:${pad(s.getUTCMinutes())}:${pad(s.getUTCSeconds())}`;
}

export function janelaNoturna(d: Date): boolean {
  const s = sp(d);
  const min = s.getUTCHours() * 60 + s.getUTCMinutes();
  return min >= 22 * 60 + 2 || min <= 4 * 60 + 58;
}

export function inicioDoDia(d: Date, diasAtras = 0): Date {
  const s = sp(d);
  return new Date(Date.UTC(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() - diasAtras, 3, 0, 0));
}

export function calcularJanela(p: { modo: Modo; agora: Date; cursor: Date | null; inicio?: Date; fim?: Date }): Janela {
  const fim = p.fim && p.fim < p.agora ? p.fim : p.agora;
  const noite = janelaNoturna(p.agora);

  if (p.modo === "backfill" || p.modo === "reconciliar") {
    if (!noite) throw new Error("Este modo (sem limite de janela) só pode rodar na janela noturna, entre 22:02 e 04:58 (horário de SP).");
    const ini = p.modo === "backfill" ? p.inicio : (p.inicio ?? inicioDoDia(p.agora, 2));
    if (!ini) throw new Error("O modo backfill exige 'inicio'.");
    return { ini, fim, observacao: null };
  }

  const base = p.inicio ??
    (p.cursor ? new Date(p.cursor.getTime() - OVERLAP_MS) : new Date(p.agora.getTime() - SEM_CURSOR_MS));
  if (noite) return { ini: base, fim, observacao: null };

  const minimo = new Date(p.agora.getTime() - DIA_MAX_MS);
  if (base < minimo) {
    return {
      ini: minimo, fim,
      observacao: `Janela reduzida a 85 min (limite diurno da API); a lacuna desde ${base.toISOString()} será coberta pelo reconciliar noturno.`,
    };
  }
  return { ini: base, fim, observacao: null };
}

export function dividirEmBlocos(ini: Date, fim: Date, ms = 3 * 24 * HORA): { ini: Date; fim: Date }[] {
  const out: { ini: Date; fim: Date }[] = [];
  let a = ini.getTime();
  const f = fim.getTime();
  while (a < f) {
    const b = Math.min(a + ms, f);
    out.push({ ini: new Date(a), fim: new Date(b) });
    a = b;
  }
  return out;
}
