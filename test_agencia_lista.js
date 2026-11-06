// Testa a §139 (agência vê cada lead na Lista de Meus leads, só leitura, via leads_agencia).
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
window.__fromCalls = [];
window.__sessao = null;
function builder(tabela){
  window.__fromCalls.push(tabela);
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
  const jwt = (o) => 'x.' + btoa(JSON.stringify(o)).replace(/\\+/g, '-').replace(/\\//g, '_').replace(/=+$/, '') + '.y';
  const RES = [
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 2, convertidos: 1, receita: 300, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: null, leads: 1, convertidos: 0, receita: 0, conv_sem_receita: 0 },
    { aba: 'NOVEMBRO', ordem: '2026-11-01T03:00:00+00:00', consultor: 'Zz Bia', leads: 1, convertidos: 0, receita: 0, conv_sem_receita: 0 },
  ];
  const lead = (o) => Object.assign({ aba: 'OUTUBRO', lead_id: 'l0', nome: 'Zz Empresa', cidade: 'Zzcity', uf: 'SP', qtd_linhas: '5', tipo_empresa: 'MEI',
    telefone: '11900000000', email: 'zz@exemplo.invalid', cnpj: '00000000000000', status: null, categoria: 'andamento', converteu: false, receita: null,
    retorno_em: null, dono_nome: 'Zz Ana', pego_em: null, classificado_em: null, criado_em_lead: '2026-10-05T13:00:00+00:00', primeira_ligacao: null,
    livre: false, ligacoes: 1, ultima_ligacao: null, ultima_atendida: false, ultima_seg: null, ultima_tabulacao: null, campanha: 'Zz Campanha', formulario: 'Zz Form' }, o);
  const LEADS = [
    lead({ lead_id: 'l1', nome: 'Zz Convertida', categoria: 'convertido', converteu: true, receita: 300, status: 'VENDA REALIZADA' }),
    lead({ lead_id: 'l2', nome: 'Zz Perdida', categoria: 'perdido', receita: 999, status: 'SEM INTERESSE' }),
    lead({ lead_id: 'l3', nome: 'Zz Livre', categoria: 'sem_contato', dono_nome: null, livre: true, ligacoes: 0 }),
    lead({ aba: 'NOVEMBRO', lead_id: 'l4', nome: 'Zz Nova', dono_nome: 'Zz Bia', criado_em_lead: '2026-11-03T13:00:00+00:00' }),
    lead({ aba: 'REPIQUE', lead_id: 'l5', nome: 'Zz Repique', categoria: 'perdido', dono_nome: 'Zz Ana' }),
  ];

  // ==== entrada da agência: Lista + Conversão ====
  window.__sessao = { access_token: jwt({ role: 'agencia', sub: 'u-ag' }) };
  window.__rpcRespostas.meu_perfil = { data: [{ id: 'u-ag', nome: 'Zz Agência', username: 'zz-ag', role: 'agencia', operacao: 'apex' }], error: null };
  window.__rpcRespostas.conversao_resumo = { data: RES, error: null };
  window.__rpcRespostas.leads_agencia = { data: LEADS, error: null };
  window.__rpcRespostas.leads_kanban3 = { data: [lead({ lead_id: 'k1', nome: 'Zz Kanban' })], error: null };
  kbEstado.filtros = {};
  await loadProfileAndEnter({ id: 'u-ag', email: 'zz-ag@exemplo.invalid' });
  await espera(60);
  eq(currentUser.role, 'agencia', 'agência entrou');
  eq(kbEstado.aba, 'conversao', 'agência continua abrindo na Conversão');
  eq(kbAbasVisiveis().slice().sort(), ['conversao', 'todos'], 'agência vê Lista e Conversão');
  assert(document.getElementById('kbAbas').style.display !== 'none', 'barra de abas aparece para a agência');
  const vis = [...document.querySelectorAll('#kbAbas [data-kb-aba]')].filter(b => b.style.display !== 'none').map(b => b.dataset.kbAba);
  eq(vis, ['todos', 'conversao'], 'botões visíveis: Lista e Conversão');

  // link "ver os leads" do mês na Conversão
  const lk = document.querySelector('#cvConversao [data-cv-leads]');
  assert(!!lk, 'Conversão da agência tem o link para ver os leads do mês');
  window.__rpcCalls.length = 0; window.__fromCalls.length = 0;
  lk.click();
  await espera(60);
  eq(kbEstado.aba, 'todos', 'link abre a Lista');
  eq(kbEstado.filtros.mes, lk.dataset.cvLeads, 'Lista filtrada no mês do cartão');
  eq(kbEstadoTabela().visao, 'todos', 'Lista abre na visão Todos');
  eq(window.__rpcCalls.map(c => c.nome), ['leads_agencia'], 'Lista da agência chama só leads_agencia');
  eq(window.__fromCalls.filter(t => t !== 'leads_status_opcoes'), [], 'agência não lê tabela direto');

  // ==== Lista só leitura ====
  kbEstado.filtros = {}; Object.assign(kbEstadoTabela(), { visao: 'todos', busca: '', pagina: 1 }); kbRenderTodos();
  const cab = [...document.querySelectorAll('#kbTodosTabela thead th[data-kb-ord]')].map(t => t.dataset.kbOrd);
  eq(cab, ['nome', 'chegada', 'dono', 'etapa', 'status', 'receita', 'telefone', 'contato', 'linhas'], 'colunas da agência');
  eq(document.querySelectorAll('#kbTodosTabela tbody tr').length, 5, 'agência vê todos os leads, inclusive sem consultor e Repique');
  eq(document.querySelectorAll('#kbTodosTabela [data-kb-abrir]').length, 0, 'linha não abre a ficha');
  eq(document.querySelectorAll('#kbTodosTabela .kbLnAcoes, #kbTodosTabela [data-kb-contato]').length, 0, 'sem Ligar/WhatsApp');
  const linhaDe = (nome) => [...document.querySelectorAll('#kbTodosTabela tbody tr')].find(tr => tr.textContent.includes(nome));
  assert(/Sem consultor/.test(linhaDe('Zz Livre').querySelector('.kbTd-etapa').textContent), 'lead livre aparece como "Sem consultor"');
  assert(/300/.test(linhaDe('Zz Convertida').querySelector('.kbTd-receita').textContent), 'receita do convertido aparece');
  assert(!/999/.test(linhaDe('Zz Perdida').querySelector('.kbTd-receita').textContent), 'receita só para convertido');
  assert(/05\\/10/.test(linhaDe('Zz Convertida').querySelector('.kbTd-chegada').textContent), 'coluna Chegou em');
  assert(/Zz Ana/.test(linhaDe('Zz Repique').querySelector('.kbTd-dono').textContent), 'coluna Consultor');
  eq(kbContarVisoes(kbEstado.todos).convertido, 1, 'visão Convertidos conta os convertidos');
  assert(document.getElementById('panel-meusleads').classList.contains('cvAtiva'), 'busca global e resumo da equipe escondidos na Lista da agência');
  Object.assign(kbEstadoTabela(), { col: 'chegada', desc: true }); kbRenderTodos();
  assert(/Zz Nova/.test(document.querySelector('#kbTodosTabela tbody tr').textContent), 'ordena por chegada (mais novo primeiro)');

  // ==== saída: nada da agência fica na tela ====
  document.getElementById('btnLogout').click();
  await espera(30);
  assert(!(kbEstado.todos || []).length, 'logout limpa os leads carregados pela agência');
  eq(document.getElementById('kbTodosTabela').innerHTML, '', 'logout limpa a tabela');

  // ==== admin: Lista de sempre ====
  currentUser = { id: 'u-adm', nome: 'Zz Adm', role: 'admin', operacao: 'apex' };
  Object.assign(kbEstadoTabela(), { col: 'pego', desc: true });
  window.__rpcCalls.length = 0;
  await kbCarregarTodos();
  eq(window.__rpcCalls.map(c => c.nome), ['leads_kanban3'], 'admin continua na leads_kanban3');
  const cabAdm = [...document.querySelectorAll('#kbTodosTabela thead th[data-kb-ord]')].map(t => t.dataset.kbOrd);
  assert(!cabAdm.includes('chegada') && cabAdm.includes('pego'), 'colunas do admin não mudam');
  assert(document.querySelectorAll('#kbTodosTabela [data-kb-abrir]').length > 0, 'admin abre a ficha pela linha');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
