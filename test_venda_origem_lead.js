// Testa "Vendas x origem do lead" (regra planilha OR NeoCRM ganho, 10/09/2026) e a reconciliação
// "Conversão confirmada no NeoCRM" — funções puras (agruparLeadsPorCnpj, casarVendasComLeads,
// mapaEtapaMaisRecentePorCnpj, reconciliarConversaoNeoCRM) e os fluxos assíncronos
// buscarVendasOrigemLead / renderReconciliacaoNeoCRM — incluindo a regra de visibilidade
// (só admin/supervisor). Ver REGRAS_NEGOCIO.md, seção 17.9/17.10.
const fs = require('fs');
const { JSDOM } = require('jsdom');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

// --- dados fictícios ---
// Empresa A: dois "leads" com o MESMO CNPJ (só formatação diferente), NENHUM convertido na
// planilha — o mais antigo (03/09) deve ser o "primeiro lead". CNPJ 61729048000120 é o caso real
// reportado pelo usuário: convertido na planilha, mas "VENDA PERDIDA" no NeoCRM — ainda assim
// deve contar como venda (regra: convertido na planilha OU, sem lead, ganho no NeoCRM).
const MOCK_LEADS = [
  { cnpj: '11.222.333/0001-44', criado_em_lead: '2026-09-05T10:00:00-03:00', converteu: false, receita: 0 },
  { cnpj: '11222333000144', criado_em_lead: '2026-09-03T08:00:00-03:00', converteu: false, receita: 0 },
  { cnpj: '99.888.777/0001-11', criado_em_lead: '2026-09-08T12:00:00-03:00', converteu: false, receita: 0 },
  { cnpj: '61.729.048/0001-20', criado_em_lead: '2026-09-08T09:00:00-03:00', converteu: true, receita: 350.5 },
  { cnpj: '', criado_em_lead: '2026-09-01T00:00:00-03:00', converteu: false, receita: 0 },  // sem cnpj — ignorado
  { cnpj: '55.444.333/0001-22', criado_em_lead: null, converteu: false, receita: 0 },         // sem data — ignorado
];

// "atualizacao" (última mudança no NeoCRM) fica bem antes ou em datas soltas, sem relação com a
// venda de verdade — de propósito, simulando o sync em massa real encontrado no banco (múltiplos
// pedidos cravados na mesma ATUALIZACAO, com CADASTROs bem diferentes). O cruzamento deve usar
// CADASTRO (data real do pedido) e IGNORAR atualizacao — 3ª correção, 10/09/2026, ver
// REGRAS_NEGOCIO.md seção 17.9. Se o código voltar a ler `atualizacao` por engano, estes testes
// quebram, porque os valores dos dois campos são propositalmente diferentes.
const MOCK_PEDIDOS = [
  // P1: CNPJ sem NENHUM lead correspondente na planilha, mas "ganho" no NeoCRM — conta como venda
  // pela 2ª parte da regra OR (sem lead E etapa ganho).
  { numero_pedido: 'P1', cliente: 'Empresa Sem Lead', cnpj: '22333444000155', cadastro: '2026-09-09T15:00:00-03:00', atualizacao: '2026-08-15T10:00:00-03:00', etapa: 'CONCLUIDO (NEOCRM)' },
  // P2: sem lead correspondente e NÃO ganho no NeoCRM (etapa "perdido") — não conta como venda.
  { numero_pedido: 'P2', cliente: 'Empresa C', cnpj: '00.000.000/0000-00', cadastro: '2026-09-09T16:00:00-03:00', atualizacao: '2026-08-20T10:00:00-03:00', etapa: 'VENDA PERDIDA (NEOCRM)' },
  // P3: caso real do usuário — convertido na planilha, mas "VENDA PERDIDA" no NeoCRM. Deve contar
  // como venda (planilha manda), com o status divergente visível na coluna "Status no NeoCRM".
  { numero_pedido: 'P3', cliente: 'Empresa Divergente', cnpj: '61729048000120', cadastro: '2026-09-09T09:00:00-03:00', atualizacao: '2026-08-25T10:00:00-03:00', etapa: 'VENDA PERDIDA (NEOCRM)' },
  // P4: sem CNPJ e "perdido" no NeoCRM — não conta (nem lead nem etapa ganho).
  { numero_pedido: 'P4', cliente: 'Empresa Sem CNPJ', cnpj: '', cadastro: '2026-09-09T11:00:00-03:00', atualizacao: '2026-08-10T10:00:00-03:00', etapa: 'VENDA PERDIDA (NEOCRM)' },
];

