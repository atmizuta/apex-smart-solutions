// Faixa de aviso "sincronização das ligações parada" (robô ProContact, spec 2026-10-01-robo-procontact-ligacoes-design.md).
// Aparece no topo para admin e supervisor quando a última sincronização com sucesso (ligacoes_sync_log) tem mais de
// 3 horas ÚTEIS (seg-sáb, 07-22h, São Paulo). Sem nenhuma linha no log (robô ainda não ligado) não mostra nada.
const fs = require('fs');
const { JSDOM } = require('jsdom');
const { comRange } = require('./test_helper_mock.js');

let html = fs.readFileSync('_template.html', 'utf8');
const htmlNoScript = html.replace(/<script>[\s\S]*?<\/script>/g, '');
const scriptMatch = html.match(/<script>([\s\S]*?)<\/script>\s*<\/body>/);
if(!scriptMatch){ console.error('script nao encontrado'); process.exit(1); }
const jsCode = scriptMatch[1];

const dom = new JSDOM(htmlNoScript, { runScripts: 'outside-only', url: 'http://localhost/' });
const { window } = dom;

window.__ligOk = null;      // linha devolvida pela consulta (ou null = nenhuma sincronização registrada)
window.__ligErro = false;   // simula falha na consulta
window.__ligConsultas = 0;  // quantas vezes ligacoes_sync_log foi consultada
window.supabase = { createClient: comRange(() => ({
  auth: { getSession: async () => ({data:{session:null}}), onAuthStateChange: () => {}, signInWithPassword: async () => ({data:{},error:null}), signOut: async () => ({}) },
  from: (table) => ({
    select: () => {
      const b = {
        eq: () => b, is: () => b, order: () => b, limit: () => b,
        maybeSingle: async () => {
          if(table === 'ligacoes_sync_log'){
            window.__ligConsultas++;
            if(window.__ligErro) throw new Error('boom: sem permissão');
            return { data: window.__ligOk, error: null };
          }
          return { data: null, error: null };
        },
        range: () => ({ then: (resolve) => resolve({ data: [], error: null }) }),
        then: (resolve) => resolve({ data: [], error: null }),
      };
      return b;
    },
  }),
  functions: { invoke: async () => ({data:{},error:null}) },
})) };

