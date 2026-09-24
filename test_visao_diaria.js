// Testa a aba "Visao Diaria" do Dashboard de Producao (26/08/2026) — mesma tecnica já usada em
// test_dashboard_producao.js: decodifica o template embutido de verdade (PRODUCAO_DASHBOARD_TPL_B64),
// preenche os placeholders com dados fixos e roda o script real dentro de um jsdom, verificando o
// DOM renderizado — não uma reimplementação separada da lógica.
const fs = require('fs');
const { JSDOM } = require('jsdom');

const outerHtml = fs.readFileSync('_template.html', 'utf8');
const m = outerHtml.match(/PRODUCAO_DASHBOARD_TPL_B64\s*=\s*["']([^"']+)["']/);
if(!m){ console.error('PRODUCAO_DASHBOARD_TPL_B64 nao encontrado'); process.exit(1); }
const tplBytes = Buffer.from(m[1], 'base64');
const tplRaw = tplBytes.toString('utf8');

let ok0 = 0, fail0 = 0;
function assert0(cond, msg){ if(cond){ ok0++; } else { fail0++; console.log('FALHOU (estrutura):', msg); } }

// --- 0) checagens estruturais direto na string do template decodificado ---
assert0(tplRaw.includes('data-tab="diaria"') && tplRaw.includes(">Visao Diaria<"), 'botao da aba "Visao Diaria" existe no template embutido');
assert0(tplRaw.includes('id="tabDiaria"'), 'painel #tabDiaria existe');
assert0(tplRaw.includes('let DATA = __DATA__;'), 'DATA virou "let" (precisa ser mutável pra aceitar atualização horária)');
assert0(!tplRaw.includes('const DATA = __DATA__;'), 'DATA não é mais "const"');
assert0(tplRaw.includes('function spParts('), 'função spParts (data/hora em São Paulo) existe');
assert0(tplRaw.includes('function computeDiariaLinePath('), 'função computeDiariaLinePath (linha do ticket médio) existe');
assert0(tplRaw.includes('function agruparDiariaPor('), 'função agruparDiariaPor (ranking consultor/produto) existe');
assert0(tplRaw.includes('function renderVisaoDiaria('), 'função renderVisaoDiaria existe');
assert0(tplRaw.includes('function toggleTvMode('), 'função toggleTvMode (Modo TV) existe');
assert0(tplRaw.includes("document.documentElement.requestFullscreen()"), 'Modo TV usa a Fullscreen API no documento do iframe (precisa de allowfullscreen no iframe externo)');
assert0(tplRaw.includes('window.atualizarDadosDashboard'), 'atualizarDadosDashboard é exposta em window (chamada pelo painel externo a cada 1h)');
assert0(tplRaw.includes("document.body.classList.toggle('tab-diaria'"), 'switchTab alterna a classe tab-diaria no body (esconde a sidebar de filtros na Visão Diária)');
assert0(tplRaw.includes('body.tv-mode'), 'CSS do Modo TV (body.tv-mode) está presente');
assert0(outerHtml.includes('id="producaoFrame"') && /id="producaoFrame"[^>]*allowfullscreen/.test(outerHtml), 'iframe externo (producaoFrame) tem o atributo allowfullscreen');
assert0(outerHtml.includes('producaoAutoRefreshTimer'), 'painel externo tem o timer de auto-atualização horária');
assert0(outerHtml.includes('atualizarDadosDashboard(novos)'), 'painel externo chama atualizarDadosDashboard() do iframe ao atualizar');
assert0(/,\s*3600000\)/.test(outerHtml), 'auto-atualização roda a cada 3600000ms (1 hora), como pedido pelo usuário');
// --- 0.1) cards "Por tipo de venda" (01/09/2026) ---
assert0(tplRaw.includes('id="diariaTipoVenda"'), 'container #diariaTipoVenda dos cards por tipo de venda existe');
assert0(tplRaw.includes('function renderDiariaTipoVenda('), 'função renderDiariaTipoVenda existe');
assert0(tplRaw.includes('DIARIA_TIPOS_VENDA'), 'lista DIARIA_TIPOS_VENDA (categorias) existe');
assert0(tplRaw.includes("grupo: 'BANDA LARGA - Novo'"), 'categoria Banda Larga mapeada pro grupo "BANDA LARGA - Novo"');
assert0(tplRaw.includes("grupo: 'VOZ - Tranf. Titularidade'"), 'categoria Migração mapeada pro grupo "VOZ - Tranf. Titularidade"');
assert0(tplRaw.includes("grupo: 'VOZ - Novo'"), 'categoria Linha Nova mapeada pro grupo "VOZ - Novo"');
assert0(tplRaw.includes("grupo: 'VOZ - Renovação'"), 'categoria Renovação mapeada pro grupo "VOZ - Renovação"');
assert0(tplRaw.includes("{ label: 'Portabilidade', grupo: 'VOZ - Portabilidade'"), 'categoria Portabilidade (01/09/2026, dividida da Linha Nova) mapeada pro grupo "VOZ - Portabilidade"');
assert0(tplRaw.includes("{ label: 'Aparelho', grupo: 'APARELHO'"), 'categoria Aparelho (15/09/2026) mapeada pro grupo "APARELHO"');
assert0(tplRaw.includes("{ label: 'SVA Fixa', grupo: 'SVA FIXA'"), 'categoria SVA Fixa (15/09/2026) mapeada pro grupo "SVA FIXA"');
// --- 0.2) condensacao + rename do card "Linhas" -> "Produtos" (01/09/2026) ---
assert0(tplRaw.includes('<div class="label">Produtos</div>'), 'card de KPI (abaixo do Modo TV) renomeado de "Linhas" pra "Produtos"');
assert0(!tplRaw.includes('<div class="label">Linhas</div>'), 'o card de KPI não usa mais o rótulo "Linhas"');
assert0(tplRaw.includes('body.tab-diaria .card{'), 'CSS condensado (escopado só pra Visão Diária) está presente');
assert0(tplRaw.includes('body.tab-diaria .leaderboard{'), 'ranking (leaderboard) tem altura máxima com rolagem própria, escopado só pra Visão Diária');
console.log('--- (estrutura) RESULTADO:', ok0, 'passaram,', fail0, 'falharam ---');

