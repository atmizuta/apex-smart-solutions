// Testa a §138.1 (Conversão em Meus leads + perfil Agência).
// Spec: docs/superpowers/specs/2026-11-05-conversao-leads-design.md. DADOS FICTÍCIOS (repo público).
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
  const SP = (s) => Date.parse(s + '-03:00');
  const L = [
    { aba: 'SETEMBRO', ordem: '2026-09-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 100, convertidos: 20, receita: 2000, conv_sem_receita: 1 },
    { aba: 'SETEMBRO', ordem: '2026-09-01T03:00:00+00:00', consultor: 'Zz Bia', leads: 50, convertidos: 5, receita: 400, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 120, convertidos: 30, receita: 3000.5, conv_sem_receita: 2 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Bia', leads: 80, convertidos: 10, receita: 900, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: 'Zz Caio', leads: 4, convertidos: 0, receita: 0, conv_sem_receita: 0 },
    { aba: 'OUTUBRO', ordem: '2026-10-01T03:00:00+00:00', consultor: null, leads: 6, convertidos: 0, receita: 0, conv_sem_receita: 0 },
    { aba: 'REPIQUE', ordem: '2026-07-09T03:00:00+00:00', consultor: 'Zz Ana', leads: 40, convertidos: 2, receita: 100, conv_sem_receita: 0 },
    { aba: 'NOVEMBRO', ordem: '2026-11-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 10, convertidos: 1, receita: 50, conv_sem_receita: 0 },
  ];
  window.__L = L;

  // ==== Task 3: funções puras ====
  eq(cvMesesDe(L).map(m => m.aba), ['SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'REPIQUE'], 'meses por ordem, Repique sempre no fim');
  const out = cvMesesDe(L).find(m => m.aba === 'OUTUBRO');
  eq([out.leads, out.convertidos, out.receita, out.convSemReceita, out.repique], [210, 40, 3900.5, 2, false], 'soma do mês inclui "sem consultor"');
  eq(cvMesesDe(L).find(m => m.aba === 'REPIQUE').repique, true, 'Repique marcado');
  eq([cvRotuloMes('OUTUBRO'), cvRotuloMes('REPIQUE'), cvRotuloMes('MARÇO')], ['Outubro', 'Repique', 'Março'], 'rótulo do mês');
  eq(cvPartesSP(SP('2026-11-04T23:30:00')), { ano: 2026, mes: 11, dia: 4, diasNoMes: 30 }, 'data em SP (23:30 ainda é dia 4)');
  eq(cvPartesSP(Date.parse('2026-11-01T02:00:00Z')).mes, 10, '01/11 02:00 UTC = 31/10 em SP');
  const ms = cvMesesDe(L);
  eq(cvMesAtual(ms, SP('2026-11-04T10:00:00')), 'NOVEMBRO', 'mês atual pelo calendário de SP');
  eq(cvMesAtual(ms, SP('2026-12-01T10:00:00')), null, 'Review Focus 1: sem guia do mês atual → null');
  eq(cvMesPadrao(ms, SP('2026-12-01T10:00:00')), 'NOVEMBRO', 'sem guia do mês atual, abre na última guia (nunca no Repique)');
  eq(cvMesAtual(cvMesesDe([{ aba: 'MARCO', ordem: '2027-03-01', consultor: 'Zz', leads: 1, convertidos: 0, receita: 0 }]), SP('2027-03-10T10:00:00')), 'MARCO', 'MARÇO sem acento também casa');
  eq(cvAnterior(ms, 'OUTUBRO').aba, 'SETEMBRO', 'mês anterior');
  eq([cvAnterior(ms, 'SETEMBRO'), cvAnterior(ms, 'REPIQUE')], [null, null], 'primeiro mês e Repique não têm anterior');
  eq([cvTaxa(20, 100), cvTaxa(0, 0), cvTaxa(0, 5)], [0.2, null, 0], 'Review Focus 2: taxa com 0 leads é null');
  eq([cvVariacao(120, 100), cvVariacao(90, 100), cvVariacao(5, 0)], [20, -10, null], 'variação %');
  eq(cvComparar(out, cvAnterior(ms, 'OUTUBRO')), { leads: 40, convertidos: 60, receita: 63, taxaPp: 2.4 }, 'comparação com setembro (taxa em pontos)');
  eq(cvComparar(out, null), null, 'sem anterior, sem comparação');
  eq([cvCorTaxa(0.25, 0.2, 50), cvCorTaxa(0.2, 0.2, 50), cvCorTaxa(0.17, 0.2, 50), cvCorTaxa(0.15, 0.2, 50), cvCorTaxa(0, 0.2, 9), cvCorTaxa(null, 0.2, 10)],
     ['hi', 'hi', '', 'lo', 'poucos', ''], 'cor da taxa: ≥ média verde, < 80% vermelho, < 10 leads "poucos"');
  const rk = cvRanking(L, 'OUTUBRO');
  eq(rk.linhas.map(r => [r.pos, r.consultor, r.cor]), [[1, 'Zz Ana', 'hi'], [2, 'Zz Bia', 'lo'], [3, 'Zz Caio', 'poucos']], 'ranking por receita, cor contra a média do mês');
  eq(rk.semConsultor, { consultor: null, leads: 6, convertidos: 0, receita: 0 }, 'linha "Ainda sem consultor"');
  eq(rk.total, { leads: 210, convertidos: 40, receita: 3900.5, taxa: 40 / 210 }, 'total do mês');
  eq(cvRanking([{ aba: 'X', consultor: 'Zz B', leads: 10, convertidos: 2, receita: 100 }, { aba: 'X', consultor: 'Zz A', leads: 10, convertidos: 2, receita: 100 }], 'X').linhas.map(r => r.consultor), ['Zz A', 'Zz B'], 'empate: nome');
  eq(cvRanking(L, 'NADA'), { linhas: [], semConsultor: null, total: { leads: 0, convertidos: 0, receita: 0, taxa: null } }, 'mês sem linhas');
  eq([cvPct(0.212), cvPct(0), cvPct(null)], ['21,2%', '0,0%', '—'], 'Review Focus 2: porcentagem');
  eq([cvBRL0(19552.01), cvBRL0(0)], ['R$ 19.552', 'R$ 0'], 'receita sem centavos nos cartões');
  eq([cvVar(12, '%'), cvVar(-1.1, ' pp'), cvVar(0, '%'), cvVar(null, '%')], ['+12%', '−1,1 pp', '0%', ''], 'variação com sinal');

  // ==== Task 4: tela e permissões ====
  const agora = SP('2026-11-04T15:00:00');
  const base = { linhas: L, meses: cvMesesDe(L), sel: 'OUTUBRO', agoraMs: agora, gestor: true, atualizadoEm: agora };
  const div = document.createElement('div');
  div.innerHTML = cvHtml(base);
  eq([...div.querySelectorAll('[data-cv-mes]')].map(b => b.dataset.cvMes), ['SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'REPIQUE'], 'cartões dos meses (Repique no fim)');
  assert(div.querySelector('[data-cv-mes="OUTUBRO"]').classList.contains('on'), 'mês escolhido marcado');
  assert(/em andamento/.test(div.querySelector('[data-cv-mes="NOVEMBRO"]').textContent), 'novembro "em andamento"');
  assert(/recontato/.test(div.querySelector('[data-cv-mes="REPIQUE"]').textContent), 'Repique "recontato"');
  eq([...div.querySelectorAll('.cvRank tbody tr')].map(t => t.querySelector('.cvNome').textContent), ['Zz Ana', 'Zz Bia', 'Zz Caio', 'Ainda sem consultor'], 'ranking + linha sem consultor no fim');
  assert(/poucos leads/.test(div.querySelector('.cvRank tbody tr:nth-child(3)').textContent), 'Zz Caio com "poucos leads"');
  assert(/vs setembro/i.test(div.querySelector('.cvKpis').textContent), 'mês fechado compara com o anterior');
  assert(/2 convertidos de Outubro estão sem receita/.test(div.querySelector('.cvAviso').textContent), 'aviso de gestor');
  div.innerHTML = cvHtml(Object.assign({}, base, { gestor: false }));
  assert(!div.querySelector('.cvAviso'), 'agência/consultor não veem o aviso de receita');
  div.innerHTML = cvHtml(Object.assign({}, base, { sel: 'NOVEMBRO' }));
  assert(/dia 4 de 30/.test(div.querySelector('.cvKpis').textContent) && !/vs /.test(div.querySelector('.cvKpis').textContent), 'mês em andamento: sem comparação, com "dia 4 de 30"');
  div.innerHTML = cvHtml(Object.assign({}, base, { linhas: [{ aba: 'OUTUBRO', ordem: 'x', consultor: '<b>Zz "x"</b>', leads: 12, convertidos: 1, receita: 1 }], meses: cvMesesDe([{ aba: 'OUTUBRO', ordem: 'x', leads: 12, convertidos: 1, receita: 1 }]) }));
  assert(!div.querySelector('.cvRank b') && div.querySelector('.cvNome').textContent === '<b>Zz "x"</b>', 'Review Focus 3: nome escapado');
  div.innerHTML = cvHtml({ erro: true });
  assert(!!div.querySelector('[data-cv-tentar]'), 'erro com "Tentar de novo"');
  div.innerHTML = cvHtml({ linhas: [], meses: [], agoraMs: agora });
  assert(/Nenhum lead/.test(div.textContent), 'sem leads');

  // permissões (Review Focus 4)
  currentUser = { id: 'u-c', nome: 'Zz Cons', role: 'consultor', operacao: 'campinas' };
  assert(!cvPodeVer(), 'consultor de Campinas não vê a Conversão');
  currentUser = { id: 'u-c', nome: 'Zz Cons', role: 'consultor', operacao: 'apex' };
  kbEstado.modo = 'painel'; kbEstado.naEquipe = false;
  assert(cvPodeVer() && cvSoConversao(), 'consultor da Apex fora da equipe: só Conversão');
  eq(kbAbasVisiveis(), ['conversao'], 'abas do consultor fora da equipe');
  kbEstado.naEquipe = true;
  eq(kbAbasVisiveis(), ['hoje', 'quadro', 'todos', 'conversao'], 'consultor da equipe: + Conversão');
  currentUser = { id: 'u-s', nome: 'Zz Sup', role: 'supervisor', operacao: 'apex' };
  eq(kbAbasVisiveis(), ['hoje', 'quadro', 'todos', 'equipe', 'conversao'], 'supervisor: todas + Conversão');
  eq(kbAbasDoPerfil(false), ['hoje', 'quadro', 'todos'], 'kbAbasDoPerfil antigo intacto');

  // carga e troca de mês
  window.__rpcRespostas.conversao_resumo = { data: L, error: null };
  window.__rpcCalls.length = 0;
  kbTrocarAba('conversao');
  await espera(30);
  eq(window.__rpcCalls.filter(c => c.nome === 'conversao_resumo').length, 1, 'abrir a sub-aba chama conversao_resumo uma vez');
  assert(document.getElementById('cvConversao').style.display === '' && document.getElementById('kbBoard').style.display === 'none', 'só a Conversão aparece');
  assert(document.getElementById('panel-meusleads').classList.contains('cvAtiva'), 'painel marca cvAtiva (esconde busca/resumo)');
  document.querySelector('#cvConversao [data-cv-mes="SETEMBRO"]').click();
  eq([cvEstado.sel, window.__rpcCalls.filter(c => c.nome === 'conversao_resumo').length], ['SETEMBRO', 1], 'trocar de mês não chama o banco de novo');
  document.querySelector('#cvConversao [data-cv-lista]').click();
  eq([kbEstado.aba, kbEstado.filtros.mes, kbEstadoTabela().visao], ['todos', 'SETEMBRO', 'convertido'], 'ver na Lista: Convertidos + filtro do mês');
  window.__rpcRespostas.conversao_resumo = { data: null, error: { message: 'x' } };
  cvEstado.linhas = null;
  kbTrocarAba('conversao'); await espera(30);
  assert(!!document.querySelector('#cvConversao [data-cv-tentar]'), 'erro do banco mostra "Tentar de novo"');

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
