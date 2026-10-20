import { RODAPE_EMPRESA, destaqueDoCliente, moeda, rotuloTotalProposta, tituloDoCliente } from "@/lib/documentos/formato";
import { LOGO_APEX, LOGO_CLARO } from "@/lib/documentos/marca";
import type { LinhaTabela, ModeloDocumento } from "@/lib/proposta/modelo-documento";

// Estilos inline de propósito: o cartão vira imagem (html-to-image) e precisa
// sair igual em qualquer tela, sem depender do CSS da página.
const COR = {
  preto: "#0D0D0D",
  vermelho: "#B3101F",
  fundo: "#F3F4F6",
  borda: "#D1D5DB",
  cinza: "#6B7280",
  verde: "#16A34A",
  ambar: "#B45309",
};

const corDoDestaque = { verde: COR.verde, ambar: COR.ambar, preto: COR.preto } as const;

function Kpi({ rotulo, valor, cor }: { rotulo: string; valor: string; cor: string }) {
  return (
    <div style={{ flex: 1, background: COR.fundo, border: `1px solid ${COR.borda}`, borderRadius: 12, padding: "18px 22px" }}>
      <div style={{ fontSize: 15, fontWeight: 700, color: COR.cinza, letterSpacing: 0.5 }}>{rotulo}</div>
      <div style={{ fontSize: 34, fontWeight: 800, color: cor, marginTop: 8 }}>{valor}</div>
    </div>
  );
}

