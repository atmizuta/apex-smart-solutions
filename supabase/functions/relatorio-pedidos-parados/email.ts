// Assunto e corpo do e-mail diário de pedidos parados (spec §4.1). O corpo só leva contagens: os dados dos
// clientes vão no anexo.
import { CRITICIDADES, ETAPAS, ROTULO, etapaCurta, fmtDataHoraSp, fmtDiaBr } from "./regras.ts";
import type { Contagem, Resumo } from "./regras.ts";

export const LIMITE_DADOS_VELHOS_H = 3;
export interface DadosEmail { diaRef: string; resumo: Resumo; sincronizadoEm: Date | null; agora: Date; teste: boolean }

const titulo = (s: string) => s.charAt(0) + s.slice(1).toLowerCase();
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const detalhe = (c: Contagem) => CRITICIDADES.map((k) => `${titulo(ROTULO[k])} ${c[k]}`).join(" · ");

function avisoSincronizacao(d: DadosEmail): string | null {
  if (!d.sincronizadoEm) {
    return "Atenção: não foi possível confirmar a hora da última sincronização com o NeoCRM; a planilha pode não refletir as últimas movimentações.";
  }
  const horas = (d.agora.getTime() - d.sincronizadoEm.getTime()) / 3_600_000;
  if (horas <= LIMITE_DADOS_VELHOS_H) return null;
  return `Atenção: a última sincronização com o NeoCRM foi em ${fmtDataHoraSp(d.sincronizadoEm)} (há mais de ${LIMITE_DADOS_VELHOS_H} horas); a planilha pode não refletir as últimas movimentações.`;
}

export function montarEmail(d: DadosEmail): { assunto: string; html: string; texto: string } {
  const total = d.resumo.total.total;
  const prefixo = d.teste ? "[TESTE] " : "";
  const qtd = total === 0 ? "nenhum pedido parado"
    : `${total} ${total === 1 ? "pedido" : "pedidos"}, ${d.resumo.total.alta} em alta`;
  const assunto = `${prefixo}Pedidos parados — Antifraude e Entrega — ${fmtDiaBr(d.diaRef)} (${qtd})`;

  const aviso = avisoSincronizacao(d);
  const sinc = d.sincronizadoEm ? `Dados do NeoCRM sincronizados em ${fmtDataHoraSp(d.sincronizadoEm)}.` : null;
  const linhasEtapa = ETAPAS.map((e) => {
    const c = d.resumo.porEtapa[e];
    return `${titulo(etapaCurta(e))}: ${c.total} (${detalhe(c)})`;
  });

  const texto = [
    "Bom dia!",
    "",
    total === 0
      ? "Hoje não há pedidos parados em Antifraude nem em Entrega."
      : "Segue em anexo a planilha com todos os pedidos parados em Antifraude e Entrega, com a criticidade de cada um (dias úteis na etapa): Baixa 0–3 · Média 4–6 · Alta 7+.",
    "",
    ...(total === 0 ? [] : [...linhasEtapa, `Total: ${total}`, ""]),
    ...(sinc ? [sinc] : []),
    ...(aviso ? [aviso] : []),
    ...(total === 0 ? [] : ["", "Na coluna Retorno da planilha, por favor registre o status de cada pedido para repassarmos ao back office."]),
    "",
    "Apex Smart Solutions",
  ].join("\n");

  const celula = "padding:6px 10px;border:1px solid #ddd;text-align:center";
  const tabela = total === 0 ? "" : `
<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;margin:12px 0">
  <tr style="background:#1D1F20;color:#fff"><th style="${celula}">Etapa</th>${CRITICIDADES.map((k) => `<th style="${celula}">${titulo(ROTULO[k])}</th>`).join("")}<th style="${celula}">Total</th></tr>
  ${ETAPAS.map((e) => {
    const c = d.resumo.porEtapa[e];
    return `<tr><td style="${celula};text-align:left">${esc(titulo(etapaCurta(e)))}</td>${CRITICIDADES.map((k) => `<td style="${celula}">${c[k]}</td>`).join("")}<td style="${celula}"><b>${c.total}</b></td></tr>`;
  }).join("\n  ")}
  <tr><td style="${celula};text-align:left"><b>Total</b></td>${CRITICIDADES.map((k) => `<td style="${celula}"><b>${d.resumo.total[k]}</b></td>`).join("")}<td style="${celula}"><b>${total}</b></td></tr>
</table>`;

  const p = (s: string, estilo = "") => `<p style="font-family:Arial,sans-serif;font-size:14px;${estilo}">${esc(s)}</p>`;
  const html = [
    p("Bom dia!"),
    p(total === 0
      ? "Hoje não há pedidos parados em Antifraude nem em Entrega."
      : "Segue em anexo a planilha com todos os pedidos parados em Antifraude e Entrega, com a criticidade de cada um (dias úteis na etapa): Baixa 0–3 · Média 4–6 · Alta 7+."),
    tabela,
    sinc ? p(sinc, "color:#666") : "",
    aviso ? p(aviso, "color:#C1050F;font-weight:bold") : "",
    total === 0 ? "" : p("Na coluna Retorno da planilha, por favor registre o status de cada pedido para repassarmos ao back office."),
    p("Apex Smart Solutions", "font-weight:bold"),
  ].filter(Boolean).join("\n");

  return { assunto, html, texto };
}