// Resultado fictício do RPC reconciliacao_neocrm (usado só pelo consultor, ver seção 17.10) —
// espelha o mesmo cenário usado no teste de reconciliarConversaoNeoCRM/montarDrilldownReconciliacao
// abaixo (CNPJ 61729048000120 perdido, CNPJ 99.888.777/0001-11 sem pedido), pra comparar o resultado
// do RPC com o resultado calculado no navegador (admin) e garantir que batem. NUNCA inclui cnpj nem
// cliente — só numero_pedido/etapa/cadastro, que é justamente o ponto de ter um RPC pro consultor.
const MOCK_RPC_RECONCILIACAO = {
  total: 2, ganho: 0, perdido: 1, andamento: 0, semPedido: 1,
  pedidosGanho: [],
  pedidosPerdido: [{ numero_pedido: 'P3', etapa: 'VENDA PERDIDA (NEOCRM)', cadastro: '2026-09-09T09:00:00-03:00' }],
  pedidosAndamento: [],
};

// Query mock encadeável (select/in/gte/lt/eq/order/maybeSingle) que resolve com dados diferentes
// dependendo da tabela — não filtra de verdade por data/etapa (isso já é responsabilidade do
// Supabase real), só devolve os dados fictícios da tabela pedida, pra testar o cruzamento e a
// renderização.
function makeQuery(dataFn){
  const q = {
    select(){ return q; }, in(){ return q; }, gte(){ return q; }, lt(){ return q; },
    eq(){ return q; }, order(){ return q; },
    range(){ return q; }, // usado por fetchAllRows() (paginação, ver _template.html) — mock não pagina de verdade, sempre devolve tudo numa página só
    maybeSingle(){ return Promise.resolve(dataFn()); },
    then(resolve, reject){ return Promise.resolve(dataFn()).then(resolve, reject); },
  };
  return q;
}
window.supabase = { createClient: () => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => {
    if(table === 'producao_pedidos') return makeQuery(() => ({ data: MOCK_PEDIDOS, error: null }));
    if(table === 'leads') return makeQuery(() => ({ data: MOCK_LEADS, error: null }));
    return makeQuery(() => ({ data: [], error: null }));
  },
  functions: { invoke: async () => ({data:{},error:null}) },
  rpc: async (fnName) => {
    if(fnName === 'reconciliacao_neocrm') return { data: MOCK_RPC_RECONCILIACAO, error: null };
    return { data: null, error: null };
  },
}) };
window.alert = (msg) => { console.log('ALERT:', msg); };
window.confirm = () => true;
window.navigator.clipboard = { writeText: async () => {} };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  // --- agruparLeadsPorCnpj (pura) ---
  const mapa = agruparLeadsPorCnpj(${JSON.stringify(MOCK_LEADS)});
  assert(mapa.get('11222333000144').primeiroLead === '2026-09-03T08:00:00-03:00', 'entre dois leads do mesmo CNPJ (formatação diferente), escolhe o mais antigo como "primeiro lead"');
  assert(mapa.get('99888777000111').primeiroLead === '2026-09-08T12:00:00-03:00', 'lead com CNPJ formatado é normalizado (só dígitos) na chave do mapa');
  assert(mapa.get('61729048000120').convertido === true, 'lead convertido na planilha marca convertido=true no agrupamento');
  assert(mapa.get('61729048000120').receita === 350.5, 'agrupamento soma a receita (coluna Z) dos leads convertidos daquele CNPJ');
  assert(!mapa.has(''), 'lead sem CNPJ não entra no mapa');
  assert(mapa.get('55444333000122').primeiroLead === null, 'lead com CNPJ mas sem criado_em_lead entra no mapa (leadEncontrado deve ser true), só sem data de primeiro lead');

  // --- casarVendasComLeads (pura) — regra: convertido na planilha OU (sem lead E ganho no NeoCRM) ---
  const linhas = casarVendasComLeads(${JSON.stringify(MOCK_PEDIDOS)}, ${JSON.stringify(MOCK_LEADS)});
  assert(linhas.length === 2, 'só P1 (sem lead, ganho no NeoCRM) e P3 (convertido na planilha) contam como venda — P2 e P4 ficam de fora: ' + linhas.map(l=>l.numero_pedido).join(','));
  const p1 = linhas.find(l => l.numero_pedido === 'P1');
  assert(!!p1, 'P1 entra: sem lead correspondente, mas etapa "ganho" no NeoCRM');
  assert(p1.leadEncontrado === false, 'P1: não tem lead correspondente (CNPJ não bate)');
  assert(p1.dataVenda === '2026-09-09T15:00:00-03:00', 'P1: data da venda vem de CADASTRO (não de ATUALIZACAO, que aqui vale um valor bem diferente e propositalmente errado)');
  const p3 = linhas.find(l => l.numero_pedido === 'P3');
  assert(!!p3, 'P3 entra: convertido na planilha, mesmo com etapa "VENDA PERDIDA" no NeoCRM (planilha manda)');
  assert(p3.leadEncontrado === true, 'P3: CNPJ bate com o lead convertido');
  assert(p3.statusNeoCRM === 'VENDA PERDIDA (NEOCRM)', 'P3: mostra o status divergente do NeoCRM pra transparência');
  assert(p3.receita === 350.5, 'P3: mostra a receita (coluna Z) do lead convertido, não o produto');
  assert(p3.dataLead === '2026-09-08T09:00:00-03:00', 'P3: usa a data do lead correspondente');
  assert(p3.diasAteVenda === 1, 'P3: calcula dias entre chegada do lead e CADASTRO do pedido (08/09 09h -> 09/09 09h = 1 dia)');

  // --- fluxo assíncrono: buscarVendasOrigemLead (admin) ---
  currentUser = { id: 'u1', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  document.getElementById('vendaOrigemData').value = '2026-09-09';
  await buscarVendasOrigemLead();
  const info = document.getElementById('vendaOrigemInfo').textContent;
  assert(info.includes('2 venda(s) nessa data'), 'info mostra o total de vendas (regra OR aplicada): ' + info);
  assert(info.includes('1 com lead digital correspondente'), 'info mostra quantos têm lead correspondente: ' + info);
  assert(info.includes('1 com status diferente de "ganho" no NeoCRM'), 'info sinaliza quantos têm status divergente do NeoCRM: ' + info);
  const linhasTbody = document.querySelectorAll('#vendaOrigemTbody tr');
  assert(linhasTbody.length === 2, 'tabela mostra uma linha por venda (regra OR)');
  const tbodyHtml = document.getElementById('vendaOrigemTbody').innerHTML;
  assert(tbodyHtml.includes('P3') && tbodyHtml.includes('VENDA PERDIDA'), 'linha do P3 mostra o pedido e o status divergente do NeoCRM');
  assert(tbodyHtml.includes('350,50') || tbodyHtml.includes('350.50'), 'linha do P3 mostra a receita formatada, não o produto');

  // --- visibilidade: consultor não deve conseguir rodar a busca (guard de producaoAdminMode) ---
  document.getElementById('vendaOrigemTbody').innerHTML = '<tr><td>marcador antes</td></tr>';
  currentUser = { id: 'u2', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  await buscarVendasOrigemLead();
  assert(document.getElementById('vendaOrigemTbody').innerHTML.includes('marcador antes'), 'consultor não consegue rodar a busca (guard producaoAdminMode) — tabela não é sobrescrita');

  // --- mapaEtapaMaisRecentePorCnpj (pura) ---
  currentUser = { id: 'u1', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  const mapaEtapa = mapaEtapaMaisRecentePorCnpj(${JSON.stringify(MOCK_PEDIDOS)});
  assert(mapaEtapa.get('61729048000120').etapa === 'VENDA PERDIDA (NEOCRM)', 'mapa de etapa mais recente por CNPJ pega a etapa do pedido com ATUALIZACAO mais recente');
  assert(!mapaEtapa.has(''), 'pedidos sem CNPJ não entram no mapa de etapa mais recente');

  // --- reconciliarConversaoNeoCRM (pura) ---
  const leadsConvertidos = [
    { cnpj: '61729048000120', converteu: true },  // vira "VENDA PERDIDA" no NeoCRM -> perdido
    { cnpj: '99.888.777/0001-11', converteu: true }, // não tem pedido correspondente -> semPedido
  ];
  const rec = reconciliarConversaoNeoCRM(leadsConvertidos, ${JSON.stringify(MOCK_PEDIDOS)});
  assert(rec.total === 2, 'reconciliação conta o total de leads convertidos na planilha recebidos');
  assert(rec.perdido === 1, 'lead convertido na planilha, mas com pedido "VENDA PERDIDA" no NeoCRM, conta como perdido');
  assert(rec.semPedido === 1, 'lead convertido na planilha, sem pedido correspondente no NeoCRM, conta como semPedido');
  assert(rec.ganho === 0, 'nenhum dos dois convertidos-na-planilha bateu com um pedido "ganho" no NeoCRM');

  // --- montarDrilldownReconciliacao (pura) ---
  const drill = montarDrilldownReconciliacao(leadsConvertidos, ${JSON.stringify(MOCK_PEDIDOS)});
  assert(drill.perdido.length === 1 && drill.perdido[0].numero_pedido === 'P3', 'drilldown admin: lista "perdido" tem o pedido P3 (CNPJ 61729048000120)');
  assert(drill.perdido[0].cnpj === '61729048000120', 'drilldown admin: linha carrega o CNPJ (só pra admin/supervisor)');
  assert(drill.semPedido.length === 1, 'drilldown admin: 1 lead convertido sem pedido correspondente (CNPJ 99.888.777/0001-11)');
  assert(drill.semPedido[0].cnpj === '99.888.777/0001-11', 'drilldown admin: linha "sem pedido" carrega o CNPJ vindo da planilha (10/09/2026)');
  assert(drill.ganho.length === 0 && drill.andamento.length === 0, 'drilldown admin: nenhuma linha nas categorias ganho/andamento nesse cenário');

  // Usa esse mesmo cenário (com o caso "sem pedido") direto no cache, só pra testar a linha do
  // drilldown — MOCK_LEADS (usado logo abaixo) só tem UM lead convertido, que bate com pedido (não
  // cobre o caso "sem pedido").
  reconciliacaoDrilldownCache = drill;
  reconciliacaoDrilldownAdmin = true;
  abrirDrilldownReconciliacao('aindaNao');
  const tbodySemPedidoAdmin = document.getElementById('reconciliacaoDrilldownTbody').innerHTML;
  assert(tbodySemPedidoAdmin.includes('sem pedido correspondente'), '"Ainda não confirmados" mostra o texto "sem pedido correspondente" pro lead sem pedido');
  assert(tbodySemPedidoAdmin.includes('99.888.777/0001-11'), 'pro admin/supervisor, a linha "sem pedido" mostra o CNPJ (vem da planilha, que o admin já tem)');

  // Mesmo cenário, mas como CONSULTOR (drilldown vindo do RPC, que nunca devolve CNPJ) — a linha
  // "sem pedido" fica genérica, sem identificar o lead.
  reconciliacaoDrilldownAdmin = false;
  abrirDrilldownReconciliacao('aindaNao');
  const tbodySemPedidoConsultor = document.getElementById('reconciliacaoDrilldownTbody').innerHTML;
  assert(tbodySemPedidoConsultor.includes('— sem pedido correspondente —'), 'pro consultor, a linha "sem pedido" é genérica (sem CNPJ)');
  assert(!tbodySemPedidoConsultor.includes('99.888.777'), 'pro consultor, a linha "sem pedido" NUNCA mostra o CNPJ, mesmo que o objeto local tenha o campo (defesa em profundidade: renderReconciliacaoNeoCRM nem monta esse cnpj pro consultor de verdade, via RPC)');
  reconciliacaoDrilldownAdmin = true;

  // --- renderReconciliacaoNeoCRM (fluxo, admin) — card visível + drilldown com CNPJ/Cliente ---
  // MOCK_LEADS só tem UM lead convertido (CNPJ 61.729.048/0001-20), que bate com o pedido P3
  // ("VENDA PERDIDA" no NeoCRM) — por isso "Concluídos" = 1 e "Voltaram perdidos" = 1 aqui.
  producaoPedidosCacheDigital = ${JSON.stringify(MOCK_PEDIDOS)};
  currentUser = { id: 'u1', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  await renderReconciliacaoNeoCRM(${JSON.stringify(MOCK_LEADS)});
  assert(document.getElementById('reconciliacaoCard').style.display === '', 'card de reconciliação fica visível pra admin');
  const recHtml = document.getElementById('reconciliacaoCards').innerHTML;
  assert(recHtml.includes('Concluídos na planilha') && recHtml.includes('>1<'), 'card mostra 1 concluído na planilha (o único lead convertido do MOCK_LEADS)');
  assert(recHtml.includes('Voltaram perdidos'), 'card mostra a categoria de voltaram perdidos');
  assert(recHtml.includes('data-categoria="perdido"'), 'caixa "Voltaram perdidos" é clicável (tem data-categoria)');

  abrirDrilldownReconciliacao('perdido');
  const theadAdmin = document.getElementById('reconciliacaoDrilldownThead').innerHTML;
  assert(theadAdmin.includes('CNPJ') && theadAdmin.includes('Cliente'), 'cabeçalho do drilldown do admin tem colunas CNPJ e Cliente');
  const tbodyAdmin = document.getElementById('reconciliacaoDrilldownTbody').innerHTML;
  assert(tbodyAdmin.includes('P3') && tbodyAdmin.includes('61.729.048/0001-20'), 'linha do drilldown admin mostra o pedido E o CNPJ');
  assert(document.getElementById('reconciliacaoDrilldownOverlay').classList.contains('active'), 'modal do drilldown abre (classe active)');

  // --- card agora ABERTO pro consultor também (10/09/2026) — números e drilldown vêm do RPC,
  // que nunca devolve CNPJ nem cliente ---
  currentUser = { id: 'u2', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  await renderReconciliacaoNeoCRM(${JSON.stringify(MOCK_LEADS)});
  assert(document.getElementById('reconciliacaoCard').style.display === '', 'card de reconciliação agora fica visível pro consultor também');
  const recHtmlConsultor = document.getElementById('reconciliacaoCards').innerHTML;
  assert(recHtmlConsultor.includes('>1<'), 'card do consultor mostra 1 "voltaram perdidos", igual ao cálculo local do admin (via RPC mockado com o mesmo cenário)');

  abrirDrilldownReconciliacao('perdido');
  const theadConsultor = document.getElementById('reconciliacaoDrilldownThead').innerHTML;
  assert(!theadConsultor.includes('CNPJ') && !theadConsultor.includes('Cliente'), 'cabeçalho do drilldown do consultor NÃO tem CNPJ nem Cliente');
  const tbodyConsultor = document.getElementById('reconciliacaoDrilldownTbody').innerHTML;
  assert(tbodyConsultor.includes('P3'), 'drilldown do consultor mostra o número do pedido');
  assert(!tbodyConsultor.includes('61729048000120') && !tbodyConsultor.includes('61.729.048'), 'drilldown do consultor NUNCA mostra o CNPJ (vem do RPC, que não devolve isso)');

  console.log(\`\\n--- RESULTADO: \${ok} passaram, \${fail} falharam ---\`);
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.error('ERRO NO TESTE:', e);
  window.__testResult = 'FAIL';
}
})();
`;

window.eval(jsCode + testScript);

setTimeout(() => {
  if(window.__testResult !== 'OK') process.exitCode = 1;
}, 50);