function Tabela({ titulo, itens, total, rotuloTotal }: { titulo: string; itens: LinhaTabela[]; total: number; rotuloTotal: string }) {
  const celula = (direita: boolean) => ({ padding: "10px 14px", textAlign: direita ? ("right" as const) : ("left" as const), fontSize: 19 });
  return (
    <section style={{ marginTop: 30 }}>
      <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: COR.vermelho, letterSpacing: 1 }}>{titulo}</h2>
      <table style={{ width: "100%", borderCollapse: "collapse", marginTop: 10, border: `1px solid ${COR.borda}` }}>
        <thead>
          <tr>
            {["DESCRIÇÃO", "QTD", "VALOR", "SUBTOTAL"].map((nome, i) => (
              <th key={nome} style={{ ...celula(i > 0), background: COR.vermelho, color: "#fff", fontSize: 15 }}>
                {nome}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {itens.map((item, i) => (
            <tr key={`${item.descricao}-${i}`} style={{ background: i % 2 ? COR.fundo : "#fff" }}>
              <td style={celula(false)}>{item.descricao}</td>
              <td style={celula(true)}>{item.quantidade}</td>
              <td style={celula(true)}>{item.valorUnitario === null ? "-" : moeda(item.valorUnitario)}</td>
              <td style={celula(true)}>{moeda(item.subtotal)}</td>
            </tr>
          ))}
          <tr style={{ background: COR.fundo, fontWeight: 800 }}>
            <td colSpan={3} style={celula(false)}>
              {rotuloTotal}
            </td>
            <td style={celula(true)}>{moeda(total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

// Prévia do que o consultor manda no WhatsApp: agrupada por plano (não lista linha
// a linha) para a imagem não ficar tão alta que o WhatsApp corte o centro dela.
export function ComparativoCartao({ modelo }: { modelo: ModeloDocumento }) {
  const destaque = destaqueDoCliente(modelo);
  const corDestaque = corDoDestaque[destaque.cor];

  return (
    <div
      data-comparativo-cartao
      style={{
        width: 1080,
        background: "#fff",
        color: COR.preto,
        fontFamily: "Arial, Helvetica, sans-serif",
        boxSizing: "border-box",
      }}
    >
      <header style={{ background: COR.preto, color: "#fff", display: "flex", alignItems: "center", padding: "26px 40px", gap: 28 }}>
        <div style={{ background: "#fff", borderRadius: 14, width: 104, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_APEX.arquivo} alt="Apex" style={{ maxWidth: 84, maxHeight: 76 }} />
        </div>
        <div style={{ flex: 1, textAlign: "center" }}>
          <div style={{ fontSize: 40, fontWeight: 800 }}>{tituloDoCliente(modelo)}</div>
          <div style={{ fontSize: 18, marginTop: 8 }}>Apex Smart Solutions — Parceiro autorizado Claro Empresas</div>
        </div>
        <div style={{ background: "#fff", borderRadius: 14, width: 104, height: 96, display: "flex", alignItems: "center", justifyContent: "center" }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={LOGO_CLARO.arquivo} alt="Claro empresas" style={{ maxWidth: 84, maxHeight: 76 }} />
        </div>
      </header>

      <div style={{ padding: "30px 40px 26px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 20 }}>
          <div style={{ fontSize: 30, fontWeight: 800, overflowWrap: "anywhere" }}>{modelo.cliente.razaoSocial}</div>
          <div style={{ fontSize: 17, color: COR.cinza, whiteSpace: "nowrap" }}>Emitido em {modelo.emitidoEm}</div>
        </div>
        <div style={{ fontSize: 17, color: COR.cinza, marginTop: 6 }}>
          CNPJ {modelo.cliente.cnpj} · Consultor: {modelo.consultor}
        </div>

        <div style={{ display: "flex", gap: 16, marginTop: 26 }}>
          {modelo.resumo.atual === null ? (
            <Kpi rotulo="MENSALIDADE PROPOSTA" valor={moeda(modelo.resumo.proposto)} cor={COR.preto} />
          ) : (
            <>
              <Kpi rotulo="MENSALIDADE ATUAL" valor={moeda(modelo.resumo.atual)} cor={COR.cinza} />
              <Kpi rotulo="NOVA MENSALIDADE" valor={moeda(modelo.resumo.proposto)} cor={COR.preto} />
              <Kpi rotulo={destaque.titulo} valor={destaque.valor} cor={corDestaque} />
            </>
          )}
        </div>

        {modelo.situacaoAtual && (
          <Tabela titulo="SUA SITUAÇÃO ATUAL" itens={modelo.situacaoAtual.itens} total={modelo.situacaoAtual.total} rotuloTotal="TOTAL ATUAL" />
        )}
        <Tabela
          titulo="NOSSA PROPOSTA"
          itens={modelo.novaProposta.itens}
          total={modelo.novaProposta.total}
          rotuloTotal={rotuloTotalProposta(modelo)}
        />

        {modelo.beneficios.badges.length > 0 && (
          <section style={{ marginTop: 30 }}>
            <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: COR.vermelho, letterSpacing: 1 }}>BENEFÍCIOS INCLUSOS</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginTop: 12 }}>
              {modelo.beneficios.badges.map((badge) => (
                <div
                  key={badge.label}
                  style={{ border: `2px solid #${badge.cor}`, borderRadius: 999, padding: "8px 18px", fontSize: 18, fontWeight: 700 }}
                >
                  {badge.label}
                </div>
              ))}
            </div>
          </section>
        )}

        <div style={{ background: corDestaque, color: "#fff", borderRadius: 16, padding: "24px 32px", marginTop: 32 }}>
          <div style={{ fontSize: 17, fontWeight: 700, letterSpacing: 1 }}>{destaque.titulo}</div>
          <div style={{ fontSize: 52, fontWeight: 800, marginTop: 6 }}>{destaque.valor}</div>
        </div>
      </div>

      <footer style={{ background: COR.preto, color: "#fff", padding: "16px 40px", fontSize: 15 }}>
        <div style={{ fontWeight: 700 }}>{RODAPE_EMPRESA}</div>
        <div style={{ marginTop: 4 }}>
          Emitido em {modelo.emitidoEm} · Válida até {modelo.validoAte}
        </div>
      </footer>
    </div>
  );
}
