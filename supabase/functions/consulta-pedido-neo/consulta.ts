// Funções puras da consulta-pedido-neo (§170). Sem rede, testadas em consulta.test.ts.
import { limparHtml } from "../sync-pedidos-neo/pedidos.ts";

type Obj = Record<string, unknown>;
const o = (v: unknown): Obj => (v && typeof v === "object" ? v as Obj : {});
const txt = (v: unknown): string | null => (v === null || v === undefined || v === "" ? null : String(v));
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

// Recorte do JSON da Xeotech: só o que a gaveta mostra. Dados do cedente (nome, CPF/CNPJ, telefone, e-mail)
// e o endereço completo do cliente/instalação NUNCA passam daqui.
export function recortar(p: unknown): { etapa_neo: string | null; resumo: Obj; itens: Obj[] } {
  const j = o(p), dono = o(j.usuarioProprietario);
  return {
    etapa_neo: txt(o(j.etapa).nome),
    resumo: {
      tipo_negociacao: txt(j.tipoNegociacao), total: num(j.total), compromisso_mensal: num(j.compromissoMensal),
      tags: txt(j.tags), observacao: limparHtml(j.observacao).slice(0, 1000) || null,
      dono: txt(dono.nome), equipe: txt(o(dono.equipe).nome), ultima_mov: txt(j.dataHoraUltimaMov),
    },
    itens: (Array.isArray(j.itens) ? j.itens : []).map((i0) => {
      const i = o(i0), pr = o(i.produto);
      return {
        linha: txt(i.numero), quantidade: num(i.quantidade), valor: num(i.valorUnitario),
        produto: txt(pr.nome), categoria: txt(pr.categoria), plano: txt(pr.descricao),
        portabilidade: txt(i.dataPortabilidade), instalacao: txt(i.dataInstalacao),
        operadora_cedente: txt(i.operadoraCedente), cidade: txt(i.cidadeInstalacao), uf: txt(i.estadoInstalacao),
      };
    }),
  };
}

// Mensagem para quem clicou (o erro técnico vai só para o log).
export function mensagemUsuario(status: number, retryAfter: string | null): string {
  if (status === 401 || status === 403) return "O token do NEO não tem acesso a este pedido. Avise o admin.";
  if (status === 404) return "Pedido não encontrado no NEO.";
  if (status === 429) return `Limite da Xeotech atingido. Tente em ${Math.max(1, Math.ceil((Number(retryAfter) || 120) / 60))} min.`;
  return "O NEO não respondeu. Tente mais tarde.";
}

// Recusa do banco (consulta_pedido_preparar) em texto.
export function mensagemRecusa(r: { motivo?: string; espera_s?: number }): string {
  if (r.motivo === "permissao") return "Só admin e supervisor consultam o NEO, e só pedidos que podem ver.";
  if (r.motivo === "sem_pedido_id") return "Este pedido ainda não tem o id do NEO (sem movimentação desde 01/09).";
  return `A Xeotech está ocupada com a sincronização. Tente em ${Math.max(1, Math.ceil((r.espera_s ?? 60) / 60))} min.`;
}
