// Testa a aba Discador (15/10/2026) — REGRAS_NEGOCIO.md §87.
// Spec: docs/superpowers/specs/2026-10-14-discador-visao-supervisao-design.md
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
window.__rpcAtraso = {};
window.__tabelas = {};
window.__avisos = [];
function builder(tabela){
  const b = {
    select: () => b, in: () => b, is: () => b, order: () => b, limit: () => b, range: () => b, gte: () => b, lte: () => b, eq: () => b, not: () => b,
    maybeSingle: async () => ({ data: (window.__tabelas[tabela] || [])[0] || null, error: null }),
    then: (resolve) => resolve({ data: window.__tabelas[tabela] || [], error: null }),
  };
  return b;
}
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (t) => builder(t),
  functions: { invoke: async () => ({ data: {}, error: null }) },
  rpc: (nome, args) => {
    window.__rpcCalls.push({ nome, args });
    const r = window.__rpcRespostas[nome];
    const res = typeof r === 'function' ? r(args) : (r || { data: [], error: null });
    const atraso = window.__rpcAtraso[nome] || 0;
    const p = new Promise(ok => setTimeout(() => ok(res), atraso));
    return { range: () => p, then: (ok, ko) => p.then(ok, ko) };
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
  const avisos = [];
  mostrarAviso = (msg, tipo) => avisos.push([tipo, String(msg)]);

  // ==== TASK 1: funções puras ====
  eq(dcPeriodo('hoje', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'hoje');
  eq(dcPeriodo('ontem', '2026-10-01'), { de: '2026-09-30', ate: '2026-09-30' }, 'ontem atravessa o mês');
  eq(dcPeriodo('7dias', '2026-10-15'), { de: '2026-10-09', ate: '2026-10-15' }, '7 dias inclui hoje');
  eq(dcPeriodo('mes', '2026-10-15'), { de: '2026-10-01', ate: '2026-10-15' }, 'mês até hoje');
  eq(dcPeriodo('custom', '2026-10-15', '2026-09-01', '2026-10-10'), { de: '2026-09-01', ate: '2026-10-10' }, 'personalizado válido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-10-10', '2026-10-01'), null, 'personalizado invertido');
  eq(dcPeriodo('custom', '2026-10-15', '2026-01-01', '2026-10-01'), null, 'personalizado acima de 120 dias');
  eq(dcPeriodo('custom', '2026-10-15', '2026-06-03', '2026-10-01'), { de: '2026-06-03', ate: '2026-10-01' }, '120 dias exatos valem');
  eq(dcPeriodo('custom', '2026-10-15', '', '2026-10-01'), null, 'personalizado vazio');
  eq(dcPeriodo('xyz', '2026-10-15'), { de: '2026-10-15', ate: '2026-10-15' }, 'chave desconhecida = hoje');

  eq(dcTaxa(1, 4), 0.25, 'taxa');
  eq(dcTaxa(3, 0), null, 'taxa com divisor 0');
  eq(dcFmtPct(0.30627), '30,6%', 'pct com 1 casa');
  eq(dcFmtPct(null), '—', 'pct nulo');
  eq(dcFmtNum(139925), '139.925', 'milhar pt-BR');
  eq(dcFmtNum(null), '0', 'número nulo');
  eq(dcFmtSeg(48), '48 s', 'segundos');
  eq(dcFmtSeg(125), '2 min 05 s', 'minutos');
  eq(dcFmtSeg(null), '—', 'segundos nulos');
  eq(dcDdMm('2026-10-05'), '05/10', 'dd/mm');

  const ph = [
    { hora: 13, contato: 40, abandonadas: 4 },
    { hora: 14, contato: 50, abandonadas: 10 },
    { hora: 15, contato: 8, abandonadas: 6 },
  ];
  eq(dcAlertaAbandono(ph, 15, 0.15), { hora: 14, taxa: 0.2, abandonadas: 10, contato: 50 }, 'às 15h olha 14h: 20% > 15%');
  eq(dcAlertaAbandono(ph, 14, 0.15), null, 'às 14h olha 13h: 10% não alerta');
  eq(dcAlertaAbandono(ph, 16, 0.15), null, 'às 16h olha 15h: só 8 contatos, sem alerta');
  eq(dcAlertaAbandono(ph, 9, 0.15), null, 'hora sem linha');
  eq(dcAlertaAbandono(null, 15, 0.15), null, 'sem dados');

  const cons = [
    { atendidas: 100, sem_avanco: 50, sem_tabulacao: 2, vendas: 4 },
    { atendidas: 100, sem_avanco: 30, sem_tabulacao: 8, vendas: 0 },
    { atendidas: 5, sem_avanco: 5, sem_tabulacao: 5, vendas: 0 },
  ];
  const m = dcMediaEquipe(cons);
  eq([Math.round(m.semAvanco * 1000), Math.round(m.semTab * 1000), Math.round(m.conversao * 1000)], [415, 73, 20], 'média ponderada pelas atendidas');
  eq(dcMediaEquipe([]), { semAvanco: null, semTab: null, conversao: null }, 'equipe vazia');
  eq(dcPiorQueMedia(0.6, 0.4, true), true, 'sem avanço 50% acima: pior');
  eq(dcPiorQueMedia(0.5, 0.4, true), false, 'sem avanço 25% acima: normal');
  eq(dcPiorQueMedia(0.01, 0.02, false), true, 'conversão 50% abaixo: pior');
  eq(dcPiorQueMedia(0.5, null, true), false, 'sem média: nunca destaca');

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