// --- monta um fixture de pedidos cobrindo: 2 consultores, 2 grupos, várias horas do MESMO dia
// (2026-08-20), 1 pedido de OUTRO dia (pra provar que o filtro por dia funciona), e um pedido bem
// perto da virada do dia em UTC que só fica no dia certo se a conversão pro fuso de São Paulo
// estiver correta (22h de 19/08 em SP = 01h de 20/08 em UTC — se o código só cortasse os 10
// primeiros caracteres do ISO feito antes do fix de fuso, esse pedido cairia errado no dia 20).
function lead(over){ return Object.assign({
  numero_pedido: 'P', grupo: 'VOZ - Novo', usuario: 'Caio', etapa: 'CONCLUIDO (NEOCRM)',
  cadastro: '2026-08-20T12:00:00-03:00', atualizacao: '2026-08-20T12:00:00-03:00',
  valor: 100, quantidade: 1, produto: 'Plano X', tag: null, cnpj: null,
}, over);
}
const FIXTURE = [
  lead({ numero_pedido: '1', usuario: 'Caio',     grupo: 'VOZ - Novo',          cadastro: '2026-08-20T09:15:00-03:00', valor: 100, quantidade: 1 }),
  lead({ numero_pedido: '2', usuario: 'Caio',     grupo: 'VOZ - Novo',          cadastro: '2026-08-20T09:45:00-03:00', valor: 200, quantidade: 2 }),
  lead({ numero_pedido: '3', usuario: 'Giovanna', grupo: 'VOZ - Portabilidade', cadastro: '2026-08-20T14:30:00-03:00', valor: 300, quantidade: 1 }),
  lead({ numero_pedido: '4', usuario: 'Giovanna', grupo: 'VOZ - Portabilidade', cadastro: '2026-08-20T14:50:00-03:00', valor: 150, quantidade: 1 }),
  lead({ numero_pedido: '5', usuario: 'Caio',     grupo: 'VOZ - Portabilidade', cadastro: '2026-08-20T14:10:00-03:00', valor: 500, quantidade: 3 }),
  // fora do dia selecionado (21/08) — nao deve entrar em nenhuma conta do dia 20
  lead({ numero_pedido: '6', usuario: 'Caio',     grupo: 'VOZ - Novo',          cadastro: '2026-08-21T09:00:00-03:00', valor: 999, quantidade: 9 }),
  // 22h de 19/08 em Sao Paulo = 01h de 20/08 em UTC — testa a conversao de fuso na virada do dia
  lead({ numero_pedido: '7', usuario: 'Vitor',    grupo: 'APARELHO',            cadastro: '2026-08-19T22:00:00-03:00', valor: 50,  quantidade: 1 }),
  // cobrem as outras 3 categorias dos cards "Por tipo de venda" (01/09/2026) — horas 07h/08h/17h,
  // que nao colidem com as horas ja conferidas nos testes de distribuicao por hora (09h/14h)
  lead({ numero_pedido: '8',  usuario: 'Caio',     grupo: 'BANDA LARGA - Novo',            cadastro: '2026-08-20T07:00:00-03:00', valor: 400, quantidade: 1 }),
  lead({ numero_pedido: '9',  usuario: 'Giovanna', grupo: 'VOZ - Tranf. Titularidade',     cadastro: '2026-08-20T08:00:00-03:00', valor: 250, quantidade: 1 }),
  lead({ numero_pedido: '10', usuario: 'Caio',     grupo: 'VOZ - Renovação',               cadastro: '2026-08-20T17:00:00-03:00', valor: 600, quantidade: 2 }),
  // cobrem os 2 novos cards "Por tipo de venda" (15/09/2026: Aparelho e SVA Fixa) — horas 10h/11h,
  // que nao colidem com as horas ja conferidas nos testes de distribuicao por hora (09h/14h)
  lead({ numero_pedido: '11', usuario: 'Caio',     grupo: 'APARELHO',                      cadastro: '2026-08-20T10:00:00-03:00', valor: 350, quantidade: 1 }),
  lead({ numero_pedido: '12', usuario: 'Giovanna', grupo: 'SVA FIXA',                       cadastro: '2026-08-20T11:00:00-03:00', valor: 10,  quantidade: 1 }),
  // 18/09/2026: dia separado (23/08), só pra provar que "Contratos" conta numero_pedido distinto,
  // não linha — o pedido MULTI-1 tem 2 linhas (portabilidade + aparelho, mesma venda, mesmo padrão
  // documentado em REGRAS_NEGOCIO.md seção 16.12), na MESMA hora (10h), e deve contar como 1 só
  // contrato (não 2), tanto no KPI quanto na coluna da hora e no ranking por consultor.
  lead({ numero_pedido: 'MULTI-1', usuario: 'Caio',     grupo: 'VOZ - Portabilidade', cadastro: '2026-08-23T10:00:00-03:00', valor: 300, quantidade: 1, produto: 'Chip' }),
  lead({ numero_pedido: 'MULTI-1', usuario: 'Caio',     grupo: 'APARELHO',            cadastro: '2026-08-23T10:00:00-03:00', valor: 700, quantidade: 1, produto: 'Aparelho X' }),
  lead({ numero_pedido: 'SOLO-1',  usuario: 'Giovanna', grupo: 'VOZ - Novo',          cadastro: '2026-08-23T11:00:00-03:00', valor: 150, quantidade: 1 }),
  // 21/09/2026: dia separado, reproduz o bug real de convergencia (REGRAS_NEGOCIO.md seção 16.15) —
  // CONV-A1/CONV-A2 têm o MESMO cnpj (AAA111), banda larga + voz, mas numero_pedido DIFERENTE (é assim
  // que o NeoCRM grava uma venda de convergencia: fibra e movel em pedidos separados pro mesmo cliente
  // no mesmo dia) — devem contar como 1 contrato só, não 2. CONV-B1/CONV-B2 e CONV-C1/CONV-C2 são casos
  // de controle: mesmo cnpj, mas SEM misturar banda larga com outro tipo (B = 2 linhas de voz, C = 2
  // linhas de banda larga) — não devem fundir, continuam 2 contratos cada, pra provar que a fusão só
  // acontece no padrão exato de convergencia (banda larga + outro tipo), sem reabrir o risco de juntar
  // por engano 2 vendas distintas do mesmo cliente (já documentado e rejeitado na seção 16.13).
  lead({ numero_pedido: 'CONV-A1', usuario: 'Caio', grupo: 'BANDA LARGA - Novo', cadastro: '2026-09-21T10:00:00-03:00', valor: 60, quantidade: 1, cnpj: 'AAA111' }),
  lead({ numero_pedido: 'CONV-A2', usuario: 'Caio', grupo: 'VOZ - Novo',         cadastro: '2026-09-21T10:05:00-03:00', valor: 50, quantidade: 1, cnpj: 'AAA111' }),
  lead({ numero_pedido: 'CONV-B1', usuario: 'Caio', grupo: 'VOZ - Novo',         cadastro: '2026-09-21T10:10:00-03:00', valor: 70, quantidade: 1, cnpj: 'BBB222' }),
  lead({ numero_pedido: 'CONV-B2', usuario: 'Caio', grupo: 'VOZ - Renovação',    cadastro: '2026-09-21T10:15:00-03:00', valor: 80, quantidade: 1, cnpj: 'BBB222' }),
  lead({ numero_pedido: 'CONV-C1', usuario: 'Caio', grupo: 'BANDA LARGA - Novo', cadastro: '2026-09-21T10:20:00-03:00', valor: 90, quantidade: 1, cnpj: 'CCC333' }),
  lead({ numero_pedido: 'CONV-C2', usuario: 'Caio', grupo: 'BANDA LARGA - Novo', cadastro: '2026-09-21T10:25:00-03:00', valor: 95, quantidade: 1, cnpj: 'CCC333' }),
];

