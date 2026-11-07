// Testa a §142 (Meus leads → Lista → "Conferir com NEO": leads em que o painel e o NEO não batem, via leads_conferir_neo).
// DADOS FICTÍCIOS (repo público).
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
window.__rpcCalls = [];
window.__rpcRespostas = {};
window.__tabelas = {};
window.__sessao = null;
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    single: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: window.__sessao } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = () => {};
window.confirm = () => true;
window.Chart = function(){ this.destroy = function(){}; return this; };
window.TextDecoder = TextDecoder;
window.process = process;

const testScript = `
(async () => {
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  function eq(a, b, msg){ assert(JSON.stringify(a) === JSON.stringify(b), msg + ' — esperado ' + JSON.stringify(b) + ', veio ' + JSON.stringify(a)); }
  const espera = (ms) => new Promise(r => setTimeout(r, ms || 20));
  const neo = (o) => Object.assign({ aba: 'OUTUBRO', lead_id: 'n0', nome: 'Zz Empresa', dono_id: 'u-ana', dono_nome: 'Zz Ana', status: 'PEDIDO CONCLUIDO (VENDA)',
    converteu: true, receita: 100, criado_em_lead: '2026-10-05T13:00:00+00:00', tipo: 'venda_neo_perdido', sem_cnpj: false,
    neo_pedido: '9001', neo_etapa: 'VENDA PERDIDA (NEOCRM)', neo_atualizacao: '2026-11-03T15:00:00+00:00', neo_valor: 50, neo_pedidos: 1,
    ok_motivo: null, ok_por_nome: null, ok_em: null }, o);
  const NEO = [
    neo({ lead_id: 'n1', nome: 'Zz Caiu' }),
    neo({ lead_id: 'n2', nome: 'Zz Sem Pedido', tipo: 'venda_sem_neo', neo_pedido: null, neo_etapa: null, neo_atualizacao: null, neo_pedidos: 0 }),
    neo({ lead_id: 'n3', nome: 'Zz Sem Cnpj', tipo: 'venda_sem_neo', sem_cnpj: true, neo_pedido: null, neo_etapa: null, neo_atualizacao: null, neo_pedidos: 0 }),
    neo({ lead_id: 'n4', nome: 'Zz Vendeu', tipo: 'perdido_neo_ganho', status: 'CLIENTE NÃO RESPONDE', converteu: false, neo_etapa: 'CONCLUIDO (NEOCRM)', neo_pedidos: 3,
          dono_id: 'u-bia', dono_nome: 'Zz Bia' }),
    neo({ lead_id: 'n5', nome: 'Zz Sem Dono', tipo: 'aberto_neo_perdido', dono_id: null, dono_nome: null, converteu: false, status: 'EM NEGOCIAÇÂO' }),
    neo({ lead_id: 'n6', nome: 'Zz Certo', ok_motivo: 'refeito com outro CNPJ', ok_por_nome: 'Zz Ana', ok_em: '2026-11-06T18:00:00+00:00' }),
  ];

  // ==== funções puras ====
  eq(Object.keys(KB_NEO_TIPOS).sort(), ['aberto_neo_ganho', 'aberto_neo_perdido', 'perdido_neo_andamento', 'perdido_neo_ganho', 'venda_neo_perdido', 'venda_sem_neo', 'venda_status'], '7 tipos');
  Object.values(KB_NEO_TIPOS).forEach(t => assert(t.titulo && t.fazer, 'cada tipo tem título e o que fazer'));
  eq(kbNeoDetalhe(NEO[0]), 'Pedido 9001: VENDA PERDIDA em 03/11', 'detalhe com pedido, etapa sem (NEOCRM) e data');
  eq(kbNeoDetalhe(NEO[1]), 'Nenhum pedido no NEO com este CNPJ.', 'detalhe sem pedido');
  eq(kbNeoDetalhe(NEO[2]), 'Lead sem CNPJ: não dá para achar o pedido no NEO.', 'detalhe sem CNPJ');
  assert(/3 pedidos neste CNPJ/.test(kbNeoDetalhe(NEO[3])), 'avisa quando o CNPJ tem mais de um pedido');
  eq(kbNeoDetalhe(neo({ tipo: 'venda_status', status: 'EM NEGOCIAÇÂO' })), 'Status no painel: EM NEGOCIAÇÂO', 'detalhe da venda com status errado');
  eq(kbNeoVisiveis(NEO, {}).map(x => x.lead_id), ['n1', 'n2', 'n3', 'n4', 'n5'], 'marcados como certo ficam fora');
  eq(kbNeoVisiveis(NEO, { verOk: true }).map(x => x.lead_id), ['n6'], 'Marcados como certo mostra só eles');
  eq(kbNeoVisiveis(NEO, { dono: 'u-bia' }).map(x => x.lead_id), ['n4'], 'filtro por consultor');
  eq(kbNeoVisiveis(NEO, { dono: '' }).map(x => x.lead_id), ['n5'], 'filtro Sem consultor');
  eq(kbNeoVisiveis(NEO, { busca: 'vendeu' }).map(x => x.lead_id), ['n4'], 'busca pelo nome');
  eq(kbNeoResumo(kbNeoVisiveis(NEO, {})).map(r => [r.nome, r.n]), [['Zz Ana', 3], ['Sem consultor', 1], ['Zz Bia', 1]], 'resumo por consultor (maior primeiro)');

  // ==== consultor: visão na Lista, carrega só ao clicar ====
  currentUser = { id: 'u-ana', nome: 'Zz Ana', role: 'consultor', operacao: 'apex' };
  window.__rpcRespostas.leads_kanban3 = { data: [], error: null };
  window.__rpcRespostas.leads_conferir_neo = { data: NEO.filter(x => x.dono_id === 'u-ana'), error: null };
  kbEstado.filtros = {}; kbEstado.neo = null;
  Object.assign(kbEstadoTabela(), { visao: 'todos', busca: '', pagina: 1 });
  window.__rpcCalls.length = 0;
  await kbCarregarTodos();
  eq(window.__rpcCalls.map(c => c.nome), ['leads_kanban3'], 'abrir a Lista não chama a conferência');
  const bt = document.querySelector('#kbVisoes [data-kb-visao="neo"]');
  assert(!!bt && /Conferir com NEO/.test(bt.textContent), 'visão Conferir com NEO aparece');
  bt.click();
  await espera(40);
  eq(window.__rpcCalls.map(c => c.nome), ['leads_kanban3', 'leads_conferir_neo'], 'clicar carrega leads_conferir_neo');
  eq(window.__rpcCalls[1].args, { p_dono: null }, 'consultor não manda dono');
  const linhas = [...document.querySelectorAll('#kbTodosTabela tbody tr[data-kb-abrir]')];
  eq(linhas.map(t => t.dataset.kbAbrir), ['OUTUBRO|n1', 'OUTUBRO|n2', 'OUTUBRO|n3'], 'consultor vê as divergências dele, sem as marcadas como certo');
  assert(/3/.test(document.querySelector('#kbVisoes [data-kb-visao="neo"]').textContent), 'contador da visão');
  assert(/Venda no painel, perdida no NEO/.test(linhas[0].textContent) && /Pedido 9001/.test(linhas[0].textContent), 'linha diz o problema e o pedido');
  eq(document.querySelectorAll('#kbTodosTabela [data-kb-neo-dono]').length, 0, 'consultor não tem resumo por consultor');
  eq(document.querySelectorAll('#kbTodosTabela .kbTd-dono').length, 0, 'consultor não tem coluna Consultor');

  // ==== Está certo: motivo obrigatório, grava e recarrega ====
  linhas[0].querySelector('[data-kb-neo-certo]').click();
  await espera(10);
  const inp = document.getElementById('kbNeoMotivo');
  assert(!!inp, 'Está certo abre o campo do motivo na linha');
  eq(kbEstado.fichaAlvo || null, null, 'clicar em Está certo não abre a ficha');
  inp.click();
  eq(kbEstado.fichaAlvo || null, null, 'clicar no campo não abre a ficha');
  window.__rpcCalls.length = 0;
  inp.value = ' ';
  document.querySelector('[data-kb-neo-salvar]').click();
  await espera(20);
  eq(window.__rpcCalls.map(c => c.nome), [], 'sem motivo não grava');
  inp.value = 'refeito em outro pedido';
  window.__rpcRespostas.leads_neo_marcar_ok = { data: null, error: null };
  window.__rpcRespostas.leads_conferir_neo = { data: NEO.filter(x => x.dono_id === 'u-ana' && x.lead_id !== 'n1').concat([neo({ lead_id: 'n1', nome: 'Zz Caiu', ok_motivo: 'x', ok_em: '2026-11-07T12:00:00+00:00' })]), error: null };
  document.querySelector('[data-kb-neo-salvar]').click();
  await espera(40);
  eq(window.__rpcCalls.map(c => c.nome), ['leads_neo_marcar_ok', 'leads_conferir_neo'], 'grava e recarrega');
  eq(window.__rpcCalls[0].args, { p_aba: 'OUTUBRO', p_id: 'n1', p_motivo: 'refeito em outro pedido' }, 'manda aba, id e motivo');
  eq([...document.querySelectorAll('#kbTodosTabela tbody tr[data-kb-abrir]')].map(t => t.dataset.kbAbrir), ['OUTUBRO|n2', 'OUTUBRO|n3'], 'lead marcado sai da lista');

  // erro do banco aparece e não some com a linha
  let aviso = null; const avisoOrig = window.mostrarAviso; mostrarAviso = (m, t) => { aviso = [m, t]; };
  document.querySelector('#kbTodosTabela [data-kb-neo-certo]').click();
  await espera(10);
  document.getElementById('kbNeoMotivo').value = 'motivo qualquer';
  window.__rpcRespostas.leads_neo_marcar_ok = { data: null, error: { message: 'Este lead já bate com o NEO.' } };
  document.querySelector('[data-kb-neo-salvar]').click();
  await espera(30);
  eq(aviso, ['Este lead já bate com o NEO.', 'erro'], 'erro do banco vira aviso');
  mostrarAviso = avisoOrig;

  // ==== gestor: resumo por consultor, coluna Consultor, marcados como certo ====
  currentUser = { id: 'u-adm', nome: 'Zz Adm', role: 'admin', operacao: 'apex' };
  kbEstado.dono = '';
  window.__rpcRespostas.leads_conferir_neo = { data: NEO, error: null };
  window.__rpcCalls.length = 0;
  await kbCarregarNeo();
  eq(window.__rpcCalls[0].args, { p_dono: null }, 'gestor sem dono escolhido pede todos');
  const chips = [...document.querySelectorAll('#kbTodosTabela [data-kb-neo-dono]')].map(b => b.textContent.replace(/\\s+/g, ' ').trim());
  eq(chips, ['Todos 5', 'Zz Ana 3', 'Sem consultor 1', 'Zz Bia 1'], 'resumo por consultor');
  assert(document.querySelectorAll('#kbTodosTabela .kbTd-dono').length === 5, 'gestor vê a coluna Consultor');
  document.querySelector('#kbTodosTabela [data-kb-neo-dono="u-bia"]').click();
  await espera(10);
  eq([...document.querySelectorAll('#kbTodosTabela tbody tr[data-kb-abrir]')].map(t => t.dataset.kbAbrir), ['OUTUBRO|n4'], 'chip filtra o consultor');
  document.querySelector('#kbTodosTabela [data-kb-neo-ok]').click();
  await espera(10);
  const okLinha = document.querySelector('#kbTodosTabela tbody tr[data-kb-abrir]');
  assert(okLinha && /refeito com outro CNPJ/.test(okLinha.textContent) && /Zz Ana/.test(okLinha.textContent), 'gestor vê motivo e quem marcou');
  eq(document.querySelectorAll('#kbTodosTabela [data-kb-neo-certo]').length, 0, 'marcados não têm botão Está certo');

  // ==== agência não vê a visão ====
  currentUser = { id: 'u-ag', nome: 'Zz Agência', role: 'agencia', operacao: 'apex' };
  Object.assign(kbEstadoTabela(), { visao: 'todos' }); kbRenderTodos();
  eq(document.querySelectorAll('#kbVisoes [data-kb-visao="neo"]').length, 0, 'agência sem Conferir com NEO');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
