import re, base64, sys

TPL_PATH = "_template.html"

with open(TPL_PATH, "r", encoding="utf-8") as f:
    outer = f.read()

m = re.search(r'const PRODUCAO_DASHBOARD_TPL_B64 = "([A-Za-z0-9+/=]+)"', outer)
if not m:
    print("ERRO: PRODUCAO_DASHBOARD_TPL_B64 nao encontrado", file=sys.stderr)
    sys.exit(1)

b64 = m.group(1)
decoded = base64.b64decode(b64).decode("utf-8")

OLD_A = """// Agrupa os pedidos do dia por consultor ou por produto (grupo) — usado tanto pro ranking "Por
// consultor" quanto "Por produto" (mesma logica, campo diferente).
function agruparDiariaPor(rows, campo){
  const byKey = {};
  rows.forEach(r => {
    const key = r[campo] || '(Sem informacao)';
    if(!byKey[key]) byKey[key] = { key, contratos: 0, linhas: 0, valor: 0 };
    byKey[key].contratos++;
    byKey[key].linhas += (r.quantidade || 0);
    byKey[key].valor += (r.valor || 0);
  });
  return Object.values(byKey).sort((a, b) => b.contratos - a.contratos);
}"""

NEW_A = """// pedidoKey(): chave de agrupamento por CONTRATO real (numero_pedido do NeoCRM) — um contrato
// pode ter mais de 1 linha/produto (ex.: portabilidade + aparelho no mesmo pedido, ver REGRAS_
// NEGOCIO.md secao 16.12), entao "contratos" nunca pode ser rows.length/contagem de linha (isso
// conta produto, nao contrato). numero_pedido vazio/nulo vira uma chave unica por linha (indice),
// pra nunca juntar por engano duas linhas sem pedido.
function pedidoKey(r, idx){
  const np = r.numero_pedido;
  if(np === null || np === undefined || String(np).trim() === '') return '__sempedido_' + idx;
  return String(np);
}

// Agrupa os pedidos do dia por consultor ou por produto (grupo) — usado tanto pro ranking "Por
// consultor" quanto "Por produto" (mesma logica, campo diferente). "contratos" conta PEDIDOS
// distintos (numero_pedido) dentro do grupo, nao linhas — ver pedidoKey() acima.
function agruparDiariaPor(rows, campo){
  const byKey = {};
  rows.forEach((r, i) => {
    const key = r[campo] || '(Sem informacao)';
    if(!byKey[key]) byKey[key] = { key, contratosSet: new Set(), linhas: 0, valor: 0 };
    byKey[key].contratosSet.add(pedidoKey(r, i));
    byKey[key].linhas += (r.quantidade || 0);
    byKey[key].valor += (r.valor || 0);
  });
  return Object.values(byKey)
    .map(o => ({ key: o.key, contratos: o.contratosSet.size, linhas: o.linhas, valor: o.valor }))
    .sort((a, b) => b.contratos - a.contratos);
}"""

assert decoded.count(OLD_A) == 1, "OLD_A nao encontrado (ou encontrado mais de 1x): %d" % decoded.count(OLD_A)
decoded = decoded.replace(OLD_A, NEW_A)

OLD_B = """  const totalContratos = rows.length;
  const totalLinhas = rows.reduce((s, r) => s + (r.quantidade || 0), 0);
  const totalValor = rows.reduce((s, r) => s + (r.valor || 0), 0);
  const ticketMedio = totalContratos > 0 ? totalValor / totalContratos : 0;"""

NEW_B = """  const totalContratos = new Set(rows.map((r, i) => pedidoKey(r, i))).size;
  const totalLinhas = rows.reduce((s, r) => s + (r.quantidade || 0), 0);
  const totalValor = rows.reduce((s, r) => s + (r.valor || 0), 0);
  const ticketMedio = totalContratos > 0 ? totalValor / totalContratos : 0;"""

assert decoded.count(OLD_B) == 1, "OLD_B nao encontrado (ou mais de 1x): %d" % decoded.count(OLD_B)
decoded = decoded.replace(OLD_B, NEW_B)

OLD_C = """  const porHora = Array.from({ length: 24 }, () => ({ contratos: 0, linhas: 0, valor: 0 }));
  rows.forEach(r => {
    const p = spParts(r.cadastro);
    if(!p) return;
    const h = porHora[p.hour];
    h.contratos++;
    h.linhas += (r.quantidade || 0);
    h.valor += (r.valor || 0);
  });"""

NEW_C = """  const porHora = Array.from({ length: 24 }, () => ({ contratosSet: new Set(), linhas: 0, valor: 0 }));
  rows.forEach((r, i) => {
    const p = spParts(r.cadastro);
    if(!p) return;
    const h = porHora[p.hour];
    h.contratosSet.add(pedidoKey(r, i));
    h.linhas += (r.quantidade || 0);
    h.valor += (r.valor || 0);
  });
  porHora.forEach(h => { h.contratos = h.contratosSet.size; });"""

assert decoded.count(OLD_C) == 1, "OLD_C nao encontrado (ou mais de 1x): %d" % decoded.count(OLD_C)
decoded = decoded.replace(OLD_C, NEW_C)

new_b64 = base64.b64encode(decoded.encode("utf-8")).decode("ascii")
outer_new = outer.replace(
    'const PRODUCAO_DASHBOARD_TPL_B64 = "' + b64 + '"',
    'const PRODUCAO_DASHBOARD_TPL_B64 = "' + new_b64 + '"',
)
assert outer_new != outer, "substituicao do base64 no _template.html nao teve efeito"

with open(TPL_PATH, "w", encoding="utf-8") as f:
    f.write(outer_new)

print("OK: 3 blocos substituidos, base64 recodificado e gravado em", TPL_PATH)
print("decoded length antes/depois:", len(decoded))
