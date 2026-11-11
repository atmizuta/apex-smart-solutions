// Testa a §148 (gráfico "Leads por dia" na Conversão de Meus leads).
// Mesmo arcabouço do test_conversao_leads.js. DADOS FICTÍCIOS (repo público).
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
window.__charts = [];
function builder(){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, gte: () => b, lte: () => b, eq: () => b,
    upsert: () => Promise.resolve({ error: null }), insert: () => Promise.resolve({ error: null }),
    update: () => ({ eq: () => Promise.resolve({ error: null }) }),
    single: async () => ({ data: null, error: null }), maybeSingle: async () => ({ data: null, error: null }),
    then: (resolve) => resolve({ data: [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({ data: { session: null } }), onAuthStateChange: () => {}, signInWithPassword: async () => ({ data: {}, error: null }), signOut: async () => ({}) },
  from: () => builder(),
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
window.Chart = function(ctx, cfg){ this.cfg = cfg; this.destroyed = false; this.destroy = () => { this.destroyed = true; }; window.__charts.push(this); return this; };
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

  // ---- datas ----
  eq(lpdHojeSP(SP('2026-11-11T23:30:00')), '2026-11-11', 'hoje em SP às 23:30 (02:30 UTC do dia seguinte)');
  eq([lpdSomaDias('2026-11-01', -1), lpdSomaDias('2026-02-28', 1), lpdSomaDias('2026-12-31', 1)], ['2026-10-31', '2026-03-01', '2027-01-01'], 'somar dias');
  eq([lpdDiaSemana('2026-11-09'), lpdDiaSemana('2026-11-15')], [1, 7], 'segunda = 1, domingo = 7');

  // ---- linhas do banco ----
  const J = [
    ['2026-11-08', 'fb', 'mei', '1', 'CP 02', false, 3, 1, 100],
    ['2026-11-08', 'ig', 'empresa', '2-5', 'CP 06', false, 2, 0, 0],
    ['2026-11-08', null, null, null, null, true, 5, 0, 0],
    ['2026-11-10', 'fb', 'mei', '1', null, false, 4, 2, 250.5],
    ['2026-11-11', 'fb', 'mei', '1', 'CP 02', false, 1, 0, 0],
  ];
  const linhas = lpdLinhas(J);
  eq(linhas[0], { dia: '2026-11-08', plat: 'fb', tipo: 'mei', lin: '1', camp: 'CP 02', rep: false, leads: 3, conv: 1, rec: 100 }, 'array do banco vira objeto');
  eq(lpdLinhas(null), [], 'banco vazio');

  // ---- filtros ----
  const F0 = lpdFiltrosPadrao();
  eq(F0, { periodo: 90, ver: 'dia', plat: '', tipo: '', lin: '', camp: '', repique: false, conv: true }, 'filtros padrão');
  eq(lpdFiltrar(linhas, F0).reduce((s, l) => s + l.leads, 0), 10, 'padrão tira o Repique');
  eq(lpdFiltrar(linhas, Object.assign({}, F0, { repique: true })).reduce((s, l) => s + l.leads, 0), 15, 'com Repique');
  eq(lpdFiltrar(linhas, Object.assign({}, F0, { plat: 'ig' })).map(l => l.leads), [2], 'só Instagram');
  eq(lpdFiltrar(linhas, Object.assign({}, F0, { camp: '(sem)' })).map(l => l.leads), [4], 'campanha sem nome (erro Meta)');
  eq(lpdFiltrar(linhas, Object.assign({}, F0, { lin: '1', tipo: 'mei' })).map(l => l.leads), [3, 4, 1], 'filtros somam (E)');
  assert(lpdTemFiltro(Object.assign({}, F0, { tipo: 'mei' })) && !lpdTemFiltro(F0) && !lpdTemFiltro(Object.assign({}, F0, { periodo: 7, ver: 'semana' })), 'tem filtro: só os de recorte');

  // ---- campanhas ----
  eq(lpdCampanhas(linhas), [{ valor: 'CP 02', leads: 4 }, { valor: '(sem)', leads: 4 }, { valor: 'CP 06', leads: 2 }], 'campanhas por volume, sem o Repique');

  // ---- série diária ----
  const serie = lpdSerieDiaria(lpdFiltrar(linhas, F0), '2026-11-07', '2026-11-11');
  eq(serie.map(d => [d.dia, d.leads, d.conv]), [['2026-11-07', 0, 0], ['2026-11-08', 5, 1], ['2026-11-09', 0, 0], ['2026-11-10', 4, 2], ['2026-11-11', 1, 0]], 'dia sem lead entra com zero');
  eq(serie[3].rec, 250.5, 'receita somada');

  // ---- média móvel ----
  const s10 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n, i) => ({ dia: lpdSomaDias('2026-11-01', i), leads: n, conv: 0, rec: 0 }));
  eq(lpdMediaMovel(s10, 7), [null, null, null, null, null, null, 4, 5, 6, 7], 'média de 7 dias só a partir do 7º dia');

  // ---- semana e dia da semana ----
  const s14 = Array.from({ length: 14 }, (_, i) => ({ dia: lpdSomaDias('2026-11-05', i), leads: i + 1, conv: i % 2, rec: 0 }));   // qui 05 → qua 18
  const sem = lpdPorSemana(s14);
  eq(sem.map(w => [w.ini, w.fim, w.dias, w.leads]), [['2026-11-05', '2026-11-08', 4, 10], ['2026-11-09', '2026-11-15', 7, 56], ['2026-11-16', '2026-11-18', 3, 39]], 'semanas de segunda a domingo, cortadas no período');
  const ds = lpdPorDiaSemana(s14);
  eq(ds.map(d => d.rotulo), ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'], 'dia da semana começa na segunda');
  eq([ds[0].dias, ds[0].leads, ds[0].media], [2, 5 + 12, 8.5], 'segunda: 2 segundas, média 8,5');

  // ---- resumo (hoje parcial fora das médias) ----
  const atual = [5, 3, 8, 0, 4].map((n, i) => ({ dia: lpdSomaDias('2026-11-07', i), leads: n, conv: n > 3 ? 1 : 0, rec: 0 }));
  const anterior = [2, 2, 2, 2].map((n, i) => ({ dia: lpdSomaDias('2026-11-03', i), leads: n, conv: 0, rec: 0 }));
  const r = lpdResumo(atual, anterior, '2026-11-11');
  eq([r.total, r.dias, r.media, r.varPct], [16, 4, 4, 100], 'total e média sem o dia de hoje; +100% vs anterior');
  eq([r.melhor.dia, r.melhor.leads, r.pior.dia, r.pior.leads], ['2026-11-09', 8, '2026-11-10', 0], 'melhor e pior dia');
  eq([r.conv, r.taxa, r.hoje], [2, 2 / 16, 4], 'convertidos, taxa e hoje parcial à parte');
  eq(lpdResumo([], [], '2026-11-11').media, null, 'sem dias completos: sem média');

  // ---- período ----
  eq(lpdJanela(SP('2026-11-11T10:00:00'), 7), { ini: '2026-11-04', fim: '2026-11-11', antIni: '2026-10-28', antFim: '2026-11-03' }, '7 dias completos + hoje; anterior = 7 dias antes');

  // ---- período começa no primeiro lead do recorte (antes disso a campanha nem existia) ----
  const Jc = [['2026-11-05', 'fb', 'mei', '1', 'CP 06', false, 6, 1, 0], ['2026-11-06', 'fb', 'mei', '1', 'CP 06', false, 2, 0, 0], ['2026-11-10', 'fb', 'mei', '1', 'CP 06', false, 4, 0, 0]];
  const calc = lpdCalcular(lpdLinhas(Jc), Object.assign(lpdFiltrosPadrao(), { periodo: 30 }), SP('2026-11-11T10:00:00'));
  eq([calc.serie[0].dia, calc.serie.length, calc.desde], ['2026-11-05', 7, '2026-11-05'], 'série começa no 1º lead, não 30 dias antes');
  eq([calc.resumo.dias, calc.resumo.pior.dia, calc.resumo.pior.leads, calc.resumo.media], [6, '2026-11-07', 0, 2], 'pior dia e média só depois do 1º lead');
  eq(lpdCalcular(lpdLinhas([['2026-09-01', 'fb', 'mei', '1', 'A', false, 1, 0, 0]].concat(Jc)), Object.assign(lpdFiltrosPadrao(), { periodo: 7 }), SP('2026-11-11T10:00:00')).desde, null, 'dado anterior à janela: período cheio, sem "desde"');

  // ---- CSV ----
  const csv = lpdCsv(serie.slice(0, 2), 'dia');
  eq(csv.split('\\r\\n')[0], 'Data;Dia da semana;Leads;Convertidos;Taxa', 'CSV: cabeçalho em ; para o Excel');
  eq(csv.split('\\r\\n')[2], '08/11/2026;Dom;5;1;20,0%', 'CSV: linha do dia');
  eq(lpdCsv(sem, 'semana').split('\\r\\n')[1], 'Semana de 05/11/2026 a 08/11/2026;4;10;2,5;' + sem[0].conv + ';' + cvPct(sem[0].conv / 10).replace('%', '') + '%', 'CSV por semana');

  // ---- tela ----
  currentUser = { id: 'u-s', nome: 'Zz Sup', role: 'supervisor', operacao: 'apex' };
  kbEstado.modo = 'painel'; kbEstado.naEquipe = true;
  const hoje = lpdHojeSP(Date.now());
  const J2 = Array.from({ length: 40 }, (_, i) => [lpdSomaDias(hoje, -i), i % 2 ? 'fb' : 'ig', 'mei', '1', 'CP 02', false, 10 + (i % 5), 2, 100]);
  window.__rpcRespostas.conversao_resumo = { data: [{ aba: 'NOVEMBRO', ordem: '2026-11-01T03:00:00+00:00', consultor: 'Zz Ana', leads: 10, convertidos: 2, receita: 200, conv_sem_receita: 0 }], error: null };
  window.__rpcRespostas.leads_volume_diario = { data: J2, error: null };
  window.__rpcCalls.length = 0;
  kbTrocarAba('conversao');
  await espera(40);
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_volume_diario').length, 1, 'abrir a Conversão busca o volume uma vez');
  const card = document.querySelector('#cvConversao .lpdCard');
  assert(!!card, 'cartão Leads por dia aparece dentro da Conversão');
  assert(/Leads por dia/.test(card.textContent), 'título do cartão');
  assert(!!card.querySelector('canvas'), 'tem o gráfico');
  const ch = window.__charts[window.__charts.length - 1];
  eq(ch.cfg.data.labels.length, 40, 'padrão 90 dias, mas o dado começa há 39 dias: o gráfico começa no 1º lead');
  eq(ch.cfg.data.datasets.map(d => d.label), ['Convertidos', 'Leads', 'Média de 7 dias', 'Média do período'], 'camadas do gráfico por dia');
  // trocar de mês na Conversão não refaz a consulta nem perde o cartão
  document.querySelector('#cvConversao [data-cv-mes="NOVEMBRO"]').click();
  assert(!!document.querySelector('#cvConversao .lpdCard canvas'), 'trocar de mês mantém o gráfico');
  eq(window.__rpcCalls.filter(c => c.nome === 'leads_volume_diario').length, 1, 'trocar de mês não busca o volume de novo');
  // período 7 dias
  document.querySelector('#cvConversao [data-lpd-periodo="7"]').click();
  const ch7 = window.__charts[window.__charts.length - 1];
  eq(ch7.cfg.data.labels.length, 8, '7 dias completos + hoje');
  assert(window.__charts[window.__charts.length - 2].destroyed, 'gráfico velho é destruído');
  // filtro de plataforma
  const sel = document.querySelector('#cvConversao [data-lpd-f="plat"]');
  sel.value = 'ig'; sel.dispatchEvent(new window.Event('change', { bubbles: true }));
  eq(lpdEstado.f.plat, 'ig', 'filtro de plataforma aplicado');
  assert(!!document.querySelector('#cvConversao [data-lpd-limpar]'), 'com filtro aparece "Limpar filtros"');
  document.querySelector('#cvConversao [data-lpd-limpar]').click();
  eq(lpdEstado.f.plat, '', 'limpar filtros');
  eq(lpdEstado.f.periodo, 7, 'limpar filtros mantém o período');
  // ver por semana
  document.querySelector('#cvConversao [data-lpd-ver="semana"]').click();
  eq(lpdEstado.f.ver, 'semana', 'ver por semana');
  // erro
  window.__rpcRespostas.leads_volume_diario = { data: null, error: { message: 'x' } };
  lpdEstado.dados = null;
  await lpdCarregar(); await espera(20);
  assert(!!document.querySelector('#cvConversao [data-lpd-tentar]'), 'erro do banco mostra "Tentar de novo" no cartão');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  process.exit(fail > 0 ? 1 : 0);
}catch(err){
  console.error('FALHA:', err && err.stack ? err.stack : err);
  process.exit(1);
}
})();
`;
window.eval(jsCode + testScript);
