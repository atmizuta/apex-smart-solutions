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

OLD_A = """// pedidoKey(): chave de agrupamento por CONTRATO real (numero_pedido do NeoCRM) — um contrato
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

NEW_A = """// pedidoKey(): chave de agrupamento por CONTRATO real. Por padrao e o numero_pedido do NeoCRM — um
// contrato pode ter mais de 1 linha/produto com o MESMO numero_pedido (ex.: portabilidade + aparelho
// no mesmo pedido, ver REGRAS_NEGOCIO.md secao 16.12), entao "contratos" nunca pode ser rows.length/
// contagem de linha (isso conta produto, nao contrato). numero_pedido vazio/nulo vira uma chave unica
// por linha (indice), pra nunca juntar por engano duas linhas sem pedido.
//
// EXCECAO — convergencia (21/09/2026, ver REGRAS_NEGOCIO.md secao 16.15): numa venda de Claro fibra +
// movel vendidos juntos, o NeoCRM grava a banda larga e a linha movel com numero_pedido DIFERENTE,
// mesmo sendo a MESMA venda pro mesmo cliente no mesmo dia (confirmado com dado real: 21/09/2026 tinha
// 3 CNPJs com exatamente 1 linha BANDA LARGA + 1 linha VOZ, numero_pedido diferente cada, inflando
// "Contratos" pra igualar "Produtos" quando na pratica era 1 venda so). cnpjConvergenciaSet (calculado
// por cnpjsComConvergencia(), 1x por render, sobre o mesmo conjunto de linhas do dia) marca os CNPJs
// que tem banda larga + outro tipo de produto juntos nesse conjunto — so esses usam o CNPJ como chave
// de contrato (fundindo as linhas em 1 contrato so). CNPJ sozinho NUNCA e usado como chave geral (só
// nesse caso especifico de convergencia), porque poderia juntar por engano 2 vendas de voz genuinamente
// distintas do mesmo cliente no mesmo dia (risco ja documentado na secao 16.13).
function pedidoKey(r, idx, cnpjConvergenciaSet){
  const cnpj = r.cnpj ? String(r.cnpj).trim() : '';
  if(cnpj && cnpjConvergenciaSet && cnpjConvergenciaSet.has(cnpj)) return 'CONV_' + cnpj;
  const np = r.numero_pedido;
  if(np === null || np === undefined || String(np).trim() === '') return '__sempedido_' + idx;
  return String(np);
}

// cnpjsComConvergencia(rows): dentro do conjunto de linhas ja filtrado (por dia), acha os CNPJs que
// tem PELO MENOS 1 linha de banda larga E PELO MENOS 1 linha de outro tipo (voz, aparelho etc.) — o
// padrao de uma venda de convergencia. So esses CNPJs entram no Set que pedidoKey() usa pra fundir as
// linhas num contrato so.
function cnpjsComConvergencia(rows){
  const porCnpj = {};
  rows.forEach(r => {
    const cnpj = r.cnpj ? String(r.cnpj).trim() : '';
    if(!cnpj) return;
    if(!porCnpj[cnpj]) porCnpj[cnpj] = { bandaLarga: false, outro: false };
    const grupo = String(r.grupo || '');
    if(grupo.indexOf('BANDA LARGA') === 0) porCnpj[cnpj].bandaLarga = true;
    else porCnpj[cnpj].outro = true;
  });
  const set = new Set();
  Object.keys(porCnpj).forEach(cnpj => { if(porCnpj[cnpj].bandaLarga && porCnpj[cnpj].outro) set.add(cnpj); });
  return set;
}

