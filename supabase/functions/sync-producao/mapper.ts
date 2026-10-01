// Converte a resposta da API de produção do NeoSales (1 linha por item, mais uma linha duplicada
// "GROSS" por item) no formato da tabela producao_pedidos. Regras espelham extractProducaoRecords()
// do painel (_template.html): descarta ARQUIVADO e linhas sem GRUPO; usuário em maiúsculas.
export type NeoRow = Record<string, unknown>;

export interface Registro {
  item_id: number;
  numero_pedido: string | null;
  grupo: string;
  usuario: string;
  etapa: string;
  cadastro: string | null;
  atualizacao: string | null;
  valor: number;
  quantidade: number;
  produto: string | null;
  cliente: string | null;
  cnpj: string | null;
  tag: string | null;
  data_portabilidade: string | null;
  data_instalacao: string | null;
}

export interface Descartes {
  gross: number;
  grossOrfaos: number;
  arquivado: number;
  semGrupo: number;
  semItemId: number;
  duplicados: number;
}

export interface Mapeado {
  registros: Registro[];
  raws: { item_id: number; raw: NeoRow }[];
  arquivadosItemIds: number[];
  descartes: Descartes;
}

const FUSO_SP = "-03:00"; // sem horário de verão desde 2019

export function zerarDescartes(): Descartes {
  return { gross: 0, grossOrfaos: 0, arquivado: 0, semGrupo: 0, semItemId: 0, duplicados: 0 };
}

export function parseDataHoraSP(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  let m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6]}${FUSO_SP}`;
  m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}T00:00:00${FUSO_SP}`;
  return null;
}

export function parseValorBR(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  const s = String(v).trim();
  const normal = s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s;
  const n = parseFloat(normal);
  return Number.isFinite(n) ? n : 0;
}

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === "" ? null : s;
}

function idDoItem(v: unknown): number {
  if (typeof v === "number") return v;
  return parseInt(String(v), 10); // null/undefined viram "null"/"undefined" -> NaN
}

export function mapResponse(rows: NeoRow[]): Mapeado {
  const descartes = zerarDescartes();
  const grossIds = new Set<number>();
  const arquivados = new Set<number>();
  const porItem = new Map<number, { reg: Registro; raw: NeoRow }>();

  for (const r of rows) {
    const itemId = idDoItem(r.itemId);
    const grupo = texto(r.numeroLinha);
    const etapa = texto(r.nomeEtapa) ?? "(Sem etapa)";

    // ARQUIVADO vence tudo (inclusive GROSS e linha sem grupo): um item já gravado que foi arquivado
    // tem de sair da tabela, qualquer que seja a linha que a API mandou.
    if (etapa === "ARQUIVADO (NEOCRM)" && Number.isFinite(itemId)) {
      descartes.arquivado++;
      arquivados.add(itemId);
      continue;
    }

    if (grupo !== null && grupo.toUpperCase() === "GROSS") {
      descartes.gross++;
      if (Number.isFinite(itemId)) grossIds.add(itemId);
      continue;
    }
    if (grupo === null) { descartes.semGrupo++; continue; }
    if (!Number.isFinite(itemId)) { descartes.semItemId++; continue; }

    const qtd = Number(r.quantidade);
    const reg: Registro = {
      item_id: itemId,
      numero_pedido: texto(r.numeroPedido),
      grupo,
      usuario: (texto(r.nomeUsuario) ?? "(Sem usuário)").toUpperCase(),
      etapa,
      cadastro: parseDataHoraSP(r.dataCadastro),
      atualizacao: parseDataHoraSP(r.dataHoraAtualizacao),
      valor: parseValorBR(r.valor),
      quantidade: Number.isFinite(qtd) && qtd > 0 ? qtd : 1,
      produto: texto(r.nomeProduto),
      cliente: texto(r.nomeCliente),
      cnpj: texto(r.cpfCnpj),
      tag: texto(r.tagPedido),
      data_portabilidade: parseDataHoraSP(r.dataPortabilidade),
      data_instalacao: parseDataHoraSP(r.dataInstalacao),
    };

    const anterior = porItem.get(itemId);
    if (anterior) {
      descartes.duplicados++;
      if ((reg.atualizacao ?? "") < (anterior.reg.atualizacao ?? "")) continue;
    }
    porItem.set(itemId, { reg, raw: r });
  }

  for (const id of grossIds) {
    if (!porItem.has(id) && !arquivados.has(id)) descartes.grossOrfaos++;
  }

  const itens = [...porItem.values()];
  return {
    registros: itens.map((i) => i.reg),
    raws: itens.map((i) => ({ item_id: i.reg.item_id, raw: i.raw })),
    arquivadosItemIds: [...arquivados],
    descartes,
  };
}
