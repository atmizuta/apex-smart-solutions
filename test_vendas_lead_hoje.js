// Testa o cartão "Vendas de lead hoje" do Resumo da Digital (13/10/2026, REGRAS_NEGOCIO.md seção 80):
// pedidos CADASTRADOS hoje no NeoCRM cujo CNPJ é de um lead convertido na planilha — a mesma regra do
// "Vendas x origem do lead" (casarVendasComLeads), só a parte "com lead". Só admin/supervisor vê.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange, rpcComLeadsDigital } = require('./test_helper_mock.js');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

function makeQuery(dataFn){
  const q = {
    select(){ return q; }, in(){ return q; }, gte(){ return q; }, lt(){ return q; },
    eq(){ return q; }, order(){ return q; }, range(){ return q; },
    maybeSingle(){ return Promise.resolve(dataFn()); },
    then(resolve, reject){ return Promise.resolve(dataFn()).then(resolve, reject); },
  };
  return q;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: () => makeQuery(() => ({ data: [], error: null })),
  functions: { invoke: async () => ({data:{},error:null}) },
  rpc: rpcComLeadsDigital(async () => ({ data: { total: 0, ganho: 0, perdido: 0, andamento: 0, semPedido: 0, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null }), () => window.__mockLeads),
})) };
window.alert = (msg) => { console.log('ALERT:', msg); };

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }

  const DIA = '2026-10-13';
  const LEADS = [
    { cnpj: '11.111.111/0001-11', criado_em_lead: '2026-10-10T10:00:00-03:00', converteu: true,  receita: 89.99, aba: 'OUTUBRO' },
    { cnpj: '22222222000122',     criado_em_lead: '2026-10-09T10:00:00-03:00', converteu: true,  receita: 74.99, aba: 'OUTUBRO' },
    { cnpj: '33333333000133',     criado_em_lead: '2026-10-11T10:00:00-03:00', converteu: false, receita: 0,     aba: 'OUTUBRO' },
    { cnpj: '44444444000144',     criado_em_lead: '2026-09-20T10:00:00-03:00', converteu: true,  receita: 39.99, aba: 'SETEMBRO' },
  ];
  const PEDIDOS = [
    // cliente 1: 2 itens do MESMO pedido (2 linhas) → 1 pedido
    { numero_pedido: 'A1', cnpj: '11111111000111', cadastro: '2026-10-13T00:00:00-03:00', etapa: 'BIOMETRIA (NEOCRM)' },
    { numero_pedido: 'A1', cnpj: '11111111000111', cadastro: '2026-10-13T00:00:00-03:00', etapa: 'BIOMETRIA (NEOCRM)' },
    // cliente 2: 2 pedidos diferentes no mesmo dia (um já perdido no NEO: a planilha manda, como no Vendas x origem)
    { numero_pedido: 'B1', cnpj: '22.222.222/0001-22', cadastro: '2026-10-13T03:00:00+00:00', etapa: 'NEGOCIACAO (NEOCRM)' },
    { numero_pedido: 'B2', cnpj: '22222222000122', cadastro: '2026-10-13T00:00:00-03:00', etapa: 'VENDA PERDIDA (NEOCRM)' },
    // lead NÃO convertido na planilha → fora
    { numero_pedido: 'C1', cnpj: '33333333000133', cadastro: '2026-10-13T00:00:00-03:00', etapa: 'NEGOCIACAO (NEOCRM)' },
    // lead convertido, mas pedido de OUTRO dia → fora
    { numero_pedido: 'D1', cnpj: '44444444000144', cadastro: '2026-10-12T00:00:00-03:00', etapa: 'NEGOCIACAO (NEOCRM)' },
    // sem lead nenhum, mesmo "ganho" no NeoCRM → fora (não é venda DE LEAD)
    { numero_pedido: 'E1', cnpj: '55555555000155', cadastro: '2026-10-13T00:00:00-03:00', etapa: 'CONCLUIDO (NEOCRM)' },
    // sem CNPJ → fora
    { numero_pedido: 'F1', cnpj: '', cadastro: '2026-10-13T00:00:00-03:00', etapa: 'CONCLUIDO (NEOCRM)' },
  ];

  // --- função pura ---
  const r = vendasLeadDoDia(PEDIDOS, LEADS, DIA);
  assert(r.clientes === 2, 'conta 2 clientes (CNPJ) com pedido hoje e lead convertido; veio ' + r.clientes);
  assert(r.pedidos === 3, 'conta 3 pedidos distintos (A1, B1, B2) — itens do mesmo pedido contam 1; veio ' + r.pedidos);
  const vazio = vendasLeadDoDia(PEDIDOS, LEADS, '2026-10-14');
  assert(vazio.clientes === 0 && vazio.pedidos === 0, 'dia sem pedido dá zero');
  const semDados = vendasLeadDoDia(null, null, DIA);
  assert(semDados.clientes === 0 && semDados.pedidos === 0, 'sem dados (null) não quebra');

  // --- cartão no Resumo: admin vê, consultor não ---
  const hoje = hojeSP();
  const pedidosHoje = PEDIDOS.map(p => Object.assign({}, p, { cadastro: p.cadastro.startsWith('2026-10-12') ? '2000-01-01T00:00:00-03:00' : hoje + 'T00:00:00-03:00' }));
  conversaoLeadsCache = LEADS;
  producaoPedidosCacheDigital = pedidosHoje;
  conversaoPeriodoDe = hoje; conversaoPeriodoAte = hoje;

  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  renderConversaoFiltrado();
  const htmlAdmin = document.getElementById('conversaoResumoCards').innerHTML;
  assert(htmlAdmin.includes('Vendas de lead hoje'), 'admin vê o cartão "Vendas de lead hoje"');
  assert(/Vendas de lead hoje<\\/div>\\s*<div class="kpiValue">2</.test(htmlAdmin), 'cartão mostra 2 (clientes)');
  assert(htmlAdmin.includes('3 pedidos no NeoCRM'), 'cartão diz quantos pedidos no NeoCRM');
  assert(htmlAdmin.includes('Convertidos'), 'os cartões antigos continuam lá');

  currentUser = { id: 'u2', nome: 'Consultor', username: 'consultor', role: 'consultor' };
  producaoPedidosCacheDigital = [];
  renderConversaoFiltrado();
  const htmlConsultor = document.getElementById('conversaoResumoCards').innerHTML;
  assert(!htmlConsultor.includes('Vendas de lead hoje'), 'consultor NÃO vê o cartão (precisa de CNPJ, igual ao Vendas x origem)');

  // --- clicar no cartão abre o detalhe em "Vendas x origem do lead" com a data de hoje ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  document.getElementById('vendaOrigemData').value = '2026-01-01';
  await verVendasLeadHoje();
  assert(document.getElementById('vendaOrigemData').value === hoje, 'clique troca a data do "Vendas x origem do lead" para hoje');

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