const htmlNoScript = tplRaw.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = tplRaw.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script do template embutido nao encontrado'); process.exit(1); }
let jsCode = scriptMatch[1];

let filledHtml = htmlNoScript
  .replace('__DATA__', 'REPLACED_BELOW')
  .replace('__ADMIN_MODE__', 'false')
  .replace('__ADMIN_BADGE__', '')
  .replace('__APEX_B64__', '')
  .replace('__CLARO_B64__', '')
  .replace('__UPDATED_AT__', 'teste');

const dom = new JSDOM(filledHtml, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;

jsCode = jsCode.replace('const DATA = __DATA__;', 'let DATA = ' + JSON.stringify(FIXTURE) + ';');
jsCode = jsCode.replace('let DATA = __DATA__;', 'let DATA = ' + JSON.stringify(FIXTURE) + ';');
jsCode = jsCode.replace('__ADMIN_MODE__', 'false');

const testScript = `
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- 1) o boot automático já preenche #diariaDate com "hoje" (o teste força pra 20/08 abaixo) ---
  assert(document.getElementById('diariaDate') !== null, 'input de data da Visao Diaria existe no DOM');

  document.getElementById('diariaDate').value = '2026-08-20';
  renderVisaoDiaria();

  // --- 2) KPIs do dia (10 pedidos no dia 20 — 5 originais + 3 das categorias de venda + 2 novas
  // (Aparelho e SVA Fixa, 15/09/2026) —, o do dia 21 e o de 19/08(SP) ficam de fora) ---
  const kpiHtml = document.getElementById('diariaKpis').innerHTML;
  assert(kpiHtml.includes('>10<'), 'KPI de contratos mostra 10 (só os pedidos do dia 20 em SP) — ' + kpiHtml);
  // linhas: (1+2+1+1+3) + (1+1+2) + (1+1) = 8 + 4 + 2 = 14
  assert(kpiHtml.includes('>14<'), 'KPI de linhas soma 14 (8 originais + 1+1+2 das categorias + 1+1 de Aparelho/SVA Fixa)');
  // valor total: 1250 + (400+250+600) + (350+10) = 2860
  assert(kpiHtml.includes('2.860,00'), 'KPI de valor total soma R$ 2.860,00 (' + kpiHtml + ')');
  // ticket medio: 2860/10 = 286,00
  assert(kpiHtml.includes('286,00'), 'KPI de ticket médio mostra R$ 286,00 (2860/10)');
  // rotulo do 2o card (abaixo do Modo TV) renomeado de "Linhas" pra "Produtos" (01/09/2026)
  assert(kpiHtml.includes('>Produtos<'), 'card renderizado mostra o rótulo "Produtos" — ' + kpiHtml);
  assert(!kpiHtml.includes('>Linhas<'), 'card renderizado NÃO mostra mais o rótulo "Linhas"');

  // --- 3) o pedido de outro dia (21/08) e o pedido que cai em 19/08 no fuso de SP NÃO aparecem ---
  const hourlyHtmlAntes = document.getElementById('diariaHourly').innerHTML;
  assert(!hourlyHtmlAntes.includes('data-contratos="9"'), 'nenhuma hora acumula os 9 do pedido de outro dia');

  // --- 4) distribuição por hora está correta: 09h tem 2 contratos, 14h tem 3 ---
  const hourEls = Array.from(document.querySelectorAll('.diaria-hour-col'));
  const hora09 = hourEls.find(el => el.dataset.hora === '9');
  const hora14 = hourEls.find(el => el.dataset.hora === '14');
  assert(hora09 && hora09.dataset.contratos === '2', 'hora 09h tem 2 contratos (pedidos 1 e 2) — obtido ' + (hora09 && hora09.dataset.contratos));
  assert(hora14 && hora14.dataset.contratos === '3', 'hora 14h tem 3 contratos (pedidos 3, 4 e 5) — obtido ' + (hora14 && hora14.dataset.contratos));
  // linhas da hora 14h: pedido 3 (1) + pedido 4 (1) + pedido 5 (3) = 5
  assert(hora14 && hora14.dataset.linhas === '5', 'hora 14h soma 5 linhas (1+1+3) — obtido ' + (hora14 && hora14.dataset.linhas));
  // ticket medio da hora 09h: (100+200)/2 = 150
  assert(hora09 && Math.abs(parseFloat(hora09.dataset.ticket) - 150) < 0.001, 'ticket médio da hora 09h é 150 ((100+200)/2) — obtido ' + (hora09 && hora09.dataset.ticket));

  // horas sem nenhum pedido no dia continuam existindo (24 colunas), só com contratos=0
  assert(hourEls.length === 24, 'sempre renderiza as 24 colunas de hora, mesmo as vazias (obtido ' + hourEls.length + ')');
  const hora03 = hourEls.find(el => el.dataset.hora === '3');
  assert(hora03 && hora03.dataset.contratos === '0', 'hora sem nenhum pedido (03h) mostra 0 contratos');

  // --- 5) clicar numa hora abre o analítico só com os pedidos daquela hora ---
  let drilldownChamado = null;
  window.openDrilldown = function(recs, titulo){ drilldownChamado = { recs, titulo }; };
  hora14.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(drilldownChamado && drilldownChamado.recs.length === 3, 'clicar na hora 14h abre o analítico só com os 3 pedidos daquela hora');
  assert(drilldownChamado && drilldownChamado.titulo.includes('14h'), 'título do analítico menciona a hora clicada (' + (drilldownChamado && drilldownChamado.titulo) + ')');

  // --- 6) ranking por consultor: Caio tem 6 contratos (1,2,5,8,10,11) no dia 20, Giovanna tem 4 (3,4,9,12) ---
  const consultorHtml = document.getElementById('diariaConsultores').innerHTML;
  const idxCaio = consultorHtml.indexOf('Caio');
  const idxGiovanna = consultorHtml.indexOf('Giovanna');
  assert(idxCaio > -1 && idxGiovanna > -1, 'ranking por consultor lista Caio e Giovanna');
  assert(idxCaio < idxGiovanna, 'Caio (6 contratos) aparece antes de Giovanna (4 contratos) — ordenado por volume');
  assert(consultorHtml.includes('6 contratos'), 'Caio mostra 6 contratos no dia');
  assert(consultorHtml.includes('is-gold'), 'o 1º colocado do ranking usa o selo de destaque (is-gold)');
  assert(!consultorHtml.includes('Vitor'), 'Vitor (pedido de 19/08 em SP) NÃO aparece no ranking do dia 20');

  // --- 7) ranking por produto (grupo): Portabilidade tem 3 contratos, Novo tem 2 ---
  const produtoHtml = document.getElementById('diariaProdutos').innerHTML;
  assert(produtoHtml.includes('VOZ - Portabilidade') && produtoHtml.includes('VOZ - Novo'), 'ranking por produto lista os grupos do dia');
  assert(produtoHtml.indexOf('VOZ - Portabilidade') < produtoHtml.indexOf('VOZ - Novo'), 'Portabilidade (3 contratos) aparece antes de Novo (2 contratos)');

  // --- 7.1) cards "Por tipo de venda" (01/09/2026, +Portabilidade em 01/09/2026 tarde,
  // +Aparelho/SVA Fixa em 15/09/2026 — pedido do usuário, pra soma dos cards bater com o total):
  // Banda Larga=1, Migração=1, Portabilidade=3, Linha Nova=2, Renovação=1, Aparelho=1, SVA Fixa=1 ---
  const tipoVendaEl = document.getElementById('diariaTipoVenda');
  const tipoVendaHtml = tipoVendaEl.innerHTML;
  const tipoCards = Array.from(tipoVendaEl.querySelectorAll('.card[data-grupo]'));
  assert(tipoCards.length === 7, 'renderiza exatamente os 7 cards de categoria (obtido ' + tipoCards.length + ')');
  assert(tipoVendaHtml.includes('Banda Larga') && tipoVendaHtml.includes('Migracao') && tipoVendaHtml.includes('Portabilidade') && tipoVendaHtml.includes('Linha Nova') && tipoVendaHtml.includes('Renovacao') && tipoVendaHtml.includes('Aparelho') && tipoVendaHtml.includes('SVA Fixa'), 'os 7 rótulos aparecem: Banda Larga, Migração, Portabilidade, Linha Nova, Renovação, Aparelho, SVA Fixa — ' + tipoVendaHtml);
  const cardBanda = tipoCards.find(c => c.dataset.grupo === 'BANDA LARGA - Novo');
  const cardMigracao = tipoCards.find(c => c.dataset.grupo === 'VOZ - Tranf. Titularidade');
  const cardPortabilidade = tipoCards.find(c => c.dataset.grupo === 'VOZ - Portabilidade');
  const cardLinhaNova = tipoCards.find(c => c.dataset.grupo === 'VOZ - Novo');
  const cardRenovacao = tipoCards.find(c => c.dataset.grupo === 'VOZ - Renovação');
  const cardAparelho = tipoCards.find(c => c.dataset.grupo === 'APARELHO');
  const cardSvaFixa = tipoCards.find(c => c.dataset.grupo === 'SVA FIXA');
  assert(cardBanda && cardBanda.querySelector('.value').textContent === '1', 'card Banda Larga mostra 1 (pedido 8) — obtido ' + (cardBanda && cardBanda.querySelector('.value').textContent));
  assert(cardMigracao && cardMigracao.querySelector('.value').textContent === '1', 'card Migração mostra 1 (pedido 9) — obtido ' + (cardMigracao && cardMigracao.querySelector('.value').textContent));
  assert(cardPortabilidade && cardPortabilidade.querySelector('.value').textContent === '3', 'card Portabilidade mostra 3 (pedidos 3, 4 e 5) — obtido ' + (cardPortabilidade && cardPortabilidade.querySelector('.value').textContent));
  assert(cardLinhaNova && cardLinhaNova.querySelector('.value').textContent === '2', 'card Linha Nova mostra 2 (pedidos 1 e 2) — obtido ' + (cardLinhaNova && cardLinhaNova.querySelector('.value').textContent));
  assert(cardRenovacao && cardRenovacao.querySelector('.value').textContent === '1', 'card Renovação mostra 1 (pedido 10) — obtido ' + (cardRenovacao && cardRenovacao.querySelector('.value').textContent));
  assert(cardAparelho && cardAparelho.querySelector('.value').textContent === '1', 'card Aparelho mostra 1 (pedido 11) — obtido ' + (cardAparelho && cardAparelho.querySelector('.value').textContent));
  assert(cardSvaFixa && cardSvaFixa.querySelector('.value').textContent === '1', 'card SVA Fixa mostra 1 (pedido 12) — obtido ' + (cardSvaFixa && cardSvaFixa.querySelector('.value').textContent));
  // soma dos 7 cards bate com o total de contratos do dia (10) — era exatamente essa a reclamação
  const somaCards = tipoCards.reduce((s, c) => s + parseInt(c.querySelector('.value').textContent, 10), 0);
  assert(somaCards === 10, 'a soma dos 7 cards bate com o KPI de contratos do dia (10) — obtido ' + somaCards);
  // ordem: banda larga, migração, portabilidade, linha nova, renovação, aparelho, sva fixa
  const ordemGrupos = tipoCards.map(c => c.dataset.grupo);
  assert(JSON.stringify(ordemGrupos) === JSON.stringify(['BANDA LARGA - Novo', 'VOZ - Tranf. Titularidade', 'VOZ - Portabilidade', 'VOZ - Novo', 'VOZ - Renovação', 'APARELHO', 'SVA FIXA']), 'ordem dos cards é banda larga, migração, portabilidade, linha nova, renovação, aparelho, sva fixa — obtido ' + ordemGrupos.join(', '));

  // --- 7.2) clicar num card de categoria abre o analítico só com os pedidos daquela categoria ---
  let drilldownTipo = null;
  window.openDrilldown = function(recs, titulo){ drilldownTipo = { recs, titulo }; };
  cardLinhaNova.dispatchEvent(new window.Event('click', { bubbles: true }));
  assert(drilldownTipo && drilldownTipo.recs.length === 2, 'clicar no card Linha Nova abre o analítico só com os 2 pedidos dessa categoria — obtido ' + (drilldownTipo && drilldownTipo.recs.length));
  assert(drilldownTipo && drilldownTipo.recs.every(r => r.grupo === 'VOZ - Novo'), 'todos os pedidos do drilldown são da categoria clicada (VOZ - Novo)');
  assert(drilldownTipo && drilldownTipo.titulo.includes('Linha Nova'), 'título do analítico menciona a categoria clicada (' + (drilldownTipo && drilldownTipo.titulo) + ')');

  // --- 7.3) "Contratos" conta numero_pedido DISTINTO, não linha (18/09/2026) — pedido MULTI-1 tem
  // 2 linhas (portabilidade + aparelho) e deve contar como 1 contrato só, em todo lugar: KPI,
  // coluna da hora e ranking por consultor. SOLO-1 é um pedido comum (1 linha = 1 contrato), pra
  // provar que o dia mistura os dois casos corretamente (2 contratos no total, 3 produtos) ---
  document.getElementById('diariaDate').value = '2026-08-23';
  renderVisaoDiaria();
  const kpiHtmlMulti = document.getElementById('diariaKpis').innerHTML;
  assert(kpiHtmlMulti.includes('>2<'), 'dia com pedido de 2 linhas: KPI Contratos mostra 2 (MULTI-1 + SOLO-1), não 3 — ' + kpiHtmlMulti);
  assert(kpiHtmlMulti.includes('>3<'), 'dia com pedido de 2 linhas: KPI Produtos mostra 3 (2 linhas do MULTI-1 + 1 do SOLO-1)');
  assert(kpiHtmlMulti.includes('575,00'), 'ticket médio usa Contratos (2), não Produtos: 1.150/2 = R$ 575,00 — ' + kpiHtmlMulti);

  const hourElsMulti = Array.from(document.querySelectorAll('.diaria-hour-col'));
  const hora10Multi = hourElsMulti.find(el => el.dataset.hora === '10');
  assert(hora10Multi && hora10Multi.dataset.contratos === '1', 'coluna das 10h mostra 1 contrato (as 2 linhas do MULTI-1 são o mesmo pedido) — obtido ' + (hora10Multi && hora10Multi.dataset.contratos));
  assert(hora10Multi && hora10Multi.dataset.linhas === '2', 'coluna das 10h soma 2 linhas (produtos) mesmo contando 1 contrato só — obtido ' + (hora10Multi && hora10Multi.dataset.linhas));

  const consultorHtmlMulti = document.getElementById('diariaConsultores').innerHTML;
  assert(consultorHtmlMulti.includes('1 contrato') && !consultorHtmlMulti.includes('2 contratos'), 'ranking por consultor: Caio aparece com 1 contrato (não 2), mesmo tendo vendido 2 produtos no mesmo pedido — ' + consultorHtmlMulti);
  assert(consultorHtmlMulti.includes('2 linha'), 'ranking por consultor: Caio mostra 2 linhas (produtos) no sub-texto');

  // --- 7.4) convergência (fibra + móvel, mesmo CNPJ, numero_pedido diferente) — 21/09/2026, ver
  // REGRAS_NEGOCIO.md seção 16.15. CONV-A1 (banda larga) + CONV-A2 (voz) têm o mesmo cnpj AAA111 mas
  // pedidos diferentes: devem contar como 1 contrato só (era esse o bug: "Contratos" ficava igual a
  // "Produtos"). CONV-B1/B2 (2 vozes, mesmo cnpj BBB222, sem banda larga) e CONV-C1/C2 (2 banda larga,
  // mesmo cnpj CCC333, sem outro tipo) são controle: NÃO devem fundir — continuam 2 contratos cada,
  // provando que a fusão exige banda larga + outro tipo junto, não CNPJ repetido sozinho.
  document.getElementById('diariaDate').value = '2026-09-21';
  renderVisaoDiaria();
  const kpiHtmlConv = document.getElementById('diariaKpis').innerHTML;
  // contratos: 1 (AAA fundido) + 2 (BBB) + 2 (CCC) = 5 — não 6
  assert(kpiHtmlConv.includes('>5<'), 'dia de convergência: KPI Contratos mostra 5 (AAA fundido + BBB + CCC), não 6 — ' + kpiHtmlConv);
  // produtos: 6 linhas (uma por pedido, nenhuma linha é descartada)
  assert(kpiHtmlConv.includes('>6<'), 'dia de convergência: KPI Produtos mostra 6 (as 6 linhas, mesmo com 1 contrato fundido)');

  const hourElsConv = Array.from(document.querySelectorAll('.diaria-hour-col'));
  const hora10Conv = hourElsConv.find(el => el.dataset.hora === '10');
  assert(hora10Conv && hora10Conv.dataset.contratos === '5', 'coluna das 10h mostra 5 contratos (AAA fundido + BBB + CCC) — obtido ' + (hora10Conv && hora10Conv.dataset.contratos));
  assert(hora10Conv && hora10Conv.dataset.linhas === '6', 'coluna das 10h soma 6 linhas — obtido ' + (hora10Conv && hora10Conv.dataset.linhas));

  const consultorHtmlConv = document.getElementById('diariaConsultores').innerHTML;
  assert(consultorHtmlConv.includes('5 contratos') && !consultorHtmlConv.includes('6 contratos'), 'ranking por consultor: Caio aparece com 5 contratos (não 6) — AAA fundido em 1 só — ' + consultorHtmlConv);

  // por produto (grupo): BANDA LARGA - Novo tem as linhas CONV-A1, CONV-C1, CONV-C2 — a chave
  // CONV_AAA111 (fusão por convergência, calculada sobre TODAS as linhas do dia) conta 1x dentro
  // desse corte, e CONV-C1/CONV-C2 não fundem entre si (cnpj CCC333 não tem outro tipo de produto
  // junto) — logo o grupo BANDA LARGA - Novo deve contar 3 contratos, não 2 (o que confirmaria que
  // a fusão "vazou" indevidamente pro CCC333) nem 1 (o que seria fusão de menos).
  const lbRowsProduto = Array.from(document.getElementById('diariaProdutos').querySelectorAll('.lb-row'));
  const lbBanda = lbRowsProduto.find(el => el.querySelector('.lb-name').textContent === 'BANDA LARGA - Novo');
  assert(lbBanda && lbBanda.querySelector('.lb-count').textContent === '3 contratos', 'ranking por produto: BANDA LARGA - Novo mostra 3 contratos (CONV_AAA111 fundido + CONV-C1 + CONV-C2 separados) — obtido ' + (lbBanda && lbBanda.querySelector('.lb-count').textContent));

  console.log('--- (convergência) RESULTADO parcial:', ok, 'passaram,', fail, 'falharam ---');

  // --- 8) dia sem nenhum pedido mostra "Sem dados", sem quebrar, inclusive nos cards por tipo de venda ---
  document.getElementById('diariaDate').value = '2099-01-01';
  renderVisaoDiaria();
  assert(document.getElementById('diariaConsultores').innerHTML.includes('Sem dados'), 'dia sem pedidos mostra "Sem dados" no ranking por consultor, sem erro');
  assert(document.getElementById('diariaKpis').innerHTML.includes('kpiValue') || document.getElementById('diariaKpis').innerHTML.includes('>0<'), 'dia sem pedidos mostra os KPIs zerados, sem travar a tela');
  const tipoVendaVazio = Array.from(document.getElementById('diariaTipoVenda').querySelectorAll('.card[data-grupo] .value'));
  assert(tipoVendaVazio.length === 7 && tipoVendaVazio.every(v => v.textContent === '0'), 'dia sem pedidos mostra os 7 cards de categoria zerados, sem sumir nenhum');

  // --- 9) função pura computeDiariaLinePath: quebra a linha nas horas sem contrato (não força 0) ---
  const porHoraFake = [
    { contratos: 1, linhas: 1, valor: 100 },  // ticket 100
    { contratos: 0, linhas: 0, valor: 0 },    // hora vazia -> quebra a linha
    { contratos: 2, linhas: 2, valor: 400 },  // ticket 200
  ];
  const path = computeDiariaLinePath(porHoraFake);
  assert(path.includes('M'), 'o path da linha de ticket médio começa com um "M" (move-to)');
  assert((path.match(/M/g) || []).length === 2, 'o path tem 2 sub-trajetos "M" (a hora vazia do meio quebra a linha em vez de interpolar) — path: ' + path);
  assert(!path.includes(' L '), 'sem dois pontos consecutivos válidos nesse fixture, não deveria ter nenhum "L" (linha) — path: ' + path);

  console.log('--- (render real) RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(fail0 > 0 || window.__testResult !== 'OK') process.exitCode = 1;
}, 500);