// Agrupa os pedidos do dia por consultor ou por produto (grupo) — usado tanto pro ranking "Por
// consultor" quanto "Por produto" (mesma logica, campo diferente). "contratos" conta CONTRATOS
// distintos (numero_pedido, com a excecao de convergencia acima) dentro do grupo, nao linhas — ver
// pedidoKey() acima. cnpjConvergenciaSet e opcional (calculado sobre TODAS as linhas do dia, nao so
// as desse grupo, pra manter a mesma nocao de "contrato" em qualquer corte).
function agruparDiariaPor(rows, campo, cnpjConvergenciaSet){
  const byKey = {};
  rows.forEach((r, i) => {
    const key = r[campo] || '(Sem informacao)';
    if(!byKey[key]) byKey[key] = { key, contratosSet: new Set(), linhas: 0, valor: 0 };
    byKey[key].contratosSet.add(pedidoKey(r, i, cnpjConvergenciaSet));
    byKey[key].linhas += (r.quantidade || 0);
    byKey[key].valor += (r.valor || 0);
  });
  return Object.values(byKey)
    .map(o => ({ key: o.key, contratos: o.contratosSet.size, linhas: o.linhas, valor: o.valor }))
    .sort((a, b) => b.contratos - a.contratos);
}"""

assert decoded.count(OLD_A) == 1, "OLD_A nao encontrado (ou encontrado mais de 1x): %d" % decoded.count(OLD_A)
decoded = decoded.replace(OLD_A, NEW_A)

OLD_B = """function renderDiariaLeaderboard(elId, rows, campo){
  const el = document.getElementById(elId);
  if(!el) return;
  const ordered = agruparDiariaPor(rows, campo);"""

NEW_B = """function renderDiariaLeaderboard(elId, rows, campo, cnpjConvergenciaSet){
  const el = document.getElementById(elId);
  if(!el) return;
  const ordered = agruparDiariaPor(rows, campo, cnpjConvergenciaSet);"""

assert decoded.count(OLD_B) == 1, "OLD_B nao encontrado (ou mais de 1x): %d" % decoded.count(OLD_B)
decoded = decoded.replace(OLD_B, NEW_B)

OLD_C = """  const totalContratos = new Set(rows.map((r, i) => pedidoKey(r, i))).size;
  const totalLinhas = rows.reduce((s, r) => s + (r.quantidade || 0), 0);
  const totalValor = rows.reduce((s, r) => s + (r.valor || 0), 0);
  const ticketMedio = totalContratos > 0 ? totalValor / totalContratos : 0;"""

NEW_C = """  const cnpjConvergenciaSet = cnpjsComConvergencia(rows);
  const totalContratos = new Set(rows.map((r, i) => pedidoKey(r, i, cnpjConvergenciaSet))).size;
  const totalLinhas = rows.reduce((s, r) => s + (r.quantidade || 0), 0);
  const totalValor = rows.reduce((s, r) => s + (r.valor || 0), 0);
  const ticketMedio = totalContratos > 0 ? totalValor / totalContratos : 0;"""

assert decoded.count(OLD_C) == 1, "OLD_C nao encontrado (ou mais de 1x): %d" % decoded.count(OLD_C)
decoded = decoded.replace(OLD_C, NEW_C)

OLD_D = """  const porHora = Array.from({ length: 24 }, () => ({ contratosSet: new Set(), linhas: 0, valor: 0 }));
  rows.forEach((r, i) => {
    const p = spParts(r.cadastro);
    if(!p) return;
    const h = porHora[p.hour];
    h.contratosSet.add(pedidoKey(r, i));
    h.linhas += (r.quantidade || 0);
    h.valor += (r.valor || 0);
  });"""

NEW_D = """  const porHora = Array.from({ length: 24 }, () => ({ contratosSet: new Set(), linhas: 0, valor: 0 }));
  rows.forEach((r, i) => {
    const p = spParts(r.cadastro);
    if(!p) return;
    const h = porHora[p.hour];
    h.contratosSet.add(pedidoKey(r, i, cnpjConvergenciaSet));
    h.linhas += (r.quantidade || 0);
    h.valor += (r.valor || 0);
  });"""

assert decoded.count(OLD_D) == 1, "OLD_D nao encontrado (ou mais de 1x): %d" % decoded.count(OLD_D)
decoded = decoded.replace(OLD_D, NEW_D)

# renderDiariaLeaderboard() e chamado com rows (do dia inteiro), campo — precisa passar o mesmo
# cnpjConvergenciaSet calculado em renderVisaoDiaria() pra manter consistencia entre o KPI do topo e
# o ranking "Por consultor"/"Por produto".
OLD_E = """  renderDiariaLeaderboard('diariaConsultores', rows, 'usuario');
  renderDiariaLeaderboard('diariaProdutos', rows, 'grupo');"""

NEW_E = """  renderDiariaLeaderboard('diariaConsultores', rows, 'usuario', cnpjConvergenciaSet);
  renderDiariaLeaderboard('diariaProdutos', rows, 'grupo', cnpjConvergenciaSet);"""

assert decoded.count(OLD_E) == 1, "OLD_E nao encontrado (ou mais de 1x): %d" % decoded.count(OLD_E)
decoded = decoded.replace(OLD_E, NEW_E)

new_b64 = base64.b64encode(decoded.encode("utf-8")).decode("ascii")
outer_new = outer.replace(
    'const PRODUCAO_DASHBOARD_TPL_B64 = "' + b64 + '"',
    'const PRODUCAO_DASHBOARD_TPL_B64 = "' + new_b64 + '"',
)
assert outer_new != outer, "substituicao do base64 no _template.html nao teve efeito"

with open(TPL_PATH, "w", encoding="utf-8") as f:
    f.write(outer_new)

print("OK: 5 blocos substituidos, base64 recodificado e gravado em", TPL_PATH)
print("decoded length antes/depois:", len(decoded))
