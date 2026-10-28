// Testa o §126.2 (redesign de Meus leads, Fase 2: Quadro e Lista).
// Spec: docs/superpowers/specs/2026-10-28-meus-leads-redesign-design.md. DADOS FICTÍCIOS (repo público).
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
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
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
window.__alertas = [];
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
  const SP = (s) => Date.parse(s + '-03:00');
  // ==== Task 1: funções puras ====
  const ag = SP('2026-10-28T15:00:00');
  const LA = (id, o) => Object.assign({ aba: 'O', lead_id: id, nome: 'Zz ' + id, livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 1, criado_em_lead: '2026-10-20T10:00:00-03:00', pego_em: '2026-10-20T10:00:00-03:00' }, o);
  eq([kbIniciais('Zzkcon Teste'), kbIniciais('caio'), kbIniciais('  zz  meio  fim '), kbIniciais(null)], ['ZT', 'C', 'ZF', ''], 'iniciais do dono');
  eq([kbRetornoFaixa(LA('a', { retorno_em: '2026-10-27' }), ag), kbRetornoFaixa(LA('b', { retorno_em: '2026-10-28' }), ag), kbRetornoFaixa(LA('c', { retorno_em: '2026-10-30' }), ag), kbRetornoFaixa(LA('d'), ag)],
     ['late', 'hoje', 'fut', null], 'faixa do retorno pela data');
  eq([kbUrgenciaCartao(LA('a', { retorno_em: '2026-10-27' }), ag), kbUrgenciaCartao(LA('d'), ag), kbUrgenciaCartao(LA('c', { categoria: 'convertido' }), ag), kbUrgenciaCartao(LA('l', { livre: true, categoria: 'sem_contato' }), ag)],
     ['late', 'nada', null, null], 'ícone de urgência só em lead em aberto');
  eq([kbFaixaVermelha(LA('a', { retorno_em: '2026-10-27' }), ag),
      kbFaixaVermelha(LA('s1', { ligacoes: 0, pego_em: '2026-10-26T10:00:00-03:00' }), ag),
      kbFaixaVermelha(LA('s2', { ligacoes: 0, pego_em: '2026-10-28T13:00:00-03:00' }), ag),
      kbFaixaVermelha(LA('n', { categoria: 'sem_contato', status: null, ligacoes: undefined, criado_em_lead: '2026-10-28T14:40:00-03:00' }), ag),
      kbFaixaVermelha(LA('d'), ag),
      kbFaixaVermelha(LA('p', { categoria: 'perdido', status: 'CNPJ INAPTO', retorno_em: '2026-10-27' }), ag)],
     [true, true, false, true, false, false], 'faixa vermelha: retorno vencido, Sem ligação há mais de 1 dia, novo sem contato há 15+ min; nunca em perdido');
  eq([kbRetornoTag(LA('a', { retorno_em: '2026-10-27' }), ag), kbRetornoTag(LA('a', { retorno_em: '2026-10-25' }), ag), kbRetornoTag(LA('b', { retorno_em: '2026-10-28' }), ag), kbRetornoTag(LA('c', { retorno_em: '2026-10-30' }), ag), kbRetornoTag(LA('d'), ag)],
     [{ classe: 'late', texto: 'retorno ontem · atrasado' }, { classe: 'late', texto: 'retorno 25/10 · atrasado' }, { classe: 'ok', texto: 'retorno hoje' }, { classe: '', texto: 'retorno 30/10' }, null], 'etiqueta do retorno');
  const lv = (min) => ({ livre: true, criado_em_lead: new Date(ag - min * 60000).toISOString() });
  eq([kbCorIdadeLivre(lv(3), ag), kbCorIdadeLivre(lv(10), ag), kbCorIdadeLivre(lv(20), ag), kbCorIdadeLivre(lv(40), ag), kbCorIdadeLivre({ livre: true }, ag)], ['novo', '', 'soon', 'late', ''], 'cor da idade do livre');
  const LV = [LA('a1', { retorno_em: '2026-10-29' }), LA('a2'), LA('s1', { ligacoes: 0 }), LA('n1', { categoria: 'sem_contato', status: null, ligacoes: undefined }),
    LA('r1', { categoria: 'perdido', status: 'CLIENTE NÃO RESPONDE' }), LA('c1', { categoria: 'convertido' }), LA('p1', { categoria: 'perdido', status: 'CNPJ INAPTO' })];
  eq(kbContarVisoes(LV), { todos: 7, aberto: 4, retornos: 1, semlig: 1, semresp: 1, convertido: 1, perdido: 1 }, 'contagem das visões da Lista');
  eq(LV.filter(l => kbNaVisao(l, 'aberto')).map(l => l.lead_id), ['a1', 'a2', 's1', 'n1'], 'Em aberto = Meus novos, Sem ligação e Em andamento');
  eq(KB_VISOES.map(v => v[1]), ['Todos', 'Em aberto', 'Retornos', 'Sem ligação', 'Sem resposta', 'Convertidos', 'Perdidos'], 'nomes das visões');
  kbEstado.colAbertas = {};
  eq([kbColAberta('convertido'), kbColAberta('perdido'), kbColAberta('andamento')], [false, false, true], 'Convertido e Perdido começam recolhidos');
  kbEstado.colAbertas = { perdido: true }; kbSalvarColAbertas();
  eq([kbColAberta('perdido'), kbLerColAbertas()], [true, { perdido: true }], 'abrir o Perdido fica guardado');
  window.localStorage.setItem('kbDensidade', 'compacto');
  eq(kbLerDensidade(), 'compacto', 'densidade guardada');
  const lsReal = window.localStorage;
  Object.defineProperty(window, 'localStorage', { get(){ throw new Error('bloqueado'); }, configurable: true });
  eq([kbLerDensidade(), kbLerColAbertas()], ['conforto', {}], 'RF3: localStorage bloqueado volta ao padrão');
  kbSalvarDensidade(); kbSalvarColAbertas();
  Object.defineProperty(window, 'localStorage', { value: lsReal, configurable: true, writable: true });
  window.localStorage.removeItem('kbDensidade'); window.localStorage.removeItem('kbColAbertas'); kbEstado.colAbertas = {};
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