const testScript = `
try{
  let ok = 0, fail = 0;
  function assert(cond, msg){ if(cond){ ok++; } else { fail++; console.log('FALHOU:', msg); } }
  const banner = () => document.getElementById('syncLigacoesBanner');
  const visivel = () => banner().style.display !== 'none';
  const texto = () => banner().textContent;
  // São Paulo = UTC-3. 02/10/2026 é sexta; 03 sábado; 04 domingo; 05 segunda.
  const utc = (iso) => new Date(iso).getTime();

  // --- 1) estrutura: existe, escondida, anunciada como alerta e dentro de #appMain ---
  assert(banner() !== null, 'faixa syncLigacoesBanner existe');
  assert(banner().parentElement.id === 'appMain', 'a faixa fica dentro de #appMain');
  assert(banner().getAttribute('role') === 'alert', 'a faixa tem role="alert"');
  assert(!visivel(), 'a faixa começa escondida');
  assert(typeof verificarSyncLigacoes === 'function', 'verificarSyncLigacoes existe');
  assert(typeof ligMinutosUteisSemSync === 'function', 'ligMinutosUteisSemSync existe');
  assert(LIG_SYNC_LIMITE_MIN === 180, 'limite de 180 minutos úteis');
  assert(!/#[0-9a-fA-F]{3,6}\\b/.test(banner().getAttribute('style') || ''), 'a faixa não usa cor fixa em hex');

  // --- 2) cálculo de minutos úteis (função pura) ---
  const sex10 = utc('2026-10-02T13:00:00Z'); // sexta 10:00 SP
  assert(ligMinutosUteisSemSync(sex10, sex10 + 10 * 60000) === 10, '10 minutos em horário útil = 10');
  assert(ligMinutosUteisSemSync(sex10, sex10 + 180 * 60000) === 180, 'exatamente 3 h úteis = 180');
  assert(ligMinutosUteisSemSync(sex10, sex10 + 181 * 60000) === 181, '3 h e 1 min úteis = 181');
  assert(ligMinutosUteisSemSync(sex10, sex10) === 0 && ligMinutosUteisSemSync(sex10, sex10 - 60000) === 0, 'agora <= último ok = 0');
  assert(ligMinutosUteisSemSync(NaN, sex10) === 0, 'data inválida = 0');
  // sexta 20:00 SP -> sábado 09:00 SP: 2 h (sexta 20-22) + 2 h (sábado 07-09) = 240
  assert(ligMinutosUteisSemSync(utc('2026-10-02T23:00:00Z'), utc('2026-10-03T12:00:00Z')) === 240, 'sexta 20h -> sábado 9h = 240 min úteis');
  // sábado 21:30 SP -> segunda 08:00 SP: 30 min (sábado) + domingo inteiro (0) + 60 min (segunda 07-08) = 90
  assert(ligMinutosUteisSemSync(utc('2026-10-04T00:30:00Z'), utc('2026-10-05T11:00:00Z')) === 90, 'sábado 21:30 -> segunda 8h = 90 min úteis');
  // domingo o dia todo = 0
  assert(ligMinutosUteisSemSync(utc('2026-10-04T12:00:00Z'), utc('2026-10-04T23:00:00Z')) === 0, 'domingo = 0');
  // noite (22h-07h) = 0
  assert(ligMinutosUteisSemSync(utc('2026-10-03T01:00:00Z'), utc('2026-10-03T09:00:00Z')) === 0, 'sexta 22h -> sábado 6h = 0');
  assert(ligMinutosUteisSemSync(sex10, sex10 + 15 * 24 * 3600000) === Infinity, 'parado há mais de 14 dias = Infinity');

  const recente = () => new Date(Date.now() - 10 * 60000).toISOString();
  const antigo = () => new Date(Date.now() - 30 * 24 * 3600000).toISOString();

  // --- 3) tabela vazia (robô ainda não ligado): nenhuma faixa ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__ligOk = null;
  await verificarSyncLigacoes();
  assert(!visivel(), 'sem nenhuma sincronização registrada, a faixa não aparece');

  // --- 4) sincronização recente: sem faixa ---
  window.__ligOk = { terminou_em: recente() };
  await verificarSyncLigacoes();
  assert(!visivel(), 'sincronização de 10 minutos atrás: sem faixa');

  // --- 5) sincronização antiga: admin e supervisor veem, com a data e o caminho do upload manual ---
  window.__ligOk = { terminou_em: antigo() };
  await verificarSyncLigacoes();
  assert(visivel(), 'admin vê a faixa quando a última sincronização é antiga');
  assert(texto().includes('Monitoramento Leads'), 'texto cita o Monitoramento Leads (' + texto() + ')');
  assert(!texto().includes('null') && !texto().includes('Invalid') && !texto().includes('undefined'), 'texto não vaza null/Invalid/undefined (' + texto() + ')');
  currentUser = { id: 'u2', nome: 'Sup', username: 'sup', role: 'supervisor' };
  await verificarSyncLigacoes();
  assert(visivel(), 'supervisor também vê a faixa');

  // --- 6) consultor: nunca vê e nem consulta ---
  currentUser = { id: 'u3', nome: 'Cons', username: 'cons', role: 'consultor' };
  const antes = window.__ligConsultas;
  await verificarSyncLigacoes();
  assert(!visivel(), 'consultor não vê a faixa');
  assert(window.__ligConsultas === antes, 'consultor nem consulta a tabela');

  // --- 7) voltou a sincronizar: a faixa some ---
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__ligOk = { terminou_em: antigo() };
  await verificarSyncLigacoes();
  assert(visivel(), 'faixa visível com sincronização antiga');
  window.__ligOk = { terminou_em: recente() };
  await verificarSyncLigacoes();
  assert(!visivel(), 'com sincronização recente a faixa some');

  // --- 8) falha na consulta: não quebra e não deixa a faixa presa ---
  window.__ligOk = { terminou_em: antigo() };
  await verificarSyncLigacoes();
  window.__ligErro = true;
  let lancou = false;
  try { await verificarSyncLigacoes(); } catch(e){ lancou = true; }
  assert(!lancou, 'falha na consulta não lança');
  assert(!visivel(), 'falha na consulta esconde a faixa');
  window.__ligErro = false;

  // --- 9) sem usuário logado: escondida ---
  currentUser = null;
  await verificarSyncLigacoes();
  assert(!visivel(), 'sem usuário logado a faixa fica escondida');

  // --- 10) ligada aos pontos de disparo existentes (sem timer próprio) ---
  assert(String(verificarAlertaSyncProducao).includes('verificarSyncLigacoes'), 'verificarAlertaSyncProducao também verifica a faixa das ligações');
  const esperar = () => new Promise(r => setTimeout(r, 30));
  currentUser = { id: 'u1', nome: 'Admin', username: 'admin', role: 'admin' };
  window.__ligOk = { terminou_em: antigo() };
  window.dispatchEvent(new window.Event('focus'));
  await esperar();
  assert(visivel(), 'ao voltar o foco para a janela a faixa é atualizada');

  console.log('--- RESULTADO:', ok, 'passaram,', fail, 'falharam ---');
  window.__testResult = fail > 0 ? 'FAIL' : 'OK';
}catch(e){
  console.log('ERRO FATAL:', e.message);
  console.log(e.stack);
  window.__testResult = 'FAIL';
}
`;

(async () => {
  await window.eval('(async () => {' + jsCode + testScript + '})()');
  setTimeout(() => {
    if(window.__testResult !== 'OK') process.exitCode = 1;
  }, 500);
})();
