// Testa o seletor de ABA da planilha na aba "Digital" (30/09/2026): Setembro, Agosto e Repique são
// contados separadamente e nunca se misturam. Ver REGRAS_NEGOCIO.md seção 54. Mesma técnica dos outros
// testes (test_conversao_vendas.js): decodifica o <script> real de _template.html, mocka o Supabase e
// roda num jsdom. Dados fictícios.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

const html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__mockLeads = [];
window.__syncResult = { data: { ok: true, total: 0, atualizado_em: '30/09/2026 10:00' }, error: null };
window.__rpcCalls = [];
function builder(table){
  const b = {
    select: () => b, eq: () => b, order: () => b, limit: () => b, in: () => b, gte: () => b, lt: () => b, range: () => b, is: () => b,
    maybeSingle: async () => ({ data: null }),
    then: (resolve) => resolve(table === 'leads' ? { data: window.__mockLeads, error: null } : { data: [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => window.__syncResult },
  rpc: async (nome, args) => { window.__rpcCalls.push({ nome, args }); return { data: { total: 0, ganho: 0, perdido: 0, andamento: 0, semPedido: 0, pedidosGanho: [], pedidosPerdido: [], pedidosAndamento: [] }, error: null }; },
})) };
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(ctx, cfg){ this.config = cfg; this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const L = (aba, consultor, converteu, extra) => Object.assign({ aba, consultor, status: converteu ? 'PEDIDO CONCLUIDO (VENDA)' : 'CLIENTE NÃO RESPONDE',
    categoria: converteu ? 'convertido' : 'perdido', converteu, receita: converteu ? 50 : 0, criado_em_lead: '2026-09-10T12:00:00-03:00' }, extra || {});
  const linhasConsultor = () => [...document.querySelectorAll('#conversaoConsultorTbody tr')].map(tr => [...tr.children].map(td => td.textContent.trim()).slice(0, 3));
  const pillsAba = () => [...document.querySelectorAll('#conversaoAbaPills .filterPill')].map(b => b.textContent.replace(/\\s+/g, ' ').trim());

  window.__mockLeads = [
    // SETEMBRO: Mariana 3 leads (2 convertidos), Gabriel 2 (1 convertido)
    L('SETEMBRO', 'Mariana', true), L('SETEMBRO', 'Mariana', true), L('SETEMBRO', 'Mariana', false),
    L('SETEMBRO', 'Gabriel', true), L('SETEMBRO', 'Gabriel', false),
    // AGOSTO: Caio 2 (1 convertido, R$ 100)
    L('AGOSTO', 'Caio', true, { receita: 100, criado_em_lead: '2026-08-25T12:00:00-03:00' }), L('AGOSTO', 'Caio', false, { criado_em_lead: '2026-08-26T12:00:00-03:00' }),
    // REPIQUE: Yasmin 3 (0 convertidos), Mariana 1 (1 convertido) — leads antigos recontatados
    L('REPIQUE', 'Yasmin', false, { criado_em_lead: '2026-07-20T12:00:00-03:00' }), L('REPIQUE', 'Yasmin', false, { criado_em_lead: '2026-07-21T12:00:00-03:00' }),
    L('REPIQUE', 'Yasmin', false, { criado_em_lead: '2026-09-02T12:00:00-03:00' }), L('REPIQUE', 'Mariana', true, { criado_em_lead: '2026-08-02T12:00:00-03:00' }),
  ];
  currentUser = { id: 'u3', nome: 'Admin Teste', username: 'admin', role: 'admin' };
  await loadConversaoVendas();

  // --- 1) o seletor aparece, na ordem Setembro, Agosto, Repique, e abre em Setembro ---
  assert(document.getElementById('conversaoAbaCard').style.display !== 'none', 'cartão "Aba da planilha" aparece quando os leads têm aba');
  eq(pillsAba(), ['Setembro 5', 'Agosto 2', 'Repique 4'], 'pílulas na ordem Setembro, Agosto, Repique, com a contagem de cada aba');
  assert(document.querySelector('#conversaoAbaPills .filterPill.active').dataset.aba === 'SETEMBRO', 'abre na aba mais recente (Setembro)');

  // --- 2) SETEMBRO: só os leads da aba Setembro (Yasmin e Caio NÃO aparecem) ---
  let kpis = document.getElementById('conversaoResumoCards').innerHTML;
  assert(kpis.includes('kpiValue">5<'), 'Setembro: 5 leads');
  assert(kpis.includes('kpiValue">3<'), 'Setembro: 3 convertidos');
  eq(linhasConsultor(), [['Mariana', '3', '2'], ['Gabriel', '2', '1']], 'Setembro: por consultor só Mariana (3 leads, 2 convertidos) e Gabriel (2, 1)');
  assert(!document.getElementById('conversaoConsultorTbody').textContent.includes('Yasmin'), 'Yasmin NÃO aparece em Setembro (ela só tem leads do Repique)');
  assert(document.getElementById('conversaoPeriodoInfo').textContent.includes('da aba Setembro'), 'o texto de contagem diz de qual aba são os leads');

  // --- 3) REPIQUE: só os leads do Repique ---
  document.querySelector('#conversaoAbaPills [data-aba="REPIQUE"]').click();
  kpis = document.getElementById('conversaoResumoCards').innerHTML;
  assert(kpis.includes('kpiValue">4<'), 'Repique: 4 leads');
  eq(linhasConsultor(), [['Yasmin', '3', '0'], ['Mariana', '1', '1']], 'Repique: Yasmin (3 leads, 0 convertidos) e Mariana (1, 1) — nada de Setembro misturado');
  assert(document.querySelector('#conversaoAbaPills .filterPill.active').dataset.aba === 'REPIQUE', 'a pílula do Repique fica ativa');

  // --- 4) AGOSTO ---
  document.querySelector('#conversaoAbaPills [data-aba="AGOSTO"]').click();
  eq(linhasConsultor(), [['Caio', '2', '1']], 'Agosto: só o Caio');
  assert(document.getElementById('conversaoResumoCards').innerHTML.includes('100,00'), 'Agosto: receita R$ 100,00 só da aba de Agosto');

  // --- 5) o filtro de período vale DENTRO da aba ---
  document.querySelector('#conversaoAbaPills [data-aba="REPIQUE"]').click();
  conversaoPeriodoDe = '2026-09-01'; conversaoPeriodoAte = '2026-09-30'; renderConversaoFiltrado();
  eq(linhasConsultor(), [['Yasmin', '1', '0']], 'Repique em setembro: só o lead do Repique criado em setembro (o período vale dentro da aba)');
  assert(document.getElementById('conversaoPeriodoInfo').textContent.includes('1 de 4 leads da aba Repique no período'), 'texto de período cita a aba: ' + document.getElementById('conversaoPeriodoInfo').textContent);
  conversaoPeriodoDe = null; conversaoPeriodoAte = null;

  // --- 6) a aba escolhida é lembrada ao recarregar os dados; some da lista -> volta pra mais recente ---
  document.querySelector('#conversaoAbaPills [data-aba="AGOSTO"]').click();
  await loadConversaoVendas();
  assert(conversaoAbaAtual === 'AGOSTO', 'recarregar os dados mantém a aba escolhida');
  window.__mockLeads = window.__mockLeads.filter(l => l.aba !== 'AGOSTO');
  await loadConversaoVendas();
  assert(conversaoAbaAtual === 'SETEMBRO', 'se a aba escolhida deixa de existir, volta pra aba mais recente');
  window.__mockLeads = window.__mockLeads.concat([L('AGOSTO', 'Caio', false, { criado_em_lead: '2026-08-25T12:00:00-03:00' })]);

  // --- 7) ordem das abas com um mês novo (Outubro): mais recente primeiro, Repique por último ---
  eq(conversaoAbasDisponiveis([{ aba: 'REPIQUE' }, { aba: 'AGOSTO' }, { aba: 'OUTUBRO' }, { aba: 'SETEMBRO' }]).map(a => a.aba), ['OUTUBRO', 'SETEMBRO', 'AGOSTO', 'REPIQUE'], 'Outubro entra na frente de Setembro; Repique fica por último');
  eq(conversaoAbaRotulo('SETEMBRO'), 'Setembro', 'rótulo amigável da aba');

  // --- 8) consultor (reconciliação pelo banco): a aba escolhida vai junto na consulta ---
  currentUser = { id: 'u1', nome: 'Consultor Teste', username: 'consultor', role: 'consultor' };
  window.__rpcCalls.length = 0;
  conversaoAbaAtual = 'REPIQUE';
  await loadConversaoVendas();
  await espera();
  const chamada = window.__rpcCalls.filter(c => c.nome === 'reconciliacao_neocrm').pop();
  assert(chamada && chamada.args.p_aba === 'REPIQUE', 'a reconciliação do consultor envia a aba escolhida (p_aba) — veio ' + JSON.stringify(chamada && chamada.args));
  document.querySelector('#conversaoAbaPills [data-aba="AGOSTO"]').click();
  await espera();
  assert(window.__rpcCalls.filter(c => c.nome === 'reconciliacao_neocrm').pop().args.p_aba === 'AGOSTO', 'ao trocar de aba a reconciliação é refeita só com aquela aba');
  currentUser = { id: 'u3', nome: 'Admin Teste', username: 'admin', role: 'admin' };

  // --- 9) mensagem de "Atualizar agora" mostra a contagem por aba ---
  window.__syncResult = { data: { ok: true, total: 11, por_aba: { REPIQUE: 4, AGOSTO: 2, SETEMBRO: 5 }, atualizado_em: '30/09/2026 10:00' }, error: null };
  document.getElementById('btnConversaoSync').click();
  await espera(60);
  assert(document.getElementById('conversaoSyncStatus').textContent.includes('Setembro 5 · Agosto 2 · Repique 4'), 'mensagem da sincronização mostra a contagem por aba: ' + document.getElementById('conversaoSyncStatus').textContent);

  // --- 10) banco sem a coluna aba (antes da migração): sem seletor e conta tudo, como antes ---
  window.__mockLeads = [{ consultor: 'Caio', status: 'X', categoria: 'andamento', converteu: false, receita: 0, criado_em_lead: '2026-09-10T12:00:00-03:00' },
                        { consultor: 'Caio', status: 'PEDIDO CONCLUIDO (VENDA)', categoria: 'convertido', converteu: true, receita: 10, criado_em_lead: '2026-09-10T12:00:00-03:00' }];
  conversaoAbaAtual = 'SETEMBRO';
  await loadConversaoVendas();
  assert(document.getElementById('conversaoAbaCard').style.display === 'none', 'sem nenhuma aba nos leads, o seletor fica escondido');
  assert(conversaoAbaAtual === null, 'sem abas, nenhuma aba fica escolhida');
  eq(linhasConsultor(), [['Caio', '2', '1']], 'sem abas, conta todos os leads como antes');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
