// Testa o §126.1 (redesign de Meus leads, Fase 1: ficha nova com Classificar dentro + Hoje B).
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
window.alert = (m) => window.__alertas.push(String(m));   // sem ApexMotion no jsdom, mostrarAviso cai aqui
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
  const SP = (s) => Date.parse(s + '-03:00');   // horário de São Paulo
  // ==== Task 1: funções puras ====
  eq([kbStTexto('AGENDADO RETORNO'), kbStTexto('CNPJ INAPTO'), kbStTexto('CLIENTE SÓ QUERIA FIBRA'), kbStTexto(null)],
     ['Agendado retorno', 'CNPJ inapto', 'Cliente só queria fibra', ''], 'STATUS em frase normal, siglas em maiúscula');
  eq(kbDataLongaSP(SP('2026-10-28T15:12:00')), 'Quarta, 28 de outubro · 15:12', 'data longa em SP');
  const ag1 = SP('2026-10-28T15:12:00');   // quarta 15:12
  const LF = (id, o) => Object.assign({ aba: 'O', lead_id: id, nome: 'Zz ' + id, livre: false, categoria: 'andamento', status: 'EM NEGOCIAÇÂO', ligacoes: 1, ultima_ligacao: '2026-10-28T13:00:00-03:00', pego_em: '2026-10-20T10:00:00-03:00' }, o);
  const L1 = [
    LF('n1', { categoria: 'sem_contato', status: null, ligacoes: undefined, ultima_ligacao: null, pego_em: '2026-10-28T15:06:00-03:00' }),
    LF('n2', { categoria: 'sem_contato', status: null, ligacoes: undefined, ultima_ligacao: null, pego_em: '2026-10-28T14:00:00-03:00' }),
    LF('s1', { ligacoes: 0, ultima_ligacao: null, pego_em: '2026-10-28T12:40:00-03:00' }),
    LF('s2', { ligacoes: 0, ultima_ligacao: null, pego_em: '2026-10-27T10:00:00-03:00' }),
    LF('p1', { ligacoes: 2, ultima_ligacao: '2026-10-24T10:00:00-03:00', classificado_em: '2026-10-24T10:05:00-03:00' }),
    LF('p2', { ligacoes: 2, ultima_ligacao: '2026-10-26T10:00:00-03:00' }),
    LF('a1', { ligacoes: 3, ultima_ligacao: '2026-10-27T17:40:00-03:00' }),
    LF('r1'), LF('r2'), LF('r3', { ultima_ligacao: '2026-10-26T11:00:00-03:00' }),
    LF('c1', { categoria: 'convertido', status: 'PEDIDO CONCLUIDO (VENDA)' }),
    LF('l1', { livre: true, categoria: 'sem_contato', status: null }),
  ];
  const R1 = [
    { aba: 'O', lead_id: 's1', nome: 'Zz s1', quando: '2026-10-28T18:00:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'r2', nome: 'Zz r2', quando: '2026-10-28T16:45:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'r1', nome: 'Zz r1', quando: '2026-10-28T15:30:00-03:00', vencido: false },
    { aba: 'O', lead_id: 'a1', nome: 'Zz a1', quando: '2026-10-28T14:00:00-03:00', vencido: true },
    { aba: 'O', lead_id: 'r3', nome: 'Zz r3', quando: '2026-10-27T17:30:00-03:00', vencido: true },
  ];
  const f1 = kbFilaHoje(L1, R1, ag1);
  eq(f1.map(i => i.lead_id), ['r3', 'a1', 'n2', 'n1', 'r1', 'r2', 's1', 's2', 'p1'], 'fila: atrasados → agora (novos, depois retorno da próxima 1 h) → mais tarde → nunca ligados → parados; cada lead uma vez');
  eq(f1.map(i => i.grupo), ['atrasados', 'atrasados', 'agora', 'agora', 'agora', 'tarde', 'tarde', 'nunca', 'parados'], 'grupos da fila');
  eq(f1.map(i => i.rotulo), ['ontem', '14:00', 'novo', 'novo', '15:30', '16:45', '18:00', '—', '4 d'], 'rótulo da coluna da esquerda');
  eq(f1.map(i => i.classe), ['late', 'late', 'novo', 'novo', '', '', '', '', ''], 'cor do rótulo');
  assert(!f1.some(i => ['c1', 'l1', 'p2'].includes(i.lead_id)), 'convertido, livre e parado há só 2 dias ficam fora');
  eq(f1[0].chave, 'O|r3', 'chave aba|id');
  eq(kbFilaHoje([LF('b1')], [{ aba: 'O', lead_id: 'b1', nome: 'Zz b1', quando: '2026-10-28T16:12:00-03:00', vencido: false }], ag1)[0].grupo, 'agora', 'retorno em exatamente 60 min entra em Agora');
  eq(kbFilaHoje([LF('b2')], [{ aba: 'O', lead_id: 'b2', nome: 'Zz b2', quando: '2026-10-28T16:13:00-03:00', vencido: false }], ag1)[0].grupo, 'tarde', 'retorno em 61 min vai para Mais tarde');
  const fora = kbFilaHoje([], [{ aba: 'O', lead_id: 'zz', nome: 'Zz Fora do Quadro', quando: '2026-10-28T09:00:00-03:00', vencido: true }], ag1);
  eq([fora.length, fora[0].nome, fora[0].lead], [1, 'Zz Fora do Quadro', null], 'retorno de lead que não veio no Quadro entra com o nome do retorno');
  eq(kbFilaHoje([LF('t1')], [{ aba: 'O', lead_id: 't1', nome: 'Zz t1', quando: '2026-10-29T10:00:00-03:00', vencido: false }], ag1).length, 0, 'retorno de amanhã não entra');
  eq(kbFilaHoje(null, null, ag1), [], 'sem dados: fila vazia');
  eq([kbProximoHoje(['a', 'b', 'c', 'd'], 'b', ['a', 'c', 'd']), kbProximoHoje(['a', 'b', 'c', 'd'], 'b', ['a', 'b', 'c', 'd']),
      kbProximoHoje(['a', 'b', 'c'], 'c', ['a', 'b']), kbProximoHoje(['a'], 'a', []), kbProximoHoje(['a', 'b'], 'b', ['b']),
      kbProximoHoje(['a', 'b', 'c'], 'b', ['a', 'b'])],
     ['c', 'c', 'a', null, null, 'a'], 'próximo depois de salvar: o seguinte que ainda existe; senão o primeiro que não é o atual');
  const at = kbAtalhosRetorno(ag1);
  eq(at.map(a => a.rotulo), ['Hoje 17h', 'Amanhã 10h', 'Amanhã 14h', 'Em 3 dias', 'Próxima semana'], 'atalhos de retorno às 15:12');
  eq(at.map(a => a.data + ' ' + a.hora), ['2026-10-28 17:00', '2026-10-29 10:00', '2026-10-29 14:00', '2026-10-31 10:00', '2026-11-02 10:00'], 'datas e horas dos atalhos');
  assert(!kbAtalhosRetorno(SP('2026-10-28T17:00:00')).some(a => a.rotulo === 'Hoje 17h'), 'a partir das 17h some o Hoje 17h');
  eq([kbAtalhosRetorno(SP('2026-11-02T09:00:00')).pop().data, kbAtalhosRetorno(SP('2026-11-01T09:00:00')).pop().data], ['2026-11-09', '2026-11-02'], 'próxima semana = próxima segunda');
  eq([kbObsParaSalvar('  ', 'Zz antiga'), kbObsParaSalvar('Zz nova', 'Zz antiga'), kbObsParaSalvar('', null)], ['Zz antiga', 'Zz nova', ''], 'OBS em branco mantém a atual (decisão 1)');
  const u = (l, r) => kbUrgenciaFicha(l, r, ag1);
  eq(u(LF('a1'), { quando: '2026-10-28T14:00:00-03:00', vencido: true }), { classe: 'late', texto: 'retorno era às 14:00' }, 'urgência: retorno vencido hoje');
  eq(u(LF('r3'), { quando: '2026-10-27T17:30:00-03:00', vencido: true }).texto, 'retorno era ontem às 17:30', 'urgência: retorno vencido ontem');
  eq(u(LF('r9'), { quando: '2026-10-25T10:00:00-03:00', vencido: true }).texto, 'retorno era 25/10 às 10:00', 'urgência: retorno vencido há dias');
  eq(u(LF('r1'), { quando: '2026-10-28T15:30:00-03:00', vencido: false }), { classe: 'ok', texto: 'retorno hoje às 15:30' }, 'urgência: retorno hoje');
  eq(u(L1[0], null), { classe: 'novo', texto: 'lead novo · pego há 6 min' }, 'urgência: lead novo');
  eq(u(L1[2], null), { classe: 'soon', texto: 'classificado, mas nunca ligado' }, 'urgência: nunca ligado');
  eq(u(L1[4], null), { classe: 'soon', texto: 'parado há 4 dias' }, 'urgência: parado');
  eq(u(L1[10], null), null, 'convertido sem urgência');
  eq(u(LF('lv', { livre: true, categoria: 'sem_contato', status: null, criado_em_lead: '2026-10-28T14:47:00-03:00' }), null), { classe: 'novo', texto: 'livre · chegou há 25 min' }, 'urgência: livre');
  // ==== Task 2: tokens e barra da aba ====
  const css = [...document.querySelectorAll('style')].map(s => s.textContent).join('\\n');
  assert(css.includes('#panel-meusleads,#kbFicha{--ml-ink:var(--c-grafite);--ml-ink-2:#464A4E;'), 'tokens da aba declarados');
  const stKb = [...document.querySelectorAll('style')].map(s => s.textContent).find(t => t.includes('/* Meus leads — Kanban')) || '';
  const cssKb = stKb.slice(stKb.indexOf('/* Meus leads — Kanban'));   // o bloco de Meus leads vai até o fim desse <style>
  const hexSolto = cssKb.split('\\n').filter(l => /#[0-9a-fA-F]{3,6}\\b/.test(l) && !/^\\s*\\[data-st=/.test(l) && !/--ml-ink-2:#464A4E;.*--ml-surface-2:#F7F7F8;/.test(l));
  eq(hexSolto, [], 'CSS de Meus leads: hex só nos tokens e nas cores de STATUS');
  const seg = document.getElementById('kbAbas');
  assert(seg.classList.contains('kbSeg'), 'abas viram controle segmentado');
  eq([...seg.querySelectorAll('[data-kb-aba]')].map(b => b.dataset.kbAba), ['equipe', 'hoje', 'quadro', 'todos'], 'Equipe primeiro (só o gestor vê)');
  assert(document.querySelector('.kbBarra #kbBusca') && document.querySelector('.kbBarra .kbAtalhoTecla').textContent === '/', 'busca na barra, com o atalho /');
  assert(document.querySelector('#kbFiltrosGestor .kbMaisMenu #kbSoDiverg') && document.querySelector('#kbFiltrosGestor .kbMaisMenu #kbReescrever'), 'Só divergências e Reescrever no menu ⋯ do gestor');
  assert(!document.querySelector('#panel-meusleads .kbTopo'), 'sai o cartão antigo do topo');
  const painel = document.getElementById('panel-meusleads');
  painel.classList.add('active');
  const tecla = (k, alvo) => (alvo || document).dispatchEvent(new window.KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
  document.body.focus();
  tecla('/');
  assert(document.activeElement === document.getElementById('kbBusca'), '/ leva para a busca');
  const ta = document.createElement('textarea'); document.body.appendChild(ta); ta.focus();
  tecla('/', ta);
  assert(document.activeElement === ta, '/ dentro de um campo de texto não rouba o foco');
  ta.remove();
  painel.classList.remove('active');
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
