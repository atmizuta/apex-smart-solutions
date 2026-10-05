// Testa a aba Vendas Perdidas (05/10/2026) — REGRAS_NEGOCIO.md §70.
// Spec: docs/superpowers/specs/2026-10-05-vendas-perdidas-categorias-design.md
// Mesma técnica dos outros testes: decodifica o <script> real de _template.html, mocka o Supabase e roda num jsdom.
// DADOS FICTÍCIOS — o repositório é público (nada de telefone, nome ou CNPJ real).
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
window.__escritas = [];
window.__lidas = [];
window.__alertas = [];
function builder(tabela){
  const linhasFiltradas = () => { const f = b.__eq || {}; return (window.__tabelas[tabela] || []).filter(l => Object.keys(f).every(c => l[c] === undefined || l[c] === f[c])); };
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b,
    eq: (c, v) => { b.__eq = Object.assign(b.__eq || {}, { [c]: v }); return b; },
    upsert: (rows, opts) => { window.__escritas.push({ tabela, op: 'upsert', rows, opts }); return Promise.resolve({ error: null }); },
    insert: (rows) => { window.__escritas.push({ tabela, op: 'insert', rows }); return Promise.resolve({ error: null }); },
    update: (patch) => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'update', patch, filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    delete: () => ({ eq: (c, v) => { window.__escritas.push({ tabela, op: 'delete', filtro: { [c]: v } }); return Promise.resolve({ error: null }); } }),
    maybeSingle: async () => ({ data: linhasFiltradas()[0] || null, error: null }),
    then: (resolve) => resolve({ data: linhasFiltradas(), error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => { window.__lidas.push(t); return builder(t); },
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    return { range: () => Promise.resolve(res), then: (ok, ko) => Promise.resolve(res).then(ok, ko) };
  },
})) };
window.XLSX = Object.assign({}, require('xlsx'), { writeFile: () => {} });
window.alert = (m) => window.__alertas.push(String(m));
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
  const V = (np, extra) => Object.assign({ numero_pedido: np, usuario: 'CONSULTOR A', profile_id: 'p-a', cliente: 'Cliente Teste', produtos: 'Produto Teste', valor: 100, perdido_em: '2026-10-03T15:00:00Z', categoria: 'Não responde', subcategoria: null, tags: [], tag_pedido: null }, extra || {});

  // ==== TASK 4: funções puras ====
  eq(vpPeriodo('mes', '2026-10-05'), { de: '2026-10-01', ate: '2026-10-05' }, 'este mês');
  eq(vpPeriodo('mespassado', '2026-10-05'), { de: '2026-09-01', ate: '2026-09-30' }, 'mês passado (30 dias)');
  eq(vpPeriodo('mespassado', '2026-01-15'), { de: '2025-12-01', ate: '2025-12-31' }, 'mês passado em janeiro');
  eq(vpPeriodo('mespassado', '2026-03-10'), { de: '2026-02-01', ate: '2026-02-28' }, 'mês passado fevereiro');
  eq(vpPeriodo('90d', '2026-10-05'), { de: '2026-07-08', ate: '2026-10-05' }, 'últimos 90 dias (contando hoje)');
  eq(vpPeriodo('custom', '2026-10-05', '2026-09-10', '2026-09-20'), { de: '2026-09-10', ate: '2026-09-20' }, 'personalizado');
  eq(vpPeriodo('custom', '2026-10-05', '', ''), { de: '2026-10-05', ate: '2026-10-05' }, 'personalizado vazio = hoje');

  eq(vpCategoria(V('1', { categoria: null })), 'Sem categoria', 'categoria null');
  eq(vpCategoria(V('1', { categoria: '  ' })), 'Sem categoria', 'categoria em branco');
  eq(vpCategoria(V('1')), 'Não responde', 'categoria preenchida');

  const linhas = [
    V('1'), V('2', { valor: 50 }), V('3', { categoria: 'Restrição de Crédito', valor: 300 }),
    V('4', { categoria: null, usuario: 'CONSULTOR B', profile_id: 'p-b' }), V('5', { categoria: null, usuario: 'CONSULTOR B', profile_id: 'p-b', valor: '20' }),
    V('6', { categoria: 'Desconfiança', usuario: 'CONSULTOR B', profile_id: 'p-b' }),
  ];
  const mot = vpMotivos(linhas);
  eq(mot.map(m => m.motivo), ['Não responde', 'Desconfiança', 'Restrição de Crédito', 'Sem categoria'], 'motivos: mais pedidos primeiro, empate alfabético, Sem categoria por último');
  eq([mot[0].pedidos, mot[0].valor], [2, 150], 'Não responde: 2 pedidos, R$ 150');
  eq(mot[3].valor, 120, 'valor em texto somado');
  assert(Math.abs(mot.reduce((s, m) => s + m.pct, 0) - 1) < 1e-9, 'percentuais somam 100%');

  const k = vpKpis(linhas);
  eq([k.total, k.valor], [6, 670], 'KPIs: 6 pedidos, R$ 670');
  eq(k.pctComCategoria, 4 / 6, '% com categoria');
  eq([k.maiorMotivo, k.maiorMotivoPct], ['Não responde', 2 / 4], 'maior motivo entre os com categoria');
  eq(vpKpis([]), { total: 0, valor: 0, pctComCategoria: null, maiorMotivo: null, maiorMotivoPct: null }, 'KPIs vazios');

  const cons = vpConsultores(linhas);
  eq(cons.map(c => [c.usuario, c.perdas, c.comCategoria]), [['CONSULTOR B', 3, 1], ['CONSULTOR A', 3, 3]], 'preenchimento: pior primeiro');
  eq(cons[0].maiorMotivo, 'Desconfiança', 'maior motivo do consultor');
  eq([vpNivelPreenchimento(0.9), vpNivelPreenchimento(0.89), vpNivelPreenchimento(0.5), vpNivelPreenchimento(0.49)], ['ok', 'medio', 'medio', 'maximo'], 'selos de preenchimento');

  eq(vpFiltrar(linhas, 'CONSULTOR B', '').length, 3, 'filtro consultor');
  eq(vpFiltrar(linhas, '', 'Sem categoria').map(l => l.numero_pedido), ['4', '5'], 'filtro Sem categoria');
  eq(vpFiltrar(linhas, 'CONSULTOR B', 'Desconfiança').map(l => l.numero_pedido), ['6'], 'filtros combinados');

  const agoraT = Date.parse('2026-10-05T15:00:00Z');
  assert(vpSyncAtrasada(null, agoraT), 'nunca sincronizou = atrasada');
  assert(!vpSyncAtrasada({ ok_em: '2026-10-05T13:00:00Z' }, agoraT), '2 h atrás = em dia');
  assert(vpSyncAtrasada({ ok_em: '2026-10-05T11:30:00Z' }, agoraT), '3h30 atrás = atrasada');

  // ==== mais testes entram aqui ====

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
